//! 分类和账户标签值对象及其生命周期不变量。

use super::DomainError;
use uuid::Uuid;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct CategoryId(i64);

impl CategoryId {
    pub const fn new(value: i64) -> Self {
        Self(value)
    }
}

impl From<i64> for CategoryId {
    fn from(value: i64) -> Self {
        Self::new(value)
    }
}

impl From<Uuid> for CategoryId {
    fn from(value: Uuid) -> Self {
        // 兼容早期领域接口的轻量标识转换；持久化与 API 始终使用完整 UUID，不能把该值当数据库主键。
        let bits = value.as_u128();
        Self::new((bits as u64 ^ (bits >> 64) as u64) as i64)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct AccountId(i64);

impl AccountId {
    pub const fn new(value: i64) -> Self {
        Self(value)
    }
}

impl From<i64> for AccountId {
    fn from(value: i64) -> Self {
        Self::new(value)
    }
}

impl From<Uuid> for AccountId {
    fn from(value: Uuid) -> Self {
        let bits = value.as_u128();
        Self::new((bits as u64 ^ (bits >> 64) as u64) as i64)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CategoryKind {
    Expense,
    Income,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Category {
    /// 分类的领域投影，包含停用和排序所需字段；历史交易可继续引用停用分类。
    pub id: CategoryId,
    pub kind: CategoryKind,
    pub name: String,
    pub emoji: String,
    pub color: String,
    pub active: bool,
    pub sort_order: i32,
}

impl Category {
    pub fn new(
        id: CategoryId,
        kind: CategoryKind,
        name: impl AsRef<str>,
        color: impl AsRef<str>,
        active: bool,
        sort_order: i32,
    ) -> Result<Self, DomainError> {
        Self::new_with_emoji(id, kind, name, "🏷️", color, active, sort_order)
    }

    pub fn new_with_emoji(
        id: CategoryId,
        kind: CategoryKind,
        name: impl AsRef<str>,
        emoji: impl AsRef<str>,
        color: impl AsRef<str>,
        active: bool,
        sort_order: i32,
    ) -> Result<Self, DomainError> {
        Ok(Self {
            id,
            kind,
            name: normalize_label_name(name.as_ref())?,
            emoji: normalize_emoji(emoji.as_ref())?,
            color: normalize_color(color.as_ref())?,
            active,
            sort_order,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AccountLabel {
    /// 账户标签只描述交易归属，不代表资产余额；停用只影响新建交易候选项。
    pub id: AccountId,
    pub name: String,
    pub active: bool,
}

impl AccountLabel {
    pub fn new(id: AccountId, name: impl AsRef<str>, active: bool) -> Result<Self, DomainError> {
        Ok(Self {
            id,
            name: normalize_label_name(name.as_ref())?,
            active,
        })
    }
}

pub fn validate_category_deactivation(
    target: &Category,
    all: &[Category],
) -> Result<(), DomainError> {
    // 至少保留一个启用分类的限制按收入/支出分别执行，保证两类新交易永远都能合法创建。
    // 每种收支至少保留一个启用分类，保证新交易始终有合法归属。
    let remaining = all
        .iter()
        .filter(|category| {
            category.id != target.id && category.active && category.kind == target.kind
        })
        .count();
    if target.active && remaining == 0 {
        return Err(DomainError::new(
            "category.last_active_for_kind",
            "at least one active category is required for each kind",
        ));
    }
    Ok(())
}

pub fn validate_category_migration(
    source: &Category,
    target: &Category,
) -> Result<(), DomainError> {
    // 迁移前后必须同属收入或支出，并且目标启用；这让批量改指向不会改变旧交易的业务含义。
    // 迁移只能在同类型启用分类之间进行，避免改变收支语义。
    if source.id == target.id {
        return Err(DomainError::new(
            "category.migration_same_target",
            "a category cannot be migrated to itself",
        ));
    }
    if source.kind != target.kind {
        return Err(DomainError::new(
            "category.migration_kind_mismatch",
            "categories can only be migrated within the same kind",
        ));
    }
    if !target.active {
        return Err(DomainError::new(
            "category.migration_target_inactive",
            "migration target must be active",
        ));
    }
    Ok(())
}

pub fn validate_account_deactivation(
    target: &AccountLabel,
    all: &[AccountLabel],
) -> Result<(), DomainError> {
    // 账户没有“至少一个启用”限制，但已停用标签不可再次停用，调用方据此返回稳定冲突错误。
    if !all.iter().any(|account| account.id == target.id) {
        return Err(DomainError::new(
            "account.not_found",
            "account does not exist",
        ));
    }
    let remaining_active = all
        .iter()
        .filter(|account| account.id != target.id && account.active)
        .count();
    if target.active && remaining_active == 0 {
        return Err(DomainError::new(
            "account.last_active",
            "at least one active account is required",
        ));
    }
    Ok(())
}

pub fn validate_complete_order(
    current: &[CategoryId],
    requested: &[CategoryId],
) -> Result<(), DomainError> {
    // 重排请求必须给出所有分类恰好一次，防止并发页面只提交局部拖拽结果导致未提交分类顺序丢失。
    // 排序请求必须是完整排列，避免遗漏分类后悄悄丢失旧顺序。
    if current.len() != requested.len() {
        return Err(DomainError::new(
            "category.order_incomplete",
            "the requested order must include every category exactly once",
        ));
    }
    let mut current = current.to_vec();
    let mut requested = requested.to_vec();
    current.sort_unstable();
    requested.sort_unstable();
    if current != requested || requested.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(DomainError::new(
            "category.order_invalid",
            "the requested order must include every category exactly once",
        ));
    }
    Ok(())
}

fn normalize_label_name(raw: &str) -> Result<String, DomainError> {
    let normalized = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    let length = normalized.chars().count();
    if !(1..=40).contains(&length) {
        return Err(DomainError::new(
            "label.name_length_invalid",
            "label name must contain 1 to 40 characters",
        ));
    }
    Ok(normalized)
}

fn normalize_color(raw: &str) -> Result<String, DomainError> {
    let color = raw.trim();
    let valid = color.len() == 7
        && color.starts_with('#')
        && color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit);
    if !valid {
        return Err(DomainError::new(
            "category.color_invalid",
            "category color must use #RRGGBB format",
        ));
    }
    Ok(color.to_ascii_uppercase())
}

fn normalize_emoji(raw: &str) -> Result<String, DomainError> {
    let emoji = raw.trim();
    if !(1..=16).contains(&emoji.chars().count()) {
        return Err(DomainError::new(
            "category.emoji_length_invalid",
            "category emoji must contain 1 to 16 Unicode characters",
        ));
    }
    Ok(emoji.to_owned())
}
