import type { AccountLabel, Category, Transaction, TransactionFilter, ViewId } from '../domain/types'
import { sampleAccounts, sampleCategories, sampleTransactions } from '../domain/sampleData'
import { daysInMonth, isValidCalendarDate, isValidMonth, previousMonth } from '../domain/selectors'

function monthBounds(month: string) {
  return { startDate: `${month}-01`, endDate: `${month}-${String(daysInMonth(month)).padStart(2, '0')}` }
}

function validAnalyticsContext(context: AnalyticsContext) {
  return isValidCalendarDate(context.startDate) && isValidCalendarDate(context.endDate) && context.startDate <= context.endDate && Number.isFinite(context.scrollTop) && context.scrollTop >= 0
}

function validFilter(filter: TransactionFilter) {
  const hasDateRange = Boolean(filter.dateFrom || filter.dateTo)
  return isValidMonth(filter.month)
    && (!hasDateRange || Boolean(filter.dateFrom && filter.dateTo && isValidCalendarDate(filter.dateFrom) && isValidCalendarDate(filter.dateTo) && filter.dateFrom <= filter.dateTo))
    && (!filter.kinds || (filter.kinds.length > 0 && filter.kinds.every(kind => kind === 'expense' || kind === 'income' || kind === 'transfer')))
    && !(filter.kind && filter.kinds)
    && (!filter.weekendOnly || filter.kind === 'expense')
}

export interface AnalyticsContext {
  range: 'month' | 'three-months' | 'custom'
  startDate: string
  endDate: string
  accountId?: string
  scrollTop: number
  scrollRestorePending?: boolean
}

export interface FinanceState {
  view: ViewId
  month: string
  filter: TransactionFilter
  transactions: Transaction[]
  categories: Category[]
  accounts: AccountLabel[]
  drawerOpen: boolean
  analytics: AnalyticsContext
  deletedTransaction?: Transaction
  deletedTransactionExpiresAt?: number
  dataStatus: 'loading' | 'ready' | 'error'
  dataError?: string
}

function localMonth(now: Date) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function createInitialFinanceState(now = new Date()): FinanceState {
  const month = localMonth(now)
  return {
  view: 'overview',
  month,
  filter: { month },
  transactions: sampleTransactions,
  categories: sampleCategories,
  accounts: sampleAccounts,
  drawerOpen: false,
  analytics: { range: 'month', ...monthBounds(month), scrollTop: 0, scrollRestorePending: false },
  dataStatus: 'loading',
  }
}

export const initialFinanceState: FinanceState = createInitialFinanceState()

export type FinanceAction =
  | { type: 'view/changed'; view: ViewId }
  | { type: 'month/changed'; month: string }
  | { type: 'drawer/opened' }
  | { type: 'drawer/closed' }
  | { type: 'transaction/added'; transaction: Transaction; keepDrawerOpen?: boolean }
  | { type: 'transaction/deleted'; transaction: Transaction; expiresAt: number }
  | { type: 'transaction/delete-retry-windowed'; expiresAt: number }
  | { type: 'transaction/restored' }
  | { type: 'transaction/delete-cleared' }
  | { type: 'insight/opened'; filter: TransactionFilter }
  | { type: 'filter/changed'; filter: TransactionFilter }
  | { type: 'filter/cleared' }
  | { type: 'analytics/context-changed'; context: AnalyticsContext }
  | { type: 'analytics/scroll-restored' }
  | { type: 'labels/replaced'; categories: Category[]; accounts: AccountLabel[] }
  | { type: 'category/created'; category: Category }
  | { type: 'category/renamed'; id: string; name: string }
  | { type: 'category/deactivated'; id: string }
  | { type: 'category/reordered'; orderedIds: string[] }
  | { type: 'category/deleted'; id: string }
  | { type: 'category/migrated'; fromId: string; toId: string }
  | { type: 'account/created'; account: AccountLabel }
  | { type: 'account/renamed'; id: string; name: string }
  | { type: 'account/deactivated'; id: string }
  | { type: 'data/load-started' }
  | { type: 'data/load-succeeded'; transactions: Transaction[]; categories: Category[]; accounts: AccountLabel[] }
  | { type: 'data/load-failed'; message: string; transactions: Transaction[]; categories: Category[]; accounts: AccountLabel[] }

export function financeReducer(state: FinanceState, action: FinanceAction): FinanceState {
  if (action.type === 'data/load-started') return { ...state, dataStatus: 'loading', dataError: undefined }
  if (action.type === 'data/load-succeeded') return { ...state, transactions: action.transactions, categories: action.categories, accounts: action.accounts, dataStatus: 'ready', dataError: undefined }
  if (action.type === 'data/load-failed') return { ...state, transactions: action.transactions, categories: action.categories, accounts: action.accounts, dataStatus: 'error', dataError: action.message }
  if (action.type === 'view/changed') return { ...state, view: action.view }
  if (action.type === 'month/changed') {
    if (!isValidMonth(action.month)) return state
    const analytics = state.analytics.range === 'custom'
      ? state.analytics
      : state.analytics.range === 'three-months'
        ? { ...state.analytics, startDate: `${previousMonth(previousMonth(action.month))}-01`, endDate: monthBounds(action.month).endDate }
        : { ...state.analytics, ...monthBounds(action.month) }
    return { ...state, month: action.month, filter: { month: action.month }, analytics }
  }
  if (action.type === 'drawer/opened') return { ...state, drawerOpen: true }
  if (action.type === 'drawer/closed') return { ...state, drawerOpen: false }
  if (action.type === 'transaction/added') {
    return { ...state, transactions: [action.transaction, ...state.transactions], drawerOpen: action.keepDrawerOpen ? state.drawerOpen : false }
  }
  if (action.type === 'transaction/deleted') {
    return {
      ...state,
      transactions: state.transactions.filter(item => item.id !== action.transaction.id),
      deletedTransaction: action.transaction,
      deletedTransactionExpiresAt: action.expiresAt,
    }
  }
  if (action.type === 'transaction/restored' && state.deletedTransaction) {
    return { ...state, transactions: [state.deletedTransaction, ...state.transactions], deletedTransaction: undefined, deletedTransactionExpiresAt: undefined }
  }
  if (action.type === 'transaction/delete-retry-windowed' && state.deletedTransaction) {
    return { ...state, deletedTransactionExpiresAt: action.expiresAt }
  }
  if (action.type === 'transaction/delete-cleared') return { ...state, deletedTransaction: undefined, deletedTransactionExpiresAt: undefined }
  if (action.type === 'insight/opened') return validFilter(action.filter) ? { ...state, view: 'transactions', filter: action.filter } : state
  if (action.type === 'filter/changed') return validFilter(action.filter) ? { ...state, filter: action.filter } : state
  if (action.type === 'filter/cleared') return { ...state, filter: { month: state.month } }
  if (action.type === 'analytics/context-changed') return validAnalyticsContext(action.context) ? { ...state, analytics: action.context } : state
  if (action.type === 'analytics/scroll-restored') return { ...state, analytics: { ...state.analytics, scrollRestorePending: false } }
  if (action.type === 'labels/replaced') return { ...state, categories: action.categories, accounts: action.accounts }
  if (action.type === 'category/created') return { ...state, categories: [...state.categories, action.category] }
  if (action.type === 'category/renamed') {
    return { ...state, categories: state.categories.map(category => category.id === action.id ? { ...category, name: action.name } : category) }
  }
  if (action.type === 'category/deactivated') {
    return { ...state, categories: state.categories.map(category => category.id === action.id ? { ...category, active: false } : category) }
  }
  if (action.type === 'category/reordered') {
    const byId = new Map(state.categories.map(category => [category.id, category]))
    const specified = action.orderedIds.flatMap(id => {
      const category = byId.get(id)
      return category ? [category] : []
    })
    const specifiedIds = new Set(specified.map(category => category.id))
    return { ...state, categories: [...specified, ...state.categories.filter(category => !specifiedIds.has(category.id))] }
  }
  if (action.type === 'category/deleted') return { ...state, categories: state.categories.filter(category => category.id !== action.id) }
  if (action.type === 'category/migrated') {
    const source = state.categories.find(category => category.id === action.fromId)
    const target = state.categories.find(category => category.id === action.toId)
    if (!source || !target || source.kind !== target.kind || !target.active || source.id === target.id) return state
    return {
      ...state,
      transactions: state.transactions.map(transaction => transaction.categoryId === source.id ? { ...transaction, categoryId: target.id } : transaction),
      categories: state.categories.filter(category => category.id !== source.id),
    }
  }
  if (action.type === 'account/created') return { ...state, accounts: [...state.accounts, action.account] }
  if (action.type === 'account/renamed') {
    return { ...state, accounts: state.accounts.map(account => account.id === action.id ? { ...account, name: action.name } : account) }
  }
  if (action.type === 'account/deactivated') {
    return { ...state, accounts: state.accounts.map(account => account.id === action.id ? { ...account, active: false } : account) }
  }
  return state
}
