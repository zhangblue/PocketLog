export type TransactionKind = 'expense' | 'income' | 'transfer'
export type ViewId = 'overview' | 'transactions' | 'analytics' | 'reports' | 'labels'

export interface Transaction {
  id: string
  kind: TransactionKind
  amount: number
  categoryId: string
  accountId: string
  targetAccountId?: string
  merchant: string
  occurredAt: string
  note: string
}

export interface Category {
  id: string
  name: string
  emoji: string
  color: string
  kind: 'expense' | 'income'
  active: boolean
}

export interface AccountLabel {
  id: string
  name: string
  active: boolean
}

export interface TransactionFilter {
  month: string
  kind?: TransactionKind
  kinds?: TransactionKind[]
  categoryId?: string
  accountId?: string
  dateFrom?: string
  dateTo?: string
  weekendOnly?: boolean
  sourceLabel?: string
}

export interface MonthlySummary {
  expense: number
  income: number
  savingsRate: number
  transactionCount: number
}

export interface Insight {
  id: string
  title: string
  detail: string
  filter: TransactionFilter
  tone: 'positive' | 'attention' | 'neutral'
}
