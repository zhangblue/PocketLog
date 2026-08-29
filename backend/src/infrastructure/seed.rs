//! 首次启动演示数据初始化。
//!
//! 该模块只在 `app_state.seed_version == 0` 时写入演示分类、账户和交易，并通过事务与行锁
//! 保证并发启动下最多执行一次。它不承担迁移职责，也不会覆盖已经存在的用户数据。

use std::str::FromStr;

use chrono::DateTime;
use rust_decimal::Decimal;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ConnectionTrait, DatabaseConnection, DbBackend, Statement,
    TransactionTrait,
};
use uuid::Uuid;

use crate::{
    application::{AppError, clock::Clock},
    infrastructure::{
        entities::{account_label, app_state, category, transaction},
        repositories::database_error,
    },
};

// 首次账本的演示分类、账户和交易集中定义于此；版本门闩确保它们不会覆盖既有用户数据。
const FOOD: Uuid = Uuid::from_u128(0x10000000000000000000000000000001);
const TRANSPORT: Uuid = Uuid::from_u128(0x10000000000000000000000000000002);
const SHOPPING: Uuid = Uuid::from_u128(0x10000000000000000000000000000003);
const HOUSING: Uuid = Uuid::from_u128(0x10000000000000000000000000000004);
const ENTERTAINMENT: Uuid = Uuid::from_u128(0x10000000000000000000000000000005);
const SALARY: Uuid = Uuid::from_u128(0x10000000000000000000000000000006);
const WECHAT: Uuid = Uuid::from_u128(0x20000000000000000000000000000001);
const ALIPAY: Uuid = Uuid::from_u128(0x20000000000000000000000000000002);
const BANK: Uuid = Uuid::from_u128(0x20000000000000000000000000000003);
const CASH: Uuid = Uuid::from_u128(0x20000000000000000000000000000004);

type SeedCategory = (
    Uuid,
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    Option<&'static str>,
    i32,
);
type SeedTransaction = (
    u128,
    &'static str,
    &'static str,
    Uuid,
    Uuid,
    &'static str,
    &'static str,
    &'static str,
);

pub async fn seed_if_needed(db: &DatabaseConnection, clock: &impl Clock) -> Result<(), AppError> {
    // seed 的所有写入共用一个事务；任一演示数据失败都会回滚，避免半套初始账本。
    let transaction = db.begin().await.map_err(database_error)?;
    let result = seed_in_transaction(&transaction, clock).await;
    match result {
        Ok(()) => transaction.commit().await.map_err(database_error),
        Err(error) => {
            let _ = transaction.rollback().await;
            Err(error)
        }
    }
}

async fn seed_in_transaction(
    db: &sea_orm::DatabaseTransaction,
    clock: &impl Clock,
) -> Result<(), AppError> {
    // 单例状态行是 seed 门闩。使用 `FOR UPDATE` 后，其它并发启动只能等待当前事务提交，
    // 从而避免多个实例同时插入相同演示数据。
    let state = db
        .query_one(Statement::from_string(
            DbBackend::Postgres,
            "SELECT seed_version FROM app_state WHERE singleton = TRUE FOR UPDATE".to_owned(),
        ))
        .await
        .map_err(database_error)?
        .ok_or_else(|| AppError::new("app_state.missing"))?;
    // 锁住单例状态后再检查版本，保证并发启动只有一个请求能执行 seed；版本非零时保持用户数据不变。
    let seed_version: i32 = state.try_get_by_index(0).map_err(database_error)?;
    if seed_version != 0 {
        return Ok(());
    }

    // 统一采用同一次时钟读取作为所有 seed 行的审计时间，保证固定时钟测试可复现，也避免
    // 批量插入跨越时钟边界时出现难以解释的创建时间先后关系。
    let now = clock.now().as_chrono().fixed_offset();
    for (id, name, kind, emoji, color, semantic_key, sort_order) in categories() {
        category::ActiveModel {
            id: Set(id),
            name: Set(name.to_owned()),
            normalized_name: Set(normalize(name)),
            kind: Set(kind.to_owned()),
            emoji: Set(emoji.to_owned()),
            color: Set(color.to_owned()),
            semantic_key: Set(semantic_key.map(str::to_owned)),
            sort_order: Set(sort_order),
            active: Set(true),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(db)
        .await
        .map_err(database_error)?;
    }
    for (id, name) in accounts() {
        account_label::ActiveModel {
            id: Set(id),
            name: Set(name.to_owned()),
            normalized_name: Set(normalize(name)),
            active: Set(true),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(db)
        .await
        .map_err(database_error)?;
    }
    for (index, kind, amount, category_id, account_id, merchant, occurred_at, note) in
        transactions()
    {
        let occurred_at = DateTime::parse_from_rfc3339(occurred_at)
            .map_err(|_| AppError::new("seed.invalid_transaction"))?;
        transaction::ActiveModel {
            id: Set(Uuid::from_u128(0x30000000000000000000000000000000 + index)),
            kind: Set(kind.to_owned()),
            amount: Set(
                Decimal::from_str(amount).map_err(|_| AppError::new("seed.invalid_transaction"))?
            ),
            category_id: Set(Some(category_id)),
            account_id: Set(account_id),
            target_account_id: Set(None),
            merchant: Set(merchant.to_owned()),
            note: Set(note.to_owned()),
            occurred_at: Set(occurred_at),
            local_date: Set(occurred_at.date_naive()),
            local_time: Set(occurred_at.time()),
            utc_offset_minutes: Set((occurred_at.offset().local_minus_utc() / 60) as i16),
            pending_delete_until: Set(None),
            deletion_token: Set(None),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(db)
        .await
        .map_err(database_error)?;
    }
    // 所有基础数据都成功插入后才打开版本门闩；同一事务提交前其他启动实例仍会被 FOR UPDATE
    // 阻塞，提交后它们读取到版本 1 并无副作用地返回。
    app_state::ActiveModel {
        singleton: Set(true),
        seed_version: Set(1),
        data_revision: Set(1),
    }
    .update(db)
    .await
    .map_err(database_error)?;
    Ok(())
}

fn normalize(value: &str) -> String {
    // 与用户新建标签的标准化规则保持一致，保证演示数据也参与大小写/空白不敏感的唯一性约束。
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn categories() -> [SeedCategory; 6] {
    // sort_order 直接对应默认展示顺序；semantic_key 只给具备特殊洞察语义的分类保留。
    [
        (FOOD, "餐饮", "expense", "🍜", "#4F8A75", None, 0),
        (
            TRANSPORT,
            "交通",
            "expense",
            "🚕",
            "#E5A05E",
            Some("transport"),
            1,
        ),
        (SHOPPING, "购物", "expense", "🛍️", "#B98566", None, 2),
        (HOUSING, "居住", "expense", "🏠", "#8C9A7B", None, 3),
        (ENTERTAINMENT, "娱乐", "expense", "🎵", "#9C89B8", None, 4),
        (SALARY, "工资", "income", "💰", "#3F7663", None, 5),
    ]
}

fn accounts() -> [(Uuid, &'static str); 4] {
    // 账户仅作为交易归属标签，不参与余额计算，因此 seed 只需要名称，不需要初始余额。
    [
        (WECHAT, "微信"),
        (ALIPAY, "支付宝"),
        (BANK, "银行卡"),
        (CASH, "现金"),
    ]
}

fn transactions() -> [SeedTransaction; 17] {
    // 时间均为带偏移量的 RFC3339 文本，确保导入后可同时还原 UTC 时刻和本地自然日。
    [
        (
            1,
            "expense",
            "32.00",
            FOOD,
            WECHAT,
            "山丘咖啡",
            "2026-08-18T09:42:00+08:00",
            "早餐咖啡",
        ),
        (
            2,
            "expense",
            "46.00",
            TRANSPORT,
            ALIPAY,
            "城市出行",
            "2026-08-17T21:16:00+08:00",
            "晚间打车",
        ),
        (
            3,
            "expense",
            "128.60",
            SHOPPING,
            WECHAT,
            "鲜生活超市",
            "2026-08-17T18:30:00+08:00",
            "日用品",
        ),
        (
            4,
            "expense",
            "88.00",
            ENTERTAINMENT,
            BANK,
            "云海音乐",
            "2026-08-16T12:00:00+08:00",
            "年度会员",
        ),
        (
            5,
            "income",
            "12500.00",
            SALARY,
            BANK,
            "八月薪资",
            "2026-08-15T10:00:00+08:00",
            "工资到账",
        ),
        (
            6,
            "expense",
            "3200.00",
            HOUSING,
            BANK,
            "八月房租",
            "2026-08-14T08:00:00+08:00",
            "月租",
        ),
        (
            7,
            "expense",
            "680.40",
            FOOD,
            WECHAT,
            "本月食材",
            "2026-08-12T18:00:00+08:00",
            "多次采购合计",
        ),
        (
            8,
            "expense",
            "420.00",
            HOUSING,
            BANK,
            "水电燃气",
            "2026-08-10T09:00:00+08:00",
            "月度账单",
        ),
        (
            9,
            "expense",
            "899.00",
            SHOPPING,
            ALIPAY,
            "生活购物",
            "2026-08-08T16:00:00+08:00",
            "本月购物合计",
        ),
        (
            10,
            "expense",
            "1050.00",
            TRANSPORT,
            ALIPAY,
            "本月交通",
            "2026-08-02T20:00:00+08:00",
            "周末出行合计",
        ),
        (
            11,
            "expense",
            "298.00",
            FOOD,
            WECHAT,
            "朋友聚餐",
            "2026-08-03T19:30:00+08:00",
            "周末聚餐",
        ),
        (
            12,
            "expense",
            "1232.00",
            FOOD,
            WECHAT,
            "七月餐饮",
            "2026-07-30T20:00:00+08:00",
            "分类月度合计",
        ),
        (
            13,
            "expense",
            "979.00",
            TRANSPORT,
            ALIPAY,
            "七月交通",
            "2026-07-28T20:00:00+08:00",
            "分类月度合计",
        ),
        (
            14,
            "expense",
            "1093.00",
            SHOPPING,
            ALIPAY,
            "七月购物",
            "2026-07-26T20:00:00+08:00",
            "分类月度合计",
        ),
        (
            15,
            "expense",
            "4000.00",
            HOUSING,
            BANK,
            "七月居住",
            "2026-07-20T09:00:00+08:00",
            "分类月度合计",
        ),
        (
            16,
            "expense",
            "165.00",
            ENTERTAINMENT,
            WECHAT,
            "七月娱乐",
            "2026-07-18T19:00:00+08:00",
            "分类月度合计",
        ),
        (
            17,
            "income",
            "12500.00",
            SALARY,
            BANK,
            "七月薪资",
            "2026-07-15T10:00:00+08:00",
            "工资到账",
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_catalog_is_complete_and_stable() {
        let categories = categories();
        assert_eq!(categories.len(), 6);
        assert_eq!(
            categories.iter().filter(|row| row.2 == "expense").count(),
            5
        );
        assert_eq!(categories.iter().filter(|row| row.2 == "income").count(), 1);
        assert!(categories.iter().all(|row| row.1.chars().count() <= 40));
        assert_eq!(accounts().len(), 4);
        assert_eq!(transactions().len(), 17);
        assert!(transactions().iter().all(|row| row.1 != "transfer"));
        assert!(
            transactions()
                .iter()
                .all(|row| DateTime::parse_from_rfc3339(row.6).is_ok())
        );
    }

    #[test]
    fn normalize_collapses_whitespace_and_lowercases() {
        assert_eq!(normalize("  Hello   WORLD  "), "hello world");
        assert_eq!(normalize("餐  饮"), "餐 饮");
    }
}
