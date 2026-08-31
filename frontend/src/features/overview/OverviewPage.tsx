import { useFinance } from '../../app/FinanceProvider'
import { daysInMonth, formatCurrency, previousMonth } from '../../domain/selectors'
import type { Transaction } from '../../domain/types'
import { EmptyState } from '../../components/EmptyState'
import { AsyncPanel } from '../../components/AsyncPanel'
import { CategoryDonut } from './CategoryDonut'
import { TrendChart } from './TrendChart'

function formatSummaryMoney(amount: number) {
  return formatCurrency(amount)
}

function formatDailyAverage(amount: number) {
  return formatCurrency(amount)
}

function formatTransactionMoney(amount: number) {
  return `¥${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function monthTitle(month: string) {
  const [, rawMonth] = month.split('-')
  return `${Number(rawMonth)} 月财务总览`
}

function transactionDate(transaction: Transaction) {
  const month = Number(transaction.occurredAt.slice(5, 7))
  const day = Number(transaction.occurredAt.slice(8, 10))
  return `${month} 月 ${day} 日`
}

export function OverviewPage() {
  const { state, actions } = useFinance()
  const apiData = state.overview.value?.data
  const summary = apiData ? {
    expense: Number(apiData.summary.expense),
    income: Number(apiData.summary.income),
    savingsRate: Number(apiData.summary.savingsRate ?? 0),
    transactionCount: apiData.summary.transactionCount,
  } : { expense: 0, income: 0, savingsRate: 0, transactionCount: 0 }
  // The API deliberately returns the recent page as part of the overview query.
  // Do not rebuild it from the transaction list, which may be paginated or stale.
  const recentTransactions = state.transactions.slice(0, 5)
  const breakdown = apiData?.composition.map(item => ({ categoryId: item.categoryId ?? 'other', amount: Number(item.amount), ratio: 0 })) ?? []
  const breakdownTotal = breakdown.reduce((sum, item) => sum + item.amount, 0)
  const normalizedBreakdown = breakdown.map(item => ({ ...item, ratio: breakdownTotal ? item.amount / breakdownTotal : 0 }))
  const dailyTrend = apiData?.trend.map(item => ({ date: item.date, amount: Number(item.amount) })) ?? []
  const priorMonth = previousMonth(state.month)
  const previousSummary = state.overview.value?.previousSummary
    ? { expense: Number(state.overview.value.previousSummary.expense), income: Number(state.overview.value.previousSummary.income), savingsRate: Number(state.overview.value.previousSummary.savingsRate ?? 0), transactionCount: state.overview.value.previousSummary.transactionCount }
    : { expense: 0, income: 0, savingsRate: 0, transactionCount: 0 }
  const currentDays = daysInMonth(state.month)
  const previousDays = daysInMonth(priorMonth)
  const insights = state.overview.value?.insights.map(item => ({ id: item.id, title: item.title, detail: item.detail, tone: item.tone, filter: item.drilldown?.currentFilter ?? { month: state.month, sourceLabel: item.title } })) ?? []
  const trendSummary = dailyTrend.map(item => `${item.date} ${formatSummaryMoney(item.amount)}`).join('；')
  const isFirstUse = summary.transactionCount === 0
  const hasPrevious = previousSummary.transactionCount > 0
  const compare = (current: number, previous: number, unit = '%') => {
    if (!hasPrevious) return '暂无上月可比'
    if (current === previous) return '较上月持平'
    if (previous === 0) return `较上月${current > 0 ? '增加' : '减少'}`
    const change = Number((Math.abs((current - previous) / previous) * 100).toFixed(1))
    return `较上月${current > previous ? '增加' : '减少'} ${change}${unit}`
  }
  const savingsComparison = !hasPrevious
    ? '暂无上月可比'
    : summary.savingsRate === previousSummary.savingsRate
      ? '较上月持平'
      : `较上月${summary.savingsRate > previousSummary.savingsRate ? '提高' : '降低'} ${Number(Math.abs(summary.savingsRate - previousSummary.savingsRate).toFixed(1))} 个百分点`
  const dailyAverage = currentDays ? summary.expense / currentDays : 0
  const previousDailyAverage = previousDays ? previousSummary.expense / previousDays : 0

  return (
    <div className="overview-page">
      <h1>{monthTitle(state.month)}</h1>
      {state.overview.status === 'loading' && <p className="panel-loading" role="status">总览加载中…</p>}
      {state.overview.status === 'error' && <p className="panel-error" role="alert">总览暂时无法加载。<button type="button" onClick={() => actions.retryDataLoad('overview')}>重试</button></p>}
      {state.overview.stale && state.overview.status !== 'ready' && <p className="panel-stale" role="status">当前显示最近一次成功的总览。</p>}
      {isFirstUse ? <EmptyState variant="first-use" onAction={actions.openDrawer} /> : <>
      <section className="metrics" aria-label="月度汇总">
        <article className="metric-card primary"><p>本月支出</p><strong>{formatSummaryMoney(summary.expense)}</strong><small>已记录 {summary.transactionCount} 笔交易 · {compare(summary.expense, previousSummary.expense)}</small></article>
        <article className="metric-card"><p>本月收入</p><strong>{formatSummaryMoney(summary.income)}</strong><small>{compare(summary.income, previousSummary.income)}</small></article>
        <article className="metric-card"><p>结余率</p><strong>{summary.savingsRate}%</strong><small>{savingsComparison}</small></article>
        <article className="metric-card"><p>日均支出</p><strong>{formatDailyAverage(dailyAverage)}</strong><small>按当月 {currentDays} 天计算 · {compare(dailyAverage, previousDailyAverage)}</small></article>
      </section>

      <section className="overview-grid" aria-label="消费洞察">
        <AsyncPanel className="panel trend-panel" headingLevel={2} title="支出趋势" status={state.overview.status === 'idle' ? 'ready' : state.overview.status} onRetry={() => actions.retryDataLoad('overview')}>
          <p className="panel-description">按日观察消费节奏</p>
          <TrendChart points={dailyTrend} summary={trendSummary} />
        </AsyncPanel>
        <section className="panel category-panel" aria-labelledby="category-heading">
          <div className="panel-head"><div><h2 id="category-heading">支出构成</h2><p>点击分类查看明细</p></div></div>
            <CategoryDonut
            breakdown={normalizedBreakdown}
            categories={state.categories}
            onCategoryClick={categoryId => actions.openInsight({ month: state.month, categoryId, sourceLabel: state.categories.find(item => item.id === categoryId)?.name })}
          />
        </section>
        <section className="insight-list" aria-label="本月洞察">
          {insights.map(insight => (
            <button key={insight.id} type="button" className={`insight-card ${insight.tone}`} onClick={() => actions.openInsight(insight.filter)}>
              <strong>{insight.title}</strong>
              <span>{insight.detail}</span>
            </button>
          ))}
        </section>
        <section className="panel recent-transactions" aria-labelledby="recent-heading">
          <div className="panel-head"><div><h2 id="recent-heading">最近明细</h2><p>最近 5 条交易</p></div></div>
          <div role="table" aria-label="最近交易">
            <div role="row" className="transaction-head">
              <span role="columnheader">交易</span><span role="columnheader">分类</span><span role="columnheader">日期</span><span role="columnheader">金额</span>
            </div>
            {recentTransactions.map(transaction => {
              const category = state.categories.find(item => item.id === transaction.categoryId)
              const amount = `${transaction.kind === 'income' ? '+' : transaction.kind === 'expense' ? '-' : '↔'} ${formatTransactionMoney(transaction.amount)}`
              return <div key={transaction.id} role="row" data-transaction-row className="transaction-row">
                <span role="cell">{transaction.merchant}</span>
                <span role="cell">{category?.name ?? transaction.categoryId}</span>
                <span role="cell">{transactionDate(transaction)}</span>
                <strong role="cell" className={transaction.kind}>{amount}</strong>
              </div>
            })}
          </div>
        </section>
      </section>
      </>}
    </div>
  )
}
