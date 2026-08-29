//! 数据库连接工厂。
//!
//! 本模块只负责把强类型配置翻译成 SeaORM 连接选项，不处理迁移、schema 校验或日志输出，
//! 从而让“如何连库”与“连库之后做什么”保持分离。

use sea_orm::{ConnectOptions, Database, DatabaseConnection, DbErr};

use crate::config::Config;

pub async fn connect(config: &Config) -> Result<DatabaseConnection, DbErr> {
    // 连接池参数统一从配置读取，避免 migrate、serve 和测试辅助路径建立行为不一致的连接。
    // 此函数故意不记录错误或 URL：上层将错误归一为脱敏启动错误，日志层也不能泄漏凭据。
    let mut options = ConnectOptions::new(config.database_url.as_str());
    options
        .min_connections(config.pool_min)
        .max_connections(config.pool_max)
        .connect_timeout(config.database_connect_timeout)
        .acquire_timeout(config.pool_acquire_timeout);
    Database::connect(options).await
}
