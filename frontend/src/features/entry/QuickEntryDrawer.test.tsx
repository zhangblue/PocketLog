import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { changeInput, changeSelect, click, render } from '../../test/render'
import type { AccountLabel, Category } from '../../domain/types'
import { QuickEntryDrawer } from './QuickEntryDrawer'

const entryCategories: Category[] = [
  { id: 'fresh-food', name: '新餐饮', emoji: '🍲', color: '#000', kind: 'expense', active: true },
  { id: 'old-food', name: '停用餐饮', emoji: '🍲', color: '#000', kind: 'expense', active: false },
  { id: 'fresh-salary', name: '新工资', emoji: '💵', color: '#000', kind: 'income', active: true },
]

const entryAccounts: AccountLabel[] = [
  { id: 'fresh-card', name: '新银行卡', active: true },
  { id: 'old-card', name: '停用账户', active: false },
]

function ChangingOptionsHarness() {
  const [categories, setCategories] = useState(entryCategories)
  const [accounts, setAccounts] = useState(entryAccounts)

  return (
    <>
      <button type="button" onClick={() => {
        setCategories([{ id: 'replacement-food', name: '替换餐饮', emoji: '🍲', color: '#000', kind: 'expense', active: true }])
        setAccounts([{ id: 'replacement-account', name: '替换账户', active: true }])
      }}>替换选项</button>
      <QuickEntryDrawer open onClose={() => undefined} onSave={() => ({ ok: true })} categories={categories} accounts={accounts} />
    </>
  )
}

describe('QuickEntryDrawer', () => {
  it('默认日期与时间来自真实本地当前时间', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2031, 1, 3, 4, 5))

    const { container } = await render(<QuickEntryDrawer open onClose={() => undefined} onSave={() => ({ ok: true })} />)

    expect(container.querySelector<HTMLInputElement>('[name="occurredAt"]')?.value).toBe('2031-02-03')
    expect(container.querySelector<HTMLInputElement>('[name="occurredTime"]')?.value).toBe('04:05')
  })

  it('仅展示 Provider 传入的启用分类和账户', async () => {
    const { container } = await render(
      <QuickEntryDrawer open onClose={() => undefined} onSave={() => ({ ok: true })} categories={entryCategories} accounts={entryAccounts} />,
    )

    expect([...container.querySelectorAll<HTMLSelectElement>('[name="categoryId"] option')].map(option => option.value)).toEqual(['fresh-food'])
    expect([...container.querySelectorAll<HTMLSelectElement>('[name="accountId"] option')].map(option => option.value)).toEqual(['fresh-card'])
    await click(container.querySelector<HTMLButtonElement>('[data-kind="income"]')!)
    expect([...container.querySelectorAll<HTMLSelectElement>('[name="categoryId"] option')].map(option => option.value)).toEqual(['fresh-salary'])
  })

  it('Provider 集合变化后校正已停用的分类和账户', async () => {
    const { container } = await render(<ChangingOptionsHarness />)

    await click([...container.querySelectorAll('button')].find(button => button.textContent === '替换选项')!)

    expect(container.querySelector<HTMLSelectElement>('[name="categoryId"]')?.value).toBe('replacement-food')
    expect(container.querySelector<HTMLSelectElement>('[name="accountId"]')?.value).toBe('replacement-account')
  })

  it('没有启用账户时显示可访问错误并阻止保存', async () => {
    const save = vi.fn(() => ({ ok: true as const }))
    const { container } = await render(
      <QuickEntryDrawer open onClose={() => undefined} onSave={save} categories={entryCategories} accounts={[]} />,
    )

    await changeInput(container.querySelector<HTMLInputElement>('[name="amount"]')!, '68')
    await click(container.querySelector<HTMLButtonElement>('[data-save]')!)

    const account = container.querySelector<HTMLSelectElement>('[name="accountId"]')!
    expect(save).not.toHaveBeenCalled()
    expect(account.getAttribute('aria-describedby')).toBe('entry-error')
    expect(container.textContent).toContain('请至少保留一个启用账户')
    expect(document.activeElement).toBe(account)
  })

  it('日期为空时显示关联错误、聚焦日期并阻止保存', async () => {
    const save = vi.fn(() => ({ ok: true as const }))
    const { container } = await render(<QuickEntryDrawer open onClose={() => undefined} onSave={save} />)
    const date = container.querySelector<HTMLInputElement>('[name="occurredAt"]')!

    await changeInput(container.querySelector<HTMLInputElement>('[name="amount"]')!, '68')
    await changeInput(date, '')
    await click(container.querySelector<HTMLButtonElement>('[data-save]')!)

    expect(save).not.toHaveBeenCalled()
    expect(date.getAttribute('aria-describedby')).toBe('entry-error')
    expect(document.activeElement).toBe(date)
    expect(container.textContent).toContain('请输入有效日期')
  })

  it('非法日历日期时阻止保存', async () => {
    const save = vi.fn(() => ({ ok: true as const }))
    const { container } = await render(<QuickEntryDrawer open onClose={() => undefined} onSave={save} />)
    const date = container.querySelector<HTMLInputElement>('[name="occurredAt"]')!

    await changeInput(container.querySelector<HTMLInputElement>('[name="amount"]')!, '68')
    date.type = 'text'
    await changeInput(date, '2026-02-30')
    await click(container.querySelector<HTMLButtonElement>('[data-save]')!)

    expect(save).not.toHaveBeenCalled()
    expect(container.textContent).toContain('请输入有效日期')
  })

  it('打开时聚焦金额', async () => {
    const { container } = await render(<QuickEntryDrawer open onClose={() => undefined} onSave={() => ({ ok: true })} />)

    expect(document.activeElement).toBe(container.querySelector('[name="amount"]'))
  })

  it('按 Escape 关闭抽屉', async () => {
    const close = vi.fn()
    const { container } = await render(<QuickEntryDrawer open onClose={close} onSave={() => ({ ok: true })} />)

    container.querySelector('[role="dialog"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(close).toHaveBeenCalledOnce()
  })

  it('dirty 后取消要求继续编辑或放弃，并在继续编辑后归还取消触发器焦点', async () => {
    const close = vi.fn()
    const { container } = await render(<QuickEntryDrawer open onClose={close} onSave={() => ({ ok: true })} />)
    await changeInput(container.querySelector<HTMLInputElement>('[name="amount"]')!, '68')
    const cancel = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '取消')!

    await click(cancel)
    const confirmation = container.querySelector<HTMLElement>('[role="alertdialog"]')!
    expect(confirmation.textContent).toContain('未保存的内容')
    expect(close).not.toHaveBeenCalled()
    expect(document.activeElement?.textContent).toBe('继续编辑')

    await click([...confirmation.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '继续编辑')!)
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()
    expect(document.activeElement).toBe(cancel)
    expect(container.querySelector<HTMLInputElement>('[name="amount"]')?.value).toBe('68')
  })

  it('dirty 后 Escape 打开确认，确认焦点陷阱且放弃后才关闭', async () => {
    const close = vi.fn()
    const { container } = await render(<QuickEntryDrawer open onClose={close} onSave={() => ({ ok: true })} />)
    await changeInput(container.querySelector<HTMLInputElement>('[name="amount"]')!, '68')
    const drawer = container.querySelector<HTMLElement>('.quick-entry-drawer')!

    drawer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    const confirmation = container.querySelector<HTMLElement>('[role="alertdialog"]')!
    const [continueButton, discardButton] = confirmation.querySelectorAll<HTMLButtonElement>('button')
    discardButton.focus()
    confirmation.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(document.activeElement).toBe(continueButton)

    await click(discardButton)
    expect(close).toHaveBeenCalledOnce()
  })

  it('Tab 从最后一个元素回到浮层第一个元素', async () => {
    const { container } = await render(<QuickEntryDrawer open onClose={() => undefined} onSave={() => ({ ok: true })} />)
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    const first = container.querySelector<HTMLButtonElement>('[data-kind="expense"]')!
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('button')]
    const last = buttons[buttons.length - 1]!

    last.focus()
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))

    expect(document.activeElement).toBe(first)
  })

  it('Shift+Tab 从第一个元素回到浮层最后一个元素', async () => {
    const { container } = await render(<QuickEntryDrawer open onClose={() => undefined} onSave={() => ({ ok: true })} />)
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    const first = container.querySelector<HTMLButtonElement>('[data-kind="expense"]')!
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('button')]
    const last = buttons[buttons.length - 1]!

    first.focus()
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))

    expect(document.activeElement).toBe(last)
  })

  it('金额为空时阻止保存、显示关联错误并聚焦金额', async () => {
    const save = vi.fn()
    const { container } = await render(<QuickEntryDrawer open onClose={() => undefined} onSave={save} />)
    const button = container.querySelector<HTMLButtonElement>('[data-save]')!

    await click(button)

    const amount = container.querySelector<HTMLInputElement>('[name="amount"]')!
    expect(save).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(amount)
    expect(amount.getAttribute('aria-describedby')).toBe('entry-error')
    expect(container.textContent).toContain('请输入大于 0 的金额')
  })

  it('金额为零时阻止保存', async () => {
    const save = vi.fn()
    const { container } = await render(<QuickEntryDrawer open onClose={() => undefined} onSave={save} />)
    const amount = container.querySelector<HTMLInputElement>('[name="amount"]')!

    await changeInput(amount, '0')
    await click(container.querySelector<HTMLButtonElement>('[data-save]')!)

    expect(save).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(amount)
    expect(container.textContent).toContain('请输入大于 0 的金额')
  })

  it('金额不是数字时阻止保存', async () => {
    const save = vi.fn()
    const { container } = await render(<QuickEntryDrawer open onClose={() => undefined} onSave={save} />)
    const amount = container.querySelector<HTMLInputElement>('[name="amount"]')!

    await changeInput(amount, '一百')
    await click(container.querySelector<HTMLButtonElement>('[data-save]')!)

    expect(save).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(amount)
    expect(container.textContent).toContain('请输入大于 0 的金额')
  })

  it('转账保存不要求分类', async () => {
    const save = vi.fn(() => ({ ok: true as const }))
    const { container } = await render(<QuickEntryDrawer open onClose={() => undefined} onSave={save} />)
    const transfer = container.querySelector<HTMLButtonElement>('[data-kind="transfer"]')
    expect(transfer).toBeTruthy()
    if (!transfer) return

    await click(transfer)
    expect(container.querySelector('select[name="categoryId"]')).toBeNull()
    await changeInput(container.querySelector<HTMLInputElement>('[name="amount"]')!, '68')
    await click(container.querySelector<HTMLButtonElement>('[data-save]')!)

    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'transfer',
      categoryId: '',
      accountId: 'wechat',
      targetAccountId: 'alipay',
    }), expect.objectContaining({ keepDrawerOpen: false, idempotencyKey: expect.any(String) }))
  })

  it('转账来源和目标账户相同时阻止保存', async () => {
    const save = vi.fn(() => ({ ok: true as const }))
    const { container } = await render(<QuickEntryDrawer open onClose={() => undefined} onSave={save} />)

    await click(container.querySelector<HTMLButtonElement>('[data-kind="transfer"]')!)
    await changeInput(container.querySelector<HTMLInputElement>('[name="amount"]')!, '68')
    await changeSelect(container.querySelector<HTMLSelectElement>('[name="targetAccountId"]')!, 'wechat')
    await click(container.querySelector<HTMLButtonElement>('[data-save]')!)

    expect(save).not.toHaveBeenCalled()
    expect(container.textContent).toContain('转出与转入账户不能相同')
    const target = container.querySelector<HTMLSelectElement>('[name="targetAccountId"]')!
    expect(target.getAttribute('aria-describedby')).toBe('entry-error')
    expect(target.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(target)
  })

  it('保存并继续仅清空金额和备注，保留类型和日期', async () => {
    const save = vi.fn(() => ({ ok: true as const }))
    const { container } = await render(<QuickEntryDrawer open onClose={() => undefined} onSave={save} />)
    const continueButton = container.querySelector<HTMLButtonElement>('[data-save-continue]')
    expect(continueButton).toBeTruthy()
    if (!continueButton) return

    await click(container.querySelector<HTMLButtonElement>('[data-kind="income"]')!)
    await changeInput(container.querySelector<HTMLInputElement>('[name="amount"]')!, '68')
    await changeInput(container.querySelector<HTMLInputElement>('[name="occurredAt"]')!, '2026-08-17')
    await changeInput(container.querySelector<HTMLTextAreaElement>('[name="note"]')!, '奖金')
    await click(continueButton)

    expect(container.querySelector<HTMLInputElement>('[name="amount"]')?.value).toBe('')
    expect(container.querySelector<HTMLTextAreaElement>('[name="note"]')?.value).toBe('')
    expect(container.querySelector<HTMLButtonElement>('[data-kind="income"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector<HTMLInputElement>('[name="occurredAt"]')?.value).toBe('2026-08-17')
  })

  it('普通保存成功后重置草稿，避免下次打开重复提交上一笔', async () => {
    const { container } = await render(<QuickEntryDrawer open onClose={() => undefined} onSave={() => ({ ok: true })} />)

    await changeInput(container.querySelector<HTMLInputElement>('[name="amount"]')!, '68')
    await changeSelect(container.querySelector<HTMLSelectElement>('[name="categoryId"]')!, 'shopping')
    await changeInput(container.querySelector<HTMLTextAreaElement>('[name="note"]')!, '已保存')
    await click(container.querySelector<HTMLButtonElement>('[data-save]')!)

    expect(container.querySelector<HTMLInputElement>('[name="amount"]')?.value).toBe('')
    expect(container.querySelector<HTMLSelectElement>('[name="categoryId"]')?.value).toBe('food')
    expect(container.querySelector<HTMLTextAreaElement>('[name="note"]')?.value).toBe('')
  })
})
