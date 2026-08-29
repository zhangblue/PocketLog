//! `transactions` 表映射。
//!
//! 交易表同时保存 UTC 时间和用户输入时区下的本地日期/时间，用于兼顾精确排序与自然月、
//! 周末等本地日历统计。软删除相关字段也保存在这里，配合后台清理任务实现撤销窗口。

use sea_orm::entity::prelude::*;

// 本地日期、时间和偏移与 UTC 时间并存，保证自然日统计不受服务进程时区影响。
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "transactions")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    /// `expense` / `income` / `transfer`，与数据库检查约束共同定义交易形状。
    pub kind: String,
    #[sea_orm(column_type = "Decimal(Some((18, 2)))")]
    pub amount: Decimal,
    pub category_id: Option<Uuid>,
    /// 主账户始终存在；对转账而言它表示转出账户。
    pub account_id: Uuid,
    /// 仅转账使用，表示转入账户；收入和支出必须为空。
    pub target_account_id: Option<Uuid>,
    pub merchant: String,
    pub note: String,
    /// 带时区的原始发生时刻，用于精确排序和审计。
    pub occurred_at: DateTimeWithTimeZone,
    /// 用户录入时区下的自然日，用于月度与周末统计。
    pub local_date: Date,
    pub local_time: Time,
    pub utc_offset_minutes: i16,
    /// 非空表示正处于 5 秒撤销窗口内；清理任务到期后会真正删除记录。
    pub pending_delete_until: Option<DateTimeWithTimeZone>,
    pub deletion_token: Option<Uuid>,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
