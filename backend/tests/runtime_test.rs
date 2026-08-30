mod support;

use axum::{
    body::Body,
    http::{Request, StatusCode, header},
};
use chrono::NaiveDate;
use pocket_log_backend::application::clock::SystemClock;
use pocket_log_backend::infrastructure::static_files::ensure_static_assets;
use pocket_log_backend::infrastructure::{cleanup::spawn_cleanup, seed::seed_if_needed};
use pocket_log_backend::{
    api::build_router,
    command::{Command, run},
    config::Config,
};
use sea_orm::ConnectionTrait;
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
async fn release_config_uses_its_sibling_dist_directory_for_a_migrated_schema() {
    let _lock = support::test_lock().await;
    let db = support::TestDatabase::migrated().await;
    let release = support::TemporaryRelease::with_config(&db, "127.0.0.1:0");
    let config = release.config();

    let prepared = pocket_log_backend::command::prepare_serve(&config)
        .await
        .expect("release configuration and sibling assets prepare successfully");
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
