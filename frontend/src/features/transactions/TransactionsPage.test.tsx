import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { FinanceProvider } from '../../app/FinanceProvider'
import { createTransactionRepository } from '../../data/transactionRepository'
import { changeSelect, click, keyDown, render } from '../../test/render'
import { TransactionsPage } from './TransactionsPage'

describe('TransactionsPage', () => {
  it('显示洞察来源并可清除筛选', async () => {
    const { container } = await render(
      <FinanceProvider initialFilter={{ month: '2026-08', categoryId: 'transport', sourceLabel: '周末交通支出偏高' }}>
        <TransactionsPage />
      </FinanceProvider>,
    )

    expect(container.textContent).toContain('来自洞察：周末交通支出偏高')

    await click(container.querySelector<HTMLButtonElement>('[data-clear-filter]')!)

    expect(container.textContent).not.toContain('来自洞察：')
    expect([...container.querySelectorAll('[data-transaction-row]')].some(row => row.textContent?.includes('山丘咖啡'))).toBe(true)
  })

  it('收紧洞察筛选后仍显示来源并能清除回当月完整明细', async () => {
    const { container } = await render(
      <FinanceProvider initialFilter={{ month: '2026-08', categoryId: 'transport', sourceLabel: '周末交通支出偏高' }}>
        <TransactionsPage />
      </FinanceProvider>,
    )

    await changeSelect(container.querySelector<HTMLSelectElement>('[name="kind"]')!, 'expense')
    await changeSelect(container.querySelector<HTMLSelectElement>('[name="categoryId"]')!, 'transport')
    await changeSelect(container.querySelector<HTMLSelectElement>('[name="accountId"]')!, 'alipay')

    expect(container.textContent).toContain('来自洞察：周末交通支出偏高')
    expect(container.querySelector('[data-clear-filter]')).toBeTruthy()

    await click(container.querySelector<HTMLButtonElement>('[data-clear-filter]')!)
    expect([...container.querySelectorAll('[data-transaction-row]')].some(row => row.textContent?.includes('山丘咖啡'))).toBe(true)
  })

  it('无交易的当前月份仍作为筛选选项保留', async () => {
    const { container } = await render(
      <FinanceProvider initialFilter={{ month: '2026-09' }}><TransactionsPage /></FinanceProvider>,
    )

    expect(container.querySelector<HTMLSelectElement>('select[name="month"]')?.value).toBe('2026-09')
  })

  it('明细月份选项不从 offset 分钟越界的时间戳派生', async () => {
    const repository = {
      load: () => [{ id: 'invalid-offset', kind: 'expense' as const, amount: 10, categoryId: 'food', accountId: 'wechat', merchant: '损坏偏移', occurredAt: '2025-05-01T12:00:00+05:99', note: '' }],
      save: () => ({ ok: true } as const),
    }
    const { container } = await render(<FinanceProvider repository={repository}><TransactionsPage /></FinanceProvider>)

    expect([...container.querySelectorAll<HTMLSelectElement>('select[name="month"] option')].map(option => option.value)).not.toContain('2025-05')
  })

  it('按月份筛选交易', async () => {
    const { container } = await render(
      <FinanceProvider initialFilter={{ month: '2026-07' }}><TransactionsPage /></FinanceProvider>,
    )

    expect(container.textContent).toContain('七月餐饮')
    expect([...container.querySelectorAll('[data-transaction-row]')].some(row => row.textContent?.includes('山丘咖啡'))).toBe(false)
  })

  it('按类型筛选交易', async () => {
    const { container } = await render(
      <FinanceProvider initialFilter={{ month: '2026-08', kind: 'income' }}><TransactionsPage /></FinanceProvider>,
    )

    expect(container.textContent).toContain('八月薪资')
    expect(container.textContent).not.toContain('山丘咖啡')
  })

  it('收支证据筛选按集合而非顺序显示明确类型，并可原子切换到单一类型或全部', async () => {
    const { container } = await render(<FinanceProvider initialFilter={{ month: '2026-08', kinds: ['income', 'expense'] }}><TransactionsPage /></FinanceProvider>)
    const kind = container.querySelector<HTMLSelectElement>('[name="kind"]')!

    expect(kind.value).toBe('income-expense')
    expect(container.textContent).toContain('八月薪资')
    await changeSelect(kind, 'expense')
    expect(kind.value).toBe('expense')
    expect(container.textContent).not.toContain('八月薪资')
    await changeSelect(kind, '')
    expect(kind.value).toBe('')
    expect(container.textContent).toContain('八月薪资')
  })

  it('按分类筛选交易', async () => {
    const { container } = await render(
      <FinanceProvider initialFilter={{ month: '2026-08', categoryId: 'transport' }}><TransactionsPage /></FinanceProvider>,
    )

    expect(container.textContent).toContain('城市出行')
    expect(container.textContent).not.toContain('山丘咖啡')
  })

  it('按账户筛选交易', async () => {
    const { container } = await render(
      <FinanceProvider initialFilter={{ month: '2026-08', accountId: 'bank' }}><TransactionsPage /></FinanceProvider>,
    )

    expect(container.textContent).toContain('八月房租')
    expect(container.textContent).not.toContain('山丘咖啡')
  })

  it('转账交易在账户列显示来源和去向账户', async () => {
    localStorage.setItem('qizhang.transactions.v1', JSON.stringify([{
      id: 'tx-transfer',
      kind: 'transfer',
      amount: 500,
      categoryId: 'transfer',
      accountId: 'wechat',
      targetAccountId: 'alipay',
      merchant: '账户转账',
      occurredAt: '2026-08-18T12:00:00+08:00',
      note: '转入备用金',
    }]))
    const { container } = await render(<FinanceProvider><TransactionsPage /></FinanceProvider>)

    expect(container.querySelector('[data-transaction-row]')?.textContent).toContain('微信支付 → 支付宝')
    const amount = container.querySelector<HTMLElement>('[data-transaction-row] strong')!
    expect(amount.textContent).toBe('↔ ¥500.00')
    expect(amount.classList.contains('transfer')).toBe(true)
  })

  it('可通过月份、类型、分类和账户控件组合筛选', async () => {
    const { container } = await render(<FinanceProvider><TransactionsPage /></FinanceProvider>)
    const month = container.querySelector<HTMLSelectElement>('[name="month"]')
    const kind = container.querySelector<HTMLSelectElement>('[name="kind"]')
    const category = container.querySelector<HTMLSelectElement>('[name="categoryId"]')
    const account = container.querySelector<HTMLSelectElement>('[name="accountId"]')

    expect(month).toBeTruthy()
    expect(kind).toBeTruthy()
    expect(category).toBeTruthy()
    expect(account).toBeTruthy()
    if (!month || !kind || !category || !account) return

    await changeSelect(month, '2026-07')
    await changeSelect(kind, 'income')
    await changeSelect(category, 'salary')
    await changeSelect(account, 'bank')

    expect(container.textContent).toContain('七月薪资')
    expect(container.textContent).not.toContain('七月交通')
  })

  it('将四个筛选控件作为有名称的可访问分组呈现', async () => {
    const { container } = await render(<FinanceProvider><TransactionsPage /></FinanceProvider>)

    expect(container.querySelector('[role="group"][aria-label="交易筛选"]')).toBeTruthy()
  })

  it('无匹配交易时显示当前筛选摘要并可清除', async () => {
    const { container } = await render(
      <FinanceProvider initialFilter={{ month: '2026-08', kind: 'expense', categoryId: 'salary' }}><TransactionsPage /></FinanceProvider>,
    )

    expect(container.textContent).toContain('未找到交易')
    expect(container.textContent).toContain('2026 年 8 月')
    expect(container.textContent).toContain('分类：工资')
    expect(container.querySelector('[role="status"]')?.parentElement?.getAttribute('role')).not.toBe('table')

    await click(container.querySelector<HTMLButtonElement>('[data-clear-filter]')!)

    expect([...container.querySelectorAll('[data-transaction-row]')].some(row => row.textContent?.includes('山丘咖啡'))).toBe(true)
  })

  it('删除成功后持久化交易并可从 Toast 撤销', async () => {
    const { container } = await render(<FinanceProvider><TransactionsPage /></FinanceProvider>)
    const deleteButton = container.querySelector<HTMLButtonElement>('[data-delete-transaction="tx-0818-coffee"]')

    expect(deleteButton).toBeTruthy()
    if (!deleteButton) return

    await click(deleteButton)

    expect([...container.querySelectorAll('[data-transaction-row]')].some(row => row.textContent?.includes('山丘咖啡'))).toBe(false)
    expect(container.textContent).toContain('已删除“山丘咖啡”')
    expect(JSON.parse(localStorage.getItem('qizhang.transactions.v1') ?? '[]').map((item: { id: string }) => item.id)).not.toContain('tx-0818-coffee')

    const undoButton = container.querySelector<HTMLButtonElement>('[data-undo]')
    expect(undoButton).toBeTruthy()
    if (!undoButton) return
    await click(undoButton)

    expect([...container.querySelectorAll('[data-transaction-row]')].some(row => row.textContent?.includes('山丘咖啡'))).toBe(true)
    expect(JSON.parse(localStorage.getItem('qizhang.transactions.v1') ?? '[]').map((item: { id: string }) => item.id)).toContain('tx-0818-coffee')
  })

  it('删除后五秒关闭 Toast 但保持已删除状态', async () => {
    vi.useFakeTimers()
    const { container } = await render(<FinanceProvider><TransactionsPage /></FinanceProvider>)
    const deleteButton = container.querySelector<HTMLButtonElement>('[data-delete-transaction="tx-0818-coffee"]')

    expect(deleteButton).toBeTruthy()
    if (!deleteButton) return
    await click(deleteButton)
    expect(container.textContent).toContain('已删除“山丘咖啡”')

    await act(async () => vi.advanceTimersByTime(5000))

    expect(container.textContent).not.toContain('已删除“山丘咖啡”')
    expect(container.textContent).not.toContain('山丘咖啡')
  })

  it('键盘删除后把焦点移到撤销，撤销后移到交易删除按钮', async () => {
    const { container } = await render(<FinanceProvider><TransactionsPage /></FinanceProvider>)
    const deleteButton = container.querySelector<HTMLButtonElement>('[data-delete-transaction="tx-0818-coffee"]')!

    deleteButton.focus()
    await keyDown(deleteButton, 'Enter')
    await click(deleteButton)

    const undoButton = container.querySelector<HTMLButtonElement>('[data-undo]')!
    expect(document.activeElement).toBe(undoButton)

    await keyDown(undoButton, 'Enter')
    await click(undoButton)
    expect((document.activeElement as HTMLElement).matches('[data-delete-transaction]')).toBe(true)
  })

  it('连续键盘删除时将焦点移到最新交易的撤销并恢复该交易', async () => {
    const { container } = await render(<FinanceProvider><TransactionsPage /></FinanceProvider>)
    const firstDelete = container.querySelector<HTMLButtonElement>('[data-delete-transaction="tx-0818-coffee"]')!

    firstDelete.focus()
    await keyDown(firstDelete, 'Enter')
    await click(firstDelete)

    const secondDelete = container.querySelector<HTMLButtonElement>('[data-delete-transaction="tx-0817-ride"]')!
    secondDelete.focus()
    await keyDown(secondDelete, 'Enter')
    await click(secondDelete)

    const latestUndo = container.querySelector<HTMLButtonElement>('[data-undo]')!
    expect(container.textContent).toContain('已删除“城市出行”')
    expect(document.activeElement).toBe(latestUndo)

    await keyDown(latestUndo, 'Enter')
    await click(latestUndo)
    expect([...container.querySelectorAll('[data-transaction-row]')].some(row => row.textContent?.includes('城市出行'))).toBe(true)
  })

  it('撤销到期关闭后把焦点移到相邻交易的删除按钮', async () => {
    vi.useFakeTimers()
    const { container } = await render(<FinanceProvider><TransactionsPage /></FinanceProvider>)
    const deleteButton = container.querySelector<HTMLButtonElement>('[data-delete-transaction="tx-0818-coffee"]')!

    deleteButton.focus()
    await click(deleteButton)
    await act(async () => vi.advanceTimersByTime(5000))

    expect((document.activeElement as HTMLElement).matches('[data-delete-transaction]')).toBe(true)
  })

  it('连续删除时为最新删除交易重新开始五秒撤销窗口', async () => {
    vi.useFakeTimers()
    const { container } = await render(<FinanceProvider><TransactionsPage /></FinanceProvider>)

    await click(container.querySelector<HTMLButtonElement>('[data-delete-transaction="tx-0818-coffee"]')!)
    await act(async () => vi.advanceTimersByTime(3000))
    await click(container.querySelector<HTMLButtonElement>('[data-delete-transaction="tx-0817-ride"]')!)

    await act(async () => vi.advanceTimersByTime(2000))
    expect(container.textContent).toContain('已删除“城市出行”')

    await act(async () => vi.advanceTimersByTime(3000))
    expect(container.textContent).not.toContain('已删除“城市出行”')
  })

  it('删除持久化失败时保留交易并显示错误', async () => {
    const storage: Storage = {
      ...localStorage,
      setItem: () => {
        throw new Error('quota exceeded')
      },
    }
    const { container } = await render(
      <FinanceProvider repository={createTransactionRepository(storage)}><TransactionsPage /></FinanceProvider>,
    )

    await click(container.querySelector<HTMLButtonElement>('[data-delete-transaction="tx-0818-coffee"]')!)

    expect([...container.querySelectorAll('[data-transaction-row]')].some(row => row.textContent?.includes('山丘咖啡'))).toBe(true)
    expect(container.textContent).not.toContain('已删除“山丘咖啡”')
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('保存失败，输入内容已保留。')
  })

  it('恢复持久化失败时保持删除状态和 Toast', async () => {
    let rejectWrites = false
    const storage: Storage = {
      ...localStorage,
      setItem: (key, value) => {
        if (rejectWrites) throw new Error('quota exceeded')
        localStorage.setItem(key, value)
      },
    }
    const { container } = await render(
      <FinanceProvider repository={createTransactionRepository(storage)}><TransactionsPage /></FinanceProvider>,
    )

    await click(container.querySelector<HTMLButtonElement>('[data-delete-transaction="tx-0818-coffee"]')!)
    rejectWrites = true
    await click(container.querySelector<HTMLButtonElement>('[data-undo]')!)

    expect([...container.querySelectorAll('[data-transaction-row]')].some(row => row.textContent?.includes('山丘咖啡'))).toBe(false)
    expect(container.textContent).toContain('已删除“山丘咖啡”')
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('保存失败，输入内容已保留。')
  })

  it('接近截止时间恢复失败后保留新的可重试撤销窗口', async () => {
    vi.useFakeTimers()
    let rejectWrites = false
    const storage: Storage = {
      ...localStorage,
      setItem: (key, value) => {
        if (rejectWrites) throw new Error('quota exceeded')
        localStorage.setItem(key, value)
      },
    }
    const { container } = await render(
      <FinanceProvider repository={createTransactionRepository(storage)}><TransactionsPage /></FinanceProvider>,
    )

    await click(container.querySelector<HTMLButtonElement>('[data-delete-transaction="tx-0818-coffee"]')!)
    await act(async () => vi.advanceTimersByTime(4900))
    rejectWrites = true
    await click(container.querySelector<HTMLButtonElement>('[data-undo]')!)
    await act(async () => vi.advanceTimersByTime(100))

    expect(container.textContent).toContain('已删除“山丘咖啡”')
    expect(container.querySelector('[data-undo]')).toBeTruthy()

    rejectWrites = false
    await click(container.querySelector<HTMLButtonElement>('[data-undo]')!)
    expect([...container.querySelectorAll('[data-transaction-row]')].some(row => row.textContent?.includes('山丘咖啡'))).toBe(true)
  })

  it('恢复失败后的新撤销窗口到期时一并清除 Toast 和对应错误', async () => {
    vi.useFakeTimers()
    let rejectWrites = false
    const storage: Storage = {
      ...localStorage,
      setItem: (key, value) => {
        if (rejectWrites) throw new Error('quota exceeded')
        localStorage.setItem(key, value)
      },
    }
    const { container } = await render(
      <FinanceProvider repository={createTransactionRepository(storage)}><TransactionsPage /></FinanceProvider>,
    )

    await click(container.querySelector<HTMLButtonElement>('[data-delete-transaction="tx-0818-coffee"]')!)
    rejectWrites = true
    await click(container.querySelector<HTMLButtonElement>('[data-undo]')!)
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('保存失败，输入内容已保留。')

    await act(async () => vi.advanceTimersByTime(5000))

    expect(container.querySelector('[data-undo]')).toBeNull()
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
})
