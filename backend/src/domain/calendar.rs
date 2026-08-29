//! 与宿主时区无关的日期/时间值对象，保留用户输入的本地日期。

use chrono::{DateTime, FixedOffset, NaiveDate, NaiveTime, Utc};

use super::DomainError;

pub use chrono::Duration;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct LocalDate(NaiveDate);

impl LocalDate {
    pub fn is_weekend(&self) -> bool {
        // 周末语义属于用户录入地的日期，不从 UTC instant 推导，避免跨时区交易被错误归类。
        use chrono::Datelike;

        self.0.weekday().number_from_monday() >= 6
    }
}

impl std::fmt::Display for LocalDate {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct LocalTime(NaiveTime);

impl std::fmt::Display for LocalTime {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OccurredAt {
    /// 同时保存本地日期、时间与偏移：统计按本地日，排序/审计仍可还原为绝对时间。
    local_date: LocalDate,
    local_time: LocalTime,
    utc_offset_minutes: i16,
}

impl OccurredAt {
    pub fn parse(rfc3339: &str) -> Result<Self, DomainError> {
        // 月份、周末和报表按用户本地日期计算，不能用服务进程时区重新推导。
        let parsed = parse_with_bounded_offset(rfc3339)?;
        Ok(Self {
            local_date: LocalDate(parsed.date_naive()),
            local_time: LocalTime(parsed.time()),
            utc_offset_minutes: (parsed.offset().local_minus_utc() / 60) as i16,
        })
    }

    pub const fn local_date(&self) -> LocalDate {
        // 仅返回值对象副本，不暴露 chrono 的可变解析细节给上层。
        self.local_date
    }

    pub const fn local_time(&self) -> LocalTime {
        self.local_time
    }

    pub const fn utc_offset_minutes(&self) -> i16 {
        self.utc_offset_minutes
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UtcInstant(DateTime<Utc>);

impl UtcInstant {
    pub fn parse(rfc3339: &str) -> Result<Self, DomainError> {
        Ok(Self(
            parse_with_bounded_offset(rfc3339)?.with_timezone(&Utc),
        ))
    }

    pub fn checked_add(self, duration: Duration) -> Result<Self, DomainError> {
        // 删除撤销窗口等派生时间必须检测 chrono 溢出，不能在边界年份静默回绕。
        self.0
            .checked_add_signed(duration)
            .map(Self)
            .ok_or_else(|| DomainError::new("time.out_of_range", "time is out of range"))
    }

    pub fn to_rfc3339(&self) -> String {
        self.0.to_rfc3339()
    }

    pub(crate) fn as_chrono(&self) -> DateTime<Utc> {
        // 限制为 crate 内适配层使用，领域外部仍以 RFC3339 字符串交换时间，避免时区语义丢失。
        self.0
    }
}

fn parse_with_bounded_offset(rfc3339: &str) -> Result<DateTime<FixedOffset>, DomainError> {
    // 限制偏移量让本地日期与 UTC 转换保持在可解释的范围内。
    let value = DateTime::parse_from_rfc3339(rfc3339)
        .map_err(|_| DomainError::new("time.invalid", "time is invalid"))?;
    if value.offset().local_minus_utc().abs() > 14 * 60 * 60 {
        return Err(DomainError::new(
            "time.offset_out_of_range",
            "UTC offset must be between -14:00 and +14:00",
        ));
    }
    Ok(value)
}
