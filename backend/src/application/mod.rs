//! 应用层负责把请求意图编排成可提交的用例，并通过端口访问账本存储。
//! 事务、修订版本和只读分析快照的边界由服务统一协调。

pub mod bootstrap;
pub mod clock;
pub mod dto;
pub mod insights;
pub mod labels;
pub mod ports;
pub mod transactions;

pub use dto::{AppError, AppStateSnapshot, BootstrapSnapshot, DataRevision};
