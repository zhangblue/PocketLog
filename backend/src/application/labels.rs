//! 分类与账户标签用例：先校验领域不变量，再在同一写事务中更新并递增修订版本。

use std::marker::PhantomData;

use uuid::Uuid;

use crate::{
    application::{
        AppError, DataRevision,
        dto::{AccountDto, CategoryDto, CreateAccount, CreateCategory, Mutation},
        ports::{LedgerRepository, LedgerTransaction},
        transactions::HasClock,
    },
    domain::{
        AccountLabel, Category, CategoryKind, validate_account_deactivation,
        validate_category_deactivation, validate_category_migration, validate_complete_order,
    },
};

pub struct LabelService<R> {
    /// 标签写用例以仓储事务为唯一副作用边界；领域对象只用于检查停用、迁移、排序不变量。
    repository: R,
    _marker: PhantomData<R>,
}

impl<R> LabelService<R> {
    pub fn new(repository: R) -> Self {
        Self {
            repository,
            _marker: PhantomData,
        }
    }
}

impl<R> LabelService<R>
where
    R: LedgerRepository + Sync + HasClock,
    R::Transaction: LedgerTransaction,
{
    pub async fn create_custom_icon(
        &self,
        raw_emoji: impl Into<String>,
        expected: DataRevision,
    ) -> Result<Mutation<String>, AppError> {
        let mut tx = self.repository.begin_write().await?;
        let state = tx.lock_app_state().await?;
        check_revision(state.data_revision, expected)?;
        let emoji = raw_emoji.into().trim().to_owned();
        if emoji.is_empty() {
            return finish(tx, Err(AppError::new("custom_icon.empty")), expected).await;
        }
        if !(1..=16).contains(&emoji.chars().count()) {
            return finish(
                tx,
                Err(AppError::new("custom_icon.length_invalid")),
                expected,
            )
            .await;
        }
        let result = async {
            let value = tx.insert_custom_icon(emoji).await?;
            let revision = tx.increment_data_revision().await?;
            Ok(Mutation {
                value,
                data_revision: revision,
            })
        }
        .await;
        finish(tx, result, expected).await
    }
    pub async fn create_category(
        &self,
        input: CreateCategory,
        expected: DataRevision,
    ) -> Result<Mutation<CategoryDto>, AppError> {
        // 锁定应用状态后比较修订版本，防止旧页面覆盖并发客户端的新修改。
        let mut tx = self.repository.begin_write().await?;
        let state = tx.lock_app_state().await?;
        check_revision(state.data_revision, expected)?;
        let result = async {
            let category = tx.insert_category(input).await?;
            let revision = tx.increment_data_revision().await?;
            Ok(Mutation {
                value: category,
                data_revision: revision,
            })
        }
        .await;
        finish(tx, result, expected).await
    }

    pub async fn rename_category(
        &self,
        id: Uuid,
        name: impl Into<String>,
        expected: DataRevision,
    ) -> Result<Mutation<CategoryDto>, AppError> {
        // 先在同一写事务列出全部分类并构建领域投影，再决定能否停用，不能依赖客户端传来的
        // 旧列表；成功修改后才递增 data_revision。
        let mut tx = self.repository.begin_write().await?;
        let state = tx.lock_app_state().await?;
        check_revision(state.data_revision, expected)?;
        let result = async {
            let value = tx.update_category_name(id, name.into()).await?;
            let revision = tx.increment_data_revision().await?;
            Ok(Mutation {
                value,
                data_revision: revision,
            })
        }
        .await;
        finish(tx, result, expected).await
    }

    pub async fn update_category(
        &self,
        id: Uuid,
        name: Option<String>,
        emoji: Option<String>,
        expected: DataRevision,
    ) -> Result<Mutation<CategoryDto>, AppError> {
        // 先锁定 revision，再在同一事务内完成所有字段更新与版本推进；任一步失败都由 finish
        // 回滚，避免名称已保存但 Emoji 或修订版本尚未写入的半完成状态。
        let mut tx = self.repository.begin_write().await?;
        let state = tx.lock_app_state().await?;
        check_revision(state.data_revision, expected)?;
        let result = async {
            let value = tx.update_category(id, name, emoji).await?;
            let revision = tx.increment_data_revision().await?;
            Ok(Mutation {
                value,
                data_revision: revision,
            })
        }
        .await;
        finish(tx, result, expected).await
    }

    pub async fn deactivate_category(
        &self,
        id: Uuid,
        expected: DataRevision,
    ) -> Result<Mutation<CategoryDto>, AppError> {
        let mut tx = self.repository.begin_write().await?;
        let state = tx.lock_app_state().await?;
        check_revision(state.data_revision, expected)?;
        let result = async {
            let categories = tx.list_categories().await?;
            let target = categories
                .iter()
                .find(|item| item.id == id)
                .ok_or_else(|| AppError::new("category.not_found"))?;
            let kind = parse_kind(&target.kind)?;
            let domain_target = Category::new_with_emoji(
                target.id.into(),
                kind,
                &target.name,
                &target.emoji,
                &target.color,
                target.active,
                target.sort_order,
            )
            .map_err(domain_error)?;
            let all = categories
                .iter()
                .map(|item| {
                    Category::new_with_emoji(
                        item.id.into(),
                        parse_kind(&item.kind).unwrap_or(CategoryKind::Expense),
                        &item.name,
                        &item.emoji,
                        &item.color,
                        item.active,
                        item.sort_order,
                    )
                })
                .collect::<Result<Vec<_>, _>>()
                .map_err(domain_error)?;
            validate_category_deactivation(&domain_target, &all).map_err(domain_error)?;
            let value = tx.set_category_active(id, false).await?;
            let revision = tx.increment_data_revision().await?;
            Ok(Mutation {
                value,
                data_revision: revision,
            })
        }
        .await;
        finish(tx, result, expected).await
    }

    pub async fn activate_category(
        &self,
        id: Uuid,
        expected: DataRevision,
    ) -> Result<Mutation<CategoryDto>, AppError> {
        let mut tx = self.repository.begin_write().await?;
        let state = tx.lock_app_state().await?;
        check_revision(state.data_revision, expected)?;
        let result = async {
            let value = tx.set_category_active(id, true).await?;
            let revision = tx.increment_data_revision().await?;
            Ok(Mutation {
                value,
                data_revision: revision,
            })
        }
        .await;
        finish(tx, result, expected).await
    }

    pub async fn reorder_categories(
        &self,
        ids: Vec<Uuid>,
        expected: DataRevision,
    ) -> Result<Mutation<Vec<CategoryDto>>, AppError> {
        // 完整排列校验必须在锁定 revision 后进行，避免并发新增分类时旧页面把新分类从排序中遗漏。
        let mut tx = self.repository.begin_write().await?;
        let state = tx.lock_app_state().await?;
        check_revision(state.data_revision, expected)?;
        let result = async {
            let current = tx.list_categories().await?;
            validate_complete_order(
                &current
                    .iter()
                    .map(|item| item.id.into())
                    .collect::<Vec<_>>(),
                &ids.iter().copied().map(Into::into).collect::<Vec<_>>(),
            )
            .map_err(domain_error)?;
            let value = tx.reorder_categories(ids).await?;
            let revision = tx.increment_data_revision().await?;
            Ok(Mutation {
                value,
                data_revision: revision,
            })
        }
        .await;
        finish(tx, result, expected).await
    }

    pub async fn delete_category(
        &self,
        id: Uuid,
        expected: DataRevision,
    ) -> Result<Mutation<()>, AppError> {
        // 迁移同时修改交易引用并删除源分类；仓储在当前事务完成两步，任何一步失败都由 finish 回滚。
        let mut tx = self.repository.begin_write().await?;
        let state = tx.lock_app_state().await?;
        check_revision(state.data_revision, expected)?;
        let result = async {
            tx.delete_category(id).await?;
            let revision = tx.increment_data_revision().await?;
            Ok(Mutation {
                value: (),
                data_revision: revision,
            })
        }
        .await;
        finish(tx, result, expected).await
    }

    pub async fn migrate_category(
        &self,
        from: Uuid,
        to: Uuid,
        expected: DataRevision,
    ) -> Result<Mutation<()>, AppError> {
        let mut tx = self.repository.begin_write().await?;
        let state = tx.lock_app_state().await?;
        check_revision(state.data_revision, expected)?;
        let result = async {
            let categories = tx.list_categories().await?;
            let source = categories
                .iter()
                .find(|item| item.id == from)
                .ok_or_else(|| AppError::new("category.not_found"))?;
            let target = categories
                .iter()
                .find(|item| item.id == to)
                .ok_or_else(|| AppError::new("category.not_found"))?;
            let source = Category::new(
                from.into(),
                parse_kind(&source.kind)?,
                &source.name,
                &source.color,
                source.active,
                source.sort_order,
            )
            .map_err(domain_error)?;
            let target = Category::new(
                to.into(),
                parse_kind(&target.kind)?,
                &target.name,
                &target.color,
                target.active,
                target.sort_order,
            )
            .map_err(domain_error)?;
            validate_category_migration(&source, &target).map_err(domain_error)?;
            // 交易引用迁移与源标签删除由仓储放在同一事务，失败时不能留下半迁移状态。
            tx.migrate_category(from, to).await?;
            let revision = tx.increment_data_revision().await?;
            Ok(Mutation {
                value: (),
                data_revision: revision,
            })
        }
        .await;
        finish(tx, result, expected).await
    }

    pub async fn create_account(
        &self,
        input: CreateAccount,
        expected: DataRevision,
    ) -> Result<Mutation<AccountDto>, AppError> {
        let mut tx = self.repository.begin_write().await?;
        let state = tx.lock_app_state().await?;
        check_revision(state.data_revision, expected)?;
        let result = async {
            let value = tx.insert_account(input).await?;
            let revision = tx.increment_data_revision().await?;
            Ok(Mutation {
                value,
                data_revision: revision,
            })
        }
        .await;
        finish(tx, result, expected).await
    }

    pub async fn rename_account(
        &self,
        id: Uuid,
        name: impl Into<String>,
        expected: DataRevision,
    ) -> Result<Mutation<AccountDto>, AppError> {
        let mut tx = self.repository.begin_write().await?;
        let state = tx.lock_app_state().await?;
        check_revision(state.data_revision, expected)?;
        let result = async {
            let value = tx.update_account_name(id, name.into()).await?;
            let revision = tx.increment_data_revision().await?;
            Ok(Mutation {
                value,
                data_revision: revision,
            })
        }
        .await;
        finish(tx, result, expected).await
    }

    pub async fn deactivate_account(
        &self,
        id: Uuid,
        expected: DataRevision,
    ) -> Result<Mutation<AccountDto>, AppError> {
        let mut tx = self.repository.begin_write().await?;
        let state = tx.lock_app_state().await?;
        check_revision(state.data_revision, expected)?;
        let result = async {
            let accounts = tx.list_accounts().await?;
            let target = accounts
                .iter()
                .find(|item| item.id == id)
                .ok_or_else(|| AppError::new("account.not_found"))?;
            let domain_target =
                AccountLabel::new(id.into(), &target.name, target.active).map_err(domain_error)?;
            let all = accounts
                .iter()
                .map(|item| AccountLabel::new(item.id.into(), &item.name, item.active))
                .collect::<Result<Vec<_>, _>>()
                .map_err(domain_error)?;
            validate_account_deactivation(&domain_target, &all).map_err(domain_error)?;
            let value = tx.set_account_active(id, false).await?;
            let revision = tx.increment_data_revision().await?;
            Ok(Mutation {
                value,
                data_revision: revision,
            })
        }
        .await;
        finish(tx, result, expected).await
    }
}

fn parse_kind(value: &str) -> Result<CategoryKind, AppError> {
    match value {
        "expense" => Ok(CategoryKind::Expense),
        "income" => Ok(CategoryKind::Income),
        _ => Err(AppError::new("category.kind_invalid")),
    }
}

fn domain_error(error: crate::domain::DomainError) -> AppError {
    AppError::new(error.code())
}
fn check_revision(actual: DataRevision, expected: DataRevision) -> Result<(), AppError> {
    // 不尝试自动合并标签修改。前端收到冲突后应重新拉取快照，避免静默覆盖另一端调整。
    // 修订版本是轻量乐观并发令牌；不相等即拒绝写入而不是静默合并。
    if actual == expected {
        Ok(())
    } else {
        Err(AppError::new("revision_conflict"))
    }
}

async fn finish<T, X: LedgerTransaction>(
    tx: X,
    result: Result<T, AppError>,
    _expected: DataRevision,
) -> Result<T, AppError> {
    // 所有标签用例收敛到同一提交/回滚出口：只有 commit 成功才把值交还调用者；rollback 自身
    // 失败不会覆盖原始业务错误，以保留最能指导重试的稳定错误码。
    // 用例内任一步失败都回滚，成功才提交并让调用方拿到新的修订版本。
    match result {
        Ok(value) => {
            tx.commit().await?;
            Ok(value)
        }
        Err(error) => {
            let _ = tx.rollback().await;
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_category_kinds_and_rejects_unknown_values() {
        assert_eq!(parse_kind("expense").unwrap(), CategoryKind::Expense);
        assert_eq!(parse_kind("income").unwrap(), CategoryKind::Income);
        assert_eq!(
            parse_kind("transfer").unwrap_err().code(),
            "category.kind_invalid"
        );
    }

    #[test]
    fn revision_guard_accepts_equal_and_rejects_stale_values() {
        assert!(check_revision(DataRevision::new(3), DataRevision::new(3)).is_ok());
        assert_eq!(
            check_revision(DataRevision::new(3), DataRevision::new(2))
                .unwrap_err()
                .code(),
            "revision_conflict"
        );
    }
}
