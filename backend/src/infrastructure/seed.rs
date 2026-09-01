//! 预置分类与演示账本初始化。
//!
//! `init` 只补齐预置分类，`demo` 只在分类就绪且其它业务表为空时写入演示账户和交易；两者
//! 都通过事务与 app_state 行锁保证并发安全。该模块不承担迁移职责，也不会覆盖用户已有数据。

use std::str::FromStr;

use chrono::DateTime;
use rust_decimal::Decimal;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ConnectionTrait, DatabaseConnection, DbBackend,
    EntityTrait, Statement, TransactionTrait,
};
use uuid::Uuid;

use crate::{
    application::{AppError, clock::Clock},
    infrastructure::{
        entities::{account_label, category, custom_icon, idempotency_request, transaction},
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
const COMMUNICATION: Uuid = Uuid::from_u128(0x10000000000000000000000000000007);
const NETWORK: Uuid = Uuid::from_u128(0x10000000000000000000000000000008);
const OTHER_INCOME: Uuid = Uuid::from_u128(0x10000000000000000000000000000009);
const WATER: Uuid = Uuid::from_u128(0x1000000000000000000000000000000a);
const ELECTRICITY: Uuid = Uuid::from_u128(0x1000000000000000000000000000000b);
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
    // 保留给既有集成测试和开发夹具的“完整示例账本”便捷入口；命令层绝不调用它，正式运维
    // 必须遵循 migrate → init → demo 的显式顺序，避免 demo 隐式创建任何预置分类。
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

/// 仅补齐分类管理中的预置分类。
///
/// 每次调用均以 `normalized_name` 判断预置名称是否已经存在；已存在的分类完全保留，避免
/// 覆盖用户维护的类型、图标和排序。插入与账本修订号更新处于同一事务，失败时会一起回滚。
pub async fn initialize_predefined_categories(
    db: &DatabaseConnection,
    clock: &impl Clock,
) -> Result<(), AppError> {
    let transaction = db.begin().await.map_err(database_error)?;
    let result = initialize_categories_in_transaction(&transaction, clock).await;
    match result {
        Ok(()) => transaction.commit().await.map_err(database_error),
        Err(error) => {
            let _ = transaction.rollback().await;
            Err(error)
        }
    }
}

/// 仅在预置分类齐全，且账户、交易、自定义图标均为空时写入演示账户与交易。
///
/// 演示交易按分类标准化名称查询实际分类 ID，不依赖 init 是否插入了固定 UUID。预置分类
/// 缺失或类型不匹配时，整个事务不写任何记录，并返回可恢复错误提示先执行 `init`。
pub async fn seed_demo_if_needed(
    db: &DatabaseConnection,
    clock: &impl Clock,
) -> Result<(), AppError> {
    let transaction = db.begin().await.map_err(database_error)?;
    let result = seed_demo_in_transaction(&transaction, clock).await;
    match result {
        Ok(()) => transaction.commit().await.map_err(database_error),
        Err(error) => {
            let _ = transaction.rollback().await;
            Err(error)
        }
    }
}

/// 在不改变数据库 schema 的前提下，清空账本的全部用户数据。
///
/// 删除顺序遵循外键依赖：交易先于分类和账户删除；全部数据库操作与状态行更新共用一个
/// 事务，因此任何一步失败都会回滚，调用方不会观察到半清理的账本。清理完成后把演示数据
/// 门闩恢复为 0；若要重新生成示例账本，需要按 `init` → `demo` 顺序显式执行，同时递增
/// 修订号通知前端已有数据发生整体变化。
pub async fn clear_ledger(db: &DatabaseConnection) -> Result<(), AppError> {
    let transaction = db.begin().await.map_err(database_error)?;
    let result = clear_in_transaction(&transaction).await;
    match result {
        Ok(()) => transaction.commit().await.map_err(database_error),
        Err(error) => {
            let _ = transaction.rollback().await;
            Err(error)
        }
    }
}

async fn clear_in_transaction(db: &sea_orm::DatabaseTransaction) -> Result<(), AppError> {
    // 清理与演示数据写入共用 app_state 单例行作为门闩。必须在任何 DELETE 之前取得行锁，
    // 这样 clean、demo 和正常写入会被串行化，避免清理过程与其它账本写事务交错。
    db.query_one(Statement::from_string(
        DbBackend::Postgres,
        "SELECT singleton FROM app_state WHERE singleton = TRUE FOR UPDATE".to_owned(),
    ))
    .await
    .map_err(database_error)?
    .ok_or_else(|| AppError::new("app_state.missing"))?;

    // transactions 引用分类和账户，必须最先删除；其余表之间没有反向外键，依次清理即可。
    transaction::Entity::delete_many()
        .exec(db)
        .await
        .map_err(database_error)?;
    idempotency_request::Entity::delete_many()
        .exec(db)
        .await
        .map_err(database_error)?;
    custom_icon::Entity::delete_many()
        .exec(db)
        .await
        .map_err(database_error)?;
    category::Entity::delete_many()
        .exec(db)
        .await
        .map_err(database_error)?;
    account_label::Entity::delete_many()
        .exec(db)
        .await
        .map_err(database_error)?;

    // 使用数据库表达式递增，而不是读出 revision 后在 Rust 中回写，避免并发清理/写入时丢失更新。
    // RETURNING 同时确保 app_state 单例缺失时被转换为可恢复的应用错误。
    db.query_one(Statement::from_string(
        DbBackend::Postgres,
        "UPDATE app_state SET seed_version = 0, data_revision = data_revision + 1 WHERE singleton = TRUE RETURNING data_revision".to_owned(),
    ))
    .await
    .map_err(database_error)?
    .ok_or_else(|| AppError::new("app_state.missing"))?;
    Ok(())
}

async fn initialize_categories_in_transaction(
    db: &sea_orm::DatabaseTransaction,
    clock: &impl Clock,
) -> Result<(), AppError> {
    // init、demo、clean 均以 app_state 单例行串行化。先加锁再读取分类，避免两个并发 init
    // 同时判断某名称不存在并各自插入一行。
    db.query_one(Statement::from_string(
        DbBackend::Postgres,
        "SELECT singleton FROM app_state WHERE singleton = TRUE FOR UPDATE".to_owned(),
    ))
    .await
    .map_err(database_error)?
    .ok_or_else(|| AppError::new("app_state.missing"))?;

    let existing = category::Entity::find()
        .all(db)
        .await
        .map_err(database_error)?;
    let existing_names = existing
        .iter()
        .map(|row| row.normalized_name.as_str())
        .collect::<std::collections::HashSet<_>>();
    let mut occupied_semantic_keys = existing
        .iter()
        .filter_map(|row| row.semantic_key.as_deref())
        .collect::<std::collections::HashSet<_>>();
    let mut occupied_orders = existing
        .iter()
        .map(|row| row.sort_order)
        .collect::<std::collections::HashSet<_>>();
    let mut next_order = existing
        .iter()
        .map(|row| row.sort_order)
        .max()
        .unwrap_or(-1)
        + 1;
    let now = clock.now().as_chrono().fixed_offset();
    let mut inserted = false;

    for (_legacy_id, name, kind, emoji, color, semantic_key, preferred_order) in categories() {
        if existing_names.contains(normalize(name).as_str()) {
            continue;
        }
        // 用户已有分类可能占用了预置排序位置。优先保留预置顺序；发生冲突时追加到当前末尾，
        // 使 init 始终是补齐操作而非重排用户分类。
        let sort_order = if occupied_orders.insert(preferred_order) {
            preferred_order
        } else {
            while !occupied_orders.insert(next_order) {
                next_order += 1;
            }
            let value = next_order;
            next_order += 1;
            value
        };
        // 预置目录的旧固定 UUID 只能用于历史演示夹具；init 必须为每一条缺失名称生成新 ID，
        // 从而可在用户将旧预置行重命名后继续补齐同名分类，而不会触发主键冲突。
        let semantic_key = semantic_key.filter(|key| occupied_semantic_keys.insert(key));
        category::ActiveModel {
            id: Set(Uuid::new_v4()),
            name: Set(name.to_owned()),
            normalized_name: Set(normalize(name)),
            kind: Set(kind.to_owned()),
            emoji: Set(emoji.to_owned()),
            color: Set(color.to_owned()),
            // `transport` 已被历史分类占用时，新“交通”分类仍应可创建；保留历史语义键，
            // 新行降级为无语义键，避免破坏原有洞察引用或违反唯一约束。
            semantic_key: Set(semantic_key.map(str::to_owned)),
            sort_order: Set(sort_order),
            active: Set(true),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(db)
        .await
        .map_err(database_error)?;
        inserted = true;
    }

    if inserted {
        db.query_one(Statement::from_string(
            DbBackend::Postgres,
            "UPDATE app_state SET data_revision = data_revision + 1 WHERE singleton = TRUE RETURNING data_revision".to_owned(),
        ))
        .await
        .map_err(database_error)?
        .ok_or_else(|| AppError::new("app_state.missing"))?;
    }
    Ok(())
}

async fn seed_demo_in_transaction(
    db: &sea_orm::DatabaseTransaction,
    clock: &impl Clock,
) -> Result<(), AppError> {
    let state = db
        .query_one(Statement::from_string(
            DbBackend::Postgres,
            "SELECT seed_version FROM app_state WHERE singleton = TRUE FOR UPDATE".to_owned(),
        ))
        .await
        .map_err(database_error)?
        .ok_or_else(|| AppError::new("app_state.missing"))?;
    let seed_version: i32 = state.try_get_by_index(0).map_err(database_error)?;
    if seed_version != 0 {
        return Ok(());
    }

    let actual_categories = category::Entity::find()
        .all(db)
        .await
        .map_err(database_error)?;
    let category_ids = actual_categories
        .into_iter()
        .map(|row| (row.normalized_name, (row.id, row.kind, row.active)))
        .collect::<std::collections::HashMap<_, _>>();
    let expected_categories = categories();
    let required_category_ids = expected_categories
        .iter()
        .map(|(_, name, expected_kind, _, _, _, _)| {
            let normalized_name = normalize(name);
            let Some((id, actual_kind, active)) = category_ids.get(&normalized_name) else {
                return Err(AppError::new("demo.categories_not_initialized"));
            };
            if actual_kind != expected_kind {
                return Err(AppError::new("demo.categories_kind_invalid"));
            }
            if !active {
                return Err(AppError::new("demo.categories_inactive"));
            }
            Ok((normalized_name, *id))
        })
        .collect::<Result<std::collections::HashMap<_, _>, _>>()?;

    // 分类是 init 允许保留的唯一业务数据。已有账户、交易或自定义图标说明这不是可安全写入
    // 演示数据的空账本，保持历史的 no-op 语义，绝不把样例数据混入用户记录。
    let has_non_category_data = account_label::Entity::find()
        .one(db)
        .await
        .map_err(database_error)?
        .is_some()
        || transaction::Entity::find()
            .one(db)
            .await
            .map_err(database_error)?
            .is_some()
        || custom_icon::Entity::find()
            .one(db)
            .await
            .map_err(database_error)?
            .is_some();
    if has_non_category_data {
        return Ok(());
    }

    let now = clock.now().as_chrono().fixed_offset();
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
    for (index, kind, amount, predefined_category_id, account_id, merchant, occurred_at, note) in
        transactions()
    {
        let category_name = expected_categories
            .iter()
            .find(|(id, ..)| id == &predefined_category_id)
            .map(|(_, name, ..)| normalize(name))
            .ok_or_else(|| AppError::new("seed.invalid_transaction"))?;
        let category_id = required_category_ids
            .get(&category_name)
            .copied()
            .ok_or_else(|| AppError::new("demo.categories_not_initialized"))?;
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
    db.query_one(Statement::from_string(
        DbBackend::Postgres,
        "UPDATE app_state SET seed_version = 1, data_revision = data_revision + 1 WHERE singleton = TRUE RETURNING data_revision".to_owned(),
    ))
    .await
    .map_err(database_error)?
    .ok_or_else(|| AppError::new("app_state.missing"))?;
    Ok(())
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

    // `seed_version == 0` 只表示未写过演示数据，不能代表账本为空：用户可能已经手动新增了
    // 分类、账户、交易或自定义图标。显式 demo 在这种场景必须静默无副作用，绝不能把样例
    // 记录混入用户账本。所有检查均在同一事务及 app_state 门闩之后执行，保证与正常写入路径
    // 的状态更新保持串行；不改变 seed_version，避免错误地把用户数据标记为演示账本。
    let ledger_has_data = category::Entity::find()
        .one(db)
        .await
        .map_err(database_error)?
        .is_some()
        || account_label::Entity::find()
            .one(db)
            .await
            .map_err(database_error)?
            .is_some()
        || transaction::Entity::find()
            .one(db)
            .await
            .map_err(database_error)?
            .is_some()
        || custom_icon::Entity::find()
            .one(db)
            .await
            .map_err(database_error)?
            .is_some();
    if ledger_has_data {
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
    // 所有基础数据都成功插入后才打开版本门闩。data_revision 代表账本的单调变化序列：
    // 首次播种从 0 递增到 1；clean 后再次 demo 则必须在 clean 已递增的值上继续加 1，
    // 不能固定回写为 1。该 UPDATE 仍处于已锁定 app_state 的同一事务，避免并发丢失更新。
    db.query_one(Statement::from_string(
        DbBackend::Postgres,
        "UPDATE app_state SET seed_version = 1, data_revision = data_revision + 1 WHERE singleton = TRUE RETURNING data_revision".to_owned(),
    ))
    .await
    .map_err(database_error)?
    .ok_or_else(|| AppError::new("app_state.missing"))?;
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

fn categories() -> [SeedCategory; 11] {
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
        (COMMUNICATION, "通讯", "expense", "📱", "#6F8FAF", None, 6),
        (NETWORK, "网络", "expense", "🌐", "#5D8C86", None, 7),
        (WATER, "水费", "expense", "💧", "#5B9BD5", None, 8),
        (ELECTRICITY, "电费", "expense", "⚡", "#E5C04F", None, 9),
        (OTHER_INCOME, "其他", "income", "✨", "#8B7AA8", None, 10),
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
        assert_eq!(categories.len(), 11);
        assert_eq!(
            categories.iter().filter(|row| row.2 == "expense").count(),
            9
        );
        assert_eq!(categories.iter().filter(|row| row.2 == "income").count(), 2);
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
