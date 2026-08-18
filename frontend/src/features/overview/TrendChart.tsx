import { useId } from 'react'

export interface TrendPoint {
  x: number
  y: number
}

export function TrendChart({ points, summary }: { points: TrendPoint[]; summary: string }) {
  const titleId = useId()
  const descriptionId = useId()
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')

  return (
    <figure className="trend-figure">
      <svg role="img" aria-labelledby={`${titleId} ${descriptionId}`} viewBox="0 0 600 220">
        <title id={titleId}>支出趋势</title>
        <desc id={descriptionId}>{summary}</desc>
        <path className="trend-grid" d="M 0 55 H 600 M 0 110 H 600 M 0 165 H 600" />
        <path d={path} className="trend-line" />
      </svg>
      <figcaption>{summary}</figcaption>
    </figure>
  )
}
