import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { useFinance } from '../../app/FinanceProvider'
import type { AccountLabel, Category } from '../../domain/types'

type Editing = { type: 'category'; item: Category } | { type: 'account'; item: AccountLabel } | null
type CategoryEditing = { item: Category; name: string; emoji: string } | null
type PendingDelete = { type: 'delete'; category: Category } | { type: 'migrate'; category: Category } | null

const DEFAULT_CATEGORY_EMOJI = '🏷️'
const expenseCategoryIcons = [
  { emoji: '🏷️', label: '其他' },
  { emoji: '🍜', label: '餐饮' },
  { emoji: '🛒', label: '购物' },
  { emoji: '🚇', label: '交通' },
  { emoji: '📱', label: '通讯' },
  { emoji: '🌐', label: '网络' },
  { emoji: '⚡', label: '水电' },
]
const incomeCategoryIcons = [
  { emoji: '🏷️', label: '其他' },
  { emoji: '💼', label: '工资' },
  { emoji: '🎁', label: '奖金' },
]

function referenced(categoryId: string, transactionCategoryIds: Set<string>) {
  return transactionCategoryIds.has(categoryId)
}

export function LabelsPage() {
  const { state, actions } = useFinance()
  const [tab, setTab] = useState<'categories' | 'accounts'>('categories')
  const [categoryName, setCategoryName] = useState('')
  const [categoryKind, setCategoryKind] = useState<Category['kind']>('expense')
  const [categoryEmoji, setCategoryEmoji] = useState(DEFAULT_CATEGORY_EMOJI)
  const [customEmoji, setCustomEmoji] = useState('')
  const [accountName, setAccountName] = useState('')
  const [editing, setEditing] = useState<Editing>(null)
  const [editingName, setEditingName] = useState('')
  const [categoryEditing, setCategoryEditing] = useState<CategoryEditing>(null)
  const [pending, setPending] = useState<PendingDelete>(null)
  const [migrationTarget, setMigrationTarget] = useState('')
  const [error, setError] = useState('')
  const [dialogError, setDialogError] = useState('')
  const categoryNameRef = useRef<HTMLInputElement>(null)
  const customEmojiRef = useRef<HTMLInputElement>(null)
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

  async function showResult(result: { ok: true } | { ok: false; message: string } | Promise<{ ok: true } | { ok: false; message: string }>) {
    const resolved = await result
    if (resolved.ok) {
      setError('')
      return true
    }
    setError(resolved.message)
    return false
  }

  function startRename(item: Category | AccountLabel, type: 'category' | 'account') {
    // 两种编辑 UI 共享同一展开位，切换时先关闭另一种草稿，避免同时保存两份分类状态。
    setCategoryEditing(null)
    setEditing(type === 'category' ? { type, item: item as Category } : { type, item: item as AccountLabel })
    setEditingName(item.name)
    setError('')
  }

  function startCategoryEditing(category: Category) {
    // 固定集合之外的历史图标放入自定义草稿，保存前不会被选择框意外覆盖。
    setEditing(null)
    setCategoryEditing({ item: category, name: category.name, emoji: category.emoji })
    setError('')
  }

  async function saveCategoryEditing() {
    if (!categoryEditing) return
    const result = await showResult(actions.updateCategory(categoryEditing.item.id, { name: categoryEditing.name, emoji: categoryEditing.emoji }))
    if (result) {
      setCategoryEditing(null)
      setEditing(null)
    }
  }

  async function saveRename() {
    if (!editing) return
    const result = editing.type === 'category'
      ? actions.renameCategory(editing.item.id, editingName)
      : actions.renameAccount(editing.item.id, editingName)
    if (await showResult(result)) {
      setEditing(null)
      setCategoryEditing(null)
    }
  }

  async function submitCategory(event: FormEvent) {
    event.preventDefault()
    if (!categoryName.trim()) {
      setError('请输入分类名称')
      categoryNameRef.current?.focus()
      return
    }
    if (await showResult(actions.createCategory({ name: categoryName, kind: categoryKind, emoji: categoryEmoji }))) setCategoryName('')
  }

  async function submitCustomEmoji(event: FormEvent) {
    event.preventDefault()
    if (!customEmoji.trim()) {
      setError('请输入自定义图标')
      customEmojiRef.current?.focus()
      return
    }
    if (await showResult(actions.createCustomIcon(customEmoji))) setCustomEmoji('')
  }

  function changeCategoryKind(kind: Category['kind']) {
    const nextIcons = kind === 'expense' ? expenseCategoryIcons : incomeCategoryIcons
    const isSharedCustomIcon = state.customIcons.includes(categoryEmoji)
    if (!nextIcons.some(icon => icon.emoji === categoryEmoji) && !isSharedCustomIcon) setCategoryEmoji(DEFAULT_CATEGORY_EMOJI)
    setCategoryKind(kind)
  }

  async function submitAccount(event: FormEvent) {
    event.preventDefault()
    if (await showResult(actions.createAccount(accountName))) setAccountName('')
  }

  function moveCategory(id: string, direction: -1 | 1) {
    const index = state.categories.findIndex(category => category.id === id)
    const target = index + direction
    if (target < 0 || target >= state.categories.length) return
    const orderedIds = state.categories.map(category => category.id)
    ;[orderedIds[index], orderedIds[target]] = [orderedIds[target], orderedIds[index]]
    void showResult(actions.reorderCategories(orderedIds))
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

  async function confirmPending() {
    if (!pending) return
    const result = pending.type === 'delete'
      ? actions.deleteCategory(pending.category.id)
      : actions.migrateCategory(pending.category.id, migrationTarget)
    const resolved = await result
    if (resolved.ok) {
      setError('')
      closePending()
    } else {
      setDialogError(resolved.message)
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
          <form className="custom-icon-library" onSubmit={submitCustomEmoji} aria-label="自定义图标库">
            <label>自定义图标<input ref={customEmojiRef} aria-label="自定义图标库输入" value={customEmoji} onChange={event => setCustomEmoji(event.target.value)} /></label>
            <button type="submit" className="label-form-submit" data-add-custom-icon>添加图标</button>
            <div className="custom-icon-list" aria-label="已保存自定义图标">{state.customIcons.map(icon => <span key={icon}>{icon}</span>)}</div>
          </form>
          <form className="label-create-form" onSubmit={submitCategory}>
            <label>分类名称<input ref={categoryNameRef} aria-label="分类名称" value={categoryName} onChange={event => setCategoryName(event.target.value)} /></label>
            <label>分类类型<select aria-label="分类类型" value={categoryKind} onChange={event => changeCategoryKind(event.target.value as Category['kind'])}><option value="expense">支出</option><option value="income">收入</option></select></label>
            <label>固定图标<select className="label-icon-select" style={{ width: '44px' }} aria-label="分类图标" value={categoryEmoji} onChange={event => setCategoryEmoji(event.target.value)}>{[...(categoryKind === 'expense' ? expenseCategoryIcons : incomeCategoryIcons), ...state.customIcons.filter(icon => !(categoryKind === 'expense' ? expenseCategoryIcons : incomeCategoryIcons).some(item => item.emoji === icon)).map(emoji => ({ emoji, label: '自定义图标' }))].map(icon => <option key={icon.emoji} value={icon.emoji}>{icon.emoji}</option>)}</select></label>
            <button type="submit" className="label-form-submit" data-category-submit>添加分类</button>
          </form>
          <div className="label-list" role="list" aria-label="分类列表">
            {state.categories.map((category, index) => {
              const inUse = referenced(category.id, transactionCategoryIds)
              const isEditing = editing?.type === 'category' && editing.item.id === category.id
              const isCategoryEditing = categoryEditing?.item.id === category.id
              const fixedIcons = category.kind === 'expense' ? expenseCategoryIcons : incomeCategoryIcons
              const iconOptions = [...fixedIcons, ...state.customIcons.filter(icon => !fixedIcons.some(item => item.emoji === icon)).map(emoji => ({ emoji, label: '自定义图标' }))]
              if (!iconOptions.some(icon => icon.emoji === category.emoji)) iconOptions.unshift({ emoji: category.emoji, label: '当前图标' })
              return <article className="label-row" role="listitem" data-category={category.id} key={category.id}>
                <span className="label-symbol" aria-hidden="true">{category.emoji}</span>
                <div className="label-row-main">
                  {isCategoryEditing ? <div className="category-edit-fields">
                    <label><span className="visually-hidden">{category.name} 分类名称</span><input aria-label={`${category.name} 分类名称`} value={categoryEditing.name} onChange={event => setCategoryEditing(current => current ? { ...current, name: event.target.value } : current)} /></label>
                    <label><span className="visually-hidden">{category.name} 分类图标</span><select className="label-icon-select" aria-label={`${category.name} 分类图标`} value={categoryEditing.emoji} onChange={event => setCategoryEditing(current => current ? { ...current, emoji: event.target.value } : current)}>{iconOptions.map(icon => <option key={icon.emoji} value={icon.emoji}>{icon.emoji}</option>)}</select></label>
                  </div> : isEditing ? <label><span className="visually-hidden">{category.name} 分类名称</span><input aria-label={`${category.name} 分类名称`} value={editingName} onChange={event => setEditingName(event.target.value)} /></label> : <strong>{category.name}</strong>}
                  <small>{category.kind === 'expense' ? '支出分类' : '收入分类'} · {category.active ? '启用中' : '已停用'}{inUse ? ' · 已有历史记录' : ''}</small>
                </div>
                <div className="label-row-actions">
                  {isCategoryEditing ? <><button type="button" data-save-category onClick={saveCategoryEditing}>保存</button><button type="button" data-cancel-category onClick={() => { setCategoryEditing(null); setEditing(null) }}>取消</button></> : isEditing ? <><button type="button" data-save-rename onClick={saveRename}>保存</button><button type="button" onClick={() => { setEditing(null); setCategoryEditing(null) }}>取消</button></> : <><button type="button" aria-label={`编辑 ${category.name}`} onClick={() => startCategoryEditing(category)}>编辑</button><button type="button" data-rename onClick={() => startRename(category, 'category')}>重命名</button></>}
                  <button type="button" aria-label={`上移 ${category.name}`} disabled={index === 0} onClick={() => moveCategory(category.id, -1)}>↑</button>
                  <button type="button" aria-label={`下移 ${category.name}`} disabled={index === state.categories.length - 1} onClick={() => moveCategory(category.id, 1)}>↓</button>
                  {category.active ? <button type="button" data-deactivate onClick={() => showResult(actions.deactivateCategory(category.id))}>停用</button> : <>
                    <button type="button" data-activate onClick={() => showResult(actions.activateCategory(category.id))}>启用</button>
                    {inUse ? <button type="button" data-migrate onClick={(event: ReactMouseEvent<HTMLButtonElement>) => requestMigration(category, event.currentTarget)}>迁移并删除</button> : <button type="button" data-delete onClick={(event: ReactMouseEvent<HTMLButtonElement>) => { requestDelete(category, event.currentTarget); setError('') }}>删除</button>}
                  </>}
                </div>
              </article>
            })}
          </div>
        </>
      ) : (
        <>
          <form className="label-create-form" onSubmit={submitAccount}>
            <label>账户名称<input value={accountName} onChange={event => setAccountName(event.target.value)} /></label>
            <button type="submit" className="label-form-submit">添加账户标签</button>
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
