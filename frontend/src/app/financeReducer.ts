import type { AccountLabel, Category, Transaction, TransactionFilter, ViewId } from '../domain/types'
import { daysInMonth, isValidCalendarDate, isValidMonth, previousMonth } from '../domain/selectors'
import type { BootstrapResponse, OverviewResponse, MonthlyReportResponse, TransactionsResponse } from '../api/types'

export interface AsyncState<T> {
  status: 'idle' | 'loading' | 'ready' | 'error'
  value?: T
  error?: string
  stale?: boolean
}

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
  customIcons: string[]
  drawerOpen: boolean
  analytics: AnalyticsContext
  deletedTransaction?: Transaction
  deletedTransactionExpiresAt?: number
  dataStatus: 'loading' | 'ready' | 'error'
  dataError?: string
  bootstrap: AsyncState<BootstrapResponse>
  overview: AsyncState<OverviewResponse>
  analyticsState: AsyncState<OverviewResponse>
  report: AsyncState<MonthlyReportResponse>
  transactionsRequest: AsyncState<TransactionsResponse>
  transactionCursor?: string | null
  transactionsLoadingMore: boolean
  dataRevision: number
  refreshGeneration: number
  requestSequence: Record<string, number>
  pendingDeletions: Array<{ id: string; token: string; undoUntil: string }>
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
  transactions: [],
  categories: [],
  accounts: [],
  customIcons: [],
  drawerOpen: false,
  analytics: { range: 'month', ...monthBounds(month), scrollTop: 0, scrollRestorePending: false },
    dataStatus: 'loading',
    bootstrap: { status: 'idle' },
    overview: { status: 'idle' },
    analyticsState: { status: 'idle' },
    report: { status: 'idle' },
    transactionsRequest: { status: 'idle' },
    transactionCursor: null,
    transactionsLoadingMore: false,
    dataRevision: 0,
    refreshGeneration: 0,
    requestSequence: {},
    pendingDeletions: [],
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
  | { type: 'bootstrap/loading'; sequence: number }
  | { type: 'bootstrap/succeeded'; sequence: number; value: BootstrapResponse; categories: Category[]; accounts: AccountLabel[]; customIcons: string[]; dataRevision: number }
  | { type: 'bootstrap/failed'; sequence: number; message: string }
  | { type: 'custom-icon/created'; emoji: string; dataRevision: number }
  | { type: 'transactions/request-loading'; sequence: number }
  | { type: 'transactions/load-more-started' }
  | { type: 'transactions/request-succeeded'; sequence: number; value: TransactionsResponse; transactions: Transaction[]; dataRevision: number }
  | { type: 'transactions/load-more-succeeded'; value: TransactionsResponse; transactions: Transaction[]; dataRevision: number }
  | { type: 'transactions/load-more-failed'; message: string }
  | { type: 'transactions/request-failed'; sequence: number; message: string }
  | { type: 'overview/request-loading'; sequence: number }
  | { type: 'overview/request-succeeded'; sequence: number; value: OverviewResponse }
  | { type: 'overview/request-failed'; sequence: number; message: string }
  | { type: 'analytics/request-loading'; sequence: number }
  | { type: 'analytics/request-succeeded'; sequence: number; value: OverviewResponse }
  | { type: 'analytics/request-failed'; sequence: number; message: string }
  | { type: 'report/request-loading'; sequence: number }
  | { type: 'report/request-succeeded'; sequence: number; value: MonthlyReportResponse }
  | { type: 'report/request-failed'; sequence: number; message: string }
  | { type: 'data/revision-updated'; dataRevision: number }

export function financeReducer(state: FinanceState, action: FinanceAction): FinanceState {
  if (action.type === 'data/revision-updated') {
    if (action.dataRevision < state.dataRevision) return state
    return { ...state, dataRevision: action.dataRevision, refreshGeneration: state.refreshGeneration + 1 }
  }
  if (action.type === 'data/load-started') return { ...state, dataStatus: 'loading', dataError: undefined }
  if (action.type === 'data/load-succeeded') return { ...state, transactions: action.transactions, categories: action.categories, accounts: action.accounts, dataStatus: 'ready', dataError: undefined }
  if (action.type === 'data/load-failed') return { ...state, transactions: action.transactions, categories: action.categories, accounts: action.accounts, dataStatus: 'error', dataError: action.message }
  if (action.type === 'bootstrap/loading') return { ...state, bootstrap: { status: 'loading' }, requestSequence: { ...state.requestSequence, bootstrap: action.sequence }, dataStatus: 'loading', dataError: undefined }
  if (action.type === 'bootstrap/succeeded') {
    if (state.requestSequence.bootstrap !== action.sequence || action.dataRevision < state.dataRevision) return state
    return { ...state, bootstrap: { status: 'ready', value: action.value }, categories: action.categories, accounts: action.accounts, customIcons: action.customIcons, dataRevision: action.dataRevision, dataStatus: 'ready', dataError: undefined }
  }
  if (action.type === 'bootstrap/failed') {
    if (state.requestSequence.bootstrap !== action.sequence) return state
    return { ...state, bootstrap: { status: 'error', error: action.message }, dataStatus: 'error', dataError: action.message }
  }
  if (action.type === 'custom-icon/created') {
    if (action.dataRevision < state.dataRevision) return state
    return { ...state, customIcons: state.customIcons.includes(action.emoji) ? state.customIcons : [...state.customIcons, action.emoji], dataRevision: action.dataRevision, refreshGeneration: state.refreshGeneration + 1 }
  }
  if (action.type === 'transactions/request-loading') return { ...state, transactionsRequest: { ...state.transactionsRequest, status: 'loading', error: undefined }, transactionCursor: null, transactionsLoadingMore: false, requestSequence: { ...state.requestSequence, transactions: action.sequence } }
  if (action.type === 'transactions/load-more-started') return { ...state, transactionsLoadingMore: true, transactionsRequest: { ...state.transactionsRequest, error: undefined } }
  if (action.type === 'transactions/request-succeeded') {
    if (state.requestSequence.transactions !== action.sequence || action.dataRevision < state.dataRevision) return state
    return { ...state, transactions: action.transactions, transactionCursor: action.value.nextCursor ?? null, transactionsLoadingMore: false, transactionsRequest: { status: 'ready', value: action.value }, dataRevision: action.dataRevision }
  }
  if (action.type === 'transactions/load-more-succeeded') {
    if (action.dataRevision < state.dataRevision) return state
    return { ...state, transactions: action.transactions, transactionCursor: action.value.nextCursor ?? null, transactionsLoadingMore: false, transactionsRequest: { ...state.transactionsRequest, status: 'ready', value: action.value }, dataRevision: action.dataRevision }
  }
  if (action.type === 'transactions/load-more-failed') return { ...state, transactionsLoadingMore: false, transactionsRequest: { ...state.transactionsRequest, error: action.message } }
  if (action.type === 'transactions/request-failed') {
    if (state.requestSequence.transactions !== action.sequence) return state
    return { ...state, transactionsRequest: { status: 'error', error: action.message, value: state.transactionsRequest.value, stale: Boolean(state.transactionsRequest.value) } }
  }
  if (action.type === 'overview/request-loading') return { ...state, overview: { ...state.overview, status: 'loading', error: undefined }, requestSequence: { ...state.requestSequence, overview: action.sequence } }
  if (action.type === 'overview/request-succeeded') {
    if (state.requestSequence.overview !== action.sequence || action.value.dataRevision < state.dataRevision) return state
    return { ...state, overview: { status: 'ready', value: action.value }, dataRevision: action.value.dataRevision }
  }
  if (action.type === 'overview/request-failed') {
    if (state.requestSequence.overview !== action.sequence) return state
    return { ...state, overview: { status: 'error', error: action.message, value: state.overview.value, stale: Boolean(state.overview.value) } }
  }
  if (action.type === 'analytics/request-loading') return { ...state, analyticsState: { ...state.analyticsState, status: 'loading', error: undefined }, requestSequence: { ...state.requestSequence, analytics: action.sequence } }
  if (action.type === 'analytics/request-succeeded') {
    if (state.requestSequence.analytics !== action.sequence || action.value.dataRevision < state.dataRevision) return state
    return { ...state, analyticsState: { status: 'ready', value: action.value }, dataRevision: action.value.dataRevision }
  }
  if (action.type === 'analytics/request-failed') {
    if (state.requestSequence.analytics !== action.sequence) return state
    return { ...state, analyticsState: { status: 'error', error: action.message, value: state.analyticsState.value, stale: Boolean(state.analyticsState.value) } }
  }
  if (action.type === 'report/request-loading') return { ...state, report: { ...state.report, status: 'loading', error: undefined }, requestSequence: { ...state.requestSequence, report: action.sequence } }
  if (action.type === 'report/request-succeeded') {
    if (state.requestSequence.report !== action.sequence || action.value.dataRevision < state.dataRevision) return state
    return { ...state, report: { status: 'ready', value: action.value }, dataRevision: action.value.dataRevision }
  }
  if (action.type === 'report/request-failed') {
    if (state.requestSequence.report !== action.sequence) return state
    return { ...state, report: { status: 'error', error: action.message, value: state.report.value, stale: Boolean(state.report.value) } }
  }
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
