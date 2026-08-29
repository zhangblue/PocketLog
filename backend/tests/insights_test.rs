mod support;

use chrono::NaiveDate;
use pocket_log_backend::{
    application::insights,
    domain::{TransactionKind, analytics::Period},
    infrastructure::repositories::SeaOrmLedgerRepository,
};
use sea_orm::ConnectionTrait;
use uuid::Uuid;

#[tokio::test]
async fn analytics_reads_real_postgres_and_excludes_transfers() {
    let database = support::TestDatabase::migrated().await;
    let account = Uuid::from_u128(1);
    let expense_category = Uuid::from_u128(2);
    let income_category = Uuid::from_u128(3);
    database.db.execute_unprepared(&format!(r##"
        INSERT INTO account_labels (id,name,normalized_name,active,created_at,updated_at) VALUES ('{account}','现金','现金',true,now(),now());
        INSERT INTO account_labels (id,name,normalized_name,active,created_at,updated_at) VALUES ('00000000-0000-0000-0000-000000000099','储蓄','储蓄',true,now(),now());
        INSERT INTO categories (id,name,normalized_name,kind,emoji,color,semantic_key,sort_order,active,created_at,updated_at) VALUES
          ('{expense_category}','交通','交通','expense','🚇','#246B45','transport',1,true,now(),now()),
          ('{income_category}','工资','工资','income','💰','#A7C957',NULL,2,true,now(),now());
        INSERT INTO transactions (id,kind,amount,category_id,account_id,target_account_id,merchant,note,occurred_at,local_date,local_time,utc_offset_minutes,created_at,updated_at) VALUES
          ('00000000-0000-0000-0000-000000000011','expense',20,'{expense_category}','{account}',NULL,'地铁','', '2026-08-02 10:00:00+08','2026-08-02','10:00',480,now(),now()),
          ('00000000-0000-0000-0000-000000000012','income',100,'{income_category}','{account}',NULL,'工资','', '2026-08-03 10:00:00+08','2026-08-03','10:00',480,now(),now()),
          ('00000000-0000-0000-0000-000000000013','transfer',50,NULL,'{account}','00000000-0000-0000-0000-000000000099','转账','', '2026-08-04 10:00:00+08','2026-08-04','10:00',480,now(),now());
    "##)).await.unwrap();
    let repository = SeaOrmLedgerRepository::new(database.db.clone());
    let period = Period::month(2026, 8).unwrap();
    let (facts, revision) = repository.analytics_facts(period, None).await.unwrap();
    assert_eq!(revision.value(), 0);
    let summary = pocket_log_backend::domain::analytics::summarize(&facts.current, period);
    assert_eq!(summary.expense.to_string(), "20.00");
    assert_eq!(summary.income.to_string(), "100.00");
    assert_eq!(summary.transfer.to_string(), "50.00");
    let (_, insights, _) = insights::overview(&repository, period, None).await.unwrap();
    assert!(insights.iter().any(|item| item.code == "savings_rate"));
    assert!(
        insights.iter().any(|item| item.current_filter.kinds
            == vec![TransactionKind::Income, TransactionKind::Expense])
    );
    database.cleanup().await;
}

#[test]
fn period_previous_is_adjacent_and_same_length() {
    let current = Period::new(
        NaiveDate::from_ymd_opt(2026, 8, 1).unwrap(),
        NaiveDate::from_ymd_opt(2026, 8, 31).unwrap(),
    )
    .unwrap();
    assert_eq!(
        current.previous().start,
        NaiveDate::from_ymd_opt(2026, 7, 1).unwrap()
    );
    assert_eq!(
        current.previous().end,
        NaiveDate::from_ymd_opt(2026, 7, 31).unwrap()
    );
}
