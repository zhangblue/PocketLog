//! 月度报告生成器：文案和评分只从汇总与环比事实确定性推导。

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::analytics::{AmountSummary, CategoryChange};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReportFacts {
    /// 报告的所有输入都来自同一个分析快照；报告生成器不自行查询数据，避免标题与汇总不一致。
    pub summary: AmountSummary,
    pub previous_summary: Option<AmountSummary>,
    pub changes: Vec<CategoryChange>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReportHighlight {
    /// 可下钻的分类变化证据。仅选择有有效环比基线的条目，避免把零基期当作“最大增长”。
    pub category_id: Uuid,
    pub name: String,
    pub amount: Decimal,
    pub change_rate: Decimal,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MonthlyReportDto {
    pub score: Option<i32>,
    pub rating: Option<String>,
    pub score_change: Option<i32>,
    pub biggest_saving: Option<ReportHighlight>,
    pub biggest_growth: Option<ReportHighlight>,
    pub story: String,
}

fn highlight(changes: &[CategoryChange], saving: bool) -> Option<ReportHighlight> {
    changes
        .iter()
        .filter(|c| {
            c.change_rate
                .map(|r| {
                    if saving {
                        r < Decimal::ZERO
                    } else {
                        r > Decimal::ZERO
                    }
                })
                .unwrap_or(false)
        })
        .max_by(|a, b| {
            let aa = a.change_rate.unwrap().abs();
            let bb = b.change_rate.unwrap().abs();
            aa.cmp(&bb)
                .then_with(|| {
                    (a.current - a.previous)
                        .abs()
                        .cmp(&(b.current - b.previous).abs())
                })
                .then_with(|| b.category_id.cmp(&a.category_id))
        })
        .map(|c| ReportHighlight {
            category_id: c.category_id,
            name: c.name.clone(),
            amount: c.current,
            change_rate: c.change_rate.unwrap(),
        })
}

pub fn score(summary: &AmountSummary) -> Option<i32> {
    // 评分只在结余率有定义（存在收入）时生成；四舍五入并钳制到 0..=100，保证展示稳定。
    summary.savings_rate.map(|rate| {
        (rate + Decimal::from(37))
            .round()
            .clamp(Decimal::ZERO, Decimal::from(100))
            .to_i32()
            .unwrap_or(0)
    })
}

pub fn build_monthly_report(input: ReportFacts) -> MonthlyReportDto {
    // 文案分支仅取事实字段而不引入随机性；相同快照始终生成相同报告，方便复核与打印留档。
    // 缺少收入或上一期时诚实降级，不编造评分或比较结果。
    let value = score(&input.summary);
    let rating = value.map(|s| {
        if s >= 75 {
            "稳健"
        } else if s >= 55 {
            "平衡"
        } else {
            "需关注"
        }
        .to_string()
    });
    let previous_score = input.previous_summary.as_ref().and_then(score);
    let score_change = value.zip(previous_score).map(|(a, b)| a - b);
    let biggest_saving = highlight(&input.changes, true);
    let biggest_growth = highlight(&input.changes, false);
    let story = match (&biggest_saving, &biggest_growth, input.summary.savings_rate) {
        (Some(s), Some(g), Some(rate)) => {
            format!(
                "本月结余率为 {rate:.1}%，{} 支出较上期下降，{} 支出有所增长。",
                s.name, g.name
            )
        }
        (Some(s), _, _) => format!("本月 {} 支出较上期下降，消费更趋克制。", s.name),
        (_, Some(g), _) => format!("本月 {} 支出较上期增长，需要留意消费变化。", g.name),
        (_, _, Some(rate)) => format!("本月结余率为 {rate:.1}%，继续保持记录。"),
        _ => "本月缺少收入数据，暂时无法计算结余率。".into(),
    };
    MonthlyReportDto {
        score: value,
        rating,
        score_change,
        biggest_saving,
        biggest_growth,
        story,
    }
}

use rust_decimal::prelude::ToPrimitive;

#[cfg(test)]
mod tests {
    use super::*;

    fn summary(income: &str, expense: &str, rate: Option<&str>) -> AmountSummary {
        AmountSummary {
            income: income.parse().unwrap(),
            expense: expense.parse().unwrap(),
            transfer: Decimal::ZERO,
            balance: (income.parse::<Decimal>().unwrap() - expense.parse::<Decimal>().unwrap()),
            savings_rate: rate.map(|r| r.parse().unwrap()),
            daily_expense: Decimal::ZERO,
            transaction_count: 1,
        }
    }

    #[test]
    fn score_uses_clamped_rounded_savings_rate() {
        assert_eq!(score(&summary("100", "0", Some("99.6"))), Some(100));
        assert_eq!(score(&summary("100", "42", Some("58.0"))), Some(95));
        assert_eq!(score(&summary("100", "100", Some("-99.6"))), Some(0));
        assert_eq!(score(&summary("0", "10", None)), None);
    }

    #[test]
    fn report_downgrades_without_income_or_comparison() {
        let report = build_monthly_report(ReportFacts {
            summary: summary("0", "10", None),
            previous_summary: None,
            changes: vec![],
        });
        assert_eq!(report.score, None);
        assert!(report.story.contains("无法计算"));
    }

    fn change(
        id: u128,
        name: &str,
        current: &str,
        previous: &str,
        rate: Option<&str>,
    ) -> CategoryChange {
        CategoryChange {
            category_id: Uuid::from_u128(id),
            name: name.to_owned(),
            current: current.parse().unwrap(),
            previous: previous.parse().unwrap(),
            change_rate: rate.map(|value| value.parse().unwrap()),
        }
    }

    #[test]
    fn report_selects_highlights_and_score_change() {
        let report = build_monthly_report(ReportFacts {
            summary: summary("100", "30", Some("70")),
            previous_summary: Some(summary("100", "60", Some("40"))),
            changes: vec![
                change(1, "餐饮", "10", "20", Some("-50")),
                change(2, "购物", "30", "10", Some("200")),
                change(3, "不变", "5", "5", Some("0")),
                change(4, "无基线", "5", "0", None),
            ],
        });
        assert_eq!(report.score, Some(100));
        assert_eq!(report.score_change, Some(23));
        assert_eq!(report.rating.as_deref(), Some("稳健"));
        assert_eq!(report.biggest_saving.as_ref().unwrap().name, "餐饮");
        assert_eq!(report.biggest_growth.as_ref().unwrap().name, "购物");
        assert!(report.story.contains("餐饮"));
        assert!(report.story.contains("购物"));
    }

    #[test]
    fn report_uses_each_rating_and_story_fallback() {
        for (rate, expected) in [("17", "需关注"), ("20", "平衡")] {
            let report = build_monthly_report(ReportFacts {
                summary: summary("100", "80", Some(rate)),
                previous_summary: None,
                changes: vec![],
            });
            assert_eq!(report.rating.as_deref(), Some(expected));
            assert!(report.story.contains("结余率"));
        }
        let report = build_monthly_report(ReportFacts {
            summary: summary("100", "80", Some("20")),
            previous_summary: None,
            changes: vec![change(1, "增长分类", "20", "10", Some("100"))],
        });
        assert!(report.story.contains("增长分类"));
        let report = build_monthly_report(ReportFacts {
            summary: summary("100", "80", Some("20")),
            previous_summary: None,
            changes: vec![change(2, "节省分类", "10", "20", Some("-50"))],
        });
        assert!(report.story.contains("节省分类"));
    }
}
