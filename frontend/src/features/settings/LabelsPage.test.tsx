import { FinanceApiError } from '../../api/types'
import { describe, expect, it, vi } from 'vitest'
import { sampleCategories } from '../../domain/sampleData'
import { FinanceProvider } from '../../app/FinanceProvider'
import { changeInput, changeSelect, click, keyDown, render } from '../../test/render'
import { createFixtureApi } from '../../test/financeApi'
import { LabelsPage } from './LabelsPage'

describe('LabelsPage', () => {
  it('提供独立自定义图标库并将新增图标加入分类下拉框', async () => {
    const api = createFixtureApi()
    const createCustomIcon = vi.spyOn(api, 'createCustomIcon')
    const { container } = await render(<FinanceProvider api={api}><LabelsPage /></FinanceProvider>)
    const input = container.querySelector<HTMLInputElement>('[aria-label="自定义图标库输入"]')!
    await changeInput(input, '🧋')
    await click(container.querySelector<HTMLButtonElement>('[data-add-custom-icon]')!)
    expect(createCustomIcon).toHaveBeenCalledWith('🧋', expect.any(Number))
    expect(container.querySelector('[aria-label="已保存自定义图标"]')?.textContent).toContain('🧋')
    expect([...container.querySelectorAll<HTMLOptionElement>('select[aria-label="分类图标"] option')].some(option => option.value === '🧋')).toBe(true)
    expect(container.querySelector('[aria-label="自定义图标库"]')?.textContent).toContain('🧋')
  })

  it('自定义图标为空时不请求并聚焦输入框', async () => {
    const api = createFixtureApi()
    const createCustomIcon = vi.spyOn(api, 'createCustomIcon')
    const { container } = await render(<FinanceProvider api={api}><LabelsPage /></FinanceProvider>)
    const input = container.querySelector<HTMLInputElement>('[aria-label="自定义图标库输入"]')!
    await click(container.querySelector<HTMLButtonElement>('[data-add-custom-icon]')!)
    expect(createCustomIcon).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('请输入自定义图标')
    expect(document.activeElement).toBe(input)
  })

  it('分类表单不再提供自由输入 Emoji', async () => {
    const { container } = await render(<FinanceProvider><LabelsPage /></FinanceProvider>)
    expect(container.querySelector('.label-create-form input[aria-label="自定义图标"]')).toBeNull()
  })

  it('选中共享自定义图标后切换分类类型仍保留选择', async () => {
    const { container } = await render(<FinanceProvider api={createFixtureApi({ customIcons: ['🧋'] })}><LabelsPage /></FinanceProvider>)
    const iconSelect = container.querySelector<HTMLSelectElement>('select[aria-label="分类图标"]')!
    await changeSelect(iconSelect, '🧋')
    await changeSelect(container.querySelector<HTMLSelectElement>('select[aria-label="分类类型"]')!, 'income')
    expect(iconSelect.value).toBe('🧋')
  })
  it('固定图标选择器保持原生语义并使用紧凑的 44px 宽度', async () => {
    const { container } = await render(<FinanceProvider><LabelsPage /></FinanceProvider>)
    const iconSelect = container.querySelector<HTMLSelectElement>('select[aria-label="分类图标"]')!

    expect(iconSelect.classList.contains('label-icon-select')).toBe(true)
    expect(getComputedStyle(iconSelect).width).toBe('44px')
    expect([...iconSelect.options].every(option => option.textContent === option.value)).toBe(true)
  })

  it('编辑分类会预填名称、固定图标，并只展开当前行', async () => {
    const { container } = await render(<FinanceProvider><LabelsPage /></FinanceProvider>)
    const foodRow = container.querySelector<HTMLElement>('[data-category="food"]')!
    const transportRow = container.querySelector<HTMLElement>('[data-category="transport"]')!

    await click(foodRow.querySelector<HTMLButtonElement>('[aria-label="编辑 餐饮"]')!)

    expect(foodRow.querySelector<HTMLInputElement>('[aria-label="餐饮 分类名称"]')?.value).toBe('餐饮')
    expect(foodRow.querySelector<HTMLSelectElement>('[aria-label="餐饮 分类图标"]')?.value).toBe('🍜')
    expect(transportRow.querySelector('input[aria-label$="分类名称"]')).toBeNull()

    await click(transportRow.querySelector<HTMLButtonElement>('[aria-label="编辑 交通"]')!)
    expect(foodRow.querySelector('input[aria-label$="分类名称"]')).toBeNull()
    expect(transportRow.querySelector<HTMLInputElement>('[aria-label="交通 分类名称"]')?.value).toBe('交通')
  })

  it('从图标编辑切换到重命名时只保留重命名编辑区', async () => {
    const { container } = await render(<FinanceProvider><LabelsPage /></FinanceProvider>)
    const foodRow = container.querySelector<HTMLElement>('[data-category="food"]')!
    const transportRow = container.querySelector<HTMLElement>('[data-category="transport"]')!

    await click(foodRow.querySelector<HTMLButtonElement>('[aria-label="编辑 餐饮"]')!)
    await click(transportRow.querySelector<HTMLButtonElement>('[data-rename]')!)

    expect(foodRow.querySelector('[aria-label="餐饮 分类图标"]')).toBeNull()
    expect(transportRow.querySelector<HTMLInputElement>('[aria-label="交通 分类名称"]')?.value).toBe('交通')
  })

  it('从重命名切换到图标编辑时只保留图标编辑区', async () => {
    const { container } = await render(<FinanceProvider><LabelsPage /></FinanceProvider>)
    const foodRow = container.querySelector<HTMLElement>('[data-category="food"]')!
    const transportRow = container.querySelector<HTMLElement>('[data-category="transport"]')!

    await click(foodRow.querySelector<HTMLButtonElement>('[data-rename]')!)
    await click(transportRow.querySelector<HTMLButtonElement>('[aria-label="编辑 交通"]')!)

    expect(foodRow.querySelector('[aria-label="餐饮 分类名称"]')).toBeNull()
    expect(transportRow.querySelector<HTMLSelectElement>('[aria-label="交通 分类图标"]')?.value).toBe('🚕')
  })

  it('编辑分类保存名称和固定图标，成功后关闭编辑区', async () => {
    const api = createFixtureApi()
    const patchCategory = vi.spyOn(api, 'patchCategory')
    const { container } = await render(<FinanceProvider api={api}><LabelsPage /></FinanceProvider>)
    const foodRow = container.querySelector<HTMLElement>('[data-category="food"]')!

    await click(foodRow.querySelector<HTMLButtonElement>('[aria-label="编辑 餐饮"]')!)
    await changeInput(foodRow.querySelector<HTMLInputElement>('[aria-label="餐饮 分类名称"]')!, '午餐')
    await changeSelect(foodRow.querySelector<HTMLSelectElement>('[aria-label="餐饮 分类图标"]')!, '⚡')
    await click(foodRow.querySelector<HTMLButtonElement>('[data-save-category]')!)

    expect(patchCategory).toHaveBeenCalledTimes(1)
    expect(patchCategory).toHaveBeenCalledWith('food', { name: '午餐', emoji: '⚡' }, expect.any(Number))
    expect(foodRow.textContent).toContain('午餐')
    expect(foodRow.querySelector('[data-save-category]')).toBeNull()
  })

  it('取消编辑分类不会请求 API 并丢弃草稿', async () => {
    const api = createFixtureApi()
    const patchCategory = vi.spyOn(api, 'patchCategory')
    const { container } = await render(<FinanceProvider api={api}><LabelsPage /></FinanceProvider>)
    const foodRow = container.querySelector<HTMLElement>('[data-category="food"]')!

    await click(foodRow.querySelector<HTMLButtonElement>('[aria-label="编辑 餐饮"]')!)
    await changeInput(foodRow.querySelector<HTMLInputElement>('[aria-label="餐饮 分类名称"]')!, '草稿')
    await click(foodRow.querySelector<HTMLButtonElement>('[data-cancel-category]')!)

    expect(patchCategory).not.toHaveBeenCalled()
    expect(foodRow.textContent).toContain('餐饮')
    expect(foodRow.querySelector('[data-save-category]')).toBeNull()
  })

  it('编辑分类保存失败时保留草稿和编辑区', async () => {
    const api = createFixtureApi()
    vi.spyOn(api, 'patchCategory').mockRejectedValue(new Error('标签保存失败，请重试。'))
    const { container } = await render(<FinanceProvider api={api}><LabelsPage /></FinanceProvider>)
    const foodRow = container.querySelector<HTMLElement>('[data-category="food"]')!

    await click(foodRow.querySelector<HTMLButtonElement>('[aria-label="编辑 餐饮"]')!)
    await changeInput(foodRow.querySelector<HTMLInputElement>('[aria-label="餐饮 分类名称"]')!, '失败草稿')
    await click(foodRow.querySelector<HTMLButtonElement>('[data-save-category]')!)

    expect(foodRow.querySelector<HTMLInputElement>('[aria-label="餐饮 分类名称"]')?.value).toBe('失败草稿')
    expect(foodRow.querySelector('[data-save-category]')).toBeTruthy()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('标签保存失败，请重试。')
  })

  it('固定图标使用仅含 Emoji 的 select 并随分类类型更新选项', async () => {
    const { container } = await render(<FinanceProvider><LabelsPage /></FinanceProvider>)
    const iconSelect = container.querySelector<HTMLSelectElement>('select[aria-label="分类图标"]')!

    expect([...iconSelect.options].map(option => option.textContent)).toEqual(expect.arrayContaining(['🏷️', '📱', '⚡']))
    expect([...iconSelect.options].every(option => option.textContent === option.value)).toBe(true)
    expect(iconSelect.value).toBe('🏷️')

    await changeSelect(container.querySelector<HTMLSelectElement>('select[aria-label="分类类型"]')!, 'income')

    expect([...iconSelect.options].map(option => option.textContent)).toEqual(['🏷️', '💼', '🎁'])
  })

  it('提交分类时发送所选固定图标', async () => {
    const api = createFixtureApi()
    const createCategory = vi.spyOn(api, 'createCategory')
    const { container } = await render(<FinanceProvider api={api}><LabelsPage /></FinanceProvider>)

    await changeInput(container.querySelector<HTMLInputElement>('[aria-label="分类名称"]')!, '闪电分类')
    await changeSelect(container.querySelector<HTMLSelectElement>('select[aria-label="分类图标"]')!, '⚡')
    await click(container.querySelector<HTMLButtonElement>('[data-category-submit]')!)

    expect(createCategory).toHaveBeenCalledWith(expect.objectContaining({ name: '闪电分类', kind: 'expense', emoji: '⚡' }), expect.any(Number))
  })

  it('切换到另一类时将专属固定图标回退为默认图标', async () => {
    const api = createFixtureApi()
    const createCategory = vi.spyOn(api, 'createCategory')
    const { container } = await render(<FinanceProvider api={api}><LabelsPage /></FinanceProvider>)

    await changeSelect(container.querySelector<HTMLSelectElement>('select[aria-label="分类图标"]')!, '⚡')
    await changeInput(container.querySelector<HTMLInputElement>('[aria-label="分类名称"]')!, '收入分类')
    await changeSelect(container.querySelector<HTMLSelectElement>('select[aria-label="分类类型"]')!, 'income')
    await click(container.querySelector<HTMLButtonElement>('[data-category-submit]')!)

    expect(createCategory).toHaveBeenCalledWith(expect.objectContaining({ emoji: '🏷️', kind: 'income' }), expect.any(Number))
  })

  it('空分类名称不请求 API、显示提示并聚焦名称输入', async () => {
    const api = createFixtureApi()
    const createCategory = vi.spyOn(api, 'createCategory')
    const { container } = await render(<FinanceProvider api={api}><LabelsPage /></FinanceProvider>)
    const nameInput = container.querySelector<HTMLInputElement>('[aria-label="分类名称"]')!

    await click(container.querySelector<HTMLButtonElement>('[data-category-submit]')!)

    expect(createCategory).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('请输入分类名称')
    expect(document.activeElement).toBe(nameInput)
  })

  it('分类动作遵循启用、停用和历史引用状态', async () => {
    const unusedInactive = { id: 'unused-inactive', name: '闲置', emoji: '🧺', color: '#123456', kind: 'expense' as const, active: false }
    const referencedInactive = { id: 'referenced-inactive', name: '历史分类', emoji: '📚', color: '#123456', kind: 'expense' as const, active: false }
    const transactions = [{ id: 'historical', kind: 'expense' as const, amount: 20, categoryId: 'referenced-inactive', accountId: 'cash', merchant: '历史消费', occurredAt: '2026-08-01T12:00:00+08:00', note: '' }]
    const { container } = await render(<FinanceProvider api={createFixtureApi({ categories: [...sampleCategories, unusedInactive, referencedInactive], transactions })}><LabelsPage /></FinanceProvider>)
    const foodRow = container.querySelector<HTMLElement>('[data-category="food"]')!
    const unusedRow = container.querySelector<HTMLElement>('[data-category="unused-inactive"]')!
    const referencedRow = container.querySelector<HTMLElement>('[data-category="referenced-inactive"]')!

    expect(foodRow.querySelector('[data-deactivate]')).not.toBeNull()
    expect(foodRow.querySelector('[data-delete], [data-migrate], [data-activate]')).toBeNull()
    expect(unusedRow.querySelector('[data-activate]')).not.toBeNull()
    expect(unusedRow.querySelector('[data-delete]')).not.toBeNull()
    expect(unusedRow.querySelector('[data-migrate], [data-deactivate]')).toBeNull()
    expect(referencedRow.querySelector('[data-activate]')).not.toBeNull()
    expect(referencedRow.querySelector('[data-migrate]')).not.toBeNull()
    expect(referencedRow.querySelector('[data-delete], [data-deactivate]')).toBeNull()
  })

  it('未使用分类删除前要求确认', async () => {
    const unused = { id: 'unused', name: '闲置', emoji: '🧺', color: '#123456', kind: 'expense' as const, active: false }
    const { container } = await render(<FinanceProvider api={createFixtureApi({ categories: [...sampleCategories, unused] })}><LabelsPage /></FinanceProvider>)

    await click(container.querySelector<HTMLElement>('[data-category="unused"] [data-delete]')!)

    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('删除分类')
    await click(container.querySelector<HTMLButtonElement>('[data-confirm-delete]')!)
    expect(container.querySelector('[data-category="unused"]')).toBeNull()
  })

  it('删除要求先停用时保留对话框并显示可恢复提示', async () => {
    const unused = { id: 'unused', name: '闲置', emoji: '🧺', color: '#123456', kind: 'expense' as const, active: false }
    const api = createFixtureApi({ categories: [...sampleCategories, unused] })
    vi.spyOn(api, 'deleteCategory').mockRejectedValue(new FinanceApiError({ code: 'category.delete_requires_inactive', title: '分类尚未停用', detail: 'category.delete_requires_inactive', fieldErrors: [], requestId: '', retryable: false }, 409))
    const { container } = await render(<FinanceProvider api={api}><LabelsPage /></FinanceProvider>)

    await click(container.querySelector<HTMLButtonElement>('[data-category="unused"] [data-delete]')!)
    await click(container.querySelector<HTMLButtonElement>('[data-confirm-delete]')!)

    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    expect(container.querySelector('[role="dialog"] [role="alert"]')?.textContent).toBe('请先停用该分类后再删除')
    expect(container.querySelector('[data-category="unused"]')).not.toBeNull()
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

    await click(container.querySelector<HTMLButtonElement>('[data-category="food"] [data-deactivate]')!)
    await click(container.querySelector<HTMLButtonElement>('[data-category="food"] [data-migrate]')!)

    const target = container.querySelector<HTMLSelectElement>('select[aria-label="迁移至"]')!
    expect([...target.options].map(option => option.value)).toEqual(expect.arrayContaining(['transport']))
    expect([...target.options].map(option => option.value)).not.toContain('salary')
  })

  it('确认对话框初始聚焦取消按钮，循环 Tab，并在 Escape 后归还触发焦点', async () => {
    const unused = { id: 'unused', name: '闲置', emoji: '🧺', color: '#123456', kind: 'expense' as const, active: false }
    const { container } = await render(<FinanceProvider api={createFixtureApi({ categories: [...sampleCategories, unused] })}><LabelsPage /></FinanceProvider>)
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
    const { container } = await render(<FinanceProvider api={createFixtureApi({ categories: [...sampleCategories, unused] })}><LabelsPage /></FinanceProvider>)

    await click(container.querySelector<HTMLButtonElement>('[data-category="unused"] [data-delete]')!)
    await click(container.querySelector<HTMLButtonElement>('[data-confirm-delete]')!)

    expect(document.activeElement).toBe(container.querySelector('#labels-title'))
  })

  it('取消确认对话框后将焦点归还给打开它的按钮', async () => {
    const unused = { id: 'unused', name: '闲置', emoji: '🧺', color: '#123456', kind: 'expense' as const, active: false }
    const { container } = await render(<FinanceProvider api={createFixtureApi({ categories: [...sampleCategories, unused] })}><LabelsPage /></FinanceProvider>)
    const trigger = container.querySelector<HTMLButtonElement>('[data-category="unused"] [data-delete]')!

    await click(trigger)
    await click(container.querySelector<HTMLButtonElement>('[role="dialog"] button')!)

    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('没有同类型启用迁移目标时禁用确认并在对话框说明原因', async () => {
    const onlyExpense = [{ id: 'food', name: '餐饮', emoji: '🍜', color: '#4f8a75', kind: 'expense' as const, active: true }]
    const { container } = await render(<FinanceProvider api={createFixtureApi({ categories: onlyExpense })}><LabelsPage /></FinanceProvider>)

    await click(container.querySelector<HTMLButtonElement>('[data-category="food"] [data-deactivate]')!)
    await click(container.querySelector<HTMLButtonElement>('[data-category="food"] [data-migrate]')!)
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!

    expect(dialog.textContent).toContain('没有可用的同类型启用分类')
    expect(dialog.querySelector<HTMLButtonElement>('[data-confirm-delete]')?.disabled).toBe(true)
  })

  it('迁移成功后在删除触发器不可用时将焦点归还给标题', async () => {
    const { container } = await render(<FinanceProvider><LabelsPage /></FinanceProvider>)

    await click(container.querySelector<HTMLButtonElement>('[data-category="food"] [data-deactivate]')!)
    await click(container.querySelector<HTMLButtonElement>('[data-category="food"] [data-migrate]')!)
    await click(container.querySelector<HTMLButtonElement>('[data-confirm-delete]')!)

    expect(container.querySelector('[data-category="food"]')).toBeNull()
    expect(document.activeElement).toBe(container.querySelector('#labels-title'))
  })

  it('迁移回滚失败时在对话框内保留可恢复提示', async () => {
    const { container } = await render(<FinanceProvider api={createFixtureApi({ fail: { label: true } })}><LabelsPage /></FinanceProvider>)

    await click(container.querySelector<HTMLButtonElement>('[data-category="food"] [data-deactivate]')!)
    await click(container.querySelector<HTMLButtonElement>('[data-category="food"] [data-migrate]')!)
    await click(container.querySelector<HTMLButtonElement>('[data-confirm-delete]')!)

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('请勿关闭页面')
    expect(dialog.getAttribute('aria-describedby')).toContain('label-dialog-error')
    expect(container.querySelector('[data-category="food"]')).toBeTruthy()
  })
})
