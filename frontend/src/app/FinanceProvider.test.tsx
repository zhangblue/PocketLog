import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { sampleTransactions } from '../domain/sampleData'
import type { Transaction } from '../domain/types'
import { click, render } from '../test/render'
import { FinanceProvider, useFinance } from './FinanceProvider'
import { createTransactionRepository } from '../data/transactionRepository'
import { createLabelRepository } from '../data/labelRepository'

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

  return (
    <>
      <output data-testid="transactions">{state.transactions.map(item => item.id).join(',')}</output>
      <output data-testid="deleted">{state.deletedTransaction?.id ?? ''}</output>
      <output data-testid="result">{result}</output>
      <button type="button" onClick={() => setResult(JSON.stringify(actions.addTransaction(newTransaction)))}>添加</button>
      <button type="button" onClick={() => {
        actions.addTransaction(newTransaction)
        setResult(JSON.stringify(actions.addTransaction(secondTransaction)))
      }}>连续添加</button>
      <button type="button" onClick={() => setResult(JSON.stringify(actions.deleteTransaction(sampleTransactions[0])))}>删除</button>
      <button type="button" onClick={() => setResult(JSON.stringify(actions.restoreTransaction()))}>恢复</button>
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
  return <><output data-testid="invalid-reference-result">{result}</output><output data-testid="invalid-reference-count">{state.transactions.length}</output><button type="button" onClick={() => setResult(JSON.stringify(actions.addTransaction({ ...newTransaction, id: 'bad-reference', categoryId: 'missing' })))}>添加损坏引用</button></>
}

function LabelsProbe() {
  const { actions, state } = useFinance()
  const [result, setResult] = useState('')
  return (
    <>
      <output data-testid="categories">{state.categories.map(item => `${item.id}:${item.name}:${item.active}`).join(',')}</output>
      <output data-testid="label-transactions">{state.transactions.map(item => item.categoryId).join(',')}</output>
      <output data-testid="label-result">{result}</output>
      <button type="button" onClick={() => setResult(JSON.stringify(actions.renameCategory('food', '餐厅')))}>重命名分类</button>
      <button type="button" onClick={() => setResult(JSON.stringify(actions.migrateCategory('food', 'transport')))}>迁移分类</button>
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
      <button type="button" onClick={() => setResult(JSON.stringify(actions.createCategory({ name: '  新增分类  ', kind: 'expense', emoji: '🍚', color: '#123456' })))}>创建分类</button>
      <button type="button" onClick={() => setResult(JSON.stringify(actions.deactivateCategory('entertainment')))}>停用分类</button>
      <button type="button" onClick={() => setResult(JSON.stringify(actions.reorderCategories([...state.categories].map(item => item.id).reverse())))}>排序分类</button>
      <button type="button" onClick={() => setResult(JSON.stringify(actions.createAccount('  旅行钱包  ')))}>创建账户</button>
    </>
  )
}

describe('FinanceProvider', () => {
  it('显式仓储测试装配保持 ready，不经过真实 App 的首次 loading', async () => {
    const repository = { load: () => sampleTransactions, save: () => ({ ok: true } as const) }
    const { container } = await render(<FinanceProvider repository={repository}><MonthProbe /></FinanceProvider>)

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

  it('使用真实 localStorage 保存成功后才加入交易', async () => {
    const { container } = await render(
      <FinanceProvider>
        <FinanceProbe />
      </FinanceProvider>,
    )

    await click(container.querySelector('button')!)

    expect(container.querySelector('[data-testid="result"]')?.textContent).toBe('{"ok":true}')
    expect(JSON.parse(localStorage.getItem('qizhang.transactions.v1') ?? '[]')).toContainEqual(newTransaction)
    expect(container.querySelector('[data-testid="transactions"]')?.textContent?.startsWith('tx-new')).toBe(true)
  })

  it('保存失败时保留当前交易且不改变数组', async () => {
    const storage: Storage = {
      ...localStorage,
      setItem: () => {
        throw new Error('quota exceeded')
      },
    }
    const repository = createTransactionRepository(storage)
    const { container } = await render(
      <FinanceProvider repository={repository}>
        <FinanceProbe />
      </FinanceProvider>,
    )
    const before = container.querySelector('[data-testid="transactions"]')?.textContent

    await click(container.querySelector('button')!)

    expect(container.querySelector('[data-testid="result"]')?.textContent).toBe('{"ok":false,"message":"保存失败，输入内容已保留。"}')
    expect(container.querySelector('[data-testid="transactions"]')?.textContent).toBe(before)
    expect(container.querySelector('[data-testid="transactions"]')?.textContent).not.toContain('tx-new')
  })

  it('同一事件连续添加两笔时 UI 和 localStorage 都保留两笔', async () => {
    const { container } = await render(
      <FinanceProvider>
        <FinanceProbe />
      </FinanceProvider>,
    )

    await click(container.querySelectorAll('button')[1])

    const persisted = JSON.parse(localStorage.getItem('qizhang.transactions.v1') ?? '[]') as Transaction[]
    expect(container.querySelector('[data-testid="transactions"]')?.textContent).toContain('tx-new')
    expect(container.querySelector('[data-testid="transactions"]')?.textContent).toContain('tx-second')
    expect(persisted.map(item => item.id)).toEqual(expect.arrayContaining(['tx-new', 'tx-second']))
  })

  it('删除保存失败时不移除交易也不创建恢复缓存', async () => {
    const storage: Storage = {
      ...localStorage,
      setItem: () => {
        throw new Error('quota exceeded')
      },
    }
    const { container } = await render(
      <FinanceProvider repository={createTransactionRepository(storage)}>
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
    let rejectWrites = false
    const storage: Storage = {
      ...localStorage,
      setItem: (key, value) => {
        if (rejectWrites) throw new Error('quota exceeded')
        localStorage.setItem(key, value)
      },
    }
    const { container } = await render(
      <FinanceProvider repository={createTransactionRepository(storage)}>
        <FinanceProbe />
      </FinanceProvider>,
    )
    const [, , deleteButton, restoreButton] = container.querySelectorAll('button')

    await click(deleteButton)
    const afterDelete = container.querySelector('[data-testid="transactions"]')?.textContent
    rejectWrites = true
    await click(restoreButton)

    expect(container.querySelector('[data-testid="result"]')?.textContent).toBe('{"ok":false,"message":"保存失败，输入内容已保留。"}')
    expect(container.querySelector('[data-testid="transactions"]')?.textContent).toBe(afterDelete)
    expect(container.querySelector('[data-testid="deleted"]')?.textContent).toBe(sampleTransactions[0].id)
  })

  it('删除和恢复仅在真实存储保存成功后改变交易', async () => {
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

  it('启动时从标签仓储加载分类和账户', async () => {
    localStorage.setItem('qizhang.labels.v1', JSON.stringify({
      categories: [
        { id: 'custom-food', name: '自定义餐饮', emoji: '🍚', color: '#123456', kind: 'expense', active: true },
        { id: 'custom-income', name: '自定义收入', emoji: '💰', color: '#345678', kind: 'income', active: true },
      ],
      accounts: [{ id: 'custom-wallet', name: '钱包', active: true }],
    }))
    const { container } = await render(<FinanceProvider><LabelsProbe /></FinanceProvider>)

    expect(container.querySelector('[data-testid="categories"]')?.textContent).toContain('custom-food:自定义餐饮:true')
  })

  it('分类保存成功后才更新状态', async () => {
    const { container } = await render(<FinanceProvider><LabelsProbe /></FinanceProvider>)

    await click(container.querySelectorAll('button')[0])

    expect(container.querySelector('[data-testid="label-result"]')?.textContent).toBe('{"ok":true}')
    expect(container.querySelector('[data-testid="categories"]')?.textContent).toContain('food:餐厅:true')
    expect(JSON.parse(localStorage.getItem('qizhang.labels.v1') ?? '{}').categories.find((item: { id: string }) => item.id === 'food').name).toBe('餐厅')
  })

  it('迁移标签保存失败时回滚交易且不更新界面', async () => {
    let labelWrites = 0
    const storage: Storage = {
      ...localStorage,
      setItem: (key, value) => {
        if (key === 'qizhang.labels.v1') {
          labelWrites += 1
          throw new Error('quota exceeded')
        }
        localStorage.setItem(key, value)
      },
    }
    const { container } = await render(
      <FinanceProvider repository={createTransactionRepository(storage)} labelRepository={createLabelRepository(storage)}><LabelsProbe /></FinanceProvider>,
    )
    const beforeTransactions = container.querySelector('[data-testid="label-transactions"]')?.textContent
    const beforeCategories = container.querySelector('[data-testid="categories"]')?.textContent

    await click(container.querySelectorAll('button')[1])

    expect(labelWrites).toBe(1)
    expect(container.querySelector('[data-testid="label-result"]')?.textContent).toContain('交易已恢复')
    expect(container.querySelector('[data-testid="label-transactions"]')?.textContent).toBe(beforeTransactions)
    expect(container.querySelector('[data-testid="categories"]')?.textContent).toBe(beforeCategories)
  })

  it('通过 Provider 创建、停用和排序分类，并创建账户后持久化真实标签状态', async () => {
    const { container } = await render(<FinanceProvider><ManagementProbe /></FinanceProvider>)
    const [createCategory, deactivateCategory, reorderCategories, createAccount] = container.querySelectorAll('button')

    await click(createCategory)
    expect(container.querySelector('[data-testid="management-result"]')?.textContent).toBe('{"ok":true}')
    expect(container.querySelector('[data-testid="management-categories"]')?.textContent).toContain('新增分类:true')

    await click(deactivateCategory)
    expect(container.querySelector('[data-testid="management-categories"]')?.textContent).toContain('entertainment:娱乐:false')

    const firstBeforeReorder = container.querySelector('[data-testid="management-categories"]')?.textContent?.split(',')[0]
    await click(reorderCategories)
    expect(container.querySelector('[data-testid="management-categories"]')?.textContent?.split(',')[0]).not.toBe(firstBeforeReorder)

    await click(createAccount)
    expect(container.querySelector('[data-testid="management-accounts"]')?.textContent).toContain('旅行钱包:true')
    expect(JSON.parse(localStorage.getItem('qizhang.labels.v1') ?? '{}').accounts.some((account: { name: string }) => account.name === '旅行钱包')).toBe(true)
  })
})
