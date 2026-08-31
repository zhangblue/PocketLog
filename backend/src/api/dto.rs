//! HTTP DTO 只负责协议字段与领域查询类型之间的转换。
//!
//! 把格式校验集中在这里，可以让处理器保持编排职责，并确保所有入口使用同一套
//! 月份、日期范围、修订版本和幂等键错误码。

use crate::application::{
    dto::{AccountDto, BootstrapSnapshot, CategoryDto, DataRevision},
    transactions::{
        CreateTransaction, DateRange, IdempotencyKey, TransactionDto, TransactionKind,
        TransactionPage, TransactionQuery, YearMonth,
    },
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTransactionRequest {
    /// 浏览器 JSON 的 camelCase 形状；转换后立即交给应用命令，HTTP 字段名不会渗入业务层。
    pub kind: TransactionKind,
    pub amount: String,
    pub merchant: String,
    pub category_id: Option<Uuid>,
    pub account_id: Uuid,
    pub target_account_id: Option<Uuid>,
    pub occurred_at: String,
    #[serde(default)]
    pub note: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelPatch {
    /// 分类与账户共用的可选名称；缺失时由路由保留现有值，而不是写入空字符串。
    pub name: Option<String>,
    /// Emoji 仅适用于分类 PATCH。保留在协议 DTO 中可避免路由遗漏客户端传入的字段。
    pub emoji: Option<String>,
    /// 启停是独立的生命周期命令，路由必须优先将它分派到专用服务分支。
    pub active: Option<bool>,
}
impl CreateTransactionRequest {
    pub fn into_domain(self) -> CreateTransaction {
        // 缺失备注归一为空字符串，后续应用层统一 trim/长度校验，避免 Option 在写入链路中分叉。
        CreateTransaction {
            kind: self.kind,
            amount: self.amount,
            merchant: self.merchant,
            category_id: self.category_id,
            account_id: self.account_id,
            target_account_id: self.target_account_id,
            occurred_at: self.occurred_at,
            note: self.note,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionQueryParams {
    /// URL 查询参数的宽松接收模型；互斥范围、游标和限额在 into_domain 中收敛为严格查询对象。
    pub month: Option<String>,
    pub start: Option<String>,
    pub end: Option<String>,
    pub kind: Option<Vec<TransactionKind>>,
    pub category_id: Option<Uuid>,
    pub account_id: Option<Uuid>,
    pub weekend_only: Option<bool>,
    pub cursor: Option<String>,
    pub limit: Option<u16>,
}
impl TransactionQueryParams {
    pub fn into_domain(self) -> Result<TransactionQuery, crate::application::AppError> {
        // API 解析按“原始参数 -> 强类型 -> 查询模型校验”三层推进，任何非法组合都在访问数据库前返回。
        let mut q = TransactionQuery::default();
        if let Some(month) = self.month {
            q.month = Some(YearMonth::parse(&month)?);
        }
        if self.start.is_some() || self.end.is_some() {
            q.date_range = Some(DateRange::new(
                self.start.as_deref().unwrap_or(""),
                self.end.as_deref().unwrap_or(""),
            )?);
        }
        q.kinds = self.kind.unwrap_or_default();
        q.category_id = self.category_id;
        q.account_id = self.account_id;
        q.weekend_only = self.weekend_only.unwrap_or(false);
        if let Some(c) = self.cursor {
            q.cursor = Some(crate::application::transactions::TransactionCursor::decode(
                &c,
            )?);
        }
        if let Some(l) = self.limit {
            q.limit = l;
        }
        Ok(q)
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationResponse<T: Serialize> {
    pub data: T,
    pub data_revision: DataRevision,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionsResponse {
    pub items: Vec<TransactionDto>,
    pub next_cursor: Option<String>,
    pub data_revision: DataRevision,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapResponse {
    pub categories: Vec<CategoryDto>,
    pub accounts: Vec<AccountDto>,
    pub months: Vec<String>,
    pub data_revision: DataRevision,
    pub server_time: String,
    pub custom_icons: Vec<String>,
}
impl From<BootstrapSnapshot> for BootstrapResponse {
    fn from(v: BootstrapSnapshot) -> Self {
        Self {
            categories: v.categories,
            accounts: v.accounts,
            months: v.months,
            data_revision: v.data_revision,
            server_time: v.server_time,
            custom_icons: v.custom_icons,
        }
    }
}
impl From<TransactionPage> for TransactionsResponse {
    fn from(v: TransactionPage) -> Self {
        Self {
            items: v.items,
            next_cursor: v.next_cursor,
            data_revision: v.data_revision,
        }
    }
}
pub fn revision(
    headers: &axum::http::HeaderMap,
) -> Result<DataRevision, crate::application::AppError> {
    // 写操作必须携带客户端所见的数据修订版本；缺失或无法解析时拒绝请求，避免
    // 把旧页面的修改静默覆盖到最新账本上。
    headers
        .get("if-match")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim_matches('"').parse::<i64>().ok())
        .map(DataRevision::new)
        .ok_or_else(|| crate::application::AppError::new("revision_header_invalid"))
}
pub fn idempotency(
    headers: &axum::http::HeaderMap,
) -> Result<IdempotencyKey, crate::application::AppError> {
    // 幂等键由请求头承载，保证重试同一个写请求时可以由应用层识别，而不是重复记账。
    headers
        .get("idempotency-key")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned)
        .ok_or_else(|| crate::application::AppError::new("idempotency_key_missing"))
        .and_then(IdempotencyKey::new)
}
pub fn parse_period(
    month: Option<String>,
    start: Option<String>,
    end: Option<String>,
) -> Result<crate::domain::analytics::Period, crate::application::AppError> {
    // 月份和自定义区间表达的是两种互斥查询语义；在 API 边界拒绝混用，避免不同
    // 客户端对同一请求得出不同统计周期。
    if month.is_some() && (start.is_some() || end.is_some()) {
        return Err(crate::application::AppError::new(
            "query.date_filters_mutually_exclusive",
        ));
    }
    if let Some(m) = month {
        let y = YearMonth::parse(&m)?;
        return crate::domain::analytics::Period::month(y.year, y.month)
            .ok_or_else(|| crate::application::AppError::new("query.month_invalid"));
    }
    let (s, e) = (
        start.ok_or_else(|| crate::application::AppError::new("query.date_invalid"))?,
        end.ok_or_else(|| crate::application::AppError::new("query.date_invalid"))?,
    );
    let r = DateRange::new(&s, &e)?;
    crate::domain::analytics::Period::new(r.start, r.end)
        .ok_or_else(|| crate::application::AppError::new("query.date_range_invalid"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderMap, HeaderValue};

    #[test]
    fn create_request_deserializes_and_preserves_optional_fields() {
        let request: CreateTransactionRequest = serde_json::from_value(serde_json::json!({
            "kind": "expense", "amount": "12.34", "merchant": "coffee",
            "categoryId": "00000000-0000-0000-0000-000000000001",
            "accountId": "00000000-0000-0000-0000-000000000002",
            "occurredAt": "2026-08-01T09:00:00+08:00"
        }))
        .unwrap();
        let value = request.into_domain();
        assert_eq!(value.amount, "12.34");
        assert_eq!(value.merchant, "coffee");
        assert_eq!(value.note, "");
        assert!(value.category_id.is_some());
        assert!(value.target_account_id.is_none());
    }

    #[test]
    fn transaction_query_parses_valid_values_and_rejects_invalid_combinations() {
        let value: TransactionQueryParams = serde_json::from_value(serde_json::json!({
            "month": "2026-08", "kind": ["expense"], "weekendOnly": true, "limit": 20
        }))
        .unwrap();
        let query = value.into_domain().unwrap();
        let month = query.month.unwrap();
        assert_eq!((month.year, month.month), (2026, 8));
        assert!(query.weekend_only);
        assert_eq!(query.limit, 20);

        let range_without_end: TransactionQueryParams =
            serde_json::from_value(serde_json::json!({"start":"2026-08-01"})).unwrap();
        assert_eq!(
            range_without_end.into_domain().unwrap_err().code(),
            "query.date_invalid"
        );
        let invalid_cursor: TransactionQueryParams =
            serde_json::from_value(serde_json::json!({"cursor":"bad"})).unwrap();
        assert_eq!(
            invalid_cursor.into_domain().unwrap_err().code(),
            "query.cursor_invalid"
        );
    }

    #[test]
    fn revision_and_idempotency_headers_require_valid_values() {
        let mut headers = HeaderMap::new();
        assert_eq!(
            revision(&headers).unwrap_err().code(),
            "revision_header_invalid"
        );
        assert_eq!(
            idempotency(&headers).unwrap_err().code(),
            "idempotency_key_missing"
        );
        headers.insert("if-match", HeaderValue::from_static("\"7\""));
        headers.insert("idempotency-key", HeaderValue::from_static("request-7"));
        assert_eq!(revision(&headers).unwrap().value(), 7);
        assert_eq!(idempotency(&headers).unwrap().as_str(), "request-7");
    }

    #[test]
    fn parse_period_handles_month_custom_range_and_invalid_inputs() {
        let month = parse_period(Some("2026-02".into()), None, None).unwrap();
        assert_eq!(month.start.to_string(), "2026-02-01");
        assert_eq!(month.end.to_string(), "2026-02-28");
        let range =
            parse_period(None, Some("2026-08-01".into()), Some("2026-08-03".into())).unwrap();
        assert_eq!(range.days(), 3);
        assert_eq!(
            parse_period(Some("2026-08".into()), Some("2026-08-01".into()), None)
                .unwrap_err()
                .code(),
            "query.date_filters_mutually_exclusive"
        );
        assert_eq!(
            parse_period(None, Some("nope".into()), Some("2026-08-03".into()))
                .unwrap_err()
                .code(),
            "query.date_invalid"
        );
    }
}
