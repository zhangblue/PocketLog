//! 数据库 schema 生命周期管理。
//!
//! `serve` 路径只做只读校验，`migrate` 路径才允许真正变更 schema。把这两个动作集中在此，
//! 可以确保所有命令遵守同一套“不在启动时自动迁移”的部署约束。

use std::collections::BTreeSet;

use sea_orm::{
    AccessMode, ConnectionTrait, DatabaseConnection, DbBackend, DbErr, Statement, TransactionTrait,
};
use sea_orm_migration::MigratorTrait;
use thiserror::Error;

use crate::migration::{EXPECTED_MIGRATIONS, Migrator};

const MIGRATION_LOCK_ID: i64 = 7_165_966_047_389_503_831;

#[derive(Debug, Error)]
#[error("database schema check failed")]
pub struct SchemaError {
    /// 稳定错误码供命令层和日志判断失败类别，避免把数据库错误字符串暴露给终端或 API。
    code: &'static str,
    #[source]
    source: Option<DbErr>,
}

impl SchemaError {
    fn new(code: &'static str) -> Self {
        Self { code, source: None }
    }

    fn database(source: DbErr) -> Self {
        Self {
            code: "schema.database_error",
            source: Some(source),
        }
    }

    pub fn code(&self) -> &'static str {
        self.code
    }
}

pub async fn verify_schema(db: &DatabaseConnection) -> Result<(), SchemaError> {
    // schema 校验使用只读事务；verify_schema/serve 启动阶段只检查已应用版本，不执行 schema migration。
    let transaction = db
        .begin_with_config(None, Some(AccessMode::ReadOnly))
        .await
        .map_err(SchemaError::database)?;
    // 先探测 SeaORM 的迁移记录表。直接查询版本表会把“从未迁移”伪装成普通数据库错误，
    // 而调用方需要据 schema.not_initialized 明确提示管理员先运行 migrate。
    let table = transaction
        .query_one(Statement::from_string(
            DbBackend::Postgres,
            "SELECT to_regclass('seaql_migrations')::text".to_owned(),
        ))
        .await
        .map_err(SchemaError::database)?
        .and_then(|row| row.try_get_by_index::<Option<String>>(0).ok().flatten());
    if table.is_none() {
        transaction
            .rollback()
            .await
            .map_err(SchemaError::database)?;
        return Err(SchemaError::new("schema.not_initialized"));
    }

    // 使用集合比较而不是仅比较最新版本：漏掉中间迁移、额外未知迁移和顺序异常都会被识别，
    // 防止服务在看似“已迁移”但结构不兼容的库上继续运行。
    let applied = transaction
        .query_all(Statement::from_string(
            DbBackend::Postgres,
            "SELECT version FROM seaql_migrations ORDER BY version".to_owned(),
        ))
        .await
        .map_err(SchemaError::database)?
        .into_iter()
        .map(|row| row.try_get_by_index::<String>(0))
        .collect::<Result<BTreeSet<_>, _>>()
        .map_err(SchemaError::database)?;
    transaction.commit().await.map_err(SchemaError::database)?;

    let expected = EXPECTED_MIGRATIONS
        .iter()
        .map(|version| (*version).to_owned())
        .collect::<BTreeSet<_>>();
    if applied != expected {
        return Err(SchemaError::new("schema.version_mismatch"));
    }
    Ok(())
}

pub async fn run_migrations(db: &DatabaseConnection) -> Result<(), SchemaError> {
    // 显式 migrate 在事务内持有 advisory lock，串行化多个进程的迁移并在失败时整体回滚。
    let transaction = db.begin().await.map_err(SchemaError::database)?;
    transaction
        .execute(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT pg_advisory_xact_lock($1)",
            [MIGRATION_LOCK_ID.into()],
        ))
        .await
        .map_err(SchemaError::database)?;

    // advisory lock 的生命周期绑定本事务，commit/rollback 自动释放；即使进程异常断开，
    // PostgreSQL 也不会留下永久锁。迁移失败显式 rollback，避免部分版本记录被提交。
    match Migrator::up(&transaction, None).await {
        Ok(()) => transaction.commit().await.map_err(SchemaError::database),
        Err(error) => {
            let _ = transaction.rollback().await;
            Err(SchemaError::database(error))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_errors_are_stable_and_do_not_expose_database_details() {
        let missing = SchemaError::new("schema.not_initialized");
        assert_eq!(missing.code(), "schema.not_initialized");
        assert_eq!(missing.to_string(), "database schema check failed");
        assert!(missing.source.is_none());
        let db = SchemaError::database(DbErr::Custom("secret connection detail".into()));
        assert_eq!(db.code(), "schema.database_error");
        assert!(db.source.is_some());
        assert_eq!(db.to_string(), "database schema check failed");
    }

    #[test]
    fn expected_migrations_are_nonempty_and_unique() {
        assert!(!EXPECTED_MIGRATIONS.is_empty());
        let unique = EXPECTED_MIGRATIONS.iter().collect::<BTreeSet<_>>();
        assert_eq!(unique.len(), EXPECTED_MIGRATIONS.len());
    }
}
