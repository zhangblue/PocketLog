import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { FinanceApiError } from '../api/types'
import { sampleTransactions } from '../domain/sampleData'
import type { Transaction } from '../domain/types'
import { click, render } from '../test/render'
import { FinanceProvider, useFinance } from './FinanceProvider'
import { createFixtureApi } from '../test/financeApi'

const newTransaction: Transaction = {
  id: 'tx-new',
  kind: 'expense',
  amount: 25,
  categoryId: 'food',
  accountId: 'wechat',
  merchant: '测试餐馆',
  occurredAt: '2026-08-18T12:00:00+08:00',
  note: '午餐',
}

const secondTransaction: Transaction = {
  ...newTransaction,
  id: 'tx-second',
  merchant: '第二笔测试餐馆',
}

function FinanceProbe() {
  const { actions, state } = useFinance()
  const [result, setResult] = useState('')
  const run = async (action: ReturnType<typeof actions.addTransaction>) => setResult(JSON.stringify(await action))

  return (
    <>
      <output data-testid="transactions">{state.transactions.map(item => item.id).join(',')}</output>
      <output data-testid="deleted">{state.deletedTransaction?.id ?? ''}</output>
      <output data-testid="result">{result}</output>
      <button type="button" onClick={() => void run(actions.addTransaction(newTransaction))}>添加</button>
      <button type="button" onClick={() => {
        void run(actions.addTransaction(newTransaction))
        void run(actions.addTransaction(secondTransaction))
      }}>连续添加</button>
      <button type="button" onClick={() => void run(actions.deleteTransaction(sampleTransactions[0]))}>删除</button>
      <button type="button" onClick={() => void run(actions.restoreTransaction())}>恢复</button>
    </>
  )
}

function MonthProbe() {
  const { state } = useFinance()
  return <output data-testid="month-state">{JSON.stringify({ month: state.month, analytics: state.analytics, dataStatus: state.dataStatus })}</output>
}

function InvalidReferenceProbe() {
  const { actions, state } = useFinance()
  const [result, setResult] = useState('')
  return <><output data-testid="invalid-reference-result">{result}</output><output data-testid="invalid-reference-count">{state.transactions.length}</output><button type="button" onClick={() => void Promise.resolve(actions.addTransaction({ ...newTransaction, id: 'bad-reference', categoryId: 'missing' })).then(value => setResult(JSON.stringify(value))) }>添加损坏引用</button></>
}

function LabelsProbe() {
  const { actions, state } = useFinance()
  const [result, setResult] = useState('')
  return (
    <>
      <output data-testid="categories">{state.categories.map(item => `${item.id}:${item.name}:${item.active}`).join(',')}</output>
      <output data-testid="category-details">{state.categories.map(item => `${item.id}:${item.name}:${item.emoji}:${item.color}:${item.active}`).join(',')}</output>
      <output data-testid="category-revision">{state.dataRevision}</output>
      <output data-testid="label-transactions">{state.transactions.map(item => item.categoryId).join(',')}</output>
      <output data-testid="label-result">{result}</output>
      <button type="button" onClick={() => void Promise.resolve(actions.renameCategory('food', '餐厅')).then(value => setResult(JSON.stringify(value)))}>重命名分类</button>
      <button type="button" onClick={() => void Promise.resolve(actions.updateCategory('food', { name: '美食', emoji: '🪐' })).then(value => setResult(JSON.stringify(value)))}>更新分类</button>
      <button type="button" onClick={() => void Promise.resolve(actions.migrateCategory('food', 'transport')).then(value => setResult(JSON.stringify(value)))}>迁移分类</button>
    </>
  )
}

function ManagementProbe() {
  const { actions, state } = useFinance()
  const [result, setResult] = useState('')
  return (
    <>
      <output data-testid="management-categories">{state.categories.map(item => `${item.id}:${item.name}:${item.active}`).join(',')}</output>
      <output data-testid="management-accounts">{state.accounts.map(item => `${item.id}:${item.name}:${item.active}`).join(',')}</output>
      <output data-testid="management-result">{result}</output>
      <button type="button" onClick={() => void Promise.resolve(actions.createCategory({ name: '  新增分类  ', kind: 'expense', emoji: '🍚', color: '#123456' })).then(value => setResult(JSON.stringify(value)))}>创建分类</button>
      <button type="button" onClick={() => void Promise.resolve(actions.deactivateCategory('entertainment')).then(value => setResult(JSON.stringify(value)))}>停用分类</button>
      <button type="button" onClick={() => void Promise.resolve(actions.activateCategory('entertainment')).then(value => setResult(JSON.stringify(value)))}>启用分类</button>
      <button type="button" onClick={() => void Promise.resolve(actions.reorderCategories([...state.categories].map(item => item.id).reverse())).then(value => setResult(JSON.stringify(value)))}>排序分类</button>
      <button type="button" onClick={() => void Promise.resolve(actions.createAccount('  旅行钱包  ')).then(value => setResult(JSON.stringify(value)))}>创建账户</button>
    </>
  )
}

function CategoryErrorProbe() {
  const { actions } = useFinance()
  const [result, setResult] = useState('')
  return <><output data-testid="category-error-result">{result}</output><button type="button" onClick={() => void Promise.resolve(actions.createCategory({ name: '过长分类', kind: 'expense' })).then(value => setResult(JSON.stringify(value)))}>创建无效分类</button></>
}

function FilterProbe() {
  const { actions } = useFinance()
  return <button type="button" onClick={() => actions.changeFilter({ month: '2026-08', kind: 'expense' })}>筛选支出</button>
}

describe('FinanceProvider', () => {
  it('变更筛选时不重新加载 bootstrap 数据', async () => {
    const api = createFixtureApi()
    const bootstrap = vi.spyOn(api, 'bootstrap')
    const { container } = await render(<FinanceProvider api={api}><FilterProbe /></FinanceProvider>)

    expect(bootstrap).toHaveBeenCalledTimes(1)

    await click(container.querySelector('button')!)

    expect(bootstrap).toHaveBeenCalledTimes(1)
  })

  it('显式 API 测试装配保持 ready，不经过真实 App 的首次 loading', async () => {
    const { container } = await render(<FinanceProvider api={createFixtureApi({ transactions: sampleTransactions })}><MonthProbe /></FinanceProvider>)

    expect(JSON.parse(container.querySelector('[data-testid="month-state"]')?.textContent ?? '{}').dataStatus).toBe('ready')
  })

  it('Provider 保存时拒绝不存在或类型不匹配的分类账户引用', async () => {
    const { container } = await render(<FinanceProvider><InvalidReferenceProbe /></FinanceProvider>)
    const before = container.querySelector('[data-testid="invalid-reference-count"]')?.textContent

    await click(container.querySelector('button')!)

    expect(container.querySelector('[data-testid="invalid-reference-result"]')?.textContent).toContain('ok":false')
    expect(container.querySelector('[data-testid="invalid-reference-count"]')?.textContent).toBe(before)
  })

  it('初始筛选只接受合法月份，并同步本月分析边界', async () => {
    const { container } = await render(<FinanceProvider initialFilter={{ month: '2026-07' }}><MonthProbe /></FinanceProvider>)
    expect(JSON.parse(container.querySelector('[data-testid="month-state"]')?.textContent ?? '{}')).toMatchObject({ month: '2026-07', analytics: { startDate: '2026-07-01', endDate: '2026-07-31' } })

    const invalid = await render(<FinanceProvider initialFilter={{ month: '2026-13' }}><MonthProbe /></FinanceProvider>)
    expect(JSON.parse(invalid.container.querySelector('[data-testid="month-state"]')?.textContent ?? '{}').month).toBe('2026-08')
  })

  it('使用 API 保存成功后才加入交易', async () => {
    const { container } = await render(
      <FinanceProvider>
        <FinanceProbe />
      </FinanceProvider>,
    )

    await click(container.querySelector('button')!)

    expect(container.querySelector('[data-testid="result"]')?.textContent).toBe('{"ok":true}')
    expect(container.querySelector('[data-testid="transactions"]')?.textContent).toContain('fixture-')
  })

  it('保存失败时保留当前交易且不改变数组', async () => {
    const { container } = await render(
      <FinanceProvider api={createFixtureApi({ fail: { create: true } })}>
        <FinanceProbe />
      </FinanceProvider>,
    )
    const before = container.querySelector('[data-testid="transactions"]')?.textContent

    await click(container.querySelector('button')!)

    expect(container.querySelector('[data-testid="result"]')?.textContent).toBe('{"ok":false,"message":"保存失败，输入内容已保留。"}')
    expect(container.querySelector('[data-testid="transactions"]')?.textContent).toBe(before)
    expect(container.querySelector('[data-testid="transactions"]')?.textContent).not.toContain('tx-new')
  })

  it('同一事件连续添加两笔时 UI 保留两笔', async () => {
    const { container } = await render(
      <FinanceProvider>
        <FinanceProbe />
      </FinanceProvider>,
    )

    await click(container.querySelectorAll('button')[1])

    expect(container.querySelector('[data-testid="transactions"]')?.textContent).toContain('fixture-')
    expect(container.querySelector('[data-testid="transactions"]')?.textContent?.match(/fixture-/g)?.length).toBe(2)
  })

  it('删除保存失败时不移除交易也不创建恢复缓存', async () => {
    const { container } = await render(
      <FinanceProvider api={createFixtureApi({ fail: { delete: true } })}>
        <FinanceProbe />
      </FinanceProvider>,
    )
    const before = container.querySelector('[data-testid="transactions"]')?.textContent

    await click(container.querySelectorAll('button')[2])

    expect(container.querySelector('[data-testid="result"]')?.textContent).toBe('{"ok":false,"message":"保存失败，输入内容已保留。"}')
    expect(container.querySelector('[data-testid="transactions"]')?.textContent).toBe(before)
    expect(container.querySelector('[data-testid="deleted"]')?.textContent).toBe('')
  })

  it('恢复保存失败时保留删除后的集合和恢复缓存', async () => {
    const { container } = await render(
      <FinanceProvider api={createFixtureApi({ fail: { restore: true } })}>
        <FinanceProbe />
      </FinanceProvider>,
    )
    const [, , deleteButton, restoreButton] = container.querySelectorAll('button')

    await click(deleteButton)
    const afterDelete = container.querySelector('[data-testid="transactions"]')?.textContent
    await click(restoreButton)

    expect(container.querySelector('[data-testid="result"]')?.textContent).toBe('{"ok":false,"message":"保存失败，输入内容已保留。"}')
    expect(container.querySelector('[data-testid="transactions"]')?.textContent).toBe(afterDelete)
    expect(container.querySelector('[data-testid="deleted"]')?.textContent).toBe(sampleTransactions[0].id)
  })

  it('删除和恢复仅在 API 保存成功后改变交易', async () => {
    const { container } = await render(
      <FinanceProvider>
        <FinanceProbe />
      </FinanceProvider>,
    )
    const [, , deleteButton, restoreButton] = container.querySelectorAll('button')

    await click(deleteButton)
    expect(container.querySelector('[data-testid="result"]')?.textContent).toBe('{"ok":true}')
    expect(container.querySelector('[data-testid="transactions"]')?.textContent).not.toContain(sampleTransactions[0].id)
    await click(restoreButton)
    expect(container.querySelector('[data-testid="result"]')?.textContent).toBe('{"ok":true}')
    expect(container.querySelector('[data-testid="transactions"]')?.textContent?.startsWith(sampleTransactions[0].id)).toBe(true)
  })

  it('启动时从 API 加载分类和账户', async () => {
    const categories = [
      { id: 'custom-food', name: '自定义餐饮', emoji: '🍚', color: '#123456', kind: 'expense' as const, active: true },
      { id: 'custom-income', name: '自定义收入', emoji: '💰', color: '#345678', kind: 'income' as const, active: true },
    ]
    const accounts = [{ id: 'custom-wallet', name: '钱包', active: true }]
    const { container } = await render(<FinanceProvider api={createFixtureApi({ categories, accounts })}><LabelsProbe /></FinanceProvider>)

    expect(container.querySelector('[data-testid="categories"]')?.textContent).toContain('custom-food:自定义餐饮:true')
  })

  it('分类保存成功后才更新状态', async () => {
    const { container } = await render(<FinanceProvider><LabelsProbe /></FinanceProvider>)

    await click(container.querySelectorAll('button')[0])

    expect(container.querySelector('[data-testid="label-result"]')?.textContent).toBe('{"ok":true}')
    expect(container.querySelector('[data-testid="categories"]')?.textContent).toContain('food:餐厅:true')
  })

  it('将分类名称长度错误映射为友好提示', async () => {
    const api = createFixtureApi()
    vi.spyOn(api, 'createCategory').mockRejectedValue(new FinanceApiError({ code: 'label.name_length_invalid', title: '校验失败', detail: 'label.name_length_invalid', fieldErrors: [], requestId: '', retryable: false }, 422))
    const { container } = await render(<FinanceProvider api={api}><CategoryErrorProbe /></FinanceProvider>)

    await click(container.querySelector('button')!)

    expect(container.querySelector('[data-testid="category-error-result"]')?.textContent).toBe('{"ok":false,"message":"分类名称长度不符合要求"}')
  })

  it('更新分类时以 API 返回的完整分类和 dataRevision 替换本地状态', async () => {
    const api = createFixtureApi()
    vi.spyOn(api, 'patchCategory').mockResolvedValue({ data: { id: 'food', name: '美食', emoji: '🪐', color: '#765432', kind: 'expense', active: false, semanticKey: 'food', sortOrder: 9 }, dataRevision: 42 })
    const { container } = await render(<FinanceProvider api={api}><LabelsProbe /></FinanceProvider>)

    await click(container.querySelectorAll('button')[1])

    expect(container.querySelector('[data-testid="label-result"]')?.textContent).toBe('{"ok":true}')
    expect(container.querySelector('[data-testid="category-details"]')?.textContent).toContain('food:美食:🪐:#765432:false')
    expect(container.querySelector('[data-testid="category-revision"]')?.textContent).toBe('42')
  })

  it('更新分类请求失败时不污染现有分类状态', async () => {
    const api = createFixtureApi()
    vi.spyOn(api, 'patchCategory').mockRejectedValue(new Error('标签保存失败，请重试。'))
    const { container } = await render(<FinanceProvider api={api}><LabelsProbe /></FinanceProvider>)
    const before = container.querySelector('[data-testid="categories"]')?.textContent

    await click(container.querySelectorAll('button')[1])

    expect(container.querySelector('[data-testid="label-result"]')?.textContent).toBe('{"ok":false,"message":"标签保存失败，请重试。"}')
    expect(container.querySelector('[data-testid="categories"]')?.textContent).toBe(before)
  })

  it('迁移标签保存失败时回滚交易且不更新界面', async () => {
    const { container } = await render(
      <FinanceProvider api={createFixtureApi({ fail: { label: true } })}><LabelsProbe /></FinanceProvider>,
    )
    const beforeTransactions = container.querySelector('[data-testid="label-transactions"]')?.textContent
    const beforeCategories = container.querySelector('[data-testid="categories"]')?.textContent

    await click(container.querySelectorAll('button')[2])

    expect(container.querySelector('[data-testid="label-result"]')?.textContent).toContain('迁移尚未完成')
    expect(container.querySelector('[data-testid="label-transactions"]')?.textContent).toBe(beforeTransactions)
    expect(container.querySelector('[data-testid="categories"]')?.textContent).toBe(beforeCategories)
  })

  it('通过 Provider 创建、停用、启用和排序分类，并创建账户后更新真实标签状态', async () => {
    const api = createFixtureApi()
    const patchCategory = vi.spyOn(api, 'patchCategory')
    const { container } = await render(<FinanceProvider api={api}><ManagementProbe /></FinanceProvider>)
    const [createCategory, deactivateCategory, activateCategory, reorderCategories, createAccount] = container.querySelectorAll('button')

    await click(createCategory)
    expect(container.querySelector('[data-testid="management-result"]')?.textContent).toBe('{"ok":true}')
    expect(container.querySelector('[data-testid="management-categories"]')?.textContent).toContain('新增分类:true')

    await click(deactivateCategory)
    expect(container.querySelector('[data-testid="management-categories"]')?.textContent).toContain('entertainment:娱乐:false')

    await click(activateCategory)
    expect(container.querySelector('[data-testid="management-result"]')?.textContent).toBe('{"ok":true}')
    expect(container.querySelector('[data-testid="management-categories"]')?.textContent).toContain('entertainment:娱乐:true')
    expect(patchCategory).toHaveBeenCalledWith('entertainment', { active: true }, expect.any(Number))

    const firstBeforeReorder = container.querySelector('[data-testid="management-categories"]')?.textContent?.split(',')[0]
    await click(reorderCategories)
    expect(container.querySelector('[data-testid="management-categories"]')?.textContent?.split(',')[0]).not.toBe(firstBeforeReorder)

    await click(createAccount)
    expect(container.querySelector('[data-testid="management-accounts"]')?.textContent).toContain('旅行钱包:true')
  })
})
