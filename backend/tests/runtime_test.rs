mod support;

use axum::{
    body::Body,
    http::{Request, StatusCode, header},
};
use chrono::{DateTime, NaiveDate};
use pocket_log_backend::application::clock::SystemClock;
use pocket_log_backend::infrastructure::static_files::ensure_static_assets;
use pocket_log_backend::infrastructure::{cleanup::spawn_cleanup, seed::seed_if_needed};
use pocket_log_backend::{
    api::build_router,
    command::{Command, run},
    config::Config,
};
use sea_orm::{ActiveModelTrait, ActiveValue::Set, ConnectionTrait, EntityTrait, PaginatorTrait};
use std::process::Command as ProcessCommand;
use tower::ServiceExt;

#[tokio::test]
async fn readiness_requires_migrated_schema_and_never_falls_back_to_html() {
    let _lock = support::test_lock().await;
    let db = support::TestDatabase::migrated().await;
    let dir = std::env::temp_dir().join(format!("pocket-log-runtime-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("index.html"), "ok").unwrap();
    let config = Config::from_map([
        ("DATABASE_URL", "postgres://unused"),
        ("FRONTEND_DIST_DIR", dir.to_str().unwrap()),
    ])
    .unwrap();
    let app = build_router(db.db.clone(), &config);
    let response = app
        .oneshot(Request::get("/health/ready").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status().as_u16(), 200);
    db.cleanup().await;
}

#[tokio::test]
async fn readiness_rejects_unmigrated_schema_without_html_fallback() {
    let _lock = support::test_lock().await;
    let db = support::TestDatabase::empty().await;
    let dir = std::env::temp_dir().join(format!("pocket-log-runtime-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("index.html"), "ok").unwrap();
    let config = Config::from_map([
        ("DATABASE_URL", "postgres://unused"),
        ("FRONTEND_DIST_DIR", dir.to_str().unwrap()),
    ])
    .unwrap();
    let app = build_router(db.db.clone(), &config);
    let response = app
        .oneshot(Request::get("/health/ready").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert!(
        response.headers()[header::CONTENT_TYPE]
            .to_str()
            .unwrap()
            .starts_with("application/problem+json")
    );
    db.cleanup().await;
}

#[tokio::test]
async fn cleanup_runs_once_and_stops_when_requested() {
    let _lock = support::test_lock().await;
    let db = support::TestDatabase::migrated().await;
    seed_if_needed(&db.db, &SystemClock).await.expect("seed");
    let (stop_tx, stop_rx) = tokio::sync::watch::channel(false);
    let task = spawn_cleanup(db.db.clone(), stop_rx);
    tokio::task::yield_now().await;
    stop_tx.send(true).expect("send stop");
    tokio::time::timeout(std::time::Duration::from_secs(2), task)
        .await
        .expect("cleanup stops promptly")
        .expect("cleanup task succeeds");
    db.cleanup().await;
}

#[tokio::test]
async fn seed_failure_rolls_back_all_seed_writes() {
    let _lock = support::test_lock().await;
    let db = support::TestDatabase::migrated().await;
    db.db
        .execute_unprepared("DROP TABLE account_labels CASCADE")
        .await
        .expect("remove account table to force seed failure");
    let result = seed_if_needed(&db.db, &SystemClock).await;
    assert!(result.is_err());
    let categories = db
        .db
        .query_one(sea_orm::Statement::from_string(
            sea_orm::DbBackend::Postgres,
            "SELECT COUNT(*) FROM categories".to_owned(),
        ))
        .await
        .expect("query categories")
        .expect("count row")
        .try_get_by_index::<i64>(0)
        .expect("category count");
    assert_eq!(categories, 0);
    db.cleanup().await;
}

#[test]
fn serve_rejects_missing_static_directory_before_startup() {
    let dir = std::env::temp_dir().join(format!(
        "pocket-log-runtime-missing-{}",
        uuid::Uuid::new_v4()
    ));
    let error = ensure_static_assets(&dir).expect_err("missing static assets must fail");
    assert!(matches!(
        error,
        pocket_log_backend::infrastructure::static_files::StaticAssetsError::Missing
    ));
}

#[test]
fn serve_rejects_static_directory_without_index() {
    let dir = std::env::temp_dir().join(format!(
        "pocket-log-runtime-no-index-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let error = ensure_static_assets(&dir).expect_err("index.html must be required");
    assert!(matches!(
        error,
        pocket_log_backend::infrastructure::static_files::StaticAssetsError::IndexMissing
    ));
    std::fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn serve_rejects_unavailable_database_without_serving() {
    let code = pocket_log_backend::command::entry(
        ["serve"],
        [("DATABASE_URL", "postgres://127.0.0.1:1/pocket_log")],
    )
    .await;
    assert_eq!(code, 1);
}

#[tokio::test]
async fn serve_refuses_an_unmigrated_release_schema_without_migrating_it() {
    let _lock = support::test_lock().await;
    let db = support::TestDatabase::empty().await;
    let release = support::TemporaryRelease::with_config(&db, "127.0.0.1:0");

    let error = run(Command::Serve, release.config())
        .await
        .expect_err("serve must reject an unmigrated schema");

    assert_eq!(error.to_string(), "startup failed");
    assert!(!db.schema_has_migration_table().await);
    db.cleanup().await;
}

#[tokio::test]
async fn migrate_creates_an_empty_ledger_without_demo_data() {
    // 若 migrate 重新调用 seed_if_needed，以下真实表计数会立刻变为演示数据数量，
    // 从而保护“迁移只变更 schema、不写业务数据”的运维边界。
    let _lock = support::test_lock().await;
    let db = support::TestDatabase::empty().await;
    let release = support::TemporaryRelease::with_config(&db, "127.0.0.1:0");

    run(Command::Migrate, release.config())
        .await
        .expect("migrate succeeds");

    assert_eq!(ledger_row_counts(&db.db).await, (0, 0, 0, 0));
    db.cleanup().await;
}

#[tokio::test]
async fn demo_requires_initialized_categories_without_writing_data() {
    // 若 demo 仍创建预置分类或在缺少预置分类时先写账户、交易，空账本会出现半成品数据。
    let _lock = support::test_lock().await;
    let db = support::TestDatabase::migrated().await;
    let release = support::TemporaryRelease::with_config(&db, "127.0.0.1:0");

    let error = run(Command::Demo, release.config())
        .await
        .expect_err("demo must require init");
    assert_eq!(
        error.to_string(),
        "demo.categories_not_initialized: 请先执行 init"
    );
    assert_eq!(ledger_row_counts(&db.db).await, (0, 0, 0, 0));

    db.cleanup().await;
}

#[tokio::test]
async fn init_inserts_predefined_categories_once_without_demo_rows() {
    // 若 init 没有按标准化名称去重，第二次执行会复制分类；若它误调用 demo，会产生账户或交易。
    let _lock = support::test_lock().await;
    let db = support::TestDatabase::migrated().await;
    let release = support::TemporaryRelease::with_config(&db, "127.0.0.1:0");

    run(Command::Init, release.config())
        .await
        .expect("init succeeds");
    assert_eq!(ledger_row_counts(&db.db).await, (11, 0, 0, 0));

    run(Command::Init, release.config())
        .await
        .expect("repeated init is idempotent");
    assert_eq!(ledger_row_counts(&db.db).await, (11, 0, 0, 0));
    db.cleanup().await;
}

#[tokio::test]
async fn init_skips_an_existing_predefined_normalized_name() {
    // 若 init 固定插入 UUID，已有“餐饮”会造成唯一约束失败；正确行为是保留旧行并补齐其余预置项。
    let _lock = support::test_lock().await;
    let db = support::TestDatabase::migrated().await;
    let release = support::TemporaryRelease::with_config(&db, "127.0.0.1:0");
    let existing_id = insert_category(&db.db, "  餐饮  ", "expense").await;

    run(Command::Init, release.config())
        .await
        .expect("init skips existing normalized name");

    assert_eq!(ledger_row_counts(&db.db).await, (11, 0, 0, 0));
    let food =
        pocket_log_backend::infrastructure::entities::category::Entity::find_by_id(existing_id)
            .one(&db.db)
            .await
            .expect("read existing category");
    assert!(food.is_some(), "init must not replace an existing category");
    run(Command::Demo, release.config())
        .await
        .expect("demo uses the existing category ID");
    let coffee = pocket_log_backend::infrastructure::entities::transaction::Entity::find()
        .all(&db.db)
        .await
        .expect("list demo transactions")
        .into_iter()
        .find(|row| row.merchant == "山丘咖啡")
        .expect("coffee demo transaction");
    assert_eq!(coffee.category_id, Some(existing_id));
    db.cleanup().await;
}

#[tokio::test]
async fn init_then_demo_preserves_categories_and_adds_accounts_and_transactions() {
    // 若 demo 继续插入预置分类，分类数将从 init 后的 11 变成更多。
    let _lock = support::test_lock().await;
    let db = support::TestDatabase::migrated().await;
    let release = support::TemporaryRelease::with_config(&db, "127.0.0.1:0");

    run(Command::Init, release.config())
        .await
        .expect("init succeeds");
    run(Command::Demo, release.config())
        .await
        .expect("demo succeeds after init");
    assert_eq!(ledger_row_counts(&db.db).await, (11, 4, 17, 0));
    db.cleanup().await;
}

#[tokio::test]
async fn init_writes_the_complete_predefined_category_catalog_with_exact_kinds() {
    // 防止目录漏掉水费、电费、通讯、网络或收入“其他”，也防止将它们写成错误收支类型。
    let _lock = support::test_lock().await;
    let db = support::TestDatabase::migrated().await;
    let release = support::TemporaryRelease::with_config(&db, "127.0.0.1:0");

    run(Command::Init, release.config())
        .await
        .expect("init writes all predefined categories");
    let mut actual = pocket_log_backend::infrastructure::entities::category::Entity::find()
        .all(&db.db)
        .await
        .expect("read categories")
        .into_iter()
        .map(|row| (row.name, row.kind))
        .collect::<Vec<_>>();
    actual.sort();
    assert_eq!(
        actual,
        vec![
            ("交通".to_owned(), "expense".to_owned()),
            ("其他".to_owned(), "income".to_owned()),
            ("娱乐".to_owned(), "expense".to_owned()),
            ("居住".to_owned(), "expense".to_owned()),
            ("工资".to_owned(), "income".to_owned()),
            ("水费".to_owned(), "expense".to_owned()),
            ("电费".to_owned(), "expense".to_owned()),
            ("网络".to_owned(), "expense".to_owned()),
            ("购物".to_owned(), "expense".to_owned()),
            ("通讯".to_owned(), "expense".to_owned()),
            ("餐饮".to_owned(), "expense".to_owned()),
        ]
    );
    db.cleanup().await;
}

#[tokio::test]
async fn init_recovers_from_a_renamed_legacy_transport_category_without_fixed_id_conflicts() {
    // 防止重用旧交通固定 UUID；重命名后仍必须补齐新的“交通”分类。
    let _lock = support::test_lock().await;
    let db = support::TestDatabase::migrated().await;
    let release = support::TemporaryRelease::with_config(&db, "127.0.0.1:0");
    let legacy_id = uuid::Uuid::from_u128(0x10000000000000000000000000000002);
    insert_category_details(
        &db.db,
        legacy_id,
        "旧交通",
        "expense",
        Some("transport"),
        1,
        true,
    )
    .await;

    run(Command::Init, release.config())
        .await
        .expect("init fills the missing transport name");
    let categories = pocket_log_backend::infrastructure::entities::category::Entity::find()
        .all(&db.db)
        .await
        .expect("read categories");
    let transport = categories
        .iter()
        .find(|row| row.normalized_name == "交通")
        .expect("new transport category");
    assert_ne!(transport.id, legacy_id);
    assert_eq!(transport.semantic_key, None);
    assert_eq!(categories.len(), 12);
    db.cleanup().await;
}

#[tokio::test]
async fn init_falls_back_when_the_transport_semantic_key_is_already_occupied() {
    // 防止为新交通固定写入 transport 语义键；该键被历史分类占用时 init 仍应可用。
    let _lock = support::test_lock().await;
    let db = support::TestDatabase::migrated().await;
    let release = support::TemporaryRelease::with_config(&db, "127.0.0.1:0");
    insert_category_details(
        &db.db,
        uuid::Uuid::new_v4(),
        "旧出行",
        "expense",
        Some("transport"),
        1,
        true,
    )
    .await;

    run(Command::Init, release.config())
        .await
        .expect("init remains usable when the semantic key is occupied");
    let transport = pocket_log_backend::infrastructure::entities::category::Entity::find()
        .all(&db.db)
        .await
        .expect("read categories")
        .into_iter()
        .find(|row| row.normalized_name == "交通")
        .expect("transport category");
    assert_eq!(transport.semantic_key, None);
    db.cleanup().await;
}

#[tokio::test]
async fn demo_rejects_an_inactive_predefined_category_before_writing_accounts_or_transactions() {
    // 防止 demo 忽略 active，令新交易继续引用已停用“餐饮”。
    let _lock = support::test_lock().await;
    let db = support::TestDatabase::migrated().await;
    let release = support::TemporaryRelease::with_config(&db, "127.0.0.1:0");
    insert_category_details(
        &db.db,
        uuid::Uuid::new_v4(),
        "餐饮",
        "expense",
        None,
        0,
        false,
    )
    .await;
    run(Command::Init, release.config())
        .await
        .expect("init retains the inactive same-name category");

    let error = run(Command::Demo, release.config())
        .await
        .expect_err("inactive predefined category rejects demo");
    assert_eq!(
        error.to_string(),
        "demo.categories_inactive: 请先启用预置分类后重试"
    );
    assert_eq!(ledger_row_counts(&db.db).await, (11, 0, 0, 0));
    db.cleanup().await;
}

#[tokio::test]
async fn demo_rejects_a_predefined_category_with_the_wrong_kind_without_writing_rows() {
    // 若 demo 仅按名称查分类而不校验类型，收入“餐饮”会被写入支出交易，外键错误或错误业务
    // 数据都会随之出现；它必须稳定地提示重新初始化，而不是留下任何账户或交易。
    let _lock = support::test_lock().await;
    let db = support::TestDatabase::migrated().await;
    let release = support::TemporaryRelease::with_config(&db, "127.0.0.1:0");
    insert_category(&db.db, "餐饮", "income").await;

    run(Command::Init, release.config())
        .await
        .expect("init preserves the existing same-name category");
    let error = run(Command::Demo, release.config())
        .await
        .expect_err("wrong category kind rejects demo");

    assert_eq!(
        error.to_string(),
        "demo.categories_kind_invalid: 请修正预置分类类型后重试"
    );
    assert_eq!(ledger_row_counts(&db.db).await, (11, 0, 0, 0));
    db.cleanup().await;
}

#[tokio::test]
async fn demo_and_clean_reject_an_unmigrated_schema_without_creating_migrations() {
    // 若任一数据命令绕过 verify_schema，可能在未迁移库上建表或写入半套业务数据。
    let _lock = support::test_lock().await;
    let db = support::TestDatabase::empty().await;
    let release = support::TemporaryRelease::with_config(&db, "127.0.0.1:0");

    for command in [Command::Init, Command::Demo, Command::Clean] {
        let error = run(command, release.config())
            .await
            .expect_err("data commands must reject an unmigrated schema");
        assert_eq!(error.to_string(), "startup failed");
        assert!(!db.schema_has_migration_table().await);
    }
    db.cleanup().await;
}

#[tokio::test]
async fn clean_removes_ledger_data_and_allows_init_then_demo_again() {
    // 若 clean 没有把 seed_version 复位或遗漏任一业务表，清理后无法按 init → demo 重建演示账本。
    let _lock = support::test_lock().await;
    let db = support::TestDatabase::migrated().await;
    let release = support::TemporaryRelease::with_config(&db, "127.0.0.1:0");

    run(Command::Init, release.config())
        .await
        .expect("init succeeds");
    run(Command::Demo, release.config())
        .await
        .expect("demo succeeds");
    run(Command::Clean, release.config())
        .await
        .expect("clean succeeds");
    assert_eq!(ledger_row_counts(&db.db).await, (0, 0, 0, 0));

    let error = run(Command::Demo, release.config())
        .await
        .expect_err("demo requires init after clean");
    assert_eq!(
        error.to_string(),
        "demo.categories_not_initialized: 请先执行 init"
    );
    run(Command::Init, release.config())
        .await
        .expect("init succeeds after clean");
    run(Command::Demo, release.config())
        .await
        .expect("demo can run after clean and init");
    assert_eq!(ledger_row_counts(&db.db).await, (11, 4, 17, 0));
    let state = pocket_log_backend::infrastructure::entities::app_state::Entity::find_by_id(true)
        .one(&db.db)
        .await
        .expect("read app state")
        .expect("initial app state exists");
    // 每次实际写入账本的 init、demo、clean 都递增修订：init(1) → demo(2) → clean(3)
    // → init(4) → demo(5)。这让已运行的前端能可靠地发现预置分类和演示数据变化。
    assert_eq!((state.seed_version, state.data_revision), (1, 5));
    db.cleanup().await;
}

#[tokio::test]
async fn prepare_serve_uses_its_sibling_dist_directory_without_seeding_an_empty_ledger() {
    let _lock = support::test_lock().await;
    let db = support::TestDatabase::migrated().await;
    let release = support::TemporaryRelease::with_config(&db, "127.0.0.1:0");
    let config = release.config();

    let prepared = pocket_log_backend::command::prepare_serve(&config)
        .await
        .expect("release configuration and sibling assets prepare successfully");
    assert_eq!(ledger_row_counts(&prepared).await, (0, 0, 0, 0));
    let app = build_router(prepared, &config);
    let response = app
        .oneshot(
            Request::get("/")
                .header(header::ACCEPT, "text/html")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    db.cleanup().await;
}

async fn ledger_row_counts(db: &sea_orm::DatabaseConnection) -> (u64, u64, u64, u64) {
    let categories = pocket_log_backend::infrastructure::entities::category::Entity::find()
        .count(db)
        .await
        .expect("count categories");
    let accounts = pocket_log_backend::infrastructure::entities::account_label::Entity::find()
        .count(db)
        .await
        .expect("count accounts");
    let transactions = pocket_log_backend::infrastructure::entities::transaction::Entity::find()
        .count(db)
        .await
        .expect("count transactions");
    let custom_icons = pocket_log_backend::infrastructure::entities::custom_icon::Entity::find()
        .count(db)
        .await
        .expect("count custom icons");
    (categories, accounts, transactions, custom_icons)
}

async fn insert_category(db: &sea_orm::DatabaseConnection, name: &str, kind: &str) -> uuid::Uuid {
    let id = uuid::Uuid::new_v4();
    insert_category_details(db, id, name, kind, None, 0, true).await;
    id
}

async fn insert_category_details(
    db: &sea_orm::DatabaseConnection,
    id: uuid::Uuid,
    name: &str,
    kind: &str,
    semantic_key: Option<&str>,
    sort_order: i32,
    active: bool,
) {
    let now =
        DateTime::parse_from_rfc3339("2026-09-01T10:00:00+08:00").expect("valid fixture timestamp");
    pocket_log_backend::infrastructure::entities::category::ActiveModel {
        id: Set(id),
        name: Set(name.to_owned()),
        normalized_name: Set(name
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase()),
        kind: Set(kind.to_owned()),
        emoji: Set("🧾".to_owned()),
        color: Set("#4F8A75".to_owned()),
        semantic_key: Set(semantic_key.map(str::to_owned)),
        sort_order: Set(sort_order),
        active: Set(active),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(db)
    .await
    .expect("insert a real user category");
}

#[test]
fn binary_uses_environment_configuration_only_when_sibling_config_is_absent() {
    let release = support::TemporaryRelease::without_config();
    std::fs::copy(
        env!("CARGO_BIN_EXE_pocket-log-backend"),
        release.executable_path(),
    )
    .expect("copy backend binary into temporary release directory");

    let output = ProcessCommand::new(release.executable_path())
        .env("DATABASE_URL", "postgres://127.0.0.1:1/pocket_log")
        .output()
        .expect("run temporary release binary");

    assert_eq!(output.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&output.stderr).contains("startup failed"));
    let has_dated_pocketlog_log = std::fs::read_dir(release.logs_dir())
        .expect("read release logs directory")
        .filter_map(Result::ok)
        .any(|entry| {
            let Ok(name) = entry.file_name().into_string() else {
                return false;
            };
            entry.path().is_file()
                && name
                    .strip_prefix("PocketLog-")
                    .and_then(|date| date.strip_suffix(".jsonl"))
                    .is_some_and(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").is_ok())
        });
    assert!(has_dated_pocketlog_log);
}

#[test]
fn binary_gives_valid_sibling_config_precedence_over_environment() {
    // 发行配置使用一个格式正确但不可连接的本地地址；若程序错误读取环境中的无效
    // DATABASE_URL，会在连接前以 config.database_url_invalid 退出，而不是 startup failed。
    let release = support::TemporaryRelease::without_config();
    release.write_config(
        "database_url = \"postgres://127.0.0.1:1/pocket_log\"\nbind_addr = \"127.0.0.1:0\"\n\n[logging]\n",
    );
    std::fs::copy(
        env!("CARGO_BIN_EXE_pocket-log-backend"),
        release.executable_path(),
    )
    .expect("copy backend binary into temporary release directory");

    let output = ProcessCommand::new(release.executable_path())
        .env("DATABASE_URL", "not-a-database-url")
        .output()
        .expect("run temporary release binary");

    assert_eq!(output.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("startup failed"));
    assert!(!stderr.contains("config.database_url_invalid"));
}

#[test]
fn binary_refuses_invalid_sibling_config_instead_of_falling_back_to_environment() {
    let release = support::TemporaryRelease::without_config();
    release.write_config("database_url = [");
    std::fs::copy(
        env!("CARGO_BIN_EXE_pocket-log-backend"),
        release.executable_path(),
    )
    .expect("copy backend binary into temporary release directory");

    let output = ProcessCommand::new(release.executable_path())
        .env("DATABASE_URL", "postgres://127.0.0.1:1/pocket_log")
        .output()
        .expect("run temporary release binary");

    assert_eq!(output.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("config.file_invalid"));
    assert!(!stderr.contains("startup failed"));
}
