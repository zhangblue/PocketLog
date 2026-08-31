//! 应用层端口：声明读写账本所需的能力，不把 SeaORM 类型泄漏到用例层。

use async_trait::async_trait;

use super::dto::{AccountDto, CategoryDto, CreateAccount, CreateCategory};
use super::{
    AppError, AppStateSnapshot, BootstrapSnapshot, DataRevision,
    transactions::{
        DeleteTransactionResult, IdempotencyRecord, LockedReferences, NewStoredTransaction,
        TransactionDto, TransactionQuery,
    },
};
use crate::domain::analytics::{OverviewFacts, Period};

#[async_trait]
pub trait LedgerRepository: Send + Sync {
    // 读写边界显式分离：只读分析快照和写事务使用不同方法，基础设施可以据此施加隔离级别。
    type Transaction: LedgerTransaction;

    async fn bootstrap(&self) -> Result<BootstrapSnapshot, AppError>;
    async fn begin_write(&self) -> Result<Self::Transaction, AppError>;
    async fn begin_repeatable_read(&self) -> Result<Self::Transaction, AppError>;
    async fn list_transactions(
        &self,
        query: TransactionQuery,
    ) -> Result<super::transactions::TransactionPage, AppError>;
    async fn delete_transaction(
        &self,
        id: uuid::Uuid,
        now: crate::domain::UtcInstant,
        expected: DataRevision,
    ) -> Result<DeleteTransactionResult, AppError>;
    async fn restore_transaction(
        &self,
        id: uuid::Uuid,
        token: uuid::Uuid,
        now: crate::domain::UtcInstant,
        expected: DataRevision,
    ) -> Result<TransactionDto, AppError>;
    async fn cleanup_expired(&self, now: crate::domain::UtcInstant) -> Result<(), AppError>;
    async fn analytics_facts(
        &self,
        period: Period,
        account_id: Option<uuid::Uuid>,
    ) -> Result<(OverviewFacts, DataRevision), AppError>;
}

#[async_trait]
pub trait LedgerTransaction: Send {
    // 此 trait 表达用例所需的原子操作，而不是泄漏 SQL/SeaORM。实现必须保证 commit 成功前
    // 任何可见业务结果都不算持久化，调用方负责在错误分支 rollback。
    async fn read_app_state(&mut self) -> Result<AppStateSnapshot, AppError>;
    async fn lock_app_state(&mut self) -> Result<AppStateSnapshot, AppError>;
    async fn increment_data_revision(&mut self) -> Result<DataRevision, AppError>;
    async fn find_idempotency(&mut self, key: &str) -> Result<Option<IdempotencyRecord>, AppError>;
    async fn lock_references(
        &mut self,
        category_id: Option<uuid::Uuid>,
        account_id: uuid::Uuid,
        target_account_id: Option<uuid::Uuid>,
    ) -> Result<LockedReferences, AppError>;
    async fn insert_transaction(
        &mut self,
        transaction: NewStoredTransaction,
    ) -> Result<(), AppError>;
    async fn complete_idempotency(
        &mut self,
        key: &str,
        record: IdempotencyRecord,
    ) -> Result<(), AppError>;
    async fn commit(self) -> Result<(), AppError>;
    async fn rollback(self) -> Result<(), AppError>;

    async fn list_categories(&mut self) -> Result<Vec<CategoryDto>, AppError>;
    async fn list_accounts(&mut self) -> Result<Vec<AccountDto>, AppError>;
    async fn insert_category(&mut self, input: CreateCategory) -> Result<CategoryDto, AppError>;
    async fn update_category_name(
        &mut self,
        id: uuid::Uuid,
        name: String,
    ) -> Result<CategoryDto, AppError>;
    /// 在当前写事务中只覆盖调用方提供的分类字段；实现负责保持名称规范化和唯一性约束。
    async fn update_category(
        &mut self,
        id: uuid::Uuid,
        name: Option<String>,
        emoji: Option<String>,
    ) -> Result<CategoryDto, AppError>;
    async fn set_category_active(
        &mut self,
        id: uuid::Uuid,
        active: bool,
    ) -> Result<CategoryDto, AppError>;
    async fn reorder_categories(
        &mut self,
        ids: Vec<uuid::Uuid>,
    ) -> Result<Vec<CategoryDto>, AppError>;
    async fn delete_category(&mut self, id: uuid::Uuid) -> Result<(), AppError>;
    async fn migrate_category(&mut self, from: uuid::Uuid, to: uuid::Uuid) -> Result<(), AppError>;
    async fn insert_account(&mut self, input: CreateAccount) -> Result<AccountDto, AppError>;
    async fn update_account_name(
        &mut self,
        id: uuid::Uuid,
        name: String,
    ) -> Result<AccountDto, AppError>;
    async fn set_account_active(
        &mut self,
        id: uuid::Uuid,
        active: bool,
    ) -> Result<AccountDto, AppError>;
    async fn insert_custom_icon(&mut self, emoji: String) -> Result<String, AppError>;
}
