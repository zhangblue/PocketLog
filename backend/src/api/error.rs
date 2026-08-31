//! API 错误的稳定协议边界。
//!
//! `/api/` 和 `/health/` 下，无论错误来自领域服务还是 Axum 提取器，都会归一为
//! Problem Details；调用方据此区分字段错误、是否可重试以及可关联日志的请求 ID，而不依赖内部错误文本。

use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldError {
    /// 为未来字段级校验保留的稳定结构；不包含原始异常、SQL 或敏感输入。
    pub field: String,
    pub code: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProblemDetails {
    /// 所有 API/健康检查失败响应的统一载体，供客户端重试判断和运维按 request_id 关联日志。
    pub code: String,
    pub title: String,
    pub detail: String,
    pub field_errors: Vec<FieldError>,
    pub request_id: String,
    pub retryable: bool,
}

impl ProblemDetails {
    pub fn new(code: impl Into<String>, status: StatusCode, request_id: &str) -> Self {
        // `retryable` 由 HTTP 状态统一推导，避免某个处理器忘记设置而误导客户端重试。
        let code = code.into();
        Self {
            title: status.canonical_reason().unwrap_or("Error").into(),
            detail: code.clone(),
            code,
            field_errors: vec![],
            request_id: request_id.into(),
            retryable: status.is_server_error(),
        }
    }
}

pub fn problem(code: impl Into<String>, status: StatusCode, request_id: &str) -> Response {
    // 语义别名保留给处理器调用；具体序列化集中在带 request_id 的函数，防止响应头不一致。
    problem_with_request_id(code, status, request_id)
}

pub fn problem_with_request_id(
    code: impl Into<String>,
    status: StatusCode,
    request_id: &str,
) -> Response {
    // 同时写入响应体和 `x-error-code`，让浏览器客户端与日志/网关都能稳定识别错误。
    let code = code.into();
    let mut response = (
        status,
        [("content-type", "application/problem+json")],
        Json(ProblemDetails::new(&code, status, request_id)),
    )
        .into_response();
    if let Ok(value) = code.parse() {
        response.headers_mut().insert("x-error-code", value);
    }
    response
}

pub fn status_for(code: &str) -> StatusCode {
    // 错误码到状态码的映射是公共契约；未知码按服务端错误处理，避免把未分类故障伪装成
    // 可由用户修正的输入错误。
    if code.contains("not_found") {
        StatusCode::NOT_FOUND
    } else if code == "revision_header_invalid" || code == "idempotency_key_missing" {
        StatusCode::BAD_REQUEST
    } else if code.contains("conflict") || code.contains("reused") || code.contains("inactive") {
        StatusCode::CONFLICT
    } else if code.starts_with("query.")
        || code.starts_with("transaction.")
        || code.starts_with("amount.")
        || code.starts_with("time.")
        || code.starts_with("custom_icon.")
        || code.ends_with("_invalid")
    {
        StatusCode::UNPROCESSABLE_ENTITY
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    }
}

pub fn app_error(error: crate::application::AppError) -> Response {
    // 响应被中间件统一化时会补入权威请求 ID；这里不再次生成 ID，避免同一请求出现两个关联号。
    problem(error.code(), status_for(error.code()), "")
}

impl IntoResponse for crate::application::AppError {
    fn into_response(self) -> Response {
        app_error(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn problem_details_and_response_headers_keep_the_problem_contract() {
        let details = ProblemDetails::new("transaction.conflict", StatusCode::CONFLICT, "req-1");
        assert_eq!(details.title, "Conflict");
        assert_eq!(details.detail, "transaction.conflict");
        assert!(!details.retryable);
        assert_eq!(details.request_id, "req-1");

        let response = problem("query.invalid", StatusCode::UNPROCESSABLE_ENTITY, "req-2");
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            response.headers()["content-type"],
            "application/problem+json"
        );
        assert_eq!(response.headers()["x-error-code"], "query.invalid");
        assert!(
            ProblemDetails::new("internal", StatusCode::INTERNAL_SERVER_ERROR, "req-3").retryable
        );
    }

    #[test]
    fn status_mapping_distinguishes_known_client_errors_and_unknown_errors() {
        for (code, expected) in [
            ("label.not_found", StatusCode::NOT_FOUND),
            ("revision_header_invalid", StatusCode::BAD_REQUEST),
            ("idempotency_key_missing", StatusCode::BAD_REQUEST),
            ("transaction.conflict", StatusCode::CONFLICT),
            ("account.inactive", StatusCode::CONFLICT),
            ("query.invalid", StatusCode::UNPROCESSABLE_ENTITY),
            ("amount.invalid", StatusCode::UNPROCESSABLE_ENTITY),
            ("time.invalid", StatusCode::UNPROCESSABLE_ENTITY),
            ("date_invalid", StatusCode::UNPROCESSABLE_ENTITY),
            ("custom_icon.empty", StatusCode::UNPROCESSABLE_ENTITY),
            ("unexpected", StatusCode::INTERNAL_SERVER_ERROR),
        ] {
            assert_eq!(status_for(code), expected, "code={code}");
        }
    }

    #[test]
    fn app_error_response_uses_status_mapping_and_empty_fallback_request_id() {
        let response = app_error(crate::application::AppError::new("label.not_found"));
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(response.headers()["x-error-code"], "label.not_found");
    }
}
