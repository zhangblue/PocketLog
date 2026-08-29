import type { FinanceApi } from '../api/financeApi'
import { FinanceApiError, type AccountDto, type BootstrapResponse, type CategoryDto, type MonthlyReportResponse, type OverviewResponse, type TransactionDto, type TransactionsResponse } from '../api/types'
import { sampleAccounts, sampleCategories, sampleTransactions } from '../domain/sampleData'
import { buildMonthlyReport, compareCategories, daysInMonth, previousMonth, selectCategoryBreakdown, selectDailyTrend, selectInsights, selectMonthlySummary } from '../domain/selectors'
import type { AccountLabel, Category, Transaction, TransactionFilter } from '../domain/types'

type FixtureOptions = { transactions?: Transaction[]; categories?: Category[]; accounts?: AccountLabel[]; pageSize?: number; fail?: Partial<Record<'create' | 'delete' | 'restore' | 'label' | 'bootstrap' | 'transactions' | 'overview' | 'analytics' | 'report' | 'revisionConflict', boolean | number>> }

const dtoTransaction = (item: Transaction): TransactionDto => ({ ...item, amount: item.amount.toFixed(2), categoryId: item.categoryId || null, targetAccountId: item.targetAccountId ?? null, note: item.note })
const dtoCategory = (item: Category): CategoryDto => ({ ...item, semanticKey: null, sortOrder: 0 })
const dtoAccount = (item: AccountLabel): AccountDto => item
const monthOf = (item: Transaction) => item.occurredAt.slice(0, 7)

export function createFixtureApi(options: FixtureOptions = {}): FinanceApi {
  let transactions = [...(options.transactions ?? sampleTransactions)]
  let categories = [...(options.categories ?? sampleCategories)]
  let accounts = [...(options.accounts ?? sampleAccounts)]
  const deleted = new Map<string, Transaction>()
  const idempotent = new Map<string, { data: TransactionDto; dataRevision: number }>()
  let revision = 1
  const fail = options.fail ?? {}
  const failures = new Map(Object.entries(fail).map(([key, value]) => [key, typeof value === 'number' ? value : value ? 1 : 0]))
  const shouldFail = (key: string) => { const remaining = failures.get(key) ?? 0; if (remaining <= 0) return false; failures.set(key, remaining - 1); return true }
  const pageSize = options.pageSize
  let restoreFailures = fail.restore ? 1 : 0
  const filterRows = (filter: Partial<TransactionFilter>) => transactions.filter(item => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:[0-5]\d$/.test(item.occurredAt)) return false
    if (filter.month && !(filter.dateFrom && filter.dateTo) && monthOf(item) !== filter.month) return false
    if (filter.dateFrom && item.occurredAt.slice(0, 10) < filter.dateFrom) return false
    if (filter.dateTo && item.occurredAt.slice(0, 10) > filter.dateTo) return false
    if (filter.kind && item.kind !== filter.kind) return false
    if (filter.kinds && !filter.kinds.includes(item.kind)) return false
    if (filter.categoryId && item.categoryId !== filter.categoryId) return false
    if (filter.accountId && item.accountId !== filter.accountId && item.targetAccountId !== filter.accountId) return false
    if (filter.weekendOnly && ![0, 6].includes(new Date(`${item.occurredAt.slice(0, 10)}T00:00:00Z`).getUTCDay())) return false
    return true
  })
  const overview = (rows: Transaction[], month: string): OverviewResponse => {
    const summary = selectMonthlySummary(rows, month)
    const previous = previousMonth(month)
    const previousSummary = selectMonthlySummary(rows, previous)
    const breakdown = selectCategoryBreakdown(rows, month)
    const trend = selectDailyTrend(rows, `${month}-01`, `${month}-${String(daysInMonth(month)).padStart(2, '0')}`)
    return {
      data: {
        summary: { expense: summary.expense.toFixed(2), income: summary.income.toFixed(2), transfer: rows.filter(item => item.kind === 'transfer' && monthOf(item) === month).reduce((sum, item) => sum + item.amount, 0).toFixed(2), balance: (summary.income - summary.expense).toFixed(2), savingsRate: summary.savingsRate.toFixed(1), dailyExpense: (summary.expense / daysInMonth(month)).toFixed(2), transactionCount: summary.transactionCount },
        trend: trend.map(item => ({ date: item.date, amount: item.amount.toFixed(2) })),
        composition: breakdown.map(item => ({ categoryId: item.categoryId, name: categories.find(category => category.id === item.categoryId)?.name ?? item.categoryId, amount: item.amount.toFixed(2), includedCategoryIds: [item.categoryId] })),
        categoryChanges: compareCategories(rows, month, previous).map(item => ({ categoryId: item.categoryId, name: categories.find(category => category.id === item.categoryId)?.name ?? item.categoryId, current: item.current.toFixed(2), previous: item.previous.toFixed(2), changeRate: item.changePercent?.toFixed(1) ?? null })),
      },
      insights: selectInsights(rows, month, previous).map(item => ({ id: item.id, title: item.title, detail: item.detail, tone: item.tone, drilldown: { sourceLabel: item.filter.sourceLabel ?? item.title, currentFilter: item.filter } })),
      dataRevision: revision,
      previousSummary: { expense: previousSummary.expense.toFixed(2), income: previousSummary.income.toFixed(2), transfer: '0.00', balance: (previousSummary.income - previousSummary.expense).toFixed(2), savingsRate: previousSummary.savingsRate.toFixed(1), dailyExpense: (previousSummary.expense / daysInMonth(previous)).toFixed(2), transactionCount: previousSummary.transactionCount },
    }
  }
  const api = {
    bootstrap: async (): Promise<BootstrapResponse> => { if (shouldFail('bootstrap')) throw new Error('加载失败'); const validTransactions = transactions.filter(item => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:[0-5]\d$/.test(item.occurredAt)); return { categories: categories.map(dtoCategory), accounts: accounts.map(dtoAccount), months: [...new Set(validTransactions.map(monthOf))].sort().reverse(), accountMonths: Object.fromEntries(accounts.map(account => [account.id, [...new Set(validTransactions.filter(item => item.accountId === account.id || item.targetAccountId === account.id).map(monthOf))]])), dataRevision: revision, serverTime: new Date().toISOString() } },
    listTransactions: async (filter: Partial<TransactionFilter> & { cursor?: string } = {}): Promise<TransactionsResponse> => { if (shouldFail('transactions')) throw new Error('交易加载失败'); const rows = filterRows(filter); const offset = filter.cursor ? Number(filter.cursor) : 0; const page = pageSize ? rows.slice(offset, offset + pageSize) : rows; return { items: page.map(dtoTransaction), nextCursor: pageSize && offset + page.length < rows.length ? String(offset + page.length) : null, dataRevision: revision } },
    createTransaction: async (input: Parameters<FinanceApi['createTransaction']>[0], options?: { idempotencyKey?: string }) => { if (options?.idempotencyKey && idempotent.has(options.idempotencyKey)) return idempotent.get(options.idempotencyKey)!; if (fail.create) throw new Error('保存失败，输入内容已保留。'); if (!accounts.some(item => item.id === input.accountId) || (input.targetAccountId && !accounts.some(item => item.id === input.targetAccountId))) throw new Error('账户不存在'); if (input.categoryId && !categories.some(item => item.id === input.categoryId)) throw new Error('分类不存在'); const item: Transaction = { id: `fixture-${transactions.length + 1}`, kind: input.kind, amount: Number(input.amount), categoryId: input.categoryId ?? '', accountId: input.accountId, targetAccountId: input.targetAccountId ?? undefined, merchant: input.merchant, occurredAt: input.occurredAt, note: input.note ?? '' }; transactions = [item, ...transactions]; revision++; const response = { data: dtoTransaction(item), dataRevision: revision }; if (options?.idempotencyKey) idempotent.set(options.idempotencyKey, response); return response },
    deleteTransaction: async (id: string) => { if (fail.delete) throw new Error('保存失败，输入内容已保留。'); const item = transactions.find(row => row.id === id); if (!item) throw new Error('交易不存在'); deleted.set(id, item); transactions = transactions.filter(row => row.id !== id); revision++; return { data: { transaction: dtoTransaction(item), deletionToken: `token-${id}`, undoUntil: new Date(Date.now() + 5000).toISOString() }, dataRevision: revision } },
    restoreTransaction: async (id: string) => { if (restoreFailures > 0) { restoreFailures -= 1; throw new Error('保存失败，输入内容已保留。') } const item = deleted.get(id); if (!item) throw new Error(`无法恢复 ${id}`); transactions = [item, ...transactions]; deleted.delete(id); revision++; return { data: dtoTransaction(item), dataRevision: revision } },
    createCategory: async (input: Record<string, unknown>) => { if (fail.label) throw new Error('标签保存失败，请重试。'); const item: Category = { id: `fixture-category-${categories.length + 1}`, name: String(input.name), kind: input.kind as Category['kind'], emoji: String(input.emoji ?? '🏷️'), color: String(input.color ?? '#4f8a75'), active: true }; categories = [...categories, item]; revision++; return { data: dtoCategory(item), dataRevision: revision } },
    patchCategory: async (id: string, input: { name?: string; active?: boolean }) => { const item = categories.find(row => row.id === id)!; const next = { ...item, ...input }; categories = categories.map(row => row.id === id ? next : row); revision++; return { data: dtoCategory(next), dataRevision: revision } },
    deactivateCategory: async (id: string) => api.patchCategory(id, { active: false }, revision),
    deleteCategory: async (id: string) => { categories = categories.filter(row => row.id !== id); revision++; return { data: {}, dataRevision: revision } },
    migrateCategory: async (id: string, toCategoryId: string) => { if (fail.label) throw new Error('迁移尚未完成，请勿关闭页面。'); transactions = transactions.map(row => row.categoryId === id ? { ...row, categoryId: toCategoryId } : row); categories = categories.filter(row => row.id !== id); revision++; return { data: {}, dataRevision: revision } },
    reorderCategories: async (ids: string[]) => { const map = new Map(categories.map(row => [row.id, row])); categories = ids.flatMap(id => map.get(id) ? [map.get(id)!] : []); revision++; return { data: categories.map(dtoCategory), dataRevision: revision } },
    createAccount: async (name: string) => { const item = { id: `fixture-account-${accounts.length + 1}`, name, active: true }; accounts = [...accounts, item]; revision++; return { data: item, dataRevision: revision } },
    patchAccount: async (id: string, input: { name?: string; active?: boolean }) => { const item = accounts.find(row => row.id === id)!; const next = { ...item, ...input }; accounts = accounts.map(row => row.id === id ? next : row); revision++; return { data: next, dataRevision: revision } },
    deactivateAccount: async (id: string) => api.patchAccount(id, { active: false }, revision),
    overview: async (params: Record<string, string | undefined>) => { if (shouldFail('overview')) throw new Error('总览加载失败'); return overview(filterRows({ accountId: params.accountId }), params.month ?? new Date().toISOString().slice(0, 7)) },
    // Analytics responses contain comparison evidence from the preceding
    // period, so do not pre-filter the fixture by the current range.
    analytics: async (params: Record<string, string | undefined>) => {
      if (shouldFail('analytics')) throw new Error('分析加载失败')
      const rows = filterRows({ accountId: params.accountId })
      const month = (params.end ?? params.start ?? '').slice(0, 7)
      const value = overview(rows, month)
      const currentFilter = params.start && params.end ? { dateFrom: params.start, dateTo: params.end, month } : undefined
      return currentFilter ? { ...value, insights: value.insights.map(item => item.drilldown ? { ...item, drilldown: { ...item.drilldown, currentFilter: { ...item.drilldown.currentFilter, ...currentFilter } } } : item) } : value
    },
    monthlyReport: async (params: Record<string, string | undefined>): Promise<MonthlyReportResponse> => { if (shouldFail('report')) throw new Error('报告加载失败'); const month = params.month ?? new Date().toISOString().slice(0, 7); const report = buildMonthlyReport(transactions, month, previousMonth(month)); return { data: { headline: report.headline, score: report.score, rating: report.status, scoreChange: report.scoreChange, scoreChangeNarrative: report.scoreChangeNarrative, biggestSaving: report.biggestSaving ? { categoryId: report.biggestSaving.categoryId, name: categories.find(row => row.id === report.biggestSaving!.categoryId)?.name ?? report.biggestSaving.categoryId, amount: report.biggestSaving.current.toFixed(2), changeRate: report.biggestSaving.changePercent?.toFixed(1) ?? '0' } : null, biggestGrowth: report.biggestGrowth ? { categoryId: report.biggestGrowth.categoryId, name: categories.find(row => row.id === report.biggestGrowth!.categoryId)?.name ?? report.biggestGrowth.categoryId, amount: report.biggestGrowth.current.toFixed(2), changeRate: report.biggestGrowth.changePercent?.toFixed(1) ?? '0' } : null, story: report.story }, dataRevision: revision } },
  } as FinanceApi
  if (fail.revisionConflict) {
    const originalCreate = api.createTransaction
    api.createTransaction = async (...args: Parameters<FinanceApi['createTransaction']>) => {
      if (shouldFail('revisionConflict')) throw new FinanceApiError({ code: 'revision_conflict', title: 'Revision conflict', detail: '数据已更新，请重试', fieldErrors: [], requestId: 'fixture-conflict', retryable: false })
      return originalCreate(...args)
    }
  }
  return api
}

/** Fetch adapter used by legacy page tests while they are assembled through App. */
export function createFixtureFetch(options: FixtureOptions = {}) {
  const api = createFixtureApi(options)
  return async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://fixture.test')
    const query = Object.fromEntries(url.searchParams.entries())
    const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
    const revision = Number((init.headers as Record<string, string> | undefined)?.['If-Match'] ?? 1)
    const path = url.pathname.replace(/^\/api\/v1/, '')
    let value: unknown
    if (path === '/bootstrap') value = await api.bootstrap()
    else if (path === '/transactions' && init.method === 'POST') value = await api.createTransaction(body as never, { revision, idempotencyKey: (init.headers as Record<string, string> | undefined)?.['Idempotency-Key'] })
    else if (path.startsWith('/transactions/') && init.method === 'DELETE') value = await api.deleteTransaction(path.split('/')[2], revision)
    else if (path.startsWith('/transactions/') && path.endsWith('/restore')) value = await api.restoreTransaction(path.split('/')[2], String(body.deletionToken ?? ''), revision)
    else if (path === '/transactions') { const kinds = url.searchParams.getAll('kind'); value = await api.listTransactions({ month: query.month, accountId: query.accountId, categoryId: query.categoryId, dateFrom: query.start, dateTo: query.end, kind: kinds.length > 1 ? undefined : query.kind as never, kinds: kinds.length ? kinds as never : undefined, weekendOnly: query.weekendOnly === 'true' }) }
    else if (path === '/overview') value = await api.overview({ month: query.month })
    else if (path === '/analytics') value = await api.analytics({ start: query.start, end: query.end, accountId: query.accountId })
    else if (path === '/reports/monthly') value = await api.monthlyReport({ month: query.month })
    else if (path.startsWith('/accounts/') && init.method === 'PATCH') value = await api.patchAccount(path.split('/')[2], body as never, revision)
    else if (path.startsWith('/accounts/') && path.endsWith('/deactivate')) value = await api.deactivateAccount(path.split('/')[2], revision)
    else if (path === '/accounts' && init.method === 'POST') value = await api.createAccount(String(body.name ?? ''), revision)
    else if (path.startsWith('/categories/') && init.method === 'PATCH') value = await api.patchCategory(path.split('/')[2], body as never, revision)
    else if (path.startsWith('/categories/') && path.endsWith('/deactivate')) value = await api.deactivateCategory(path.split('/')[2], revision)
    else if (path.startsWith('/categories/') && path.endsWith('/migrate')) value = await api.migrateCategory(path.split('/')[2], String(body.toCategoryId ?? ''), revision)
    else throw new Error(`fixture 未实现 ${init.method ?? 'GET'} ${path}`)
    return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
  }
}
