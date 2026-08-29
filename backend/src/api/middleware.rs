//! 请求级横切策略：关联请求 ID、安全响应头，以及统一化框架拒绝响应。

use axum::{
    body::{Body, to_bytes},
    http::{Request, Response},
    middleware::Next,
};
use uuid::Uuid;

pub async fn request_id(mut request: Request<Body>, next: Next) -> Response<Body> {
    // 此中间件应位于错误归一化的外层，让所有成功/失败响应都带同一个关联号和基础安全头。
    // 优先保留能从请求头读出的非空 ID，便于端到端追踪；请求头缺失、为空或不能转成
    // 字符串时才生成 UUID。
    let id = request
        .headers()
        .get("x-request-id")
        .and_then(|v| v.to_str().ok())
        .filter(|v| !v.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    request.extensions_mut().insert(id.clone());
    // 同时放入请求头和扩展：处理器可直接构造带关联号的响应，追踪层也能从扩展读取它。
    if let Ok(value) = id.parse() {
        request.headers_mut().insert("x-request-id", value);
    }
    let mut response = next.run(request).await;
    if let Ok(value) = id.parse() {
        response.headers_mut().insert("x-request-id", value);
    }
    response.headers_mut().insert(
        "x-content-type-options",
        axum::http::HeaderValue::from_static("nosniff"),
    );
    response.headers_mut().insert(
        "x-frame-options",
        axum::http::HeaderValue::from_static("DENY"),
    );
    response
}

/// 将提取器和 tower 拒绝统一转换为与应用错误相同的 Problem Details 契约。
pub async fn normalize_errors(request: Request<Body>, next: Next) -> Response<Body> {
    // 只改写 API/健康检查的非成功响应；SPA 的 HTML 兜底必须原样返回，否则前端路由
    // 刷新会收到 JSON 错误而无法启动。
    let is_api =
        request.uri().path().starts_with("/api/") || request.uri().path().starts_with("/health/");
    let request_id = request
        .extensions()
        .get::<String>()
        .cloned()
        .unwrap_or_default();
    // 先让路由/提取器产生原始响应，再仅在协议边界转化。限制读取 1 MiB 是防御性上限：
    // 错误归一化不能因异常大响应体反过来成为内存放大入口。
    let response = next.run(request).await;
    if !is_api
        || response.status().is_success()
        || response.status() == axum::http::StatusCode::NOT_FOUND
            && response
                .headers()
                .get(axum::http::header::CONTENT_TYPE)
                .is_some_and(|v| v.to_str().unwrap_or_default().starts_with("text/html"))
    {
        return response;
    }
    let status = response.status();
    let (mut parts, body) = response.into_parts();
    let bytes = to_bytes(body, 1024 * 1024).await.unwrap_or_default();
    let mut value: serde_json::Value =
        serde_json::from_slice(&bytes).unwrap_or_else(|_| serde_json::json!({}));
    // 提取器拒绝通常没有应用层错误码，因此按状态码补上稳定的通用码，并保留已有 detail。
    let code = value
        .get("code")
        .and_then(|v| v.as_str())
        .map(str::to_owned)
        .unwrap_or_else(|| {
            match status.as_u16() {
                400 => "request.invalid",
                405 => "method.not_allowed",
                408 => "request.timeout",
                413 => "request.body_too_large",
                _ => "request.invalid",
            }
            .to_owned()
        });
    let mut details = crate::api::error::ProblemDetails::new(&code, status, &request_id);
    if let Some(existing) = value.get("detail").and_then(|v| v.as_str()) {
        details.detail = existing.to_owned();
    }
    value = serde_json::to_value(details)
        .unwrap_or_else(|_| serde_json::json!({"code":"request.invalid","requestId":request_id}));
    if let Some(object) = value.as_object_mut() {
        object.insert(
            "requestId".to_owned(),
            serde_json::Value::String(request_id.clone()),
        );
    }
    if let Ok(value) = code.parse() {
        parts.headers.insert("x-error-code", value);
    }
    parts.headers.insert(
        axum::http::header::CONTENT_TYPE,
        axum::http::HeaderValue::from_static("application/problem+json"),
    );
    Response::from_parts(
        parts,
        Body::from(serde_json::to_vec(&value).unwrap_or_default()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        Router,
        body::to_bytes,
        http::{StatusCode, header},
        middleware,
        response::IntoResponse,
        routing::get,
    };
    use tower::ServiceExt;

    fn app() -> Router {
        Router::new()
            .route(
                "/api/fail",
                get(|| async { (StatusCode::BAD_REQUEST, "bad") }),
            )
            .route(
                "/api/json",
                get(|| async {
                    (
                        StatusCode::BAD_REQUEST,
                        axum::Json(serde_json::json!({"code":"custom","detail":"kept"})),
                    )
                }),
            )
            .route(
                "/api/html",
                get(|| async {
                    (
                        StatusCode::NOT_FOUND,
                        [(header::CONTENT_TYPE, "text/html")],
                        "fallback",
                    )
                }),
            )
            .route(
                "/health/fail",
                get(|| async { StatusCode::REQUEST_TIMEOUT.into_response() }),
            )
            .route(
                "/web/fail",
                get(|| async { (StatusCode::BAD_REQUEST, "web") }),
            )
            .route("/api/ok", get(|| async { "ok" }))
            .layer(middleware::from_fn(normalize_errors))
            .layer(middleware::from_fn(request_id))
    }

    #[tokio::test]
    async fn request_id_preserves_valid_input_and_generates_missing_id() {
        let app = app();
        let response = app
            .clone()
            .oneshot(
                Request::get("/api/ok")
                    .header("x-request-id", "client-1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.headers()["x-request-id"], "client-1");
        assert_eq!(response.headers()["x-content-type-options"], "nosniff");
        assert_eq!(response.headers()["x-frame-options"], "DENY");

        let response = app
            .oneshot(Request::get("/api/ok").body(Body::empty()).unwrap())
            .await
            .unwrap();
        let generated = response.headers()["x-request-id"].to_str().unwrap();
        assert!(!generated.is_empty());
        assert!(Uuid::parse_str(generated).is_ok());
    }

    #[tokio::test]
    async fn normalize_errors_maps_api_rejections_and_preserves_request_id() {
        let response = app()
            .oneshot(
                Request::get("/api/fail")
                    .header("x-request-id", "req-400")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            response.headers()["content-type"],
            "application/problem+json"
        );
        assert_eq!(response.headers()["x-error-code"], "request.invalid");
        assert_eq!(response.headers()["x-request-id"], "req-400");
        let value: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 1024 * 1024).await.unwrap())
                .unwrap();
        assert_eq!(value["requestId"], "req-400");
        assert_eq!(value["code"], "request.invalid");

        let response = app()
            .oneshot(Request::get("/health/fail").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::REQUEST_TIMEOUT);
        assert_eq!(response.headers()["x-error-code"], "request.timeout");
    }

    #[tokio::test]
    async fn normalize_errors_keeps_custom_details_and_non_api_or_html_responses() {
        let response = app()
            .oneshot(Request::get("/api/json").body(Body::empty()).unwrap())
            .await
            .unwrap();
        let value: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 1024 * 1024).await.unwrap())
                .unwrap();
        assert_eq!(value["code"], "custom");
        assert_eq!(value["detail"], "kept");

        let response = app()
            .oneshot(Request::get("/web/fail").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(
            response.headers()["content-type"],
            "text/plain; charset=utf-8"
        );
        assert_eq!(
            to_bytes(response.into_body(), 1024 * 1024).await.unwrap(),
            "web"
        );

        let response = app()
            .oneshot(Request::get("/api/html").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(response.headers()["content-type"], "text/html");
        assert_eq!(
            to_bytes(response.into_body(), 1024 * 1024).await.unwrap(),
            "fallback"
        );
    }
}
