import { sampleAccounts, sampleCategories } from '../domain/sampleData'
import type { AccountLabel, Category } from '../domain/types'
import type { LoadResult, SaveResult } from './transactionRepository'

const STORAGE_KEY = 'qizhang.labels.v1'

export interface LabelSnapshot {
  categories: Category[]
  accounts: AccountLabel[]
}

export interface LabelRepository {
  load(): LabelSnapshot
  loadResult?(): LoadResult<LabelSnapshot>
  save(snapshot: LabelSnapshot): SaveResult
}

function isCategory(value: unknown): value is Category {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return typeof item.id === 'string' && item.id.trim().length > 0
    && typeof item.name === 'string' && item.name.trim().length > 0
    && typeof item.emoji === 'string'
    && typeof item.color === 'string'
    && (item.kind === 'expense' || item.kind === 'income')
    && typeof item.active === 'boolean'
}

function isAccount(value: unknown): value is AccountLabel {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return typeof item.id === 'string' && item.id.trim().length > 0
    && typeof item.name === 'string' && item.name.trim().length > 0
    && typeof item.active === 'boolean'
}

function hasUniqueIds(items: { id: string }[]) {
  return new Set(items.map(item => item.id)).size === items.length
}

function hasUniqueNames(items: { name: string }[]) {
  return new Set(items.map(item => item.name.trim().toLocaleLowerCase('zh-CN'))).size === items.length
}

function isSnapshot(value: unknown): value is LabelSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const snapshot = value as Record<string, unknown>
  return Array.isArray(snapshot.categories) && snapshot.categories.length > 0
    && Array.isArray(snapshot.accounts) && snapshot.accounts.length > 0
    && snapshot.categories.every(isCategory)
    && snapshot.accounts.every(isAccount)
    && hasUniqueIds(snapshot.categories)
    && hasUniqueIds(snapshot.accounts)
    && hasUniqueNames(snapshot.categories)
    && hasUniqueNames(snapshot.accounts)
    && snapshot.categories.some(category => category.kind === 'expense' && category.active)
    && snapshot.categories.some(category => category.kind === 'income' && category.active)
    && snapshot.accounts.some(account => account.active)
}

function copySnapshot(snapshot: LabelSnapshot): LabelSnapshot {
  return {
    categories: snapshot.categories.map(category => ({ ...category })),
    accounts: snapshot.accounts.map(account => ({ ...account })),
  }
}

function defaults(): LabelSnapshot {
  return copySnapshot({ categories: sampleCategories, accounts: sampleAccounts })
}

export function createLabelRepository(storage: Storage): LabelRepository & { loadResult(): LoadResult<LabelSnapshot> } {
  const repository: LabelRepository & { loadResult(): LoadResult<LabelSnapshot> } = {
    loadResult(): LoadResult<LabelSnapshot> {
      try {
        const raw = storage.getItem(STORAGE_KEY)
        if (!raw) return { ok: true, data: defaults(), source: 'seed' }
        const parsed: unknown = JSON.parse(raw)
        return isSnapshot(parsed)
          ? { ok: true, data: copySnapshot(parsed), source: 'storage' }
          : { ok: false, data: defaults(), message: '本地标签数据损坏，已安全回退。' }
      } catch {
        return { ok: false, data: defaults(), message: '无法读取本地标签数据，已安全回退。' }
      }
    },
    load(): LabelSnapshot {
      return repository.loadResult().data
    },
    save(snapshot: LabelSnapshot): SaveResult {
      if (!isSnapshot(snapshot)) return { ok: false, message: '标签保存失败，请重试。' }
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(copySnapshot(snapshot)))
        return { ok: true }
      } catch {
        return { ok: false, message: '标签保存失败，请重试。' }
      }
    },
  }
  return repository
}
