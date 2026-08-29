//! 基于只读事实计算汇总、趋势、分类构成与环比，保持结果可复算且可下钻。

use std::collections::BTreeMap;

use chrono::{Datelike, Duration, NaiveDate};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::transaction::TransactionKind;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AnalyticsTransaction {
    /// 分析阶段只携带计算与下钻所需的已持久化事实；不复用 API DTO，避免展示字段影响口径。
    pub id: Uuid,
    pub kind: TransactionKind,
    pub amount: Decimal,
    pub category_id: Option<Uuid>,
    pub account_id: Uuid,
    pub target_account_id: Option<Uuid>,
    pub local_date: NaiveDate,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AnalyticsCategory {
    pub id: Uuid,
    pub name: String,
    pub semantic_key: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Period {
    /// 闭区间起点和终点均以交易保存时的本地自然日表达，绝不按服务器时区截断。
    pub start: NaiveDate,
    pub end: NaiveDate,
    calendar_month: bool,
}

impl Period {
    pub fn new(start: NaiveDate, end: NaiveDate) -> Option<Self> {
        // 非月度的自定义区间允许任意长度，但拒绝反向范围，使下游不必处理负天数或空序列。
        (start <= end).then_some(Self {
            start,
            end,
            calendar_month: false,
        })
    }

    pub fn month(year: i32, month: u32) -> Option<Self> {
        // 通过下月第一天减一天取得真实月末，自动覆盖闰年和大小月，不在业务层维护月份表。
        let start = NaiveDate::from_ymd_opt(year, month, 1)?;
        let next = if month == 12 {
            NaiveDate::from_ymd_opt(year + 1, 1, 1)?
        } else {
            NaiveDate::from_ymd_opt(year, month + 1, 1)?
        };
        Some(Self {
            start,
            end: next - Duration::days(1),
            calendar_month: true,
        })
    }

    pub fn previous(self) -> Self {
        // 自然月按真实月份回退；自定义区间按等长区间回退，避免固定天数比较。
        if self.calendar_month {
            let (year, month) = if self.start.month() == 1 {
                (self.start.year() - 1, 12)
            } else {
                (self.start.year(), self.start.month() - 1)
            };
            return Self::month(year, month).expect("valid previous calendar month");
        }
        let length = (self.end - self.start).num_days() + 1;
        let end = self.start - Duration::days(1);
        Self {
            start: end - Duration::days(length - 1),
            end,
            calendar_month: false,
        }
    }

    pub fn contains(self, date: NaiveDate) -> bool {
        date >= self.start && date <= self.end
    }
    pub fn days(self) -> u32 {
        // 这里是包含首尾的天数，供日均支出与完整趋势补零共用，防止两个指标出现一日差异。
        ((self.end - self.start).num_days() + 1) as u32
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OverviewFacts {
    pub period: Period,
    pub current: Vec<AnalyticsTransaction>,
    pub previous: Vec<AnalyticsTransaction>,
    pub categories: Vec<AnalyticsCategory>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AmountSummary {
    pub expense: Decimal,
    pub income: Decimal,
    pub transfer: Decimal,
    pub balance: Decimal,
    pub savings_rate: Option<Decimal>,
    pub daily_expense: Decimal,
    pub transaction_count: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrendPoint {
    pub date: NaiveDate,
    pub amount: Decimal,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CategoryGroup {
    pub category_id: Option<Uuid>,
    pub name: String,
    pub amount: Decimal,
    pub included_category_ids: Vec<Uuid>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CategoryChange {
    pub category_id: Uuid,
    pub name: String,
    pub current: Decimal,
    pub previous: Decimal,
    pub change_rate: Option<Decimal>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct OverviewDto {
    pub summary: AmountSummary,
    pub trend: Vec<TrendPoint>,
    pub composition: Vec<CategoryGroup>,
    pub category_changes: Vec<CategoryChange>,
}

fn sum(transactions: &[AnalyticsTransaction], period: Period) -> AmountSummary {
    // 输入可包含比当前周期更多的快照事实；统一在此过滤，确保所有汇总字段采用完全相同的范围。
    let mut expense = Decimal::ZERO;
    let mut income = Decimal::ZERO;
    let mut transfer = Decimal::ZERO;
    let mut count = 0;
    for tx in transactions
        .iter()
        .filter(|t| period.contains(t.local_date))
    {
        count += 1;
        match tx.kind {
            TransactionKind::Expense => expense += tx.amount,
            TransactionKind::Income => income += tx.amount,
            TransactionKind::Transfer => transfer += tx.amount,
        }
    }
    // 转账单独统计但不进入结余，账户间搬家不应改变净收支。
    let balance = income - expense;
    let savings_rate =
        (income > Decimal::ZERO).then(|| (balance / income * Decimal::from(100)).round_dp(1));
    AmountSummary {
        expense,
        income,
        transfer,
        balance,
        savings_rate,
        daily_expense: (expense / Decimal::from(period.days())).round_dp(2),
        transaction_count: count,
    }
}

pub fn summarize(transactions: &[AnalyticsTransaction], period: Period) -> AmountSummary {
    // 公开的汇总入口，保持内部 `sum` 可在后续组合计算中复用而不暴露实现细节。
    sum(transactions, period)
}

pub fn category_composition(
    transactions: &[AnalyticsTransaction],
    categories: &[AnalyticsCategory],
    period: Period,
) -> Vec<CategoryGroup> {
    // 分类构成只统计支出；收入、转账即使有账户字段也不应挤占消费图表的颜色和排序位置。
    let mut amounts: BTreeMap<Uuid, Decimal> = BTreeMap::new();
    for tx in transactions
        .iter()
        .filter(|t| t.kind == TransactionKind::Expense && period.contains(t.local_date))
    {
        if let Some(id) = tx.category_id {
            *amounts.entry(id).or_default() += tx.amount;
        }
    }
    let names: BTreeMap<Uuid, String> = categories.iter().map(|c| (c.id, c.name.clone())).collect();
    let mut entries: Vec<_> = amounts.iter().map(|(id, amount)| (*id, *amount)).collect();
    entries.sort_by(|(a, x), (b, y)| y.cmp(x).then_with(|| a.cmp(b)));
    // 仅保留前四类；第 5 个及后续类别存在时才合并为“其他”，并保留分类 ID 以支持下钻。
    let mut groups = entries
        .iter()
        .take(4)
        .map(|(id, amount)| CategoryGroup {
            category_id: Some(*id),
            name: names.get(id).cloned().unwrap_or_else(|| "未分类".into()),
            amount: *amount,
            included_category_ids: vec![*id],
        })
        .collect::<Vec<_>>();
    let rest: Vec<Uuid> = entries.iter().skip(4).map(|(id, _)| *id).collect();
    if !rest.is_empty() {
        let amount = rest.iter().filter_map(|id| amounts.get(id)).copied().sum();
        groups.push(CategoryGroup {
            category_id: None,
            name: "其他".into(),
            amount,
            included_category_ids: rest,
        });
    }
    groups
}

pub fn trend(transactions: &[AnalyticsTransaction], period: Period) -> Vec<TrendPoint> {
    // 先填满周期内每一天，再累加交易，前端因此能区分“当天零消费”和“后端漏返回数据”。
    let mut by_date = BTreeMap::<NaiveDate, Decimal>::new();
    for day in 0..period.days() {
        by_date.insert(period.start + Duration::days(day as i64), Decimal::ZERO);
    }
    for tx in transactions
        .iter()
        .filter(|t| t.kind == TransactionKind::Expense && period.contains(t.local_date))
    {
        *by_date.entry(tx.local_date).or_default() += tx.amount;
    }
    by_date
        .into_iter()
        .map(|(date, amount)| TrendPoint { date, amount })
        .collect()
}

pub fn category_changes(
    current: &[AnalyticsTransaction],
    previous: &[AnalyticsTransaction],
    categories: &[AnalyticsCategory],
    period: Period,
    previous_period: Period,
) -> Vec<CategoryChange> {
    // 当前/上期都按分类 ID 聚合；上期为零时不计算百分比，以免返回数学上无定义的虚假增长率。
    let mut ids = BTreeMap::<Uuid, (Decimal, Decimal)>::new();
    for tx in current
        .iter()
        .filter(|t| t.kind == TransactionKind::Expense && period.contains(t.local_date))
    {
        if let Some(id) = tx.category_id {
            ids.entry(id).or_default().0 += tx.amount;
        }
    }
    for tx in previous
        .iter()
        .filter(|t| t.kind == TransactionKind::Expense && previous_period.contains(t.local_date))
    {
        if let Some(id) = tx.category_id {
            ids.entry(id).or_default().1 += tx.amount;
        }
    }
    let names: BTreeMap<Uuid, String> = categories.iter().map(|c| (c.id, c.name.clone())).collect();
    ids.into_iter()
        .map(|(id, (cur, prev))| CategoryChange {
            category_id: id,
            name: names.get(&id).cloned().unwrap_or_else(|| "未分类".into()),
            current: cur,
            previous: prev,
            change_rate: (prev != Decimal::ZERO)
                .then(|| ((cur - prev) / prev * Decimal::from(100)).round_dp(1)),
        })
        .collect()
}

pub fn build_overview(input: OverviewFacts) -> OverviewDto {
    // 本函数只组合已读取的同一快照事实，不访问时钟或数据库，故结果可重复、可测试且可追溯。
    let previous_period = input.period.previous();
    OverviewDto {
        summary: summarize(&input.current, input.period),
        trend: trend(&input.current, input.period),
        composition: category_composition(&input.current, &input.categories, input.period),
        category_changes: category_changes(
            &input.current,
            &input.previous,
            &input.categories,
            input.period,
            previous_period,
        ),
    }
}

pub type AnalyticsDto = OverviewDto;

pub fn build_analytics(input: OverviewFacts) -> AnalyticsDto {
    build_overview(input)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(value: u128) -> Uuid {
        Uuid::from_u128(value)
    }
    fn expense(value: &str, category_id: Uuid, day: u32) -> AnalyticsTransaction {
        AnalyticsTransaction {
            id: id(day as u128 + 100),
            kind: TransactionKind::Expense,
            amount: value.parse().unwrap(),
            category_id: Some(category_id),
            account_id: id(900),
            target_account_id: None,
            local_date: NaiveDate::from_ymd_opt(2026, 8, day).unwrap(),
        }
    }

    #[test]
    fn savings_rate_is_unavailable_without_income() {
        let period = Period::month(2026, 8).unwrap();
        let summary = summarize(&[expense("10.00", id(1), 1)], period);
        assert_eq!(summary.savings_rate, None);
        assert_eq!(summary.daily_expense, Decimal::new(32, 2));
    }

    #[test]
    fn top_four_plus_other_preserves_evidence_ids() {
        let period = Period::month(2026, 8).unwrap();
        let categories = (1..=5)
            .map(|n| AnalyticsCategory {
                id: id(n),
                name: n.to_string(),
                semantic_key: None,
            })
            .collect::<Vec<_>>();
        let transactions = (1..=5)
            .map(|n| expense(&format!("{n}.00"), id(n), 1))
            .collect::<Vec<_>>();
        let groups = category_composition(&transactions, &categories, period);
        assert_eq!(groups.len(), 5);
        assert_eq!(groups.last().unwrap().included_category_ids.len(), 1);
        assert_eq!(groups.last().unwrap().included_category_ids[0], id(1));
    }

    #[test]
    fn trend_fills_every_local_date_with_zero() {
        let period = Period::new(
            NaiveDate::from_ymd_opt(2026, 8, 30).unwrap(),
            NaiveDate::from_ymd_opt(2026, 9, 1).unwrap(),
        )
        .unwrap();
        let points = trend(&[], period);
        assert_eq!(points.len(), 3);
        assert!(points.iter().all(|point| point.amount == Decimal::ZERO));
    }

    #[test]
    fn calendar_month_previous_uses_actual_previous_month_length() {
        let february = Period::month(2024, 2).unwrap();
        assert_eq!(
            february.previous().start,
            NaiveDate::from_ymd_opt(2024, 1, 1).unwrap()
        );
        assert_eq!(
            february.previous().end,
            NaiveDate::from_ymd_opt(2024, 1, 31).unwrap()
        );
        let march = Period::month(2026, 3).unwrap();
        assert_eq!(
            march.previous().start,
            NaiveDate::from_ymd_opt(2026, 2, 1).unwrap()
        );
        assert_eq!(
            march.previous().end,
            NaiveDate::from_ymd_opt(2026, 2, 28).unwrap()
        );
    }

    #[test]
    fn custom_period_previous_keeps_same_number_of_days() {
        let current = Period::new(
            NaiveDate::from_ymd_opt(2026, 3, 15).unwrap(),
            NaiveDate::from_ymd_opt(2026, 4, 14).unwrap(),
        )
        .unwrap();
        assert_eq!(
            current.previous().start,
            NaiveDate::from_ymd_opt(2026, 2, 12).unwrap()
        );
        assert_eq!(
            current.previous().end,
            NaiveDate::from_ymd_opt(2026, 3, 14).unwrap()
        );
    }
}
