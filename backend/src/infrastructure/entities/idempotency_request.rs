//! `idempotency_requests` 表映射。
//!
//! 该表为写接口提供幂等保障：相同的幂等键与请求指纹在成功后可重放原响应，在处理中则可
//! 拦截并发重复提交，从而避免前端重试导致重复记账。

use sea_orm::entity::prelude::*;

// 幂等请求持久化请求指纹与完成响应，重试时可复用原响应而不重复写入账本。
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "idempotency_requests")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub idempotency_key: String,
    /// 由应用层按关键请求字段计算，防止相同幂等键被不同内容复用。
    pub request_fingerprint: String,
    /// `pending` 表示事务尚未产出可重放结果，`completed` 表示响应已可安全复用。
    pub status: String,
    pub response: Option<Json>,
    pub created_at: DateTimeWithTimeZone,
    pub completed_at: Option<DateTimeWithTimeZone>,
    pub expires_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
