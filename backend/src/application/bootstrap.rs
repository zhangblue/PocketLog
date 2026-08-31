//! 首屏所需的分类、账户、月份和数据修订版本快照。

use super::{AppError, BootstrapSnapshot, ports::LedgerRepository};

pub async fn load_bootstrap<R: LedgerRepository>(
    repository: &R,
) -> Result<BootstrapSnapshot, AppError> {
    // 首屏快照的原子性由仓储实现保证；服务层不拼接多次独立查询，避免 categories 与 revision
    // 对不上导致客户端马上出现乐观并发冲突。
    repository.bootstrap().await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::dto::{AccountDto, CategoryDto, CreateAccount, CreateCategory};
    use crate::application::ports::{LedgerRepository, LedgerTransaction};
    use crate::application::transactions::{
        DeleteTransactionResult, IdempotencyRecord, LockedReferences, NewStoredTransaction,
        TransactionDto, TransactionPage, TransactionQuery,
    };
    use crate::domain::UtcInstant;
    use async_trait::async_trait;
    use uuid::Uuid;

    struct StubTx;
    fn unused<T>() -> Result<T, AppError> {
        Err(AppError::new("mock.unused"))
    }

    #[async_trait]
    impl LedgerTransaction for StubTx {
        async fn read_app_state(
            &mut self,
        ) -> Result<crate::application::AppStateSnapshot, AppError> {
            unused()
        }
        async fn lock_app_state(
            &mut self,
        ) -> Result<crate::application::AppStateSnapshot, AppError> {
            unused()
        }
        async fn increment_data_revision(
            &mut self,
        ) -> Result<crate::application::DataRevision, AppError> {
            unused()
        }
        async fn find_idempotency(
            &mut self,
            _: &str,
        ) -> Result<Option<IdempotencyRecord>, AppError> {
            unused()
        }
        async fn lock_references(
            &mut self,
            _: Option<Uuid>,
            _: Uuid,
            _: Option<Uuid>,
        ) -> Result<LockedReferences, AppError> {
            unused()
        }
        async fn insert_transaction(&mut self, _: NewStoredTransaction) -> Result<(), AppError> {
            unused()
        }
        async fn complete_idempotency(
            &mut self,
            _: &str,
            _: IdempotencyRecord,
        ) -> Result<(), AppError> {
            unused()
        }
        async fn commit(self) -> Result<(), AppError> {
            unused()
        }
        async fn rollback(self) -> Result<(), AppError> {
            unused()
        }
        async fn list_categories(&mut self) -> Result<Vec<CategoryDto>, AppError> {
            unused()
        }
        async fn list_accounts(&mut self) -> Result<Vec<AccountDto>, AppError> {
            unused()
        }
        async fn insert_category(&mut self, _: CreateCategory) -> Result<CategoryDto, AppError> {
            unused()
        }
        async fn update_category_name(
            &mut self,
            _: Uuid,
            _: String,
        ) -> Result<CategoryDto, AppError> {
            unused()
        }
        async fn update_category(
            &mut self,
            _: Uuid,
            _: Option<String>,
            _: Option<String>,
        ) -> Result<CategoryDto, AppError> {
            unused()
        }
        async fn set_category_active(&mut self, _: Uuid, _: bool) -> Result<CategoryDto, AppError> {
            unused()
        }
        async fn reorder_categories(&mut self, _: Vec<Uuid>) -> Result<Vec<CategoryDto>, AppError> {
            unused()
        }
        async fn delete_category(&mut self, _: Uuid) -> Result<(), AppError> {
            unused()
        }
        async fn migrate_category(&mut self, _: Uuid, _: Uuid) -> Result<(), AppError> {
            unused()
        }
        async fn insert_account(&mut self, _: CreateAccount) -> Result<AccountDto, AppError> {
            unused()
        }
        async fn update_account_name(
            &mut self,
            _: Uuid,
            _: String,
        ) -> Result<AccountDto, AppError> {
            unused()
        }
        async fn set_account_active(&mut self, _: Uuid, _: bool) -> Result<AccountDto, AppError> {
            unused()
        }
        async fn insert_custom_icon(&mut self, _: String) -> Result<String, AppError> {
            unused()
        }
    }

    struct StubRepository {
        result: Result<BootstrapSnapshot, AppError>,
    }
    #[async_trait]
    impl LedgerRepository for StubRepository {
        type Transaction = StubTx;
        async fn bootstrap(&self) -> Result<BootstrapSnapshot, AppError> {
            self.result.clone()
        }
        async fn begin_write(&self) -> Result<StubTx, AppError> {
            unused()
        }
        async fn begin_repeatable_read(&self) -> Result<StubTx, AppError> {
            unused()
        }
        async fn list_transactions(
            &self,
            _: TransactionQuery,
        ) -> Result<TransactionPage, AppError> {
            unused()
        }
        async fn delete_transaction(
            &self,
            _: Uuid,
            _: UtcInstant,
            _: crate::application::DataRevision,
        ) -> Result<DeleteTransactionResult, AppError> {
            unused()
        }
        async fn restore_transaction(
            &self,
            _: Uuid,
            _: Uuid,
            _: UtcInstant,
            _: crate::application::DataRevision,
        ) -> Result<TransactionDto, AppError> {
            unused()
        }
        async fn cleanup_expired(&self, _: UtcInstant) -> Result<(), AppError> {
            unused()
        }
        async fn analytics_facts(
            &self,
            _: crate::domain::analytics::Period,
            _: Option<Uuid>,
        ) -> Result<
            (
                crate::domain::analytics::OverviewFacts,
                crate::application::DataRevision,
            ),
            AppError,
        > {
            unused()
        }
    }

    #[tokio::test]
    async fn loads_and_propagates_bootstrap_repository_result() {
        let expected = BootstrapSnapshot {
            categories: vec![],
            accounts: vec![],
            months: vec!["2026-08".into()],
            data_revision: crate::application::DataRevision::new(3),
            server_time: "now".into(),
            custom_icons: vec![],
        };
        assert_eq!(
            load_bootstrap(&StubRepository {
                result: Ok(expected.clone())
            })
            .await
            .unwrap(),
            expected
        );
        assert_eq!(
            load_bootstrap(&StubRepository {
                result: Err(AppError::new("repository.failed"))
            })
            .await
            .unwrap_err()
            .code(),
            "repository.failed"
        );
    }
}
