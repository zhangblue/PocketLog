import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { createTransactionRepository } from '../data/transactionRepository'
import type { AccountLabel, Category, Transaction } from '../domain/types'
import { changeInput, changeSelect, click, keyDown, render } from '../test/render'
import { App } from './App'
import { createTransactionFromDraft } from '../layout/AppShell'
import { isValidOccurredAt } from '../domain/selectors'

const customCategories: Category[] = [
  { id: 'custom-expense', name: '自定义支出', emoji: '◎', color: '#000', kind: 'expense', active: true },
  { id: 'disabled-expense', name: '停用支出', emoji: '◎', color: '#000', kind: 'expense', active: false },
]

const customAccounts: AccountLabel[] = [
  { id: 'custom-account', name: '自定义账户', active: true },
  { id: 'disabled-account', name: '停用账户', active: false },
]

describe('App', () => {
  it('AppShell 边界拒绝不合法日期，避免拼接非法 occurredAt', () => {
    expect(createTransactionFromDraft({
      kind: 'expense',
      amount: '68',
      categoryId: 'food',
      accountId: 'wechat',
      targetAccountId: '',
      occurredAt: '2026-02-30',
      occurredTime: '12:00',
      merchant: '测试商家',
      note: '',
    }, 'tx-test')).toBeUndefined()
  })

  it('把用户输入的本地日期时间转换为带本地 offset 的合法 ISO', () => {
    const transaction = createTransactionFromDraft({
      kind: 'expense', amount: '68', categoryId: 'food', accountId: 'wechat', targetAccountId: '',
      occurredAt: '2031-02-03', occurredTime: '04:05', merchant: '测试商家', note: '',
    }, 'tx-local-time')

    expect(transaction?.occurredAt).toMatch(/^2031-02-03T04:05:00[+-]\d{2}:\d{2}$/)
    expect(isValidOccurredAt(transaction?.occurredAt ?? '')).toBe(true)
  })

  it('从真实 Provider 状态向快捷记账传递启用分类和账户', async () => {
    const { container } = await render(<App categories={customCategories} accounts={customAccounts} />)
    const add = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('记一笔'))!

    await click(add)

    expect([...container.querySelectorAll<HTMLSelectElement>('[name="categoryId"] option')].map(option => option.value)).toEqual(['custom-expense'])
    expect([...container.querySelectorAll<HTMLSelectElement>('[name="accountId"] option')].map(option => option.value)).toEqual(['custom-account'])
  })

  it('展示产品名、总览标题和四项月度指标', async () => {
    const { container } = await render(<App />)
    expect(container.textContent).toContain('栖账')
    expect(container.textContent).toContain('财务总览')
    expect(container.querySelectorAll('section[aria-label="月度汇总"] article')).toHaveLength(4)
  })

  it('收支明细视图渲染可筛选且可删除的真实交易页', async () => {
    const { container } = await render(<App initialView="transactions" />)

    expect(container.querySelector('[aria-label="交易筛选"]')).toBeTruthy()
    expect(container.querySelector('[data-delete-transaction="tx-0818-coffee"]')).toBeTruthy()
  })

  it('分类管理视图渲染可管理的分类设置页', async () => {
    const { container } = await render(<App initialView="labels" />)

    expect(container.querySelector('[data-category="food"]')).toBeTruthy()
    expect(container.textContent).toContain('账户标签')
  })

  it('明细页切换月份时同步顶部月份状态', async () => {
    const { container } = await render(<App initialView="transactions" />)

    await changeSelect(container.querySelector<HTMLSelectElement>('select[name="month"]')!, '2026-07')

    expect(container.querySelector<HTMLSelectElement>('select[aria-label="月份"]')?.value).toBe('2026-07')
  })

  it('顶部月份选项不从 offset 分钟越界的时间戳派生伪月份', async () => {
    const transactions: Transaction[] = [
      { id: 'invalid-offset', kind: 'expense', amount: 10, categoryId: 'food', accountId: 'wechat', merchant: '损坏偏移', occurredAt: '2025-05-01T12:00:00+05:99', note: '' },
      { id: 'valid', kind: 'expense', amount: 10, categoryId: 'food', accountId: 'wechat', merchant: '有效交易', occurredAt: '2026-08-01T12:00:00+08:00', note: '' },
    ]
    const repository = { load: () => transactions, save: () => ({ ok: true } as const) }
    const { container } = await render(<App repository={repository} />)

    expect([...container.querySelectorAll<HTMLSelectElement>('select[aria-label="月份"] option')].map(option => option.value)).not.toContain('2025-05')
  })

  it('离开明细页后也在五秒撤销截止时间到期时清除恢复入口', async () => {
    vi.useFakeTimers()
    const { container } = await render(<App initialView="transactions" />)

    await click(container.querySelector<HTMLButtonElement>('[data-delete-transaction="tx-0818-coffee"]')!)
    await click(container.querySelector<HTMLButtonElement>('[aria-label="总览"]')!)
    await act(async () => vi.advanceTimersByTime(5000))
    await click(container.querySelector<HTMLButtonElement>('[aria-label="收支明细"]')!)

    expect(container.textContent).not.toContain('已删除“山丘咖啡”')
    expect(container.querySelector('[data-undo]')).toBeNull()
  })

  it('删除后打开快捷记账时，到期不把焦点移出模态对话框', async () => {
    vi.useFakeTimers()
    const { container } = await render(<App initialView="transactions" />)

    await click(container.querySelector<HTMLButtonElement>('[data-delete-transaction="tx-0818-coffee"]')!)
    await click([...container.querySelectorAll('button')].find(button => button.textContent?.includes('记一笔'))!)
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog.contains(document.activeElement)).toBe(true)

    await act(async () => vi.advanceTimersByTime(5000))

    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('删除后用户主动聚焦筛选控件时，到期不抢走焦点', async () => {
    vi.useFakeTimers()
    const { container } = await render(<App initialView="transactions" />)

    await click(container.querySelector<HTMLButtonElement>('[data-delete-transaction="tx-0818-coffee"]')!)
    const kindFilter = container.querySelector<HTMLSelectElement>('[name="kind"]')!
    kindFilter.focus()

    await act(async () => vi.advanceTimersByTime(5000))

    expect(document.activeElement).toBe(kindFilter)
  })

  it('记一笔按钮以按钮语义打开新增交易入口', async () => {
    const { container } = await render(<App />)
    const add = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('记一笔'))
    expect(add).toBeTruthy()

    await click(add!)

    expect(container.textContent).toContain('新增交易')
  })

  it('保存支出后由真实 Provider 更新明细并关闭抽屉', async () => {
    const { container } = await render(<App />)
    const add = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('记一笔'))!

    await click(add)

    const amount = container.querySelector<HTMLInputElement>('input[name="amount"]')
    expect(amount).toBeTruthy()
    if (!amount) return

    await changeInput(amount, '68')
    await changeSelect(container.querySelector<HTMLSelectElement>('select[name="categoryId"]')!, 'food')
    await changeSelect(container.querySelector<HTMLSelectElement>('select[name="accountId"]')!, 'wechat')
    await click(container.querySelector<HTMLButtonElement>('[data-save]')!)

    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(container.textContent).toContain('¥68.00')
    expect(container.textContent).toContain('餐饮')
    expect(container.querySelector('[role="status"]')?.textContent).toContain('交易已保存')
  })

  it('真实 App 遇到语义损坏快照时局部报错，修复存储后可重试', async () => {
    localStorage.setItem('qizhang.transactions.v1', JSON.stringify([{
      id: 'bad-reference', kind: 'expense', amount: 10, categoryId: 'missing', accountId: 'wechat', merchant: '损坏引用', occurredAt: '2026-08-18T12:00:00+08:00', note: '',
    }]))
    const { container } = await render(<App />)

    expect(container.querySelector('.trend-panel [role="alert"]')?.textContent).toContain('此区域暂时无法加载')
    expect(container.textContent).not.toContain('损坏引用')

    localStorage.setItem('qizhang.transactions.v1', JSON.stringify([]))
    await click(container.querySelector<HTMLButtonElement>('.trend-panel [role="alert"] button')!)
    expect(container.querySelector('.trend-panel [role="alert"]')).toBeNull()
  })

  it('新增支出后首页汇总和最近明细同步更新，且最近列表仍限制为 5 条', async () => {
    const { container } = await render(<App />)

    await click(container.querySelector<HTMLButtonElement>('.add-transaction')!)
    await changeInput(container.querySelector<HTMLInputElement>('input[name="amount"]')!, '68')
    await changeInput(container.querySelector<HTMLInputElement>('input[name="merchant"]')!, '晚餐')
    await click(container.querySelector<HTMLButtonElement>('[data-save]')!)

    expect(container.textContent).toContain('¥6,910')
    expect(container.textContent).toContain('晚餐')
    expect(container.querySelectorAll('[data-transaction-row]')).toHaveLength(5)
    expect(container.textContent).toContain('已记录 12 笔交易')
  })

  it('跨页面分析下钻、删除撤销、报告和标签入口保持同一真实应用状态', async () => {
    const { container } = await render(<App />)

    await click(container.querySelector<HTMLButtonElement>('[aria-label="消费分析"]')!)
    await click(container.querySelector<HTMLButtonElement>('[data-insight="transport-weekend"]')!)
    expect(container.textContent).toContain('来自洞察：周末交通支出偏高')

    await click(container.querySelector<HTMLButtonElement>('[data-delete-transaction="tx-0802-travel"]')!)
    expect([...container.querySelectorAll('[data-transaction-row]')].some(row => row.textContent?.includes('本月交通'))).toBe(false)
    await click(container.querySelector<HTMLButtonElement>('[data-undo]')!)
    expect([...container.querySelectorAll('[data-transaction-row]')].some(row => row.textContent?.includes('本月交通'))).toBe(true)

    await click(container.querySelector<HTMLButtonElement>('[aria-label="月度报告"]')!)
    expect(container.textContent).toContain('2026 年 8 月月度报告')
    await click(container.querySelector<HTMLButtonElement>('[aria-label="分类管理"]')!)
    expect(container.querySelector('[data-category="food"]')).toBeTruthy()
  })

  it('首页结余率洞察下钻同时展示收入与支出证据，并排除转账', async () => {
    const transactions: Transaction[] = [
      { id: 'expense-evidence', kind: 'expense', amount: 50, categoryId: 'food', accountId: 'wechat', merchant: '支出证据', occurredAt: '2026-08-08T12:00:00+08:00', note: '' },
      { id: 'income-evidence', kind: 'income', amount: 100, categoryId: 'salary', accountId: 'bank', merchant: '收入证据', occurredAt: '2026-08-09T12:00:00+08:00', note: '' },
      { id: 'transfer-excluded', kind: 'transfer', amount: 20, categoryId: 'transfer', accountId: 'wechat', targetAccountId: 'bank', merchant: '不应显示的转账', occurredAt: '2026-08-10T12:00:00+08:00', note: '' },
    ]
    const { container } = await render(<App repository={{ load: () => transactions, save: () => ({ ok: true } as const) }} />)
    await click([...container.querySelectorAll<HTMLButtonElement>('.insight-card')].find(button => button.textContent?.includes('结余率'))!)

    expect(container.querySelector<HTMLSelectElement>('select[name="kind"]')?.value).toBe('income-expense')
    expect(container.textContent).toContain('收入证据')
    expect(container.textContent).toContain('支出证据')
    expect(container.textContent).not.toContain('不应显示的转账')
    expect(container.textContent).toContain('收支（不含转账）')
  })

  it('保存收入后由真实 Provider 更新月度收入并关闭抽屉', async () => {
    const { container } = await render(<App />)
    const add = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('记一笔'))!

    await click(add)
    await click(container.querySelector<HTMLButtonElement>('[data-kind="income"]')!)
    await changeInput(container.querySelector<HTMLInputElement>('[name="amount"]')!, '280')
    await click(container.querySelector<HTMLButtonElement>('[data-save]')!)

    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(container.textContent).toContain('¥12,780')
  })

  it('保存并继续通过真实 Provider 持久化交易但保持抽屉打开', async () => {
    const { container } = await render(<App />)
    const add = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('记一笔'))!

    await click(add)
    await changeInput(container.querySelector<HTMLInputElement>('[name="amount"]')!, '68')
    await changeInput(container.querySelector<HTMLInputElement>('[name="occurredAt"]')!, '2026-08-17')
    await changeInput(container.querySelector<HTMLInputElement>('[name="merchant"]')!, '继续记录')
    await changeInput(container.querySelector<HTMLTextAreaElement>('[name="note"]')!, '首笔')
    await click(container.querySelector<HTMLButtonElement>('[data-save-continue]')!)

    const persisted = JSON.parse(localStorage.getItem('qizhang.transactions.v1') ?? '[]')
    expect(persisted[0]).toMatchObject({ amount: 68, merchant: '继续记录' })
    expect(container.querySelector('[role="dialog"]')).toBeTruthy()
    expect(container.querySelector<HTMLInputElement>('[name="amount"]')?.value).toBe('')
    expect(container.querySelector<HTMLTextAreaElement>('[name="note"]')?.value).toBe('')
    expect(container.querySelector<HTMLButtonElement>('[data-kind="expense"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector<HTMLInputElement>('[name="occurredAt"]')?.value).toBe('2026-08-17')
  })

  it('保存转账后保留目标账户且不改变收支汇总', async () => {
    const { container } = await render(<App />)
    const add = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('记一笔'))!
    const beforeExpense = container.querySelector('.metric-card.primary strong')?.textContent
    const beforeIncome = container.querySelectorAll('.metric-card strong')[1]?.textContent

    await click(add)
    await click(container.querySelector<HTMLButtonElement>('[data-kind="transfer"]')!)
    await changeInput(container.querySelector<HTMLInputElement>('[name="amount"]')!, '500')
    await changeSelect(container.querySelector<HTMLSelectElement>('[name="targetAccountId"]')!, 'alipay')
    await click(container.querySelector<HTMLButtonElement>('[data-save]')!)

    const persisted = JSON.parse(localStorage.getItem('qizhang.transactions.v1') ?? '[]')
    expect(persisted[0]).toMatchObject({ kind: 'transfer', accountId: 'wechat', targetAccountId: 'alipay', amount: 500 })
    expect(container.querySelector('.metric-card.primary strong')?.textContent).toBe(beforeExpense)
    expect(container.querySelectorAll('.metric-card strong')[1]?.textContent).toBe(beforeIncome)
  })

  it('普通保存与 Escape 关闭后都将焦点还给记一笔按钮', async () => {
    const { container } = await render(<App />)
    const add = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('记一笔'))!

    await click(add)
    await changeInput(container.querySelector<HTMLInputElement>('[name="amount"]')!, '68')
    await click(container.querySelector<HTMLButtonElement>('[data-save]')!)
    expect(document.activeElement).toBe(add)

    await click(add)
    await keyDown(container.querySelector<HTMLElement>('[role="dialog"]')!, 'Escape')
    expect(document.activeElement).toBe(add)
  })

  it('关闭抽屉后将焦点还给记一笔按钮', async () => {
    const { container } = await render(<App />)
    const add = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('记一笔'))!

    await click(add)
    await click([...container.querySelectorAll('button')].find(button => button.textContent === '取消')!)

    expect(document.activeElement).toBe(add)
  })

  it('Storage 保存失败时由真实 Provider 保留全部录入字段和错误', async () => {
    const storage: Storage = {
      ...localStorage,
      setItem: () => {
        throw new Error('quota exceeded')
      },
    }
    const { container } = await render(<App repository={createTransactionRepository(storage)} />)
    const add = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('记一笔'))!
    const beforeExpense = container.querySelector('.metric-card.primary strong')?.textContent
    const beforeRows = container.querySelectorAll('[data-transaction-row]').length

    await click(add)
    await changeInput(container.querySelector<HTMLInputElement>('[name="amount"]')!, '68')
    await changeSelect(container.querySelector<HTMLSelectElement>('[name="categoryId"]')!, 'shopping')
    await changeSelect(container.querySelector<HTMLSelectElement>('[name="accountId"]')!, 'bank')
    await changeInput(container.querySelector<HTMLInputElement>('[name="occurredAt"]')!, '2026-08-17')
    await changeInput(container.querySelector<HTMLInputElement>('[name="merchant"]')!, '测试商家')
    await changeInput(container.querySelector<HTMLTextAreaElement>('[name="note"]')!, '失败后保留')
    await click(container.querySelector<HTMLButtonElement>('[data-save]')!)

    expect(container.querySelector('[role="dialog"]')).toBeTruthy()
    expect(container.querySelector<HTMLInputElement>('[name="amount"]')?.value).toBe('68')
    expect(container.querySelector<HTMLSelectElement>('[name="categoryId"]')?.value).toBe('shopping')
    expect(container.querySelector<HTMLSelectElement>('[name="accountId"]')?.value).toBe('bank')
    expect(container.querySelector<HTMLInputElement>('[name="occurredAt"]')?.value).toBe('2026-08-17')
    expect(container.querySelector<HTMLInputElement>('[name="merchant"]')?.value).toBe('测试商家')
    expect(container.querySelector<HTMLTextAreaElement>('[name="note"]')?.value).toBe('失败后保留')
    expect(container.textContent).toContain('保存失败，输入内容已保留。')
    expect(container.querySelector('.metric-card.primary strong')?.textContent).toBe(beforeExpense)
    expect(container.querySelectorAll('[data-transaction-row]')).toHaveLength(beforeRows)
    expect(container.textContent).not.toContain('测试商家')
  })
})
