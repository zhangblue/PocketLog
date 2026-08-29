//! HTTP 层公共边界：协议 DTO、错误契约、中间件与路由组装。

pub mod dto;
pub mod error;
pub mod middleware;
pub mod router;

pub use router::{AppState, build_router};
