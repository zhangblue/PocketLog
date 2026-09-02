import { describe, expect, it } from 'vitest'
import { sampleCategories, sampleTransactions } from '../domain/sampleData'
import { createInitialFinanceState, financeReducer, initialFinanceState } from './financeReducer'

describe('financeReducer', () => {
  it('默认月份和分析边界来自真实本地当前时间', () => {
    const state = createInitialFinanceState(new Date(2031, 1, 3, 4, 5))

    expect(state.month).toBe('2031-02')
    expect(state.filter.month).toBe('2031-02')
    expect(state.analytics).toMatchObject({ startDate: '2031-02-01', endDate: '2031-02-28' })
    expect(state.dataStatus).toBe('loading')
  })

  it('首次加载不展示样例账本数据', () => {
    const state = createInitialFinanceState(new Date(2026, 7, 18, 12, 0))

    expect(state.transactions).toEqual([])
    expect(state.categories).toEqual([])
    expect(state.accounts).toEqual([])
  })

  it('洞察下钻同时切换页面和筛选', () => {
    const next = financeReducer(initialFinanceState, {
      type: 'insight/opened',
      filter: { month: '2026-08', categoryId: 'transport', sourceLabel: '周末交通支出偏高' },
    })

    expect(next.view).toBe('transactions')
    expect(next.filter).toEqual({ month: '2026-08', categoryId: 'transport', sourceLabel: '周末交通支出偏高' })
  })

  it('切换月份时重置筛选到新月份', () => {
    const state = {
      ...initialFinanceState,
      filter: { month: '2026-08', categoryId: 'food' },
    }

    const next = financeReducer(state, { type: 'month/changed', month: '2026-07' })

    expect(next.month).toBe('2026-07')
    expect(next.filter).toEqual({ month: '2026-07' })
  })

  it('拒绝空值或不存在的月份，保持有效全局月份', () => {
    expect(financeReducer(initialFinanceState, { type: 'month/changed', month: '' })).toBe(initialFinanceState)
    expect(financeReducer(initialFinanceState, { type: 'month/changed', month: '2026-13' })).toBe(initialFinanceState)
  })

  it('持久保存分析范围、账户和滚动位置以供下钻返回', () => {
    const next = financeReducer(initialFinanceState, {
      type: 'analytics/context-changed',
      context: { range: 'custom', startDate: '2026-07-01', endDate: '2026-08-18', accountId: 'wechat', scrollTop: 240 },
    })

    expect(next.analytics).toEqual({ range: 'custom', startDate: '2026-07-01', endDate: '2026-08-18', accountId: 'wechat', scrollTop: 240 })
  })

  it('切换全局月份时为近 3 月重新锚定范围，并拒绝非法分析日期', () => {
    const threeMonths = { ...initialFinanceState, analytics: { ...initialFinanceState.analytics, range: 'three-months' as const, startDate: '2026-06-01', endDate: '2026-08-31' } }
    expect(financeReducer(threeMonths, { type: 'month/changed', month: '2026-09' }).analytics).toMatchObject({ startDate: '2026-07-01', endDate: '2026-09-30' })
    expect(financeReducer(initialFinanceState, { type: 'analytics/context-changed', context: { ...initialFinanceState.analytics, range: 'custom', startDate: '2026-02-30', endDate: '2026-03-01' } })).toBe(initialFinanceState)
  })

  it('添加交易并关闭抽屉', () => {
    const transaction = sampleTransactions[0]
    const next = financeReducer(
      { ...initialFinanceState, transactions: [], drawerOpen: true },
      { type: 'transaction/added', transaction },
    )

    expect(next.transactions).toEqual([transaction])
    expect(next.drawerOpen).toBe(false)
  })

  it('保存并继续添加交易时保持抽屉打开', () => {
    const transaction = sampleTransactions[0]
    const next = financeReducer(
      { ...initialFinanceState, transactions: [], drawerOpen: true },
      { type: 'transaction/added', transaction, keepDrawerOpen: true },
    )

    expect(next.transactions).toEqual([transaction])
    expect(next.drawerOpen).toBe(true)
  })

  it('拒绝低版本的加载更多响应，避免回退交易分页状态', () => {
    const state = { ...initialFinanceState, dataRevision: 5, transactionCursor: 'next', transactionsLoadingMore: true }
    const page = { items: [], nextCursor: 'older', dataRevision: 4 }
    const next = financeReducer(state, { type: 'transactions/load-more-succeeded', value: page, transactions: [], dataRevision: 4 })

    expect(next).toBe(state)
  })

  it('删除交易时从交易数组移除并缓存以供恢复', () => {
    const transaction = sampleTransactions[0]
    const deleted = financeReducer(
      { ...initialFinanceState, transactions: [transaction] },
      { type: 'transaction/deleted', transaction, expiresAt: 5000 },
    )

    expect(deleted.transactions).toEqual([])
    expect(deleted.deletedTransaction).toEqual(transaction)
    expect(deleted.deletedTransactionExpiresAt).toBe(5000)
  })

  it('恢复最近删除的交易并清除删除缓存', () => {
    const transaction = sampleTransactions[0]
    const deleted = financeReducer(
      { ...initialFinanceState, transactions: [transaction] },
      { type: 'transaction/deleted', transaction, expiresAt: 5000 },
    )
    const restored = financeReducer(deleted, { type: 'transaction/restored' })

    expect(restored.transactions).toEqual([transaction])
    expect(restored.deletedTransaction).toBeUndefined()
  })

  it('迁移分类时更新所有引用并删除旧分类', () => {
    const state = {
      ...initialFinanceState,
      categories: sampleCategories,
      transactions: [
        { ...sampleTransactions[0], categoryId: 'food' },
        { ...sampleTransactions[1], categoryId: 'transport' },
      ],
    }

    const next = financeReducer(state, { type: 'category/migrated', fromId: 'food', toId: 'transport' })

    expect(next.transactions.map(item => item.categoryId)).toEqual(['transport', 'transport'])
    expect(next.categories.some(item => item.id === 'food')).toBe(false)
  })

  it('排序动作只按给定 ID 重排，不丢失未指定分类', () => {
    const state = { ...initialFinanceState, categories: sampleCategories }
    const next = financeReducer(state, {
      type: 'category/reordered',
      orderedIds: ['salary', 'food'],
    })

    expect(next.categories.slice(0, 2).map(item => item.id)).toEqual(['salary', 'food'])
    expect(next.categories).toHaveLength(sampleCategories.length)
  })

  it('mutation revision 只接受更新版本并触发面板刷新代次', () => {
    const next = financeReducer(initialFinanceState, { type: 'data/revision-updated', dataRevision: 3 })
    expect(next.dataRevision).toBe(3)
    expect(next.refreshGeneration).toBe(1)
    expect(financeReducer(next, { type: 'data/revision-updated', dataRevision: 2 })).toBe(next)
  })
})
