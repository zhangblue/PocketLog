#![allow(dead_code)]

use pocket_log_backend::{config::Config, release::ReleaseLayout};
use sea_orm::{
    ConnectOptions, ConnectionTrait, Database, DatabaseConnection, DbBackend, Statement,
};
use std::sync::OnceLock;
use uuid::Uuid;

static TEST_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

pub async fn test_lock() -> tokio::sync::MutexGuard<'static, ()> {
    TEST_LOCK
        .get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await
}

pub struct TestDatabase {
    pub db: DatabaseConnection,
    pub schema: String,
    admin: DatabaseConnection,
}

impl TestDatabase {
    pub async fn empty() -> Self {
        let database_url = std::env::var("TEST_DATABASE_URL")
            .expect("TEST_DATABASE_URL must point to an isolated PostgreSQL test database");
        let database_url = database_url.replacen("postgresql://", "postgres://", 1);
        let mut admin_options = ConnectOptions::new(database_url.clone());
        admin_options
            .max_connections(1)
            .min_connections(0)
            .sqlx_logging(false);
        let admin = Database::connect(admin_options)
            .await
            .expect("connect to PostgreSQL test database");
        let schema = format!("pocket_log_test_{}", Uuid::new_v4().simple());
        admin
            .execute_unprepared(&format!("CREATE SCHEMA \"{schema}\""))
            .await
            .expect("create isolated test schema");

        let mut options = ConnectOptions::new(database_url);
        options
            .set_schema_search_path(schema.clone())
            .max_connections(2)
            .min_connections(1)
            .sqlx_logging(false);
        let db = Database::connect(options)
            .await
            .expect("connect to isolated test schema");

        Self { db, schema, admin }
    }

    pub async fn migrated() -> Self {
        let database = Self::empty().await;
        pocket_log_backend::infrastructure::schema::run_migrations(&database.db)
            .await
            .expect("migrate isolated test schema");
        database
    }

    pub async fn cleanup(self) {
        self.db.close().await.expect("close isolated schema pool");
        self.admin
            .execute_unprepared(&format!("DROP SCHEMA \"{}\" CASCADE", self.schema))
            .await
            .expect("drop isolated test schema");
        self.admin.close().await.expect("close admin pool");
    }

    pub async fn schema_has_migration_table(&self) -> bool {
        self.db
            .query_one(Statement::from_string(
                DbBackend::Postgres,
                "SELECT to_regclass('seaql_migrations') IS NOT NULL".to_owned(),
            ))
            .await
            .expect("query migration table")
            .expect("migration table result")
            .try_get_by_index(0)
            .expect("migration table value")
    }

    pub fn connection_url(&self) -> String {
        let database_url = std::env::var("TEST_DATABASE_URL")
            .expect("TEST_DATABASE_URL must point to an isolated PostgreSQL test database");
        let database_url = database_url.replacen("postgresql://", "postgres://", 1);
        let separator = if database_url.contains('?') { "&" } else { "?" };
        format!(
            "{database_url}{separator}options=-csearch_path%3D{}",
            self.schema
        )
    }
}

pub struct TemporaryRelease {
    root: std::path::PathBuf,
    layout: ReleaseLayout,
}

impl TemporaryRelease {
    pub fn with_config(database: &TestDatabase, bind_addr: &str) -> Self {
        let release = Self::without_config();
        std::fs::write(
            &release.layout.config_path,
            format!(
                "database_url = {:?}\nbind_addr = {:?}\n\n[logging]\n",
                database.connection_url(),
                bind_addr,
            ),
        )
        .expect("write release config");
        release
    }

    pub fn without_config() -> Self {
        let root =
            std::env::temp_dir().join(format!("pocket-log-release-runtime-{}", Uuid::new_v4()));
        std::fs::create_dir_all(root.join("dist")).expect("create release dist directory");
        std::fs::write(root.join("dist/index.html"), "release index").expect("write release index");
        let layout = ReleaseLayout::from_executable(&root.join("pocket-log-backend"));
        Self { root, layout }
    }

    pub fn write_config(&self, source: &str) {
        std::fs::write(&self.layout.config_path, source).expect("write release config");
    }

    pub fn executable_path(&self) -> std::path::PathBuf {
        self.layout.root.join("pocket-log-backend")
    }

    pub fn config(&self) -> Config {
        self.layout.load_config().expect("load release config")
    }

    pub fn logs_dir(&self) -> &std::path::Path {
        &self.layout.logs_dir
    }
}

impl Drop for TemporaryRelease {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

pub async fn execute(db: &DatabaseConnection, sql: impl Into<String>) -> sea_orm::DbErr {
    db.execute(Statement::from_string(DbBackend::Postgres, sql.into()))
        .await
        .expect_err("statement must be rejected by PostgreSQL")
}

pub async fn migration_versions(db: &DatabaseConnection) -> Vec<String> {
    db.query_all(Statement::from_string(
        DbBackend::Postgres,
        "SELECT version FROM seaql_migrations ORDER BY version".to_owned(),
    ))
    .await
    .expect("query migration versions")
    .into_iter()
    .map(|row| row.try_get_by_index(0).expect("migration version"))
    .collect()
}

pub async fn schema_object_oids(db: &DatabaseConnection) -> Vec<(String, i64)> {
    db.query_all(Statement::from_string(
        DbBackend::Postgres,
        r#"
            SELECT object_type, oid
            FROM (
                SELECT 'relation'::text AS object_type, c.oid::bigint AS oid
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = current_schema()
                UNION ALL
                SELECT 'constraint'::text, con.oid::bigint
                FROM pg_constraint con
                JOIN pg_namespace n ON n.oid = con.connamespace
                WHERE n.nspname = current_schema()
            ) objects
            ORDER BY object_type, oid
        "#
        .to_owned(),
    ))
    .await
    .expect("query schema object OIDs")
    .into_iter()
    .map(|row| {
        (
            row.try_get_by_index(0).expect("object type"),
            row.try_get_by_index(1).expect("object OID"),
        )
    })
    .collect()
}
