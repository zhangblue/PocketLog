import { describe, expect, it } from 'vitest'
import { sampleTransactions } from '../domain/sampleData'
import { createTransactionRepository } from './transactionRepository'

describe('transaction repository', () => {
  it('损坏的本地数据回退到种子数据', () => {
    localStorage.setItem('qizhang.transactions.v1', '{broken')

    const repository = createTransactionRepository(localStorage)

    expect(repository.load()).toEqual(sampleTransactions)
  })

  it('数组内包含不合法交易时回退到种子数据', () => {
    localStorage.setItem('qizhang.transactions.v1', JSON.stringify([null]))

    const repository = createTransactionRepository(localStorage)

    expect(repository.load()).toEqual(sampleTransactions)
  })

  it('损坏的 occurredAt 日历日期不会作为真实交易加载', () => {
    localStorage.setItem('qizhang.transactions.v1', JSON.stringify([{ ...sampleTransactions[0], occurredAt: '2026-08-invalid' }]))

    expect(createTransactionRepository(localStorage).load()).toEqual(sampleTransactions)
  })

  it('正常读写交易数据', () => {
    const repository = createTransactionRepository(localStorage)
    const items = [sampleTransactions[0]]

    expect(repository.save(items)).toEqual({ ok: true })
    expect(repository.load()).toEqual(items)
  })

  it('存储写入失败时返回明确结果', () => {
    const storage: Storage = {
      ...localStorage,
      setItem: () => {
        throw new Error('quota exceeded')
      },
    }
    const repository = createTransactionRepository(storage)

    expect(repository.save([sampleTransactions[0]])).toEqual({
      ok: false,
      message: '保存失败，输入内容已保留。',
    })
  })

  it('拒绝不可能 ISO 时间并在保存前保持存储不变', () => {
    const repository = createTransactionRepository(localStorage)
    const result = repository.save([{ ...sampleTransactions[0], occurredAt: '2026-08-18T25:99:99+99:99' }])

    expect(result).toEqual({ ok: false, message: '保存失败，输入内容已保留。' })
    expect(localStorage.getItem('qizhang.transactions.v1')).toBeNull()
  })

  it('保存和加载都拒绝超出 ±14:00 的 offset', () => {
    const repository = createTransactionRepository(localStorage)
    expect(repository.save([{ ...sampleTransactions[0], occurredAt: '2026-08-18T12:00:00+14:01' }]).ok).toBe(false)
    localStorage.setItem('qizhang.transactions.v1', JSON.stringify([{ ...sampleTransactions[0], occurredAt: '2026-08-18T12:00:00-15:00' }]))
    expect(repository.load()).toEqual(sampleTransactions)
  })

  it('保存和加载都拒绝 offset 分钟越界的完整时间戳', () => {
    const repository = createTransactionRepository(localStorage)
    expect(repository.save([{ ...sampleTransactions[0], occurredAt: '2026-08-18T12:00:00+05:99' }]).ok).toBe(false)
    localStorage.setItem('qizhang.transactions.v1', JSON.stringify([{ ...sampleTransactions[0], occurredAt: '2026-08-18T12:00:00+13:60' }]))
    expect(repository.load()).toEqual(sampleTransactions)
  })

  it('保存和加载保留 offset 分钟在边界内的完整时间戳', () => {
    const repository = createTransactionRepository(localStorage)
    const items = [{ ...sampleTransactions[0], occurredAt: '2026-08-18T12:00:00+13:59' }]

    expect(repository.save(items)).toEqual({ ok: true })
    expect(repository.load()).toEqual(items)
  })

  it('保存和加载都拒绝空标识、非正金额、重复 ID 与非法转账语义', () => {
    const valid = sampleTransactions[0]
    const invalidSets = [
      [{ ...valid, id: ' ' }],
      [{ ...valid, merchant: '' }],
      [{ ...valid, categoryId: '' }],
      [{ ...valid, accountId: '' }],
      [{ ...valid, amount: 0 }],
      [valid, { ...valid }],
      [{ ...valid, kind: 'transfer' as const, categoryId: 'transfer', targetAccountId: undefined }],
      [{ ...valid, kind: 'transfer' as const, categoryId: 'transfer', targetAccountId: valid.accountId }],
      [{ ...valid, targetAccountId: 'bank' }],
    ]

    for (const items of invalidSets) {
      localStorage.clear()
      expect(createTransactionRepository(localStorage).save(items).ok).toBe(false)
      expect(localStorage.getItem('qizhang.transactions.v1')).toBeNull()
      localStorage.setItem('qizhang.transactions.v1', JSON.stringify(items))
      expect(createTransactionRepository(localStorage).load()).toEqual(sampleTransactions)
    }
  })

  it('loadResult 区分无快照种子加载与读取失败的安全回退', () => {
    const repository = createTransactionRepository(localStorage)
    expect(repository.loadResult()).toMatchObject({ ok: true, source: 'seed', data: sampleTransactions })

    const brokenStorage: Storage = { ...localStorage, getItem: () => { throw new Error('denied') } }
    expect(createTransactionRepository(brokenStorage).loadResult()).toMatchObject({ ok: false, data: sampleTransactions })
  })
})
