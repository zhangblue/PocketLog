//! 可替换的时钟抽象：生产环境取 UTC，测试用固定时刻复现边界条件。

use chrono::Utc;

use crate::domain::UtcInstant;

pub trait Clock: Send + Sync {
    fn now(&self) -> UtcInstant;
}

#[derive(Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> UtcInstant {
        UtcInstant::parse(&Utc::now().to_rfc3339()).expect("UTC always formats as RFC 3339")
    }
}

#[derive(Clone)]
pub struct FixedClock(UtcInstant);

impl FixedClock {
    pub fn at(rfc3339: &str) -> Self {
        Self(UtcInstant::parse(rfc3339).expect("fixed clock must use RFC 3339"))
    }
}

impl Clock for FixedClock {
    fn now(&self) -> UtcInstant {
        self.0.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixed_clock_preserves_the_exact_instant() {
        let clock = FixedClock::at("2026-08-27T12:34:56+08:00");
        assert_eq!(clock.now().to_rfc3339(), "2026-08-27T04:34:56+00:00");
    }

    #[test]
    fn system_clock_returns_a_parseable_current_instant() {
        let now = SystemClock.now();
        assert!(now.to_rfc3339().ends_with("+00:00"));
    }
}
