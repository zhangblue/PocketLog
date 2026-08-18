import { describe, expect, it } from 'vitest'
import { sampleCategories } from '../../domain/sampleData'
import { FinanceProvider } from '../../app/FinanceProvider'
import { createLabelRepository } from '../../data/labelRepository'
import { createTransactionRepository } from '../../data/transactionRepository'
import { changeInput, click, keyDown, render } from '../../test/render'
import { LabelsPage } from './LabelsPage'

describe('LabelsPage', () => {
  it('已使用分类只能停用或迁移，不能直接删除', async () => {
    const { container } = await render(<FinanceProvider><LabelsPage /></FinanceProvider>)
    const foodRow = container.querySelector<HTMLElement>('[data-category="food"]')!

    expect(foodRow.querySelector('[data-delete]')).toBeNull()
    expect(foodRow.querySelector('[data-deactivate]')).not.toBeNull()
    expect(foodRow.querySelector('[data-migrate]')).not.toBeNull()
  })

  it('未使用分类删除前要求确认', async () => {
    const unused = { id: 'unused', name: '闲置', emoji: '🧺', color: '#123456', kind: 'expense' as const, active: false }
    const { container } = await render(<FinanceProvider initialCategories={[...sampleCategories, unused]}><LabelsPage /></FinanceProvider>)

    await click(container.querySelector<HTMLElement>('[data-category="unused"] [data-delete]')!)

    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('删除分类')
    await click(container.querySelector<HTMLButtonElement>('[data-confirm-delete]')!)
    expect(container.querySelector('[data-category="unused"]')).toBeNull()
  })

  it('账户标签可重命名且保存后显示新名称', async () => {
    const { container } = await render(<FinanceProvider><LabelsPage /></FinanceProvider>)

    await click(container.querySelector<HTMLButtonElement>('[data-tab="accounts"]')!)
    await click(container.querySelector<HTMLButtonElement>('[data-account="cash"] [data-rename]')!)
    const input = container.querySelector<HTMLInputElement>('input[aria-label="现金 账户名称"]')!
    await changeInput(input, '零钱')
    await click(container.querySelector<HTMLButtonElement>('[data-save-rename]')!)

    expect(container.querySelector('[data-account="cash"]')?.textContent).toContain('零钱')
  })

  it('迁移只提供同类型的启用目标分类', async () => {
    const { container } = await render(<FinanceProvider><LabelsPage /></FinanceProvider>)

    await click(container.querySelector<HTMLButtonElement>('[data-category="food"] [data-migrate]')!)

    const target = container.querySelector<HTMLSelectElement>('select[aria-label="迁移至"]')!
    expect([...target.options].map(option => option.value)).toEqual(expect.arrayContaining(['transport']))
    expect([...target.options].map(option => option.value)).not.toContain('salary')
  })

  it('确认对话框初始聚焦取消按钮，循环 Tab，并在 Escape 后归还触发焦点', async () => {
    const unused = { id: 'unused', name: '闲置', emoji: '🧺', color: '#123456', kind: 'expense' as const, active: false }
    const { container } = await render(<FinanceProvider initialCategories={[...sampleCategories, unused]}><LabelsPage /></FinanceProvider>)
    const trigger = container.querySelector<HTMLButtonElement>('[data-category="unused"] [data-delete]')!

    await click(trigger)
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    const cancel = dialog.querySelector<HTMLButtonElement>('button')!
    const confirm = dialog.querySelector<HTMLButtonElement>('[data-confirm-delete]')!
    expect(document.activeElement).toBe(cancel)

    confirm.focus()
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(document.activeElement).toBe(cancel)
    cancel.focus()
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))
    expect(document.activeElement).toBe(confirm)

    await keyDown(dialog, 'Escape')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('成功删除触发器后将焦点移到页面标题', async () => {
    const unused = { id: 'unused', name: '闲置', emoji: '🧺', color: '#123456', kind: 'expense' as const, active: false }
    const { container } = await render(<FinanceProvider initialCategories={[...sampleCategories, unused]}><LabelsPage /></FinanceProvider>)

    await click(container.querySelector<HTMLButtonElement>('[data-category="unused"] [data-delete]')!)
    await click(container.querySelector<HTMLButtonElement>('[data-confirm-delete]')!)

    expect(document.activeElement).toBe(container.querySelector('#labels-title'))
  })

  it('取消确认对话框后将焦点归还给打开它的按钮', async () => {
    const unused = { id: 'unused', name: '闲置', emoji: '🧺', color: '#123456', kind: 'expense' as const, active: false }
    const { container } = await render(<FinanceProvider initialCategories={[...sampleCategories, unused]}><LabelsPage /></FinanceProvider>)
    const trigger = container.querySelector<HTMLButtonElement>('[data-category="unused"] [data-delete]')!

    await click(trigger)
    await click(container.querySelector<HTMLButtonElement>('[role="dialog"] button')!)

    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('没有同类型启用迁移目标时禁用确认并在对话框说明原因', async () => {
    const onlyExpense = [{ id: 'food', name: '餐饮', emoji: '🍜', color: '#4f8a75', kind: 'expense' as const, active: true }]
    const { container } = await render(<FinanceProvider initialCategories={onlyExpense}><LabelsPage /></FinanceProvider>)

    await click(container.querySelector<HTMLButtonElement>('[data-category="food"] [data-migrate]')!)
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!

    expect(dialog.textContent).toContain('没有可用的同类型启用分类')
    expect(dialog.querySelector<HTMLButtonElement>('[data-confirm-delete]')?.disabled).toBe(true)
  })

  it('迁移成功后在删除触发器不可用时将焦点归还给标题', async () => {
    const { container } = await render(<FinanceProvider><LabelsPage /></FinanceProvider>)

    await click(container.querySelector<HTMLButtonElement>('[data-category="food"] [data-migrate]')!)
    await click(container.querySelector<HTMLButtonElement>('[data-confirm-delete]')!)

    expect(container.querySelector('[data-category="food"]')).toBeNull()
    expect(document.activeElement).toBe(container.querySelector('#labels-title'))
  })

  it('迁移回滚失败时在对话框内保留可恢复提示', async () => {
    let transactionWrites = 0
    const storage: Storage = {
      ...localStorage,
      setItem: (key, value) => {
        if (key === 'qizhang.labels.v1') throw new Error('labels failed')
        if (key === 'qizhang.transactions.v1') {
          transactionWrites += 1
          if (transactionWrites > 1) throw new Error('rollback failed')
        }
        localStorage.setItem(key, value)
      },
    }
    const { container } = await render(<FinanceProvider repository={createTransactionRepository(storage)} labelRepository={createLabelRepository(storage)}><LabelsPage /></FinanceProvider>)

    await click(container.querySelector<HTMLButtonElement>('[data-category="food"] [data-migrate]')!)
    await click(container.querySelector<HTMLButtonElement>('[data-confirm-delete]')!)

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('请勿关闭页面')
    expect(dialog.getAttribute('aria-describedby')).toContain('label-dialog-error')
    expect(container.querySelector('[data-category="food"]')).toBeTruthy()
  })
})
