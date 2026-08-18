import { useEffect, useRef, useState } from 'react'
import { useFinance } from '../../app/FinanceProvider'
import { Toast } from '../../components/Toast'
import { monthKey } from '../../domain/selectors'

function formatAmount(amount: number, kind: 'expense' | 'income' | 'transfer') {
  const prefix = kind === 'income' ? '+' : kind === 'expense' ? '-' : '↔'
  return `${prefix} ¥${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDate(occurredAt: string) {
  const month = Number(occurredAt.slice(5, 7))
  const day = Number(occurredAt.slice(8, 10))
  return `${month} 月 ${day} 日`
}

function formatMonth(month: string) {
  const [year, rawMonth] = month.split('-')
  return `${year} 年 ${Number(rawMonth)} 月`
}

interface SaveError {
  message: string
  deletedTransactionId?: string
}

export function TransactionsPage() {
  const { state, actions } = useFinance()
  const [saveError, setSaveError] = useState<SaveError>()
  const pageRef = useRef<HTMLElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const undoRef = useRef<HTMLButtonElement>(null)
  const previousDeletedTransactionIdRef = useRef<string | undefined>(undefined)
  const months = [...new Set([state.month, state.filter.month, ...state.transactions.map(item => monthKey(item.occurredAt)).filter(Boolean)])].sort().reverse()
  const visible = state.transactions
    .filter(item => state.filter.dateFrom && state.filter.dateTo
      ? item.occurredAt.slice(0, 10) >= state.filter.dateFrom && item.occurredAt.slice(0, 10) <= state.filter.dateTo
      : item.occurredAt.startsWith(state.filter.month))
    .filter(item => !state.filter.kind || item.kind === state.filter.kind)
    .filter(item => !state.filter.kinds || state.filter.kinds.includes(item.kind))
    .filter(item => !state.filter.categoryId || item.categoryId === state.filter.categoryId)
    .filter(item => !state.filter.accountId || item.accountId === state.filter.accountId)
    .filter(item => !state.filter.weekendOnly || [0, 6].includes(new Date(`${item.occurredAt.slice(0, 10)}T00:00:00Z`).getUTCDay()))
  const activeFilterSummary = [
    formatMonth(state.filter.month),
    state.filter.kind && `类型：${({ expense: '支出', income: '收入', transfer: '转账' })[state.filter.kind]}`,
    state.filter.kinds && `类型：${state.filter.kinds.map(kind => ({ expense: '支出', income: '收入', transfer: '转账' })[kind]).join('、')}`,
    state.filter.categoryId && `分类：${state.categories.find(item => item.id === state.filter.categoryId)?.name ?? state.filter.categoryId}`,
    state.filter.accountId && `账户：${state.accounts.find(item => item.id === state.filter.accountId)?.name ?? state.filter.accountId}`,
    state.filter.dateFrom && state.filter.dateTo && `日期：${state.filter.dateFrom} 至 ${state.filter.dateTo}`,
    state.filter.weekendOnly && '仅周末',
  ].filter(Boolean).join('、')

  useEffect(() => {
    const deletedTransactionId = state.deletedTransaction?.id
    if (deletedTransactionId && deletedTransactionId !== previousDeletedTransactionIdRef.current) {
      undoRef.current?.focus()
    } else if (!deletedTransactionId && previousDeletedTransactionIdRef.current && document.activeElement === document.body) {
      const adjacentDelete = pageRef.current?.querySelector<HTMLButtonElement>('[data-delete-transaction]')
      if (adjacentDelete) adjacentDelete.focus()
      else titleRef.current?.focus()
    }
    previousDeletedTransactionIdRef.current = deletedTransactionId
  }, [state.deletedTransaction])

  useEffect(() => {
    if (saveError?.deletedTransactionId && saveError.deletedTransactionId !== state.deletedTransaction?.id) {
      setSaveError(undefined)
    }
  }, [saveError, state.deletedTransaction?.id])

  function deleteTransaction(id: string) {
    const transaction = state.transactions.find(item => item.id === id)
    if (!transaction) return

    setSaveError(undefined)
    const result = actions.deleteTransaction(transaction)
    if (!result.ok) setSaveError({ message: result.message })
  }

  function restoreTransaction() {
    setSaveError(undefined)
    const result = actions.restoreTransaction()
    if (!result.ok) setSaveError({ message: result.message, deletedTransactionId: state.deletedTransaction?.id })
  }

  return (
    <section ref={pageRef} className="transactions-page" aria-labelledby="transactions-title">
      <h1 ref={titleRef} id="transactions-title" tabIndex={-1}>收支明细</h1>
      {(state.filter.sourceLabel || visible.length === 0) && (
        <div className="filter-source">
          {state.filter.sourceLabel && <span>来自洞察：{state.filter.sourceLabel}</span>}
          {(state.filter.sourceLabel || visible.length === 0) && <span>当前筛选：{activeFilterSummary}</span>}
          <button type="button" data-clear-filter onClick={actions.clearFilter}>清除筛选</button>
        </div>
      )}
      <div className="transaction-filters" role="group" aria-label="交易筛选">
        <label>月份
          <select
            name="month"
            value={state.filter.month}
            onChange={event => actions.changeMonth(event.target.value)}
          >
            {months.map(month => <option key={month} value={month}>{formatMonth(month)}</option>)}
          </select>
        </label>
        <label>类型
          <select
            name="kind"
            value={state.filter.kinds?.length === 2 && state.filter.kinds.includes('expense') && state.filter.kinds.includes('income') ? 'income-expense' : state.filter.kind ?? ''}
            onChange={event => actions.changeFilter(event.target.value === 'income-expense'
              ? { ...state.filter, kind: undefined, kinds: ['expense', 'income'] }
              : { ...state.filter, kinds: undefined, kind: event.target.value as typeof state.filter.kind || undefined })}
          >
            <option value="">全部类型</option><option value="income-expense">收支（不含转账）</option><option value="expense">支出</option><option value="income">收入</option><option value="transfer">转账</option>
          </select>
        </label>
        <label>分类
          <select
            name="categoryId"
            value={state.filter.categoryId ?? ''}
            onChange={event => actions.changeFilter({ ...state.filter, categoryId: event.target.value || undefined })}
          >
            <option value="">全部分类</option>{state.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <label>账户
          <select
            name="accountId"
            value={state.filter.accountId ?? ''}
            onChange={event => actions.changeFilter({ ...state.filter, accountId: event.target.value || undefined })}
          >
            <option value="">全部账户</option>{state.accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
        </label>
      </div>
      <div role="table" aria-label="交易明细">
        <div role="row" className="transaction-detail-head">
          <span role="columnheader">交易名称</span><span role="columnheader">分类</span><span role="columnheader">账户</span>
          <span role="columnheader">日期</span><span role="columnheader">备注</span><span role="columnheader">金额</span><span role="columnheader">操作</span>
        </div>
        {visible.map(transaction => {
          const category = state.categories.find(item => item.id === transaction.categoryId)
          const account = state.accounts.find(item => item.id === transaction.accountId)
          const targetAccount = state.accounts.find(item => item.id === transaction.targetAccountId)
          const accountLabel = transaction.kind === 'transfer' && transaction.targetAccountId
            ? `${account?.name ?? transaction.accountId} → ${targetAccount?.name ?? transaction.targetAccountId}`
            : account?.name ?? transaction.accountId

          return (
            <div key={transaction.id} role="row" className="transaction-detail-row" data-transaction-row>
              <span role="cell">{transaction.merchant}</span>
              <span role="cell">{category?.name ?? transaction.categoryId}</span>
              <span role="cell">{accountLabel}</span>
              <span role="cell">{formatDate(transaction.occurredAt)}</span>
              <span role="cell">{transaction.note || '—'}</span>
              <strong role="cell" className={transaction.kind}>{formatAmount(transaction.amount, transaction.kind)}</strong>
              <span role="cell"><button type="button" data-delete-transaction={transaction.id} onClick={() => deleteTransaction(transaction.id)}>删除</button></span>
            </div>
          )
        })}
      </div>
      {visible.length === 0 && <p className="transaction-empty" role="status">未找到交易</p>}
      {saveError && <p className="transaction-save-error" role="alert">{saveError.message}</p>}
      <Toast open={Boolean(state.deletedTransaction)}>
        已删除“{state.deletedTransaction?.merchant}”
        <button ref={undoRef} type="button" data-undo onClick={restoreTransaction}>撤销</button>
      </Toast>
    </section>
  )
}
