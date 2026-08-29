//! 基础设施层入口。
//!
//! 这一层承接所有外部依赖：数据库连接与迁移、SeaORM 实体映射、演示数据初始化、日志、
//! 静态资源目录检查，以及服务运行期间的后台清理任务。应用层只依赖其暴露的 port 实现，
//! 便于未来替换存储或运行时细节。
pub mod cleanup;
pub mod db;
pub mod entities;
pub mod logging;
pub mod repositories;
pub mod schema;
pub mod seed;
pub mod static_files;
