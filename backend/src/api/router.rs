//! 路由只负责 HTTP 编排与边界策略，业务规则仍由 application service 执行。
//!
//! 这里集中配置 API 前缀、超时、请求体上限、追踪和 SPA 静态资源，确保所有入口共享
//! 相同的安全与错误处理链。

use super::{
    dto::{
        self, CreateTransactionRequest, MutationResponse, TransactionQueryParams,
        TransactionsResponse,
    },
    error,
};
use crate::{
    application::{
        bootstrap::load_bootstrap,
        insights::{monthly_report, overview},
        labels::LabelService,
        transactions::TransactionService,
    },
    config::Config,
    infrastructure::repositories::SeaOrmLedgerRepository,
};
use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use sea_orm::DatabaseConnection;
use std::path::PathBuf;
use tower_http::{limit::RequestBodyLimitLayer, timeout::TimeoutLayer, trace::TraceLayer};

#[derive(Clone)]
pub struct AppState {
    /// 路由共享的无状态依赖：数据库连接池和启动时已校验的配置。每个请求自行开启短事务。
    pub db: DatabaseConnection,
    pub frontend_dist_dir: PathBuf,
}

pub fn build_router(db: DatabaseConnection, config: &Config) -> Router {
    // 仅在启动检查完成后调用。路由组装不访问数据库，因此绑定端口前的失败不会产生半可用 HTTP 服务。
    // `/api/v1` 与健康检查、静态资源分开挂载，既保持版本化接口稳定，也避免 SPA 兜底
    // 吞掉 API 的 404 或方法错误。
    let state = AppState {
        db,
        frontend_dist_dir: config.frontend_dist_dir.clone(),
    };
    let api = Router::new()
        .route("/bootstrap", get(bootstrap))
        .route(
            "/transactions",
            get(list_transactions).post(create_transaction),
        )
        .route("/transactions/{id}", delete(delete_transaction))
        .route("/transactions/{id}/restore", post(restore_transaction))
        .route("/categories", post(create_category))
        .route(
            "/categories/{id}",
            post(rename_category).patch(rename_category),
        )
        .route("/categories/{id}/deactivate", post(deactivate_category))
        .route("/categories/order", axum::routing::put(reorder_categories))
        .route("/categories/{id}/delete", post(delete_category))
        .route("/categories/{id}/migrate", post(migrate_category))
        .route("/accounts", post(create_account))
        .route("/accounts/{id}", post(rename_account).patch(rename_account))
        .route("/accounts/{id}/deactivate", post(deactivate_account))
        .route("/overview", get(get_overview))
        .route("/analytics", get(get_overview))
        .route("/reports/monthly", get(get_report))
        .fallback(api_not_found)
        .with_state(state.clone());
    Router::new()
        .nest("/api/v1", api)
        .route("/health/live", get(live))
        .route("/health/ready", get(ready))
        .route("/{*path}", get(static_file))
        .fallback(spa_fallback)
        .layer(RequestBodyLimitLayer::new(config.body_limit_bytes))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            config.request_timeout,
        ))
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(|request: &axum::http::Request<_>| {
                    let request_id = request
                        .extensions()
                        .get::<String>()
                        .map(String::as_str)
                        .unwrap_or("");
                    let route = request
                        .extensions()
                        .get::<axum::extract::MatchedPath>()
                        .map(|path| path.as_str())
                        .unwrap_or_else(|| request.uri().path());
                    tracing::info_span!(
                        "http_request",
                        method = %request.method(),
                        route = %route,
                        request_id = %request_id
                    )
                })
                .on_response(
                    |response: &axum::http::Response<_>,
                     latency: std::time::Duration,
                     _span: &tracing::Span| {
                        tracing::info!(
                            status = response.status().as_u16(),
                            elapsed_ms = latency.as_millis() as u64,
                            error_code = response
                                .headers()
                                .get("x-error-code")
                                .and_then(|v| v.to_str().ok())
                                .unwrap_or("")
                        );
                    },
                ),
        )
        .layer(axum::middleware::from_fn(
            crate::api::middleware::normalize_errors,
        ))
        .layer(axum::middleware::from_fn(
            crate::api::middleware::request_id,
        ))
        .with_state(state)
}

async fn static_file(
    State(state): State<AppState>,
    Path(path): Path<String>,
    request: axum::http::Request<axum::body::Body>,
) -> Response {
    // 路径穿越和非 GET 请求在读取文件前拒绝；带内容哈希的构建产物可永久缓存，入口
    // HTML 则必须 no-cache，才能让新部署及时生效。
    if request.method() != axum::http::Method::GET || path.contains("..") {
        return error::problem(
            "route.not_found",
            StatusCode::NOT_FOUND,
            request_id_from_request(&request),
        );
    }
    let file = state.frontend_dist_dir.join(path.trim_start_matches('/'));
    match tokio::fs::read(&file).await {
        Ok(bytes) => {
            let content_type = match file.extension().and_then(|v| v.to_str()) {
                Some("html") => "text/html; charset=utf-8",
                Some("js") => "application/javascript",
                Some("css") => "text/css",
                _ => "application/octet-stream",
            };
            let is_index = file.file_name().and_then(|v| v.to_str()) == Some("index.html");
            let cache = if !is_index && has_content_hash(&file) {
                "public, max-age=31536000, immutable"
            } else {
                "no-cache"
            };
            (
                StatusCode::OK,
                [("content-type", content_type), ("cache-control", cache)],
                bytes,
            )
                .into_response()
        }
        Err(_) => spa_fallback(State(state), request).await,
    }
}

fn has_content_hash(path: &std::path::Path) -> bool {
    // 只有文件名末段是足够长的十六进制摘要时才启用 immutable，避免把 latest 等可变
    // 资源错误地缓存一年。
    let Some(stem) = path.file_stem().and_then(|v| v.to_str()) else {
        return false;
    };
    let Some((_, hash)) = stem.rsplit_once('-') else {
        return false;
    };
    hash.len() >= 8 && hash.chars().all(|c| c.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::has_content_hash;
    use std::path::Path;

    #[test]
    fn content_hash_requires_a_hyphenated_hex_segment() {
        assert!(has_content_hash(Path::new("app-0123abcd.js")));
        assert!(has_content_hash(Path::new("app-0123456789abcdef.js")));
        assert!(!has_content_hash(Path::new("0123abcd.js")));
        assert!(!has_content_hash(Path::new("app-latest.js")));
        assert!(!has_content_hash(Path::new("app-0123abcd-not-hex.js")));
    }
}

async fn spa_fallback(
    State(state): State<AppState>,
    request: axum::http::Request<axum::body::Body>,
) -> Response {
    // 仅对浏览器 HTML 导航提供 index.html；API/health 或非 HTML 请求保持明确的 404。
    let accepts_html = request
        .headers()
        .get(axum::http::header::ACCEPT)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.split(',').any(|x| x.trim().starts_with("text/html")));
    let path = request.uri().path();
    if request.method() != axum::http::Method::GET
        || !accepts_html
        || path.starts_with("/api/")
        || path.starts_with("/health/")
    {
        return error::problem(
            "route.not_found",
            StatusCode::NOT_FOUND,
            request_id_from_request(&request),
        );
    }
    match tokio::fs::read(state.frontend_dist_dir.join("index.html")).await {
        Ok(bytes) => (
            StatusCode::OK,
            [
                ("content-type", "text/html; charset=utf-8"),
                ("cache-control", "no-cache"),
            ],
            bytes,
        )
            .into_response(),
        Err(_) => error::problem(
            "static_assets.missing",
            StatusCode::INTERNAL_SERVER_ERROR,
            request_id_from_request(&request),
        ),
    }
}

async fn api_not_found(Extension(request_id): Extension<String>) -> Response {
    error::problem("route.not_found", StatusCode::NOT_FOUND, &request_id)
}

fn request_id_from_request(request: &axum::http::Request<axum::body::Body>) -> &str {
    request
        .extensions()
        .get::<String>()
        .map(String::as_str)
        .or_else(|| {
            request
                .headers()
                .get("x-request-id")
                .and_then(|value| value.to_str().ok())
        })
        .unwrap_or("")
}
async fn live() -> impl IntoResponse {
    (StatusCode::OK, Json(serde_json::json!({"status":"ok"})))
}
async fn ready(
    State(state): State<AppState>,
    Extension(request_id): Extension<String>,
) -> Response {
    // readiness 同时验证 schema 与数据库可查询性，表示“可以接收业务请求”；存活检查
    // 则只反映进程是否仍在运行，二者不能混为一谈。
    use sea_orm::{ConnectionTrait, DbBackend, Statement};
    if crate::infrastructure::schema::verify_schema(&state.db)
        .await
        .is_err()
    {
        return error::problem(
            "health.not_ready",
            StatusCode::SERVICE_UNAVAILABLE,
            &request_id,
        );
    }
    match state
        .db
        .query_one(Statement::from_string(
            DbBackend::Postgres,
            "SELECT 1".to_owned(),
        ))
        .await
    {
        Ok(Some(_)) => live().await.into_response(),
        _ => error::problem(
            "health.not_ready",
            StatusCode::SERVICE_UNAVAILABLE,
            &request_id,
        ),
    }
}
async fn bootstrap(State(state): State<AppState>) -> Response {
    match load_bootstrap(&SeaOrmLedgerRepository::new(state.db)).await {
        Ok(v) => (
            StatusCode::OK,
            Json(crate::api::dto::BootstrapResponse::from(v)),
        )
            .into_response(),
        Err(e) => e.into_response(),
    }
}

#[allow(clippy::result_large_err)]
fn revision(h: &HeaderMap) -> Result<crate::application::DataRevision, Response> {
    dto::revision(h).map_err(|e| e.into_response())
}
async fn list_transactions(
    State(state): State<AppState>,
    Query(params): Query<TransactionQueryParams>,
) -> Response {
    let q = match params.into_domain() {
        Ok(v) => v,
        Err(e) => return e.into_response(),
    };
    match TransactionService::new(SeaOrmLedgerRepository::new(state.db))
        .list(q)
        .await
    {
        Ok(v) => (StatusCode::OK, Json(TransactionsResponse::from(v))).into_response(),
        Err(e) => e.into_response(),
    }
}
async fn create_transaction(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateTransactionRequest>,
) -> Response {
    let expected = match revision(&headers) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let key = match dto::idempotency(&headers) {
        Ok(v) => v,
        Err(e) => return e.into_response(),
    };
    let result = TransactionService::new(SeaOrmLedgerRepository::new(state.db))
        .create(body.into_domain(), expected, key)
        .await;
    match result {
        Ok(v) => (
            StatusCode::CREATED,
            Json(MutationResponse {
                data: v.transaction,
                data_revision: v.data_revision,
            }),
        )
            .into_response(),
        Err(e) => e.into_response(),
    }
}
async fn delete_transaction(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<uuid::Uuid>,
) -> Response {
    let expected = match revision(&headers) {
        Ok(v) => v,
        Err(e) => return e,
    };
    match TransactionService::new(SeaOrmLedgerRepository::new(state.db))
        .delete(id, expected)
        .await
    {
        Ok(v) => {
            let data = serde_json::json!({"transaction":v.transaction,"deletionToken":v.token,"undoUntil":v.undo_until});
            (
                StatusCode::OK,
                Json(serde_json::json!({"data":data,"dataRevision":v.data_revision})),
            )
                .into_response()
        }
        Err(e) => e.into_response(),
    }
}
async fn restore_transaction(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<uuid::Uuid>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let expected = match revision(&headers) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let token = body
        .get("deletionToken")
        .and_then(|v| v.as_str())
        .and_then(|v| uuid::Uuid::parse_str(v).ok())
        .ok_or_else(|| {
            error::problem(
                "deletion_token_invalid",
                StatusCode::UNPROCESSABLE_ENTITY,
                headers
                    .get("x-request-id")
                    .and_then(|value| value.to_str().ok())
                    .unwrap_or(""),
            )
        });
    let token = match token {
        Ok(v) => v,
        Err(e) => return e,
    };
    match TransactionService::new(SeaOrmLedgerRepository::new(state.db))
        .restore(id, token, expected)
        .await
    {
        Ok(v) => (
            StatusCode::OK,
            Json(MutationResponse {
                data: v.transaction,
                data_revision: v.data_revision,
            }),
        )
            .into_response(),
        Err(e) => e.into_response(),
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CategoryBody {
    name: String,
    kind: String,
    emoji: String,
    color: String,
    semantic_key: Option<String>,
    sort_order: i32,
}
#[derive(serde::Deserialize)]
struct NameBody {
    name: String,
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct LabelPatch {
    name: Option<String>,
    active: Option<bool>,
}
async fn create_category(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(b): Json<CategoryBody>,
) -> Response {
    let e = match revision(&headers) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let r = LabelService::new(SeaOrmLedgerRepository::new(state.db))
        .create_category(
            crate::application::dto::CreateCategory {
                name: b.name,
                kind: b.kind,
                emoji: b.emoji,
                color: b.color,
                semantic_key: b.semantic_key,
                sort_order: b.sort_order,
            },
            e,
        )
        .await;
    mutation(r)
}
async fn rename_category(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<uuid::Uuid>,
    Json(b): Json<LabelPatch>,
) -> Response {
    let e = match revision(&headers) {
        Ok(v) => v,
        Err(e) => return e,
    };
    if b.active == Some(false) {
        return mutation(
            LabelService::new(SeaOrmLedgerRepository::new(state.db))
                .deactivate_category(id, e)
                .await,
        );
    }
    match b.name {
        Some(name) => mutation(
            LabelService::new(SeaOrmLedgerRepository::new(state.db))
                .rename_category(id, name, e)
                .await,
        ),
        None => error::problem(
            "label.patch_invalid",
            StatusCode::UNPROCESSABLE_ENTITY,
            headers
                .get("x-request-id")
                .and_then(|value| value.to_str().ok())
                .unwrap_or(""),
        ),
    }
}
async fn deactivate_category(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<uuid::Uuid>,
) -> Response {
    let e = match revision(&headers) {
        Ok(v) => v,
        Err(e) => return e,
    };
    mutation(
        LabelService::new(SeaOrmLedgerRepository::new(state.db))
            .deactivate_category(id, e)
            .await,
    )
}
async fn delete_category(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<uuid::Uuid>,
) -> Response {
    let e = match revision(&headers) {
        Ok(v) => v,
        Err(e) => return e,
    };
    mutation(
        LabelService::new(SeaOrmLedgerRepository::new(state.db))
            .delete_category(id, e)
            .await,
    )
}
async fn create_account(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(b): Json<NameBody>,
) -> Response {
    let e = match revision(&headers) {
        Ok(v) => v,
        Err(e) => return e,
    };
    mutation(
        LabelService::new(SeaOrmLedgerRepository::new(state.db))
            .create_account(crate::application::dto::CreateAccount { name: b.name }, e)
            .await,
    )
}
async fn rename_account(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<uuid::Uuid>,
    Json(b): Json<LabelPatch>,
) -> Response {
    let e = match revision(&headers) {
        Ok(v) => v,
        Err(e) => return e,
    };
    if b.active == Some(false) {
        return mutation(
            LabelService::new(SeaOrmLedgerRepository::new(state.db))
                .deactivate_account(id, e)
                .await,
        );
    }
    match b.name {
        Some(name) => mutation(
            LabelService::new(SeaOrmLedgerRepository::new(state.db))
                .rename_account(id, name, e)
                .await,
        ),
        None => error::problem(
            "label.patch_invalid",
            StatusCode::UNPROCESSABLE_ENTITY,
            headers
                .get("x-request-id")
                .and_then(|value| value.to_str().ok())
                .unwrap_or(""),
        ),
    }
}
async fn deactivate_account(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<uuid::Uuid>,
) -> Response {
    let e = match revision(&headers) {
        Ok(v) => v,
        Err(e) => return e,
    };
    mutation(
        LabelService::new(SeaOrmLedgerRepository::new(state.db))
            .deactivate_account(id, e)
            .await,
    )
}
fn mutation<T: serde::Serialize>(
    r: Result<crate::application::dto::Mutation<T>, crate::application::AppError>,
) -> Response {
    match r {
        Ok(v) => (
            StatusCode::OK,
            Json(MutationResponse {
                data: v.value,
                data_revision: v.data_revision,
            }),
        )
            .into_response(),
        Err(e) => e.into_response(),
    }
}
async fn reorder_categories(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(ids): Json<Vec<uuid::Uuid>>,
) -> Response {
    let e = match revision(&headers) {
        Ok(v) => v,
        Err(e) => return e,
    };
    mutation(
        LabelService::new(SeaOrmLedgerRepository::new(state.db))
            .reorder_categories(ids, e)
            .await,
    )
}
async fn migrate_category(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<uuid::Uuid>,
    Json(b): Json<serde_json::Value>,
) -> Response {
    let e = match revision(&headers) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let to = b
        .get("toCategoryId")
        .and_then(|x| x.as_str())
        .and_then(|x| uuid::Uuid::parse_str(x).ok())
        .ok_or_else(|| {
            error::problem(
                "category.target_invalid",
                StatusCode::UNPROCESSABLE_ENTITY,
                headers
                    .get("x-request-id")
                    .and_then(|value| value.to_str().ok())
                    .unwrap_or(""),
            )
        });
    let to = match to {
        Ok(v) => v,
        Err(e) => return e,
    };
    mutation(
        LabelService::new(SeaOrmLedgerRepository::new(state.db))
            .migrate_category(id, to, e)
            .await,
    )
}
async fn get_overview(
    State(state): State<AppState>,
    Query(q): Query<TransactionQueryParams>,
) -> Response {
    let p = match dto::parse_period(q.month, q.start, q.end) {
        Ok(v) => v,
        Err(e) => return e.into_response(),
    };
    match overview(&SeaOrmLedgerRepository::new(state.db), p, q.account_id).await {
        Ok((data, insights, revision)) => (
            StatusCode::OK,
            Json(serde_json::json!({"data":data,"insights":insights,"dataRevision":revision})),
        )
            .into_response(),
        Err(e) => e.into_response(),
    }
}
async fn get_report(
    State(state): State<AppState>,
    Query(q): Query<TransactionQueryParams>,
) -> Response {
    let p = match dto::parse_period(q.month, q.start, q.end) {
        Ok(v) => v,
        Err(e) => return e.into_response(),
    };
    match monthly_report(&SeaOrmLedgerRepository::new(state.db), p, q.account_id).await {
        Ok((data, revision)) => (
            StatusCode::OK,
            Json(serde_json::json!({"data":data,"dataRevision":revision})),
        )
            .into_response(),
        Err(e) => e.into_response(),
    }
}
