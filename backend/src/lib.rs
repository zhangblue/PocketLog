//! 后端 crate 的公开分层入口。
//!
//! 这里不放实现逻辑，只声明领域、应用、HTTP 与基础设施四层的边界，让调用方和维护者
//! 能从模块名直接定位职责归属。基础设施层承载 SeaORM、Axum、文件系统等外部适配，
//! 上层只通过应用服务与 port 协作，避免把具体框架细节扩散到整个代码库。
pub mod api;
pub mod application;
pub mod command;
pub mod config;
pub mod domain;
pub mod infrastructure;
pub mod migration;
pub mod package;
pub mod release;
