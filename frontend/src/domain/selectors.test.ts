import { describe, expect, it, vi } from 'vitest'
import { sampleTransactions } from './sampleData'
import type { Transaction } from './types'
import {
  compareCategories,
  selectCategoryBreakdown,
  selectMonthlySummary,
  selectRecentTransactions,
  selectInsights,
  selectDailyTrend,
  isValidOccurredAt,
  selectRangeTransactions,
  selectWeeklyTrend,
  monthKey,
  buildMonthlyReport,
  daysInMonth,
  previousMonth,
} from './selectors'

describe('finance selectors', () => {
  it('通用自然月工具跨年并返回闰月真实天数', () => {
    expect(previousMonth('2027-01')).toBe('2026-12')
    expect(daysInMonth('2028-02')).toBe(29)
    expect(daysInMonth('2027-02')).toBe(28)
  })

  it('计算 2026 年 8 月汇总', () => {
    expect(selectMonthlySummary(sampleTransactions, '2026-08')).toEqual({
      expense: 6842,
      income: 12500,
      savingsRate: 45.3,
      transactionCount: 11,
    })
  })

  it('没有收入的月份将结余率归零', () => {
    expect(selectMonthlySummary(sampleTransactions, '2026-09')).toEqual({
      expense: 0,
      income: 0,
      savingsRate: 0,
      transactionCount: 0,
    })
  })

  it('账户间转账不计入收入或支出', () => {
    const transactions: Transaction[] = [
      { id: 'expense', kind: 'expense', amount: 100, categoryId: 'food', accountId: 'wechat', merchant: '午餐', occurredAt: '2026-08-01T12:00:00+08:00', note: '' },
      { id: 'transfer', kind: 'transfer', amount: 500, categoryId: 'transfer', accountId: 'wechat', targetAccountId: 'bank', merchant: '账户转账', occurredAt: '2026-08-02T12:00:00+08:00', note: '' },
    ]

    expect(selectMonthlySummary(transactions, '2026-08')).toEqual({
      expense: 100,
      income: 0,
      savingsRate: 0,
      transactionCount: 2,
    })
  })

  it('首页只返回最近 5 条记录', () => {
    const recent = selectRecentTransactions(sampleTransactions, '2026-08', 5)

    expect(recent).toHaveLength(5)
    expect(recent.map(item => item.merchant)).toEqual([
      '山丘咖啡',
      '城市出行',
      '鲜生活超市',
      '云海音乐',
      '八月薪资',
    ])
  })

  it('按支出金额降序生成 2026 年 8 月分类占比', () => {
    expect(selectCategoryBreakdown(sampleTransactions, '2026-08')).toEqual([
      { categoryId: 'housing', amount: 3620, ratio: 0.5291 },
      { categoryId: 'transport', amount: 1096, ratio: 0.1602 },
      { categoryId: 'shopping', amount: 1027.6, ratio: 0.1502 },
      { categoryId: 'food', amount: 1010.4, ratio: 0.1477 },
      { categoryId: 'entertainment', amount: 88, ratio: 0.0129 },
    ])
  })

  it('将 8 月分类与 7 月进行有必要精度的环比', () => {
    expect(compareCategories(sampleTransactions, '2026-08', '2026-07')).toEqual([
      { categoryId: 'housing', current: 3620, previous: 4000, changePercent: -9.5 },
      { categoryId: 'transport', current: 1096, previous: 979, changePercent: 12 },
      { categoryId: 'shopping', current: 1027.6, previous: 1093, changePercent: -6 },
      { categoryId: 'food', current: 1010.4, previous: 1232, changePercent: -18 },
      { categoryId: 'entertainment', current: 88, previous: 165, changePercent: -46.7 },
    ])
  })

  it('分类环比保留至少一位必要小数但样例整数显示不回归', () => {
    const precise: Transaction[] = [
      { id: 'previous', kind: 'expense', amount: 80, categoryId: 'food', accountId: 'cash', merchant: '上期', occurredAt: '2026-07-01T12:00:00+08:00', note: '' },
      { id: 'current', kind: 'expense', amount: 81, categoryId: 'food', accountId: 'cash', merchant: '本期', occurredAt: '2026-08-01T12:00:00+08:00', note: '' },
    ]

    expect(compareCategories(precise, '2026-08', '2026-07')[0].changePercent).toBe(1.3)
    const sample = Object.fromEntries(compareCategories(sampleTransactions, '2026-08', '2026-07').map(item => [item.categoryId, item.changePercent]))
    expect([sample.food, sample.transport, sample.shopping]).toEqual([-18, 12, -6])
  })

  it('上月没有同分类时用空环比表示', () => {
    const transactions: Transaction[] = [
      { id: 'new-category', kind: 'expense', amount: 12, categoryId: 'health', accountId: 'cash', merchant: '药店', occurredAt: '2026-08-09T12:00:00+08:00', note: '' },
    ]

    expect(compareCategories(transactions, '2026-08', '2026-07')).toEqual([
      { categoryId: 'health', current: 12, previous: 0, changePercent: null },
    ])
  })

  it('保留上期存在但本期归零的分类，并显示下降 100%', () => {
    const transactions: Transaction[] = [
      { id: 'july-shopping', kind: 'expense', amount: 100, categoryId: 'shopping', accountId: 'alipay', merchant: '上月购物', occurredAt: '2026-07-18T12:00:00+08:00', note: '' },
      { id: 'august-food', kind: 'expense', amount: 50, categoryId: 'food', accountId: 'wechat', merchant: '本月餐饮', occurredAt: '2026-08-18T12:00:00+08:00', note: '' },
    ]

    expect(compareCategories(transactions, '2026-08', '2026-07')).toEqual([
      { categoryId: 'food', current: 50, previous: 0, changePercent: null },
      { categoryId: 'shopping', current: 0, previous: 100, changePercent: -100 },
    ])
  })

  it('只选择真实日历日期且处于包含边界内的范围交易', () => {
    const transactions: Transaction[] = [
      { id: 'first', kind: 'expense', amount: 10, categoryId: 'food', accountId: 'wechat', merchant: '首日', occurredAt: '2026-07-01T12:00:00+08:00', note: '' },
      { id: 'last', kind: 'expense', amount: 20, categoryId: 'food', accountId: 'wechat', merchant: '末日', occurredAt: '2026-08-31T12:00:00+08:00', note: '' },
      { id: 'invalid', kind: 'expense', amount: 99, categoryId: 'food', accountId: 'wechat', merchant: '损坏', occurredAt: '2026-08-invalid', note: '' },
    ]

    expect(selectRangeTransactions(transactions, '2026-07-01', '2026-08-31').map(item => item.id)).toEqual(['first', 'last'])
  })

  it('拒绝不存在的范围日历边界和不完整 ISO 时间戳', () => {
    expect(selectRangeTransactions(sampleTransactions, '2026-02-30', '2026-08-31')).toEqual([])
    expect(selectRangeTransactions([{ ...sampleTransactions[0], occurredAt: '2026-08-18Tgarbage' }], '2026-08-01', '2026-08-31')).toEqual([])
  })

  it('完整 ISO 校验接受合法偏移并拒绝不可能时间', () => {
    expect(isValidOccurredAt('2026-08-08T23:59:59.123-05:30')).toBe(true)
    expect(isValidOccurredAt('2026-08-08T25:99:99+99:99')).toBe(false)
  })

  it('完整 ISO offset 接受正负 14 小时边界，拒绝越界一分钟', () => {
    expect(isValidOccurredAt('2026-08-08T00:00:00+14:00')).toBe(true)
    expect(isValidOccurredAt('2026-08-08T00:00:00-14:00')).toBe(true)
    expect(isValidOccurredAt('2026-08-08T00:00:00+14:01')).toBe(false)
    expect(isValidOccurredAt('2026-08-08T00:00:00-15:00')).toBe(false)
  })

  it('完整 ISO offset 分钟必须在 0 到 59，且月键不会从损坏时间戳派生', () => {
    expect(isValidOccurredAt('2026-08-08T00:00:00+05:59')).toBe(true)
    expect(isValidOccurredAt('2026-08-08T00:00:00+13:59')).toBe(true)
    expect(isValidOccurredAt('2026-08-08T00:00:00+05:60')).toBe(false)
    expect(isValidOccurredAt('2026-08-08T00:00:00+05:99')).toBe(false)
    expect(isValidOccurredAt('2026-08-08T00:00:00+13:60')).toBe(false)
    expect(isValidOccurredAt('2026-08-08T00:00:00+14:00')).toBe(true)
    expect(isValidOccurredAt('2026-08-08T00:00:00-14:00')).toBe(true)
    expect(isValidOccurredAt('2026-08-08T00:00:00+14:01')).toBe(false)
    expect(isValidOccurredAt('2026-08-08T00:00:00-14:01')).toBe(false)
    expect(isValidOccurredAt('2026-08-08T00:00:00+15:00')).toBe(false)
    expect(isValidOccurredAt('2026-08-08T00:00:00-15:00')).toBe(false)
    expect(monthKey('2026-08-08T00:00:00+13:59')).toBe('2026-08')
    expect(monthKey('2026-08-08T00:00:00+05:99')).toBe('')
  })

  it('每日趋势不把转账当作支出', () => {
    const transactions: Transaction[] = [
      { id: 'expense', kind: 'expense', amount: 75, categoryId: 'food', accountId: 'wechat', merchant: '午餐', occurredAt: '2026-08-02T12:00:00+08:00', note: '' },
      { id: 'transfer', kind: 'transfer', amount: 500, categoryId: 'transfer', accountId: 'wechat', targetAccountId: 'bank', merchant: '转账', occurredAt: '2026-08-02T13:00:00+08:00', note: '' },
    ]

    expect(selectDailyTrend(transactions, '2026-08-01', '2026-08-31')).toEqual([{ date: '2026-08-02', amount: 75 }])
  })

  it('仅将支出按自然周汇总为五个桶', () => {
    expect(selectWeeklyTrend(sampleTransactions, '2026-08')).toEqual([
      { week: 1, amount: 1348 },
      { week: 2, amount: 5199.4 },
      { week: 3, amount: 294.6 },
      { week: 4, amount: 0 },
      { week: 5, amount: 0 },
    ])
  })

  it('不将转账计入周趋势', () => {
    const transactions: Transaction[] = [
      { id: 'expense', kind: 'expense', amount: 75, categoryId: 'food', accountId: 'wechat', merchant: '午餐', occurredAt: '2026-08-02T12:00:00+08:00', note: '' },
      { id: 'transfer', kind: 'transfer', amount: 500, categoryId: 'transfer', accountId: 'wechat', targetAccountId: 'bank', merchant: '账户转账', occurredAt: '2026-08-03T12:00:00+08:00', note: '' },
    ]

    expect(selectWeeklyTrend(transactions, '2026-08')).toEqual([
      { week: 1, amount: 75 },
      { week: 2, amount: 0 },
      { week: 3, amount: 0 },
      { week: 4, amount: 0 },
      { week: 5, amount: 0 },
    ])
  })

  it('用 7 月对照生成可筛选的 8 月洞察', () => {
    expect(selectInsights(sampleTransactions, '2026-08', '2026-07')).toEqual([
      {
        id: 'transport-weekend',
        title: '周末交通支出偏高',
        detail: '周末交通共 ¥1050，不低于工作日交通',
        filter: { month: '2026-08', kind: 'expense', categoryId: 'transport', weekendOnly: true, sourceLabel: '周末交通支出偏高' },
        tone: 'attention',
      },
      {
        id: 'transport-change',
        title: '交通支出↑ 增长 12%',
        detail: '与上月同分类相比',
        filter: { month: '2026-08', kind: 'expense', categoryId: 'transport', sourceLabel: '交通支出变化' },
        tone: 'neutral',
      },
      {
        id: 'savings-rate',
        title: '本月结余率 45.3%',
        detail: '收入减支出后的结余比例',
        filter: { month: '2026-08', kinds: ['expense', 'income'], sourceLabel: '本月结余表现' },
        tone: 'positive',
      },
    ])
  })

  it('以账单 ISO 日期判定周末交通，不受宿主时区影响', () => {
    vi.stubEnv('TZ', 'Pacific/Kiritimati')

    try {
      expect(selectInsights(sampleTransactions, '2026-08', '2026-07')[0].detail).toBe('周末交通共 ¥1050，不低于工作日交通')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('没有真实周末交通时不生成周末交通偏高洞察', () => {
    const weekdayOnly: Transaction[] = [
      { id: 'weekday-transport', kind: 'expense', amount: 50, categoryId: 'transport', accountId: 'alipay', merchant: '周一通勤', occurredAt: '2026-08-03T12:00:00+08:00', note: '' },
      { id: 'july-transport', kind: 'expense', amount: 10, categoryId: 'transport', accountId: 'alipay', merchant: '上月交通', occurredAt: '2026-07-03T12:00:00+08:00', note: '' },
    ]

    expect(selectInsights(weekdayOnly, '2026-08', '2026-07').map(item => item.id)).not.toContain('transport-weekend')
  })

  it('交通上期为零时不生成伪造的增长 0% 洞察', () => {
    const transactions: Transaction[] = [
      { id: 'weekend-transport', kind: 'expense', amount: 50, categoryId: 'transport', accountId: 'alipay', merchant: '周末交通', occurredAt: '2026-08-02T12:00:00+08:00', note: '' },
    ]

    expect(selectInsights(transactions, '2026-08', '2026-07').map(item => item.title)).not.toContain('交通支出增长 0%')
  })

  it('月报从真实收支和分类环比生成可解释的亮点', () => {
    expect(buildMonthlyReport(sampleTransactions, '2026-08', '2026-07')).toMatchObject({
      headline: '这个月，你更会花钱了',
      score: 82,
      status: '稳健',
      scoreChange: 5,
      scoreChangeNarrative: '较上期提高 5 分（77 → 82）；状态保持稳健。',
      biggestSaving: { categoryId: 'entertainment', current: 88, previous: 165, changePercent: -46.7 },
      biggestGrowth: { categoryId: 'transport', current: 1096, previous: 979, changePercent: 12 },
    })
  })

  it('月报在没有上月数据、零基数或无交易时诚实降级', () => {
    const zeroBase: Transaction[] = [
      { id: 'new-expense', kind: 'expense', amount: 40, categoryId: 'health', accountId: 'cash', merchant: '新支出', occurredAt: '2026-08-09T12:00:00+08:00', note: '' },
    ]

    expect(buildMonthlyReport(zeroBase, '2026-08', '2026-07')).toMatchObject({
      score: 37,
      status: '需关注',
      biggestSaving: null,
      biggestGrowth: null,
    })
    expect(buildMonthlyReport([], '2026-08', '2026-07')).toMatchObject({
      headline: '本月还没有可回顾的收支记录',
      biggestSaving: null,
      biggestGrowth: null,
    })
    expect(buildMonthlyReport(sampleTransactions, '2026-13', '2026-12')).toMatchObject({
      headline: '所选月份无效，无法生成月度报告',
      biggestSaving: null,
      biggestGrowth: null,
    })
  })

  it('月报把本期归零的真实分类列为最大节省，且始终排除转账', () => {
    const transactions: Transaction[] = [
      { id: 'july-shopping', kind: 'expense', amount: 100, categoryId: 'shopping', accountId: 'wechat', merchant: '上月购物', occurredAt: '2026-07-18T12:00:00+08:00', note: '' },
      { id: 'august-transfer', kind: 'transfer', amount: 900, categoryId: 'transfer', accountId: 'wechat', targetAccountId: 'bank', merchant: '转账', occurredAt: '2026-08-18T12:00:00+08:00', note: '' },
    ]

    expect(buildMonthlyReport(transactions, '2026-08', '2026-07')).toMatchObject({
      biggestSaving: { categoryId: 'shopping', current: 0, previous: 100, changePercent: -100 },
      biggestGrowth: null,
    })
  })

  it('非法本期月份即使上期有数据也返回一致的空报告', () => {
    expect(buildMonthlyReport(sampleTransactions, '2026-13', '2026-08')).toMatchObject({
      headline: '所选月份无效，无法生成月度报告',
      biggestSaving: null,
      biggestGrowth: null,
      scoreChange: null,
      scoreChangeNarrative: '暂无上期可比。',
    })
  })

  it('上期月份无效或没有收支时明确报告历史不足', () => {
    const report = buildMonthlyReport(sampleTransactions, '2026-08', '2026-13')

    expect(report.biggestSaving).toBeNull()
    expect(report.biggestGrowth).toBeNull()
    expect(report.story).toBe('本月记录收入 ¥12,500、支出 ¥6,842；暂无上期可比。')
    expect(report.scoreChange).toBeNull()
    expect(report.scoreChangeNarrative).toBe('暂无上期可比。')

    const noHistory = buildMonthlyReport(sampleTransactions.filter(item => item.occurredAt.startsWith('2026-08')), '2026-08', '2026-07')
    expect(noHistory).toMatchObject({
      biggestSaving: null,
      biggestGrowth: null,
      scoreChange: null,
      scoreChangeNarrative: '暂无上期可比。',
    })
  })

  it('月报故事根据真实总支出生成增加、减少和持平三种方向', () => {
    const transaction = (id: string, month: string, amount: number): Transaction => ({ id, kind: 'expense', amount, categoryId: 'food', accountId: 'cash', merchant: id, occurredAt: `${month}-01T12:00:00+08:00`, note: '' })

    expect(buildMonthlyReport([transaction('prev', '2026-07', 1_200), transaction('current', '2026-08', 1_000)], '2026-08', '2026-07').story).toBe('本月支出 ¥1,000，较上月减少 ¥200。')
    expect(buildMonthlyReport([transaction('prev', '2026-07', 1_000), transaction('current', '2026-08', 1_200)], '2026-08', '2026-07').story).toBe('本月支出 ¥1,200，较上月增加 ¥200。')
    expect(buildMonthlyReport([transaction('prev', '2026-07', 1_000), transaction('current', '2026-08', 1_000)], '2026-08', '2026-07').story).toBe('本月支出 ¥1,000，与上月持平。')
  })

  it('月报评分 clamp 后在 55 和 75 阈值稳定映射状态与上期变化', () => {
    const transaction = (id: string, month: string, kind: Transaction['kind'], amount: number): Transaction => ({ id, kind, amount, categoryId: kind === 'income' ? 'salary' : 'food', accountId: 'cash', merchant: id, occurredAt: `${month}-01T12:00:00+08:00`, note: '' })
    const report = (income: number, expense: number) => buildMonthlyReport([
      transaction('previous-income', '2026-07', 'income', 100),
      transaction('previous-expense', '2026-07', 'expense', 100),
      transaction('income', '2026-08', 'income', income),
      transaction('expense', '2026-08', 'expense', expense),
    ], '2026-08', '2026-07')

    expect(report(100, 200)).toMatchObject({ score: 0, status: '需关注', scoreChange: -37 })
    expect(report(100, 82)).toMatchObject({ score: 55, status: '平衡', scoreChange: 18 })
    expect(report(100, 62)).toMatchObject({ score: 75, status: '稳健', scoreChange: 38 })
    expect(report(100, 0)).toMatchObject({ score: 100, status: '稳健', scoreChange: 63 })
  })

  it('月报亮点在百分比和绝对变化并列时按分类 ID 稳定裁决', () => {
    const rows: Transaction[] = [
      { id: 'previous-a', kind: 'expense', amount: 100, categoryId: 'a', accountId: 'cash', merchant: 'a', occurredAt: '2026-07-01T12:00:00+08:00', note: '' },
      { id: 'previous-b', kind: 'expense', amount: 100, categoryId: 'b', accountId: 'cash', merchant: 'b', occurredAt: '2026-07-02T12:00:00+08:00', note: '' },
      { id: 'current-a', kind: 'expense', amount: 80, categoryId: 'a', accountId: 'cash', merchant: 'a', occurredAt: '2026-08-01T12:00:00+08:00', note: '' },
      { id: 'current-b', kind: 'expense', amount: 80, categoryId: 'b', accountId: 'cash', merchant: 'b', occurredAt: '2026-08-02T12:00:00+08:00', note: '' },
      { id: 'previous-c', kind: 'expense', amount: 100, categoryId: 'c', accountId: 'cash', merchant: 'c', occurredAt: '2026-07-03T12:00:00+08:00', note: '' },
      { id: 'previous-d', kind: 'expense', amount: 100, categoryId: 'd', accountId: 'cash', merchant: 'd', occurredAt: '2026-07-04T12:00:00+08:00', note: '' },
      { id: 'current-c', kind: 'expense', amount: 120, categoryId: 'c', accountId: 'cash', merchant: 'c', occurredAt: '2026-08-03T12:00:00+08:00', note: '' },
      { id: 'current-d', kind: 'expense', amount: 120, categoryId: 'd', accountId: 'cash', merchant: 'd', occurredAt: '2026-08-04T12:00:00+08:00', note: '' },
    ]

    const normal = buildMonthlyReport(rows, '2026-08', '2026-07')
    const reordered = buildMonthlyReport([...rows].reverse(), '2026-08', '2026-07')
    expect(normal.biggestSaving?.categoryId).toBe('a')
    expect(normal.biggestGrowth?.categoryId).toBe('c')
    expect(reordered.biggestSaving?.categoryId).toBe('a')
    expect(reordered.biggestGrowth?.categoryId).toBe('c')
  })
})
