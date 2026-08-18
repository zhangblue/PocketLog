import { describe, expect, it, vi } from 'vitest'
import { click, render } from '../test/render'
import { AsyncPanel, type AsyncPanelProps } from './AsyncPanel'
import { EmptyState, type EmptyStateProps } from './EmptyState'

// @ts-expect-error error 状态必须提供恢复动作
const invalidErrorPanel: AsyncPanelProps = { title: '支出趋势', status: 'error', children: '图表' }
// @ts-expect-error 每种空态必须提供唯一主操作
const invalidEmptyState: EmptyStateProps = { variant: 'no-results' }
void invalidErrorPanel
void invalidEmptyState

describe('AsyncPanel', () => {
  it('局部错误保留标题并提供重试', async () => {
    const retry = vi.fn()
    const { container } = await render(<AsyncPanel title="支出趋势" status="error" onRetry={retry}>图表</AsyncPanel>)

    expect(container.textContent).toContain('支出趋势')
    expect(container.textContent).toContain('此区域暂时无法加载')
    await click(container.querySelector<HTMLButtonElement>('button')!)
    expect(retry).toHaveBeenCalledOnce()
  })

  it('为相同标题生成彼此不同的关联标题 ID，并只在就绪时显示内容', async () => {
    const { container } = await render(<><AsyncPanel title="支出趋势" status="loading">甲</AsyncPanel><AsyncPanel title="支出趋势" status="ready">乙</AsyncPanel></>)
    const panels = container.querySelectorAll('section')

    expect(panels[0].getAttribute('aria-busy')).toBe('true')
    expect(panels[0].getAttribute('aria-labelledby')).not.toBe(panels[1].getAttribute('aria-labelledby'))
    expect(container.textContent).not.toContain('甲')
    expect(container.textContent).toContain('乙')
  })
})

describe('EmptyState', () => {
  it('首次使用说明收益且只提供一个主操作', async () => {
    const action = vi.fn()
    const { container } = await render(<EmptyState variant="first-use" onAction={action} />)

    expect(container.textContent).toContain('记下第一笔交易')
    expect(container.querySelectorAll('button')).toHaveLength(1)
    await click(container.querySelector<HTMLButtonElement>('button')!)
    expect(action).toHaveBeenCalledOnce()
  })

  it('筛选无结果和历史不足提供各自语义与操作', async () => {
    const clear = vi.fn()
    const { container } = await render(<><EmptyState variant="no-results" detail="2026 年 8 月 · 分类：工资" onAction={clear} /><EmptyState variant="insufficient-history" onAction={() => undefined} /></>)

    expect(container.textContent).toContain('2026 年 8 月 · 分类：工资')
    expect(container.textContent).toContain('清除筛选')
    expect(container.textContent).toContain('积累更多记录后可查看对比')
    await click(container.querySelector<HTMLButtonElement>('button')!)
    expect(clear).toHaveBeenCalledOnce()
  })
})
