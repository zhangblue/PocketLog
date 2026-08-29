import type { TransactionFilter } from '../domain/types'
import {
  FinanceApiError,
  type AccountDto,
  type ApiProblem,
  type BootstrapResponse,
  type CategoryDto,
  type CreateTransactionInput,
  type MonthlyReportResponse,
  type Mutation,
  type MutationOptions,
  type OverviewResponse,
  type RequestOptions,
  type Drilldown,
  type InsightDto,
  type MonthlyReport,
  type OverviewDto,
  type AmountSummary,
  type TrendPoint,
  type CategoryGroup,
  type CategoryChange,
  type TransactionDto,
  type TransactionsResponse,
} from './types'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface FinanceApiOptions {
  fetch?: FetchLike
  baseUrl?: string
}

export interface FinanceApi {
  bootstrap(options?: RequestOptions): Promise<BootstrapResponse>
  listTransactions(filter?: Partial<TransactionFilter> & { cursor?: string; limit?: number }, options?: RequestOptions): Promise<TransactionsResponse>
  createTransaction(input: CreateTransactionInput, options: MutationOptions): Promise<Mutation<TransactionDto>>
  deleteTransaction(id: string, revision: number, options?: RequestOptions): Promise<Mutation<{ transaction: TransactionDto; deletionToken: string; undoUntil: string }>>
  restoreTransaction(id: string, deletionToken: string, revision: number, options?: RequestOptions): Promise<Mutation<TransactionDto>>
  createCategory(input: Record<string, unknown>, revision: number, options?: RequestOptions): Promise<Mutation<CategoryDto>>
  patchCategory(id: string, input: { name?: string; active?: boolean }, revision: number, options?: RequestOptions): Promise<Mutation<CategoryDto>>
  deactivateCategory(id: string, revision: number, options?: RequestOptions): Promise<Mutation<CategoryDto>>
  deleteCategory(id: string, revision: number, options?: RequestOptions): Promise<Mutation<unknown>>
  migrateCategory(id: string, toCategoryId: string, revision: number, options?: RequestOptions): Promise<Mutation<unknown>>
  reorderCategories(ids: string[], revision: number, options?: RequestOptions): Promise<Mutation<CategoryDto[]>>
  createAccount(name: string, revision: number, options?: RequestOptions): Promise<Mutation<AccountDto>>
  patchAccount(id: string, input: { name?: string; active?: boolean }, revision: number, options?: RequestOptions): Promise<Mutation<AccountDto>>
  deactivateAccount(id: string, revision: number, options?: RequestOptions): Promise<Mutation<AccountDto>>
  overview(params: Record<string, string | undefined>, options?: RequestOptions): Promise<OverviewResponse>
  analytics(params: Record<string, string | undefined>, options?: RequestOptions): Promise<OverviewResponse>
  monthlyReport(params: Record<string, string | undefined>, options?: RequestOptions): Promise<MonthlyReportResponse>
}

function queryString(params: Record<string, unknown>) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) value.forEach(item => query.append(key, String(item)))
    else query.set(key, String(value))
  }
  const value = query.toString()
  return value ? `?${value}` : ''
}

function problemFromUnknown(status: number, requestId: string, value: unknown): ApiProblem {
  if (typeof value === 'object' && value !== null) {
    const item = value as Record<string, unknown>
    if (typeof item.code === 'string') {
      return {
        code: item.code,
        title: typeof item.title === 'string' ? item.title : '请求失败',
        detail: typeof item.detail === 'string' ? item.detail : item.code,
        fieldErrors: Array.isArray(item.fieldErrors) ? item.fieldErrors as ApiProblem['fieldErrors'] : [],
        requestId: typeof item.requestId === 'string' ? item.requestId : requestId,
        retryable: typeof item.retryable === 'boolean' ? item.retryable : status >= 500,
      }
    }
  }
  return {
    code: status >= 500 ? 'request.server_error' : 'request.invalid',
    title: status >= 500 ? '服务器错误' : '请求失败',
    detail: status >= 500 ? '服务器暂时不可用，请稍后重试。' : '请求无法完成。',
    fieldErrors: [],
    requestId,
    retryable: status >= 500,
  }
}

export function createFinanceApi(options: FinanceApiOptions = {}): FinanceApi {
  const request = options.fetch ?? fetch
  const baseUrl = (options.baseUrl ?? '/api/v1').replace(/\/$/, '')

  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response
    try {
      response = await request(`${baseUrl}${path}`, init)
    } catch (cause) {
      if (typeof cause === 'object' && cause !== null && 'name' in cause && cause.name === 'AbortError') throw cause
      throw new FinanceApiError({
        code: 'network.error',
        title: '网络错误',
        detail: '网络请求失败，请重试。',
        fieldErrors: [],
        requestId: '',
        retryable: true,
      })
    }
    const requestId = response.headers.get('x-request-id') ?? ''
    if (response.status === 204) return undefined as T
    const contentType = response.headers.get('content-type') ?? ''
    let value: unknown
    if (contentType.includes('json')) {
      try { value = await response.json() } catch { value = undefined }
    } else {
      try { await response.text() } catch { /* body is not needed for normalization */ }
    }
    if (!response.ok) throw new FinanceApiError(problemFromUnknown(response.status, requestId, value), response.status)
    if (value === undefined) return undefined as T
    return value as T
  }

  const mutationHeaders = (revision: number, idempotencyKey?: string) => ({
    'Content-Type': 'application/json',
    'If-Match': String(revision),
    ...(idempotencyKey === undefined ? {} : { 'Idempotency-Key': idempotencyKey }),
  })
  const mutation = <T>(path: string, body: unknown, revision: number, options: RequestOptions = {}) => call<Mutation<T>>(path, {
    method: 'POST', headers: mutationHeaders(revision), body: JSON.stringify(body), signal: options.signal,
  })

  const text = (value: unknown) => value === null || value === undefined ? undefined : String(value)
  const transaction = (value: unknown): TransactionDto => {
    const raw = value as Record<string, unknown>
    const occurredAt = String(raw.occurred_at ?? raw.occurredAt ?? '')
    const parsed = occurredAt.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)([+-])(\d{2}):(\d{2})/)
    const offset = parsed ? (Number(parsed[4]) * 60 + Number(parsed[5])) * (parsed[3] === '+' ? 1 : -1) : undefined
    return {
      id: String(raw.id), kind: raw.kind as TransactionDto['kind'], amount: String(raw.amount), merchant: String(raw.merchant),
      categoryId: text(raw.category_id ?? raw.categoryId), accountId: String(raw.account_id ?? raw.accountId),
      targetAccountId: text(raw.target_account_id ?? raw.targetAccountId), occurredAt,
      localDate: text(raw.local_date ?? raw.localDate) ?? parsed?.[1], localTime: text(raw.local_time ?? raw.localTime) ?? parsed?.[2],
      utcOffsetMinutes: typeof raw.utc_offset_minutes === 'number' ? raw.utc_offset_minutes : offset, note: String(raw.note ?? ''),
      pendingDeleteUntil: text(raw.pending_delete_until ?? raw.pendingDeleteUntil),
    }
  }
  const category = (value: unknown): CategoryDto => {
    const raw = value as Record<string, unknown>
    return { id: String(raw.id), name: String(raw.name), kind: raw.kind as CategoryDto['kind'], emoji: String(raw.emoji), color: String(raw.color), semanticKey: (raw.semantic_key ?? raw.semanticKey) as string | null | undefined, sortOrder: Number(raw.sort_order ?? raw.sortOrder), active: Boolean(raw.active) }
  }
  const account = (value: unknown): AccountDto => {
    const raw = value as Record<string, unknown>
    return { id: String(raw.id), name: String(raw.name), active: Boolean(raw.active) }
  }
  const filter = (value: unknown) => {
    const raw = value as Record<string, unknown>
    const month = typeof raw.month === 'string' ? raw.month : ''
    const start = String(raw.start ?? raw.dateFrom ?? (month ? `${month}-01` : ''))
    const end = String(raw.end ?? raw.dateTo ?? (month ? `${month}-${new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()}` : ''))
    const kinds = raw.kinds as TransactionFilter['kinds'] | undefined
    return { month: start.slice(0, 7), dateFrom: start || undefined, dateTo: end || undefined, categoryId: text(raw.category_id ?? raw.categoryId), accountId: text(raw.account_id ?? raw.accountId), weekendOnly: Boolean(raw.weekend_only ?? raw.weekendOnly), kinds: kinds?.length ? kinds : undefined, kind: raw.kind as TransactionFilter['kind'], sourceLabel: text(raw.source_label ?? raw.sourceLabel) }
  }
  const drilldown = (value: unknown): Drilldown | undefined => {
    if (!value || typeof value !== 'object') return undefined
    const raw = value as Record<string, unknown>
    return { sourceLabel: String(raw.source_label ?? raw.sourceLabel ?? ''), currentFilter: filter(raw.current_filter ?? raw.currentFilter), previousFilter: raw.previous_filter || raw.previousFilter ? filter(raw.previous_filter ?? raw.previousFilter) : undefined, includedCategoryIds: (raw.included_category_ids ?? raw.includedCategoryIds) as string[] | undefined }
  }
  const insight = (value: unknown): InsightDto => {
    const raw = value as Record<string, unknown>
    return { id: String(raw.id ?? raw.code), title: String(raw.title), detail: String(raw.detail ?? raw.description ?? ''), tone: (raw.tone as InsightDto['tone']) ?? 'neutral', drilldown: drilldown(raw.drilldown ?? raw) }
  }
  const summary = (value: unknown): AmountSummary => {
    const raw = value as Record<string, unknown>
    return { expense: String(raw.expense), income: String(raw.income), transfer: String(raw.transfer), balance: String(raw.balance), savingsRate: text(raw.savings_rate ?? raw.savingsRate), dailyExpense: String(raw.daily_expense ?? raw.dailyExpense), transactionCount: Number(raw.transaction_count ?? raw.transactionCount) }
  }
  const overviewData = (value: unknown): OverviewDto => {
    const raw = value as Record<string, unknown>
    const mapTrend = (item: unknown): TrendPoint => { const r = item as Record<string, unknown>; return { date: String(r.date), amount: String(r.amount) } }
    const mapGroup = (item: unknown): CategoryGroup => { const r = item as Record<string, unknown>; return { categoryId: text(r.category_id ?? r.categoryId), name: String(r.name), amount: String(r.amount), includedCategoryIds: (r.included_category_ids ?? r.includedCategoryIds ?? []) as string[] } }
    const mapChange = (item: unknown): CategoryChange => { const r = item as Record<string, unknown>; return { categoryId: String(r.category_id ?? r.categoryId), name: String(r.name), current: String(r.current), previous: String(r.previous), changeRate: text(r.change_rate ?? r.changeRate) } }
    return { summary: summary(raw.summary), trend: (raw.trend as unknown[]).map(mapTrend), composition: (raw.composition as unknown[]).map(mapGroup), categoryChanges: ((raw.category_changes ?? raw.categoryChanges) as unknown[]).map(mapChange) }
  }
  const report = (value: unknown): MonthlyReport => {
    const raw = value as Record<string, unknown>
    const highlight = (item: unknown) => { if (!item) return null; const r = item as Record<string, unknown>; return { categoryId: String(r.category_id ?? r.categoryId), name: String(r.name), amount: String(r.amount), changeRate: String(r.change_rate ?? r.changeRate) } }
    return { headline: text(raw.headline), score: raw.score as number | null, rating: raw.rating as string | null, scoreChange: (raw.score_change ?? raw.scoreChange) as number | null, scoreChangeNarrative: text(raw.score_change_narrative ?? raw.scoreChangeNarrative), biggestSaving: highlight(raw.biggest_saving ?? raw.biggestSaving), biggestGrowth: highlight(raw.biggest_growth ?? raw.biggestGrowth), story: String(raw.story ?? '') }
  }

  return {
    bootstrap: options => call<BootstrapResponse>('/bootstrap', { signal: options?.signal }).then(raw => ({ ...raw, categories: (raw.categories as unknown[]).map(category), accounts: (raw.accounts as unknown[]).map(account), accountMonths: raw.accountMonths ?? (raw as unknown as Record<string, unknown>).account_months as BootstrapResponse['accountMonths'] })),
    listTransactions: (filter = {}, options) => call<TransactionsResponse>(`/transactions${queryString({
      month: filter.month,
      kind: filter.kinds ?? (filter.kind ? [filter.kind] : undefined),
      categoryId: filter.categoryId,
      accountId: filter.accountId,
      start: filter.dateFrom,
      end: filter.dateTo,
      weekendOnly: filter.weekendOnly,
      cursor: filter.cursor,
      limit: filter.limit,
    })}`, { signal: options?.signal }).then(raw => ({ ...raw, items: raw.items.map(transaction) })),
    createTransaction: (input, options) => call<Mutation<unknown>>('/transactions', {
      method: 'POST', headers: mutationHeaders(options.revision, options.idempotencyKey), body: JSON.stringify(input), signal: options.signal,
    }).then(raw => ({ ...raw, data: transaction(raw.data) })),
    deleteTransaction: (id, revision, options) => call<Mutation<Record<string, unknown>>>(`/transactions/${id}`, { method: 'DELETE', headers: mutationHeaders(revision), signal: options?.signal }).then(raw => ({ ...raw, data: { transaction: transaction(raw.data.transaction), deletionToken: String(raw.data.deletionToken ?? raw.data.deletion_token), undoUntil: String(raw.data.undoUntil ?? raw.data.undo_until) } })),
    restoreTransaction: (id, deletionToken, revision, options) => call<Mutation<unknown>>(`/transactions/${id}/restore`, { method: 'POST', headers: mutationHeaders(revision), body: JSON.stringify({ deletionToken }), signal: options?.signal }).then(raw => ({ ...raw, data: transaction(raw.data) })),
    createCategory: (input, revision, options) => mutation<unknown>('/categories', input, revision, options).then(raw => ({ ...raw, data: category(raw.data) })),
    patchCategory: (id, input, revision, options) => call<Mutation<unknown>>(`/categories/${id}`, { method: 'PATCH', headers: mutationHeaders(revision), body: JSON.stringify(input), signal: options?.signal }).then(raw => ({ ...raw, data: category(raw.data) })),
    deactivateCategory: (id, revision, options) => mutation<unknown>(`/categories/${id}/deactivate`, {}, revision, options).then(raw => ({ ...raw, data: category(raw.data) })),
    deleteCategory: (id, revision, options) => mutation(`/categories/${id}/delete`, {}, revision, options),
    migrateCategory: (id, toCategoryId, revision, options) => mutation(`/categories/${id}/migrate`, { toCategoryId }, revision, options),
    reorderCategories: (ids, revision, options) => call<Mutation<unknown[]>>('/categories/order', { method: 'PUT', headers: mutationHeaders(revision), body: JSON.stringify(ids), signal: options?.signal }).then(raw => ({ ...raw, data: raw.data.map(category) })),
    createAccount: (name, revision, options) => mutation<unknown>('/accounts', { name }, revision, options).then(raw => ({ ...raw, data: account(raw.data) })),
    patchAccount: (id, input, revision, options) => call<Mutation<unknown>>(`/accounts/${id}`, { method: 'PATCH', headers: mutationHeaders(revision), body: JSON.stringify(input), signal: options?.signal }).then(raw => ({ ...raw, data: account(raw.data) })),
    deactivateAccount: (id, revision, options) => mutation<unknown>(`/accounts/${id}/deactivate`, {}, revision, options).then(raw => ({ ...raw, data: account(raw.data) })),
    overview: (params, options) => call<{ data: unknown; insights: unknown[]; dataRevision: number }>(`/overview${queryString(params)}`, { signal: options?.signal }).then(raw => ({ data: overviewData(raw.data), insights: raw.insights.map(insight), dataRevision: raw.dataRevision })),
    analytics: (params, options) => call<{ data: unknown; insights: unknown[]; dataRevision: number }>(`/analytics${queryString(params)}`, { signal: options?.signal }).then(raw => ({ data: overviewData(raw.data), insights: raw.insights.map(insight), dataRevision: raw.dataRevision })),
    monthlyReport: (params, options) => call<{ data: unknown; dataRevision: number }>(`/reports/monthly${queryString(params)}`, { signal: options?.signal }).then(raw => ({ data: report(raw.data), dataRevision: raw.dataRevision })),
  }
}
