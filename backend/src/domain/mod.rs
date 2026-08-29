//! 纯领域模型与业务规则，统一约束金额、时间、标签和交易不变量。

pub mod analytics;
mod calendar;
mod error;
mod labels;
mod money;
pub mod report;
mod transaction;

pub use calendar::{Duration, LocalDate, LocalTime, OccurredAt, UtcInstant};
pub use error::DomainError;
pub use labels::{
    AccountId, AccountLabel, Category, CategoryId, CategoryKind, validate_account_deactivation,
    validate_category_deactivation, validate_category_migration, validate_complete_order,
};
pub use money::Money;
pub use transaction::{
    ActiveReferences, NewTransaction, TransactionDraft, TransactionKind, validate_transaction,
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn money_requires_positive_two_decimal_amount() {
        assert_eq!(
            Money::parse("0.00").unwrap_err().code(),
            "amount.not_positive"
        );
        assert_eq!(
            Money::parse("1.001").unwrap_err().code(),
            "amount.scale_exceeded"
        );
        assert_eq!(Money::parse("32.6").unwrap().to_api_string(), "32.60");
    }

    #[test]
    fn money_rejects_invalid_negative_and_overlarge_values() {
        for (raw, code) in [
            ("not-a-number", "amount.invalid"),
            ("-1.00", "amount.not_positive"),
            ("10000000000000000.00", "amount.out_of_range"),
        ] {
            assert_eq!(Money::parse(raw).unwrap_err().code(), code);
        }
    }

    #[test]
    fn local_calendar_ignores_host_timezone() {
        let value = OccurredAt::parse("2026-09-01T00:15:00+14:00").unwrap();
        assert_eq!(value.local_date().to_string(), "2026-09-01");
        assert!(!value.local_date().is_weekend());
    }

    #[test]
    fn calendar_rejects_invalid_input_and_utc_checked_add_handles_overflow() {
        assert_eq!(
            OccurredAt::parse("not-a-time").unwrap_err().code(),
            "time.invalid"
        );
        let instant = UtcInstant::parse("2026-09-01T00:15:00+08:00").unwrap();
        assert_eq!(instant.to_rfc3339(), "2026-08-31T16:15:00+00:00");
        assert!(instant.checked_add(Duration::MAX).is_err());
    }

    #[test]
    fn transfer_requires_two_distinct_accounts_and_no_category() {
        let error = TransactionDraft::transfer(
            Money::parse("10.00").unwrap(),
            AccountId::new(1),
            AccountId::new(1),
            OccurredAt::parse("2026-09-01T00:15:00+14:00").unwrap(),
        )
        .validate()
        .unwrap_err();
        assert_eq!(error.code(), "transaction.accounts_must_differ");
    }

    #[test]
    fn transaction_shape_rejects_missing_and_unexpected_transfer_fields() {
        let at = OccurredAt::parse("2026-09-01T00:15:00+08:00").unwrap();
        let amount = Money::parse("10.00").unwrap();
        let account = AccountId::new(1);
        let category = CategoryId::new(2);
        assert_eq!(
            TransactionDraft::expense(amount, "无分类", category, account, at.clone())
                .validate()
                .unwrap()
                .category_id,
            Some(category)
        );
        let missing_category = NewTransaction {
            kind: TransactionKind::Expense,
            amount,
            name: "支出".into(),
            category_id: None,
            account_id: account,
            to_account_id: None,
            occurred_at: at.clone(),
            note: None,
        };
        assert_eq!(
            validate_transaction(
                &missing_category,
                &ActiveReferences::new(
                    vec![],
                    vec![AccountLabel::new(account, "现金", true).unwrap()]
                )
            )
            .unwrap_err()
            .code(),
            "transaction.category_required"
        );
        assert_eq!(
            TransactionDraft::transfer(amount, account, AccountId::new(2), at.clone())
                .validate()
                .unwrap()
                .kind,
            TransactionKind::Transfer
        );
        let mut transfer_with_category =
            TransactionDraft::transfer(amount, account, AccountId::new(2), at)
                .validate()
                .unwrap();
        transfer_with_category.category_id = Some(category);
        assert_eq!(
            validate_transaction(&transfer_with_category, &ActiveReferences::default())
                .unwrap_err()
                .code(),
            "transaction.transfer_has_category"
        );
    }

    #[test]
    fn transaction_validation_rejects_inactive_accounts_and_destinations() {
        let category = Category::new(
            CategoryId::new(1),
            CategoryKind::Expense,
            "餐饮",
            "#246B45",
            true,
            0,
        )
        .unwrap();
        let inactive = AccountLabel::new(AccountId::new(1), "停用", false).unwrap();
        let active = AccountLabel::new(AccountId::new(2), "现金", true).unwrap();
        let at = OccurredAt::parse("2026-09-01T12:15:00+08:00").unwrap();
        let expense = TransactionDraft::expense(
            Money::parse("1.00").unwrap(),
            "午餐",
            category.id,
            inactive.id,
            at.clone(),
        )
        .validate()
        .unwrap();
        assert_eq!(
            validate_transaction(
                &expense,
                &ActiveReferences::new(
                    vec![category.clone()],
                    vec![inactive.clone(), active.clone()]
                )
            )
            .unwrap_err()
            .code(),
            "transaction.account_inactive"
        );
        let transfer =
            TransactionDraft::transfer(Money::parse("1.00").unwrap(), active.id, inactive.id, at)
                .validate()
                .unwrap();
        assert_eq!(
            validate_transaction(
                &transfer,
                &ActiveReferences::new(vec![], vec![inactive, active])
            )
            .unwrap_err()
            .code(),
            "transaction.destination_account_inactive"
        );
    }

    #[test]
    fn cannot_deactivate_last_expense_category() {
        let category = Category::new(
            CategoryId::new(1),
            CategoryKind::Expense,
            "餐饮",
            "#246B45",
            true,
            0,
        )
        .unwrap();
        let error =
            validate_category_deactivation(&category, std::slice::from_ref(&category)).unwrap_err();
        assert_eq!(error.code(), "category.last_active_for_kind");
    }

    #[test]
    fn account_deactivation_keeps_at_least_one_active_account() {
        let only_active = AccountLabel::new(AccountId::new(1), "现金", true).unwrap();
        assert_eq!(
            validate_account_deactivation(&only_active, std::slice::from_ref(&only_active))
                .unwrap_err()
                .code(),
            "account.last_active"
        );

        let second_active = AccountLabel::new(AccountId::new(2), "储蓄卡", true).unwrap();
        validate_account_deactivation(&only_active, &[only_active.clone(), second_active]).unwrap();

        let inactive = AccountLabel::new(AccountId::new(3), "已停用账户", false).unwrap();
        validate_account_deactivation(&inactive, std::slice::from_ref(&inactive)).unwrap();
    }

    #[test]
    fn expense_requires_an_active_category_of_the_expense_kind() {
        let expense = Category::new(
            CategoryId::new(1),
            CategoryKind::Expense,
            "餐饮",
            "#246B45",
            true,
            0,
        )
        .unwrap();
        let income = Category::new(
            CategoryId::new(2),
            CategoryKind::Income,
            "工资",
            "#A7C957",
            true,
            1,
        )
        .unwrap();
        let wallet = AccountLabel::new(AccountId::new(1), "现金", true).unwrap();
        let input = TransactionDraft::expense(
            Money::parse("32.60").unwrap(),
            "午餐",
            income.id,
            wallet.id,
            OccurredAt::parse("2026-09-01T12:15:00+08:00").unwrap(),
        )
        .validate()
        .unwrap();

        let error = validate_transaction(
            &input,
            &ActiveReferences::new(vec![expense, income], vec![wallet]),
        )
        .unwrap_err();
        assert_eq!(error.code(), "transaction.category_kind_mismatch");
    }

    #[test]
    fn merchant_and_note_accept_their_documented_maximum_lengths() {
        let category = Category::new(
            CategoryId::new(1),
            CategoryKind::Expense,
            "餐饮",
            "#246B45",
            true,
            0,
        )
        .unwrap();
        let account = AccountLabel::new(AccountId::new(1), "现金", true).unwrap();
        let occurred_at = OccurredAt::parse("2026-09-01T12:15:00+08:00").unwrap();
        let mut maximum = TransactionDraft::expense(
            Money::parse("32.60").unwrap(),
            "商".repeat(120),
            category.id,
            account.id,
            occurred_at.clone(),
        )
        .validate()
        .unwrap();
        maximum.note = Some("注".repeat(1000));
        validate_transaction(
            &maximum,
            &ActiveReferences::new(vec![category.clone()], vec![account.clone()]),
        )
        .unwrap();

        let merchant_error = TransactionDraft::expense(
            Money::parse("32.60").unwrap(),
            "商".repeat(121),
            category.id,
            account.id,
            occurred_at,
        )
        .validate()
        .unwrap_err();
        assert_eq!(merchant_error.code(), "transaction.name_length_invalid");

        maximum.note = Some("注".repeat(1001));
        assert_eq!(
            validate_transaction(
                &maximum,
                &ActiveReferences::new(vec![category], vec![account])
            )
            .unwrap_err()
            .code(),
            "transaction.note_length_invalid"
        );
    }

    #[test]
    fn money_preserves_cents_and_rejects_numeric_overflow() {
        let amount = Money::parse("9999999999999999.99").unwrap();
        assert_eq!(amount.to_api_string(), "9999999999999999.99");
        assert_eq!(
            amount
                .checked_add(Money::parse("0.01").unwrap())
                .unwrap_err()
                .code(),
            "amount.out_of_range"
        );
        assert_eq!(
            Money::zero()
                .checked_add(Money::parse("12.50").unwrap())
                .unwrap()
                .to_api_string(),
            "12.50"
        );
    }

    #[test]
    fn calendar_keeps_input_local_time_and_bounded_offset() {
        let value = OccurredAt::parse("2026-08-31T23:05:07-11:30").unwrap();
        assert_eq!(value.local_date().to_string(), "2026-08-31");
        assert_eq!(value.local_time().to_string(), "23:05:07");
        assert_eq!(value.utc_offset_minutes(), -690);
        assert_eq!(
            OccurredAt::parse("2026-09-01T00:15:00+14:01")
                .unwrap_err()
                .code(),
            "time.offset_out_of_range"
        );
    }

    #[test]
    fn label_names_are_normalized_and_bounded_and_colors_are_hex() {
        let category = Category::new(
            CategoryId::new(1),
            CategoryKind::Expense,
            "  日常\t餐饮  ",
            "#a1b2c3",
            true,
            0,
        )
        .unwrap();
        assert_eq!(category.name, "日常 餐饮");
        assert_eq!(category.color, "#A1B2C3");
        assert_eq!(
            AccountLabel::new(AccountId::new(1), "", true)
                .unwrap_err()
                .code(),
            "label.name_length_invalid"
        );
        assert_eq!(
            Category::new(
                CategoryId::new(2),
                CategoryKind::Expense,
                "x".repeat(41),
                "#123456",
                true,
                0,
            )
            .unwrap_err()
            .code(),
            "label.name_length_invalid"
        );
        assert_eq!(
            Category::new(
                CategoryId::new(3),
                CategoryKind::Expense,
                "交通",
                "#12345G",
                true,
                0,
            )
            .unwrap_err()
            .code(),
            "category.color_invalid"
        );
    }

    #[test]
    fn category_emoji_is_required_and_limited_to_sixteen_unicode_characters() {
        let category = Category::new_with_emoji(
            CategoryId::new(1),
            CategoryKind::Expense,
            "餐饮",
            "🍚".repeat(16),
            "#246B45",
            true,
            0,
        )
        .unwrap();
        assert_eq!(category.emoji.chars().count(), 16);
        assert_eq!(
            Category::new_with_emoji(
                CategoryId::new(2),
                CategoryKind::Expense,
                "交通",
                "🚗".repeat(17),
                "#A7C957",
                true,
                1,
            )
            .unwrap_err()
            .code(),
            "category.emoji_length_invalid"
        );
    }

    #[test]
    fn label_migrations_and_reorders_preserve_domain_invariants() {
        let source = Category::new(
            CategoryId::new(1),
            CategoryKind::Expense,
            "餐饮",
            "#246B45",
            false,
            0,
        )
        .unwrap();
        let inactive_target = Category::new(
            CategoryId::new(2),
            CategoryKind::Expense,
            "交通",
            "#A7C957",
            false,
            1,
        )
        .unwrap();
        assert_eq!(
            validate_category_migration(&source, &inactive_target)
                .unwrap_err()
                .code(),
            "category.migration_target_inactive"
        );
        assert_eq!(
            validate_complete_order(
                &[CategoryId::new(1), CategoryId::new(2)],
                &[CategoryId::new(2)]
            )
            .unwrap_err()
            .code(),
            "category.order_incomplete"
        );
        validate_complete_order(
            &[CategoryId::new(1), CategoryId::new(2)],
            &[CategoryId::new(2), CategoryId::new(1)],
        )
        .unwrap();
    }
}
