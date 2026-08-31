//! SeaORM 实体映射集合。
//!
//! 这些类型忠实反映数据库表结构，职责是把 PostgreSQL 行映射成 Rust 结构体。领域对象、
//! API DTO 与应用命令不会直接复用这些实体，避免持久化字段的技术细节渗入业务层。
pub mod account_label;
pub mod app_state;
pub mod category;
pub mod custom_icon;
pub mod idempotency_request;
pub mod transaction;
