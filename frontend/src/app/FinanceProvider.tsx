import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react'
import { createFinanceApi, type FinanceApi } from '../api/financeApi'
import { FinanceApiError, type BootstrapResponse, type TransactionDto } from '../api/types'
import type { AccountLabel, Category, Transaction, TransactionFilter, ViewId } from '../domain/types'
import { previousMonth } from '../domain/selectors'
import { sampleTransactions } from '../domain/sampleData'
import { createInitialFinanceState, financeReducer, type AnalyticsContext, type FinanceState } from './financeReducer'

const UNDO_DURATION = 5000

export interface FinanceProviderProps {
  children: ReactNode
  initialView?: ViewId
  initialFilter?: TransactionFilter
  initialCategories?: Category[]
  initialAccounts?: AccountLabel[]
  api?: FinanceApi
}

export interface FinanceActions {
  changeView(view: ViewId): void
  changeMonth(month: string): void
  openDrawer(): void
  closeDrawer(): void
  openInsight(filter: TransactionFilter): void
  changeFilter(filter: TransactionFilter): void
  clearFilter(): void
  clearDeleted(): void
  changeAnalyticsContext(context: AnalyticsContext): void
  consumeAnalyticsScrollRestore(): void
  addTransaction(transaction: Transaction, options?: { keepDrawerOpen?: boolean; idempotencyKey?: string }): ActionResult
  deleteTransaction(transaction: Transaction): ActionResult
  restoreTransaction(): ActionResult
  createCategory(input: { name: string; kind: Category['kind']; emoji?: string; color?: string }): ActionResult
  createCustomIcon(emoji: string): ActionResult
  updateCategory(id: string, input: { name: string; emoji: string }): ActionResult
  renameCategory(id: string, name: string): ActionResult
  deactivateCategory(id: string): ActionResult
  activateCategory(id: string): ActionResult
  reorderCategories(orderedIds: string[]): ActionResult
  deleteCategory(id: string): ActionResult
  migrateCategory(fromId: string, toId: string): ActionResult
  createAccount(name: string): ActionResult
  renameAccount(id: string, name: string): ActionResult
  deactivateAccount(id: string): ActionResult
  retryDataLoad(panel?: 'bootstrap' | 'transactions' | 'overview' | 'analytics' | 'report'): void
  loadMoreTransactions(): Promise<SaveResult>
}

type SaveResult = { ok: true } | { ok: false; message: string }
type ActionResult = SaveResult | Promise<SaveResult>
interface LabelSnapshot { categories: Category[]; accounts: AccountLabel[] }

const StateContext = createContext<FinanceState | null>(null)
const ActionsContext = createContext<FinanceActions | null>(null)

function apiTransaction(value: TransactionDto): Transaction {
  return {
    id: value.id,
    kind: value.kind,
    amount: Number(value.amount),
    categoryId: value.categoryId ?? '',
    accountId: value.accountId,
    targetAccountId: value.targetAccountId ?? undefined,
    merchant: value.merchant,
    occurredAt: value.occurredAt,
    note: value.note,
  }
}

function apiLabels(value: BootstrapResponse): LabelSnapshot {
  return {
    categories: value.categories.map(item => ({ id: item.id, name: item.name, kind: item.kind, emoji: item.emoji, color: item.color, active: item.active })),
    accounts: value.accounts.map(item => ({ id: item.id, name: item.name, active: item.active })),
  }
}

function apiCategory(value: { id: string; name: string; kind: 'expense' | 'income'; emoji: string; color: string; active: boolean }): Category {
  return { id: value.id, name: value.name, kind: value.kind, emoji: value.emoji, color: value.color, active: value.active }
}

function apiAccount(value: { id: string; name: string; active: boolean }): AccountLabel {
  return { id: value.id, name: value.name, active: value.active }
}

export function FinanceProvider({ children, initialView, initialFilter, initialCategories, initialAccounts, api: injectedApi }: FinanceProviderProps) {
  const activeApi = useMemo(() => injectedApi ?? createFinanceApi(), [injectedApi])
  const [state, dispatch] = useReducer(
    financeReducer,
    undefined,
    (): FinanceState => {
      const fresh = createInitialFinanceState()
      const base = {
        ...fresh,
        view: initialView ?? fresh.view,
        transactions: sampleTransactions,
        categories: initialCategories ?? fresh.categories,
        accounts: initialAccounts ?? fresh.accounts,
        dataStatus: 'loading' as const,
      }
      const withMonth = initialFilter ? financeReducer(base, { type: 'month/changed', month: initialFilter.month }) : base
      return initialFilter ? financeReducer(withMonth, { type: 'filter/changed', filter: initialFilter }) : withMonth
  },
  )
  const transactionsRef = useRef(state.transactions)
  const deletedTransactionRef = useRef(state.deletedTransaction)
  const categoriesRef = useRef(state.categories)
  const accountsRef = useRef(state.accounts)
  const sequenceRef = useRef(0)
  const mountedRef = useRef(true)
  const revisionRef = useRef(state.dataRevision)
  const deletionTokenRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const sequence = ++sequenceRef.current
    dispatch({ type: 'bootstrap/loading', sequence })
    void activeApi.bootstrap({ signal: controller.signal }).then(value => {
      if (!mountedRef.current) return
      const labels = apiLabels(value)
      dispatch({ type: 'bootstrap/succeeded', sequence, value, categories: labels.categories, accounts: labels.accounts, customIcons: value.customIcons ?? [], dataRevision: value.dataRevision })
    }).catch(error => {
      if (!mountedRef.current || controller.signal.aborted) return
      dispatch({ type: 'bootstrap/failed', sequence, message: error instanceof Error ? error.message : '无法加载账本，请重试。' })
    })
    return () => controller.abort()
  }, [activeApi, state.filter, state.transactionCursor, state.transactionsLoadingMore])

  useEffect(() => {
    if (state.bootstrap.status !== 'ready') return undefined
    const controller = new AbortController()
    const sequence = ++sequenceRef.current
    dispatch({ type: 'transactions/request-loading', sequence })
    void activeApi.listTransactions({ ...state.filter, limit: 100 }, { signal: controller.signal }).then(page => {
      if (!mountedRef.current) return
      dispatch({ type: 'transactions/request-succeeded', sequence, value: page, transactions: page.items.map(apiTransaction), dataRevision: page.dataRevision })
    }).catch(error => {
      if (!mountedRef.current || controller.signal.aborted) return
      dispatch({ type: 'transactions/request-failed', sequence, message: error instanceof Error ? error.message : '无法加载交易，请重试。' })
    })
    return () => controller.abort()
  }, [activeApi, state.bootstrap.status, state.month, state.filter, state.refreshGeneration])

  useEffect(() => {
    if (state.bootstrap.status !== 'ready') return undefined
    const controller = new AbortController()
    const sequence = ++sequenceRef.current
    dispatch({ type: 'analytics/request-loading', sequence })
    void activeApi.analytics({ start: state.analytics.startDate, end: state.analytics.endDate, accountId: state.analytics.accountId }, { signal: controller.signal }).then(value => {
      if (mountedRef.current) dispatch({ type: 'analytics/request-succeeded', sequence, value })
    }).catch(error => {
      if (!mountedRef.current || controller.signal.aborted) return
      dispatch({ type: 'analytics/request-failed', sequence, message: error instanceof Error ? error.message : '无法加载分析，请重试。' })
    })
    return () => controller.abort()
  }, [activeApi, state.analytics.startDate, state.analytics.endDate, state.analytics.accountId, state.bootstrap.status, state.refreshGeneration])

  useEffect(() => {
    if (state.bootstrap.status !== 'ready') return undefined
    const controller = new AbortController()
    const sequence = ++sequenceRef.current
    dispatch({ type: 'report/request-loading', sequence })
    void activeApi.monthlyReport({ month: state.month }, { signal: controller.signal }).then(value => {
      if (mountedRef.current) dispatch({ type: 'report/request-succeeded', sequence, value })
    }).catch(error => {
      if (!mountedRef.current || controller.signal.aborted) return
      dispatch({ type: 'report/request-failed', sequence, message: error instanceof Error ? error.message : '无法加载月报，请重试。' })
    })
    return () => controller.abort()
  }, [activeApi, state.month, state.bootstrap.status, state.refreshGeneration])

  useEffect(() => {
    if (state.bootstrap.status !== 'ready') return undefined
    const controller = new AbortController()
    const sequence = ++sequenceRef.current
    dispatch({ type: 'overview/request-loading', sequence })
    void Promise.all([
      activeApi.overview({ month: state.month }, { signal: controller.signal }),
      activeApi.overview({ month: previousMonth(state.month) }, { signal: controller.signal }),
    ]).then(([value, previous]) => {
      const enriched = { ...value, previousSummary: previous.data.summary }
      if (mountedRef.current) dispatch({ type: 'overview/request-succeeded', sequence, value: enriched })
    }).catch(error => {
      if (!mountedRef.current || controller.signal.aborted) return
      dispatch({ type: 'overview/request-failed', sequence, message: error instanceof Error ? error.message : '无法加载总览，请重试。' })
    })
    return () => controller.abort()
  }, [activeApi, state.bootstrap.status, state.month, state.refreshGeneration])

  useEffect(() => {
    transactionsRef.current = state.transactions
    deletedTransactionRef.current = state.deletedTransaction
    categoriesRef.current = state.categories
    accountsRef.current = state.accounts
    revisionRef.current = state.dataRevision
  }, [state.transactions, state.deletedTransaction, state.categories, state.accounts])

  useEffect(() => {
    if (!state.deletedTransaction || !state.deletedTransactionExpiresAt) return undefined

    const remaining = state.deletedTransactionExpiresAt - Date.now()
    if (remaining <= 0) {
      deletedTransactionRef.current = undefined
      dispatch({ type: 'transaction/delete-cleared' })
      return undefined
    }

    const timer = window.setTimeout(() => {
      deletedTransactionRef.current = undefined
      dispatch({ type: 'transaction/delete-cleared' })
    }, remaining)
    return () => window.clearTimeout(timer)
  }, [state.deletedTransaction, state.deletedTransactionExpiresAt])

  const actions = useMemo<FinanceActions>(() => {
    const recoverRevisionConflict = (error: unknown) => {
      if ((error as { code?: unknown })?.code !== 'revision_conflict') return
      const sequence = ++sequenceRef.current
      dispatch({ type: 'bootstrap/loading', sequence })
      void activeApi.bootstrap().then(value => {
        if (!mountedRef.current) return
        const labels = apiLabels(value)
        revisionRef.current = value.dataRevision
        categoriesRef.current = labels.categories
        accountsRef.current = labels.accounts
        dispatch({ type: 'bootstrap/succeeded', sequence, value, categories: labels.categories, accounts: labels.accounts, customIcons: value.customIcons ?? [], dataRevision: value.dataRevision })
      }).catch(recoveryError => {
        if (mountedRef.current) dispatch({ type: 'bootstrap/failed', sequence, message: recoveryError instanceof Error ? recoveryError.message : '无法刷新账本，请重试。' })
      })
    }
    const mutationFailure = (error: unknown, fallback: string): SaveResult => {
      recoverRevisionConflict(error)
      if (error instanceof FinanceApiError) {
        if (error.code === 'label.name_length_invalid') return { ok: false, message: '分类名称长度不符合要求' }
        if (error.code === 'category.in_use') return { ok: false, message: '该分类已有历史记录，请先停用或迁移' }
        if (error.code === 'category.delete_requires_inactive') return { ok: false, message: '请先停用该分类后再删除' }
        if (error.code === 'custom_icon.empty') return { ok: false, message: '请输入自定义图标' }
        if (error.code === 'custom_icon.length_invalid') return { ok: false, message: '自定义图标不能超过 16 个字符' }
        if (error.code === 'custom_icon.duplicate') return { ok: false, message: '该自定义图标已存在' }
      }
      return { ok: false, message: error instanceof Error ? error.message : fallback }
    }
    return ({
    changeView: view => dispatch({ type: 'view/changed', view }),
    changeMonth: month => dispatch({ type: 'month/changed', month }),
    openDrawer: () => dispatch({ type: 'drawer/opened' }),
    closeDrawer: () => dispatch({ type: 'drawer/closed' }),
    openInsight: filter => dispatch({ type: 'insight/opened', filter }),
    changeFilter: filter => dispatch({ type: 'filter/changed', filter }),
    clearFilter: () => dispatch({ type: 'filter/cleared' }),
    changeAnalyticsContext: context => dispatch({ type: 'analytics/context-changed', context }),
    consumeAnalyticsScrollRestore: () => dispatch({ type: 'analytics/scroll-restored' }),
    clearDeleted: () => {
      deletedTransactionRef.current = undefined
      dispatch({ type: 'transaction/delete-cleared' })
    },
    loadMoreTransactions: async () => {
      if (!state.transactionCursor || state.transactionsLoadingMore) return { ok: true }
      dispatch({ type: 'transactions/load-more-started' })
      try {
        const page = await activeApi.listTransactions({ ...state.filter, cursor: state.transactionCursor, limit: 100 })
        if (!mountedRef.current) return { ok: true }
        const existing = new Set(transactionsRef.current.map(item => item.id))
        const appended = page.items.map(apiTransaction).filter(item => !existing.has(item.id))
        transactionsRef.current = [...transactionsRef.current, ...appended]
        revisionRef.current = page.dataRevision
        dispatch({ type: 'transactions/load-more-succeeded', value: page, transactions: transactionsRef.current, dataRevision: page.dataRevision })
        return { ok: true }
      } catch (error) {
        dispatch({ type: 'transactions/load-more-failed', message: error instanceof Error ? error.message : '无法加载更多交易，请重试。' })
        return { ok: false, message: error instanceof Error ? error.message : '无法加载更多交易，请重试。' }
      }
    },
    addTransaction: (transaction, options) => {
      {
        const idempotencyKey = options?.idempotencyKey ?? `entry-${transaction.id}`
        return activeApi.createTransaction({
          kind: transaction.kind,
          amount: transaction.amount.toFixed(2),
          merchant: transaction.merchant,
          categoryId: transaction.categoryId || null,
          accountId: transaction.accountId,
          targetAccountId: transaction.targetAccountId ?? null,
          occurredAt: transaction.occurredAt,
          note: transaction.note,
        }, { revision: revisionRef.current, idempotencyKey }).then(result => {
          if (!mountedRef.current) return { ok: true as const }
          revisionRef.current = result.dataRevision
          dispatch({ type: 'data/revision-updated', dataRevision: result.dataRevision })
          const saved = apiTransaction(result.data)
          transactionsRef.current = [saved, ...transactionsRef.current]
          dispatch({ type: 'transaction/added', transaction: saved, keepDrawerOpen: options?.keepDrawerOpen })
          return { ok: true as const }
        }).catch(error => mutationFailure(error, '保存失败，输入内容已保留。'))
      }
    },
    deleteTransaction: transaction => {
      {
        return activeApi.deleteTransaction(transaction.id, revisionRef.current).then(result => {
          if (!mountedRef.current) return { ok: true as const }
          revisionRef.current = result.dataRevision
          dispatch({ type: 'data/revision-updated', dataRevision: result.dataRevision })
          deletionTokenRef.current = result.data.deletionToken
          const until = Date.parse(result.data.undoUntil)
          deletedTransactionRef.current = transaction
          transactionsRef.current = transactionsRef.current.filter(item => item.id !== transaction.id)
          dispatch({ type: 'transaction/deleted', transaction, expiresAt: Number.isFinite(until) ? until : Date.now() + UNDO_DURATION })
          return { ok: true as const }
        }).catch(error => mutationFailure(error, '删除失败，请重试。'))
      }
    },
    restoreTransaction: () => {
      {
        const deleted = deletedTransactionRef.current
        const token = deletionTokenRef.current
        if (!deleted || !token) return { ok: true as const }
        return activeApi.restoreTransaction(deleted.id, token, revisionRef.current).then(result => {
          if (!mountedRef.current) return { ok: true as const }
          revisionRef.current = result.dataRevision
          dispatch({ type: 'data/revision-updated', dataRevision: result.dataRevision })
          const restored = apiTransaction(result.data)
          transactionsRef.current = [restored, ...transactionsRef.current]
          deletedTransactionRef.current = undefined
          deletionTokenRef.current = undefined
          dispatch({ type: 'transaction/restored' })
          return { ok: true as const }
        }).catch(error => {
          // A failed restore must leave the deletion and a fresh, bounded undo
          // window available for retry; the failed mutation never changes data.
          if (mountedRef.current && deletedTransactionRef.current) {
            dispatch({ type: 'transaction/delete-retry-windowed', expiresAt: Date.now() + UNDO_DURATION })
          }
          return mutationFailure(error, '恢复失败，请重试。')
        })
      }
    },
    createCategory: input => {
      {
        return activeApi.createCategory({ name: input.name.trim(), kind: input.kind, emoji: input.emoji?.trim() || '🏷️', color: input.color?.trim() || '#4f8a75', semanticKey: null, sortOrder: categoriesRef.current.length }, revisionRef.current).then(result => {
          revisionRef.current = result.dataRevision
          dispatch({ type: 'data/revision-updated', dataRevision: result.dataRevision })
          const category = apiCategory(result.data as never)
          categoriesRef.current = [...categoriesRef.current, category]
          dispatch({ type: 'category/created', category })
          return { ok: true as const }
        }).catch(error => mutationFailure(error, '标签保存失败，请重试。'))
      }
    },
    createCustomIcon: emoji => activeApi.createCustomIcon(emoji.trim(), revisionRef.current).then(result => {
      if (!mountedRef.current) return { ok: true as const }
      revisionRef.current = result.dataRevision
      dispatch({ type: 'data/revision-updated', dataRevision: result.dataRevision })
      const value = result.data.trim()
      dispatch({ type: 'custom-icon/created', emoji: value, dataRevision: result.dataRevision })
      return { ok: true as const }
    }).catch(error => mutationFailure(error, '自定义图标保存失败，请重试。')),
    updateCategory: (id, input) => {
      return activeApi.patchCategory(id, { name: input.name.trim(), emoji: input.emoji.trim() }, revisionRef.current).then(result => {
        // 服务端会规范化完整分类；以它为准，避免只更新局部字段造成状态漂移。
        const category = apiCategory(result.data)
        revisionRef.current = result.dataRevision
        categoriesRef.current = categoriesRef.current.map(item => item.id === id ? category : item)
        dispatch({ type: 'data/revision-updated', dataRevision: result.dataRevision })
        dispatch({ type: 'labels/replaced', categories: categoriesRef.current, accounts: accountsRef.current })
        return { ok: true as const }
      }).catch(error => mutationFailure(error, '标签保存失败，请重试。'))
    },
    renameCategory: (id, rawName) => {
      {
        return activeApi.patchCategory(id, { name: rawName.trim() }, revisionRef.current).then(result => {
          revisionRef.current = result.dataRevision
          dispatch({ type: 'data/revision-updated', dataRevision: result.dataRevision })
          dispatch({ type: 'category/renamed', id, name: result.data.name })
          categoriesRef.current = categoriesRef.current.map(item => item.id === id ? { ...item, name: result.data.name } : item)
          return { ok: true as const }
        }).catch(error => mutationFailure(error, '标签保存失败，请重试。'))
      }
    },
    deactivateCategory: id => {
      {
        return activeApi.deactivateCategory(id, revisionRef.current).then(result => {
          revisionRef.current = result.dataRevision
          dispatch({ type: 'data/revision-updated', dataRevision: result.dataRevision })
          dispatch({ type: 'category/deactivated', id })
          categoriesRef.current = categoriesRef.current.map(item => item.id === id ? { ...item, active: false } : item)
          return { ok: true as const }
        }).catch(error => mutationFailure(error, '标签保存失败，请重试。'))
      }
    },
    activateCategory: id => {
      return activeApi.patchCategory(id, { active: true }, revisionRef.current).then(result => {
        revisionRef.current = result.dataRevision
        dispatch({ type: 'data/revision-updated', dataRevision: result.dataRevision })
        const category = apiCategory(result.data)
        categoriesRef.current = categoriesRef.current.map(item => item.id === id ? category : item)
        dispatch({ type: 'labels/replaced', categories: categoriesRef.current, accounts: accountsRef.current })
        return { ok: true as const }
      }).catch(error => mutationFailure(error, '标签保存失败，请重试。'))
    },
    reorderCategories: orderedIds => {
      return activeApi.reorderCategories(orderedIds, revisionRef.current).then(result => {
          revisionRef.current = result.dataRevision
          dispatch({ type: 'data/revision-updated', dataRevision: result.dataRevision })
          dispatch({ type: 'category/reordered', orderedIds: result.data.map(item => item.id) })
          const byId = new Map(categoriesRef.current.map(item => [item.id, item]))
          categoriesRef.current = result.data.map(item => byId.get(item.id) ?? apiCategory(item as never)).filter((item): item is Category => Boolean(item))
          return { ok: true as const }
        }).catch(error => mutationFailure(error, '标签保存失败，请重试。'))
    },
    deleteCategory: id => {
      return activeApi.deleteCategory(id, revisionRef.current).then(result => {
          revisionRef.current = result.dataRevision
          dispatch({ type: 'data/revision-updated', dataRevision: result.dataRevision })
          dispatch({ type: 'category/deleted', id })
          categoriesRef.current = categoriesRef.current.filter(item => item.id !== id)
          return { ok: true as const }
        }).catch(error => mutationFailure(error, '标签保存失败，请重试。'))
    },
    migrateCategory: (fromId, toId) => {
      return activeApi.migrateCategory(fromId, toId, revisionRef.current).then(result => {
          revisionRef.current = result.dataRevision
          dispatch({ type: 'data/revision-updated', dataRevision: result.dataRevision })
          dispatch({ type: 'category/migrated', fromId, toId })
          transactionsRef.current = transactionsRef.current.map(item => item.categoryId === fromId ? { ...item, categoryId: toId } : item)
          categoriesRef.current = categoriesRef.current.filter(item => item.id !== fromId)
          return { ok: true as const }
        }).catch(error => mutationFailure(error, '标签保存失败，请重试。'))
    },
    createAccount: rawName => {
      return activeApi.createAccount(rawName.trim(), revisionRef.current).then(result => {
          revisionRef.current = result.dataRevision
          dispatch({ type: 'data/revision-updated', dataRevision: result.dataRevision })
          dispatch({ type: 'account/created', account: apiAccount(result.data) })
          accountsRef.current = [...accountsRef.current, apiAccount(result.data)]
          return { ok: true as const }
        }).catch(error => mutationFailure(error, '标签保存失败，请重试。'))
    },
    renameAccount: (id, rawName) => {
      return activeApi.patchAccount(id, { name: rawName.trim() }, revisionRef.current).then(result => {
          revisionRef.current = result.dataRevision
          dispatch({ type: 'data/revision-updated', dataRevision: result.dataRevision })
          dispatch({ type: 'account/renamed', id, name: result.data.name })
          accountsRef.current = accountsRef.current.map(item => item.id === id ? { ...item, name: result.data.name } : item)
          return { ok: true as const }
        }).catch(error => mutationFailure(error, '标签保存失败，请重试。'))
    },
    deactivateAccount: id => {
      return activeApi.deactivateAccount(id, revisionRef.current).then(result => {
          revisionRef.current = result.dataRevision
          dispatch({ type: 'data/revision-updated', dataRevision: result.dataRevision })
          dispatch({ type: 'account/deactivated', id })
          accountsRef.current = accountsRef.current.map(item => item.id === id ? { ...item, active: false } : item)
          return { ok: true as const }
        }).catch(error => mutationFailure(error, '标签保存失败，请重试。'))
    },
    retryDataLoad: (panel = 'bootstrap') => {
        const sequence = ++sequenceRef.current
        if (panel === 'transactions') {
          dispatch({ type: 'transactions/request-loading', sequence })
          void activeApi.listTransactions({ ...state.filter, limit: 100 }).then(page => {
            if (!mountedRef.current) return
            revisionRef.current = page.dataRevision
            dispatch({ type: 'transactions/request-succeeded', sequence, value: page, transactions: page.items.map(apiTransaction), dataRevision: page.dataRevision })
          }).catch(error => { if (mountedRef.current) dispatch({ type: 'transactions/request-failed', sequence, message: error instanceof Error ? error.message : '无法加载交易，请重试。' }) })
          return
        }
        if (panel === 'overview' || panel === 'analytics' || panel === 'report') {
          if (panel === 'overview') dispatch({ type: 'overview/request-loading', sequence })
          if (panel === 'analytics') dispatch({ type: 'analytics/request-loading', sequence })
          if (panel === 'report') dispatch({ type: 'report/request-loading', sequence })
          const call = panel === 'overview' ? activeApi.overview({ month: state.month }) : panel === 'analytics' ? activeApi.analytics({ start: state.analytics.startDate, end: state.analytics.endDate, accountId: state.analytics.accountId }) : activeApi.monthlyReport({ month: state.month })
          void call.then(value => {
            if (!mountedRef.current) return
            if (panel === 'overview') dispatch({ type: 'overview/request-succeeded', sequence, value: value as never })
            if (panel === 'analytics') dispatch({ type: 'analytics/request-succeeded', sequence, value: value as never })
            if (panel === 'report') dispatch({ type: 'report/request-succeeded', sequence, value: value as never })
          }).catch(error => {
            if (!mountedRef.current) return
            const message = error instanceof Error ? error.message : '面板加载失败，请重试。'
            if (panel === 'overview') dispatch({ type: 'overview/request-failed', sequence, message })
            if (panel === 'analytics') dispatch({ type: 'analytics/request-failed', sequence, message })
            if (panel === 'report') dispatch({ type: 'report/request-failed', sequence, message })
          })
          return
        }
        dispatch({ type: 'bootstrap/loading', sequence })
        void activeApi.bootstrap().then(value => {
          if (!mountedRef.current) return
          const labels = apiLabels(value)
          revisionRef.current = value.dataRevision
          categoriesRef.current = labels.categories
          accountsRef.current = labels.accounts
          dispatch({ type: 'bootstrap/succeeded', sequence, value, categories: labels.categories, accounts: labels.accounts, customIcons: value.customIcons ?? [], dataRevision: value.dataRevision })
        }).catch(error => {
          if (mountedRef.current) dispatch({ type: 'bootstrap/failed', sequence, message: error instanceof Error ? error.message : '无法加载账本，请重试。' })
        })
        return
    },
    })
  }, [activeApi, state.filter, state.transactionCursor, state.transactionsLoadingMore])

  return (
    <StateContext.Provider value={state}>
      <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>
    </StateContext.Provider>
  )
}

export function useFinance() {
  const state = useContext(StateContext)
  const actions = useContext(ActionsContext)
  if (!state || !actions) throw new Error('useFinance 必须在 FinanceProvider 内使用')
  return { state, actions }
}

export function useFinanceState() {
  const state = useContext(StateContext)
  if (!state) throw new Error('useFinanceState 必须在 FinanceProvider 内使用')
  return state
}

export function useFinanceActions() {
  const actions = useContext(ActionsContext)
  if (!actions) throw new Error('useFinanceActions 必须在 FinanceProvider 内使用')
  return actions
}
