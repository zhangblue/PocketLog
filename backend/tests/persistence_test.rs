mod support;

use chrono::DateTime;
use pocket_log_backend::{
    application::{
        clock::FixedClock,
        ports::{LedgerRepository, LedgerTransaction},
    },
    infrastructure::{repositories::SeaOrmLedgerRepository, seed::seed_if_needed},
};
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, ConnectOptions, Database, EntityTrait,
    PaginatorTrait, QueryFilter,
};
use uuid::Uuid;

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
    assert_eq!(snapshot.categories.len(), 6);
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
async fn failed_seed_rolls_back_and_keeps_initial_state() {
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

    let error = seed_if_needed(&db.db, &FixedClock::at("2026-08-26T10:00:00+08:00"))
        .await
        .unwrap_err();
    assert_eq!(error.code(), "persistence.database_error");
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
