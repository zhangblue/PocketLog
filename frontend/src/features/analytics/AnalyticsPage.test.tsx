import { describe, expect, it, vi } from 'vitest'
import type { Transaction } from '../../domain/types'
import { changeInput, changeSelect, click, keyDown, render } from '../../test/render'
import { App } from '../../app/App'

describe('AnalyticsPage', () => {
  it('分析汇总金额仅在确有小数时显示两位且不丢值', async () => {
    const transactions: Transaction[] = [
      { id: 'current', kind: 'expense', amount: 10.25, categoryId: 'food', accountId: 'cash', merchant: '本期小数', occurredAt: '2026-08-08T12:00:00+08:00', note: '' },
      { id: 'previous', kind: 'expense', amount: 8, categoryId: 'food', accountId: 'cash', merchant: '上期整数', occurredAt: '2026-07-08T12:00:00+08:00', note: '' },
    ]
    const repository = { load: () => transactions, save: () => ({ ok: true } as const) }
    const { container } = await render(<App initialView="analytics" repository={repository} />)

    expect(container.querySelector('[data-category-share="food"]')?.textContent).toContain('¥10.25')
    expect(container.querySelector('[data-category-comparison="food"]')?.textContent).toContain('¥10.25')
  })

  it('点击交通洞察后进入已筛选明细', async () => {
    const { container } = await render(<App initialView="analytics" />)

    const insight = container.querySelector<HTMLButtonElement>('[data-insight="transport-weekend"]')
    expect(insight).toBeTruthy()
    if (!insight) return

    await click(insight)

    expect(container.textContent).toContain('来自洞察：周末交通支出偏高')
    expect(container.querySelector('[data-active-view]')?.getAttribute('data-active-view')).toBe('transactions')
  })

  it('提供真实的支出趋势摘要和可下钻的日期柱', async () => {
    const { container } = await render(<App initialView="analytics" />)

    expect(container.querySelector('svg[role="img"]')).toBeTruthy()
    expect(container.querySelector('.analytics-trend-panel.async-panel h2')?.textContent).toBe('支出趋势')
    expect(container.querySelector('svg title')?.textContent).toBe('支出趋势')
    expect(container.querySelector('svg desc')?.textContent).toContain('2026-08-02')
    expect(container.querySelector('[data-trend-bar="2026-08-02"]')?.textContent).toContain('¥1,050')
    expect(container.querySelector('figcaption')?.textContent).toContain('2026-08-02')

    await click(container.querySelector<HTMLButtonElement>('[data-trend-bar="2026-08-02"]')!)

    expect(container.textContent).toContain('来自洞察：2026-08-02 支出')
    expect(container.textContent).toContain('本月交通')
    expect(container.textContent).not.toContain('山丘咖啡')
  })

  it('仅在连续历史足够时启用近 3 月，并提供有边界校验的自定义起止范围', async () => {
    const { container } = await render(<App initialView="analytics" />)

    expect(container.querySelector('[data-range="month"]')?.textContent).toContain('本月')
    expect(container.querySelector<HTMLButtonElement>('[data-range="three-months"]')?.disabled).toBe(true)
    expect(container.textContent).toContain('历史数据不足，尚不能生成近 3 月趋势。')

    await click(container.querySelector<HTMLButtonElement>('[data-range="custom"]')!)
    await changeInput(container.querySelector<HTMLInputElement>('[data-custom-start]')!, '2026-08-20')
    await changeInput(container.querySelector<HTMLInputElement>('[data-custom-end]')!, '2026-08-10')

    expect(container.textContent).toContain('起始日期不能晚于结束日期')
    expect(container.querySelector('h1')?.textContent).not.toContain('NaN')
  })

  it('按账户筛选对比，并通过键盘将真实筛选 payload 传入明细页', async () => {
    const { container } = await render(<App initialView="analytics" />)

    await changeSelect(container.querySelector<HTMLSelectElement>('[data-analytics-account]')!, 'wechat')
    const food = container.querySelector<HTMLButtonElement>('[data-category-comparison="food"]')!
    food.focus()
    await keyDown(food, 'Enter')

    expect(container.querySelector('[data-active-view]')?.getAttribute('data-active-view')).toBe('transactions')
    expect(container.textContent).toContain('来自洞察：餐饮支出对比')
    expect(container.querySelector<HTMLSelectElement>('select[name="categoryId"]')?.value).toBe('food')
    expect(container.querySelector<HTMLSelectElement>('select[name="accountId"]')?.value).toBe('wechat')
    expect(container.querySelector<HTMLSelectElement>('select[name="month"]')?.value).toBe('2026-08')
    expect([...container.querySelectorAll('[data-transaction-row]')].every(row => row.textContent?.includes('餐饮') && row.textContent?.includes('微信支付'))).toBe(true)
  })

  it('停用当前分析账户后保留历史筛选选项和真实过滤条件', async () => {
    const { container } = await render(<App initialView="analytics" />)
    const accountSelect = container.querySelector<HTMLSelectElement>('[data-analytics-account]')!

    await changeSelect(accountSelect, 'wechat')
    await click(container.querySelector<HTMLButtonElement>('[aria-label="分类管理"]')!)
    await click(container.querySelector<HTMLButtonElement>('[data-tab="accounts"]')!)
    await click(container.querySelector<HTMLButtonElement>('[data-account="wechat"] [data-deactivate]')!)
    await click(container.querySelector<HTMLButtonElement>('[aria-label="消费分析"]')!)

    const historicalSelect = container.querySelector<HTMLSelectElement>('[data-analytics-account]')!
    expect(historicalSelect.value).toBe('wechat')
    expect(historicalSelect.querySelector('option[value="wechat"]')?.textContent).toContain('已停用')
    expect(container.querySelector('[data-category-share="food"]')?.textContent).toContain('¥1,010')
  })

  it('展示样例餐饮、交通和购物的真实分类环比', async () => {
    const { container } = await render(<App initialView="analytics" />)

    expect(container.querySelector('[data-category-comparison="food"]')?.textContent).toContain('下降 18%')
    expect(container.querySelector('[data-category-comparison="transport"]')?.textContent).toContain('增长 12%')
    expect(container.querySelector('[data-category-comparison="shopping"]')?.textContent).toContain('下降 6%')
    expect(container.querySelector('[data-category-comparison="food"]')?.textContent).toContain('↓')
    expect(container.querySelector('[data-category-comparison="transport"]')?.textContent).toContain('↑')
  })

  it('没有支出时展示空态而非无意义的零值图表', async () => {
    const repository = { load: () => [] as Transaction[], save: () => ({ ok: true } as const) }
    const { container } = await render(<App initialView="analytics" repository={repository} />)

    expect(container.textContent).toContain('暂无符合条件的支出数据')
    expect(container.querySelector('[data-category-comparison]')).toBeNull()
    expect(container.querySelector('svg')).toBeNull()
    await click(container.querySelector<HTMLButtonElement>('.empty-state-first-use button')!)
    expect(container.querySelector('[role="dialog"]')).toBeTruthy()
  })

  it('无结果空态清除账户和自定义范围，恢复到本月分析', async () => {
    const { container } = await render(<App initialView="analytics" />)

    await click(container.querySelector<HTMLButtonElement>('[data-range="custom"]')!)
    await changeSelect(container.querySelector<HTMLSelectElement>('[data-analytics-account]')!, 'cash')
    expect(container.querySelector('.empty-state-no-results button')?.textContent).toBe('清除筛选')

    await click(container.querySelector<HTMLButtonElement>('.empty-state-no-results button')!)

    expect(container.querySelector<HTMLSelectElement>('[data-analytics-account]')?.value).toBe('')
    expect(container.querySelector<HTMLButtonElement>('[data-range="month"]')?.getAttribute('aria-pressed')).toBe('true')
  })

  it('历史不足空态提供继续记账并打开真实快捷记账层', async () => {
    const { container } = await render(<App initialView="analytics" />)

    await click(container.querySelector<HTMLButtonElement>('.empty-state-insufficient-history button')!)

    expect(container.querySelector('[role="dialog"]')).toBeTruthy()
  })

  it('上期为零时不伪造分类增长结论', async () => {
    const transactions: Transaction[] = [{
      id: 'august-food', kind: 'expense', amount: 80, categoryId: 'food', accountId: 'wechat', merchant: '午餐', occurredAt: '2026-08-08T12:00:00+08:00', note: '',
    }]
    const repository = { load: () => transactions, save: () => ({ ok: true } as const) }
    const { container } = await render(<App initialView="analytics" repository={repository} />)

    expect(container.querySelector('[data-category-comparison="food"]')?.textContent).toContain('暂无上期可比数据')
    expect(container.textContent).not.toContain('增长 0%')
  })

  it('在连续三个月有数据时启用近 3 月，并在下钻后恢复账户上下文', async () => {
    const transactions: Transaction[] = [
      { id: 'june-food', kind: 'expense', amount: 20, categoryId: 'food', accountId: 'wechat', merchant: '六月餐饮', occurredAt: '2026-06-08T12:00:00+08:00', note: '' },
      { id: 'july-food', kind: 'expense', amount: 30, categoryId: 'food', accountId: 'wechat', merchant: '七月餐饮', occurredAt: '2026-07-08T12:00:00+08:00', note: '' },
      { id: 'august-food', kind: 'expense', amount: 40, categoryId: 'food', accountId: 'wechat', merchant: '八月餐饮', occurredAt: '2026-08-08T12:00:00+08:00', note: '' },
    ]
    const repository = { load: () => transactions, save: () => ({ ok: true } as const) }
    const { container } = await render(<App initialView="analytics" repository={repository} />)

    expect(container.querySelector<HTMLButtonElement>('[data-range="three-months"]')?.disabled).toBe(false)
    await click(container.querySelector<HTMLButtonElement>('[data-range="three-months"]')!)
    expect(container.textContent).toContain('2026-06-01 至 2026-08-31')

    await changeSelect(container.querySelector<HTMLSelectElement>('[data-analytics-account]')!, 'wechat')
    await click(container.querySelector<HTMLButtonElement>('[data-category-share="food"]')!)
    await click(container.querySelector<HTMLButtonElement>('[aria-label="消费分析"]')!)

    expect(container.querySelector<HTMLSelectElement>('[data-analytics-account]')?.value).toBe('wechat')
    expect(container.querySelector<HTMLButtonElement>('[data-range="three-months"]')?.getAttribute('aria-pressed')).toBe('true')
  })

  it('周末交通洞察只下钻到真实周末交通交易', async () => {
    const { container } = await render(<App initialView="analytics" />)

    await click(container.querySelector<HTMLButtonElement>('[data-insight="transport-weekend"]')!)

    const rows = [...container.querySelectorAll('[data-transaction-row]')]
    expect(rows.map(row => row.textContent)).toEqual([expect.stringContaining('本月交通')])
    expect(container.textContent).not.toContain('城市出行')
    expect(rows.every(row => row.textContent?.includes('交通'))).toBe(true)
  })

  it('下钻返回只恢复一次滚动位置，普通再次进入不重复恢复', async () => {
    vi.mocked(window.scrollTo).mockClear()
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 160 })
    const { container } = await render(<App initialView="analytics" />)

    await click(container.querySelector<HTMLButtonElement>('[data-category-share="food"]')!)
    await click(container.querySelector<HTMLButtonElement>('[aria-label="消费分析"]')!)
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 160 })
    expect(window.scrollTo).toHaveBeenCalledTimes(1)

    await click(container.querySelector<HTMLButtonElement>('[aria-label="总览"]')!)
    await click(container.querySelector<HTMLButtonElement>('[aria-label="消费分析"]')!)
    expect(window.scrollTo).toHaveBeenCalledTimes(1)

    await click(container.querySelector<HTMLButtonElement>('[data-range="custom"]')!)
    await click(container.querySelector<HTMLButtonElement>('[data-range="month"]')!)
    expect(container.textContent).toContain('2026-08-01 至 2026-08-31')
  })

  it('趋势日期下钻只展示同日支出，不混入收入或转账', async () => {
    const transactions: Transaction[] = [
      { id: 'expense', kind: 'expense', amount: 30, categoryId: 'food', accountId: 'wechat', merchant: '同日支出', occurredAt: '2026-08-05T12:00:00+08:00', note: '' },
      { id: 'income', kind: 'income', amount: 40, categoryId: 'salary', accountId: 'wechat', merchant: '同日收入', occurredAt: '2026-08-05T13:00:00+08:00', note: '' },
      { id: 'transfer', kind: 'transfer', amount: 50, categoryId: 'transfer', accountId: 'wechat', targetAccountId: 'bank', merchant: '同日转账', occurredAt: '2026-08-05T14:00:00+08:00', note: '' },
    ]
    const repository = { load: () => transactions, save: () => ({ ok: true } as const) }
    const { container } = await render(<App initialView="analytics" repository={repository} />)

    await click(container.querySelector<HTMLButtonElement>('[data-trend-bar="2026-08-05"]')!)

    expect(container.textContent).toContain('同日支出')
    expect(container.textContent).not.toContain('同日收入')
    expect(container.textContent).not.toContain('同日转账')
    expect(container.querySelector<HTMLSelectElement>('select[name="kind"]')?.value).toBe('expense')
  })

  it('结余率洞察下钻保留收支证据、排除转账，且允许二次类型筛选', async () => {
    const transactions: Transaction[] = [
      { id: 'expense', kind: 'expense', amount: 60, categoryId: 'food', accountId: 'wechat', merchant: '本期支出', occurredAt: '2026-08-08T12:00:00+08:00', note: '' },
      { id: 'income', kind: 'income', amount: 100, categoryId: 'salary', accountId: 'wechat', merchant: '本期收入', occurredAt: '2026-08-09T12:00:00+08:00', note: '' },
      { id: 'transfer', kind: 'transfer', amount: 30, categoryId: 'transfer', accountId: 'wechat', targetAccountId: 'bank', merchant: '本期转账', occurredAt: '2026-08-10T12:00:00+08:00', note: '' },
    ]
    const repository = { load: () => transactions, save: () => ({ ok: true } as const) }
    const { container } = await render(<App initialView="analytics" repository={repository} />)

    await click(container.querySelector<HTMLButtonElement>('[data-insight="savings-rate"]')!)

    const kind = container.querySelector<HTMLSelectElement>('select[name="kind"]')!
    expect(kind.value).toBe('income-expense')
    expect(container.textContent).toContain('本期支出')
    expect(container.textContent).toContain('本期收入')
    expect(container.textContent).not.toContain('本期转账')
    await changeSelect(kind, 'expense')
    expect(container.textContent).toContain('本期支出')
    expect(container.textContent).not.toContain('本期收入')
  })

  it('账户历史不足时从近三月原子回退到本月', async () => {
    const transactions: Transaction[] = [
      { id: 'wechat-june', kind: 'expense', amount: 10, categoryId: 'food', accountId: 'wechat', merchant: '微信六月', occurredAt: '2026-06-08T12:00:00+08:00', note: '' },
      { id: 'wechat-july', kind: 'expense', amount: 10, categoryId: 'food', accountId: 'wechat', merchant: '微信七月', occurredAt: '2026-07-08T12:00:00+08:00', note: '' },
      { id: 'wechat-august', kind: 'expense', amount: 10, categoryId: 'food', accountId: 'wechat', merchant: '微信八月', occurredAt: '2026-08-08T12:00:00+08:00', note: '' },
      { id: 'alipay-august', kind: 'expense', amount: 10, categoryId: 'food', accountId: 'alipay', merchant: '支付宝八月', occurredAt: '2026-08-08T12:00:00+08:00', note: '' },
    ]
    const repository = { load: () => transactions, save: () => ({ ok: true } as const) }
    const { container } = await render(<App initialView="analytics" repository={repository} />)

    await click(container.querySelector<HTMLButtonElement>('[data-range="three-months"]')!)
    await changeSelect(container.querySelector<HTMLSelectElement>('[data-analytics-account]')!, 'alipay')

    const threeMonths = container.querySelector<HTMLButtonElement>('[data-range="three-months"]')!
    expect(threeMonths.disabled).toBe(true)
    expect(threeMonths.getAttribute('aria-pressed')).toBe('false')
    expect(container.querySelector<HTMLButtonElement>('[data-range="month"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(container.textContent).toContain('2026-08-01 至 2026-08-31')
  })

  it('近三月和自定义范围均用范围证据生成可下钻洞察', async () => {
    const transactions: Transaction[] = [
      { id: 'march-transport', kind: 'expense', amount: 10, categoryId: 'transport', accountId: 'wechat', merchant: '三月交通', occurredAt: '2026-03-08T12:00:00+08:00', note: '' },
      { id: 'april-transport', kind: 'expense', amount: 10, categoryId: 'transport', accountId: 'wechat', merchant: '四月交通', occurredAt: '2026-04-08T12:00:00+08:00', note: '' },
      { id: 'may-transport', kind: 'expense', amount: 10, categoryId: 'transport', accountId: 'wechat', merchant: '五月交通', occurredAt: '2026-05-08T12:00:00+08:00', note: '' },
      { id: 'june-transport', kind: 'expense', amount: 20, categoryId: 'transport', accountId: 'wechat', merchant: '六月交通', occurredAt: '2026-06-08T12:00:00+08:00', note: '' },
      { id: 'july-transport', kind: 'expense', amount: 20, categoryId: 'transport', accountId: 'wechat', merchant: '七月交通', occurredAt: '2026-07-08T12:00:00+08:00', note: '' },
      { id: 'august-transport', kind: 'expense', amount: 20, categoryId: 'transport', accountId: 'wechat', merchant: '八月交通', occurredAt: '2026-08-08T12:00:00+08:00', note: '' },
      { id: 'august-income', kind: 'income', amount: 100, categoryId: 'salary', accountId: 'wechat', merchant: '八月收入', occurredAt: '2026-08-09T12:00:00+08:00', note: '' },
    ]
    const repository = { load: () => transactions, save: () => ({ ok: true } as const) }
    const { container } = await render(<App initialView="analytics" repository={repository} />)

    await click(container.querySelector<HTMLButtonElement>('[data-range="three-months"]')!)
    await click(container.querySelector<HTMLButtonElement>('[data-insight="transport-change"]')!)
    expect(container.querySelector<HTMLSelectElement>('select[name="month"]')?.value).toBe('2026-06')
    expect(container.textContent).toContain('六月交通')
    expect(container.textContent).toContain('八月交通')
    expect(container.textContent).not.toContain('五月交通')

    await click(container.querySelector<HTMLButtonElement>('[aria-label="消费分析"]')!)
    await click(container.querySelector<HTMLButtonElement>('[data-range="custom"]')!)
    await changeInput(container.querySelector<HTMLInputElement>('[data-custom-start]')!, '2026-08-01')
    await changeInput(container.querySelector<HTMLInputElement>('[data-custom-end]')!, '2026-08-31')
    await click(container.querySelector<HTMLButtonElement>('[data-insight="savings-rate"]')!)
    expect(container.textContent).toContain('八月交通')
    expect(container.textContent).toContain('八月收入')
    expect(container.textContent).not.toContain('七月交通')
  })

  it('下降 100% 的真实下钻显示上一证据月份、日期范围和交易集合', async () => {
    const transactions: Transaction[] = [
      { id: 'july-shopping', kind: 'expense', amount: 100, categoryId: 'shopping', accountId: 'wechat', merchant: '七月购物证据', occurredAt: '2026-07-18T12:00:00+08:00', note: '' },
      { id: 'august-food', kind: 'expense', amount: 50, categoryId: 'food', accountId: 'wechat', merchant: '八月餐饮', occurredAt: '2026-08-18T12:00:00+08:00', note: '' },
    ]
    const repository = { load: () => transactions, save: () => ({ ok: true } as const) }
    const { container } = await render(<App initialView="analytics" repository={repository} />)

    await click(container.querySelector<HTMLButtonElement>('[data-category-comparison="shopping"]')!)

    expect(container.querySelector<HTMLSelectElement>('select[name="month"]')?.value).toBe('2026-07')
    expect(container.textContent).toContain('日期：2026-07-01 至 2026-07-31')
    expect(container.textContent).toContain('七月购物证据')
    expect(container.textContent).not.toContain('八月餐饮')
  })
})
