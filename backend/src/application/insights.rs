//! 从只读分析事实生成可追溯洞察；每条洞察都携带可下钻的筛选证据。

use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::application::{AppError, DataRevision, ports::LedgerRepository};
use crate::domain::{
    TransactionKind,
    analytics::{AnalyticsCategory, AnalyticsTransaction, Period},
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InsightFacts {
    /// 洞察输入与图表共用仓储的可重复读快照，保证证据筛选与屏幕上的金额一致。
    pub period: Period,
    pub current: Vec<AnalyticsTransaction>,
    pub previous: Vec<AnalyticsTransaction>,
    pub categories: Vec<AnalyticsCategory>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DrilldownFilter {
    /// 前端跳转收支明细时可直接使用的筛选证据，而非不可解释的自然语言推断。
    pub start: NaiveDate,
    pub end: NaiveDate,
    pub category_id: Option<Uuid>,
    pub account_id: Option<Uuid>,
    pub weekend_only: bool,
    pub kinds: Vec<TransactionKind>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct InsightDto {
    pub code: String,
    pub title: String,
    pub description: String,
    pub source_label: String,
    pub current_filter: DrilldownFilter,
    pub previous_filter: Option<DrilldownFilter>,
    pub included_category_ids: Option<Vec<Uuid>>,
}

pub fn build_insights(input: InsightFacts) -> Vec<InsightDto> {
    // 规则按确定顺序运行。数据不足时不生成对应洞察，宁可留白也不以零值伪造趋势。
    let mut result = Vec::new();
    let expense = |tx: &&AnalyticsTransaction| tx.kind == TransactionKind::Expense;
    let transport = input
        .categories
        .iter()
        .find(|c| c.semantic_key.as_deref() == Some("transport"));
    // 只有真实周末交易达到条件才生成洞察，避免把缺失数据误报成趋势。
    if let Some(category) = transport {
        let weekend: Decimal = input
            .current
            .iter()
            .filter(|t| {
                expense(t)
                    && t.category_id == Some(category.id)
                    && input.period.contains(t.local_date)
                    && t.local_date.weekday().number_from_monday() >= 6
            })
            .map(|t| t.amount)
            .sum();
        let weekday: Decimal = input
            .current
            .iter()
            .filter(|t| {
                expense(t)
                    && t.category_id == Some(category.id)
                    && input.period.contains(t.local_date)
                    && t.local_date.weekday().number_from_monday() < 6
            })
            .map(|t| t.amount)
            .sum();
        if weekend > Decimal::ZERO && weekend >= weekday {
            result.push(InsightDto {
                code: "transport_weekend".into(),
                title: "周末交通支出偏高".into(),
                description: format!("周末交通支出为 {weekend:.2}，不低于工作日。"),
                source_label: "周末交通支出明细".into(),
                current_filter: DrilldownFilter {
                    start: input.period.start,
                    end: input.period.end,
                    category_id: Some(category.id),
                    account_id: None,
                    weekend_only: true,
                    kinds: vec![TransactionKind::Expense],
                },
                previous_filter: None,
                included_category_ids: None,
            });
        }
    }
    // 环比证据同时保存当前期与上一期筛选，返回明细后仍能解释变化来源。
    let changes = crate::domain::analytics::category_changes(
        &input.current,
        &input.previous,
        &input.categories,
        input.period,
        input.period.previous(),
    );
    let mut changes = changes
        .into_iter()
        .filter(|change| change.previous > Decimal::ZERO && change.change_rate.is_some())
        .collect::<Vec<_>>();
    changes.sort_by(|a, b| {
        b.change_rate
            .unwrap()
            .abs()
            .cmp(&a.change_rate.unwrap().abs())
            .then_with(|| a.category_id.cmp(&b.category_id))
    });
    for change in changes {
        if result.len() >= 3 {
            break;
        }
        let rate = change.change_rate.unwrap();
        let direction = if rate >= Decimal::ZERO {
            "增长"
        } else {
            "下降"
        };
        result.push(InsightDto {
            code: "category_change".into(),
            title: format!("{}支出{}", change.name, direction),
            description: format!(
                "{}支出较上期{} {:.1}%。",
                change.name,
                direction,
                rate.abs()
            ),
            source_label: format!("{}当前期与上一期明细", change.name),
            current_filter: DrilldownFilter {
                start: input.period.start,
                end: input.period.end,
                category_id: Some(change.category_id),
                account_id: None,
                weekend_only: false,
                kinds: vec![TransactionKind::Expense],
            },
            previous_filter: Some(DrilldownFilter {
                start: input.period.previous().start,
                end: input.period.previous().end,
                category_id: Some(change.category_id),
                account_id: None,
                weekend_only: false,
                kinds: vec![TransactionKind::Expense],
            }),
            included_category_ids: None,
        });
    }
    let current_income: Decimal = input
        .current
        .iter()
        .filter(|t| t.kind == TransactionKind::Income && input.period.contains(t.local_date))
        .map(|t| t.amount)
        .sum();
    let current_expense: Decimal = input
        .current
        .iter()
        .filter(|t| expense(t) && input.period.contains(t.local_date))
        .map(|t| t.amount)
        .sum();
    // 正收入是结余率洞察的前提；支出按周期内合计计算（可为零），并排除转账。
    if current_income > Decimal::ZERO {
        let rate =
            ((current_income - current_expense) / current_income * Decimal::from(100)).round_dp(1);
        result.push(InsightDto {
            code: "savings_rate".into(),
            title: "本月结余率".into(),
            description: format!(
                "收入 {current_income:.2}，支出 {current_expense:.2}，结余率 {rate:.1}%。"
            ),
            source_label: "收入与支出明细（不含转账）".into(),
            current_filter: DrilldownFilter {
                start: input.period.start,
                end: input.period.end,
                category_id: None,
                account_id: None,
                weekend_only: false,
                kinds: vec![TransactionKind::Income, TransactionKind::Expense],
            },
            previous_filter: None,
            included_category_ids: None,
        });
    }
    result.truncate(3);
    result
}

pub async fn overview<R: LedgerRepository>(
    repository: &R,
    period: Period,
    account_id: Option<Uuid>,
) -> Result<
    (
        crate::domain::analytics::OverviewDto,
        Vec<InsightDto>,
        DataRevision,
    ),
    AppError,
> {
    // 一次仓储调用取得事实与修订版本；不能分别请求汇总和洞察，否则并发写入会让两者依据不同数据。
    // 仓储返回同一只读快照及其修订版本，保证图表和洞察不会读到不同状态。
    let (facts, revision) = repository.analytics_facts(period, account_id).await?;
    let insights = build_insights(InsightFacts {
        period: facts.period,
        current: facts.current.clone(),
        previous: facts.previous.clone(),
        categories: facts.categories.clone(),
    });
    Ok((
        crate::domain::analytics::build_overview(facts),
        insights,
        revision,
    ))
}

pub async fn monthly_report<R: LedgerRepository>(
    repository: &R,
    period: Period,
    account_id: Option<Uuid>,
) -> Result<(crate::domain::report::MonthlyReportDto, DataRevision), AppError> {
    // 月报与总览采用同一分析事实生成，缺上期或收入时由领域报告层确定性降级。
    let (facts, revision) = repository.analytics_facts(period, account_id).await?;
    let summary = crate::domain::analytics::summarize(&facts.current, facts.period);
    let previous_summary =
        crate::domain::analytics::summarize(&facts.previous, facts.period.previous());
    let changes = crate::domain::analytics::category_changes(
        &facts.current,
        &facts.previous,
        &facts.categories,
        facts.period,
        facts.period.previous(),
    );
    let report = crate::domain::report::build_monthly_report(crate::domain::report::ReportFacts {
        summary,
        previous_summary: Some(previous_summary),
        changes,
    });
    Ok((report, revision))
}

trait WeekdayExt {
    fn weekday(&self) -> chrono::Weekday;
}
impl WeekdayExt for NaiveDate {
    fn weekday(&self) -> chrono::Weekday {
        chrono::Datelike::weekday(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::repositories::SeaOrmLedgerRepository;

    fn transaction(id: u128, amount: &str, date: NaiveDate) -> AnalyticsTransaction {
        AnalyticsTransaction {
            id: Uuid::from_u128(id),
            kind: TransactionKind::Expense,
            amount: amount.parse().unwrap(),
            category_id: Some(Uuid::from_u128(10)),
            account_id: Uuid::from_u128(20),
            target_account_id: None,
            local_date: date,
        }
    }

    #[test]
    fn category_change_contains_both_period_filters() {
        let period = Period::month(2026, 8).unwrap();
        let insights = build_insights(InsightFacts {
            period,
            current: vec![transaction(
                1,
                "20",
                NaiveDate::from_ymd_opt(2026, 8, 1).unwrap(),
            )],
            previous: vec![transaction(
                2,
                "10",
                NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
            )],
            categories: vec![AnalyticsCategory {
                id: Uuid::from_u128(10),
                name: "餐饮".into(),
                semantic_key: None,
            }],
        });
        let item = insights
            .iter()
            .find(|item| item.code == "category_change")
            .unwrap();
        assert_eq!(
            item.current_filter.start,
            NaiveDate::from_ymd_opt(2026, 8, 1).unwrap()
        );
        assert_eq!(
            item.previous_filter.as_ref().unwrap().start,
            NaiveDate::from_ymd_opt(2026, 7, 1).unwrap()
        );
        assert_eq!(
            item.previous_filter.as_ref().unwrap().category_id,
            Some(Uuid::from_u128(10))
        );
    }

    #[test]
    fn emits_weekend_transport_and_savings_evidence() {
        let period = Period::month(2026, 8).unwrap();
        let transport_id = Uuid::from_u128(11);
        let mut weekend = transaction(1, "60", NaiveDate::from_ymd_opt(2026, 8, 1).unwrap());
        weekend.category_id = Some(transport_id);
        let mut income = weekend.clone();
        income.id = Uuid::from_u128(2);
        income.kind = TransactionKind::Income;
        income.amount = Decimal::from(200);
        income.category_id = None;
        let insights = build_insights(InsightFacts {
            period,
            current: vec![weekend, income],
            previous: vec![],
            categories: vec![AnalyticsCategory {
                id: transport_id,
                name: "交通".into(),
                semantic_key: Some("transport".into()),
            }],
        });
        assert!(
            insights
                .iter()
                .any(|item| item.code == "transport_weekend" && item.current_filter.weekend_only)
        );
        assert!(
            insights
                .iter()
                .any(|item| item.code == "savings_rate" && item.current_filter.kinds.len() == 2)
        );
    }

    #[tokio::test]
    async fn overview_and_report_propagate_repository_failures() {
        let repository = SeaOrmLedgerRepository::new(sea_orm::DatabaseConnection::Disconnected);
        let period = Period::month(2026, 8).unwrap();
        assert_eq!(
            overview(&repository, period, None)
                .await
                .unwrap_err()
                .code(),
            "persistence.database_error"
        );
        assert_eq!(
            monthly_report(&repository, period, None)
                .await
                .unwrap_err()
                .code(),
            "persistence.database_error"
        );
    }
}
