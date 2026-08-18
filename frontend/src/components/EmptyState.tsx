export type EmptyStateVariant = 'first-use' | 'no-results' | 'insufficient-history'

const content = {
  'first-use': {
    title: '从第一笔交易开始',
    description: '暂无符合条件的支出数据。记下第一笔交易后，即可查看收支汇总、分类构成和消费洞察。',
    action: '记第一笔',
  },
  'no-results': {
    title: '暂无符合条件的支出数据',
    description: '请调整筛选条件，或清除筛选查看全部交易。',
    action: '清除筛选',
  },
  'insufficient-history': {
    title: '历史数据不足',
    description: '积累更多记录后可查看对比。',
    action: '继续记账',
  },
} satisfies Record<EmptyStateVariant, { title: string; description: string; action: string }>

type EmptyStateBaseProps = {
  detail?: string
}

export type EmptyStateProps = EmptyStateBaseProps & (
  | { variant: 'first-use'; onAction: () => void }
  | { variant: 'no-results'; onAction: () => void }
  | { variant: 'insufficient-history'; onAction: () => void }
)

export function EmptyState({ variant, detail, onAction }: EmptyStateProps) {
  const state = content[variant]

  return (
    <section className={`empty-state empty-state-${variant}`} role="status">
      <h2>{state.title}</h2>
      {detail && <p className="empty-state-detail">{detail}</p>}
      <p>{state.description}</p>
      <button type="button" onClick={onAction}>{state.action}</button>
    </section>
  )
}
