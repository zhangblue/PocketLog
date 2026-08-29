//! `app_state` 单例状态表映射。
//!
//! 该表只有一行，用于承载跨整个账本的全局状态，例如 seed 版本和数据修订号。很多跨事务
//! 的一致性检查都围绕这行记录进行，因此维护者需要把它视为“账本元数据单例”。

use sea_orm::entity::prelude::*;

// 单行状态表同时承担 seed 版本和全局数据修订号，是并发写入与缓存失效的协调点。
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "app_state")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub singleton: bool,
    /// 演示数据门闩。0 表示未初始化，非 0 表示已写入过对应版本的种子数据。
    pub seed_version: i32,
    /// 每次影响前端可见数据的写事务成功提交后递增，用于客户端一致性校验。
    pub data_revision: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
