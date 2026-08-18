import { useState } from 'react'
import { useFinance } from '../../app/FinanceProvider'
import { buildMonthlyReport, formatCurrency, selectMonthlySummary, type CategoryComparison } from '../../domain/selectors'

function previousMonth(month: string) {
  const [year, rawMonth] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, rawMonth - 2, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

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
  const { state } = useFinance()
  const [printError, setPrintError] = useState('')
  const previous = previousMonth(state.month)
  const report = buildMonthlyReport(state.transactions, state.month, previous)
  const summary = selectMonthlySummary(state.transactions, state.month)
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
      <div className="report-print-actions">
        <button type="button" data-export-pdf onClick={exportPdf}>导出 PDF</button>
      </div>
      {printError && <p className="report-print-error" role="alert">{printError}</p>}
      {isEmpty ? (
        <p className="report-empty" role="status">记下第一笔收支后，这里会生成月度回顾。</p>
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
