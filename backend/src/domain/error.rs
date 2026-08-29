//! 领域错误只暴露稳定错误码和面向用户的短消息，避免泄漏基础设施细节。

use std::fmt;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DomainError {
    code: &'static str,
    message: &'static str,
}

impl DomainError {
    pub(crate) const fn new(code: &'static str, message: &'static str) -> Self {
        Self { code, message }
    }

    pub const fn code(&self) -> &'static str {
        self.code
    }
}

impl fmt::Display for DomainError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.message)
    }
}

impl std::error::Error for DomainError {}
