import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react'
import { createTransactionRepository, validateTransactionReferences, type SaveResult, type TransactionRepository } from '../data/transactionRepository'
import { createLabelRepository, type LabelRepository, type LabelSnapshot } from '../data/labelRepository'
import type { AccountLabel, Category, Transaction, TransactionFilter, ViewId } from '../domain/types'
import { sampleAccounts, sampleCategories, sampleTransactions } from '../domain/sampleData'
import { createInitialFinanceState, financeReducer, type AnalyticsContext, type FinanceState } from './financeReducer'

const UNDO_DURATION = 5000

export interface FinanceProviderProps {
  children: ReactNode
  initialView?: ViewId
  initialFilter?: TransactionFilter
  initialCategories?: Category[]
  initialAccounts?: AccountLabel[]
  repository?: TransactionRepository
  labelRepository?: LabelRepository
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
  addTransaction(transaction: Transaction, options?: { keepDrawerOpen?: boolean }): SaveResult
  deleteTransaction(transaction: Transaction): SaveResult
  restoreTransaction(): SaveResult
  createCategory(input: { name: string; kind: Category['kind']; emoji?: string; color?: string }): SaveResult
  renameCategory(id: string, name: string): SaveResult
  deactivateCategory(id: string): SaveResult
  reorderCategories(orderedIds: string[]): SaveResult
  deleteCategory(id: string): SaveResult
  migrateCategory(fromId: string, toId: string): SaveResult
  createAccount(name: string): SaveResult
  renameAccount(id: string, name: string): SaveResult
  deactivateAccount(id: string): SaveResult
  retryDataLoad(): void
}

const labelFailure = (message = '标签保存失败，请重试。'): SaveResult => ({ ok: false, message })
const transactionFailure = (): SaveResult => ({ ok: false, message: '保存失败，输入内容已保留。' })

function trimmedName(value: string) {
  return value.trim()
}

function duplicateName(items: { id: string; name: string }[], name: string, exceptId?: string) {
  return items.some(item => item.id !== exceptId && item.name.localeCompare(name, 'zh-CN', { sensitivity: 'accent' }) === 0)
}

function uniqueId(prefix: string, existing: { id: string }[]) {
  let id = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  while (existing.some(item => item.id === id)) id = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return id
}

const StateContext = createContext<FinanceState | null>(null)
const ActionsContext = createContext<FinanceActions | null>(null)

function loadTransactions(repository: TransactionRepository) {
  try {
    return repository.loadResult?.() ?? { ok: true as const, data: repository.load(), source: 'storage' as const }
  } catch {
    return { ok: false as const, data: sampleTransactions, message: '无法读取本地交易数据，已安全回退。' }
  }
}

function loadLabels(repository: LabelRepository) {
  try {
    return repository.loadResult?.() ?? { ok: true as const, data: repository.load(), source: 'storage' as const }
  } catch {
    return { ok: false as const, data: { categories: sampleCategories, accounts: sampleAccounts }, message: '无法读取本地标签数据，已安全回退。' }
  }
}

function safeSnapshot(transactions: Transaction[], labels: LabelSnapshot) {
  return validateTransactionReferences(transactions, labels.categories, labels.accounts)
}

export function FinanceProvider({ children, initialView, initialFilter, initialCategories, initialAccounts, repository, labelRepository }: FinanceProviderProps) {
  const activeRepository = useMemo(
    () => repository ?? createTransactionRepository(localStorage),
    [repository],
  )
  const activeLabelRepository = useMemo(
    () => labelRepository ?? createLabelRepository(localStorage),
    [labelRepository],
  )
  const loadOnMount = !repository && !labelRepository && !initialCategories && !initialAccounts
  const [state, dispatch] = useReducer(
    financeReducer,
    undefined,
    (): FinanceState => {
      const fresh = createInitialFinanceState()
      if (loadOnMount) return { ...fresh, view: initialView ?? fresh.view }
      const transactionResult = loadTransactions(activeRepository)
      const labelResult = initialCategories || initialAccounts
        ? { ok: true as const, data: { categories: initialCategories ?? fresh.categories, accounts: initialAccounts ?? fresh.accounts }, source: 'storage' as const }
        : loadLabels(activeLabelRepository)
      const labels = labelResult.data
      const explicitLabelFixtures = Boolean(initialCategories || initialAccounts)
      const valid = transactionResult.ok && labelResult.ok && (explicitLabelFixtures || safeSnapshot(transactionResult.data, labels))
      const base = {
        ...fresh,
        view: initialView ?? fresh.view,
        transactions: valid ? transactionResult.data : sampleTransactions,
        categories: labels.categories,
        accounts: labels.accounts,
        dataStatus: valid ? 'ready' as const : 'error' as const,
        dataError: valid ? undefined : '本地账本数据无法通过完整性校验，已安全回退。',
      }
      const withMonth = initialFilter ? financeReducer(base, { type: 'month/changed', month: initialFilter.month }) : base
      return initialFilter ? financeReducer(withMonth, { type: 'filter/changed', filter: initialFilter }) : withMonth
    },
  )
  const transactionsRef = useRef(state.transactions)
  const deletedTransactionRef = useRef(state.deletedTransaction)
  const categoriesRef = useRef(state.categories)
  const accountsRef = useRef(state.accounts)

  const applyRepositoryLoad = useCallback(() => {
    const transactionResult = loadTransactions(activeRepository)
    const labelResult = loadLabels(activeLabelRepository)
    if (transactionResult.ok && labelResult.ok && safeSnapshot(transactionResult.data, labelResult.data)) {
      dispatch({ type: 'data/load-succeeded', transactions: transactionResult.data, categories: labelResult.data.categories, accounts: labelResult.data.accounts })
      return
    }
    dispatch({
      type: 'data/load-failed',
      message: !transactionResult.ok ? transactionResult.message : !labelResult.ok ? labelResult.message : '本地账本引用不一致，已安全回退。',
      transactions: sampleTransactions,
      categories: sampleCategories,
      accounts: sampleAccounts,
    })
  }, [activeLabelRepository, activeRepository])

  useEffect(() => {
    if (loadOnMount) applyRepositoryLoad()
  }, [applyRepositoryLoad, loadOnMount])

  useEffect(() => {
    transactionsRef.current = state.transactions
    deletedTransactionRef.current = state.deletedTransaction
    categoriesRef.current = state.categories
    accountsRef.current = state.accounts
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

  const actions = useMemo<FinanceActions>(() => ({
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
    addTransaction: (transaction, options) => {
      const nextTransactions = [transaction, ...transactionsRef.current]
      if (!validateTransactionReferences(nextTransactions, categoriesRef.current, accountsRef.current)) return transactionFailure()
      const result = activeRepository.save(nextTransactions)
      if (result.ok) {
        transactionsRef.current = nextTransactions
        dispatch({ type: 'transaction/added', transaction, keepDrawerOpen: options?.keepDrawerOpen })
      }
      return result
    },
    deleteTransaction: transaction => {
      const nextTransactions = transactionsRef.current.filter(item => item.id !== transaction.id)
      const result = activeRepository.save(nextTransactions)
      if (result.ok) {
        transactionsRef.current = nextTransactions
        deletedTransactionRef.current = transaction
        dispatch({ type: 'transaction/deleted', transaction, expiresAt: Date.now() + UNDO_DURATION })
      }
      return result
    },
    restoreTransaction: () => {
      const deletedTransaction = deletedTransactionRef.current
      if (!deletedTransaction) return { ok: true }

      const nextTransactions = [deletedTransaction, ...transactionsRef.current]
      const result = activeRepository.save(nextTransactions)
      if (result.ok) {
        transactionsRef.current = nextTransactions
        deletedTransactionRef.current = undefined
        dispatch({ type: 'transaction/restored' })
      } else {
        dispatch({ type: 'transaction/delete-retry-windowed', expiresAt: Date.now() + UNDO_DURATION })
      }
      return result
    },
    createCategory: input => {
      const name = trimmedName(input.name)
      if (!name) return labelFailure('请输入分类名称。')
      if (duplicateName(categoriesRef.current, name)) return labelFailure('分类名称已存在。')
      const category: Category = {
        id: uniqueId('category', categoriesRef.current),
        name,
        kind: input.kind,
        emoji: input.emoji?.trim() || '🏷️',
        color: input.color?.trim() || '#4f8a75',
        active: true,
      }
      const nextCategories = [...categoriesRef.current, category]
      const result = activeLabelRepository.save({ categories: nextCategories, accounts: accountsRef.current })
      if (result.ok) {
        categoriesRef.current = nextCategories
        dispatch({ type: 'category/created', category })
      }
      return result
    },
    renameCategory: (id, rawName) => {
      const name = trimmedName(rawName)
      const category = categoriesRef.current.find(item => item.id === id)
      if (!category) return labelFailure('分类不存在。')
      if (!name) return labelFailure('请输入分类名称。')
      if (duplicateName(categoriesRef.current, name, id)) return labelFailure('分类名称已存在。')
      const nextCategories = categoriesRef.current.map(item => item.id === id ? { ...item, name } : item)
      const result = activeLabelRepository.save({ categories: nextCategories, accounts: accountsRef.current })
      if (result.ok) {
        categoriesRef.current = nextCategories
        dispatch({ type: 'category/renamed', id, name })
      }
      return result
    },
    deactivateCategory: id => {
      const category = categoriesRef.current.find(item => item.id === id)
      if (!category) return labelFailure('分类不存在。')
      if (!category.active) return { ok: true }
      if (categoriesRef.current.filter(item => item.kind === category.kind && item.active).length <= 1) return labelFailure('请至少保留一个启用分类。')
      const nextCategories = categoriesRef.current.map(item => item.id === id ? { ...item, active: false } : item)
      const result = activeLabelRepository.save({ categories: nextCategories, accounts: accountsRef.current })
      if (result.ok) {
        categoriesRef.current = nextCategories
        dispatch({ type: 'category/deactivated', id })
      }
      return result
    },
    reorderCategories: orderedIds => {
      const knownIds = new Set(categoriesRef.current.map(item => item.id))
      if (orderedIds.length !== categoriesRef.current.length || new Set(orderedIds).size !== orderedIds.length || orderedIds.some(id => !knownIds.has(id))) return labelFailure('分类排序无效。')
      const nextCategories = orderedIds.map(id => categoriesRef.current.find(item => item.id === id)!)
      const result = activeLabelRepository.save({ categories: nextCategories, accounts: accountsRef.current })
      if (result.ok) {
        categoriesRef.current = nextCategories
        dispatch({ type: 'category/reordered', orderedIds })
      }
      return result
    },
    deleteCategory: id => {
      const category = categoriesRef.current.find(item => item.id === id)
      if (!category) return labelFailure('分类不存在。')
      if (transactionsRef.current.some(transaction => transaction.categoryId === id)) return labelFailure('该分类已有历史记录，请迁移后删除。')
      if (category.active && categoriesRef.current.filter(item => item.kind === category.kind && item.active).length <= 1) return labelFailure('请至少保留一个启用分类。')
      const nextCategories = categoriesRef.current.filter(item => item.id !== id)
      const result = activeLabelRepository.save({ categories: nextCategories, accounts: accountsRef.current })
      if (result.ok) {
        categoriesRef.current = nextCategories
        dispatch({ type: 'category/deleted', id })
      }
      return result
    },
    migrateCategory: (fromId, toId) => {
      const source = categoriesRef.current.find(item => item.id === fromId)
      const target = categoriesRef.current.find(item => item.id === toId)
      if (!source || !target) return labelFailure('请选择有效分类。')
      if (source.id === target.id || source.kind !== target.kind || !target.active) return labelFailure('请选择同类型的启用分类。')
      const previousTransactions = transactionsRef.current
      const nextTransactions = previousTransactions.map(transaction => transaction.categoryId === fromId ? { ...transaction, categoryId: toId } : transaction)
      const nextCategories = categoriesRef.current.filter(item => item.id !== fromId)
      const transactionResult = activeRepository.save(nextTransactions)
      if (!transactionResult.ok) return transactionResult
      const labelResult = activeLabelRepository.save({ categories: nextCategories, accounts: accountsRef.current })
      if (!labelResult.ok) {
        const rollback = activeRepository.save(previousTransactions)
        return rollback.ok
          ? labelFailure('分类保存失败，交易已恢复，请重试。')
          : labelFailure('分类保存失败，恢复交易也失败。请勿关闭页面，并在存储恢复后重试。')
      }
      transactionsRef.current = nextTransactions
      categoriesRef.current = nextCategories
      dispatch({ type: 'category/migrated', fromId, toId })
      return { ok: true }
    },
    createAccount: rawName => {
      const name = trimmedName(rawName)
      if (!name) return labelFailure('请输入账户名称。')
      if (duplicateName(accountsRef.current, name)) return labelFailure('账户名称已存在。')
      const account: AccountLabel = { id: uniqueId('account', accountsRef.current), name, active: true }
      const nextAccounts = [...accountsRef.current, account]
      const result = activeLabelRepository.save({ categories: categoriesRef.current, accounts: nextAccounts })
      if (result.ok) {
        accountsRef.current = nextAccounts
        dispatch({ type: 'account/created', account })
      }
      return result
    },
    renameAccount: (id, rawName) => {
      const name = trimmedName(rawName)
      if (!accountsRef.current.some(item => item.id === id)) return labelFailure('账户不存在。')
      if (!name) return labelFailure('请输入账户名称。')
      if (duplicateName(accountsRef.current, name, id)) return labelFailure('账户名称已存在。')
      const nextAccounts = accountsRef.current.map(item => item.id === id ? { ...item, name } : item)
      const result = activeLabelRepository.save({ categories: categoriesRef.current, accounts: nextAccounts })
      if (result.ok) {
        accountsRef.current = nextAccounts
        dispatch({ type: 'account/renamed', id, name })
      }
      return result
    },
    deactivateAccount: id => {
      const account = accountsRef.current.find(item => item.id === id)
      if (!account) return labelFailure('账户不存在。')
      if (!account.active) return { ok: true }
      if (accountsRef.current.filter(item => item.active).length <= 1) return labelFailure('请至少保留一个启用账户。')
      const nextAccounts = accountsRef.current.map(item => item.id === id ? { ...item, active: false } : item)
      const result = activeLabelRepository.save({ categories: categoriesRef.current, accounts: nextAccounts })
      if (result.ok) {
        accountsRef.current = nextAccounts
        dispatch({ type: 'account/deactivated', id })
      }
      return result
    },
    retryDataLoad: () => {
      dispatch({ type: 'data/load-started' })
      applyRepositoryLoad()
    },
  }), [activeRepository, activeLabelRepository, applyRepositoryLoad])

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
