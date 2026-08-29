mod support;

use std::sync::Arc;

use uuid::Uuid;

use pocket_log_backend::{
    application::{
        DataRevision,
        clock::FixedClock,
        transactions::{
            CreateTransaction, DateRange, IdempotencyKey, TransactionQuery, TransactionService,
        },
    },
    infrastructure::{
        entities::{account_label, app_state, category, idempotency_request, transaction},
        repositories::SeaOrmLedgerRepository,
        seed::seed_if_needed,
    },
};
use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, PaginatorTrait, QueryFilter};
use tokio::sync::Barrier;

async fn service() -> (
    support::TestDatabase,
    Arc<TransactionService<SeaOrmLedgerRepository<FixedClock>>>,
) {
    let db = support::TestDatabase::migrated().await;
    seed_if_needed(&db.db, &FixedClock::at("2026-08-26T10:00:00+08:00"))
        .await
        .unwrap();
    let repository = SeaOrmLedgerRepository::with_clock(
        db.db.clone(),
        FixedClock::at("2026-08-26T10:00:00+08:00"),
    );
    (db, Arc::new(TransactionService::new(repository)))
}

async fn expense_input(db: &support::TestDatabase) -> CreateTransaction {
    let category = category::Entity::find()
        .filter(category::Column::Kind.eq("expense"))
        .one(&db.db)
        .await
        .unwrap()
        .unwrap();
    let account = account_label::Entity::find()
        .one(&db.db)
        .await
        .unwrap()
        .unwrap();
    CreateTransaction::expense(
        "32.60",
        "午餐",
        category.id,
        account.id,
        "2026-08-26T12:30:00+08:00",
        "工作日午餐",
    )
    .unwrap()
}

#[tokio::test]
async fn repeated_create_replays_the_same_transaction() {
    let (db, app) = service().await;
    let input = expense_input(&db).await;
    let first = app
        .create(
            input.clone(),
            DataRevision::new(1),
            IdempotencyKey::new("entry-1").unwrap(),
        )
        .await
        .unwrap();
    let second = app
        .create(
            input,
            DataRevision::new(1),
            IdempotencyKey::new("entry-1").unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(first.transaction.id, second.transaction.id);
    assert_eq!(first.data_revision, second.data_revision);
    assert_eq!(transaction::Entity::find().count(&db.db).await.unwrap(), 18);
    db.cleanup().await;
}

#[tokio::test]
async fn stale_revision_does_not_write() {
    let (db, app) = service().await;
    let error = app
        .create(
            expense_input(&db).await,
            DataRevision::new(0),
            IdempotencyKey::new("entry-2").unwrap(),
        )
        .await
        .unwrap_err();
    assert_eq!(error.code(), "revision_conflict");
    assert_eq!(transaction::Entity::find().count(&db.db).await.unwrap(), 17);
    db.cleanup().await;
}

#[tokio::test]
async fn concurrent_same_key_creates_once_and_replays_once() {
    let (db, app) = service().await;
    let input = expense_input(&db).await;
    let barrier = Arc::new(Barrier::new(2));
    let left = {
        let app = app.clone();
        let input = input.clone();
        let barrier = barrier.clone();
        tokio::spawn(async move {
            barrier.wait().await;
            app.create(
                input,
                DataRevision::new(1),
                IdempotencyKey::new("entry-3").unwrap(),
            )
            .await
        })
    };
    let right = {
        let app = app.clone();
        let barrier = barrier.clone();
        tokio::spawn(async move {
            barrier.wait().await;
            app.create(
                input,
                DataRevision::new(1),
                IdempotencyKey::new("entry-3").unwrap(),
            )
            .await
        })
    };
    let first = left.await.unwrap().unwrap();
    let second = right.await.unwrap().unwrap();
    assert_eq!(first.transaction.id, second.transaction.id);
    assert_eq!(first.data_revision, DataRevision::new(2));
    assert_eq!(second.data_revision, DataRevision::new(2));
    assert_eq!(transaction::Entity::find().count(&db.db).await.unwrap(), 18);
    db.cleanup().await;
}

#[tokio::test]
async fn reused_key_with_different_normalized_input_is_rejected() {
    let (db, app) = service().await;
    let first = expense_input(&db).await;
    app.create(
        first,
        DataRevision::new(1),
        IdempotencyKey::new("entry-4").unwrap(),
    )
    .await
    .unwrap();
    let mut different = expense_input(&db).await;
    different.merchant = "晚餐".to_owned();
    let error = app
        .create(
            different,
            DataRevision::new(2),
            IdempotencyKey::new("entry-4").unwrap(),
        )
        .await
        .unwrap_err();
    assert_eq!(error.code(), "idempotency_key_reused");
    db.cleanup().await;
}

#[tokio::test]
async fn creates_income_and_transfer_and_rejects_invalid_references_and_amounts() {
    let (db, app) = service().await;
    let income_category = category::Entity::find()
        .filter(category::Column::Kind.eq("income"))
        .one(&db.db)
        .await
        .unwrap()
        .unwrap();
    let accounts = account_label::Entity::find().all(&db.db).await.unwrap();
    let income = CreateTransaction {
        kind: pocket_log_backend::application::transactions::TransactionKind::Income,
        amount: "100.00".to_owned(),
        merchant: "退款".to_owned(),
        category_id: Some(income_category.id),
        account_id: accounts[0].id,
        target_account_id: None,
        occurred_at: "2026-08-26T10:00:00+08:00".to_owned(),
        note: String::new(),
    };
    app.create(
        income,
        DataRevision::new(1),
        IdempotencyKey::new("entry-5").unwrap(),
    )
    .await
    .unwrap();
    let transfer = CreateTransaction {
        kind: pocket_log_backend::application::transactions::TransactionKind::Transfer,
        amount: "10.00".to_owned(),
        merchant: "账户调拨".to_owned(),
        category_id: None,
        account_id: accounts[0].id,
        target_account_id: Some(accounts[1].id),
        occurred_at: "2026-08-26T11:00:00+08:00".to_owned(),
        note: String::new(),
    };
    app.create(
        transfer,
        DataRevision::new(2),
        IdempotencyKey::new("entry-6").unwrap(),
    )
    .await
    .unwrap();

    let mismatch = CreateTransaction::expense(
        "3.00",
        "错误分类",
        income_category.id,
        accounts[0].id,
        "2026-08-26T12:00:00+08:00",
        "",
    )
    .unwrap();
    let error = app
        .create(
            mismatch,
            DataRevision::new(3),
            IdempotencyKey::new("entry-7").unwrap(),
        )
        .await
        .unwrap_err();
    assert_eq!(error.code(), "transaction.category_kind_mismatch");
    assert_eq!(
        CreateTransaction::expense(
            "1.001",
            "精度",
            income_category.id,
            accounts[0].id,
            "2026-08-26T12:00:00+08:00",
            ""
        )
        .unwrap_err()
        .code(),
        "amount.scale_exceeded"
    );
    db.db
        .execute_unprepared(&format!(
            "UPDATE account_labels SET active = FALSE WHERE id = '{}'",
            accounts[0].id
        ))
        .await
        .unwrap();
    let inactive = CreateTransaction::expense(
        "3.00",
        "停用账户",
        category::Entity::find()
            .filter(category::Column::Kind.eq("expense"))
            .one(&db.db)
            .await
            .unwrap()
            .unwrap()
            .id,
        accounts[0].id,
        "2026-08-26T12:00:00+08:00",
        "",
    )
    .unwrap();
    let error = app
        .create(
            inactive,
            DataRevision::new(3),
            IdempotencyKey::new("entry-8").unwrap(),
        )
        .await
        .unwrap_err();
    assert_eq!(error.code(), "transaction.account_inactive");
    db.cleanup().await;
}

#[tokio::test]
async fn category_and_account_filter_keeps_inactive_history() {
    let (db, app) = service().await;
    let food = category::Entity::find()
        .filter(category::Column::SemanticKey.is_null())
        .filter(category::Column::Kind.eq("expense"))
        .one(&db.db)
        .await
        .unwrap()
        .unwrap();
    let wechat = account_label::Entity::find()
        .filter(account_label::Column::Name.eq("微信"))
        .one(&db.db)
        .await
        .unwrap()
        .unwrap();
    let page = app
        .list(
            TransactionQuery::month("2026-08")
                .category(food.id)
                .account(wechat.id),
        )
        .await
        .unwrap();
    assert!(!page.items.is_empty());
    assert!(
        page.items
            .iter()
            .all(|row| row.category_id == Some(food.id) && row.account_id == wechat.id)
    );
    db.cleanup().await;
}

#[tokio::test]
async fn cursor_never_duplicates_equal_timestamps() {
    let (db, app) = service().await;
    let first = app
        .list(TransactionQuery::month("2026-08").limit(2))
        .await
        .unwrap();
    let cursor = first.next_cursor.clone().expect("seed has another page");
    let second = app
        .list(TransactionQuery::month("2026-08").after(cursor))
        .await
        .unwrap();
    assert!(
        first
            .items
            .iter()
            .all(|a| second.items.iter().all(|b| a.id != b.id))
    );
    db.cleanup().await;
}

#[tokio::test]
async fn list_rejects_invalid_filter_combinations() {
    let (db, app) = service().await;
    let error = app
        .list(TransactionQuery {
            month: Some(
                pocket_log_backend::application::transactions::YearMonth::parse("2026-08").unwrap(),
            ),
            date_range: Some(DateRange::new("2026-08-01", "2026-08-31").unwrap()),
            ..TransactionQuery::default()
        })
        .await
        .unwrap_err();
    assert_eq!(error.code(), "query.date_filters_mutually_exclusive");
    let error = app
        .list(TransactionQuery::month("2026-08").limit(0))
        .await
        .unwrap_err();
    assert_eq!(error.code(), "query.limit_invalid");
    let error = app
        .list(TransactionQuery::month("2026-08").weekend_only())
        .await
        .unwrap_err();
    assert_eq!(error.code(), "query.weekend_requires_expense");
    let error = app
        .list(
            TransactionQuery::month("2026-08")
                .kinds(vec![
                    pocket_log_backend::application::transactions::TransactionKind::Expense,
                    pocket_log_backend::application::transactions::TransactionKind::Income,
                ])
                .weekend_only(),
        )
        .await
        .unwrap_err();
    assert_eq!(error.code(), "query.weekend_requires_expense");
    let page = app
        .list(
            TransactionQuery::month("2026-08")
                .kinds(vec![
                    pocket_log_backend::application::transactions::TransactionKind::Expense,
                ])
                .weekend_only(),
        )
        .await
        .unwrap();
    assert!(
        page.items.iter().all(|item| item.kind
            == pocket_log_backend::application::transactions::TransactionKind::Expense)
    );
    db.cleanup().await;
}

#[tokio::test]
async fn delete_hides_until_restore_and_revision_is_guarded() {
    let (db, app) = service().await;
    let id = transaction::Entity::find()
        .one(&db.db)
        .await
        .unwrap()
        .unwrap()
        .id;
    let deleted = app.delete(id, DataRevision::new(1)).await.unwrap();
    assert_eq!(deleted.data_revision, DataRevision::new(2));
    assert!(
        app.list(TransactionQuery::month("2026-08"))
            .await
            .unwrap()
            .items
            .iter()
            .all(|row| row.id != id)
    );
    let error = app.delete(id, DataRevision::new(1)).await.unwrap_err();
    assert_eq!(error.code(), "revision_conflict");
    let restored = app
        .restore(id, deleted.token, DataRevision::new(2))
        .await
        .unwrap();
    assert_eq!(restored.data_revision, DataRevision::new(3));
    assert!(
        app.list(TransactionQuery::month("2026-08"))
            .await
            .unwrap()
            .items
            .iter()
            .any(|row| row.id == id)
    );
    db.cleanup().await;
}

#[tokio::test]
async fn restore_rejects_wrong_token_and_fixed_deadline() {
    let (db, app) = service().await;
    let id = transaction::Entity::find()
        .one(&db.db)
        .await
        .unwrap()
        .unwrap()
        .id;
    let deleted = app.delete(id, DataRevision::new(1)).await.unwrap();
    let error = app
        .restore(id, Uuid::new_v4(), DataRevision::new(2))
        .await
        .unwrap_err();
    assert_eq!(error.code(), "restore_token_invalid");
    let error = app
        .restore(id, deleted.token, DataRevision::new(2))
        .await
        .unwrap();
    assert_eq!(error.data_revision, DataRevision::new(3));
    db.cleanup().await;
}

#[tokio::test]
async fn cleanup_removes_expired_rows_and_old_completed_idempotency_without_revision_bump() {
    let (db, app) = service().await;
    let id = transaction::Entity::find()
        .one(&db.db)
        .await
        .unwrap()
        .unwrap()
        .id;
    let deleted = app.delete(id, DataRevision::new(1)).await.unwrap();
    db.db.execute_unprepared(&format!(
        "UPDATE transactions SET pending_delete_until = '2026-08-26T10:00:00+08:00' WHERE id = '{}'",
        id
    )).await.unwrap();

    let input = expense_input(&db).await;
    app.create(
        input,
        DataRevision::new(2),
        IdempotencyKey::new("cleanup-old").unwrap(),
    )
    .await
    .unwrap();
    db.db.execute_unprepared(
        "UPDATE idempotency_requests SET created_at = '2026-08-24T10:00:00+08:00', expires_at = '2026-08-25T10:00:00+08:00' WHERE idempotency_key = 'cleanup-old'"
    ).await.unwrap();

    assert_eq!(deleted.data_revision, DataRevision::new(2));
    assert_eq!(app.cleanup().await.unwrap(), ());
    assert_eq!(
        transaction::Entity::find_by_id(id)
            .one(&db.db)
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        idempotency_request::Entity::find_by_id("cleanup-old")
            .one(&db.db)
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        app_state::Entity::find_by_id(true)
            .one(&db.db)
            .await
            .unwrap()
            .unwrap()
            .data_revision,
        3
    );
    db.cleanup().await;
}
