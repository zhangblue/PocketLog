//! `categories` 表映射。
//!
//! 分类同时保存用户可见名称、收入/支出类型以及排序和启用状态。数据库层通过 `(id, kind)`
//! 复合键和检查约束，确保交易不能把支出分类错误地引用到收入交易上。

use sea_orm::entity::prelude::*;

// 分类同时保存收入/支出类型与启用状态；数据库复合外键据此阻止交易引用错误类型的分类。
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "categories")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub name: String,
    /// 标准化名称用于唯一性与重名判断，规则需与应用层创建/重命名逻辑保持一致。
    pub normalized_name: String,
    /// 仅允许 `expense` / `income`，转账不应拥有分类。
    pub kind: String,
    pub emoji: String,
    pub color: String,
    /// 保留给洞察语义的稳定键，例如“交通”分类可触发周末交通分析。
    pub semantic_key: Option<String>,
    pub sort_order: i32,
    pub active: bool,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
