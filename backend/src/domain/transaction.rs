//! 交易领域模型：统一收支与转账形状，明确账户、分类和目标账户约束。

use super::{
    AccountId, AccountLabel, Category, CategoryId, CategoryKind, DomainError, Money, OccurredAt,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransactionKind {
    /// 支出和收入必须关联同类型分类；转账则没有分类且不参与净收支。
    Expense,
    Income,
    Transfer,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NewTransaction {
    /// 通过领域校验之前的规范化写入形状；外部引用是否仍启用由 `ActiveReferences` 一并验证。
    pub kind: TransactionKind,
    pub amount: Money,
    pub name: String,
    pub category_id: Option<CategoryId>,
    pub account_id: AccountId,
    pub to_account_id: Option<AccountId>,
    pub occurred_at: OccurredAt,
    pub note: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TransactionDraft(NewTransaction);

impl TransactionDraft {
    pub fn expense(
        amount: Money,
        name: impl Into<String>,
        category_id: CategoryId,
        account_id: AccountId,
        occurred_at: OccurredAt,
    ) -> Self {
        Self::categorized(
            TransactionKind::Expense,
            amount,
            name,
            category_id,
            account_id,
            occurred_at,
        )
    }

    pub fn income(
        amount: Money,
        name: impl Into<String>,
        category_id: CategoryId,
        account_id: AccountId,
        occurred_at: OccurredAt,
    ) -> Self {
        Self::categorized(
            TransactionKind::Income,
            amount,
            name,
            category_id,
            account_id,
            occurred_at,
        )
    }

    pub fn transfer(
        amount: Money,
        from_account_id: AccountId,
        to_account_id: AccountId,
        occurred_at: OccurredAt,
    ) -> Self {
        // 转账是资金移动而非收入/支出，因此没有分类，并显式记录资金去向。
        Self(NewTransaction {
            kind: TransactionKind::Transfer,
            amount,
            name: "转账".to_owned(),
            category_id: None,
            account_id: from_account_id,
            to_account_id: Some(to_account_id),
            occurred_at,
            note: None,
        })
    }

    pub fn validate(self) -> Result<NewTransaction, DomainError> {
        // 构造器方便应用层表达意图，但仍在这里统一执行形状校验，防止未来新增构造路径绕过约束。
        validate_shape(&self.0)?;
        Ok(self.0)
    }

    fn categorized(
        kind: TransactionKind,
        amount: Money,
        name: impl Into<String>,
        category_id: CategoryId,
        account_id: AccountId,
        occurred_at: OccurredAt,
    ) -> Self {
        Self(NewTransaction {
            kind,
            amount,
            name: name.into(),
            category_id: Some(category_id),
            account_id,
            to_account_id: None,
            occurred_at,
            note: None,
        })
    }
}

#[derive(Clone, Debug, Default)]
pub struct ActiveReferences {
    /// 一次锁定读取到的分类/账户快照，用于在事务内验证引用，避免“先读后写”竞态。
    pub categories: Vec<Category>,
    pub accounts: Vec<AccountLabel>,
}

impl ActiveReferences {
    pub fn new(categories: Vec<Category>, accounts: Vec<AccountLabel>) -> Self {
        Self {
            categories,
            accounts,
        }
    }
}

pub fn validate_transaction(
    input: &NewTransaction,
    refs: &ActiveReferences,
) -> Result<(), DomainError> {
    // 先验证不依赖存储的结构，再以同一锁定快照验证标签有效性；调用方应在写事务中提供 refs。
    validate_shape(input)?;
    if !refs
        .accounts
        .iter()
        .any(|account| account.id == input.account_id && account.active)
    {
        return Err(DomainError::new(
            "transaction.account_inactive",
            "transaction account must be active",
        ));
    }
    if let Some(to_account_id) = input.to_account_id
        && !refs
            .accounts
            .iter()
            .any(|account| account.id == to_account_id && account.active)
    {
        return Err(DomainError::new(
            "transaction.destination_account_inactive",
            "transfer destination account must be active",
        ));
    }
    if let Some(category_id) = input.category_id {
        let category = refs
            .categories
            .iter()
            .find(|category| category.id == category_id && category.active)
            .ok_or_else(|| {
                DomainError::new(
                    "transaction.category_inactive",
                    "transaction category must be active",
                )
            })?;
        let expected_kind = match input.kind {
            TransactionKind::Expense => CategoryKind::Expense,
            TransactionKind::Income => CategoryKind::Income,
            TransactionKind::Transfer => unreachable!("transfers cannot have categories"),
        };
        if category.kind != expected_kind {
            return Err(DomainError::new(
                "transaction.category_kind_mismatch",
                "transaction category kind does not match transaction kind",
            ));
        }
    }
    Ok(())
}

fn validate_shape(input: &NewTransaction) -> Result<(), DomainError> {
    // 交易形状是数据库约束之外的业务可读性规则。错误码细分到字段级，使 API 能把反馈定位给用户。
    // 先校验交易形状，再校验外部引用，非法转账无需依赖数据库状态即可拒绝。
    let name_length = input.name.trim().chars().count();
    if !(1..=120).contains(&name_length) {
        return Err(DomainError::new(
            "transaction.name_length_invalid",
            "transaction name must contain 1 to 120 characters",
        ));
    }
    if input
        .note
        .as_ref()
        .is_some_and(|note| note.chars().count() > 1000)
    {
        return Err(DomainError::new(
            "transaction.note_length_invalid",
            "transaction note must not exceed 1000 characters",
        ));
    }
    match input.kind {
        TransactionKind::Transfer => {
            if input.category_id.is_some() {
                return Err(DomainError::new(
                    "transaction.transfer_has_category",
                    "transfers cannot have categories",
                ));
            }
            let to_account_id = input.to_account_id.ok_or_else(|| {
                DomainError::new(
                    "transaction.destination_account_required",
                    "transfer destination account is required",
                )
            })?;
            if input.account_id == to_account_id {
                return Err(DomainError::new(
                    "transaction.accounts_must_differ",
                    "transfer accounts must differ",
                ));
            }
        }
        TransactionKind::Expense | TransactionKind::Income => {
            if input.category_id.is_none() {
                return Err(DomainError::new(
                    "transaction.category_required",
                    "a category is required for income and expense transactions",
                ));
            }
            if input.to_account_id.is_some() {
                return Err(DomainError::new(
                    "transaction.destination_account_unexpected",
                    "only transfers can have a destination account",
                ));
            }
        }
    }
    Ok(())
}
