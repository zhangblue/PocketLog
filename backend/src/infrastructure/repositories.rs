use async_trait::async_trait;
use chrono::Datelike;
use sea_orm::{
    AccessMode, ConnectionTrait, DatabaseConnection, DatabaseTransaction, DbBackend, DbErr,
    IsolationLevel, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, Statement,
    TransactionTrait, entity::*, sea_query::Expr,
};
use uuid::Uuid;

use crate::{
    application::{
        AppError, AppStateSnapshot, BootstrapSnapshot, DataRevision,
        clock::{Clock, SystemClock},
        dto::{AccountDto, CategoryDto, CreateAccount, CreateCategory},
        ports::{LedgerRepository, LedgerTransaction},
        transactions::{
            DeleteTransactionResult, HasClock, IdempotencyRecord, LockedReferences,
            NewStoredTransaction, TransactionCursor, TransactionDto, TransactionKind,
            TransactionPage, TransactionQuery,
        },
    },
    domain::TransactionKind as DomainTransactionKind,
    domain::analytics::{AnalyticsCategory, AnalyticsTransaction, OverviewFacts, Period},
    infrastructure::entities::{
        account_label, app_state, category, custom_icon, idempotency_request, transaction,
    },
};

const UNDO_WINDOW_SECONDS: i64 = 5;

// SeaORM 只负责数据库映射；仓储在这里集中实现事务边界、锁和错误脱敏，向应用层提供稳定 port。
pub struct SeaOrmLedgerRepository<C = SystemClock> {
    /// 连接池句柄可被多个请求共享；短生命周期事务在各用例中单独创建，不能跨请求复用。
    db: DatabaseConnection,
    /// 注入式时钟保证删除窗口、seed 与集成测试使用同一时间语义。
    clock: C,
}

impl SeaOrmLedgerRepository<SystemClock> {
    pub fn new(db: DatabaseConnection) -> Self {
        // 生产构造器固定系统时钟；测试和边界复现使用 with_clock 显式替换，避免全局时间状态。
        Self {
            db,
            clock: SystemClock,
        }
    }
}

impl<C> SeaOrmLedgerRepository<C> {
    pub fn with_clock(db: DatabaseConnection, clock: C) -> Self {
        Self { db, clock }
    }

    /// 在同一个可重复读快照中读取总览、分析和报告所需的全部事实。
    pub async fn analytics_facts(
        &self,
        period: Period,
        account_id: Option<Uuid>,
    ) -> Result<(OverviewFacts, DataRevision), AppError> {
        // 当前期、上一期、分类和修订号来自同一个可重复读快照，避免报表拼接到不同版本的数据。
        // 只读 Repeatable Read 保证本次查询内交易、分类与 revision 看见同一数据库版本；
        // 查询结束即提交释放快照，后续领域计算不占用连接或锁。
        let tx = self
            .db
            .begin_with_config(
                Some(IsolationLevel::RepeatableRead),
                Some(AccessMode::ReadOnly),
            )
            .await
            .map_err(database_error)?;
        let previous = period.previous();
        let models = transaction::Entity::find()
            .filter(transaction::Column::PendingDeleteUntil.is_null())
            .all(&tx)
            .await
            .map_err(database_error)?;
        let categories = category::Entity::find()
            .all(&tx)
            .await
            .map_err(database_error)?
            .into_iter()
            .map(|model| AnalyticsCategory {
                id: model.id,
                name: model.name,
                semantic_key: model.semantic_key,
            })
            .collect();
        let mut current = Vec::new();
        let mut prior = Vec::new();
        for model in models {
            if account_id
                .is_some_and(|id| model.account_id != id && model.target_account_id != Some(id))
            {
                continue;
            }
            let fact = AnalyticsTransaction {
                id: model.id,
                kind: match model.kind.as_str() {
                    "expense" => DomainTransactionKind::Expense,
                    "income" => DomainTransactionKind::Income,
                    _ => DomainTransactionKind::Transfer,
                },
                amount: model.amount,
                category_id: model.category_id,
                account_id: model.account_id,
                target_account_id: model.target_account_id,
                local_date: model.local_date,
            };
            if period.contains(model.local_date) {
                current.push(fact);
            } else if previous.contains(model.local_date) {
                prior.push(fact);
            }
        }
        let state = app_state::Entity::find_by_id(true)
            .one(&tx)
            .await
            .map_err(database_error)?
            .ok_or_else(|| AppError::new("app_state.missing"))?;
        tx.commit().await.map_err(database_error)?;
        Ok((
            OverviewFacts {
                period,
                current,
                previous: prior,
                categories,
            },
            DataRevision::new(state.data_revision),
        ))
    }
}

impl<C> HasClock for SeaOrmLedgerRepository<C>
where
    C: Clock,
{
    fn now(&self) -> crate::domain::UtcInstant {
        self.clock.now()
    }
}

#[async_trait]
impl<C> LedgerRepository for SeaOrmLedgerRepository<C>
where
    C: Clock,
{
    type Transaction = SeaOrmLedgerTransaction;

    async fn bootstrap(&self) -> Result<BootstrapSnapshot, AppError> {
        // 首屏所需的分类、账户、月份和修订号必须共同提交，客户端不会看到混合版本的启动数据。
        let transaction = self
            .db
            .begin_with_config(
                Some(IsolationLevel::RepeatableRead),
                Some(AccessMode::ReadOnly),
            )
            .await
            .map_err(database_error)?;
        let result = bootstrap_in_snapshot(&transaction, self.clock.now().to_rfc3339()).await;
        match result {
            Ok(snapshot) => transaction
                .commit()
                .await
                .map(|()| snapshot)
                .map_err(database_error),
            Err(error) => {
                let _ = transaction.rollback().await;
                Err(error)
            }
        }
    }

    async fn begin_write(&self) -> Result<Self::Transaction, AppError> {
        // 写事务的 commit/rollback 由应用服务统一控制，仓储绝不在单个插入方法中自行提交。
        self.db
            .begin()
            .await
            .map(SeaOrmLedgerTransaction)
            .map_err(database_error)
    }

    async fn begin_repeatable_read(&self) -> Result<Self::Transaction, AppError> {
        // 所有跨多表的读取都从此处获取只读快照，避免默认 Read Committed 在同一响应中混入新写入。
        self.db
            .begin_with_config(
                Some(IsolationLevel::RepeatableRead),
                Some(AccessMode::ReadOnly),
            )
            .await
            .map(SeaOrmLedgerTransaction)
            .map_err(database_error)
    }

    async fn list_transactions(
        &self,
        query: TransactionQuery,
    ) -> Result<TransactionPage, AppError> {
        // 读取使用只读 Repeatable Read 事务，确保列表内容与返回的 data_revision 相互对应。
        // query 已由应用层校验；仓储只负责将其解释为持久化筛选、稳定排序和分页边界。
        let tx = self.begin_repeatable_read().await?;
        let mut rows = transaction::Entity::find()
            .filter(transaction::Column::PendingDeleteUntil.is_null())
            .all(&tx.0)
            .await
            .map_err(database_error)?;
        let (start, end) = query
            .month
            .as_ref()
            .map(|m| {
                let start =
                    chrono::NaiveDate::from_ymd_opt(m.year, m.month, 1).expect("valid month");
                let end = if m.month == 12 {
                    chrono::NaiveDate::from_ymd_opt(m.year + 1, 1, 1).expect("valid year")
                } else {
                    chrono::NaiveDate::from_ymd_opt(m.year, m.month + 1, 1).expect("valid month")
                };
                (start, end)
            })
            .or_else(|| {
                query
                    .date_range
                    .as_ref()
                    .map(|r| (r.start, r.end.succ_opt().expect("valid date")))
            })
            .unwrap_or((chrono::NaiveDate::MIN, chrono::NaiveDate::MAX));
        rows.retain(|row| row.local_date >= start && row.local_date < end);
        if !query.kinds.is_empty() {
            rows.retain(|row| query.kinds.iter().any(|kind| kind.as_str() == row.kind));
        }
        if let Some(category) = query.category_id {
            rows.retain(|row| row.category_id == Some(category));
        }
        if let Some(account) = query.account_id {
            rows.retain(|row| row.account_id == account || row.target_account_id == Some(account));
        }
        if query.weekend_only {
            rows.retain(|row| {
                matches!(
                    row.local_date.weekday(),
                    chrono::Weekday::Sat | chrono::Weekday::Sun
                )
            });
        }
        rows.sort_by(|a, b| {
            (b.local_date, b.local_time, b.occurred_at, b.id).cmp(&(
                a.local_date,
                a.local_time,
                a.occurred_at,
                a.id,
            ))
        });
        if let Some(cursor) = query.cursor {
            rows.retain(|row| {
                (row.local_date, row.local_time, row.occurred_at, row.id)
                    < (
                        cursor.local_date,
                        cursor.local_time,
                        cursor.occurred_at,
                        cursor.id,
                    )
            });
        }
        let has_more = rows.len() > query.limit as usize;
        rows.truncate(query.limit as usize);
        let next_cursor = if has_more {
            rows.last().map(cursor_for_model).transpose()?
        } else {
            None
        };
        let state = app_state::Entity::find_by_id(true)
            .one(&tx.0)
            .await
            .map_err(database_error)?
            .ok_or_else(|| AppError::new("app_state.missing"))?;
        let result = TransactionPage {
            items: rows.into_iter().map(dto_from_model).collect(),
            next_cursor,
            data_revision: DataRevision::new(state.data_revision),
        };
        tx.0.commit().await.map_err(database_error)?;
        Ok(result)
    }

    async fn delete_transaction(
        &self,
        id: uuid::Uuid,
        now: crate::domain::UtcInstant,
        expected: DataRevision,
    ) -> Result<DeleteTransactionResult, AppError> {
        let tx = self.db.begin().await.map_err(database_error)?;
        let result = delete_in_transaction(&tx, id, now, expected).await;
        finish_transaction(tx, result).await
    }

    async fn restore_transaction(
        &self,
        id: uuid::Uuid,
        token: uuid::Uuid,
        now: crate::domain::UtcInstant,
        expected: DataRevision,
    ) -> Result<TransactionDto, AppError> {
        let tx = self.db.begin().await.map_err(database_error)?;
        let result = restore_in_transaction(&tx, id, token, now, expected).await;
        finish_transaction(tx, result).await
    }

    async fn cleanup_expired(&self, now: crate::domain::UtcInstant) -> Result<(), AppError> {
        // 永久删除交易和过期幂等记录放在同一事务，清理中途失败不会留下半完成状态。
        let tx = self.db.begin().await.map_err(database_error)?;
        let now = now.as_chrono().fixed_offset();
        transaction::Entity::delete_many()
            .filter(transaction::Column::PendingDeleteUntil.lte(now))
            .exec(&tx)
            .await
            .map_err(database_error)?;
        let cutoff = now - chrono::Duration::hours(24);
        idempotency_request::Entity::delete_many()
            .filter(idempotency_request::Column::Status.eq("completed"))
            .filter(idempotency_request::Column::CreatedAt.lt(cutoff))
            .exec(&tx)
            .await
            .map_err(database_error)?;
        tx.commit().await.map_err(database_error)
    }

    async fn analytics_facts(
        &self,
        period: Period,
        account_id: Option<Uuid>,
    ) -> Result<(OverviewFacts, DataRevision), AppError> {
        SeaOrmLedgerRepository::analytics_facts(self, period, account_id).await
    }
}

pub struct SeaOrmLedgerTransaction(DatabaseTransaction);

fn dto_from_model(model: transaction::Model) -> TransactionDto {
    TransactionDto {
        id: model.id,
        kind: match model.kind.as_str() {
            "expense" => TransactionKind::Expense,
            "income" => TransactionKind::Income,
            _ => TransactionKind::Transfer,
        },
        amount: model.amount.to_string(),
        merchant: model.merchant,
        category_id: model.category_id,
        account_id: model.account_id,
        target_account_id: model.target_account_id,
        occurred_at: model.occurred_at.to_rfc3339(),
        note: model.note,
    }
}

fn cursor_for_model(model: &transaction::Model) -> Result<String, AppError> {
    Ok(TransactionCursor {
        local_date: model.local_date,
        local_time: model.local_time,
        occurred_at: model.occurred_at,
        id: model.id,
    }
    .encode())
}

async fn delete_in_transaction(
    db: &DatabaseTransaction,
    id: uuid::Uuid,
    now: crate::domain::UtcInstant,
    expected: DataRevision,
) -> Result<DeleteTransactionResult, AppError> {
    // 先锁定全局修订号再锁交易行：并发写入只能有一个请求通过版本检查并递增修订号。
    let state = app_state_snapshot(
        db,
        "SELECT seed_version, data_revision FROM app_state WHERE singleton = TRUE FOR UPDATE",
    )
    .await?;
    if state.data_revision != expected {
        return Err(AppError::new("revision_conflict"));
    }
    let model = transaction::Entity::find_by_id(id)
        .lock_exclusive()
        .one(db)
        .await
        .map_err(database_error)?
        .ok_or_else(|| AppError::new("transaction.not_found"))?;
    if model.pending_delete_until.is_some() {
        return Err(AppError::new("transaction.already_deleted"));
    }
    let now = now.as_chrono().fixed_offset();
    let undo_until = now + chrono::Duration::seconds(UNDO_WINDOW_SECONDS);
    let token = uuid::Uuid::new_v4();
    let mut active: transaction::ActiveModel = model.clone().into();
    active.pending_delete_until = Set(Some(undo_until));
    active.deletion_token = Set(Some(token));
    active.updated_at = Set(now);
    active.update(db).await.map_err(database_error)?;
    let revision = increment_revision(db).await?;
    Ok(DeleteTransactionResult {
        transaction: dto_from_model(model),
        token,
        undo_until: undo_until.to_rfc3339(),
        data_revision: revision,
    })
}

async fn restore_in_transaction(
    db: &DatabaseTransaction,
    id: uuid::Uuid,
    token: uuid::Uuid,
    now: crate::domain::UtcInstant,
    expected: DataRevision,
) -> Result<TransactionDto, AppError> {
    // 恢复与软删除共享同一锁定/修订流程，保证撤销不会覆盖其他客户端已经提交的修改。
    let state = app_state_snapshot(
        db,
        "SELECT seed_version, data_revision FROM app_state WHERE singleton = TRUE FOR UPDATE",
    )
    .await?;
    if state.data_revision != expected {
        return Err(AppError::new("revision_conflict"));
    }
    let model = transaction::Entity::find_by_id(id)
        .lock_exclusive()
        .one(db)
        .await
        .map_err(database_error)?
        .ok_or_else(|| AppError::new("transaction.not_found"))?;
    let deadline = model
        .pending_delete_until
        .ok_or_else(|| AppError::new("restore_not_pending"))?;
    if model.deletion_token != Some(token) {
        return Err(AppError::new("restore_token_invalid"));
    }
    let now = now.as_chrono().fixed_offset();
    if now >= deadline {
        return Err(AppError::new("restore_expired"));
    }
    let mut active: transaction::ActiveModel = model.clone().into();
    active.pending_delete_until = Set(None);
    active.deletion_token = Set(None);
    active.updated_at = Set(now);
    active.update(db).await.map_err(database_error)?;
    increment_revision(db).await?;
    Ok(dto_from_model(model))
}

async fn increment_revision(db: &DatabaseTransaction) -> Result<DataRevision, AppError> {
    // 在数据库内原子递增修订号，避免并发写入因应用内读改写而丢失版本更新。
    let row = db.query_one(Statement::from_string(DbBackend::Postgres, "UPDATE app_state SET data_revision = data_revision + 1 WHERE singleton = TRUE RETURNING data_revision".to_owned())).await.map_err(database_error)?.ok_or_else(|| AppError::new("app_state.missing"))?;
    Ok(DataRevision::new(
        row.try_get_by_index(0).map_err(database_error)?,
    ))
}

async fn finish_transaction<T>(
    db: DatabaseTransaction,
    result: Result<T, AppError>,
) -> Result<T, AppError> {
    // 业务结果只有在 commit 成功后才返回；任何错误都回滚，避免调用方误以为写入已持久化。
    match result {
        Ok(value) => {
            db.commit().await.map_err(database_error)?;
            Ok(value)
        }
        Err(error) => {
            let _ = db.rollback().await;
            Err(error)
        }
    }
}

impl SeaOrmLedgerTransaction {
    pub async fn is_read_only(&self) -> Result<bool, AppError> {
        // 直接查询 PostgreSQL 事务状态，供应用层拒绝在只读快照中执行写入。
        let value = self
            .0
            .query_one(Statement::from_string(
                DbBackend::Postgres,
                "SHOW transaction_read_only".to_owned(),
            ))
            .await
            .map_err(database_error)?
            .ok_or_else(|| AppError::new("persistence.database_error"))?
            .try_get_by_index::<String>(0)
            .map_err(database_error)?;
        Ok(value == "on")
    }
}

#[async_trait]
impl LedgerTransaction for SeaOrmLedgerTransaction {
    async fn read_app_state(&mut self) -> Result<AppStateSnapshot, AppError> {
        app_state_snapshot(
            &self.0,
            "SELECT seed_version, data_revision FROM app_state WHERE singleton = TRUE",
        )
        .await
    }

    async fn lock_app_state(&mut self) -> Result<AppStateSnapshot, AppError> {
        app_state_snapshot(
            &self.0,
            "SELECT seed_version, data_revision FROM app_state WHERE singleton = TRUE FOR UPDATE",
        )
        .await
    }

    async fn increment_data_revision(&mut self) -> Result<DataRevision, AppError> {
        // 与专用删除/恢复路径使用同一原子更新语义，保证所有写入都产生单调递增的修订版本。
        let row = self
            .0
            .query_one(Statement::from_string(
                DbBackend::Postgres,
                "UPDATE app_state SET data_revision = data_revision + 1 WHERE singleton = TRUE RETURNING data_revision".to_owned(),
            ))
            .await
            .map_err(database_error)?
            .ok_or_else(|| AppError::new("app_state.missing"))?;
        Ok(DataRevision::new(
            row.try_get_by_index(0).map_err(database_error)?,
        ))
    }

    async fn find_idempotency(&mut self, key: &str) -> Result<Option<IdempotencyRecord>, AppError> {
        let Some(model) = idempotency_request::Entity::find_by_id(key.to_owned())
            .one(&self.0)
            .await
            .map_err(database_error)?
        else {
            return Ok(None);
        };
        let response = model
            .response
            .ok_or_else(|| AppError::new("persistence.database_error"))?;
        let result = serde_json::from_value(response)
            .map_err(|_| AppError::new("persistence.database_error"))?;
        Ok(Some(IdempotencyRecord {
            fingerprint: model.request_fingerprint,
            result,
            created_at: model.created_at.to_rfc3339(),
            expires_at: model.expires_at.to_rfc3339(),
        }))
    }

    async fn lock_references(
        &mut self,
        category_id: Option<uuid::Uuid>,
        account_id: uuid::Uuid,
        target_account_id: Option<uuid::Uuid>,
    ) -> Result<LockedReferences, AppError> {
        // 写入前锁定分类和账户，读取 active/type 的同时阻止并发停用或迁移造成校验竞态。
        let category = match category_id {
            Some(id) => category::Entity::find_by_id(id)
                .lock_exclusive()
                .one(&self.0)
                .await
                .map_err(database_error)?,
            None => None,
        };
        let account = account_label::Entity::find_by_id(account_id)
            .lock_exclusive()
            .one(&self.0)
            .await
            .map_err(database_error)?;
        let target = match target_account_id {
            Some(id) => account_label::Entity::find_by_id(id)
                .lock_exclusive()
                .one(&self.0)
                .await
                .map_err(database_error)?,
            None => None,
        };
        Ok(LockedReferences {
            category_kind: category.as_ref().map(|value| value.kind.clone()),
            category_active: category.as_ref().map(|value| value.active),
            account_active: account.is_some_and(|value| value.active),
            target_account_active: target.map(|value| value.active),
        })
    }

    async fn insert_transaction(&mut self, value: NewStoredTransaction) -> Result<(), AppError> {
        let occurred_at = chrono::DateTime::parse_from_rfc3339(&value.transaction.occurred_at)
            .map_err(|_| AppError::new("persistence.database_error"))?;
        let now = chrono::DateTime::parse_from_rfc3339(&value.now)
            .map_err(|_| AppError::new("persistence.database_error"))?;
        transaction::ActiveModel {
            id: Set(value.transaction.id),
            kind: Set(value.transaction.kind.as_str().to_owned()),
            amount: Set(value.amount),
            category_id: Set(value.transaction.category_id),
            account_id: Set(value.transaction.account_id),
            target_account_id: Set(value.transaction.target_account_id),
            merchant: Set(value.transaction.merchant),
            note: Set(value.transaction.note),
            occurred_at: Set(occurred_at),
            local_date: Set(value.local_date),
            local_time: Set(value.local_time),
            utc_offset_minutes: Set(value.utc_offset_minutes),
            pending_delete_until: Set(None),
            deletion_token: Set(None),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(&self.0)
        .await
        .map_err(database_error)?;
        Ok(())
    }

    async fn complete_idempotency(
        &mut self,
        key: &str,
        record: IdempotencyRecord,
    ) -> Result<(), AppError> {
        let completed_at = chrono::DateTime::parse_from_rfc3339(&record.created_at)
            .map_err(|_| AppError::new("persistence.database_error"))?;
        let expires_at = chrono::DateTime::parse_from_rfc3339(&record.expires_at)
            .map_err(|_| AppError::new("persistence.database_error"))?;
        let response = serde_json::to_value(record.result)
            .map_err(|_| AppError::new("persistence.database_error"))?;
        idempotency_request::ActiveModel {
            idempotency_key: Set(key.to_owned()),
            request_fingerprint: Set(record.fingerprint),
            status: Set("completed".to_owned()),
            response: Set(Some(response)),
            created_at: Set(completed_at),
            completed_at: Set(Some(completed_at)),
            expires_at: Set(expires_at),
        }
        .insert(&self.0)
        .await
        .map_err(database_error)?;
        Ok(())
    }

    async fn commit(self) -> Result<(), AppError> {
        self.0.commit().await.map_err(database_error)
    }

    async fn rollback(self) -> Result<(), AppError> {
        self.0.rollback().await.map_err(database_error)
    }

    async fn list_categories(&mut self) -> Result<Vec<CategoryDto>, AppError> {
        category::Entity::find()
            .order_by_asc(category::Column::SortOrder)
            .all(&self.0)
            .await
            .map(|rows| rows.into_iter().map(category_dto).collect())
            .map_err(database_error)
    }

    async fn list_accounts(&mut self) -> Result<Vec<AccountDto>, AppError> {
        account_label::Entity::find()
            .order_by_asc(account_label::Column::Name)
            .all(&self.0)
            .await
            .map(|rows| rows.into_iter().map(account_dto).collect())
            .map_err(database_error)
    }

    async fn insert_category(&mut self, input: CreateCategory) -> Result<CategoryDto, AppError> {
        crate::domain::Category::new_with_emoji(
            crate::domain::CategoryId::new(0),
            match input.kind.as_str() {
                "expense" => crate::domain::CategoryKind::Expense,
                "income" => crate::domain::CategoryKind::Income,
                _ => return Err(AppError::new("category.kind_invalid")),
            },
            &input.name,
            &input.emoji,
            &input.color,
            true,
            input.sort_order,
        )
        .map_err(|error| AppError::new(error.code()))?;
        let name = normalize_name(&input.name)
            .ok_or_else(|| AppError::new("label.name_length_invalid"))?;
        let kind = input.kind;
        let normalized_name = name.to_lowercase();
        if category::Entity::find()
            .filter(category::Column::NormalizedName.eq(normalized_name.clone()))
            .one(&self.0)
            .await
            .map_err(database_error)?
            .is_some()
        {
            return Err(AppError::new("label.name_conflict"));
        }
        let now = chrono::Utc::now().fixed_offset();
        let model = category::ActiveModel {
            id: Set(Uuid::new_v4()),
            name: Set(name),
            normalized_name: Set(normalized_name),
            kind: Set(kind),
            emoji: Set(input.emoji.trim().to_owned()),
            color: Set(input.color.trim().to_ascii_uppercase()),
            semantic_key: Set(input.semantic_key),
            sort_order: Set(input.sort_order),
            active: Set(true),
            created_at: Set(now),
            updated_at: Set(now),
        };
        model
            .insert(&self.0)
            .await
            .map(category_dto)
            .map_err(map_label_db_error)
    }

    async fn update_category_name(
        &mut self,
        id: Uuid,
        name: String,
    ) -> Result<CategoryDto, AppError> {
        let name =
            normalize_name(&name).ok_or_else(|| AppError::new("label.name_length_invalid"))?;
        let normalized = name.to_lowercase();
        if category::Entity::find()
            .filter(category::Column::NormalizedName.eq(normalized.clone()))
            .filter(category::Column::Id.ne(id))
            .one(&self.0)
            .await
            .map_err(database_error)?
            .is_some()
        {
            return Err(AppError::new("label.name_conflict"));
        }
        let model = category::Entity::find_by_id(id)
            .one(&self.0)
            .await
            .map_err(database_error)?
            .ok_or_else(|| AppError::new("category.not_found"))?;
        let mut active: category::ActiveModel = model.into();
        active.name = Set(name);
        active.normalized_name = Set(normalized);
        active.updated_at = Set(chrono::Utc::now().fixed_offset());
        active
            .update(&self.0)
            .await
            .map(category_dto)
            .map_err(map_label_db_error)
    }

    async fn update_category(
        &mut self,
        id: Uuid,
        name: Option<String>,
        emoji: Option<String>,
    ) -> Result<CategoryDto, AppError> {
        // 先读取目标行，确保“仅更新提供字段”保留未提供字段的原值，并把不存在分类统一映射为
        // 业务错误而非静默零更新。
        let model = category::Entity::find_by_id(id)
            .one(&self.0)
            .await
            .map_err(database_error)?
            .ok_or_else(|| AppError::new("category.not_found"))?;
        let mut active: category::ActiveModel = model.into();

        if let Some(raw_name) = name {
            // 名称分支复用既有规范化与跨分类唯一性检查，保证原子 PATCH 与旧重命名接口契约一致。
            let name = normalize_name(&raw_name)
                .ok_or_else(|| AppError::new("label.name_length_invalid"))?;
            let normalized = name.to_lowercase();
            if category::Entity::find()
                .filter(category::Column::NormalizedName.eq(normalized.clone()))
                .filter(category::Column::Id.ne(id))
                .one(&self.0)
                .await
                .map_err(database_error)?
                .is_some()
            {
                return Err(AppError::new("label.name_conflict"));
            }
            active.name = Set(name);
            active.normalized_name = Set(normalized);
        }
        if let Some(emoji) = emoji {
            // Emoji 是展示字段，按协议原样保存提供值；即使只改 Emoji 也必须更新时间戳。
            active.emoji = Set(emoji);
        }
        active.updated_at = Set(chrono::Utc::now().fixed_offset());
        active
            .update(&self.0)
            .await
            .map(category_dto)
            .map_err(map_label_db_error)
    }

    async fn set_category_active(
        &mut self,
        id: Uuid,
        active_value: bool,
    ) -> Result<CategoryDto, AppError> {
        let model = category::Entity::find_by_id(id)
            .one(&self.0)
            .await
            .map_err(database_error)?
            .ok_or_else(|| AppError::new("category.not_found"))?;
        let mut active: category::ActiveModel = model.into();
        active.active = Set(active_value);
        active.updated_at = Set(chrono::Utc::now().fixed_offset());
        active
            .update(&self.0)
            .await
            .map(category_dto)
            .map_err(database_error)
    }

    async fn reorder_categories(&mut self, ids: Vec<Uuid>) -> Result<Vec<CategoryDto>, AppError> {
        // 排序唯一约束可在本事务结束时检查，才允许先写入临时序号再重排，避免中间状态触发冲突。
        self.0
            .execute_unprepared("SET CONSTRAINTS categories_sort_order_key DEFERRED")
            .await
            .map_err(database_error)?;
        for (index, id) in ids.iter().enumerate() {
            let model = category::Entity::find_by_id(*id)
                .one(&self.0)
                .await
                .map_err(database_error)?
                .ok_or_else(|| AppError::new("category.not_found"))?;
            let mut active: category::ActiveModel = model.into();
            active.sort_order = Set(-((index as i32) + 1));
            active.updated_at = Set(chrono::Utc::now().fixed_offset());
            active.update(&self.0).await.map_err(database_error)?;
        }
        for (index, id) in ids.iter().enumerate() {
            let model = category::Entity::find_by_id(*id)
                .one(&self.0)
                .await
                .map_err(database_error)?
                .ok_or_else(|| AppError::new("category.not_found"))?;
            let mut active: category::ActiveModel = model.into();
            active.sort_order = Set(index as i32);
            active.updated_at = Set(chrono::Utc::now().fixed_offset());
            active.update(&self.0).await.map_err(database_error)?;
        }
        self.list_categories().await
    }

    async fn delete_category(&mut self, id: Uuid) -> Result<(), AppError> {
        let model = category::Entity::find_by_id(id)
            .one(&self.0)
            .await
            .map_err(database_error)?
            .ok_or_else(|| AppError::new("category.not_found"))?;
        if model.active {
            return Err(AppError::new("category.delete_requires_inactive"));
        }
        let count = transaction::Entity::find()
            .filter(transaction::Column::CategoryId.eq(id))
            .count(&self.0)
            .await
            .map_err(database_error)?;
        if count > 0 {
            return Err(AppError::new("category.in_use"));
        }
        category::Entity::delete_by_id(id)
            .exec(&self.0)
            .await
            .map_err(map_label_db_error)?;
        Ok(())
    }

    async fn migrate_category(&mut self, from: Uuid, to: Uuid) -> Result<(), AppError> {
        // 交易改指向与源分类删除共享调用方事务，任一步失败都会回滚，杜绝半完成迁移。
        let target = category::Entity::find_by_id(to)
            .one(&self.0)
            .await
            .map_err(database_error)?
            .ok_or_else(|| AppError::new("category.not_found"))?;
        let source = category::Entity::find_by_id(from)
            .one(&self.0)
            .await
            .map_err(database_error)?
            .ok_or_else(|| AppError::new("category.not_found"))?;
        if source.kind != target.kind {
            return Err(AppError::new("category.migration_kind_mismatch"));
        }
        transaction::Entity::update_many()
            .col_expr(transaction::Column::CategoryId, Expr::value(to))
            .filter(transaction::Column::CategoryId.eq(from))
            .exec(&self.0)
            .await
            .map_err(database_error)?;
        category::Entity::delete_by_id(from)
            .exec(&self.0)
            .await
            .map_err(map_label_db_error)?;
        Ok(())
    }

    async fn insert_account(&mut self, input: CreateAccount) -> Result<AccountDto, AppError> {
        let name = normalize_name(&input.name)
            .ok_or_else(|| AppError::new("label.name_length_invalid"))?;
        let normalized = name.to_lowercase();
        if account_label::Entity::find()
            .filter(account_label::Column::NormalizedName.eq(normalized.clone()))
            .one(&self.0)
            .await
            .map_err(database_error)?
            .is_some()
        {
            return Err(AppError::new("label.name_conflict"));
        }
        let now = chrono::Utc::now().fixed_offset();
        account_label::ActiveModel {
            id: Set(Uuid::new_v4()),
            name: Set(name),
            normalized_name: Set(normalized),
            active: Set(true),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(&self.0)
        .await
        .map(account_dto)
        .map_err(map_label_db_error)
    }

    async fn update_account_name(
        &mut self,
        id: Uuid,
        name: String,
    ) -> Result<AccountDto, AppError> {
        let name =
            normalize_name(&name).ok_or_else(|| AppError::new("label.name_length_invalid"))?;
        let normalized = name.to_lowercase();
        if account_label::Entity::find()
            .filter(account_label::Column::NormalizedName.eq(normalized.clone()))
            .filter(account_label::Column::Id.ne(id))
            .one(&self.0)
            .await
            .map_err(database_error)?
            .is_some()
        {
            return Err(AppError::new("label.name_conflict"));
        }
        let model = account_label::Entity::find_by_id(id)
            .one(&self.0)
            .await
            .map_err(database_error)?
            .ok_or_else(|| AppError::new("account.not_found"))?;
        let mut active: account_label::ActiveModel = model.into();
        active.name = Set(name);
        active.normalized_name = Set(normalized);
        active.updated_at = Set(chrono::Utc::now().fixed_offset());
        active
            .update(&self.0)
            .await
            .map(account_dto)
            .map_err(map_label_db_error)
    }

    async fn set_account_active(
        &mut self,
        id: Uuid,
        active_value: bool,
    ) -> Result<AccountDto, AppError> {
        let model = account_label::Entity::find_by_id(id)
            .one(&self.0)
            .await
            .map_err(database_error)?
            .ok_or_else(|| AppError::new("account.not_found"))?;
        let mut active: account_label::ActiveModel = model.into();
        active.active = Set(active_value);
        active.updated_at = Set(chrono::Utc::now().fixed_offset());
        active
            .update(&self.0)
            .await
            .map(account_dto)
            .map_err(database_error)
    }

    async fn insert_custom_icon(&mut self, emoji: String) -> Result<String, AppError> {
        // 唯一约束负责并发去重；服务层事务统一提交或回滚。
        if custom_icon::Entity::find()
            .filter(custom_icon::Column::Emoji.eq(emoji.clone()))
            .one(&self.0)
            .await
            .map_err(database_error)?
            .is_some()
        {
            return Err(AppError::new("custom_icon.duplicate"));
        }
        let now = chrono::Utc::now().fixed_offset();
        custom_icon::ActiveModel {
            id: Set(Uuid::new_v4()),
            emoji: Set(emoji.clone()),
            created_at: Set(now),
        }
        .insert(&self.0)
        .await
        .map(|_| emoji)
        .map_err(database_error)
    }
}

pub(crate) fn database_error(_: DbErr) -> AppError {
    // 不把 SQL、连接串或约束细节暴露给 API；内部日志可记录上下文，客户端只接收稳定错误码。
    AppError::new("persistence.database_error")
}

async fn bootstrap_in_snapshot(
    db: &DatabaseTransaction,
    server_time: String,
) -> Result<BootstrapSnapshot, AppError> {
    // 所有 bootstrap 查询由上层同一只读事务调用，保证首屏快照的字段彼此一致。
    let categories = category::Entity::find()
        .order_by_asc(category::Column::SortOrder)
        .all(db)
        .await
        .map_err(database_error)?
        .into_iter()
        .map(|model| CategoryDto {
            id: model.id,
            name: model.name,
            kind: model.kind,
            emoji: model.emoji,
            color: model.color,
            semantic_key: model.semantic_key,
            sort_order: model.sort_order,
            active: model.active,
        })
        .collect();
    let accounts = account_label::Entity::find()
        .order_by_asc(account_label::Column::Name)
        .all(db)
        .await
        .map_err(database_error)?
        .into_iter()
        .map(|model| AccountDto {
            id: model.id,
            name: model.name,
            active: model.active,
        })
        .collect();
    let custom_icons = custom_icon::Entity::find()
        .order_by_asc(custom_icon::Column::CreatedAt)
        .all(db)
        .await
        .map_err(database_error)?
        .into_iter()
        .map(|model| model.emoji)
        .collect();
    let months = db
        .query_all(Statement::from_string(
            DbBackend::Postgres,
            "SELECT DISTINCT to_char(local_date, 'YYYY-MM') AS month FROM transactions WHERE pending_delete_until IS NULL ORDER BY month DESC".to_owned(),
        ))
        .await
        .map_err(database_error)?
        .into_iter()
        .map(|row| row.try_get_by_index::<String>(0).map_err(database_error))
        .collect::<Result<Vec<_>, _>>()?;
    let state = app_state::Entity::find_by_id(true)
        .one(db)
        .await
        .map_err(database_error)?
        .ok_or_else(|| AppError::new("app_state.missing"))?;

    Ok(BootstrapSnapshot {
        categories,
        accounts,
        months,
        data_revision: DataRevision::new(state.data_revision),
        server_time,
        custom_icons,
    })
}

async fn app_state_snapshot(
    db: &DatabaseTransaction,
    sql: &str,
) -> Result<AppStateSnapshot, AppError> {
    let row = db
        .query_one(Statement::from_string(DbBackend::Postgres, sql.to_owned()))
        .await
        .map_err(database_error)?
        .ok_or_else(|| AppError::new("app_state.missing"))?;
    Ok(AppStateSnapshot {
        seed_version: row.try_get_by_index(0).map_err(database_error)?,
        data_revision: DataRevision::new(row.try_get_by_index(1).map_err(database_error)?),
    })
}

fn normalize_name(raw: &str) -> Option<String> {
    let name = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    (1..=40).contains(&name.chars().count()).then_some(name)
}

fn category_dto(model: category::Model) -> CategoryDto {
    CategoryDto {
        id: model.id,
        name: model.name,
        kind: model.kind,
        emoji: model.emoji,
        color: model.color,
        semantic_key: model.semantic_key,
        sort_order: model.sort_order,
        active: model.active,
    }
}
fn account_dto(model: account_label::Model) -> AccountDto {
    AccountDto {
        id: model.id,
        name: model.name,
        active: model.active,
    }
}
fn map_label_db_error(error: DbErr) -> AppError {
    if error.to_string().contains("normalized_name") {
        AppError::new("label.name_conflict")
    } else {
        database_error(error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{DateTime, FixedOffset, NaiveDate, NaiveTime};
    use rust_decimal::Decimal;

    fn model() -> transaction::Model {
        let offset = FixedOffset::east_opt(8 * 60 * 60).unwrap();
        let occurred_at = DateTime::parse_from_rfc3339("2026-08-27T12:30:00+08:00").unwrap();
        transaction::Model {
            id: Uuid::new_v4(),
            kind: "expense".to_owned(),
            amount: Decimal::new(1250, 2),
            category_id: Some(Uuid::new_v4()),
            account_id: Uuid::new_v4(),
            target_account_id: None,
            merchant: "午餐".to_owned(),
            note: "工作日".to_owned(),
            occurred_at,
            local_date: NaiveDate::from_ymd_opt(2026, 8, 27).unwrap(),
            local_time: NaiveTime::from_hms_opt(12, 30, 0).unwrap(),
            utc_offset_minutes: (offset.local_minus_utc() / 60) as i16,
            pending_delete_until: None,
            deletion_token: None,
            created_at: occurred_at,
            updated_at: occurred_at,
        }
    }

    #[test]
    fn maps_transaction_models_and_round_trips_cursor() {
        let row = model();
        let dto = dto_from_model(row.clone());
        assert_eq!(dto.kind, TransactionKind::Expense);
        assert_eq!(dto.amount, "12.50");
        assert_eq!(dto.merchant, "午餐");
        let encoded = cursor_for_model(&row).unwrap();
        let decoded = TransactionCursor::decode(&encoded).unwrap();
        assert_eq!(decoded.local_date, row.local_date);
        assert_eq!(decoded.local_time, row.local_time);
        assert_eq!(decoded.id, row.id);
    }

    #[test]
    fn normalizes_names_and_maps_label_constraint_errors() {
        assert_eq!(normalize_name("  A   B  ").as_deref(), Some("A B"));
        assert!(normalize_name("").is_none());
        assert!(normalize_name(&"x".repeat(41)).is_none());
        assert_eq!(
            map_label_db_error(DbErr::Custom("normalized_name conflict".into())).code(),
            "label.name_conflict"
        );
        assert_eq!(
            map_label_db_error(DbErr::Custom("other".into())).code(),
            "persistence.database_error"
        );
    }

    #[test]
    fn maps_category_and_account_models() {
        let now = chrono::Utc::now().fixed_offset();
        let id = Uuid::new_v4();
        let category = category_dto(category::Model {
            id,
            name: "餐饮".into(),
            normalized_name: "餐饮".into(),
            kind: "expense".into(),
            emoji: "🍜".into(),
            color: "#FFFFFF".into(),
            semantic_key: None,
            sort_order: 0,
            active: true,
            created_at: now,
            updated_at: now,
        });
        assert_eq!(category.id, id);
        assert!(category.active);
        let account = account_dto(account_label::Model {
            id,
            name: "现金".into(),
            normalized_name: "现金".into(),
            active: false,
            created_at: now,
            updated_at: now,
        });
        assert_eq!(account.name, "现金");
        assert!(!account.active);
    }
}
