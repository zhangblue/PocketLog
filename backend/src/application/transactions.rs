//! 交易用例与查询模型：负责输入规范化、幂等重放、引用锁定和事务提交顺序。

use std::marker::PhantomData;

use chrono::{DateTime, Datelike, FixedOffset};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    application::{
        AppError, DataRevision,
        ports::{LedgerRepository, LedgerTransaction},
    },
    domain::Money,
};

const IDEMPOTENCY_TTL_HOURS: i64 = 24;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct YearMonth {
    /// API 月份筛选的已校验表示；解析为真实日期后保存年/月，避免依赖字符串切片。
    pub year: i32,
    pub month: u32,
}

impl YearMonth {
    pub fn parse(value: &str) -> Result<Self, AppError> {
        // 借助 chrono 校验 1..=12 与日期有效性，错误统一转为稳定查询码，不回显用户原输入。
        let date = chrono::NaiveDate::parse_from_str(&format!("{value}-01"), "%Y-%m-%d")
            .map_err(|_| AppError::new("query.month_invalid"))?;
        Ok(Self {
            year: date.year(),
            month: date.month(),
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DateRange {
    /// 闭区间日期范围，与数据库中的 local_date 比较，语义不受数据库时区配置影响。
    pub start: chrono::NaiveDate,
    pub end: chrono::NaiveDate,
}

impl DateRange {
    pub fn new(start: &str, end: &str) -> Result<Self, AppError> {
        // 两端必须同时可解析且按时间正序；缺任一端的 API 参数会在 DTO 边界提前拒绝。
        let start = chrono::NaiveDate::parse_from_str(start, "%Y-%m-%d")
            .map_err(|_| AppError::new("query.date_invalid"))?;
        let end = chrono::NaiveDate::parse_from_str(end, "%Y-%m-%d")
            .map_err(|_| AppError::new("query.date_invalid"))?;
        if start > end {
            return Err(AppError::new("query.date_range_invalid"));
        }
        Ok(Self { start, end })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TransactionCursor {
    pub local_date: chrono::NaiveDate,
    pub local_time: chrono::NaiveTime,
    pub occurred_at: DateTime<FixedOffset>,
    pub id: Uuid,
}

impl TransactionCursor {
    pub fn encode(&self) -> String {
        // 游标包含本地日期/时间、实际时刻和 UUID；在同一数据版本或无并发变更时，作为稳定排序分页边界。
        let value = format!(
            "{}|{}|{}|{}",
            self.local_date,
            self.local_time,
            self.occurred_at.to_rfc3339(),
            self.id
        );
        value
            .as_bytes()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }
    pub fn decode(value: &str) -> Result<Self, AppError> {
        // 游标是编码后的不透明排序边界，不是安全凭据；严格要求四段且全部可解析，防止部分
        // 字段被忽略后跳过或重复记录。
        if !value.len().is_multiple_of(2) {
            return Err(AppError::new("query.cursor_invalid"));
        }
        let bytes = (0..value.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&value[i..i + 2], 16))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| AppError::new("query.cursor_invalid"))?;
        let raw = String::from_utf8(bytes).map_err(|_| AppError::new("query.cursor_invalid"))?;
        let mut parts = raw.split('|');
        let local_date =
            chrono::NaiveDate::parse_from_str(parts.next().unwrap_or_default(), "%Y-%m-%d")
                .map_err(|_| AppError::new("query.cursor_invalid"))?;
        let local_time =
            chrono::NaiveTime::parse_from_str(parts.next().unwrap_or_default(), "%H:%M:%S%.f")
                .map_err(|_| AppError::new("query.cursor_invalid"))?;
        let occurred_at = DateTime::parse_from_rfc3339(parts.next().unwrap_or_default())
            .map_err(|_| AppError::new("query.cursor_invalid"))?;
        let id = Uuid::parse_str(parts.next().unwrap_or_default())
            .map_err(|_| AppError::new("query.cursor_invalid"))?;
        if parts.next().is_some() {
            return Err(AppError::new("query.cursor_invalid"));
        }
        Ok(Self {
            local_date,
            local_time,
            occurred_at,
            id,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TransactionQuery {
    pub month: Option<YearMonth>,
    pub date_range: Option<DateRange>,
    pub kinds: Vec<TransactionKind>,
    pub category_id: Option<Uuid>,
    pub account_id: Option<Uuid>,
    pub weekend_only: bool,
    pub cursor: Option<TransactionCursor>,
    pub limit: u16,
}

impl Default for TransactionQuery {
    fn default() -> Self {
        Self {
            month: None,
            date_range: None,
            kinds: Vec::new(),
            category_id: None,
            account_id: None,
            weekend_only: false,
            cursor: None,
            limit: 50,
        }
    }
}
impl TransactionQuery {
    pub fn month(value: &str) -> Self {
        Self {
            month: Some(YearMonth::parse(value).expect("valid month")),
            ..Self::default()
        }
    }
    pub fn date_range(mut self, value: DateRange) -> Self {
        self.date_range = Some(value);
        self
    }
    pub fn category(mut self, value: Uuid) -> Self {
        self.category_id = Some(value);
        self
    }
    pub fn account(mut self, value: Uuid) -> Self {
        self.account_id = Some(value);
        self
    }
    pub fn kinds(mut self, value: Vec<TransactionKind>) -> Self {
        self.kinds = value;
        self
    }
    pub fn weekend_only(mut self) -> Self {
        self.weekend_only = true;
        self
    }
    pub fn after(mut self, value: String) -> Self {
        self.cursor = Some(TransactionCursor::decode(&value).expect("valid cursor"));
        self
    }
    pub fn limit(mut self, value: u16) -> Self {
        self.limit = value;
        self
    }
    fn validate(&self) -> Result<(), AppError> {
        // 把可组合的筛选限制放在查询模型中，使 HTTP、洞察下钻等不同调用者共享相同语义。
        if !(1..=100).contains(&self.limit) {
            return Err(AppError::new("query.limit_invalid"));
        }
        if self.month.is_some() && self.date_range.is_some() {
            return Err(AppError::new("query.date_filters_mutually_exclusive"));
        }
        if self.weekend_only
            && (self.kinds.is_empty()
                || self
                    .kinds
                    .iter()
                    .any(|kind| *kind != TransactionKind::Expense))
        {
            return Err(AppError::new("query.weekend_requires_expense"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TransactionPage {
    pub items: Vec<TransactionDto>,
    pub next_cursor: Option<String>,
    pub data_revision: DataRevision,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeleteTransactionResult {
    pub transaction: TransactionDto,
    pub token: Uuid,
    pub undo_until: String,
    pub data_revision: DataRevision,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RestoreTransactionResult {
    pub transaction: TransactionDto,
    pub data_revision: DataRevision,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransactionKind {
    Expense,
    Income,
    Transfer,
}

impl TransactionKind {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Expense => "expense",
            Self::Income => "income",
            Self::Transfer => "transfer",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CreateTransaction {
    /// 应用层接收的创建命令。字符串金额和时间在事务开始前规范化，减少持锁时间。
    pub kind: TransactionKind,
    pub amount: String,
    pub merchant: String,
    pub category_id: Option<Uuid>,
    pub account_id: Uuid,
    pub target_account_id: Option<Uuid>,
    pub occurred_at: String,
    pub note: String,
}

impl CreateTransaction {
    pub fn expense(
        amount: impl Into<String>,
        merchant: impl Into<String>,
        category_id: Uuid,
        account_id: Uuid,
        occurred_at: impl Into<String>,
        note: impl Into<String>,
    ) -> Result<Self, AppError> {
        let input = Self {
            kind: TransactionKind::Expense,
            amount: amount.into(),
            merchant: merchant.into(),
            category_id: Some(category_id),
            account_id,
            target_account_id: None,
            occurred_at: occurred_at.into(),
            note: note.into(),
        };
        input.validate().map(|_| input)
    }

    fn validate(&self) -> Result<(Money, DateTime<FixedOffset>, String, String), AppError> {
        // 此校验与领域交易形状保持同一约束，但输出已裁剪的名称/备注和精确值，供指纹、入库
        // 与返回 DTO 复用；失败时尚未开始数据库事务。
        let amount = Money::parse(&self.amount).map_err(|error| AppError::new(error.code()))?;
        let merchant = self.merchant.trim().to_owned();
        if !(1..=120).contains(&merchant.chars().count()) {
            return Err(AppError::new("transaction.name_length_invalid"));
        }
        let note = self.note.trim().to_owned();
        if note.chars().count() > 1000 {
            return Err(AppError::new("transaction.note_length_invalid"));
        }
        let occurred_at = DateTime::parse_from_rfc3339(&self.occurred_at)
            .map_err(|_| AppError::new("time.invalid"))?;
        if occurred_at.offset().local_minus_utc().abs() > 14 * 60 * 60 {
            return Err(AppError::new("time.offset_out_of_range"));
        }
        match self.kind {
            TransactionKind::Expense | TransactionKind::Income if self.category_id.is_none() => {
                return Err(AppError::new("transaction.category_required"));
            }
            TransactionKind::Expense | TransactionKind::Income
                if self.target_account_id.is_some() =>
            {
                return Err(AppError::new("transaction.destination_account_unexpected"));
            }
            TransactionKind::Transfer if self.category_id.is_some() => {
                return Err(AppError::new("transaction.transfer_has_category"));
            }
            TransactionKind::Transfer if self.target_account_id.is_none() => {
                return Err(AppError::new("transaction.destination_account_required"));
            }
            TransactionKind::Transfer if self.target_account_id == Some(self.account_id) => {
                return Err(AppError::new("transaction.accounts_must_differ"));
            }
            _ => {}
        }
        Ok((amount, occurred_at, merchant, note))
    }

    fn fingerprint(
        &self,
        amount: &Money,
        occurred_at: &DateTime<FixedOffset>,
        merchant: &str,
        note: &str,
    ) -> String {
        // 指纹只由规范化后的业务字段组成；相同幂等键重试时空白差异不会被当成另一笔交易。
        format!(
            "{}|{}|{}|{:?}|{}|{:?}|{}|{}",
            self.kind.as_str(),
            amount.to_api_string(),
            merchant,
            self.category_id,
            self.account_id,
            self.target_account_id,
            occurred_at.to_rfc3339(),
            note
        )
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IdempotencyKey(String);

impl IdempotencyKey {
    pub fn new(value: impl Into<String>) -> Result<Self, AppError> {
        // 幂等键由客户端复用；长度约束避免把任意大字符串带入索引和事务。
        let value = value.into();
        if value.trim().is_empty() || value.len() > 200 {
            return Err(AppError::new("idempotency_key_invalid"));
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TransactionDto {
    pub id: Uuid,
    pub kind: TransactionKind,
    pub amount: String,
    pub merchant: String,
    pub category_id: Option<Uuid>,
    pub account_id: Uuid,
    pub target_account_id: Option<Uuid>,
    pub occurred_at: String,
    pub note: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CreateTransactionResult {
    pub transaction: TransactionDto,
    pub data_revision: DataRevision,
}

#[derive(Clone, Debug)]
pub struct IdempotencyRecord {
    /// 数据库保存的成功响应快照与过期时间；命中后直接重放，避免重试产生第二笔账。
    pub fingerprint: String,
    pub result: CreateTransactionResult,
    pub created_at: String,
    pub expires_at: String,
}

#[derive(Clone, Debug)]
pub struct LockedReferences {
    /// 写事务中 `FOR UPDATE` 读取到的标签状态，校验结束前阻止并发停用/迁移改变引用含义。
    pub category_kind: Option<String>,
    pub category_active: Option<bool>,
    pub account_active: bool,
    pub target_account_active: Option<bool>,
}

#[derive(Clone, Debug)]
pub struct NewStoredTransaction {
    /// 已完成输入校验、等待仓储插入的完整事实。local_* 与偏移单独持久化用于自然月统计。
    pub transaction: TransactionDto,
    pub amount: Decimal,
    pub local_date: chrono::NaiveDate,
    pub local_time: chrono::NaiveTime,
    pub utc_offset_minutes: i16,
    pub now: String,
}

pub struct TransactionService<R> {
    repository: R,
    _marker: PhantomData<R>,
}

impl<R> TransactionService<R> {
    pub fn new(repository: R) -> Self {
        Self {
            repository,
            _marker: PhantomData,
        }
    }
}

impl<R> TransactionService<R>
where
    R: LedgerRepository + Sync + HasClock,
    R::Transaction: LedgerTransaction,
{
    pub async fn create(
        &self,
        input: CreateTransaction,
        expected: DataRevision,
        key: IdempotencyKey,
    ) -> Result<CreateTransactionResult, AppError> {
        // 先规范化金额、名称和本地时间，再计算指纹；同一幂等键必须代表完全相同的请求。
        let (amount, occurred_at, merchant, note) = input.validate()?;
        let fingerprint = input.fingerprint(&amount, &occurred_at, &merchant, &note);
        let now = self.now()?;
        let expires_at = now
            .clone()
            .checked_add(chrono::Duration::hours(IDEMPOTENCY_TTL_HOURS))
            .map_err(|_| AppError::new("time.out_of_range"))?
            .to_rfc3339();
        // 校验与时间计算全部在开事务前完成，之后只执行幂等检查、乐观并发检查、引用锁定、
        // 插入与提交这条最短原子路径，降低长事务阻塞其他写入的概率。
        let mut tx = self.repository.begin_write().await?;
        // 事务内先查幂等记录，重复提交直接重放原结果，不重复写入交易。
        if let Some(record) = tx.find_idempotency(key.as_str()).await? {
            return replay(record, &fingerprint);
        }
        let state = tx.lock_app_state().await?;
        if let Some(record) = tx.find_idempotency(key.as_str()).await? {
            return replay(record, &fingerprint);
        }
        if state.data_revision != expected {
            let _ = tx.rollback().await;
            return Err(AppError::new("revision_conflict"));
        }
        let references = tx
            // 锁定分类和账户引用，确保校验通过后不会在提交前被停用或迁移。
            .lock_references(input.category_id, input.account_id, input.target_account_id)
            .await?;
        validate_references(&input, &references)?;
        let transaction = TransactionDto {
            id: Uuid::new_v4(),
            kind: input.kind,
            amount: amount.to_api_string(),
            merchant,
            category_id: input.category_id,
            account_id: input.account_id,
            target_account_id: input.target_account_id,
            occurred_at: occurred_at.to_rfc3339(),
            note,
        };
        let result = CreateTransactionResult {
            transaction: transaction.clone(),
            data_revision: DataRevision::new(expected.value() + 1),
        };
        let stored = NewStoredTransaction {
            transaction,
            amount: Decimal::from_str_exact(&result.transaction.amount)
                .map_err(|_| AppError::new("amount.invalid"))?,
            local_date: occurred_at.date_naive(),
            local_time: occurred_at.time(),
            utc_offset_minutes: (occurred_at.offset().local_minus_utc() / 60) as i16,
            now: now.to_rfc3339(),
        };
        // 本地日期/时间与偏移量作为事实保存，月度统计不依赖数据库服务器时区。
        tx.insert_transaction(stored).await?;
        tx.complete_idempotency(
            key.as_str(),
            IdempotencyRecord {
                fingerprint,
                result: result.clone(),
                created_at: now.to_rfc3339(),
                expires_at,
            },
        )
        .await?;
        // 交易、幂等记录和修订版本必须同提交；任一步失败都不应留下半完成写入。
        let revision = tx.increment_data_revision().await?;
        if revision != result.data_revision {
            let _ = tx.rollback().await;
            return Err(AppError::new("persistence.database_error"));
        }
        tx.commit().await?;
        Ok(result)
    }

    pub async fn list(&self, query: TransactionQuery) -> Result<TransactionPage, AppError> {
        query.validate()?;
        self.repository.list_transactions(query).await
    }

    pub async fn delete(
        &self,
        id: Uuid,
        expected: DataRevision,
    ) -> Result<DeleteTransactionResult, AppError> {
        self.repository
            .delete_transaction(id, self.repository.now(), expected)
            .await
    }

    pub async fn restore(
        &self,
        id: Uuid,
        token: Uuid,
        expected: DataRevision,
    ) -> Result<RestoreTransactionResult, AppError> {
        let transaction = self
            .repository
            .restore_transaction(id, token, self.repository.now(), expected)
            .await?;
        Ok(RestoreTransactionResult {
            transaction,
            data_revision: DataRevision::new(expected.value() + 1),
        })
    }

    pub async fn cleanup(&self) -> Result<(), AppError> {
        self.repository.cleanup_expired(self.repository.now()).await
    }

    fn now(&self) -> Result<crate::domain::UtcInstant, AppError>
    where
        R: HasClock,
    {
        Ok(self.repository.now())
    }
}

pub trait HasClock {
    /// 把“当前时间”从用例依赖中抽象出来；生产实现读系统 UTC，测试实现可固定删除/幂等边界。
    fn now(&self) -> crate::domain::UtcInstant;
}

fn replay(
    record: IdempotencyRecord,
    fingerprint: &str,
) -> Result<CreateTransactionResult, AppError> {
    // 只允许同一业务指纹重放；键被复用到另一笔交易时明确报错。
    if record.fingerprint == fingerprint {
        Ok(record.result)
    } else {
        Err(AppError::new("idempotency_key_reused"))
    }
}

fn validate_references(
    input: &CreateTransaction,
    references: &LockedReferences,
) -> Result<(), AppError> {
    if !references.account_active {
        return Err(AppError::new("transaction.account_inactive"));
    }
    if input.target_account_id.is_some() && references.target_account_active != Some(true) {
        return Err(AppError::new("transaction.destination_account_inactive"));
    }
    match input.kind {
        TransactionKind::Expense if references.category_active != Some(true) => {
            Err(AppError::new("transaction.category_inactive"))
        }
        TransactionKind::Income if references.category_active != Some(true) => {
            Err(AppError::new("transaction.category_inactive"))
        }
        TransactionKind::Expense if references.category_kind.as_deref() != Some("expense") => {
            Err(AppError::new("transaction.category_kind_mismatch"))
        }
        TransactionKind::Income if references.category_kind.as_deref() != Some("income") => {
            Err(AppError::new("transaction.category_kind_mismatch"))
        }
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn expense() -> CreateTransaction {
        CreateTransaction::expense(
            "12.34",
            "餐饮",
            Uuid::new_v4(),
            Uuid::new_v4(),
            "2026-08-01T12:00:00+08:00",
            "备注",
        )
        .unwrap()
    }

    #[test]
    fn query_validation_rejects_conflicting_and_invalid_filters() {
        assert_eq!(
            YearMonth::parse("2026-13").unwrap_err().code(),
            "query.month_invalid"
        );
        assert_eq!(
            DateRange::new("2026-08-02", "2026-08-01")
                .unwrap_err()
                .code(),
            "query.date_range_invalid"
        );
        let query = TransactionQuery {
            limit: 0,
            ..TransactionQuery::default()
        };
        assert_eq!(query.validate().unwrap_err().code(), "query.limit_invalid");
        let mut query = TransactionQuery::month("2026-08");
        query.date_range = Some(DateRange::new("2026-08-01", "2026-08-02").unwrap());
        assert_eq!(
            query.validate().unwrap_err().code(),
            "query.date_filters_mutually_exclusive"
        );
        let query = TransactionQuery {
            weekend_only: true,
            kinds: vec![TransactionKind::Income],
            ..TransactionQuery::default()
        };
        assert_eq!(
            query.validate().unwrap_err().code(),
            "query.weekend_requires_expense"
        );
    }

    #[test]
    fn cursor_round_trip_and_invalid_values() {
        let cursor = TransactionCursor {
            local_date: chrono::NaiveDate::from_ymd_opt(2026, 8, 1).unwrap(),
            local_time: chrono::NaiveTime::from_hms_opt(12, 0, 0).unwrap(),
            occurred_at: DateTime::parse_from_rfc3339("2026-08-01T12:00:00+08:00").unwrap(),
            id: Uuid::new_v4(),
        };
        assert_eq!(TransactionCursor::decode(&cursor.encode()).unwrap(), cursor);
        assert_eq!(
            TransactionCursor::decode("f").unwrap_err().code(),
            "query.cursor_invalid"
        );
        assert_eq!(
            TransactionCursor::decode("zz").unwrap_err().code(),
            "query.cursor_invalid"
        );
    }

    #[test]
    fn create_validation_and_reference_errors_are_explicit() {
        let mut input = expense();
        input.merchant = " ".into();
        assert_eq!(
            input.validate().unwrap_err().code(),
            "transaction.name_length_invalid"
        );
        let input = expense();
        assert_eq!(
            validate_references(
                &input,
                &LockedReferences {
                    category_kind: Some("income".into()),
                    category_active: Some(true),
                    account_active: true,
                    target_account_active: None
                }
            )
            .unwrap_err()
            .code(),
            "transaction.category_kind_mismatch"
        );
        assert_eq!(
            validate_references(
                &input,
                &LockedReferences {
                    category_kind: Some("expense".into()),
                    category_active: Some(true),
                    account_active: false,
                    target_account_active: None
                }
            )
            .unwrap_err()
            .code(),
            "transaction.account_inactive"
        );
    }

    #[test]
    fn idempotency_key_and_replay_enforce_contract() {
        assert!(IdempotencyKey::new(" ").is_err());
        let key = IdempotencyKey::new("entry-1").unwrap();
        assert_eq!(key.as_str(), "entry-1");
        let result = CreateTransactionResult {
            transaction: TransactionDto {
                id: Uuid::new_v4(),
                kind: TransactionKind::Expense,
                amount: "1.00".into(),
                merchant: "x".into(),
                category_id: None,
                account_id: Uuid::new_v4(),
                target_account_id: None,
                occurred_at: "2026-08-01T00:00:00+00:00".into(),
                note: String::new(),
            },
            data_revision: DataRevision::new(1),
        };
        let record = IdempotencyRecord {
            fingerprint: "fp".into(),
            result: result.clone(),
            created_at: String::new(),
            expires_at: String::new(),
        };
        assert_eq!(replay(record.clone(), "fp").unwrap(), result);
        assert_eq!(
            replay(record, "other").unwrap_err().code(),
            "idempotency_key_reused"
        );
    }
}
