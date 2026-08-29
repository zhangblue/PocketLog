import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { FinanceProvider, useFinanceState } from '../../app/FinanceProvider'
import type { Transaction } from '../../domain/types'
import { AppShell } from '../../layout/AppShell'
import { click, render } from '../../test/render'
import { OverviewPage } from './OverviewPage'
import type { FinanceApi } from '../../api/financeApi'
import { createFixtureApi } from '../../test/financeApi'

function OverviewApp() {
  return <FinanceProvider api={createFixtureApi()}><AppShell><OverviewPage /></AppShell><FinanceProbe /></FinanceProvider>
}

function FinanceProbe() {
  const state = useFinanceState()
  return <output aria-label="当前财务状态">{JSON.stringify({ view: state.view, filter: state.filter })}</output>
}

function DateBoundaryApp() {
  const transactions: Transaction[] = [{
    id: 'tx-date-boundary', kind: 'expense', amount: 128.6, categoryId: 'food', accountId: 'wechat', merchant: '日期边界交易', occurredAt: '2026-08-01T23:30:00+08:00', note: '',
  }]
  return <FinanceProvider api={createFixtureApi({ transactions })}><AppShell><OverviewPage /></AppShell></FinanceProvider>
}

describe('OverviewPage', () => {
  it('API 模式展示服务端总览结果而不是本地 selector 结果', async () => {
    const api = {
      bootstrap: vi.fn().mockResolvedValue({ categories: [{ id: 'server-food', name: '服务端分类', kind: 'expense', emoji: '🍜', color: '#4f8a75', semanticKey: 'server-food', sortOrder: 1, active: true }], accounts: [], months: ['2026-08'], dataRevision: 1, serverTime: '2026-08-27T00:00:00Z' }),
      listTransactions: vi.fn().mockResolvedValue({ items: [], nextCursor: null, dataRevision: 1 }),
      overview: vi.fn().mockResolvedValue({ data: { summary: { expense: '999.00', income: '1200.00', transfer: '0.00', balance: '201.00', savingsRate: '16.8', dailyExpense: '32.23', transactionCount: 7 }, trend: [{ date: '2026-08-27', amount: '999.00' }], composition: [{ categoryId: 'server-food', name: '服务端分类', amount: '999.00', includedCategoryIds: ['server-food'] }], categoryChanges: [] }, insights: [], dataRevision: 1 }),
      analytics: vi.fn().mockResolvedValue({ data: { summary: { expense: '0', income: '0', transfer: '0', balance: '0', savingsRate: '0', dailyExpense: '0', transactionCount: 0 }, trend: [], composition: [], categoryChanges: [] }, insights: [], dataRevision: 1 }),
      monthlyReport: vi.fn().mockResolvedValue({ data: { story: 'server report' }, dataRevision: 1 }),
    } as unknown as FinanceApi
    const { container } = await render(<FinanceProvider api={api} initialFilter={{ month: '2026-08' }}><OverviewPage /></FinanceProvider>)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(container.textContent).toContain('¥999')
    expect(container.textContent).toContain('服务端分类')
  })

  it('展示月度汇总、趋势文字摘要和恰好 5 条最近明细', async () => {
    const { container } = await render(<OverviewApp />)

    expect(container.textContent).toContain('¥6,842')
    expect(container.textContent).toContain('¥12,500')
    expect(container.textContent).toContain('¥220.7')
    expect(container.querySelectorAll('[data-transaction-row]')).toHaveLength(5)
    expect(container.textContent).toContain('鲜生活超市')
    expect(container.textContent).toContain('- ¥128.60')
    expect(container.querySelector('svg[role="img"]')?.getAttribute('aria-labelledby')).toBeTruthy()
    expect(container.querySelector('svg title')?.textContent).toBe('支出趋势')
    expect(container.querySelector('svg desc')?.textContent).toContain('第 1 周')
    expect(container.querySelector('figure figcaption')?.textContent).toMatch(/第 1 周/)
    expect(container.querySelector('.trend-panel.async-panel')?.textContent).toContain('支出趋势')
  })

  it('将整数交易金额固定显示为两位小数', async () => {
    const { container } = await render(<OverviewApp />)
    const rows = [...container.querySelectorAll('[data-transaction-row]')]

    expect(rows.find(row => row.textContent?.includes('山丘咖啡'))?.textContent).toContain('- ¥32.00')
    expect(rows.find(row => row.textContent?.includes('八月薪资'))?.textContent).toContain('+ ¥12,500.00')
  })

  it('动态月份用真实上期和月天数生成四项比较，汇总小数不丢值', async () => {
    const transactions: Transaction[] = [
      { id: 'feb-expense', kind: 'expense', amount: 290.25, categoryId: 'food', accountId: 'cash', merchant: '二月支出', occurredAt: '2028-02-10T12:00:00+08:00', note: '' },
      { id: 'feb-income', kind: 'income', amount: 1000, categoryId: 'salary', accountId: 'cash', merchant: '二月收入', occurredAt: '2028-02-11T12:00:00+08:00', note: '' },
      { id: 'jan-expense', kind: 'expense', amount: 310, categoryId: 'food', accountId: 'cash', merchant: '一月支出', occurredAt: '2028-01-10T12:00:00+08:00', note: '' },
      { id: 'jan-income', kind: 'income', amount: 800, categoryId: 'salary', accountId: 'cash', merchant: '一月收入', occurredAt: '2028-01-11T12:00:00+08:00', note: '' },
    ]
    const { container } = await render(<FinanceProvider initialFilter={{ month: '2028-02' }} api={createFixtureApi({ transactions })}><OverviewPage /></FinanceProvider>)
    const cards = [...container.querySelectorAll<HTMLElement>('[aria-label="月度汇总"] article')]

    expect(cards).toHaveLength(4)
    expect(cards[0].textContent).toContain('¥290.25')
    expect(cards.every(card => card.textContent?.includes('较上月'))).toBe(true)
    expect(cards[3].textContent).toContain('按当月 29 天计算')
  })

  it('最近明细把转账显示为中性资金移动而非负支出', async () => {
    const transfer: Transaction = { id: 'transfer', kind: 'transfer', amount: 500, categoryId: 'transfer', accountId: 'wechat', targetAccountId: 'bank', merchant: '资金调拨', occurredAt: '2026-08-20T12:00:00+08:00', note: '' }
    const { container } = await render(<FinanceProvider api={createFixtureApi({ transactions: [transfer] })}><OverviewPage /></FinanceProvider>)
    const amount = container.querySelector<HTMLElement>('[data-transaction-row] strong')!

    expect(amount.textContent).toBe('↔ ¥500.00')
    expect(amount.classList.contains('transfer')).toBe(true)
  })

  it('点击分类图例进入带分类筛选的收支明细', async () => {
    const { container } = await render(<OverviewApp />)

    const category = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('餐饮'))
    expect(category).toBeTruthy()
    await click(category!)

    expect(JSON.parse(container.querySelector('output[aria-label="当前财务状态"]')?.textContent ?? '{}')).toEqual({
      view: 'transactions', filter: { month: '2026-08', categoryId: 'food', sourceLabel: '餐饮' },
    })
  })

  it('点击洞察进入带洞察来源的收支明细', async () => {
    const { container } = await render(<OverviewApp />)

    const insight = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('周末交通支出偏高'))
    expect(insight).toBeTruthy()
    await click(insight!)

    expect(JSON.parse(container.querySelector('output[aria-label="当前财务状态"]')?.textContent ?? '{}')).toEqual({
      view: 'transactions', filter: { month: '2026-08', kind: 'expense', categoryId: 'transport', weekendOnly: true, sourceLabel: '周末交通支出偏高' },
    })
  })

  it('侧栏导航使用可访问语义并切换到临时页面标题', async () => {
    const { container } = await render(<OverviewApp />)

    const nav = container.querySelector('aside[aria-label="主导航"]')
    const navButtons = [...(nav?.querySelectorAll('button') ?? [])]
    expect(navButtons).toHaveLength(5)
    expect(navButtons.every(button => button.querySelector('.nav-symbol[aria-hidden="true"]'))).toBe(true)
    const analytics = navButtons.find(button => button.getAttribute('aria-label') === '消费分析')
    expect(analytics?.getAttribute('aria-current')).toBeNull()
    await click(analytics!)

    expect(container.querySelector('h1')?.textContent).toBe('消费分析')
    expect(analytics?.getAttribute('aria-current')).toBe('page')
  })

  it('月份选择器切换月份并刷新首页汇总', async () => {
    const { container } = await render(<OverviewApp />)

    const month = container.querySelector('select[aria-label="月份"]') as HTMLSelectElement
    await act(async () => {
      month.value = '2026-07'
      month.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(container.querySelector('h1')?.textContent).toBe('7 月财务总览')
    expect(container.textContent).toContain('¥7,469')
  })

  it('将列标题和数据行放在同一个可访问交易表内', async () => {
    const { container } = await render(<OverviewApp />)

    const table = container.querySelector('[role="table"][aria-label="最近交易"]')
    expect(table?.querySelectorAll('[role="columnheader"]')).toHaveLength(4)
    expect(table?.querySelectorAll('[role="row"]')).toHaveLength(6)
    expect(table?.querySelector('[role="columnheader"]')?.textContent).toBe('交易')
  })

  it('保留账单 ISO 日期而不随运行时区变化', async () => {
    const { container } = await render(<DateBoundaryApp />)

    expect(container.querySelector('[data-transaction-row]')?.textContent).toContain('8 月 1 日')
  })

  it('没有交易时显示首次使用引导，而非零值图表和空表格', async () => {
    const { container } = await render(<FinanceProvider api={createFixtureApi({ transactions: [] })}><AppShell><OverviewPage /></AppShell></FinanceProvider>)

    expect(container.textContent).toContain('从第一笔交易开始')
    expect(container.querySelector('[aria-label="月度汇总"]')).toBeNull()
    expect(container.querySelector('svg')).toBeNull()
  })
})
