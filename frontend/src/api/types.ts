import type { Money, TransactionFilter, TransactionKind } from '../domain/types'

export type { Money }

export interface FieldError {
  field: string
  code: string
  message: string
}

export interface ApiProblem {
  code: string
  title: string
  detail: string
  fieldErrors: FieldError[]
  requestId: string
  retryable: boolean
}

export class FinanceApiError extends Error implements ApiProblem {
  code: string
  title: string
  detail: string
  fieldErrors: FieldError[]
  requestId: string
  retryable: boolean
  status?: number

  constructor(problem: ApiProblem, status?: number) {
    super(problem.detail || problem.code)
    this.name = 'FinanceApiError'
    this.code = problem.code
    this.title = problem.title
    this.detail = problem.detail
    this.fieldErrors = problem.fieldErrors
    this.requestId = problem.requestId
    this.retryable = problem.retryable
    this.status = status
  }
}

export interface CategoryDto {
  id: string
  name: string
  kind: 'expense' | 'income'
  emoji: string
  color: string
  semanticKey?: string | null
  sortOrder: number
  active: boolean
}

export interface AccountDto {
  id: string
  name: string
  active: boolean
}

export interface TransactionDto {
  id: string
  kind: TransactionKind
  amount: Money
  categoryId?: string | null
  accountId: string
  targetAccountId?: string | null
  merchant: string
  occurredAt: string
  localDate?: string
  localTime?: string
  utcOffsetMinutes?: number
  note: string
  pendingDeleteUntil?: string | null
}

export interface BootstrapResponse {
  categories: CategoryDto[]
  accounts: AccountDto[]
  months: string[]
  dataRevision: number
  serverTime: string
  accountMonths?: Record<string, string[]>
}

export interface Mutation<T> {
  data: T
  dataRevision: number
}

export interface TransactionsResponse {
  items: TransactionDto[]
  nextCursor?: string | null
  dataRevision: number
}

export interface AmountSummary {
  expense: Money
  income: Money
  transfer: Money
  balance: Money
  savingsRate?: Money | null
  dailyExpense: Money
  transactionCount: number
}

export interface TrendPoint {
  date: string
  amount: Money
}

export interface CategoryGroup {
  categoryId?: string | null
  name: string
  amount: Money
  includedCategoryIds: string[]
}

export interface CategoryChange {
  categoryId: string
  name: string
  current: Money
  previous: Money
  changeRate?: Money | null
}

export interface OverviewDto {
  summary: AmountSummary
  trend: TrendPoint[]
  composition: CategoryGroup[]
  categoryChanges: CategoryChange[]
}

export interface Drilldown {
  sourceLabel: string
  currentFilter: TransactionFilter
  previousFilter?: TransactionFilter
  includedCategoryIds?: string[]
}

export interface InsightDto {
  id: string
  title: string
  detail: string
  tone: 'positive' | 'attention' | 'neutral'
  drilldown?: Drilldown
}

export interface OverviewResponse {
  data: OverviewDto
  insights: InsightDto[]
  dataRevision: number
  previousSummary?: AmountSummary
}

export interface MonthlyReport {
  headline?: string | null
  score?: number | null
  rating?: string | null
  scoreChange?: number | null
  scoreChangeNarrative?: string | null
  biggestSaving?: ReportHighlight | null
  biggestGrowth?: ReportHighlight | null
  story: string
}

export interface ReportHighlight {
  categoryId: string
  name: string
  amount: Money
  changeRate: Money
}

export interface MonthlyReportResponse {
  data: MonthlyReport
  dataRevision: number
}

export interface CreateTransactionInput {
  kind: TransactionKind
  amount: Money
  merchant: string
  categoryId?: string | null
  accountId: string
  targetAccountId?: string | null
  occurredAt: string
  note?: string
}

export interface MutationOptions {
  revision: number
  idempotencyKey?: string
  signal?: AbortSignal
}

export interface RequestOptions {
  signal?: AbortSignal
}
