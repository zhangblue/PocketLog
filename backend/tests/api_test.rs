mod support;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
    routing::get,
};
use pocket_log_backend::{
    api::build_router, application::clock::SystemClock, config::Config,
    infrastructure::seed::seed_if_needed,
};
use sea_orm::DatabaseConnection;
use tower::ServiceExt;
use tower_http::timeout::TimeoutLayer;

async fn app_with_limits(body_limit: usize, timeout_secs: u64) -> (Router, support::TestDatabase) {
    let database = support::TestDatabase::migrated().await;
    seed_if_needed(&database.db, &SystemClock)
        .await
        .expect("seed");
    let dir = std::env::temp_dir().join(format!("pocket-log-api-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("assets dir");
    std::fs::write(dir.join("index.html"), "<html>ok</html>").expect("index");
    std::fs::write(dir.join("app-0123abcd.js"), "console.log(1)").expect("asset");
    std::fs::write(dir.join("app-latest.js"), "console.log(2)").expect("unhashed asset");
    let cfg = Config::from_map([
        ("DATABASE_URL", "postgres://unused"),
        ("FRONTEND_DIST_DIR", dir.to_str().expect("path")),
        ("BODY_LIMIT_BYTES", &body_limit.to_string()),
        ("REQUEST_TIMEOUT_SECS", &timeout_secs.to_string()),
    ])
    .expect("config");
    (build_router(database.db.clone(), &cfg), database)
}

async fn app() -> (Router, support::TestDatabase) {
    app_with_limits(1024 * 1024, 15).await
}

fn valid_transaction_json() -> serde_json::Value {
    serde_json::json!({
        "kind": "expense",
        "amount": "1.00",
        "merchant": "测试交易",
        "categoryId": "10000000-0000-0000-0000-000000000001",
        "accountId": "20000000-0000-0000-0000-000000000001",
        "occurredAt": "2026-08-27T10:00:00+08:00",
        "note": ""
    })
}

#[tokio::test]
async fn custom_icon_api_returns_string_and_bootstrap_and_rejects_invalid_inputs() {
    let _lock = support::test_lock().await;
    let (app, db) = app().await;
    let response = app
        .clone()
        .oneshot(
            Request::post("/api/v1/custom-icons")
                .header("if-match", "1")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"emoji":" 🧋 "}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let body = to_bytes(response.into_body(), 4096).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["data"], "🧋");
    assert_eq!(json["dataRevision"], 2);
    let response = app
        .clone()
        .oneshot(
            Request::get("/api/v1/bootstrap")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = to_bytes(response.into_body(), 4096).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(
        json["customIcons"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v == "🧋")
    );
    for (emoji, code) in [
        ("  ", "custom_icon.empty"),
        ("aaaaaaaaaaaaaaaaa", "custom_icon.length_invalid"),
        ("🧋", "custom_icon.duplicate"),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::post("/api/v1/custom-icons")
                    .header("if-match", "2")
                    .header("content-type", "application/json")
                    .body(Body::from(format!(r#"{{"emoji":"{emoji}"}}"#)))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "{code}"
        );
        assert_eq!(response.headers()["x-error-code"], code);
    }
    db.cleanup().await;
}

#[tokio::test]
async fn live_and_api_404_are_json_contracts() {
    let _lock = support::test_lock().await;
    let (app, db) = app().await;
    let response = app
        .clone()
        .clone()
        .oneshot(Request::get("/health/live").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let response = app
        .clone()
        .oneshot(
            Request::get("/api/v1/not-found")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let request_id = response.headers()["x-request-id"]
        .to_str()
        .unwrap()
        .to_owned();
    assert!(
        response.headers()[header::CONTENT_TYPE]
            .to_str()
            .unwrap()
            .starts_with("application/problem+json")
    );
    let error_code = response.headers()["x-error-code"]
        .to_str()
        .unwrap()
        .to_owned();
    let body = to_bytes(response.into_body(), 4096).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["requestId"], request_id);
    assert_eq!(error_code, "route.not_found");
    db.cleanup().await;
}

#[tokio::test]
async fn html_fallback_and_hashed_cache_headers_are_safe() {
    let _lock = support::test_lock().await;
    let (app, db) = app().await;
    let response = app
        .clone()
        .oneshot(
            Request::get("/reports/monthly")
                .header(header::ACCEPT, "text/html")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-cache");
    let response = app
        .clone()
        .oneshot(
            Request::get("/app-0123abcd.js")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(
        response.headers()[header::CACHE_CONTROL]
            .to_str()
            .unwrap()
            .contains("immutable")
    );
    let response = app
        .clone()
        .oneshot(Request::get("/app-latest.js").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-cache");
    db.cleanup().await;
}

#[tokio::test]
async fn invalid_method_and_body_are_problem_json() {
    let _lock = support::test_lock().await;
    let (app, db) = app().await;
    let response = app
        .oneshot(Request::post("/health/live").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
    assert!(
        response.headers()[header::CONTENT_TYPE]
            .to_str()
            .unwrap()
            .starts_with("application/problem+json")
    );
    assert!(response.headers().get("x-request-id").is_some());
    db.cleanup().await;
}

#[tokio::test]
async fn malformed_json_query_and_oversized_body_are_problem_json() {
    let _lock = support::test_lock().await;
    let (app, db) = app_with_limits(8, 15).await;
    let response = app
        .clone()
        .oneshot(
            Request::post("/api/v1/transactions")
                .header("content-type", "application/json")
                .body(Body::from("{"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(
        response.headers()[header::CONTENT_TYPE]
            .to_str()
            .unwrap()
            .starts_with("application/problem+json")
    );
    let response = app
        .clone()
        .oneshot(
            Request::get("/api/v1/transactions?limit=bad")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let response = app
        .oneshot(
            Request::post("/api/v1/transactions")
                .header("content-type", "application/json")
                .body(Body::from("123456789"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    db.cleanup().await;
}

#[tokio::test]
async fn missing_if_match_is_bad_request_and_cors_is_not_wildcard() {
    let _lock = support::test_lock().await;
    let (app, db) = app().await;
    let response = app
        .oneshot(
            Request::post("/api/v1/transactions")
                .header("content-type", "application/json")
                .body(Body::from(valid_transaction_json().to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(
        response
            .headers()
            .get("access-control-allow-origin")
            .is_none()
    );
    db.cleanup().await;
}

#[tokio::test]
async fn idempotency_key_is_required_and_validated() {
    let _lock = support::test_lock().await;
    let (app, db) = app().await;
    let request = |key: Option<&str>| {
        let mut builder = Request::post("/api/v1/transactions")
            .header("if-match", "\"1\"")
            .header("content-type", "application/json");
        if let Some(key) = key {
            builder = builder.header("idempotency-key", key);
        }
        builder
            .body(Body::from(valid_transaction_json().to_string()))
            .unwrap()
    };
    let response = app.clone().oneshot(request(None)).await.unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response.headers()["x-error-code"],
        "idempotency_key_missing"
    );
    assert!(
        response.headers()[header::CONTENT_TYPE]
            .to_str()
            .unwrap()
            .starts_with("application/problem+json")
    );
    let response = app.oneshot(request(Some(" "))).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        response.headers()["x-error-code"],
        "idempotency_key_invalid"
    );
    assert!(
        response.headers()[header::CONTENT_TYPE]
            .to_str()
            .unwrap()
            .starts_with("application/problem+json")
    );
    db.cleanup().await;
}

#[tokio::test]
async fn timeout_rejection_uses_problem_json_contract() {
    async fn slow() -> &'static str {
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        "done"
    }
    let app = Router::new()
        .route("/api/v1/slow", get(slow))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            std::time::Duration::from_millis(1),
        ))
        .layer(axum::middleware::from_fn(
            pocket_log_backend::api::middleware::normalize_errors,
        ))
        .layer(axum::middleware::from_fn(
            pocket_log_backend::api::middleware::request_id,
        ));
    let response = app
        .oneshot(Request::get("/api/v1/slow").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::REQUEST_TIMEOUT);
    assert_eq!(response.headers()["x-error-code"], "request.timeout");
    assert!(
        response.headers()[header::CONTENT_TYPE]
            .to_str()
            .unwrap()
            .starts_with("application/problem+json")
    );
}

#[tokio::test]
async fn patch_body_supports_rename_and_deactivate_with_revision_contract() {
    let _lock = support::test_lock().await;
    let (app, db) = app().await;
    let response = app
        .clone()
        .oneshot(
            Request::get("/api/v1/bootstrap")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bootstrap: serde_json::Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 64 * 1024).await.unwrap()).unwrap();
    let category = bootstrap["categories"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["active"] == true)
        .unwrap();
    let id = category["id"].as_str().unwrap();
    let revision = bootstrap["dataRevision"].as_i64().unwrap();
    let response = app
        .clone()
        .oneshot(
            Request::patch(format!("/api/v1/categories/{id}"))
                .header("if-match", format!("\"{revision}\""))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"name":"API renamed"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let renamed: serde_json::Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 64 * 1024).await.unwrap()).unwrap();
    let next_revision = renamed["dataRevision"].as_i64().unwrap();
    assert_eq!(renamed["data"]["name"], "API renamed");
    let response = app
        .clone()
        .oneshot(
            Request::patch(format!("/api/v1/categories/{id}"))
                .header("if-match", format!("\"{next_revision}\""))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"active":false}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let deactivated: serde_json::Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 64 * 1024).await.unwrap()).unwrap();
    assert_eq!(deactivated["data"]["active"], false);
    let deactivated_revision = deactivated["dataRevision"].as_i64().unwrap();
    let response = app
        .oneshot(
            Request::patch(format!("/api/v1/categories/{id}"))
                .header("if-match", format!("\"{deactivated_revision}\""))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"active":true}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let activated: serde_json::Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 64 * 1024).await.unwrap()).unwrap();
    assert_eq!(activated["data"]["active"], true);
    db.cleanup().await;
}

#[tokio::test]
async fn patch_category_updates_name_and_emoji() {
    // 此测试覆盖真实 JSON DTO、路由和写服务，防止 PATCH 只处理名称而丢弃 Emoji。
    let _lock = support::test_lock().await;
    let (app, db) = app().await;
    let response = app
        .clone()
        .oneshot(
            Request::get("/api/v1/bootstrap")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let bootstrap: serde_json::Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 64 * 1024).await.unwrap()).unwrap();
    let category = bootstrap["categories"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["name"] == "餐饮")
        .unwrap();
    let id = category["id"].as_str().unwrap();
    let revision = bootstrap["dataRevision"].as_i64().unwrap();

    let response = app
        .clone()
        .oneshot(
            Request::patch(format!("/api/v1/categories/{id}"))
                .header("if-match", format!("\"{revision}\""))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"name":"水电费","emoji":"💧"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let updated: serde_json::Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 64 * 1024).await.unwrap()).unwrap();
    assert_eq!(updated["data"]["name"], "水电费");
    assert_eq!(updated["data"]["emoji"], "💧");
    assert_eq!(updated["dataRevision"], revision + 1);

    let next_revision = updated["dataRevision"].as_i64().unwrap();
    let response = app
        .oneshot(
            Request::patch(format!("/api/v1/categories/{id}"))
                .header("if-match", format!("\"{next_revision}\""))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"emoji":"🍜"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    db.cleanup().await;
}

#[allow(dead_code)]
fn _db_type(_: DatabaseConnection) {}
