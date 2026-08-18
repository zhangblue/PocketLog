import { useEffect, useId, useRef, useState } from 'react'
import { useFinance } from '../../app/FinanceProvider'
import { EmptyState } from '../../components/EmptyState'
import { AsyncPanel } from '../../components/AsyncPanel'
import { compareCategoryBreakdowns, daysInMonth, formatCurrency, isValidCalendarDate, isValidMonth, previousMonth, selectCategoryBreakdownForTransactions, selectDailyTrend, selectRangeTransactions } from '../../domain/selectors'
import type { Insight, Transaction, TransactionFilter } from '../../domain/types'

function monthBounds(month: string) {
  return { startDate: `${month}-01`, endDate: `${month}-${String(daysInMonth(month)).padStart(2, '0')}` }
}

function shiftRange(startDate: string, endDate: string) {
  const days = Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1
  const previousEnd = new Date(`${startDate}T00:00:00Z`)
  previousEnd.setUTCDate(previousEnd.getUTCDate() - 1)
  const previousStart = new Date(previousEnd)
  previousStart.setUTCDate(previousStart.getUTCDate() - days + 1)
  return { startDate: previousStart.toISOString().slice(0, 10), endDate: previousEnd.toISOString().slice(0, 10) }
}

function hasThreeContinuousMonths(months: string[], endMonth: string) {
  const needed = [endMonth, previousMonth(endMonth), previousMonth(previousMonth(endMonth))]
  return needed.every(month => months.includes(month))
}

function comparisonLabel(changePercent: number | null) {
  if (changePercent === null) return '暂无上期可比数据'
  return changePercent >= 0 ? `↑ 增长 ${changePercent}%` : `↓ 下降 ${Math.abs(changePercent)}%`
}

function activate(event: React.KeyboardEvent<HTMLButtonElement>, action: () => void) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    action()
  }
}

function rangeInsights(items: Transaction[], comparisons: ReturnType<typeof compareCategoryBreakdowns>, startDate: string, endDate: string, month: string): Insight[] {
  const transport = comparisons.find(item => item.categoryId === 'transport')
  const transportRows = items.filter(item => item.kind === 'expense' && item.categoryId === 'transport')
  const weekend = transportRows.filter(item => [0, 6].includes(new Date(`${item.occurredAt.slice(0, 10)}T00:00:00Z`).getUTCDay())).reduce((sum, item) => sum + item.amount, 0)
  const weekday = transportRows.filter(item => ![0, 6].includes(new Date(`${item.occurredAt.slice(0, 10)}T00:00:00Z`).getUTCDay())).reduce((sum, item) => sum + item.amount, 0)
  const expense = items.filter(item => item.kind === 'expense').reduce((sum, item) => sum + item.amount, 0)
  const income = items.filter(item => item.kind === 'income').reduce((sum, item) => sum + item.amount, 0)
  const result: Insight[] = []
  if (weekend > 0 && weekend >= weekday) result.push({ id: 'transport-weekend', title: '周末交通支出偏高', detail: `周末交通共 ¥${weekend.toFixed(0)}，不低于工作日交通`, filter: { month, kind: 'expense', categoryId: 'transport', dateFrom: startDate, dateTo: endDate, weekendOnly: true, sourceLabel: '周末交通支出偏高' }, tone: 'attention' })
  if (transport?.changePercent !== null && transport?.changePercent !== undefined) result.push({ id: 'transport-change', title: `交通支出${transport.changePercent >= 0 ? '↑ 增长' : '↓ 下降'} ${Math.abs(transport.changePercent)}%`, detail: '与上一相同长度周期相比', filter: { month, kind: 'expense', categoryId: 'transport', dateFrom: startDate, dateTo: endDate, sourceLabel: '交通支出变化' }, tone: 'neutral' })
  if (income > 0 || expense > 0) result.push({ id: 'savings-rate', title: `本期结余率 ${income === 0 ? 0 : Number((((income - expense) / income) * 100).toFixed(1))}%`, detail: '收入减支出后的结余比例', filter: { month, kinds: ['expense', 'income'], dateFrom: startDate, dateTo: endDate, sourceLabel: '本期结余表现' }, tone: income > expense ? 'positive' : 'attention' })
  return result
}

export function AnalyticsPage() {
  const { state, actions } = useFinance()
  const pageRef = useRef<HTMLElement>(null)
  const [rangeError, setRangeError] = useState('')
  const context = state.analytics
  const availableMonths = [...new Set(state.transactions.filter(item => item.kind === 'expense' && (!context.accountId || item.accountId === context.accountId)).map(item => item.occurredAt.slice(0, 7)).filter(isValidMonth))]
  const threeMonthsAvailable = hasThreeContinuousMonths(availableMonths, state.month)
  const rangeTransactions = selectRangeTransactions(state.transactions, context.startDate, context.endDate)
  const filteredTransactions = rangeTransactions.filter(item => !context.accountId || item.accountId === context.accountId)
  const breakdown = selectCategoryBreakdownForTransactions(filteredTransactions)
  const previousRange = shiftRange(context.startDate, context.endDate)
  const comparisons = compareCategoryBreakdowns(breakdown, selectCategoryBreakdownForTransactions(selectRangeTransactions(state.transactions, previousRange.startDate, previousRange.endDate).filter(item => !context.accountId || item.accountId === context.accountId)))
  const trend = selectDailyTrend(filteredTransactions, context.startDate, context.endDate)
  const displayInsights = rangeInsights(filteredTransactions, comparisons, context.startDate, context.endDate, state.month)
  const maxTrend = Math.max(...trend.map(item => item.amount), 1)
  const trendTitleId = useId()
  const trendDescriptionId = useId()

  useEffect(() => {
    if (context.scrollRestorePending) {
      window.scrollTo({ top: context.scrollTop })
      actions.consumeAnalyticsScrollRestore()
    }
  }, [])

  function changeContext(next: Partial<typeof context>) {
    actions.changeAnalyticsContext({ ...context, ...next })
  }

  function changeAccount(accountId: string) {
    const nextAccountId = accountId || undefined
    const months = [...new Set(state.transactions.filter(item => item.kind === 'expense' && (!nextAccountId || item.accountId === nextAccountId)).map(item => item.occurredAt.slice(0, 7)).filter(isValidMonth))]
    if (context.range === 'three-months' && !hasThreeContinuousMonths(months, state.month)) {
      actions.changeAnalyticsContext({ ...context, accountId: nextAccountId, range: 'month', ...monthBounds(state.month), scrollTop: 0, scrollRestorePending: false })
      return
    }
    changeContext({ accountId: nextAccountId, scrollTop: 0, scrollRestorePending: false })
  }

  function changeRange(range: typeof context.range) {
    setRangeError('')
    if (range === 'month') {
      const bounds = monthBounds(state.month)
      actions.changeAnalyticsContext({ ...context, range, ...bounds, scrollTop: 0 })
    } else if (range === 'three-months') {
      const startMonth = previousMonth(previousMonth(state.month))
      actions.changeAnalyticsContext({ ...context, range, startDate: `${startMonth}-01`, endDate: monthBounds(state.month).endDate, scrollTop: 0 })
    } else {
      actions.changeAnalyticsContext({ ...context, range, scrollTop: 0 })
    }
  }

  function changeCustom(bound: 'startDate' | 'endDate', value: string) {
    const next = { ...context, range: 'custom' as const, [bound]: value }
    if (!isValidCalendarDate(value) || !isValidCalendarDate(next.startDate) || !isValidCalendarDate(next.endDate) || next.startDate > next.endDate) {
      setRangeError('起始日期不能晚于结束日期')
      return
    }
    setRangeError('')
    actions.changeAnalyticsContext(next)
  }

  function resetNoResults() {
    setRangeError('')
    actions.changeAnalyticsContext({ range: 'month', ...monthBounds(state.month), accountId: undefined, scrollTop: 0, scrollRestorePending: false })
  }

  function openDetail(filter: Omit<TransactionFilter, 'month'>, sourceLabel: string) {
    actions.changeAnalyticsContext({ ...context, scrollTop: window.scrollY, scrollRestorePending: true })
    actions.openInsight({ month: filter.dateFrom ? filter.dateFrom.slice(0, 7) : state.month, dateFrom: context.startDate, dateTo: context.endDate, accountId: context.accountId || undefined, ...(filter.kinds ? {} : { kind: 'expense' as const }), ...filter, sourceLabel })
  }

  return (
    <section ref={pageRef} className="analytics-page" aria-labelledby="analytics-title">
      <div className="analytics-heading">
        <div><h1 id="analytics-title">消费分析</h1><p>{context.startDate} 至 {context.endDate} · 按分类与账户理解支出变化</p></div>
        <label className="analytics-account">账户<select data-analytics-account value={context.accountId ?? ''} onChange={event => changeAccount(event.target.value)}><option value="">全部账户</option>{state.accounts.map(account => <option key={account.id} value={account.id}>{account.name}{account.active ? '' : '（已停用）'}</option>)}</select></label>
      </div>
      <div className="analytics-controls" role="group" aria-label="分析时间范围">
        <button type="button" data-range="month" aria-pressed={context.range === 'month'} onClick={() => changeRange('month')}>本月</button>
        <button type="button" data-range="three-months" aria-pressed={context.range === 'three-months'} disabled={!threeMonthsAvailable} onClick={() => changeRange('three-months')}>近 3 月</button>
        <button type="button" data-range="custom" aria-pressed={context.range === 'custom'} onClick={() => changeRange('custom')}>自定义</button>
        {!threeMonthsAvailable && <p className="analytics-history-notice" role="status">历史数据不足，尚不能生成近 3 月趋势。</p>}
      </div>
      {!threeMonthsAvailable && <EmptyState variant="insufficient-history" onAction={actions.openDrawer} />}
      {context.range === 'custom' && <div className="analytics-custom-month"><label>开始日期<input data-custom-start type="date" value={context.startDate} onChange={event => changeCustom('startDate', event.target.value)} /></label><label>结束日期<input data-custom-end type="date" value={context.endDate} onChange={event => changeCustom('endDate', event.target.value)} /></label>{rangeError && <p role="alert">{rangeError}</p>}</div>}
      {breakdown.length === 0 ? <EmptyState variant={state.transactions.length === 0 ? 'first-use' : 'no-results'} onAction={state.transactions.length === 0 ? actions.openDrawer : resetNoResults} /> : <div className="analytics-grid">
        <AsyncPanel className="panel analytics-panel analytics-trend-panel" headingLevel={2} title="支出趋势" status="ready"><p className="panel-description">按发生日期查看支出</p><figure><svg role="img" aria-labelledby={`${trendTitleId} ${trendDescriptionId}`} viewBox="0 0 600 180"><title id={trendTitleId}>支出趋势</title><desc id={trendDescriptionId}>{trend.map(item => `${item.date} ¥${item.amount.toLocaleString('zh-CN')}`).join('；')}</desc>{trend.map((item, index) => <rect key={item.date} x={20 + index * (560 / Math.max(trend.length, 1))} y={160 - item.amount / maxTrend * 130} width={Math.max(8, 500 / Math.max(trend.length, 1))} height={item.amount / maxTrend * 130} className="analytics-trend-bar" />)}</svg><figcaption>{trend.map(item => `${item.date} ¥${item.amount.toLocaleString('zh-CN')}`).join('；')}</figcaption></figure><div className="analytics-trend-buttons">{trend.map(item => <button key={item.date} type="button" data-trend-bar={item.date} onClick={() => openDetail({ dateFrom: item.date, dateTo: item.date }, `${item.date} 支出`)} onKeyDown={event => activate(event, () => openDetail({ dateFrom: item.date, dateTo: item.date }, `${item.date} 支出`))}>{item.date} ¥{item.amount.toLocaleString('zh-CN')}</button>)}</div></AsyncPanel>
        <section className="panel analytics-panel" aria-labelledby="analytics-category-title"><div className="panel-head"><div><h2 id="analytics-category-title">分类构成</h2><p>选择分类查看对应交易</p></div></div><div className="analytics-category-list" aria-label="分类构成">{breakdown.map(item => { const category = state.categories.find(candidate => candidate.id === item.categoryId); const label = `${category?.name ?? item.categoryId}支出构成`; return <button key={item.categoryId} type="button" data-category-share={item.categoryId} onClick={() => openDetail({ categoryId: item.categoryId }, label)} onKeyDown={event => activate(event, () => openDetail({ categoryId: item.categoryId }, label))}><span>{category?.name ?? item.categoryId}</span><strong>{formatCurrency(item.amount)}</strong><small>{Math.round(item.ratio * 100)}%</small></button> })}</div></section>
        <section className="panel analytics-panel" aria-labelledby="analytics-comparison-title"><div className="panel-head"><div><h2 id="analytics-comparison-title">分类对比</h2><p>与上一相同长度周期相比</p></div></div><div className="analytics-comparison-list" aria-label="分类环比">{comparisons.map(item => { const category = state.categories.find(candidate => candidate.id === item.categoryId); const label = `${category?.name ?? item.categoryId}支出对比`; const evidence = item.current === 0 && item.previous > 0 ? previousRange : context; return <button key={item.categoryId} type="button" data-category-comparison={item.categoryId} onClick={() => openDetail({ categoryId: item.categoryId, dateFrom: evidence.startDate, dateTo: evidence.endDate }, label)} onKeyDown={event => activate(event, () => openDetail({ categoryId: item.categoryId, dateFrom: evidence.startDate, dateTo: evidence.endDate }, label))}><span>{category?.name ?? item.categoryId}</span><strong>{formatCurrency(item.current)}</strong><small>{comparisonLabel(item.changePercent)}</small></button> })}</div></section>
        <section className="insight-list analytics-insight-list" aria-label="消费洞察">{displayInsights.length ? displayInsights.map(insight => { const { month: _month, sourceLabel: _sourceLabel, ...filter } = insight.filter; return <button key={insight.id} type="button" className={`insight-card ${insight.tone}`} data-insight={insight.id} onClick={() => openDetail(filter, insight.title)} onKeyDown={event => activate(event, () => openDetail(filter, insight.title))}><strong>{insight.title}</strong><span>{insight.detail}</span></button> }) : <p className="analytics-insight-empty" role="status">当前范围暂无可验证洞察</p>}</section>
      </div>}
    </section>
  )
}
