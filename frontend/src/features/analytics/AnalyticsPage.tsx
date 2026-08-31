import { useEffect, useId, useRef, useState } from 'react'
import { useFinance } from '../../app/FinanceProvider'
import { EmptyState } from '../../components/EmptyState'
import { AsyncPanel } from '../../components/AsyncPanel'
import { daysInMonth, formatCurrency, isValidCalendarDate, previousMonth } from '../../domain/selectors'
import type { TransactionFilter } from '../../domain/types'

const TREND_Y_AXIS_TICKS = 4
const TREND_CHART_LEFT = 56
const TREND_CHART_TOP = 18
const TREND_CHART_WIDTH = 524
const TREND_CHART_HEIGHT = 128
const TREND_CHART_BOTTOM = TREND_CHART_TOP + TREND_CHART_HEIGHT

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

function activate(event: React.KeyboardEvent<Element>, action: () => void) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    action()
  }
}

/** 将最大支出向上取整到易读量级，避免图表最高柱贴住边界。 */
function trendScaleMax(maximum: number) {
  if (maximum <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(maximum))
  return Math.ceil(maximum / magnitude) * magnitude
}

export function AnalyticsPage() {
  const { state, actions } = useFinance()
  const pageRef = useRef<HTMLElement>(null)
  const [rangeError, setRangeError] = useState('')
  // SVG 柱子悬停和键盘焦点共用这一状态，确保两种输入方式展示相同信息。
  const [trendTooltip, setTrendTooltip] = useState<{ date: string; amount: number; index: number } | null>(null)
  const context = state.analytics
  const apiData = state.analyticsState.value?.data
  const availableMonths = state.bootstrap.value?.months ?? []
  const accountAvailableMonths = context.accountId
    ? state.bootstrap.value?.accountMonths?.[context.accountId] ?? [...new Set(state.transactions.filter(item => item.accountId === context.accountId || item.targetAccountId === context.accountId).map(item => item.occurredAt.slice(0, 7)))]
    : availableMonths
  const threeMonthsAvailable = hasThreeContinuousMonths(accountAvailableMonths, state.month)
  const breakdown = apiData?.composition.map(item => ({ categoryId: item.categoryId ?? 'other', amount: Number(item.amount), ratio: 0 })) ?? []
  const breakdownTotal = breakdown.reduce((sum, item) => sum + item.amount, 0)
  const normalizedBreakdown = breakdown.map(item => ({ ...item, ratio: breakdownTotal ? item.amount / breakdownTotal : 0 }))
  const previousRange = shiftRange(context.startDate, context.endDate)
  const comparisons = apiData?.categoryChanges.map(item => ({ categoryId: item.categoryId, current: Number(item.current), previous: Number(item.previous), changePercent: item.changeRate == null ? null : Number(item.changeRate) })) ?? []
  const trend = apiData?.trend.map(item => ({ date: item.date, amount: Number(item.amount) })) ?? []
  const displayInsights = state.analyticsState.value?.insights.map(item => ({ id: item.id, title: item.title, detail: item.detail, tone: item.tone, filter: item.drilldown?.currentFilter ?? { month: state.month, sourceLabel: item.title } })) ?? []
  const maxTrend = Math.max(...trend.map(item => item.amount), 0)
  const trendScale = trendScaleMax(maxTrend)
  const trendYTicks = Array.from({ length: TREND_Y_AXIS_TICKS }, (_, index) => trendScale * (TREND_Y_AXIS_TICKS - index - 1) / (TREND_Y_AXIS_TICKS - 1))
  // 数据点较多时均匀抽取日期标签，避免横轴文字互相遮挡；金额仍只通过纵轴和提示展示。
  const trendAxisIndexes = trend.length <= 6
    ? trend.map((_, index) => index)
    : Array.from({ length: 6 }, (_, slot) => Math.round(slot * (trend.length - 1) / 5))
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
    const months = nextAccountId
      ? state.bootstrap.value?.accountMonths?.[nextAccountId] ?? [...new Set(state.transactions.filter(item => item.accountId === nextAccountId || item.targetAccountId === nextAccountId).map(item => item.occurredAt.slice(0, 7)))]
      : availableMonths
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
    actions.openInsight({
      ...filter,
      month: filter.dateFrom ? filter.dateFrom.slice(0, 7) : state.month,
      // Every drill-down must preserve the active account and the evidence
      // kind selected by the originating analysis component.
      accountId: filter.accountId ?? context.accountId,
      sourceLabel,
    })
  }

  return (
    <section ref={pageRef} className="analytics-page" aria-labelledby="analytics-title">
      <div className="analytics-heading">
        <div><h1 id="analytics-title">消费分析</h1><p>{context.startDate} 至 {context.endDate} · 按分类与账户理解支出变化</p></div>
        <label className="analytics-account">账户<select data-analytics-account value={context.accountId ?? ''} onChange={event => changeAccount(event.target.value)}><option value="">全部账户</option>{state.accounts.map(account => <option key={account.id} value={account.id}>{account.name}{account.active ? '' : '（已停用）'}</option>)}</select></label>
      </div>
      {state.analyticsState.status === 'loading' && <p className="panel-loading" role="status">分析加载中…</p>}
      {state.analyticsState.status === 'error' && <p className="panel-error" role="alert">分析暂时无法加载。<button type="button" onClick={() => actions.retryDataLoad('analytics')}>重试</button></p>}
      {state.analyticsState.stale && state.analyticsState.status !== 'ready' && <p className="panel-stale" role="status">当前显示最近一次成功的分析结果。</p>}
      <div className="analytics-controls" role="group" aria-label="分析时间范围">
        <button type="button" data-range="month" aria-pressed={context.range === 'month'} onClick={() => changeRange('month')}>本月</button>
        <button type="button" data-range="three-months" aria-pressed={context.range === 'three-months'} disabled={!threeMonthsAvailable} onClick={() => changeRange('three-months')}>近 3 月</button>
        <button type="button" data-range="custom" aria-pressed={context.range === 'custom'} onClick={() => changeRange('custom')}>自定义</button>
        {!threeMonthsAvailable && <p className="analytics-history-notice" role="status">历史数据不足，尚不能生成近 3 月趋势。</p>}
      </div>
      {!threeMonthsAvailable && !apiData && <EmptyState variant="insufficient-history" onAction={actions.openDrawer} />}
      {context.range === 'custom' && <div className="analytics-custom-month"><label>开始日期<input data-custom-start type="date" value={context.startDate} onChange={event => changeCustom('startDate', event.target.value)} /></label><label>结束日期<input data-custom-end type="date" value={context.endDate} onChange={event => changeCustom('endDate', event.target.value)} /></label>{rangeError && <p role="alert">{rangeError}</p>}</div>}
      {normalizedBreakdown.length === 0 ? <EmptyState variant={apiData ? 'no-results' : state.transactions.length === 0 ? 'first-use' : 'no-results'} onAction={apiData || state.transactions.length > 0 ? resetNoResults : actions.openDrawer} /> : <div className="analytics-grid">
          <AsyncPanel className="panel analytics-panel analytics-trend-panel" headingLevel={2} title="支出趋势" status="ready">
            <p className="panel-description">按发生日期查看支出</p>
            <figure>
              <svg role="group" aria-labelledby={`${trendTitleId} ${trendDescriptionId}`} viewBox="0 0 600 180">
                <title id={trendTitleId}>支出趋势</title>
                <desc id={trendDescriptionId}>{trend.map(item => `${item.date} ${formatCurrency(item.amount)}`).join('；')}</desc>
                {trendYTicks.map((amount, index) => {
                  const y = TREND_CHART_TOP + index * TREND_CHART_HEIGHT / (TREND_Y_AXIS_TICKS - 1)
                  return (
                    <g key={amount}>
                      <line className="analytics-trend-grid" x1={TREND_CHART_LEFT} x2={TREND_CHART_LEFT + TREND_CHART_WIDTH} y1={y} y2={y} />
                      <text data-trend-y-axis-label className="analytics-trend-y-axis-label" x={TREND_CHART_LEFT - 8} y={y + 3} textAnchor="end">{formatCurrency(amount)}</text>
                    </g>
                  )
                })}
                {trend.map((item, index) => {
                  const slotWidth = TREND_CHART_WIDTH / Math.max(trend.length, 1)
                  const barWidth = Math.max(8, Math.min(28, slotWidth * .65))
                  const x = TREND_CHART_LEFT + index * slotWidth + (slotWidth - barWidth) / 2
                  const height = item.amount / trendScale * TREND_CHART_HEIGHT
                  const y = TREND_CHART_BOTTOM - height
                  // 零支出日期仍保留最小透明命中区，使其可提示和键盘下钻。
                  const hitHeight = Math.max(height, 12)
                  const showTooltip = () => setTrendTooltip({ ...item, index })
                  const hideTooltip = () => setTrendTooltip(null)
                  const openTrendDetail = () => openDetail({ dateFrom: item.date, dateTo: item.date, kind: 'expense' }, `${item.date} 支出`)
                  return (
                    <g key={item.date}>
                      <rect x={x} y={y} width={barWidth} height={height} className="analytics-trend-bar" />
                      <rect
                        data-trend-column={item.date}
                        x={x}
                        y={TREND_CHART_BOTTOM - hitHeight}
                        width={barWidth}
                        height={hitHeight}
                        className="analytics-trend-hit-target"
                        fill="transparent"
                        pointerEvents="all"
                        role="button"
                        tabIndex={0}
                        aria-label={`${item.date} 支出 ${formatCurrency(item.amount)}`}
                        // 原生事件也要响应，令既有测试工具和实际鼠标悬停共享提示状态。
                        ref={element => {
                          if (element) {
                            element.onmouseenter = showTooltip
                            element.onmouseleave = hideTooltip
                          }
                        }}
                        onFocus={showTooltip}
                        onBlur={hideTooltip}
                        onClick={openTrendDetail}
                        onKeyDown={event => activate(event, openTrendDetail)}
                      />
                    </g>
                  )
                })}
                {trendAxisIndexes.map(index => {
                  const item = trend[index]
                  const slotWidth = TREND_CHART_WIDTH / Math.max(trend.length, 1)
                  return <text key={item.date} data-trend-axis-label className="analytics-trend-axis-label" x={TREND_CHART_LEFT + index * slotWidth + slotWidth / 2} y={174} textAnchor="middle">{item.date.slice(5)}</text>
                })}
                {trendTooltip && (() => {
                  const slotWidth = TREND_CHART_WIDTH / Math.max(trend.length, 1)
                  const tooltipX = Math.min(Math.max(TREND_CHART_LEFT + trendTooltip.index * slotWidth + slotWidth / 2, 86), 514)
                  const tooltipY = Math.max(TREND_CHART_TOP + 18, TREND_CHART_BOTTOM - trendTooltip.amount / trendScale * TREND_CHART_HEIGHT - 10)
                  return (
                    <g className="analytics-trend-tooltip" pointerEvents="none">
                      <rect x={tooltipX - 80} y={tooltipY - 16} width="160" height="22" rx="4" />
                      <text data-trend-tooltip x={tooltipX} y={tooltipY} textAnchor="middle">{trendTooltip.date} · {formatCurrency(trendTooltip.amount)}</text>
                    </g>
                  )
                })()}
              </svg>
            </figure>
          </AsyncPanel>
        <section className="panel analytics-panel" aria-labelledby="analytics-category-title"><div className="panel-head"><div><h2 id="analytics-category-title">分类构成</h2><p>选择分类查看对应交易</p></div></div><div className="analytics-category-list" aria-label="分类构成">{normalizedBreakdown.map(item => { const category = state.categories.find(candidate => candidate.id === item.categoryId); const label = `${category?.name ?? item.categoryId}支出构成`; return <button key={item.categoryId} type="button" data-category-share={item.categoryId} onClick={() => openDetail({ categoryId: item.categoryId }, label)} onKeyDown={event => activate(event, () => openDetail({ categoryId: item.categoryId }, label))}><span>{category?.name ?? item.categoryId}</span><strong>{formatCurrency(item.amount)}</strong><small>{Math.round(item.ratio * 100)}%</small></button> })}</div></section>
        <section className="panel analytics-panel" aria-labelledby="analytics-comparison-title"><div className="panel-head"><div><h2 id="analytics-comparison-title">分类对比</h2><p>与上一相同长度周期相比</p></div></div><div className="analytics-comparison-list" aria-label="分类环比">{comparisons.map(item => { const category = state.categories.find(candidate => candidate.id === item.categoryId); const label = `${category?.name ?? item.categoryId}支出对比`; const evidence = item.current === 0 && item.previous > 0 ? previousRange : context; return <button key={item.categoryId} type="button" data-category-comparison={item.categoryId} onClick={() => openDetail({ categoryId: item.categoryId, dateFrom: evidence.startDate, dateTo: evidence.endDate }, label)} onKeyDown={event => activate(event, () => openDetail({ categoryId: item.categoryId, dateFrom: evidence.startDate, dateTo: evidence.endDate }, label))}><span>{category?.name ?? item.categoryId}</span><strong>{formatCurrency(item.current)}</strong><small>{comparisonLabel(item.changePercent)}</small></button> })}</div></section>
        <section className="insight-list analytics-insight-list" aria-label="消费洞察">{displayInsights.length ? displayInsights.map(insight => <button key={insight.id} type="button" className={`insight-card ${insight.tone}`} data-insight={insight.id} onClick={() => openDetail(insight.filter, insight.title)} onKeyDown={event => activate(event, () => openDetail(insight.filter, insight.title))}><strong>{insight.title}</strong><span>{insight.detail}</span></button>) : <p className="analytics-insight-empty" role="status">当前范围暂无可验证洞察</p>}</section>
      </div>}
    </section>
  )
}
