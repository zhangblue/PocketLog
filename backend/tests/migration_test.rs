mod support;

use pocket_log_backend::infrastructure::schema::{run_migrations, verify_schema};
use sea_orm::{ConnectionTrait, DbBackend, Statement};
use support::{TestDatabase, execute, migration_versions, schema_object_oids};
use uuid::Uuid;

#[tokio::test]
async fn serve_check_rejects_unmigrated_database() {
    let test_db = TestDatabase::empty().await;

    let error = verify_schema(&test_db.db).await.unwrap_err();

    assert_eq!(error.code(), "schema.not_initialized");
    test_db.cleanup().await;
}

#[tokio::test]
async fn explicit_migrate_is_idempotent() {
    let test_db = TestDatabase::empty().await;

    run_migrations(&test_db.db).await.unwrap();
    run_migrations(&test_db.db).await.unwrap();
    verify_schema(&test_db.db).await.unwrap();

    assert_eq!(migration_versions(&test_db.db).await.len(), 1);
    test_db.cleanup().await;
}

#[tokio::test]
async fn schema_check_is_read_only_and_does_not_change_schema_objects() {
    let test_db = TestDatabase::migrated().await;
    let versions_before = migration_versions(&test_db.db).await;
    let objects_before = schema_object_oids(&test_db.db).await;

    verify_schema(&test_db.db).await.unwrap();

    assert_eq!(migration_versions(&test_db.db).await, versions_before);
    assert_eq!(schema_object_oids(&test_db.db).await, objects_before);
    test_db.cleanup().await;
}

#[tokio::test]
async fn migration_creates_ledger_tables_indexes_and_initial_state() {
    let test_db = TestDatabase::migrated().await;
    let rows = test_db
        .db
        .query_all(Statement::from_string(
            DbBackend::Postgres,
            r#"
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = current_schema()
                  AND table_name <> 'seaql_migrations'
                ORDER BY table_name
            "#
            .to_owned(),
        ))
        .await
        .unwrap();
    let tables: Vec<String> = rows
        .into_iter()
        .map(|row| row.try_get_by_index(0).unwrap())
        .collect();
    assert_eq!(
        tables,
        [
            "account_labels",
            "app_state",
            "categories",
            "idempotency_requests",
            "transactions",
        ]
    );

    let state = test_db
        .db
        .query_one(Statement::from_string(
            DbBackend::Postgres,
            "SELECT singleton, seed_version, data_revision FROM app_state".to_owned(),
        ))
        .await
        .unwrap()
        .unwrap();
    assert!(state.try_get_by_index::<bool>(0).unwrap());
    assert_eq!(state.try_get_by_index::<i32>(1).unwrap(), 0);
    assert_eq!(state.try_get_by_index::<i64>(2).unwrap(), 0);

    let rows = test_db
        .db
        .query_all(Statement::from_string(
            DbBackend::Postgres,
            r#"
                SELECT indexname
                FROM pg_indexes
                WHERE schemaname = current_schema()
                  AND indexname LIKE 'idx_transactions_%'
                ORDER BY indexname
            "#
            .to_owned(),
        ))
        .await
        .unwrap();
    let indexes: Vec<String> = rows
        .into_iter()
        .map(|row| row.try_get_by_index(0).unwrap())
        .collect();
    assert_eq!(
        indexes,
        [
            "idx_transactions_account_local_date",
            "idx_transactions_category_local_date",
            "idx_transactions_kind_local_date",
            "idx_transactions_local_date_occurred_at",
            "idx_transactions_pending_delete",
            "idx_transactions_target_account_local_date",
        ]
    );

    test_db.cleanup().await;
}

#[tokio::test]
async fn postgres_rejects_invalid_ledger_rows() {
    let test_db = TestDatabase::migrated().await;
    let expense_category = Uuid::new_v4();
    let income_category = Uuid::new_v4();
    let source_account = Uuid::new_v4();
    let target_account = Uuid::new_v4();
    test_db
        .db
        .execute_unprepared(&format!(
            r#"
                INSERT INTO categories
                    (id, name, normalized_name, kind, emoji, color, sort_order, active, created_at, updated_at)
                VALUES
                    ('{expense_category}', '餐饮', '餐饮', 'expense', '🍜', '#246B45', 0, true, now(), now()),
                    ('{income_category}', '工资', '工资', 'income', '💰', '#A7C957', 1, true, now(), now());
                INSERT INTO account_labels
                    (id, name, normalized_name, active, created_at, updated_at)
                VALUES
                    ('{source_account}', '现金', '现金', true, now(), now()),
                    ('{target_account}', '储蓄卡', '储蓄卡', true, now(), now());
            "#
        ))
        .await
        .unwrap();

    let transaction_values = |kind: &str,
                              amount: &str,
                              category: String,
                              target: String,
                              offset: i16| {
        format!(
            r#"
                INSERT INTO transactions
                    (id, kind, amount, category_id, account_id, target_account_id, merchant, note,
                     occurred_at, local_date, local_time, utc_offset_minutes, created_at, updated_at)
                VALUES
                    ('{}', '{kind}', {amount}, {category}, '{source_account}', {target}, '测试交易', '',
                     '2026-08-27T12:00:00+08:00', '2026-08-27', '12:00:00', {offset}, now(), now())
            "#,
            Uuid::new_v4()
        )
    };

    execute(
        &test_db.db,
        transaction_values(
            "transfer",
            "10.00",
            "NULL".to_owned(),
            format!("'{source_account}'"),
            480,
        ),
    )
    .await;
    execute(
        &test_db.db,
        transaction_values(
            "income",
            "10.00",
            format!("'{expense_category}'"),
            "NULL".to_owned(),
            480,
        ),
    )
    .await;
    execute(
        &test_db.db,
        transaction_values(
            "expense",
            "0.00",
            format!("'{expense_category}'"),
            "NULL".to_owned(),
            480,
        ),
    )
    .await;
    execute(
        &test_db.db,
        transaction_values(
            "expense",
            "10.00",
            format!("'{expense_category}'"),
            "NULL".to_owned(),
            841,
        ),
    )
    .await;
    execute(
        &test_db.db,
        format!(
            r#"
                INSERT INTO categories
                    (id, name, normalized_name, kind, emoji, color, sort_order, active, created_at, updated_at)
                VALUES
                    ('{}', '另一个餐饮', '餐饮', 'expense', '🍽️', '#123456', 2, true, now(), now())
            "#,
            Uuid::new_v4()
        ),
    )
    .await;

    test_db.cleanup().await;
}

#[tokio::test]
async fn category_sort_order_unique_constraint_is_deferrable() {
    let test_db = TestDatabase::migrated().await;
    let first = Uuid::new_v4();
    let second = Uuid::new_v4();
    test_db
        .db
        .execute_unprepared(&format!(
            r#"
                INSERT INTO categories
                    (id, name, normalized_name, kind, emoji, color, sort_order, active, created_at, updated_at)
                VALUES
                    ('{first}', '餐饮', '餐饮', 'expense', '🍜', '#246B45', 0, true, now(), now()),
                    ('{second}', '工资', '工资', 'income', '💰', '#A7C957', 1, true, now(), now());
                BEGIN;
                SET CONSTRAINTS categories_sort_order_key DEFERRED;
                UPDATE categories SET sort_order = CASE id
                    WHEN '{first}' THEN 1
                    WHEN '{second}' THEN 0
                END;
                COMMIT;
            "#
        ))
        .await
        .unwrap();

    test_db.cleanup().await;
}
