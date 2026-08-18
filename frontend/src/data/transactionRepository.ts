import { sampleTransactions } from '../domain/sampleData'
import type { AccountLabel, Category, Transaction } from '../domain/types'
import { isValidOccurredAt } from '../domain/selectors'

const STORAGE_KEY = 'qizhang.transactions.v1'

export type SaveResult = { ok: true } | { ok: false; message: string }
export type LoadResult<T> = { ok: true; data: T; source: 'seed' | 'storage' } | { ok: false; data: T; message: string }

export interface TransactionRepository {
  load(): Transaction[]
  loadResult?(): LoadResult<Transaction[]>
  save(items: Transaction[]): SaveResult
}

function isTransaction(value: unknown): value is Transaction {
  if (typeof value !== 'object' || value === null) return false

  const item = value as Record<string, unknown>
  const kindIsValid = item.kind === 'expense' || item.kind === 'income' || item.kind === 'transfer'
  const hasTarget = typeof item.targetAccountId === 'string' && item.targetAccountId.trim().length > 0
  return typeof item.id === 'string' && item.id.trim().length > 0
    && kindIsValid
    && typeof item.amount === 'number'
    && Number.isFinite(item.amount)
    && item.amount > 0
    && typeof item.categoryId === 'string' && item.categoryId.trim().length > 0
    && typeof item.accountId === 'string' && item.accountId.trim().length > 0
    && typeof item.merchant === 'string' && item.merchant.trim().length > 0
    && typeof item.occurredAt === 'string'
    && isValidOccurredAt(item.occurredAt)
    && typeof item.note === 'string'
    && (item.kind === 'transfer'
      ? hasTarget && item.targetAccountId !== item.accountId
      : item.targetAccountId === undefined)
}

export function isValidTransactionSet(items: Transaction[]) {
  return items.every(isTransaction) && new Set(items.map(item => item.id)).size === items.length
}

export function validateTransactionReferences(items: Transaction[], categories: Category[], accounts: AccountLabel[]) {
  if (!isValidTransactionSet(items)) return false
  const categoriesById = new Map(categories.map(category => [category.id, category]))
  const accountIds = new Set(accounts.map(account => account.id))
  return items.every(item => {
    if (!accountIds.has(item.accountId)) return false
    if (item.kind === 'transfer') return Boolean(item.targetAccountId && accountIds.has(item.targetAccountId) && item.targetAccountId !== item.accountId)
    const category = categoriesById.get(item.categoryId)
    return Boolean(category && category.kind === item.kind)
  })
}

export function createTransactionRepository(storage: Storage): TransactionRepository & { loadResult(): LoadResult<Transaction[]> } {
  const repository: TransactionRepository & { loadResult(): LoadResult<Transaction[]> } = {
    loadResult(): LoadResult<Transaction[]> {
      try {
        const raw = storage.getItem(STORAGE_KEY)
        if (!raw) return { ok: true, data: sampleTransactions, source: 'seed' }

        const parsed: unknown = JSON.parse(raw)
        return Array.isArray(parsed) && isValidTransactionSet(parsed)
          ? { ok: true, data: parsed, source: 'storage' }
          : { ok: false, data: sampleTransactions, message: '本地交易数据损坏，已安全回退。' }
      } catch {
        return { ok: false, data: sampleTransactions, message: '无法读取本地交易数据，已安全回退。' }
      }
    },
    load(): Transaction[] {
      return repository.loadResult().data
    },
    save(items: Transaction[]): SaveResult {
      if (!isValidTransactionSet(items)) return { ok: false, message: '保存失败，输入内容已保留。' }
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(items))
        return { ok: true }
      } catch {
        return { ok: false, message: '保存失败，输入内容已保留。' }
      }
    },
  }
  return repository
}
