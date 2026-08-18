import { useRef, type ReactNode } from 'react'
import { useFinance } from '../app/FinanceProvider'
import type { Transaction, ViewId } from '../domain/types'
import { QuickEntryDrawer, isValidOccurredAt, type TransactionDraft } from '../features/entry/QuickEntryDrawer'
import { isValidOccurredAt as isValidIsoTimestamp, monthKey } from '../domain/selectors'

const navItems: readonly { view: ViewId; label: string; symbol: string }[] = [
  { view: 'overview', label: '总览', symbol: '◈' },
  { view: 'transactions', label: '收支明细', symbol: '↔' },
  { view: 'analytics', label: '消费分析', symbol: '◒' },
  { view: 'reports', label: '月度报告', symbol: '▤' },
  { view: 'labels', label: '分类管理', symbol: '◇' },
]

export function createTransactionFromDraft(draft: TransactionDraft, id: string): Transaction | undefined {
  if (!isValidOccurredAt(draft.occurredAt) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(draft.occurredTime)) return undefined
  const [year, month, day] = draft.occurredAt.split('-').map(Number)
  const [hour, minute] = draft.occurredTime.split(':').map(Number)
  const local = new Date(year, month - 1, day, hour, minute, 0, 0)
  if (local.getFullYear() !== year || local.getMonth() !== month - 1 || local.getDate() !== day || local.getHours() !== hour || local.getMinutes() !== minute) return undefined
  const offsetMinutes = -local.getTimezoneOffset()
  const offsetSign = offsetMinutes >= 0 ? '+' : '-'
  const offset = `${offsetSign}${String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0')}:${String(Math.abs(offsetMinutes) % 60).padStart(2, '0')}`
  const occurredAt = `${draft.occurredAt}T${draft.occurredTime}:00${offset}`
  if (!isValidIsoTimestamp(occurredAt)) return undefined

  return {
    id,
    kind: draft.kind,
    amount: Number(draft.amount),
    categoryId: draft.kind === 'transfer' ? 'transfer' : draft.categoryId,
    accountId: draft.accountId,
    targetAccountId: draft.kind === 'transfer' ? draft.targetAccountId : undefined,
    occurredAt,
    merchant: draft.merchant || (draft.kind === 'transfer' ? '账户转账' : '新交易'),
    note: draft.note,
  }
}

function TemporaryPage({ view }: { view: ViewId }) {
  const { state } = useFinance()
  const title = navItems.find(item => item.view === view)?.label ?? '页面'
  const categoryName = state.filter.categoryId
    ? state.categories.find(category => category.id === state.filter.categoryId)?.name
    : undefined
  const detail = state.filter.sourceLabel ?? categoryName ?? '功能将在后续任务中提供。'

  return (
    <section className="temporary-page" aria-labelledby="temporary-page-title">
      <p className="eyebrow">栖账</p>
      <h1 id="temporary-page-title">{title}</h1>
      <p>{detail}</p>
    </section>
  )
}

export function AppShell({ children, transactionsPage, analyticsPage, reportsPage, labelsPage }: { children: ReactNode; transactionsPage?: ReactNode; analyticsPage?: ReactNode; reportsPage?: ReactNode; labelsPage?: ReactNode }) {
  const { state, actions } = useFinance()
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const months = [...new Set([state.month, ...state.transactions.map(item => monthKey(item.occurredAt)).filter(Boolean)])].sort().reverse()

  function saveDraft(draft: TransactionDraft, options?: { keepDrawerOpen?: boolean }) {
    const transaction = createTransactionFromDraft(draft, `tx-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    if (!transaction) return { ok: false, message: '请输入有效日期' }

    return actions.addTransaction(transaction, options)
  }

  function closeDrawer() {
    actions.closeDrawer()
    addButtonRef.current?.focus()
  }

  return (
    <div className="app-shell">
      <aside className="app-sidebar" aria-label="主导航">
        <strong className="brand"><span aria-hidden="true">栖</span><span className="brand-name">栖账</span></strong>
        <nav aria-label="账本页面">
          {navItems.map(({ view, label, symbol }) => (
            <button
              key={view}
              type="button"
              className="nav-button"
              aria-label={label}
              aria-current={state.view === view ? 'page' : undefined}
              onClick={() => actions.changeView(view)}
            >
              <span className="nav-symbol" aria-hidden="true">{symbol}</span>
              <span className="nav-label" aria-hidden="true">{label}</span>
            </button>
          ))}
        </nav>
        <p className="sidebar-profile">林默<br /><small>个人账本</small></p>
      </aside>
      <main className="app-main" data-active-view={state.view}>
        <header className="topbar">
          <div>
            <p className="eyebrow">下午好，林默</p>
          </div>
          <div className="top-actions">
            <select aria-label="月份" value={state.month} onChange={event => actions.changeMonth(event.target.value)}>
              {months.map(month => <option key={month} value={month}>{month.slice(0, 4)} 年 {Number(month.slice(5))} 月</option>)}
            </select>
            <button ref={addButtonRef} type="button" className="add-transaction" onClick={actions.openDrawer}>记一笔</button>
          </div>
        </header>
        {state.view === 'overview'
          ? children
          : state.view === 'transactions' && transactionsPage
            ? transactionsPage
            : state.view === 'analytics' && analyticsPage
              ? analyticsPage
              : state.view === 'reports' && reportsPage
                ? reportsPage
                : state.view === 'labels' && labelsPage
                  ? labelsPage
                : <TemporaryPage view={state.view} />}
        <QuickEntryDrawer
          open={state.drawerOpen}
          onClose={closeDrawer}
          onSave={saveDraft}
          categories={state.categories}
          accounts={state.accounts}
        />
      </main>
    </div>
  )
}
