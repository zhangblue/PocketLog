import { useId, useState } from 'react'
import { formatCurrency } from '../../domain/selectors'

export interface TrendPoint {
  date: string
  amount: number
}

const chart = { width: 600, height: 220, left: 58, right: 12, top: 18, bottom: 34 }

function scaleMaximum(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(amount))
  return Math.ceil(amount / magnitude) * magnitude
}

export function TrendChart({ points, summary }: { points: TrendPoint[]; summary: string }) {
  const titleId = useId()
  const descriptionId = useId()
  const [activeDate, setActiveDate] = useState<string | null>(null)
  const plotWidth = chart.width - chart.left - chart.right
  const plotHeight = chart.height - chart.top - chart.bottom
  // 纵轴上限向上取整，保证金额变化有足够的可读空间。
  const maximum = scaleMaximum(Math.max(...points.map(point => point.amount), 0))
  const yTicks = Array.from({ length: 4 }, (_, index) => maximum * (3 - index) / 3)
  // 横轴只减少文字标签，数据点仍按完整数组等距绘制。
  const axisIndexes = points.length <= 6 ? points.map((_, index) => index) : Array.from({ length: 6 }, (_, slot) => Math.round(slot * (points.length - 1) / 5))
  const coordinates = points.map((point, index) => ({ ...point, x: chart.left + (points.length <= 1 ? plotWidth / 2 : index * plotWidth / (points.length - 1)), y: chart.top + plotHeight - (point.amount / maximum) * plotHeight }))
  const activePoint = coordinates.find(point => point.date === activeDate)
  return (
    <figure className="trend-figure">
      <svg role="img" aria-labelledby={`${titleId} ${descriptionId}`} viewBox={`0 0 ${chart.width} ${chart.height}`}>
        <title id={titleId}>支出趋势</title>
        <desc id={descriptionId}>{summary}</desc>
        {yTicks.map((tick, index) => { const y = chart.top + index * plotHeight / 3; return <g key={tick}><line className="trend-grid" x1={chart.left} x2={chart.width - chart.right} y1={y} y2={y} /><text data-overview-trend-y-axis-label x={chart.left - 8} y={y + 4} textAnchor="end">{formatCurrency(tick)}</text></g> })}
        <polyline points={coordinates.map(point => `${point.x},${point.y}`).join(' ')} className="trend-line" />
        {axisIndexes.map(index => { const point = coordinates[index]; return <text key={point.date} data-overview-trend-axis-label x={point.x} y={chart.height - 8} textAnchor="middle">{point.date.slice(5, 10)}</text> })}
        {coordinates.map(point => <circle key={point.date} data-overview-trend-point={point.date} role="button" tabIndex={0} aria-label={`${point.date} 支出 ${formatCurrency(point.amount)}`} cx={point.x} cy={point.y} r="5" className="trend-point" onMouseEnter={() => setActiveDate(point.date)} onMouseOver={() => setActiveDate(point.date)} onMouseLeave={() => setActiveDate(null)} onMouseOut={() => setActiveDate(null)} onFocus={() => setActiveDate(point.date)} onBlur={() => setActiveDate(null)} />)}
        {activePoint && <text data-overview-trend-tooltip x={Math.min(activePoint.x, chart.width - 120)} y={Math.max(activePoint.y - 12, 14)}>{activePoint.date} · {formatCurrency(activePoint.amount)}</text>}
      </svg>
    </figure>
  )
}
