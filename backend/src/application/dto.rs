//! 应用层在仓储、服务与 API 之间传递的稳定数据结构。

use std::fmt;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct DataRevision(i64);

impl DataRevision {
    pub const fn new(value: i64) -> Self {
        Self(value)
    }

    pub const fn value(self) -> i64 {
        self.0
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppStateSnapshot {
    pub seed_version: i32,
    pub data_revision: DataRevision,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CategoryDto {
    pub id: Uuid,
    pub name: String,
    pub kind: String,
    pub emoji: String,
    pub color: String,
    pub semantic_key: Option<String>,
    pub sort_order: i32,
    pub active: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccountDto {
    pub id: Uuid,
    pub name: String,
    pub active: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CreateCategory {
    pub name: String,
    pub kind: String,
    pub emoji: String,
    pub color: String,
    pub semantic_key: Option<String>,
    pub sort_order: i32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CreateAccount {
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Mutation<T> {
    pub value: T,
    pub data_revision: DataRevision,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BootstrapSnapshot {
    pub categories: Vec<CategoryDto>,
    pub accounts: Vec<AccountDto>,
    pub months: Vec<String>,
    pub data_revision: DataRevision,
    pub server_time: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppError {
    code: &'static str,
}

impl AppError {
    pub const fn new(code: &'static str) -> Self {
        Self { code }
    }

    pub const fn code(&self) -> &'static str {
        self.code
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.code)
    }
}

impl std::error::Error for AppError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_revision_is_ordered_and_serializes_as_a_number() {
        let low = DataRevision::new(2);
        let high = DataRevision::new(3);
        assert!(low < high);
        assert_eq!(low.value(), 2);
        assert_eq!(serde_json::to_string(&high).unwrap(), "3");
        assert_eq!(serde_json::from_str::<DataRevision>("3").unwrap(), high);
    }

    #[test]
    fn dto_structs_round_trip_json_and_app_error_is_displayable() {
        let id = Uuid::new_v4();
        let category = CategoryDto {
            id,
            name: "餐饮".into(),
            kind: "expense".into(),
            emoji: "🍜".into(),
            color: "#FFFFFF".into(),
            semantic_key: Some("food".into()),
            sort_order: 1,
            active: true,
        };
        let json = serde_json::to_value(&category).unwrap();
        assert_eq!(json["semantic_key"], "food");
        assert_eq!(
            serde_json::from_value::<CategoryDto>(json).unwrap(),
            category
        );
        let error = AppError::new("example.failure");
        assert_eq!(error.code(), "example.failure");
        assert_eq!(error.to_string(), "example.failure");
    }
}
