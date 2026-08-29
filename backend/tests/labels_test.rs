mod support;

use pocket_log_backend::application::{
    DataRevision,
    clock::FixedClock,
    dto::{CreateAccount, CreateCategory},
    labels::LabelService,
};
use pocket_log_backend::infrastructure::{
    entities::{account_label, category, transaction},
    repositories::SeaOrmLedgerRepository,
    seed::seed_if_needed,
};
use sea_orm::{
    ColumnTrait, ConnectionTrait, DbBackend, EntityTrait, PaginatorTrait, QueryFilter, Statement,
};
use uuid::Uuid;

async fn service() -> (
    support::TestDatabase,
    LabelService<SeaOrmLedgerRepository<FixedClock>>,
) {
    let db = support::TestDatabase::migrated().await;
    seed_if_needed(&db.db, &FixedClock::at("2026-08-27T10:00:00+08:00"))
        .await
        .unwrap();
    let repository = SeaOrmLedgerRepository::with_clock(
        db.db.clone(),
        FixedClock::at("2026-08-27T10:00:00+08:00"),
    );
    (db, LabelService::new(repository))
}

async fn category_id(db: &support::TestDatabase, name: &str) -> Uuid {
    category::Entity::find()
        .filter(category::Column::Name.eq(name))
        .one(&db.db)
        .await
        .unwrap()
        .unwrap()
        .id
}

#[tokio::test]
async fn category_commands_update_revision_and_normalize_names() {
    let (db, labels) = service().await;
    let created = labels
        .create_category(
            CreateCategory {
                name: "  宠物  饲养 ".into(),
                kind: "expense".into(),
                emoji: "🐾".into(),
                color: "#abcdef".into(),
                semantic_key: None,
                sort_order: 99,
            },
            DataRevision::new(1),
        )
        .await
        .unwrap();
    assert_eq!(created.value.name, "宠物 饲养");
    assert_eq!(created.data_revision, DataRevision::new(2));
    let renamed = labels
        .rename_category(created.value.id, "宠物用品", created.data_revision)
        .await
        .unwrap();
    assert_eq!(renamed.value.name, "宠物用品");
    assert_eq!(renamed.data_revision, DataRevision::new(3));
    db.cleanup().await;
}

#[tokio::test]
async fn cannot_disable_last_active_account() {
    let (db, labels) = service().await;
    let accounts = account_label::Entity::find().all(&db.db).await.unwrap();
    let mut revision = DataRevision::new(1);
    for account in accounts.iter().skip(1).take(2) {
        let mutation = labels
            .deactivate_account(account.id, revision)
            .await
            .unwrap();
        revision = mutation.data_revision;
    }
    let mutation = labels
        .deactivate_account(accounts[3].id, revision)
        .await
        .unwrap();
    revision = mutation.data_revision;
    let active = account_label::Entity::find()
        .filter(account_label::Column::Active.eq(true))
        .one(&db.db)
        .await
        .unwrap()
        .unwrap();
    let error = labels
        .deactivate_account(active.id, revision)
        .await
        .unwrap_err();
    assert_eq!(error.code(), "account.last_active");
    db.cleanup().await;
}

#[tokio::test]
async fn migration_moves_transactions_and_deletes_source_atomically() {
    let (db, labels) = service().await;
    let source = category_id(&db, "餐饮").await;
    let target = category_id(&db, "购物").await;
    let result = labels
        .migrate_category(source, target, DataRevision::new(1))
        .await
        .unwrap();
    assert_eq!(result.data_revision, DataRevision::new(2));
    assert_eq!(
        transaction::Entity::find()
            .filter(transaction::Column::CategoryId.eq(source))
            .count(&db.db)
            .await
            .unwrap(),
        0
    );
    assert!(
        category::Entity::find_by_id(source)
            .one(&db.db)
            .await
            .unwrap()
            .is_none()
    );
    db.cleanup().await;
}

#[tokio::test]
async fn ordering_requires_complete_ids_and_deactivation_is_guarded() {
    let (db, labels) = service().await;
    let categories = category::Entity::find().all(&db.db).await.unwrap();
    let err = labels
        .reorder_categories(vec![categories[0].id], DataRevision::new(1))
        .await
        .unwrap_err();
    assert_eq!(err.code(), "category.order_incomplete");
    let salary = categories
        .iter()
        .find(|item| item.kind == "income")
        .unwrap();
    let err = labels
        .deactivate_category(salary.id, DataRevision::new(1))
        .await
        .unwrap_err();
    assert_eq!(err.code(), "category.last_active_for_kind");
    db.cleanup().await;
}

#[tokio::test]
async fn account_commands_create_and_rename() {
    let (db, labels) = service().await;
    let created = labels
        .create_account(
            CreateAccount {
                name: "  储蓄卡 ".into(),
            },
            DataRevision::new(1),
        )
        .await
        .unwrap();
    assert_eq!(created.value.name, "储蓄卡");
    let renamed = labels
        .rename_account(created.value.id, "备用卡", created.data_revision)
        .await
        .unwrap();
    assert_eq!(renamed.value.name, "备用卡");
    db.cleanup().await;
}

#[tokio::test]
async fn normalized_names_are_unique_for_categories_and_accounts() {
    let (db, labels) = service().await;
    let input = CreateCategory {
        name: "  新分类 ".into(),
        kind: "expense".into(),
        emoji: "🧾".into(),
        color: "#123456".into(),
        semantic_key: None,
        sort_order: 99,
    };
    let created = labels
        .create_category(input.clone(), DataRevision::new(1))
        .await
        .unwrap();
    let error = labels
        .create_category(
            CreateCategory {
                name: "新分类".into(),
                ..input
            },
            created.data_revision,
        )
        .await
        .unwrap_err();
    assert_eq!(error.code(), "label.name_conflict");

    let account = labels
        .create_account(
            CreateAccount {
                name: "新账户".into(),
            },
            created.data_revision,
        )
        .await
        .unwrap();
    let error = labels
        .create_account(
            CreateAccount {
                name: "  新账户 ".into(),
            },
            account.data_revision,
        )
        .await
        .unwrap_err();
    assert_eq!(error.code(), "label.name_conflict");
    db.cleanup().await;
}

#[tokio::test]
async fn ordering_rejects_duplicate_and_unknown_ids_without_revision_change() {
    let (db, labels) = service().await;
    let categories = category::Entity::find().all(&db.db).await.unwrap();
    let mut duplicate = categories.iter().map(|item| item.id).collect::<Vec<_>>();
    duplicate[1] = duplicate[0];
    let error = labels
        .reorder_categories(duplicate, DataRevision::new(1))
        .await
        .unwrap_err();
    assert_eq!(error.code(), "category.order_invalid");
    let mut unknown = categories.iter().map(|item| item.id).collect::<Vec<_>>();
    unknown[0] = Uuid::new_v4();
    let error = labels
        .reorder_categories(unknown, DataRevision::new(1))
        .await
        .unwrap_err();
    assert_eq!(error.code(), "category.order_invalid");
    let state = pocket_log_backend::infrastructure::entities::app_state::Entity::find_by_id(true)
        .one(&db.db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(state.data_revision, 1);
    db.cleanup().await;
}

#[tokio::test]
async fn migration_rejects_same_cross_type_and_inactive_targets() {
    let (db, labels) = service().await;
    let source = category_id(&db, "餐饮").await;
    let income = category_id(&db, "工资").await;
    let error = labels
        .migrate_category(source, source, DataRevision::new(1))
        .await
        .unwrap_err();
    assert_eq!(error.code(), "category.migration_same_target");
    let error = labels
        .migrate_category(source, income, DataRevision::new(1))
        .await
        .unwrap_err();
    assert_eq!(error.code(), "category.migration_kind_mismatch");
    let inactive = category_id(&db, "购物").await;
    db.db
        .execute(Statement::from_string(
            DbBackend::Postgres,
            format!("UPDATE categories SET active = FALSE WHERE id = '{inactive}'"),
        ))
        .await
        .unwrap();
    let error = labels
        .migrate_category(source, inactive, DataRevision::new(1))
        .await
        .unwrap_err();
    assert_eq!(error.code(), "category.migration_target_inactive");
    db.cleanup().await;
}

#[tokio::test]
async fn referenced_category_cannot_be_deleted_and_revision_conflict_is_unchanged() {
    let (db, labels) = service().await;
    let source = category_id(&db, "餐饮").await;
    db.db
        .execute(Statement::from_string(
            DbBackend::Postgres,
            format!("UPDATE categories SET active = FALSE WHERE id = '{source}'"),
        ))
        .await
        .unwrap();
    let error = labels
        .delete_category(source, DataRevision::new(1))
        .await
        .unwrap_err();
    assert_eq!(error.code(), "category.in_use");
    let error = labels
        .rename_category(source, "不会保存", DataRevision::new(99))
        .await
        .unwrap_err();
    assert_eq!(error.code(), "revision_conflict");
    let row = category::Entity::find_by_id(source)
        .one(&db.db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.name, "餐饮");
    let state = pocket_log_backend::infrastructure::entities::app_state::Entity::find_by_id(true)
        .one(&db.db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(state.data_revision, 1);
    db.cleanup().await;
}

#[tokio::test]
async fn migration_rolls_back_when_delete_fails_after_reference_update() {
    let (db, labels) = service().await;
    let source = category_id(&db, "餐饮").await;
    let target = category_id(&db, "购物").await;
    db.db
        .execute_unprepared(
            "CREATE FUNCTION qizhang_test_fail_category_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced test failure'; END; $$",
        )
        .await
        .unwrap();
    db.db
        .execute_unprepared(
            "CREATE TRIGGER qizhang_test_fail_category_delete_trigger BEFORE DELETE ON categories FOR EACH ROW WHEN (OLD.name = '餐饮') EXECUTE FUNCTION qizhang_test_fail_category_delete()",
        )
        .await
        .unwrap();
    let error = labels
        .migrate_category(source, target, DataRevision::new(1))
        .await
        .unwrap_err();
    assert_eq!(error.code(), "persistence.database_error");
    assert_eq!(
        transaction::Entity::find()
            .filter(transaction::Column::CategoryId.eq(source))
            .count(&db.db)
            .await
            .unwrap(),
        4
    );
    assert!(
        category::Entity::find_by_id(source)
            .one(&db.db)
            .await
            .unwrap()
            .is_some()
    );
    let state = pocket_log_backend::infrastructure::entities::app_state::Entity::find_by_id(true)
        .one(&db.db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(state.data_revision, 1);
    db.cleanup().await;
}
