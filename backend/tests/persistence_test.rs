mod support;

use chrono::DateTime;
use pocket_log_backend::{
    application::{
        clock::FixedClock,
        ports::{LedgerRepository, LedgerTransaction},
    },
    infrastructure::{
        repositories::SeaOrmLedgerRepository,
        seed::{clear_ledger, initialize_predefined_categories, seed_if_needed},
    },
};
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, ConnectOptions, ConnectionTrait, Database,
    DbBackend, EntityTrait, PaginatorTrait, QueryFilter, Statement, TransactionTrait,
};
use std::time::Duration;
use uuid::Uuid;

#[tokio::test]
async fn failed_init_rolls_back_all_predefined_categories() {
    // 若 init 在插入部分分类后更新 app_state 失败却没有回滚，下一次 init 会遇到半套预置数据。
    // 此触发器稳定地拒绝修订号更新，断言整个 init 事务对分类表零副作用。
    let db = support::TestDatabase::migrated().await;
    db.db
        .execute_unprepared(
            r#"
            CREATE FUNCTION reject_predefined_category_init() RETURNS trigger AS $$
            BEGIN
                RAISE EXCEPTION 'reject init revision update';
            END;
            $$ LANGUAGE plpgsql;
            CREATE TRIGGER reject_predefined_category_init
            BEFORE UPDATE ON app_state
            FOR EACH ROW EXECUTE FUNCTION reject_predefined_category_init();
            "#,
        )
        .await
        .unwrap();

    let error =
        initialize_predefined_categories(&db.db, &FixedClock::at("2026-08-26T10:00:00+08:00"))
            .await
            .expect_err("init must fail when its revision update is rejected");
    assert_eq!(error.code(), "persistence.database_error");
    assert_eq!(
        pocket_log_backend::infrastructure::entities::category::Entity::find()
            .count(&db.db)
            .await
            .unwrap(),
        0
    );
    db.cleanup().await;
}

#[tokio::test]
async fn clearing_a_seeded_ledger_removes_business_data_and_allows_demo_seed_again() {
    // 此测试会在缺少 clear_ledger 实现时失败；它保护“清理后账本为空、仍可再次写入演示数据”
    // 这一用户可见契约，而不是测试某个特定 SQL 或 ORM 调用。
    let db = support::TestDatabase::migrated().await;
    let clock = FixedClock::at("2026-08-26T10:00:00+08:00");
    seed_if_needed(&db.db, &clock).await.unwrap();
    let pending_transaction_id = insert_pending_delete_transaction(&db.db).await;

    pocket_log_backend::infrastructure::entities::custom_icon::ActiveModel {
        id: Set(Uuid::new_v4()),
        emoji: Set("🧋".to_owned()),
        created_at: Set(DateTime::parse_from_rfc3339("2026-08-26T10:00:00+08:00").unwrap()),
    }
    .insert(&db.db)
    .await
    .unwrap();
    pocket_log_backend::infrastructure::entities::idempotency_request::ActiveModel {
        idempotency_key: Set("clear-ledger-test".to_owned()),
        request_fingerprint: Set("fingerprint".to_owned()),
        status: Set("pending".to_owned()),
        response: Set(None),
        created_at: Set(DateTime::parse_from_rfc3339("2026-08-26T10:00:00+08:00").unwrap()),
        completed_at: Set(None),
        expires_at: Set(DateTime::parse_from_rfc3339("2026-08-27T10:00:00+08:00").unwrap()),
    }
    .insert(&db.db)
    .await
    .unwrap();

    clear_ledger(&db.db).await.unwrap();

    assert_eq!(
        pocket_log_backend::infrastructure::entities::transaction::Entity::find()
            .count(&db.db)
            .await
            .unwrap(),
        0
    );
    assert!(
        pocket_log_backend::infrastructure::entities::transaction::Entity::find_by_id(
            pending_transaction_id,
        )
        .one(&db.db)
        .await
        .unwrap()
        .is_none()
    );
    assert_eq!(
        pocket_log_backend::infrastructure::entities::idempotency_request::Entity::find()
            .count(&db.db)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        pocket_log_backend::infrastructure::entities::custom_icon::Entity::find()
            .count(&db.db)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        pocket_log_backend::infrastructure::entities::category::Entity::find()
            .count(&db.db)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        pocket_log_backend::infrastructure::entities::account_label::Entity::find()
            .count(&db.db)
            .await
            .unwrap(),
        0
    );
    let state = pocket_log_backend::infrastructure::entities::app_state::Entity::find_by_id(true)
        .one(&db.db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!((state.seed_version, state.data_revision), (0, 2));

    seed_if_needed(&db.db, &clock).await.unwrap();
    let snapshot = SeaOrmLedgerRepository::new(db.db.clone())
        .bootstrap()
        .await
        .unwrap();
    assert_eq!(snapshot.categories.len(), 11);
    assert_eq!(snapshot.accounts.len(), 4);
    assert_eq!(
        pocket_log_backend::infrastructure::entities::transaction::Entity::find()
            .count(&db.db)
            .await
            .unwrap(),
        17
    );
    let reseeded_state =
        pocket_log_backend::infrastructure::entities::app_state::Entity::find_by_id(true)
            .one(&db.db)
            .await
            .unwrap()
            .unwrap();
    // 演示数据重新写入是一次真实账本变更，必须在 clean 的 revision=2 基础上递增，
    // 绝不能回退为固定值 1，否则前端可能错过后续数据刷新。
    assert_eq!(
        (reseeded_state.seed_version, reseeded_state.data_revision),
        (1, 3)
    );

    db.cleanup().await;
}

#[tokio::test]
async fn clearing_waits_for_the_app_state_gate_before_deleting_ledger_data() {
    // 该触发器在删除交易时重新申请 app_state 行锁。若 clear 在取得门闩之前开始删除，
    // NOWAIT 会立刻失败；正确实现则先等待门闩，释放后同一事务重入行锁并成功清理。
    let db = support::TestDatabase::migrated().await;
    seed_if_needed(&db.db, &FixedClock::at("2026-08-26T10:00:00+08:00"))
        .await
        .unwrap();
    db.db
        .execute_unprepared(
            r#"
            CREATE FUNCTION require_clear_state_gate() RETURNS trigger AS $$
            BEGIN
                PERFORM 1 FROM app_state WHERE singleton = TRUE FOR UPDATE NOWAIT;
                RETURN OLD;
            END;
            $$ LANGUAGE plpgsql;
            CREATE TRIGGER require_clear_state_gate
            BEFORE DELETE ON transactions
            FOR EACH STATEMENT EXECUTE FUNCTION require_clear_state_gate();
            "#,
        )
        .await
        .unwrap();

    let mut options = ConnectOptions::new(db.connection_url());
    options.sqlx_logging(false);
    let independent_connection = Database::connect(options).await.unwrap();
    let state_lock = independent_connection.begin().await.unwrap();
    state_lock
        .query_one(Statement::from_string(
            DbBackend::Postgres,
            "SELECT singleton FROM app_state WHERE singleton = TRUE FOR UPDATE".to_owned(),
        ))
        .await
        .unwrap();

    let clear_db = db.db.clone();
    let mut clearing = tokio::spawn(async move { clear_ledger(&clear_db).await });
    assert!(
        tokio::time::timeout(Duration::from_millis(100), &mut clearing)
            .await
            .is_err(),
        "清理必须先等待 app_state 行锁，而不能在等待期间开始删除账本数据"
    );

    state_lock.commit().await.unwrap();
    clearing.await.unwrap().unwrap();
    independent_connection.close().await.unwrap();
    db.cleanup().await;
}

#[tokio::test]
async fn failed_clear_rolls_back_every_kind_of_ledger_data() {
    // 状态更新是清理事务的最后一步。该触发器稳定地令其失败，用于验证前面的删除均会回滚。
    let db = support::TestDatabase::migrated().await;
    let clock = FixedClock::at("2026-08-26T10:00:00+08:00");
    seed_if_needed(&db.db, &clock).await.unwrap();
    insert_clear_test_records(&db.db).await;
    let pending_transaction_id = insert_pending_delete_transaction(&db.db).await;
    db.db
        .execute_unprepared(
            r#"
            CREATE FUNCTION reject_ledger_clear() RETURNS trigger AS $$
            BEGIN
                RAISE EXCEPTION 'reject ledger clear state update';
            END;
            $$ LANGUAGE plpgsql;
            CREATE TRIGGER reject_ledger_clear
            BEFORE UPDATE ON app_state
            FOR EACH ROW EXECUTE FUNCTION reject_ledger_clear();
            "#,
        )
        .await
        .unwrap();

    let error = clear_ledger(&db.db).await.unwrap_err();
    assert_eq!(error.code(), "persistence.database_error");
    assert_eq!(
        pocket_log_backend::infrastructure::entities::transaction::Entity::find()
            .count(&db.db)
            .await
            .unwrap(),
        18
    );
    assert_eq!(
        pocket_log_backend::infrastructure::entities::category::Entity::find()
            .count(&db.db)
            .await
            .unwrap(),
        11
    );
    assert_eq!(
        pocket_log_backend::infrastructure::entities::account_label::Entity::find()
            .count(&db.db)
            .await
            .unwrap(),
        4
    );
    assert_eq!(
        pocket_log_backend::infrastructure::entities::custom_icon::Entity::find()
            .count(&db.db)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        pocket_log_backend::infrastructure::entities::idempotency_request::Entity::find()
            .count(&db.db)
            .await
            .unwrap(),
        1
    );
    let pending_transaction =
        pocket_log_backend::infrastructure::entities::transaction::Entity::find_by_id(
            pending_transaction_id,
        )
        .one(&db.db)
        .await
        .unwrap()
        .expect("待删除交易必须随清理失败一同回滚");
    assert!(pending_transaction.pending_delete_until.is_some());
    assert!(pending_transaction.deletion_token.is_some());

    db.cleanup().await;
}

async fn insert_clear_test_records(db: &sea_orm::DatabaseConnection) {
    let now = DateTime::parse_from_rfc3339("2026-08-26T10:00:00+08:00").unwrap();
    pocket_log_backend::infrastructure::entities::custom_icon::ActiveModel {
        id: Set(Uuid::new_v4()),
        emoji: Set("🧋".to_owned()),
        created_at: Set(now),
    }
    .insert(db)
    .await
    .unwrap();
    pocket_log_backend::infrastructure::entities::idempotency_request::ActiveModel {
        idempotency_key: Set("clear-ledger-test".to_owned()),
        request_fingerprint: Set("fingerprint".to_owned()),
        status: Set("pending".to_owned()),
        response: Set(None),
        created_at: Set(now),
        completed_at: Set(None),
        expires_at: Set(DateTime::parse_from_rfc3339("2026-08-27T10:00:00+08:00").unwrap()),
    }
    .insert(db)
    .await
    .unwrap();
}

async fn insert_pending_delete_transaction(db: &sea_orm::DatabaseConnection) -> Uuid {
    // 该交易处于撤销窗口内，列表查询会隐藏它；这里直接统计底层实体，验证 clean 不会遗漏它。
    let now = DateTime::parse_from_rfc3339("2026-08-26T10:00:00+08:00").unwrap();
    let category = pocket_log_backend::infrastructure::entities::category::Entity::find()
        .filter(
            pocket_log_backend::infrastructure::entities::category::Column::SemanticKey
                .eq("transport"),
        )
        .one(db)
        .await
        .unwrap()
        .unwrap();
    let account = pocket_log_backend::infrastructure::entities::account_label::Entity::find()
        .filter(
            pocket_log_backend::infrastructure::entities::account_label::Column::NormalizedName
                .eq("微信"),
        )
        .one(db)
        .await
        .unwrap()
        .unwrap();
    let transaction_id = Uuid::new_v4();
    pocket_log_backend::infrastructure::entities::transaction::ActiveModel {
        id: Set(transaction_id),
        kind: Set("expense".to_owned()),
        amount: Set("1.00".parse().unwrap()),
        category_id: Set(Some(category.id)),
        account_id: Set(account.id),
        target_account_id: Set(None),
        merchant: Set("待撤销交通".to_owned()),
        note: Set("清理必须覆盖待删除交易".to_owned()),
        occurred_at: Set(now),
        local_date: Set(now.date_naive()),
        local_time: Set(now.time()),
        utc_offset_minutes: Set(480),
        pending_delete_until: Set(Some(now + chrono::Duration::seconds(5))),
        deletion_token: Set(Some(Uuid::new_v4())),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(db)
    .await
    .unwrap();
    transaction_id
}

#[tokio::test]
async fn seed_runs_once_and_bootstrap_lists_real_months() {
    let db = support::TestDatabase::migrated().await;
    let clock = FixedClock::at("2026-08-26T10:00:00+08:00");

    seed_if_needed(&db.db, &clock).await.unwrap();
    seed_if_needed(&db.db, &clock).await.unwrap();

    let snapshot = SeaOrmLedgerRepository::new(db.db.clone())
        .bootstrap()
        .await
        .unwrap();
    assert_eq!(snapshot.categories.len(), 11);
    assert_eq!(snapshot.accounts.len(), 4);
    assert!(snapshot.months.contains(&"2026-08".to_owned()));
    assert_eq!(count_visible_transactions(&db.db).await, 17);
    assert_eq!(snapshot.data_revision.value(), 1);

    db.cleanup().await;
}

#[tokio::test]
async fn empty_book_is_not_reseeded_after_initial_seed() {
    let db = support::TestDatabase::migrated().await;
    let clock = FixedClock::at("2026-08-26T10:00:00+08:00");
    seed_if_needed(&db.db, &clock).await.unwrap();
    pocket_log_backend::infrastructure::entities::transaction::Entity::delete_many()
        .exec(&db.db)
        .await
        .unwrap();

    seed_if_needed(&db.db, &clock).await.unwrap();
    assert_eq!(count_visible_transactions(&db.db).await, 0);
    assert!(
        SeaOrmLedgerRepository::new(db.db.clone())
            .bootstrap()
            .await
            .unwrap()
            .months
            .is_empty()
    );

    db.cleanup().await;
}

#[tokio::test]
async fn nonempty_ledger_is_not_seeded_and_keeps_initial_state() {
    let db = support::TestDatabase::migrated().await;
    let now = DateTime::parse_from_rfc3339("2026-08-26T10:00:00+08:00").unwrap();
    pocket_log_backend::infrastructure::entities::category::ActiveModel {
        id: Set(Uuid::new_v4()),
        name: Set("预置餐饮".to_owned()),
        normalized_name: Set("餐饮".to_owned()),
        kind: Set("expense".to_owned()),
        emoji: Set("🍜".to_owned()),
        color: Set("#4F8A75".to_owned()),
        semantic_key: Set(None),
        sort_order: Set(99),
        active: Set(true),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&db.db)
    .await
    .unwrap();

    seed_if_needed(&db.db, &FixedClock::at("2026-08-26T10:00:00+08:00"))
        .await
        .expect("a nonempty ledger must be left unchanged instead of mixing in demo rows");
    assert_eq!(
        pocket_log_backend::infrastructure::entities::category::Entity::find()
            .count(&db.db)
            .await
            .unwrap(),
        1
    );
    let state = pocket_log_backend::infrastructure::entities::app_state::Entity::find_by_id(true)
        .one(&db.db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!((state.seed_version, state.data_revision), (0, 0));

    db.cleanup().await;
}

#[tokio::test]
async fn repeatable_read_repository_transaction_is_postgres_read_only() {
    let db = support::TestDatabase::migrated().await;
    let repository = SeaOrmLedgerRepository::new(db.db.clone());
    let mut transaction = repository.begin_repeatable_read().await.unwrap();

    assert!(transaction.is_read_only().await.unwrap());
    assert_eq!(
        transaction
            .read_app_state()
            .await
            .unwrap()
            .data_revision
            .value(),
        0
    );
    transaction.rollback().await.unwrap();

    let mut locking_transaction = repository.begin_repeatable_read().await.unwrap();
    assert_eq!(
        locking_transaction
            .lock_app_state()
            .await
            .unwrap_err()
            .code(),
        "persistence.database_error"
    );
    locking_transaction.rollback().await.unwrap();

    let mut writing_transaction = repository.begin_repeatable_read().await.unwrap();
    assert_eq!(
        writing_transaction
            .increment_data_revision()
            .await
            .unwrap_err()
            .code(),
        "persistence.database_error"
    );
    writing_transaction.rollback().await.unwrap();
    db.cleanup().await;
}

#[tokio::test]
async fn write_transaction_commits_revision_and_rollback_leaves_it_unchanged() {
    let db = support::TestDatabase::migrated().await;
    let repository = SeaOrmLedgerRepository::new(db.db.clone());
    let mut transaction = repository.begin_write().await.unwrap();
    assert_eq!(
        transaction
            .lock_app_state()
            .await
            .unwrap()
            .data_revision
            .value(),
        0
    );
    assert_eq!(
        transaction.increment_data_revision().await.unwrap().value(),
        1
    );
    transaction.commit().await.unwrap();

    let mut options = ConnectOptions::new(
        std::env::var("TEST_DATABASE_URL").expect("test database URL is configured"),
    );
    options
        .set_schema_search_path(db.schema.clone())
        .sqlx_logging(false);
    let independent_connection = Database::connect(options).await.unwrap();
    let independent_repository = SeaOrmLedgerRepository::new(independent_connection.clone());
    let mut read_transaction = independent_repository
        .begin_repeatable_read()
        .await
        .unwrap();
    assert_eq!(
        read_transaction
            .read_app_state()
            .await
            .unwrap()
            .data_revision
            .value(),
        1
    );
    read_transaction.rollback().await.unwrap();

    let mut rolled_back_transaction = repository.begin_write().await.unwrap();
    assert_eq!(
        rolled_back_transaction
            .increment_data_revision()
            .await
            .unwrap()
            .value(),
        2
    );
    rolled_back_transaction.rollback().await.unwrap();

    let mut final_read = independent_repository
        .begin_repeatable_read()
        .await
        .unwrap();
    assert_eq!(
        final_read
            .read_app_state()
            .await
            .unwrap()
            .data_revision
            .value(),
        1
    );
    final_read.rollback().await.unwrap();
    independent_connection.close().await.unwrap();
    db.cleanup().await;
}

async fn count_visible_transactions(db: &sea_orm::DatabaseConnection) -> u64 {
    pocket_log_backend::infrastructure::entities::transaction::Entity::find()
        .filter(
            pocket_log_backend::infrastructure::entities::transaction::Column::PendingDeleteUntil
                .is_null(),
        )
        .count(db)
        .await
        .unwrap()
}
