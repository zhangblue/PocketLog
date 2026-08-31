//! 数据库迁移注册表。
//!
//! `migrate` 命令和启动时 schema 校验都依赖这里维护的迁移清单，因此新增迁移时必须同时
//! 注册模块并更新 `EXPECTED_MIGRATIONS`，否则数据库即使实际完成了迁移，也会在 `serve`
//! 启动阶段因为版本基线不一致而被拒绝。

use sea_orm_migration::prelude::*;

mod m20260826_000001_create_ledger;
mod m20260831_000002_create_custom_icons;

// 该清单是运行时 schema 校验的基线；新增迁移必须同时注册并更新期望版本。
pub const EXPECTED_MIGRATIONS: &[&str] = &[
    "m20260826_000001_create_ledger",
    "m20260831_000002_create_custom_icons",
];

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        // 返回顺序就是 SeaORM 应用版本的顺序；EXPECTED_MIGRATIONS 与此并列维护，serve 的
        // 只读校验据它发现漏迁移或意外 schema。
        vec![
            Box::new(m20260826_000001_create_ledger::Migration),
            Box::new(m20260831_000002_create_custom_icons::Migration),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm_migration::prelude::MigratorTrait;

    #[test]
    fn migrator_matches_expected_versions() {
        let migrations = Migrator::migrations();
        assert_eq!(migrations.len(), EXPECTED_MIGRATIONS.len());
        assert_eq!(
            migrations
                .iter()
                .map(|migration| migration.name())
                .collect::<Vec<_>>(),
            EXPECTED_MIGRATIONS
        );
    }
}
