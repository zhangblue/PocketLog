import { describe, expect, it, vi } from 'vitest'
import { createFinanceApi } from './financeApi'

function jsonResponse(value: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

const input = {
  kind: 'expense' as const,
  amount: '12.50',
  merchant: '咖啡',
  categoryId: 'category-1',
  accountId: 'account-1',
  occurredAt: '2026-08-27T10:00:00+08:00',
  note: '',
}

describe('FinanceApi', () => {
  it('mutation sends revision and keeps idempotency key across retry', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(jsonResponse({ data: input, dataRevision: 2 }))
    const api = createFinanceApi({ fetch: fetchMock, baseUrl: '/api/v1' })
    await expect(api.createTransaction(input, { revision: 1, idempotencyKey: 'entry-1' })).rejects.toMatchObject({ retryable: true })
    await api.createTransaction(input, { revision: 1, idempotencyKey: 'entry-1' })
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({ 'If-Match': '1', 'Idempotency-Key': 'entry-1' })
  })

  it('normalizes problem JSON and non-JSON server errors without replaying requests', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ code: 'revision_conflict', title: 'Conflict', detail: 'stale', fieldErrors: [], requestId: 'req-1', retryable: false }, { status: 409, headers: { 'content-type': 'application/problem+json', 'x-request-id': 'req-1' } }))
      .mockResolvedValueOnce(new Response('bad gateway', { status: 502, headers: { 'x-request-id': 'req-2' } }))
    const api = createFinanceApi({ fetch: fetchMock })
    await expect(api.createTransaction(input, { revision: 1, idempotencyKey: 'entry-1' })).rejects.toMatchObject({ code: 'revision_conflict', requestId: 'req-1', retryable: false })
    await expect(api.createTransaction(input, { revision: 1, idempotencyKey: 'entry-1' })).rejects.toMatchObject({ code: 'request.server_error', retryable: true, requestId: 'req-2' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('serializes filters and preserves decimal money strings', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [], nextCursor: null, dataRevision: 4 }))
    const api = createFinanceApi({ fetch: fetchMock })
    const response = await api.listTransactions({ month: '2026-08', kinds: ['expense'], accountId: 'a-1', limit: 10 })
    expect(response.dataRevision).toBe(4)
    expect(fetchMock.mock.calls[0][0]).toContain('month=2026-08')
    expect(fetchMock.mock.calls[0][0]).toContain('kind=expense')
    expect(fetchMock.mock.calls[0][0]).toContain('accountId=a-1')
  })

  it('maps the backend snake_case response fields without converting money to numbers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: {
        summary: { expense: '12.50', income: '100.00', transfer: '0.00', balance: '87.50', savings_rate: '87.5', daily_expense: '0.40', transaction_count: 1 },
        trend: [{ date: '2026-08-27', amount: '12.50' }],
        composition: [{ category_id: 'category-1', name: '餐饮', amount: '12.50', included_category_ids: ['category-1'] }],
        category_changes: [{ category_id: 'category-1', name: '餐饮', current: '12.50', previous: '10.00', change_rate: '25.0' }],
      },
      insights: [{ code: 'savings_rate', title: '结余率', description: '...', source_label: '收支', current_filter: { start: '2026-08-01', end: '2026-08-31', category_id: null, account_id: null, weekend_only: false, kinds: ['expense', 'income'] }, previous_filter: null, included_category_ids: null }],
      dataRevision: 3,
    }))
    const api = createFinanceApi({ fetch: fetchMock })
    const response = await api.overview({ month: '2026-08' })
    expect(response.data.summary.expense).toBe('12.50')
    expect(response.data.categoryChanges[0].changeRate).toBe('25.0')
    expect(response.insights[0].drilldown?.currentFilter.dateFrom).toBe('2026-08-01')
  })

  it('maps snake_case transactions and label mutation responses', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [{ id: 't-1', kind: 'expense', amount: '0.10', merchant: '小额', category_id: 'c-1', account_id: 'a-1', occurred_at: '2026-08-27T10:02:03+08:00', note: '' }], next_cursor: null, data_revision: 2 }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'c-1', name: '餐饮', kind: 'expense', emoji: '🍜', color: '#4F8A75', semantic_key: 'food', sort_order: 1, active: true }, data_revision: 3 }))
    const api = createFinanceApi({ fetch: fetchMock })
    const transactions = await api.listTransactions()
    expect(transactions.items[0].amount).toBe('0.10')
    expect(transactions.items[0].localDate).toBe('2026-08-27')
    const mutation = await api.patchCategory('c-1', { name: '餐饮' }, 2)
    expect(mutation.data.semanticKey).toBe('food')
    expect(mutation.data.sortOrder).toBe(1)
  })
})
