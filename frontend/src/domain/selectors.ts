import type { Insight, MonthlySummary, Transaction } from './types'

export interface CategoryBreakdown {
  categoryId: string
  amount: number
  ratio: number
}

export interface CategoryComparison {
  categoryId: string
  current: number
  previous: number
  changePercent: number | null
}

export interface MonthlyReport {
  headline: string
  score: number
  status: '稳健' | '平衡' | '需关注'
  scoreChange: number | null
  scoreChangeNarrative: string
  biggestSaving: CategoryComparison | null
  biggestGrowth: CategoryComparison | null
  story: string
}

export interface TrendDay {
  date: string
  amount: number
}

export function isValidMonth(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value)
  return Boolean(match && Number(match[2]) >= 1 && Number(match[2]) <= 12)
}

export function previousMonth(month: string) {
  if (!isValidMonth(month)) return ''
  const [year, rawMonth] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, rawMonth - 2, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export function daysInMonth(month: string) {
  if (!isValidMonth(month)) return 0
  const [year, rawMonth] = month.split('-').map(Number)
  return new Date(Date.UTC(year, rawMonth, 0)).getUTCDate()
}

export function isValidCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function isValidOccurredAt(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value)
  if (!match || !isValidCalendarDate(match[1])) return false
  if (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) return false
  if (!match[5]) return true
  const offsetHour = Number(match[6])
  const offsetMinute = Number(match[7])
  if (offsetMinute > 59) return false
  return offsetHour < 14 || (offsetHour === 14 && offsetMinute === 0)
}

export function monthKey(isoDate: string) {
  return isValidOccurredAt(isoDate) ? isoDate.slice(0, 7) : ''
}

export function selectMonthlyTransactions(items: Transaction[], month: string) {
  return isValidMonth(month) ? items.filter(item => monthKey(item.occurredAt) === month) : []
}

export function selectRangeTransactions(items: Transaction[], dateFrom: string, dateTo: string) {
  if (!isValidCalendarDate(dateFrom) || !isValidCalendarDate(dateTo) || dateFrom > dateTo) return []
  return items.filter(item => isValidOccurredAt(item.occurredAt)).filter(item => {
    const date = item.occurredAt.slice(0, 10)
    return date >= dateFrom && date <= dateTo
  })
}

export function selectMonthlySummary(items: Transaction[], month: string): MonthlySummary {
  const monthly = selectMonthlyTransactions(items, month)
  const expense = monthly
    .filter(item => item.kind === 'expense')
    .reduce((sum, item) => sum + item.amount, 0)
  const income = monthly
    .filter(item => item.kind === 'income')
    .reduce((sum, item) => sum + item.amount, 0)

  return {
    expense,
    income,
    savingsRate: income === 0 ? 0 : Number((((income - expense) / income) * 100).toFixed(1)),
    transactionCount: monthly.length,
  }
}

export function selectRecentTransactions(items: Transaction[], month: string, limit: number) {
  return selectMonthlyTransactions(items, month)
    .slice()
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, limit)
}

export function selectCategoryBreakdown(items: Transaction[], month: string): CategoryBreakdown[] {
  return selectCategoryBreakdownForTransactions(selectMonthlyTransactions(items, month))
}

export function selectCategoryBreakdownForTransactions(items: Transaction[]): CategoryBreakdown[] {
  const expenses = items.filter(item => item.kind === 'expense')
  const total = expenses.reduce((sum, item) => sum + item.amount, 0)
  const grouped = new Map<string, Transaction[]>()

  for (const item of expenses) {
    grouped.set(item.categoryId, [...(grouped.get(item.categoryId) ?? []), item])
  }

  return Array.from(grouped, ([categoryId, rows]) => {
    const amount = rows.reduce((sum, item) => sum + item.amount, 0)

    return {
      categoryId,
      amount,
      ratio: total === 0 ? 0 : Number((amount / total).toFixed(4)),
    }
  }).sort((a, b) => b.amount - a.amount)
}

export function selectDailyTrend(items: Transaction[], dateFrom: string, dateTo: string): TrendDay[] {
  const amounts = new Map<string, number>()
  for (const item of selectRangeTransactions(items, dateFrom, dateTo)) {
    if (item.kind === 'expense') {
      const date = item.occurredAt.slice(0, 10)
      amounts.set(date, (amounts.get(date) ?? 0) + item.amount)
    }
  }
  return [...amounts].map(([date, amount]) => ({ date, amount })).sort((a, b) => a.date.localeCompare(b.date))
}

function compareBreakdowns(current: CategoryBreakdown[], previous: CategoryBreakdown[]): CategoryComparison[] {
  const categoryIds = [...current.map(item => item.categoryId), ...previous.map(item => item.categoryId).filter(id => !current.some(item => item.categoryId === id))]
  return categoryIds.map(categoryId => {
    const currentValue = current.find(item => item.categoryId === categoryId)?.amount ?? 0
    const oldValue = previous.find(old => old.categoryId === categoryId)?.amount ?? 0
    return { categoryId, current: currentValue, previous: oldValue, changePercent: oldValue === 0 ? null : Number((((currentValue - oldValue) / oldValue) * 100).toFixed(1)) }
  })
}

export function compareCategoryBreakdowns(current: CategoryBreakdown[], previous: CategoryBreakdown[]) {
  return compareBreakdowns(current, previous)
}

export function compareCategories(
  items: Transaction[],
  month: string,
  previousMonth: string,
): CategoryComparison[] {
  const current = selectCategoryBreakdown(items, month)
  const previous = selectCategoryBreakdown(items, previousMonth)

  return compareBreakdowns(current, previous)
}

export function formatCurrency(amount: number) {
  const hasFraction = !Number.isInteger(amount)
  return `¥${amount.toLocaleString('zh-CN', { minimumFractionDigits: hasFraction ? 2 : 0, maximumFractionDigits: hasFraction ? 2 : 0 })}`
}

function scoreForSummary(summary: MonthlySummary) {
  return Math.max(0, Math.min(100, Math.round(summary.savingsRate + 37)))
}

function statusForScore(score: number): MonthlyReport['status'] {
  return score >= 75 ? '稳健' : score >= 55 ? '平衡' : '需关注'
}

function sortHighlights(direction: 'saving' | 'growth') {
  return (left: CategoryComparison, right: CategoryComparison) => {
    const percentDifference = direction === 'saving'
      ? (left.changePercent ?? 0) - (right.changePercent ?? 0)
      : (right.changePercent ?? 0) - (left.changePercent ?? 0)
    if (percentDifference !== 0) return percentDifference

    const amountDifference = Math.abs(right.current - right.previous) - Math.abs(left.current - left.previous)
    if (amountDifference !== 0) return amountDifference

    return left.categoryId.localeCompare(right.categoryId)
  }
}

function emptyMonthlyReport(headline: string, story: string): MonthlyReport {
  const score = 37
  return {
    headline,
    score,
    status: statusForScore(score),
    scoreChange: null,
    scoreChangeNarrative: '暂无上期可比。',
    biggestSaving: null,
    biggestGrowth: null,
    story,
  }
}

export function buildMonthlyReport(items: Transaction[], month: string, previousMonth: string): MonthlyReport {
  if (!isValidMonth(month)) {
    return emptyMonthlyReport('所选月份无效，无法生成月度报告', '所选月份无效，无法生成月度回顾。')
  }

  const summary = selectMonthlySummary(items, month)
  const previousIsComparable = isValidMonth(previousMonth)
    && (() => {
      const previous = selectMonthlySummary(items, previousMonth)
      return previous.expense > 0 || previous.income > 0
    })()
  const previousSummary = previousIsComparable ? selectMonthlySummary(items, previousMonth) : null
  const comparable = previousSummary
    ? compareCategories(items, month, previousMonth).filter(item => item.changePercent !== null)
    : []
  const biggestSaving = comparable
    .filter(item => (item.changePercent ?? 0) < 0)
    .sort(sortHighlights('saving'))[0] ?? null
  const biggestGrowth = comparable
    .filter(item => (item.changePercent ?? 0) > 0)
    .sort(sortHighlights('growth'))[0] ?? null
  const score = scoreForSummary(summary)
  const status = statusForScore(score)
  const hasFinancialActivity = summary.expense > 0 || summary.income > 0
  const headline = !hasFinancialActivity
    ? '本月还没有可回顾的收支记录'
    : previousSummary && summary.expense < previousSummary.expense
      ? '这个月，你更会花钱了'
      : '这个月的消费值得回顾'
  const story = !hasFinancialActivity
    ? '转账不计入收支回顾；记下第一笔收支后，这里会生成月度回顾。'
    : !previousSummary
      ? `本月记录收入 ${formatCurrency(summary.income)}、支出 ${formatCurrency(summary.expense)}；暂无上期可比。`
      : summary.expense === previousSummary.expense
        ? `本月支出 ${formatCurrency(summary.expense)}，与上月持平。`
        : `本月支出 ${formatCurrency(summary.expense)}，较上月${summary.expense < previousSummary.expense ? '减少' : '增加'} ${formatCurrency(Math.abs(summary.expense - previousSummary.expense))}。`
  const previousScore = previousSummary ? scoreForSummary(previousSummary) : null
  const previousStatus = previousScore === null ? null : statusForScore(previousScore)
  const scoreChange = previousScore === null ? null : score - previousScore
  const scoreChangeNarrative = scoreChange === null
    ? '暂无上期可比。'
    : scoreChange === 0
      ? `与上期评分持平（${score} 分）；状态保持${status}。`
      : `较上期${scoreChange > 0 ? '提高' : '降低'} ${Math.abs(scoreChange)} 分（${previousScore} → ${score}）；${previousStatus === status ? `状态保持${status}` : `状态由${previousStatus}变为${status}`}。`

  return {
    headline,
    score,
    status,
    scoreChange,
    scoreChangeNarrative,
    biggestSaving,
    biggestGrowth,
    story,
  }
}

export function selectWeeklyTrend(items: Transaction[], month: string) {
  const weeks = [0, 0, 0, 0, 0]

  for (const item of selectMonthlyTransactions(items, month)) {
    if (item.kind !== 'expense') continue

    const day = Number(item.occurredAt.slice(8, 10))
    weeks[Math.min(4, Math.floor((day - 1) / 7))] += item.amount
  }

  return weeks.map((amount, index) => ({ week: index + 1, amount }))
}

export function selectInsights(items: Transaction[], month: string, previousMonth: string): Insight[] {
  const monthly = selectMonthlyTransactions(items, month)
  const summary = selectMonthlySummary(items, month)
  const comparisons = compareCategories(items, month, previousMonth)
  const transport = comparisons.find(item => item.categoryId === 'transport')
  const weekendTransport = monthly
    .filter(item => item.kind === 'expense' && item.categoryId === 'transport')
    .filter(item => [0, 6].includes(new Date(`${item.occurredAt.slice(0, 10)}T00:00:00Z`).getUTCDay()))
    .reduce((sum, item) => sum + item.amount, 0)
  const weekdayTransport = monthly
    .filter(item => item.kind === 'expense' && item.categoryId === 'transport')
    .filter(item => ![0, 6].includes(new Date(`${item.occurredAt.slice(0, 10)}T00:00:00Z`).getUTCDay()))
    .reduce((sum, item) => sum + item.amount, 0)

  const insights: Insight[] = []
  if (weekendTransport > 0 && weekendTransport >= weekdayTransport) {
    insights.push({
      id: 'transport-weekend',
      title: '周末交通支出偏高',
      detail: `周末交通共 ¥${weekendTransport.toFixed(0)}，不低于工作日交通`,
      filter: { month, kind: 'expense', categoryId: 'transport', weekendOnly: true, sourceLabel: '周末交通支出偏高' },
      tone: 'attention',
    })
  }

  if (transport?.changePercent !== null && transport?.changePercent !== undefined) {
    insights.push({
      id: 'transport-change',
      title: `交通支出${transport.changePercent >= 0 ? '↑ 增长' : '↓ 下降'} ${Math.abs(transport.changePercent)}%`,
      detail: '与上月同分类相比',
      filter: { month, kind: 'expense', categoryId: 'transport', sourceLabel: '交通支出变化' },
      tone: 'neutral',
    })
  }

  return [
    ...insights,
    {
      id: 'savings-rate',
      title: `本月结余率 ${summary.savingsRate}%`,
      detail: '收入减支出后的结余比例',
      filter: { month, kinds: ['expense', 'income'], sourceLabel: '本月结余表现' },
      tone: summary.savingsRate >= 40 ? 'positive' : 'attention',
    },
  ]
}
