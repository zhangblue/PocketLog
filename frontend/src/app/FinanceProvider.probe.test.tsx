import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { createFixtureApi } from '../test/financeApi'
import { click, render } from '../test/render'
import { FinanceProvider, useFinance, useFinanceActions } from './FinanceProvider'

function Probe() {
  const { state, actions } = useFinance()
  const [result, setResult] = useState('')
  const retry = (panel: Parameters<typeof actions.retryDataLoad>[0]) => actions.retryDataLoad(panel)
  return <>
    <output data-testid="status">{state.dataStatus}:{state.transactionsRequest.status}:{state.overview.status}:{state.analyticsState.status}:{state.report.status}</output>
    <output data-testid="rows">{state.transactions.length}</output>
    <output data-testid="result">{result}</output>
    <button onClick={() => retry('bootstrap')}>重试启动</button><button onClick={() => retry('transactions')}>重试交易</button>
    <button onClick={() => retry('overview')}>重试总览</button><button onClick={() => retry('analytics')}>重试分析</button><button onClick={() => retry('report')}>重试报告</button>
    <button onClick={() => void actions.loadMoreTransactions().then(value => setResult(JSON.stringify(value)))}>加载更多</button>
    <button onClick={() => void Promise.resolve(actions.createCategory({ name: '失败', kind: 'expense' })).then(value => setResult(JSON.stringify(value)))}>标签</button>
    <button onClick={() => void Promise.resolve(actions.addTransaction({ id: 'probe', kind: 'expense', amount: 1, categoryId: 'food', accountId: 'wechat', merchant: 'probe', occurredAt: '2026-08-01T12:00:00+08:00', note: '' })).then(value => setResult(JSON.stringify(value)))}>新增</button>
    <button onClick={async () => { await actions.renameCategory('food', '餐饮改'); await actions.deactivateCategory('entertainment'); await actions.reorderCategories(state.categories.map(item => item.id).reverse()); await actions.createAccount('新账户'); await actions.renameAccount('wechat', '微信改'); await actions.deactivateAccount('alipay'); setResult('ok') }}>管理</button>
  </>
}

describe('FinanceProvider API failure probes', () => {
  it('卸载后延迟 bootstrap resolve 不更新状态或抛错', async () => {
    let resolve!: (value: Awaited<ReturnType<ReturnType<typeof createFixtureApi>['bootstrap']>>) => void
    const deferred = new Promise<Awaited<ReturnType<ReturnType<typeof createFixtureApi>['bootstrap']>>>(r => { resolve = r })
    const api = createFixtureApi()
    const original = api.bootstrap
    api.bootstrap = () => deferred
    const view = await render(<FinanceProvider api={api}><Probe /></FinanceProvider>)
    await view.unmount()
    resolve(await original())
    expect(true).toBe(true)
  })
  it('各面板失败后可通过重试恢复', async () => {
    const api = createFixtureApi({ fail: { bootstrap: 1, transactions: 1, overview: 1, analytics: 1, report: 1 } })
    const { container } = await render(<FinanceProvider api={api}><Probe /></FinanceProvider>)
    await click(container.querySelectorAll('button')[0]); await click(container.querySelectorAll('button')[1]); await click(container.querySelectorAll('button')[2]); await click(container.querySelectorAll('button')[3]); await click(container.querySelectorAll('button')[4])
    expect(container.querySelector('[data-testid="status"]')?.textContent).toContain('ready')
  })

  it('标签 mutation 失败返回可恢复结果', async () => {
    const { container } = await render(<FinanceProvider api={createFixtureApi({ fail: { label: true } })}><Probe /></FinanceProvider>)
    await click(container.querySelectorAll('button')[6])
    expect(container.querySelector('[data-testid="result"]')?.textContent).toContain('false')
  })

  it('Provider 管理 actions 成功更新标签与账户状态', async () => {
    const { container } = await render(<FinanceProvider api={createFixtureApi()}><Probe /></FinanceProvider>)
    await click(container.querySelectorAll('button')[8])
    expect(container.querySelector('[data-testid="result"]')?.textContent).toBe('ok')
  })

  it('revision conflict 返回失败并触发恢复流程', async () => {
    const { container } = await render(<FinanceProvider api={createFixtureApi({ fail: { revisionConflict: 1 } })}><Probe /></FinanceProvider>)
    await click(container.querySelectorAll('button')[7])
    expect(container.querySelector('[data-testid="result"]')?.textContent).toContain('false')
  })

  it('bootstrap 重试失败时保留错误状态', async () => {
    const { container } = await render(<FinanceProvider api={createFixtureApi({ fail: { bootstrap: 2 } })}><Probe /></FinanceProvider>)
    await click(container.querySelectorAll('button')[0])
    expect(container.querySelector('[data-testid="status"]')?.textContent).toContain('error')
  })

  it('Provider 外 useFinance 抛出明确错误', async () => {
    await expect(render(<OutsideFinance />)).rejects.toThrow('useFinance 必须在 FinanceProvider 内使用')
  })

  it('Provider 外 useFinanceActions 抛出明确错误', async () => {
    await expect(render(<OutsideActions />)).rejects.toThrow('useFinanceActions 必须在 FinanceProvider 内使用')
  })

  it('各面板重试失败时分别保持错误状态', async () => {
    const api = createFixtureApi({ fail: { overview: 2, analytics: 2, report: 2 } })
    const { container } = await render(<FinanceProvider api={api}><Probe /></FinanceProvider>)
    await click(container.querySelectorAll('button')[2])
    await click(container.querySelectorAll('button')[3])
    await click(container.querySelectorAll('button')[4])
    expect(container.querySelector('[data-testid="status"]')?.textContent).toContain('error')
  })

})

function OutsideFinance() { useFinance(); return null }
function OutsideActions() { useFinanceActions(); return null }
