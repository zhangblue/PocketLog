import { useId, type ReactNode } from 'react'

export type AsyncPanelStatus = 'loading' | 'ready' | 'error'

type AsyncPanelBaseProps = {
  title: string
  children: ReactNode
  className?: string
  headingLevel?: 2 | 3
}

export type AsyncPanelProps = AsyncPanelBaseProps & (
  | { status: 'loading' | 'ready'; onRetry?: never }
  | { status: 'error'; onRetry: () => void }
)

export function AsyncPanel({ title, status, children, onRetry, className, headingLevel = 3 }: AsyncPanelProps) {
  const headingId = useId()
  const Heading = headingLevel === 2 ? 'h2' : 'h3'

  return (
    <section className={['async-panel', className].filter(Boolean).join(' ')} aria-busy={status === 'loading'} aria-labelledby={headingId}>
      <Heading id={headingId}>{title}</Heading>
      {status === 'loading' && <div className="panel-skeleton" aria-label={`${title}加载中`} />}
      {status === 'error' && <div className="panel-error" role="alert">此区域暂时无法加载。<button type="button" onClick={onRetry}>重试</button></div>}
      {status === 'ready' && children}
    </section>
  )
}
