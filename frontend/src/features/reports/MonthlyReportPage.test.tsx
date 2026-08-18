import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { App } from '../../app/App'
import { FinanceProvider } from '../../app/FinanceProvider'
import { sampleTransactions } from '../../domain/sampleData'
import { changeSelect, click, render } from '../../test/render'
import { MonthlyReportPage } from './MonthlyReportPage'

describe('MonthlyReportPage', () => {
  it('展示报告并调用浏览器打印', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    const { container } = await render(<FinanceProvider><MonthlyReportPage /></FinanceProvider>)

    expect(container.textContent).toContain('这个月，你更会花钱了')
    expect(container.textContent).toContain('财务状态评分')
    expect(container.textContent).toContain('较上期提高 5 分（77 → 82）')
    expect(container.textContent).toContain('↓')
    await click(container.querySelector<HTMLButtonElement>('[data-export-pdf]')!)
    expect(print).toHaveBeenCalledOnce()
    print.mockRestore()
  })

  it('空月报不编造亮点或消费故事', async () => {
    const repository = { load: () => [], save: () => ({ ok: true } as const) }
    const { container } = await render(<App initialView="reports" repository={repository} />)

    expect(container.textContent).toContain('本月还没有可回顾的收支记录')
    expect(container.textContent).toContain('记下第一笔收支后，这里会生成月度回顾。')
    expect(container.textContent).not.toContain('省得最多')
  })

  it('从真实 App 导航到报告后，切换月份会立即刷新报告数据', async () => {
    const { container } = await render(<App repository={{ load: () => sampleTransactions, save: () => ({ ok: true } as const) }} />)

    await click(container.querySelector<HTMLButtonElement>('[aria-label="月度报告"]')!)
    expect(container.textContent).toContain('2026 年 8 月月度报告')
    expect(container.textContent).toContain('这个月，你更会花钱了')

    await changeSelect(container.querySelector<HTMLSelectElement>('select[aria-label="月份"]')!, '2026-07')
    expect(container.textContent).toContain('2026 年 7 月月度报告')
    expect(container.textContent).toContain('这个月的消费值得回顾')
  })

  it('报告内容拥有可识别的打印容器和操作类名', async () => {
    const { container } = await render(<FinanceProvider><MonthlyReportPage /></FinanceProvider>)

    expect(container.querySelector('.monthly-report')).toBeTruthy()
    expect(container.querySelector('.report-print-actions [data-export-pdf]')).toBeTruthy()
  })

  it('缺少或抛出打印 API 时显示可访问反馈，成功后清除反馈', async () => {
    const { container } = await render(<FinanceProvider><MonthlyReportPage /></FinanceProvider>)
    const print = vi.spyOn(window, 'print').mockImplementation(() => { throw new Error('blocked') })
    const button = container.querySelector<HTMLButtonElement>('[data-export-pdf]')!

    await click(button)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('暂时无法打开打印窗口')

    let errorPresentWhenPrintStarts = false
    print.mockImplementation(() => {
      errorPresentWhenPrintStarts = container.querySelector('.report-print-error') !== null
    })
    await click(button)
    expect(errorPresentWhenPrintStarts).toBe(true)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    print.mockRestore()

    vi.stubGlobal('print', undefined)
    await click(button)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('暂时无法打开打印窗口')
    vi.unstubAllGlobals()
  })

  it('打印媒体规则保留 A4 报告并隐藏应用框架和操作', () => {
    const globalStyles = readFileSync(resolve(process.cwd(), 'src/styles/global.css'), 'utf8')

    expect(globalStyles).toContain('@media print')
    expect(globalStyles).toContain('size: A4;')
    expect(globalStyles).toContain('margin: 16mm;')
    expect(globalStyles).toMatch(/body \*\s*\{\s*visibility: hidden;/)
    expect(globalStyles).toMatch(/\.app-sidebar,\s*\.topbar,\s*\.report-print-actions\s*\{\s*display: none !important;/)
    expect(globalStyles).toMatch(/\.monthly-report,\s*\.monthly-report \*\s*\{\s*visibility: visible;/)
    expect(globalStyles).toMatch(/@media print[\s\S]*\.report-print-error\s*\{\s*display: none !important;/)
  })
})
