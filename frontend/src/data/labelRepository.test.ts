import { beforeEach, describe, expect, it } from 'vitest'
import { createLabelRepository } from './labelRepository'

describe('label repository', () => {
  beforeEach(() => localStorage.clear())

  it('falls back to default labels when stored data is malformed', () => {
    localStorage.setItem('qizhang.labels.v1', '{broken')

    const snapshot = createLabelRepository(localStorage).load()

    expect(snapshot.categories.map(item => item.id)).toContain('food')
    expect(snapshot.accounts.map(item => item.id)).toContain('wechat')
  })

  it('rejects structurally invalid snapshots and returns safe copies', () => {
    localStorage.setItem('qizhang.labels.v1', JSON.stringify({
      categories: [{ id: 'bad', name: '坏数据', emoji: 'x', color: '#000', kind: 'expense', active: 'yes' }],
      accounts: [],
    }))
    const repository = createLabelRepository(localStorage)
    const first = repository.load()
    first.categories[0].name = '不应泄漏'
    const second = repository.load()

    expect(second.categories.find(item => item.id === 'food')?.name).toBe('餐饮')
    expect(second.categories).not.toBe(first.categories)
  })

  it('does not write invalid snapshots', () => {
    const result = createLabelRepository(localStorage).save({
      categories: [],
      accounts: [{ id: 'cash', name: '现金', active: true }],
    })

    expect(result).toEqual({ ok: false, message: '标签保存失败，请重试。' })
    expect(localStorage.getItem('qizhang.labels.v1')).toBeNull()
  })

  it('rejects snapshots with duplicate names or no active label for new entries', () => {
    const result = createLabelRepository(localStorage).save({
      categories: [
        { id: 'expense-a', name: '餐饮', emoji: '🍜', color: '#000000', kind: 'expense', active: false },
        { id: 'expense-b', name: '餐饮', emoji: '🍚', color: '#111111', kind: 'expense', active: true },
      ],
      accounts: [{ id: 'wallet', name: '钱包', active: false }],
    })

    expect(result.ok).toBe(false)
    expect(localStorage.getItem('qizhang.labels.v1')).toBeNull()
  })

  it('requires an active category for both expense and income on save and load', () => {
    const invalidSnapshot = {
      categories: [
        { id: 'food', name: '餐饮', emoji: '🍜', color: '#4f8a75', kind: 'expense' as const, active: true },
        { id: 'salary', name: '工资', emoji: '💰', color: '#3f7663', kind: 'income' as const, active: false },
      ],
      accounts: [{ id: 'wallet', name: '钱包', active: true }],
    }
    const repository = createLabelRepository(localStorage)

    expect(repository.save(invalidSnapshot).ok).toBe(false)
    localStorage.setItem('qizhang.labels.v1', JSON.stringify(invalidSnapshot))
    expect(repository.load().categories.map(item => item.id)).toEqual(expect.arrayContaining(['food', 'salary']))
    expect(repository.load().categories.find(item => item.id === 'salary')?.active).toBe(true)
  })
})
