import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { useFinance } from '../../app/FinanceProvider'
import type { AccountLabel, Category } from '../../domain/types'

type Editing = { type: 'category'; item: Category } | { type: 'account'; item: AccountLabel } | null
type PendingDelete = { type: 'delete'; category: Category } | { type: 'migrate'; category: Category } | null

function referenced(categoryId: string, transactionCategoryIds: Set<string>) {
  return transactionCategoryIds.has(categoryId)
}

export function LabelsPage() {
  const { state, actions } = useFinance()
  const [tab, setTab] = useState<'categories' | 'accounts'>('categories')
  const [categoryName, setCategoryName] = useState('')
  const [categoryKind, setCategoryKind] = useState<Category['kind']>('expense')
  const [accountName, setAccountName] = useState('')
  const [editing, setEditing] = useState<Editing>(null)
  const [editingName, setEditingName] = useState('')
  const [pending, setPending] = useState<PendingDelete>(null)
  const [migrationTarget, setMigrationTarget] = useState('')
  const [error, setError] = useState('')
  const [dialogError, setDialogError] = useState('')
  const cancelRef = useRef<HTMLButtonElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const pendingTriggerRef = useRef<HTMLElement | null>(null)
  const transactionCategoryIds = new Set(state.transactions.map(transaction => transaction.categoryId))

  useEffect(() => {
    if (pending) {
      cancelRef.current?.focus()
      return
    }
    const trigger = pendingTriggerRef.current
    if (!trigger) return
    pendingTriggerRef.current = null
    if (document.contains(trigger) && !trigger.hasAttribute('disabled')) trigger.focus()
    else titleRef.current?.focus()
  }, [pending])

  useEffect(() => {
    const background = document.querySelectorAll<HTMLElement>('.app-sidebar, .topbar')
    background.forEach(element => { element.inert = Boolean(pending) })
    return () => background.forEach(element => { element.inert = false })
  }, [pending])

  function showResult(result: { ok: true } | { ok: false; message: string }) {
    if (result.ok) {
      setError('')
      return true
    }
    setError(result.message)
    return false
  }

  function startRename(item: Category | AccountLabel, type: 'category' | 'account') {
    setEditing(type === 'category' ? { type, item: item as Category } : { type, item: item as AccountLabel })
    setEditingName(item.name)
    setError('')
  }

  function saveRename() {
    if (!editing) return
    const result = editing.type === 'category'
      ? actions.renameCategory(editing.item.id, editingName)
      : actions.renameAccount(editing.item.id, editingName)
    if (showResult(result)) setEditing(null)
  }

  function submitCategory(event: FormEvent) {
    event.preventDefault()
    if (showResult(actions.createCategory({ name: categoryName, kind: categoryKind }))) setCategoryName('')
  }

  function submitAccount(event: FormEvent) {
    event.preventDefault()
    if (showResult(actions.createAccount(accountName))) setAccountName('')
  }

  function moveCategory(id: string, direction: -1 | 1) {
    const index = state.categories.findIndex(category => category.id === id)
    const target = index + direction
    if (target < 0 || target >= state.categories.length) return
    const orderedIds = state.categories.map(category => category.id)
    ;[orderedIds[index], orderedIds[target]] = [orderedIds[target], orderedIds[index]]
    showResult(actions.reorderCategories(orderedIds))
  }

  function closePending() {
    setDialogError('')
    setPending(null)
  }

  function requestDelete(category: Category, trigger: HTMLElement) {
    pendingTriggerRef.current = trigger
    setDialogError('')
    setPending({ type: 'delete', category })
  }

  function requestMigration(category: Category, trigger: HTMLElement) {
    const target = state.categories.find(item => item.id !== category.id && item.kind === category.kind && item.active)
    pendingTriggerRef.current = trigger
    setMigrationTarget(target?.id ?? '')
    setPending({ type: 'migrate', category })
    setError('')
    setDialogError('')
  }

  function confirmPending() {
    if (!pending) return
    const result = pending.type === 'delete'
      ? actions.deleteCategory(pending.category.id)
      : actions.migrateCategory(pending.category.id, migrationTarget)
    if (result.ok) {
      setError('')
      closePending()
    } else {
      setDialogError(result.message)
    }
  }

  function dialogKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      closePending()
      return
    }
    if (event.key === 'Tab') {
      const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'))
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if ((!event.shiftKey && document.activeElement === last) || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first)?.focus()
      }
    }
  }

  return (
    <section className="labels-page" aria-labelledby="labels-title">
      <div className="labels-page-content" inert={Boolean(pending) || undefined}>
      <p className="eyebrow">账本设置</p>
      <h1 id="labels-title" ref={titleRef} tabIndex={-1}>分类管理</h1>
      <p className="labels-intro">分类和支付账户只用于记账标记，不计算余额或资产。</p>
      <div className="labels-tabs" role="tablist" aria-label="标签类型">
        <button type="button" role="tab" data-tab="categories" aria-selected={tab === 'categories'} onClick={() => setTab('categories')}>分类</button>
        <button type="button" role="tab" data-tab="accounts" aria-selected={tab === 'accounts'} onClick={() => setTab('accounts')}>账户标签</button>
      </div>

      {tab === 'categories' ? (
        <>
          <form className="label-create-form" onSubmit={submitCategory}>
            <label>分类名称<input value={categoryName} onChange={event => setCategoryName(event.target.value)} /></label>
            <label>分类类型<select value={categoryKind} onChange={event => setCategoryKind(event.target.value as Category['kind'])}><option value="expense">支出</option><option value="income">收入</option></select></label>
            <button type="submit">添加分类</button>
          </form>
          <div className="label-list" role="list" aria-label="分类列表">
            {state.categories.map((category, index) => {
              const inUse = referenced(category.id, transactionCategoryIds)
              const isEditing = editing?.type === 'category' && editing.item.id === category.id
              return <article className="label-row" role="listitem" data-category={category.id} key={category.id}>
                <span className="label-symbol" aria-hidden="true">{category.emoji}</span>
                <div className="label-row-main">
                  {isEditing ? <label><span className="visually-hidden">{category.name} 分类名称</span><input aria-label={`${category.name} 分类名称`} value={editingName} onChange={event => setEditingName(event.target.value)} /></label> : <strong>{category.name}</strong>}
                  <small>{category.kind === 'expense' ? '支出分类' : '收入分类'} · {category.active ? '启用中' : '已停用'}{inUse ? ' · 已有历史记录' : ''}</small>
                </div>
                <div className="label-row-actions">
                  {isEditing ? <><button type="button" data-save-rename onClick={saveRename}>保存</button><button type="button" onClick={() => setEditing(null)}>取消</button></> : <button type="button" data-rename onClick={() => startRename(category, 'category')}>重命名</button>}
                  <button type="button" aria-label={`上移 ${category.name}`} disabled={index === 0} onClick={() => moveCategory(category.id, -1)}>↑</button>
                  <button type="button" aria-label={`下移 ${category.name}`} disabled={index === state.categories.length - 1} onClick={() => moveCategory(category.id, 1)}>↓</button>
                  {category.active ? <button type="button" data-deactivate onClick={() => showResult(actions.deactivateCategory(category.id))}>停用</button> : null}
                  {inUse ? <button type="button" data-migrate onClick={(event: ReactMouseEvent<HTMLButtonElement>) => requestMigration(category, event.currentTarget)}>迁移并删除</button> : <button type="button" data-delete onClick={(event: ReactMouseEvent<HTMLButtonElement>) => { requestDelete(category, event.currentTarget); setError('') }}>删除</button>}
                </div>
              </article>
            })}
          </div>
        </>
      ) : (
        <>
          <form className="label-create-form" onSubmit={submitAccount}>
            <label>账户名称<input value={accountName} onChange={event => setAccountName(event.target.value)} /></label>
            <button type="submit">添加账户标签</button>
          </form>
          <div className="label-list" role="list" aria-label="账户标签列表">
            {state.accounts.map(account => {
              const isEditing = editing?.type === 'account' && editing.item.id === account.id
              return <article className="label-row" role="listitem" data-account={account.id} key={account.id}>
                <span className="label-symbol" aria-hidden="true">◌</span>
                <div className="label-row-main">
                  {isEditing ? <label><span className="visually-hidden">{account.name} 账户名称</span><input aria-label={`${account.name} 账户名称`} value={editingName} onChange={event => setEditingName(event.target.value)} /></label> : <strong>{account.name}</strong>}
                  <small>{account.active ? '启用中' : '已停用'} · 仅作支付来源标签</small>
                </div>
                <div className="label-row-actions">
                  {isEditing ? <><button type="button" data-save-rename onClick={saveRename}>保存</button><button type="button" onClick={() => setEditing(null)}>取消</button></> : <button type="button" data-rename onClick={() => startRename(account, 'account')}>重命名</button>}
                  {account.active ? <button type="button" data-deactivate onClick={() => showResult(actions.deactivateAccount(account.id))}>停用</button> : null}
                </div>
              </article>
            })}
          </div>
        </>
      )}
      {error ? <p className="label-error" role="alert">{error}</p> : null}
      </div>
      {pending ? (
        <div className="label-dialog-backdrop">
          <section className="label-dialog" role="dialog" aria-modal="true" aria-labelledby="label-dialog-title" aria-describedby={dialogError ? 'label-dialog-description label-dialog-error' : 'label-dialog-description'} onKeyDown={dialogKeyDown}>
            <h2 id="label-dialog-title">{pending.type === 'delete' ? '删除分类' : '迁移并删除分类'}</h2>
            {pending.type === 'delete' ? <p id="label-dialog-description">确认删除“{pending.category.name}”？此操作无法撤销。</p> : <>
              <p id="label-dialog-description">“{pending.category.name}”的历史记录将迁移到所选分类后删除。</p>
              {state.categories.some(category => category.id !== pending.category.id && category.kind === pending.category.kind && category.active) ? <label>迁移至<select aria-label="迁移至" value={migrationTarget} onChange={event => setMigrationTarget(event.target.value)}>
                {state.categories.filter(category => category.id !== pending.category.id && category.kind === pending.category.kind && category.active).map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select></label> : <p className="label-dialog-warning">没有可用的同类型启用分类，无法迁移。</p>}
            </>}
            {dialogError ? <p id="label-dialog-error" role="alert" className="label-dialog-error">{dialogError}</p> : null}
            <div className="label-dialog-actions"><button type="button" ref={cancelRef} onClick={closePending}>取消</button><button type="button" data-confirm-delete disabled={pending.type === 'migrate' && !migrationTarget} onClick={confirmPending}>{pending.type === 'delete' ? '确认删除' : '确认迁移并删除'}</button></div>
          </section>
        </div>
      ) : null}
    </section>
  )
}
