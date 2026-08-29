import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { flushSync } from 'react-dom'
import { sampleAccounts, sampleCategories } from '../../domain/sampleData'
import type { AccountLabel, Category } from '../../domain/types'
import { isValidCalendarDate } from '../../domain/selectors'

export interface TransactionDraft {
  kind: 'expense' | 'income' | 'transfer'
  amount: string
  categoryId: string
  accountId: string
  targetAccountId: string
  occurredAt: string
  occurredTime: string
  merchant: string
  note: string
}

export interface QuickEntryDrawerProps {
  open: boolean
  onClose(): void
  onSave(draft: TransactionDraft, options?: { keepDrawerOpen?: boolean; idempotencyKey?: string }): { ok: true } | { ok: false; message: string } | Promise<{ ok: true } | { ok: false; message: string }>
  categories?: Category[]
  accounts?: AccountLabel[]
}

export function isValidOccurredAt(value: string) {
  return isValidCalendarDate(value)
}

function localDateAndTime(now = new Date()) {
  return {
    date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
    time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
  }
}

function emptyDraft(): TransactionDraft {
  const local = localDateAndTime()
  return {
    kind: 'expense',
    amount: '',
    categoryId: 'food',
    accountId: 'wechat',
    targetAccountId: 'alipay',
    occurredAt: local.date,
    occurredTime: local.time,
    merchant: '',
    note: '',
  }
}

export function QuickEntryDrawer({ open, onClose, onSave, categories = sampleCategories, accounts = sampleAccounts }: QuickEntryDrawerProps) {
  const amountRef = useRef<HTMLInputElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const continueRef = useRef<HTMLButtonElement>(null)
  const dateRef = useRef<HTMLInputElement>(null)
  const timeRef = useRef<HTMLInputElement>(null)
  const categoryRef = useRef<HTMLSelectElement>(null)
  const accountRef = useRef<HTMLSelectElement>(null)
  const targetAccountRef = useRef<HTMLSelectElement>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [error, setError] = useState('')
  const [savedNotice, setSavedNotice] = useState('')
  const [confirmingClose, setConfirmingClose] = useState(false)
  const idempotencyKeyRef = useRef<string | undefined>(undefined)
  const activeCategories = useMemo(() => categories.filter(category => category.active), [categories])
  const activeAccounts = useMemo(() => accounts.filter(account => account.active), [accounts])
  const amountError = error === '请输入大于 0 的金额'
  const dateError = error === '请输入有效日期'
  const timeError = error === '请输入有效时间'
  const categoryError = error === '请选择有效分类'
  const accountError = error === '请至少保留一个启用账户' || error === '请选择有效账户'
  const transferAccountError = error === '转出与转入账户不能相同' || error === '请选择有效的转入账户'
  const dirty = draft.amount !== '' || draft.merchant !== '' || draft.note !== ''

  useEffect(() => {
    if (confirmingClose) continueRef.current?.focus()
  }, [confirmingClose])

  useEffect(() => {
    if (open) amountRef.current?.focus()
    if (open && !idempotencyKeyRef.current) idempotencyKeyRef.current = `entry-${Date.now()}-${Math.random().toString(36).slice(2)}`
    if (!open) idempotencyKeyRef.current = undefined
  }, [open])

  useEffect(() => {
    if (!open) return
    setDraft(current => {
      const categoriesForKind = activeCategories.filter(category => category.kind === current.kind)
      const categoryId = current.kind === 'transfer'
        ? ''
        : categoriesForKind.some(category => category.id === current.categoryId)
          ? current.categoryId
          : categoriesForKind[0]?.id ?? ''
      const accountId = activeAccounts.some(account => account.id === current.accountId)
        ? current.accountId
        : activeAccounts[0]?.id ?? ''
      const targetAccountId = activeAccounts.some(account => account.id === current.targetAccountId && account.id !== accountId)
        ? current.targetAccountId
        : activeAccounts.find(account => account.id !== accountId)?.id ?? ''

      if (categoryId === current.categoryId && accountId === current.accountId && targetAccountId === current.targetAccountId) return current
      return { ...current, categoryId, accountId, targetAccountId }
    })
  }, [activeAccounts, activeCategories, open])

  if (!open) return null

  async function save(continueSaving: boolean) {
    const parsedAmount = Number(draft.amount)
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('请输入大于 0 的金额')
      amountRef.current?.focus()
      return
    }
    if (!isValidOccurredAt(draft.occurredAt)) {
      setError('请输入有效日期')
      dateRef.current?.focus()
      return
    }
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(draft.occurredTime)) {
      setError('请输入有效时间')
      timeRef.current?.focus()
      return
    }
    if (activeAccounts.length === 0) {
      setError('请至少保留一个启用账户')
      accountRef.current?.focus()
      return
    }
    if (!activeAccounts.some(account => account.id === draft.accountId)) {
      setError('请选择有效账户')
      accountRef.current?.focus()
      return
    }
    if (draft.kind !== 'transfer' && !activeCategories.some(category => category.kind === draft.kind && category.id === draft.categoryId)) {
      setError('请选择有效分类')
      categoryRef.current?.focus()
      return
    }
    if (draft.kind === 'transfer' && !activeAccounts.some(account => account.id === draft.targetAccountId)) {
      setError('请选择有效的转入账户')
      targetAccountRef.current?.focus()
      return
    }
    if (draft.kind === 'transfer' && draft.accountId === draft.targetAccountId) {
      setError('转出与转入账户不能相同')
      targetAccountRef.current?.focus()
      return
    }

    const result = await onSave(draft, { keepDrawerOpen: continueSaving, idempotencyKey: idempotencyKeyRef.current })
    if (!result.ok) {
      setError(result.message)
      return
    }
    setError('')
    setSavedNotice('交易已保存')
    idempotencyKeyRef.current = `entry-${Date.now()}-${Math.random().toString(36).slice(2)}`
    if (continueSaving) {
      setDraft(current => ({ ...current, amount: '', note: '' }))
      return
    }
    setDraft(emptyDraft())
    onClose()
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    save(false)
  }

  function changeKind(kind: TransactionDraft['kind']) {
    setDraft(current => ({
      ...current,
      kind,
      categoryId: kind === 'transfer' ? '' : activeCategories.find(category => category.kind === kind)?.id ?? '',
    }))
    setError('')
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      requestClose()
      return
    }
    if (event.key === 'Tab') {
      const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'))
      const lastFocusable = focusable[focusable.length - 1]
      const shouldWrapForward = !event.shiftKey && document.activeElement === lastFocusable
      const shouldWrapBackward = event.shiftKey && document.activeElement === focusable[0]
      if (shouldWrapForward || shouldWrapBackward) {
        event.preventDefault()
        const target = shouldWrapBackward ? lastFocusable : focusable[0]
        target?.focus()
      }
    }
  }

  function requestClose() {
    if (dirty) flushSync(() => setConfirmingClose(true))
    else onClose()
  }

  function handleConfirmationKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') { event.preventDefault(); setConfirmingClose(false); cancelRef.current?.focus(); return }
    if (event.key === 'Tab') {
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled])'))
      if (buttons.length && (event.shiftKey ? document.activeElement === buttons[0] : document.activeElement === buttons[buttons.length - 1])) {
        event.preventDefault(); (event.shiftKey ? buttons[buttons.length - 1] : buttons[0]).focus()
      }
    }
  }

  return (
    <div className="quick-entry-overlay">
      <section className="quick-entry-drawer" role="dialog" aria-modal="true" aria-labelledby="quick-entry-title" onKeyDown={handleKeyDown}>
      <div className="quick-entry-heading">
        <h2 id="quick-entry-title">新增交易</h2>
        <p>快速记录此刻的收支变化</p>
      </div>
      <form noValidate onSubmit={submit}>
        <div className="entry-kind-picker" aria-label="交易类型">
          <button type="button" data-kind="expense" aria-pressed={draft.kind === 'expense'} onClick={() => changeKind('expense')}>支出</button>
          <button type="button" data-kind="income" aria-pressed={draft.kind === 'income'} onClick={() => changeKind('income')}>收入</button>
          <button type="button" data-kind="transfer" aria-pressed={draft.kind === 'transfer'} onClick={() => changeKind('transfer')}>转账</button>
        </div>
        <label className="entry-field entry-amount">
          金额
          <input
            ref={amountRef}
            name="amount"
            value={draft.amount}
            aria-invalid={amountError}
            aria-describedby={amountError ? 'entry-error' : undefined}
            onChange={event => {
              setDraft(current => ({ ...current, amount: event.target.value }))
              setError('')
            }}
          />
        </label>
        {draft.kind !== 'transfer' ? (
          <label className="entry-field">
            分类
            <select
              name="categoryId"
              ref={categoryRef}
              value={draft.categoryId}
              aria-invalid={categoryError}
              aria-describedby={categoryError ? 'entry-error' : undefined}
              onChange={event => setDraft(current => ({ ...current, categoryId: event.target.value }))}
            >
              {activeCategories.filter(category => category.kind === draft.kind).map(category => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="entry-field">
          账户
          <select
            name="accountId"
            ref={accountRef}
            value={draft.accountId}
            aria-invalid={accountError}
            aria-describedby={accountError ? 'entry-error' : undefined}
            onChange={event => setDraft(current => ({ ...current, accountId: event.target.value }))}
          >
            {activeAccounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
        </label>
        {draft.kind === 'transfer' ? (
          <label className="entry-field">
            转入账户
            <select
              name="targetAccountId"
              ref={targetAccountRef}
              value={draft.targetAccountId}
              aria-invalid={transferAccountError}
              aria-describedby={transferAccountError ? 'entry-error' : undefined}
              onChange={event => setDraft(current => ({ ...current, targetAccountId: event.target.value }))}
            >
              {activeAccounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
            </select>
          </label>
        ) : null}
        <label className="entry-field">
          日期
          <input
            name="occurredAt"
            type="date"
            ref={dateRef}
            required
            value={draft.occurredAt}
            aria-invalid={dateError}
            aria-describedby={dateError ? 'entry-error' : undefined}
            onChange={event => setDraft(current => ({ ...current, occurredAt: event.target.value }))}
          />
        </label>
        <label className="entry-field">
          时间
          <input
            name="occurredTime"
            type="time"
            ref={timeRef}
            required
            value={draft.occurredTime}
            aria-invalid={timeError}
            aria-describedby={timeError ? 'entry-error' : undefined}
            onChange={event => setDraft(current => ({ ...current, occurredTime: event.target.value }))}
          />
        </label>
        <label className="entry-field">
          商家
          <input
            name="merchant"
            value={draft.merchant}
            onChange={event => setDraft(current => ({ ...current, merchant: event.target.value }))}
          />
        </label>
        <label className="entry-field entry-note">
          备注
          <textarea
            name="note"
            value={draft.note}
            onChange={event => setDraft(current => ({ ...current, note: event.target.value }))}
          />
        </label>
        {error ? <p id="entry-error" role="alert">{error}</p> : null}
        {savedNotice ? <p role="status">{savedNotice}</p> : null}
        <div className="entry-actions">
          <button ref={cancelRef} type="button" className="entry-close" onClick={requestClose}>取消</button>
          <button type="button" className="entry-continue" data-save-continue onClick={() => save(true)}>保存并继续</button>
          <button type="submit" className="entry-save" data-save>保存</button>
        </div>
      </form>
      {confirmingClose ? (
        <div role="alertdialog" aria-modal="true" aria-label="确认关闭" onKeyDown={handleConfirmationKeyDown}>
          <p>有未保存的内容，是否放弃？</p>
          <button ref={continueRef} type="button" onClick={() => { setConfirmingClose(false); cancelRef.current?.focus() }}>继续编辑</button>
          <button type="button" onClick={() => { setConfirmingClose(false); onClose() }}>放弃</button>
        </div>
      ) : null}
      </section>
    </div>
  )
}
