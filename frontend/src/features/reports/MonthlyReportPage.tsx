import { useState } from 'react'
import { useFinance } from '../../app/FinanceProvider'
import { formatCurrency } from '../../domain/selectors'
import type { CategoryComparison } from '../../domain/selectors'

function reportTitle(month: string) {
  const [year, rawMonth] = month.split('-')
  return `${year} 年 ${Number(rawMonth)} 月月度报告`
}

function comparisonDirection(changePercent: number) {
  return changePercent < 0 ? `↓ 减少 ${Math.abs(changePercent)}%` : `↑ 增长 ${changePercent}%`
}

function ReportHighlight({ title, comparison, categoryName }: { title: string; comparison: CategoryComparison | null; categoryName: (categoryId: string) => string }) {
  if (!comparison) {
    return <article className="report-highlight report-highlight-empty"><h2>{title}</h2><p>积累更多记录后可查看环比。</p></article>
  }

  return (
    <article className="report-highlight">
      <h2>{title}</h2>
      <strong>{categoryName(comparison.categoryId)}</strong>
      <p>{comparisonDirection(comparison.changePercent!)} · {formatCurrency(comparison.previous)} → {formatCurrency(comparison.current)}</p>
    </article>
  )
}

export function MonthlyReportPage() {
  const { state, actions } = useFinance()
  const [printError, setPrintError] = useState('')
  const serverReport = state.report.value?.data
  const report = serverReport ? {
    headline: serverReport.headline ?? `${state.month} 月度消费回顾`,
    score: serverReport.score ?? 0,
    status: serverReport.rating ?? '暂无评级',
    scoreChangeNarrative: serverReport.scoreChangeNarrative ?? (serverReport.scoreChange == null ? '暂无上期可比' : `较上期${serverReport.scoreChange >= 0 ? '提高' : '降低'} ${Math.abs(serverReport.scoreChange)} 分`),
    biggestSaving: serverReport.biggestSaving ? { categoryId: serverReport.biggestSaving.categoryId, current: Number(serverReport.biggestSaving.amount), previous: 0, changePercent: Number(serverReport.biggestSaving.changeRate) } : null,
    biggestGrowth: serverReport.biggestGrowth ? { categoryId: serverReport.biggestGrowth.categoryId, current: Number(serverReport.biggestGrowth.amount), previous: 0, changePercent: Number(serverReport.biggestGrowth.changeRate) } : null,
    story: serverReport.story,
  } : { headline: `${state.month} 月度消费回顾`, score: 0, status: '暂无评级', scoreChangeNarrative: '暂无上期可比', biggestSaving: null, biggestGrowth: null, story: '记下第一笔收支后，这里会生成月度回顾。' }
  const summary = state.overview.value?.data.summary
    ? { expense: Number(state.overview.value.data.summary.expense), income: Number(state.overview.value.data.summary.income), savingsRate: Number(state.overview.value.data.summary.savingsRate ?? 0) }
    : { expense: 0, income: 0, savingsRate: 0 }
  const isEmpty = summary.expense === 0 && summary.income === 0
  const categoryName = (categoryId: string) => state.categories.find(category => category.id === categoryId)?.name ?? categoryId

  function exportPdf() {
    const print = window.print
    if (typeof print !== 'function') {
      setPrintError('暂时无法打开打印窗口，请检查浏览器的打印权限后重试。')
      return
    }

    try {
      print.call(window)
      setPrintError('')
    } catch {
      setPrintError('暂时无法打开打印窗口，请检查浏览器的打印权限后重试。')
    }
  }

  return (
    <section className="monthly-report" aria-labelledby="monthly-report-title">
      <header className="report-heading">
        <p className="eyebrow">月度回顾 · {state.month}</p>
        <h1 id="monthly-report-title">{reportTitle(state.month)}</h1>
        <p>{report.headline}</p>
      </header>
      {state.report.status === 'loading' && <p className="panel-loading" role="status">月报加载中…</p>}
      {state.report.status === 'error' && <p className="panel-error" role="alert">月报暂时无法加载。<button type="button" onClick={() => actions.retryDataLoad('report')}>重试</button></p>}
      {state.report.stale && state.report.status !== 'ready' && <p className="panel-stale" role="status">当前显示最近一次成功的月报。</p>}
      <div className="report-print-actions">
        <button type="button" data-export-pdf onClick={exportPdf}>导出 PDF</button>
      </div>
      {printError && <p className="report-print-error" role="alert">{printError}</p>}
      {isEmpty ? (
        <p className="report-empty" role="status">{report.headline}。记下第一笔收支后，这里会生成月度回顾。</p>
      ) : (
        <>
          <section className="report-score" aria-label="财务状态评分">
            <p>财务状态评分</p>
            <strong>{report.score}</strong>
            <span>{report.status}</span>
            <small>基于本月结余率 {summary.savingsRate}% 计算</small>
            <small className="report-score-change">{report.scoreChangeNarrative}</small>
          </section>
          <section className="report-highlights" aria-label="月度亮点">
            <ReportHighlight title="省得最多" comparison={report.biggestSaving} categoryName={categoryName} />
            <ReportHighlight title="增长最多" comparison={report.biggestGrowth} categoryName={categoryName} />
          </section>
          <section className="report-story" aria-labelledby="report-story-title">
            <h2 id="report-story-title">这个月的消费故事</h2>
            <p>{report.story}</p>
          </section>
        </>
      )}
    </section>
  )
}
