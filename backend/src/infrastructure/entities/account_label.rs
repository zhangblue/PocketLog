//! `account_labels` 表映射。
//!
//! 账户标签只承担“交易属于哪个资金容器”的语义，不保存余额。历史交易仍可引用已停用标签，
//! 因此这里同时保留名称和启用状态。

use sea_orm::entity::prelude::*;

// 账户标签只描述交易归属，不承载余额或资产信息；active 用于区分新建选项与历史展示。
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "account_labels")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    /// 原始显示名称，保持用户录入风格用于界面展示。
    pub name: String,
    /// 标准化名称参与唯一性判断，避免大小写或多余空白造成“看起来相同”的重复标签。
    pub normalized_name: String,
    /// 停用后不再出现在新建交易选项中，但既有交易仍然保留此引用。
    pub active: bool,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
