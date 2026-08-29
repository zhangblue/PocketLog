//! 金额值对象：Decimal 保留最多两位小数；业务写入通过 `parse` 拒绝非正数和溢出，
//! 而 `Money::zero()` 提供汇总初始化所需的合法中性值。

use rust_decimal::Decimal;
use std::str::FromStr;

use super::DomainError;

const MAX_CENTS: i128 = 999_999_999_999_999_999;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Money(Decimal);

impl Money {
    pub fn parse(raw: &str) -> Result<Self, DomainError> {
        // 使用 Decimal 而非浮点数，确保金额校验、入库、汇总和 API 两位小数格式不会累积二进制误差。
        let amount = Decimal::from_str(raw)
            .map_err(|_| DomainError::new("amount.invalid", "amount is invalid"))?;
        if amount.scale() > 2 {
            return Err(DomainError::new(
                "amount.scale_exceeded",
                "amount cannot have more than two decimal places",
            ));
        }
        if amount <= Decimal::ZERO {
            return Err(DomainError::new(
                "amount.not_positive",
                "amount must be positive",
            ));
        }
        if amount > max_amount() {
            return Err(DomainError::new(
                "amount.out_of_range",
                "amount is out of range",
            ));
        }
        Ok(Self(amount))
    }

    pub const fn zero() -> Self {
        // 零仅用于计算初值，不能由外部写入路径构造一笔零金额交易。
        Self(Decimal::ZERO)
    }

    pub fn checked_add(self, rhs: Self) -> Result<Self, DomainError> {
        // 汇总也必须遵守同一上限，不能因加总绕过单笔金额校验。
        let amount = self
            .0
            .checked_add(rhs.0)
            .filter(|amount| *amount <= max_amount())
            .ok_or_else(|| DomainError::new("amount.out_of_range", "amount is out of range"))?;
        Ok(Self(amount))
    }

    pub fn to_api_string(&self) -> String {
        // 协议层以字符串传递金额，固定两位小数让前端不必猜测 Decimal 的 scale。
        format!("{:.2}", self.0)
    }
}

fn max_amount() -> Decimal {
    // 上限以分存储后再转换为 Decimal，避免散落的浮点字面量和精度歧义。
    Decimal::from_i128_with_scale(MAX_CENTS, 2)
}
