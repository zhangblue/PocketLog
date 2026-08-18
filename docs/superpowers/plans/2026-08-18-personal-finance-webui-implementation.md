# 栖账个人记账 Web UI 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 构建一个桌面端优先、可在浏览器本地保存数据的个人记账 SPA，实现总览、快捷记账、明细下钻、消费分析、月度报告和分类/账户标签管理。

**架构：** 使用 React 19 的 Context + `useReducer` 管理单一前端状态，领域计算保持为无副作用 TypeScript 函数，localStorage 仓储负责持久化。页面共用月份与筛选上下文；图表使用原生 SVG/CSS，不引入图表或状态管理库。

**技术栈：** React 19.2、TypeScript 6、Vite 8、Vitest 4 + jsdom、原生 CSS、浏览器 localStorage 与 `window.print()`。

---

## 执行前提

当前目录不是 Git 仓库，也没有专用 worktree。开始实现前先执行：

```bash
git init
git add docs
git commit -m "docs: add finance web UI design and implementation plan"
git worktree add ../codex-demo-finance-ui -b feat/finance-ui
cd ../codex-demo-finance-ui
```

所有实现任务都在 `../codex-demo-finance-ui` 中完成。首版不创建后端、不发起网络请求、不加入预算、资产、订阅或账单导入能力。

## 文件结构与职责

### 工程与测试基础

- `package.json`：开发、测试、覆盖率和构建命令。
- `package-lock.json`：锁定依赖版本。
- `index.html`：Vite 页面入口与中文语言声明。
- `vite.config.ts`：React 插件和 Vitest jsdom 配置。
- `tsconfig.json`、`tsconfig.app.json`、`tsconfig.node.json`：严格 TypeScript 配置。
- `src/main.tsx`：挂载 React 根节点。
- `src/test/setup.ts`：每个测试后的 DOM 与 localStorage 清理。
- `src/test/render.tsx`：基于 React `act` 的轻量 jsdom 渲染助手。

### 领域与状态

- `src/domain/types.ts`：交易、分类、账户、筛选、洞察和月报类型。
- `src/domain/sampleData.ts`：确定性的 2026 年 7–8 月样例数据；首页只显示最近 5 条。
- `src/domain/selectors.ts`：月度指标、趋势、分类构成、洞察和月报计算。
- `src/domain/selectors.test.ts`：领域计算单元测试。
- `src/data/transactionRepository.ts`：localStorage 读写与损坏数据回退。
- `src/data/transactionRepository.test.ts`：持久化异常测试。
- `src/data/labelRepository.ts`：分类和账户标签的 localStorage 读写。
- `src/data/labelRepository.test.ts`：标签持久化与损坏数据回退测试。
- `src/app/financeReducer.ts`：导航、月份、筛选、交易、分类和撤销状态转换。
- `src/app/financeReducer.test.ts`：reducer 单元测试。
- `src/app/FinanceProvider.tsx`：提供状态、派生数据和可持久化动作。

### 应用框架与共享样式

- `src/app/App.tsx`：按当前视图渲染页面与全局浮层。
- `src/app/App.test.tsx`：主导航和跨功能集成测试。
- `src/layout/AppShell.tsx`：侧栏、顶栏、月份选择和主内容区域。
- `src/styles/tokens.css`：颜色、字体、圆角、间距、阴影和动效变量。
- `src/styles/global.css`：重置、基础排版、焦点、响应式和打印规则。

### 功能模块

- `src/features/overview/OverviewPage.tsx`：指标、趋势、构成、洞察和 5 条最近交易。
- `src/features/overview/OverviewPage.test.tsx`：首页数据与下钻测试。
- `src/features/overview/TrendChart.tsx`：可访问的原生 SVG 趋势图。
- `src/features/overview/CategoryDonut.tsx`：分类构成与文字图例。
- `src/features/entry/QuickEntryDrawer.tsx`：支出、收入和转账录入。
- `src/features/entry/QuickEntryDrawer.test.tsx`：校验、保存和失败恢复测试。
- `src/features/transactions/TransactionsPage.tsx`：筛选、来源说明、删除和撤销。
- `src/features/transactions/TransactionsPage.test.tsx`：筛选与撤销测试。
- `src/features/analytics/AnalyticsPage.tsx`：时间范围、分类对比、洞察和下钻。
- `src/features/analytics/AnalyticsPage.test.tsx`：分析交互测试。
- `src/features/reports/MonthlyReportPage.tsx`：总结、评分、亮点、故事和打印导出。
- `src/features/reports/MonthlyReportPage.test.tsx`：报告内容与导出测试。
- `src/features/settings/LabelsPage.tsx`：分类与账户标签管理。
- `src/features/settings/LabelsPage.test.tsx`：停用、迁移约束和重命名测试。
- `src/components/AsyncPanel.tsx`：加载、局部错误和重试状态。
- `src/components/EmptyState.tsx`：首次使用、无筛选结果和历史不足状态。
- `src/components/Toast.tsx`：成功反馈和删除撤销入口。
- `src/components/components.test.tsx`：共享状态组件与键盘行为测试。
- `README.md`：本地安装、运行、验证和数据存储说明。

## 任务 1：建立可测试的 React 应用骨架

**文件：**
- 创建：`package.json`
- 创建：`package-lock.json`
- 创建：`index.html`
- 创建：`vite.config.ts`
- 创建：`tsconfig.json`
- 创建：`tsconfig.app.json`
- 创建：`tsconfig.node.json`
- 创建：`src/main.tsx`
- 创建：`src/app/App.tsx`
- 创建：`src/app/App.test.tsx`
- 创建：`src/test/setup.ts`
- 创建：`src/test/render.tsx`
- 创建：`src/styles/tokens.css`
- 创建：`src/styles/global.css`

- [ ] **步骤 1：安装官方模板对应的核心依赖**

```bash
npm init -y
npm install react@^19.2.8 react-dom@^19.2.8
npm install -D vite@^8.2.0 @vitejs/plugin-react@^6.0.5 typescript@~6.0.2 @types/node@^24.13.3 @types/react@^19.2.18 @types/react-dom@^19.2.4 vitest@^4.1.6 jsdom @vitest/coverage-v8@^4.1.6
npm pkg set type=module scripts.dev=vite scripts.build="tsc -b && vite build" scripts.test=vitest scripts.test:run="vitest run" scripts.coverage="vitest run --coverage" scripts.check="tsc -b --noEmit && vitest run"
```

预期：生成 `package.json` 和 `package-lock.json`，依赖安装无错误。

- [ ] **步骤 2：写失败的应用启动测试**

```tsx
// src/app/App.test.tsx
import { describe, expect, it } from 'vitest'
import { render } from '../test/render'
import { App } from './App'

describe('App', () => {
  it('展示产品名和总览标题', async () => {
    const { container } = await render(<App />)
    expect(container.textContent).toContain('栖账')
    expect(container.textContent).toContain('财务总览')
  })
})
```

- [ ] **步骤 3：运行测试验证失败**

运行：`npm run test:run -- src/app/App.test.tsx`

预期：FAIL，`src/test/render.tsx` 或 `App` 尚不存在。

- [ ] **步骤 4：创建测试配置、渲染助手和最小应用**

```ts
// vite.config.ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
  },
})
```

```tsx
// src/test/render.tsx
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'

export async function render(ui: ReactNode) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(ui))
  return {
    container,
    unmount: async () => act(async () => root.unmount()),
  }
}

export async function click(element: HTMLElement) {
  await act(async () => element.click())
}

export async function changeInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!setter) throw new Error('HTMLInputElement.value setter 不可用')
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
```

```ts
// src/test/setup.ts
import { afterEach } from 'vitest'

afterEach(() => {
  document.body.replaceChildren()
  localStorage.clear()
})
```

```tsx
// src/app/App.tsx
export function App() {
  return <main><h1>栖账</h1><h2>财务总览</h2></main>
}
```

同时创建标准 Vite React TypeScript 的 `index.html`、`src/main.tsx` 和严格模式 tsconfig。`index.html` 使用 `<html lang="zh-CN">`；`src/main.tsx` 导入 `tokens.css` 和 `global.css`。

```json
// tsconfig.json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

```json
// tsconfig.app.json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["vite/client", "vitest/jsdom"]
  },
  "include": ["src"]
}
```

```json
// tsconfig.node.json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "types": ["node"]
  },
  "include": ["vite.config.ts"]
}
```

```tsx
// src/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import './styles/tokens.css'
import './styles/global.css'

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
```

- [ ] **步骤 5：定义视觉 token**

```css
/* src/styles/tokens.css */
:root {
  --color-ink: #183c35;
  --color-green: #4f8a75;
  --color-mint: #dceae4;
  --color-paper: #f5f3ec;
  --color-card: #fffefa;
  --color-text: #20342f;
  --color-muted: #7a8580;
  --color-line: #e2e5de;
  --color-accent: #e5a05e;
  --color-danger: #b6574e;
  --radius-card: 16px;
  --radius-control: 10px;
  --focus-ring: 0 0 0 3px rgba(79, 138, 117, 0.35);
}
```

- [ ] **步骤 6：验证测试、类型和构建**

运行：`npm run check && npm run build`

预期：测试 PASS，TypeScript 无错误，Vite 输出 `dist/`。

- [ ] **步骤 7：Commit**

```bash
git add package.json package-lock.json index.html vite.config.ts tsconfig*.json src
git commit -m "build: scaffold React finance UI"
```

## 任务 2：建立财务领域模型和确定性样例数据

**文件：**
- 创建：`src/domain/types.ts`
- 创建：`src/domain/sampleData.ts`
- 创建：`src/domain/selectors.ts`
- 创建：`src/domain/selectors.test.ts`

- [ ] **步骤 1：写失败的月度汇总和最近交易测试**

```ts
// src/domain/selectors.test.ts
import { describe, expect, it } from 'vitest'
import { sampleTransactions } from './sampleData'
import { selectMonthlySummary, selectRecentTransactions } from './selectors'

describe('finance selectors', () => {
  it('计算 2026 年 8 月汇总', () => {
    expect(selectMonthlySummary(sampleTransactions, '2026-08')).toEqual({
      expense: 6842,
      income: 12500,
      savingsRate: 45.3,
      transactionCount: 11,
    })
  })

  it('首页只返回最近 5 条记录', () => {
    const recent = selectRecentTransactions(sampleTransactions, '2026-08', 5)
    expect(recent).toHaveLength(5)
    expect(recent.map(item => item.merchant)).toEqual([
      '山丘咖啡', '城市出行', '鲜生活超市', '云海音乐', '八月薪资',
    ])
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm run test:run -- src/domain/selectors.test.ts`

预期：FAIL，领域模块尚不存在。

- [ ] **步骤 3：定义稳定的领域类型**

```ts
// src/domain/types.ts
export type TransactionKind = 'expense' | 'income' | 'transfer'
export type ViewId = 'overview' | 'transactions' | 'analytics' | 'reports' | 'labels'

export interface Transaction {
  id: string
  kind: TransactionKind
  amount: number
  categoryId: string
  accountId: string
  targetAccountId?: string
  merchant: string
  occurredAt: string
  note: string
}

export interface Category {
  id: string
  name: string
  emoji: string
  color: string
  kind: 'expense' | 'income'
  active: boolean
}

export interface AccountLabel {
  id: string
  name: string
  active: boolean
}

export interface TransactionFilter {
  month: string
  kind?: TransactionKind
  categoryId?: string
  accountId?: string
  sourceLabel?: string
}

export interface MonthlySummary {
  expense: number
  income: number
  savingsRate: number
  transactionCount: number
}

export interface Insight {
  id: string
  title: string
  detail: string
  filter: TransactionFilter
  tone: 'positive' | 'attention' | 'neutral'
}
```

- [ ] **步骤 4：创建精确的样例数据**

`sampleData.ts` 定义 11 条 8 月记录和 6 条 7 月对照记录。8 月最近 5 条必须是：

```ts
import type { AccountLabel, Category, Transaction } from './types'

export const augustRecent: Transaction[] = [
  { id: 'tx-0818-coffee', kind: 'expense', amount: 32, categoryId: 'food', accountId: 'wechat', merchant: '山丘咖啡', occurredAt: '2026-08-18T09:42:00+08:00', note: '早餐咖啡' },
  { id: 'tx-0817-ride', kind: 'expense', amount: 46, categoryId: 'transport', accountId: 'alipay', merchant: '城市出行', occurredAt: '2026-08-17T21:16:00+08:00', note: '晚间打车' },
  { id: 'tx-0817-market', kind: 'expense', amount: 128.6, categoryId: 'shopping', accountId: 'wechat', merchant: '鲜生活超市', occurredAt: '2026-08-17T18:30:00+08:00', note: '日用品' },
  { id: 'tx-0816-music', kind: 'expense', amount: 88, categoryId: 'entertainment', accountId: 'bank', merchant: '云海音乐', occurredAt: '2026-08-16T12:00:00+08:00', note: '年度会员' },
  { id: 'tx-0815-salary', kind: 'income', amount: 12500, categoryId: 'salary', accountId: 'bank', merchant: '八月薪资', occurredAt: '2026-08-15T10:00:00+08:00', note: '工资到账' },
]

export const augustEarlier: Transaction[] = [
  { id: 'tx-0814-rent', kind: 'expense', amount: 3200, categoryId: 'housing', accountId: 'bank', merchant: '八月房租', occurredAt: '2026-08-14T08:00:00+08:00', note: '月租' },
  { id: 'tx-0812-grocery', kind: 'expense', amount: 680.4, categoryId: 'food', accountId: 'wechat', merchant: '本月食材', occurredAt: '2026-08-12T18:00:00+08:00', note: '多次采购合计' },
  { id: 'tx-0810-utilities', kind: 'expense', amount: 420, categoryId: 'housing', accountId: 'bank', merchant: '水电燃气', occurredAt: '2026-08-10T09:00:00+08:00', note: '月度账单' },
  { id: 'tx-0808-shopping', kind: 'expense', amount: 899, categoryId: 'shopping', accountId: 'alipay', merchant: '生活购物', occurredAt: '2026-08-08T16:00:00+08:00', note: '本月购物合计' },
  { id: 'tx-0802-travel', kind: 'expense', amount: 1050, categoryId: 'transport', accountId: 'alipay', merchant: '本月交通', occurredAt: '2026-08-02T20:00:00+08:00', note: '周末出行合计' },
  { id: 'tx-0803-dining', kind: 'expense', amount: 298, categoryId: 'food', accountId: 'wechat', merchant: '朋友聚餐', occurredAt: '2026-08-03T19:30:00+08:00', note: '周末聚餐' },
]
```

7 月记录用于稳定生成环比洞察：

```ts
export const julyComparison: Transaction[] = [
  { id: 'tx-0730-food', kind: 'expense', amount: 1232, categoryId: 'food', accountId: 'wechat', merchant: '七月餐饮', occurredAt: '2026-07-30T20:00:00+08:00', note: '分类月度合计' },
  { id: 'tx-0728-transport', kind: 'expense', amount: 979, categoryId: 'transport', accountId: 'alipay', merchant: '七月交通', occurredAt: '2026-07-28T20:00:00+08:00', note: '分类月度合计' },
  { id: 'tx-0726-shopping', kind: 'expense', amount: 1093, categoryId: 'shopping', accountId: 'alipay', merchant: '七月购物', occurredAt: '2026-07-26T20:00:00+08:00', note: '分类月度合计' },
  { id: 'tx-0720-housing', kind: 'expense', amount: 4000, categoryId: 'housing', accountId: 'bank', merchant: '七月居住', occurredAt: '2026-07-20T09:00:00+08:00', note: '分类月度合计' },
  { id: 'tx-0718-entertainment', kind: 'expense', amount: 165, categoryId: 'entertainment', accountId: 'wechat', merchant: '七月娱乐', occurredAt: '2026-07-18T19:00:00+08:00', note: '分类月度合计' },
  { id: 'tx-0715-salary', kind: 'income', amount: 12500, categoryId: 'salary', accountId: 'bank', merchant: '七月薪资', occurredAt: '2026-07-15T10:00:00+08:00', note: '工资到账' },
]

export const sampleTransactions = [...augustRecent, ...augustEarlier, ...julyComparison]

export const sampleCategories: Category[] = [
  { id: 'food', name: '餐饮', emoji: '🍜', color: '#4f8a75', kind: 'expense', active: true },
  { id: 'transport', name: '交通', emoji: '🚕', color: '#e5a05e', kind: 'expense', active: true },
  { id: 'shopping', name: '购物', emoji: '🛒', color: '#8eb7a7', kind: 'expense', active: true },
  { id: 'entertainment', name: '娱乐', emoji: '🎵', color: '#d6c9ad', kind: 'expense', active: true },
  { id: 'housing', name: '居住', emoji: '⌂', color: '#738f86', kind: 'expense', active: true },
  { id: 'salary', name: '工资', emoji: '💰', color: '#3f7663', kind: 'income', active: true },
]

export const sampleAccounts: AccountLabel[] = [
  { id: 'cash', name: '现金', active: true },
  { id: 'wechat', name: '微信支付', active: true },
  { id: 'alipay', name: '支付宝', active: true },
  { id: 'bank', name: '银行卡', active: true },
]
```

- [ ] **步骤 5：实现纯函数选择器**

```ts
// src/domain/selectors.ts
import type { Insight, MonthlySummary, Transaction } from './types'

export function monthKey(isoDate: string) {
  return isoDate.slice(0, 7)
}

export function selectMonthlyTransactions(items: Transaction[], month: string) {
  return items.filter(item => monthKey(item.occurredAt) === month)
}

export function selectMonthlySummary(items: Transaction[], month: string): MonthlySummary {
  const monthly = selectMonthlyTransactions(items, month)
  const expense = monthly.filter(item => item.kind === 'expense').reduce((sum, item) => sum + item.amount, 0)
  const income = monthly.filter(item => item.kind === 'income').reduce((sum, item) => sum + item.amount, 0)
  return {
    expense,
    income,
    savingsRate: income === 0 ? 0 : Number((((income - expense) / income) * 100).toFixed(1)),
    transactionCount: monthly.length,
  }
}

export function selectRecentTransactions(items: Transaction[], month: string, limit: number) {
  return selectMonthlyTransactions(items, month)
    .slice()
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, limit)
}
```

同文件加入以下派生函数；所有函数只接收数据并返回新值，不读取 DOM 或 localStorage：

```ts
export interface CategoryBreakdown {
  categoryId: string
  amount: number
  ratio: number
}

export interface CategoryComparison {
  categoryId: string
  current: number
  previous: number
  changePercent: number | null
}

export function selectCategoryBreakdown(items: Transaction[], month: string): CategoryBreakdown[] {
  const expenses = selectMonthlyTransactions(items, month).filter(item => item.kind === 'expense')
  const total = expenses.reduce((sum, item) => sum + item.amount, 0)
  const grouped = new Map<string, Transaction[]>()
  for (const item of expenses) grouped.set(item.categoryId, [...(grouped.get(item.categoryId) ?? []), item])
  return Array.from(grouped, ([categoryId, rows]) => ({
    categoryId,
    amount: rows.reduce((sum, item) => sum + item.amount, 0),
    ratio: total === 0 ? 0 : Number((rows.reduce((sum, item) => sum + item.amount, 0) / total).toFixed(4)),
  })).sort((a, b) => b.amount - a.amount)
}

export function compareCategories(items: Transaction[], month: string, previousMonth: string): CategoryComparison[] {
  const current = selectCategoryBreakdown(items, month)
  const previous = selectCategoryBreakdown(items, previousMonth)
  return current.map(item => {
    const oldValue = previous.find(old => old.categoryId === item.categoryId)?.amount ?? 0
    return {
      categoryId: item.categoryId,
      current: item.amount,
      previous: oldValue,
      changePercent: oldValue === 0 ? null : Math.round(((item.amount - oldValue) / oldValue) * 100),
    }
  })
}

export function selectWeeklyTrend(items: Transaction[], month: string) {
  const weeks = [0, 0, 0, 0, 0]
  for (const item of selectMonthlyTransactions(items, month)) {
    if (item.kind !== 'expense') continue
    const day = Number(item.occurredAt.slice(8, 10))
    weeks[Math.min(4, Math.floor((day - 1) / 7))] += item.amount
  }
  return weeks.map((amount, index) => ({ week: index + 1, amount }))
}

export function selectInsights(items: Transaction[], month: string, previousMonth: string): Insight[] {
  const monthly = selectMonthlyTransactions(items, month)
  const summary = selectMonthlySummary(items, month)
  const comparisons = compareCategories(items, month, previousMonth)
  const transport = comparisons.find(item => item.categoryId === 'transport')
  const weekendTransport = monthly
    .filter(item => item.kind === 'expense' && item.categoryId === 'transport')
    .filter(item => [0, 6].includes(new Date(item.occurredAt).getDay()))
    .reduce((sum, item) => sum + item.amount, 0)
  return [
    { id: 'transport-weekend', title: '周末交通支出偏高', detail: `周末交通共 ¥${weekendTransport.toFixed(0)}`, filter: { month, categoryId: 'transport', sourceLabel: '周末交通支出偏高' }, tone: 'attention' },
    { id: 'transport-change', title: `交通支出${(transport?.changePercent ?? 0) >= 0 ? '增长' : '下降'} ${Math.abs(transport?.changePercent ?? 0)}%`, detail: '与上月同分类相比', filter: { month, categoryId: 'transport', sourceLabel: '交通支出变化' }, tone: 'neutral' },
    { id: 'savings-rate', title: `本月结余率 ${summary.savingsRate}%`, detail: '收入减支出后的结余比例', filter: { month, sourceLabel: '本月结余表现' }, tone: summary.savingsRate >= 40 ? 'positive' : 'attention' },
  ]
}
```

- [ ] **步骤 6：验证领域测试**

运行：`npm run test:run -- src/domain/selectors.test.ts`

预期：全部 PASS；8 月支出为 `6842`，最近记录为 5 条。

- [ ] **步骤 7：Commit**

```bash
git add src/domain
git commit -m "feat: add finance domain and sample ledger"
```

## 任务 3：实现状态容器与 localStorage 持久化

**文件：**
- 创建：`src/data/transactionRepository.ts`
- 创建：`src/data/transactionRepository.test.ts`
- 创建：`src/app/financeReducer.ts`
- 创建：`src/app/financeReducer.test.ts`
- 创建：`src/app/FinanceProvider.tsx`
- 修改：`src/app/App.tsx`

- [ ] **步骤 1：写失败的仓储回退和 reducer 测试**

```ts
// src/data/transactionRepository.test.ts
import { describe, expect, it } from 'vitest'
import { createTransactionRepository } from './transactionRepository'

describe('transaction repository', () => {
  it('损坏的本地数据回退到种子数据', () => {
    localStorage.setItem('qizhang.transactions.v1', '{broken')
    const repository = createTransactionRepository(localStorage)
    expect(repository.load().length).toBeGreaterThan(5)
  })
})
```

```ts
// src/app/financeReducer.test.ts
import { describe, expect, it } from 'vitest'
import { financeReducer, initialFinanceState } from './financeReducer'

describe('financeReducer', () => {
  it('洞察下钻同时切换页面和筛选', () => {
    const next = financeReducer(initialFinanceState, {
      type: 'insight/opened',
      filter: { month: '2026-08', categoryId: 'transport', sourceLabel: '周末交通支出偏高' },
    })
    expect(next.view).toBe('transactions')
    expect(next.filter.categoryId).toBe('transport')
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm run test:run -- src/data/transactionRepository.test.ts src/app/financeReducer.test.ts`

预期：FAIL，对应模块尚不存在。

- [ ] **步骤 3：实现有明确失败结果的仓储**

```ts
// src/data/transactionRepository.ts
import { sampleTransactions } from '../domain/sampleData'
import type { Transaction } from '../domain/types'

const STORAGE_KEY = 'qizhang.transactions.v1'
export type SaveResult = { ok: true } | { ok: false; message: string }

export function createTransactionRepository(storage: Storage) {
  return {
    load(): Transaction[] {
      try {
        const raw = storage.getItem(STORAGE_KEY)
        if (!raw) return sampleTransactions
        const parsed: unknown = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed as Transaction[] : sampleTransactions
      } catch {
        return sampleTransactions
      }
    },
    save(items: Transaction[]): SaveResult {
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(items))
        return { ok: true }
      } catch {
        return { ok: false, message: '保存失败，输入内容已保留。' }
      }
    },
  }
}
```

- [ ] **步骤 4：实现 reducer 和双 Context Provider**

```ts
// src/app/financeReducer.ts
import type { AccountLabel, Category, Transaction, TransactionFilter, ViewId } from '../domain/types'
import { sampleAccounts, sampleCategories, sampleTransactions } from '../domain/sampleData'

export interface FinanceState {
  view: ViewId
  month: string
  filter: TransactionFilter
  transactions: Transaction[]
  categories: Category[]
  accounts: AccountLabel[]
  drawerOpen: boolean
  deletedTransaction?: Transaction
}

export const initialFinanceState: FinanceState = {
  view: 'overview',
  month: '2026-08',
  filter: { month: '2026-08' },
  transactions: sampleTransactions,
  categories: sampleCategories,
  accounts: sampleAccounts,
  drawerOpen: false,
}

export type FinanceAction =
  | { type: 'view/changed'; view: ViewId }
  | { type: 'month/changed'; month: string }
  | { type: 'drawer/opened' }
  | { type: 'drawer/closed' }
  | { type: 'transaction/added'; transaction: Transaction }
  | { type: 'transaction/deleted'; transaction: Transaction }
  | { type: 'transaction/restored' }
  | { type: 'transaction/delete-cleared' }
  | { type: 'insight/opened'; filter: TransactionFilter }
  | { type: 'filter/cleared' }

export function financeReducer(state: FinanceState, action: FinanceAction): FinanceState {
  if (action.type === 'view/changed') return { ...state, view: action.view }
  if (action.type === 'month/changed') return { ...state, month: action.month, filter: { month: action.month } }
  if (action.type === 'drawer/opened') return { ...state, drawerOpen: true }
  if (action.type === 'drawer/closed') return { ...state, drawerOpen: false }
  if (action.type === 'transaction/added') return { ...state, transactions: [action.transaction, ...state.transactions], drawerOpen: false }
  if (action.type === 'transaction/deleted') return { ...state, transactions: state.transactions.filter(item => item.id !== action.transaction.id), deletedTransaction: action.transaction }
  if (action.type === 'transaction/restored' && state.deletedTransaction) return { ...state, transactions: [state.deletedTransaction, ...state.transactions], deletedTransaction: undefined }
  if (action.type === 'transaction/delete-cleared') return { ...state, deletedTransaction: undefined }
  if (action.type === 'insight/opened') return { ...state, view: 'transactions', filter: action.filter }
  if (action.type === 'filter/cleared') return { ...state, filter: { month: state.month } }
  return state
}
```

`FinanceProvider.tsx` 创建只读状态 Context 和动作 Context。测试可注入初始视图、筛选和仓储；产品运行时使用浏览器 localStorage。

```tsx
// src/app/FinanceProvider.tsx 的公开契约
interface FinanceProviderProps {
  children: React.ReactNode
  initialView?: ViewId
  initialFilter?: TransactionFilter
  repository?: ReturnType<typeof createTransactionRepository>
}

export interface FinanceActions {
  changeView(view: ViewId): void
  changeMonth(month: string): void
  openDrawer(): void
  closeDrawer(): void
  openInsight(filter: TransactionFilter): void
  clearFilter(): void
  clearDeleted(): void
  addTransaction(transaction: Transaction): SaveResult
  deleteTransaction(transaction: Transaction): SaveResult
  restoreTransaction(): SaveResult
}

const StateContext = createContext<FinanceState | null>(null)
const ActionsContext = createContext<FinanceActions | null>(null)

export function useFinance() {
  const state = useContext(StateContext)
  const actions = useContext(ActionsContext)
  if (!state || !actions) throw new Error('useFinance 必须在 FinanceProvider 内使用')
  return { state, actions }
}
```

`addTransaction`、`deleteTransaction` 与 `restoreTransaction` 先计算下一份交易数组并调用仓储 `save`，成功后再 dispatch；失败时返回 `SaveResult`，保证 UI 输入和当前交易集合不丢失。`clearDeleted` 仅 dispatch `transaction/delete-cleared`。

`App` 接受可选的 `initialView` 并传给 Provider，供分析页集成测试使用：

```tsx
export function App({ initialView = 'overview' }: { initialView?: ViewId }) {
  return <FinanceProvider initialView={initialView}><AppContent /></FinanceProvider>
}
```

- [ ] **步骤 5：验证状态和仓储测试**

运行：`npm run test:run -- src/data src/app/financeReducer.test.ts`

预期：全部 PASS。

- [ ] **步骤 6：Commit**

```bash
git add src/data src/app
git commit -m "feat: add finance state and local persistence"
```

## 任务 4：实现应用框架和洞察优先首页

**文件：**
- 创建：`src/layout/AppShell.tsx`
- 创建：`src/features/overview/OverviewPage.tsx`
- 创建：`src/features/overview/OverviewPage.test.tsx`
- 创建：`src/features/overview/TrendChart.tsx`
- 创建：`src/features/overview/CategoryDonut.tsx`
- 修改：`src/app/App.tsx`
- 修改：`src/styles/global.css`

- [ ] **步骤 1：写失败的首页内容测试**

```tsx
// src/features/overview/OverviewPage.test.tsx
import { describe, expect, it } from 'vitest'
import { click, render } from '../../test/render'
import { FinanceProvider } from '../../app/FinanceProvider'
import { OverviewPage } from './OverviewPage'

describe('OverviewPage', () => {
  it('展示汇总和恰好 5 条最近明细', async () => {
    const { container } = await render(<FinanceProvider><OverviewPage /></FinanceProvider>)
    expect(container.textContent).toContain('¥6,842')
    expect(container.querySelectorAll('[data-transaction-row]')).toHaveLength(5)
    expect(container.textContent).toContain('鲜生活超市')
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm run test:run -- src/features/overview/OverviewPage.test.tsx`

预期：FAIL，首页组件尚不存在。

- [ ] **步骤 3：实现 AppShell 的导航契约**

```tsx
// src/layout/AppShell.tsx
const navItems = [
  ['overview', '总览'],
  ['transactions', '收支明细'],
  ['analytics', '消费分析'],
  ['reports', '月度报告'],
  ['labels', '分类管理'],
] as const

export function AppShell({ children }: { children: React.ReactNode }) {
  const { state, actions } = useFinance()
  return (
    <div className="app-shell">
      <aside aria-label="主导航">
        <strong className="brand">栖账</strong>
        {navItems.map(([view, label]) => (
          <button key={view} aria-current={state.view === view ? 'page' : undefined} onClick={() => actions.changeView(view)}>{label}</button>
        ))}
      </aside>
      <section className="app-main">
        <header><select aria-label="月份" value={state.month} onChange={event => actions.changeMonth(event.target.value)}><option value="2026-08">2026 年 8 月</option><option value="2026-07">2026 年 7 月</option></select><button onClick={actions.openDrawer}>＋ 记一笔</button></header>
        {children}
      </section>
    </div>
  )
}
```

- [ ] **步骤 4：实现首页和可访问图表**

`OverviewPage` 从 Context 取得当前月交易，调用选择器生成四项指标、周趋势、分类构成、三条洞察和最近 5 条交易。

```tsx
// src/features/overview/TrendChart.tsx
export function TrendChart({ points, summary }: { points: { x: number; y: number }[]; summary: string }) {
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
  return (
    <figure>
      <svg role="img" aria-labelledby="trend-title trend-desc" viewBox="0 0 600 220">
        <title id="trend-title">支出趋势</title>
        <desc id="trend-desc">{summary}</desc>
        <path d={path} className="trend-line" />
      </svg>
      <figcaption>{summary}</figcaption>
    </figure>
  )
}
```

`CategoryDonut` 使用 `conic-gradient` 展示占比，同时渲染完整文字列表；点击分类调用 `actions.openInsight(filter)` 进入明细页。

- [ ] **步骤 5：按已批准的“静谧账本”视觉实现桌面布局**

在 `global.css` 中实现 190–220 px 侧栏、四列指标卡、趋势/构成双栏、三列洞察和明细表。1440 px 为基准；1024–1279 px 隐藏导航文字但保留 `aria-label`。

- [ ] **步骤 6：验证首页和构建**

运行：`npm run test:run -- src/features/overview && npm run build`

预期：首页测试 PASS，构建成功。

- [ ] **步骤 7：Commit**

```bash
git add src/layout src/features/overview src/app/App.tsx src/styles/global.css
git commit -m "feat: build insight-first finance overview"
```

## 任务 5：实现快捷记账与失败恢复

**文件：**
- 创建：`src/features/entry/QuickEntryDrawer.tsx`
- 创建：`src/features/entry/QuickEntryDrawer.test.tsx`
- 修改：`src/app/App.tsx`
- 修改：`src/styles/global.css`

- [ ] **步骤 1：写失败的录入测试**

```tsx
// src/features/entry/QuickEntryDrawer.test.tsx
import { describe, expect, it, vi } from 'vitest'
import { click, render } from '../../test/render'
import { QuickEntryDrawer } from './QuickEntryDrawer'

describe('QuickEntryDrawer', () => {
  it('金额为空时阻止保存并聚焦金额', async () => {
    const save = vi.fn()
    const { container } = await render(<QuickEntryDrawer open onClose={() => undefined} onSave={save} />)
    const button = container.querySelector<HTMLButtonElement>('[data-save]')!
    await click(button)
    expect(save).not.toHaveBeenCalled()
    expect(document.activeElement?.getAttribute('name')).toBe('amount')
    expect(container.textContent).toContain('请输入大于 0 的金额')
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm run test:run -- src/features/entry/QuickEntryDrawer.test.tsx`

预期：FAIL，组件尚不存在。

- [ ] **步骤 3：实现明确的表单契约**

```ts
export interface TransactionDraft {
  kind: 'expense' | 'income' | 'transfer'
  amount: string
  categoryId: string
  accountId: string
  targetAccountId: string
  occurredAt: string
  merchant: string
  note: string
}

export interface QuickEntryDrawerProps {
  open: boolean
  onClose(): void
  onSave(draft: TransactionDraft): { ok: true } | { ok: false; message: string }
}
```

组件使用 `role="dialog"`、`aria-modal="true"`、可见标题和字段错误关联。打开时聚焦金额；Esc 关闭；Tab 焦点不离开浮层；关闭后由 `App` 把焦点还给“记一笔”按钮。

- [ ] **步骤 4：实现保存与错误恢复**

```tsx
function submit(event: React.FormEvent) {
  event.preventDefault()
  const parsedAmount = Number(draft.amount)
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    setError('请输入大于 0 的金额')
    amountRef.current?.focus()
    return
  }
  const result = onSave(draft)
  if (!result.ok) {
    setError(result.message)
    return
  }
  setDraft(emptyDraft())
  setError('')
}
```

转账必须选择不同的来源和目标账户；转账不要求分类，也不影响首页收支汇总。

- [ ] **步骤 5：补齐成功与仓储失败测试**

测试输入 `68`、分类“餐饮”、账户“微信支付”后保存一次；再让 `onSave` 返回失败，断言金额和备注仍在表单中。

- [ ] **步骤 6：运行测试与构建**

运行：`npm run test:run -- src/features/entry && npm run build`

预期：全部 PASS，构建成功。

- [ ] **步骤 7：Commit**

```bash
git add src/features/entry src/app/App.tsx src/styles/global.css
git commit -m "feat: add resilient quick transaction entry"
```

## 任务 6：实现明细筛选、来源说明、删除与撤销

**文件：**
- 创建：`src/features/transactions/TransactionsPage.tsx`
- 创建：`src/features/transactions/TransactionsPage.test.tsx`
- 创建：`src/components/Toast.tsx`
- 修改：`src/styles/global.css`

- [ ] **步骤 1：写失败的筛选和撤销测试**

```tsx
// src/features/transactions/TransactionsPage.test.tsx
import { describe, expect, it } from 'vitest'
import { click, render } from '../../test/render'
import { FinanceProvider } from '../../app/FinanceProvider'
import { TransactionsPage } from './TransactionsPage'

describe('TransactionsPage', () => {
  it('显示洞察来源并可清除筛选', async () => {
    const { container } = await render(<FinanceProvider initialFilter={{ month: '2026-08', categoryId: 'transport', sourceLabel: '周末交通支出偏高' }}><TransactionsPage /></FinanceProvider>)
    expect(container.textContent).toContain('来自洞察：周末交通支出偏高')
    await click(container.querySelector<HTMLButtonElement>('[data-clear-filter]')!)
    expect(container.textContent).not.toContain('来自洞察：')
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm run test:run -- src/features/transactions/TransactionsPage.test.tsx`

预期：FAIL，明细页尚不存在。

- [ ] **步骤 3：实现筛选列表**

页面筛选字段固定为月份、类型、分类和账户。列表字段固定为交易名称、分类、账户、日期、备注摘要和金额。无结果时显示当前筛选摘要及“清除筛选”。

```tsx
const visible = state.transactions
  .filter(item => item.occurredAt.startsWith(state.filter.month))
  .filter(item => !state.filter.kind || item.kind === state.filter.kind)
  .filter(item => !state.filter.categoryId || item.categoryId === state.filter.categoryId)
  .filter(item => !state.filter.accountId || item.accountId === state.filter.accountId)
```

- [ ] **步骤 4：实现删除和 5 秒撤销窗口**

删除按钮先调用持久化动作。成功后显示 Toast；Toast 的撤销按钮恢复交易。5 秒后只关闭 Toast，因为交易已在删除动作时写入持久化存储。

```tsx
<Toast open={Boolean(state.deletedTransaction)} duration={5000} onDismiss={actions.clearDeleted}>
  已删除“{state.deletedTransaction?.merchant}”
  <button onClick={actions.restoreTransaction}>撤销</button>
</Toast>
```

- [ ] **步骤 5：验证筛选、删除、撤销和空状态**

运行：`npm run test:run -- src/features/transactions`

预期：筛选、删除、撤销、空结果四组测试全部 PASS。

- [ ] **步骤 6：Commit**

```bash
git add src/features/transactions src/components/Toast.tsx src/styles/global.css
git commit -m "feat: add transaction filtering and undo"
```

## 任务 7：实现可下钻的消费分析

**文件：**
- 创建：`src/features/analytics/AnalyticsPage.tsx`
- 创建：`src/features/analytics/AnalyticsPage.test.tsx`
- 修改：`src/domain/selectors.ts`
- 修改：`src/domain/selectors.test.ts`
- 修改：`src/styles/global.css`

- [ ] **步骤 1：写失败的分类对比和下钻测试**

```tsx
// src/features/analytics/AnalyticsPage.test.tsx
import { describe, expect, it } from 'vitest'
import { click, render } from '../../test/render'
import { App } from '../../app/App'

describe('AnalyticsPage', () => {
  it('点击交通洞察后进入已筛选明细', async () => {
    const { container } = await render(<App initialView="analytics" />)
    await click(container.querySelector<HTMLButtonElement>('[data-insight="transport-weekend"]')!)
    expect(container.textContent).toContain('来自洞察：周末交通支出偏高')
    expect(container.querySelector('[data-active-view]')?.getAttribute('data-active-view')).toBe('transactions')
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm run test:run -- src/features/analytics/AnalyticsPage.test.tsx`

预期：FAIL，分析页和下钻行为尚不存在。

- [ ] **步骤 3：扩展分析选择器测试**

```ts
it('生成餐饮、交通和购物的环比变化', () => {
  const comparisons = compareCategories(sampleTransactions, '2026-08', '2026-07')
  expect(comparisons.find(item => item.categoryId === 'food')?.changePercent).toBe(-18)
  expect(comparisons.find(item => item.categoryId === 'transport')?.changePercent).toBe(12)
  expect(comparisons.find(item => item.categoryId === 'shopping')?.changePercent).toBe(-6)
})
```

在 `selectors.test.ts` 中加入这段测试，复用任务 2 已定义的 `CategoryComparison` 与 `compareCategories`，不创建第二套类型或算法。

- [ ] **步骤 4：实现分析页面**

页面提供“本月”“近 3 月”“自定义”三个时间入口与账户筛选。首版样例数据只启用“本月”和“自定义”；近 3 月若数据不足，展示历史不足说明，不生成虚假趋势。

图表和对比行都是按钮语义或包含可聚焦按钮。点击后调用：

```ts
actions.openInsight({
  month: state.month,
  categoryId: insight.filter.categoryId,
  accountId: insight.filter.accountId,
  sourceLabel: insight.title,
})
```

- [ ] **步骤 5：验证分析页和领域测试**

运行：`npm run test:run -- src/features/analytics src/domain/selectors.test.ts`

预期：分类对比、历史不足、键盘点击和下钻测试全部 PASS。

- [ ] **步骤 6：Commit**

```bash
git add src/features/analytics src/domain src/styles/global.css
git commit -m "feat: add traceable spending analytics"
```

## 任务 8：实现月度报告和打印导出

**文件：**
- 创建：`src/features/reports/MonthlyReportPage.tsx`
- 创建：`src/features/reports/MonthlyReportPage.test.tsx`
- 修改：`src/domain/selectors.ts`
- 修改：`src/styles/global.css`

- [ ] **步骤 1：写失败的报告与导出测试**

```tsx
// src/features/reports/MonthlyReportPage.test.tsx
import { describe, expect, it, vi } from 'vitest'
import { click, render } from '../../test/render'
import { FinanceProvider } from '../../app/FinanceProvider'
import { MonthlyReportPage } from './MonthlyReportPage'

describe('MonthlyReportPage', () => {
  it('展示报告并调用浏览器打印', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    const { container } = await render(<FinanceProvider><MonthlyReportPage /></FinanceProvider>)
    expect(container.textContent).toContain('这个月，你更会花钱了')
    await click(container.querySelector<HTMLButtonElement>('[data-export-pdf]')!)
    expect(print).toHaveBeenCalledOnce()
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm run test:run -- src/features/reports/MonthlyReportPage.test.tsx`

预期：FAIL，月报组件尚不存在。

- [ ] **步骤 3：实现确定性的报告模型**

```ts
export interface MonthlyReport {
  headline: string
  score: number
  status: '稳健' | '平衡' | '需关注'
  biggestSaving: CategoryComparison | null
  biggestGrowth: CategoryComparison | null
  story: string
}

export function buildMonthlyReport(items: Transaction[], month: string, previousMonth: string): MonthlyReport {
  const summary = selectMonthlySummary(items, month)
  const comparisons = compareCategories(items, month, previousMonth)
  const sorted = comparisons.filter(item => item.changePercent !== null)
  const score = Math.max(0, Math.min(100, Math.round(summary.savingsRate + 37)))
  return {
    headline: summary.expense < selectMonthlySummary(items, previousMonth).expense ? '这个月，你更会花钱了' : '这个月的消费值得回顾',
    score,
    status: score >= 75 ? '稳健' : score >= 55 ? '平衡' : '需关注',
    biggestSaving: sorted.slice().sort((a, b) => (a.changePercent ?? 0) - (b.changePercent ?? 0))[0] ?? null,
    biggestGrowth: sorted.slice().sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0))[0] ?? null,
    story: '你减少了餐饮支出，但周末出行更活跃。总体支出下降，同时保持了稳定结余。',
  }
}
```

- [ ] **步骤 4：实现报告页面和打印样式**

报告渲染标题、评分、两项亮点和消费故事；当任一亮点为 `null` 时显示“积累更多记录后可查看环比”。“导出 PDF”按钮调用 `window.print()`。`@media print` 隐藏侧栏、月份控件和按钮，仅保留白底报告内容，并设置 `@page { size: A4; margin: 16mm; }`。

- [ ] **步骤 5：验证报告和构建**

运行：`npm run test:run -- src/features/reports && npm run build`

预期：报告与打印测试 PASS，构建成功。

- [ ] **步骤 6：Commit**

```bash
git add src/features/reports src/domain/selectors.ts src/styles/global.css
git commit -m "feat: add monthly finance report"
```

## 任务 9：实现分类与账户标签管理

**文件：**
- 创建：`src/features/settings/LabelsPage.tsx`
- 创建：`src/features/settings/LabelsPage.test.tsx`
- 创建：`src/data/labelRepository.ts`
- 创建：`src/data/labelRepository.test.ts`
- 修改：`src/app/financeReducer.ts`
- 修改：`src/app/FinanceProvider.tsx`
- 修改：`src/styles/global.css`

- [ ] **步骤 1：写失败的标签约束测试**

```tsx
// src/features/settings/LabelsPage.test.tsx
import { describe, expect, it } from 'vitest'
import { render } from '../../test/render'
import { FinanceProvider } from '../../app/FinanceProvider'
import { LabelsPage } from './LabelsPage'

describe('LabelsPage', () => {
  it('已使用分类只能停用，不能直接删除', async () => {
    const { container } = await render(<FinanceProvider><LabelsPage /></FinanceProvider>)
    const foodRow = container.querySelector<HTMLElement>('[data-category="food"]')!
    expect(foodRow.querySelector('[data-delete]')).toBeNull()
    expect(foodRow.querySelector('[data-deactivate]')).not.toBeNull()
  })
})
```

```ts
// src/data/labelRepository.test.ts
import { describe, expect, it } from 'vitest'
import { createLabelRepository } from './labelRepository'

describe('label repository', () => {
  it('损坏数据回退到默认分类和账户', () => {
    localStorage.setItem('qizhang.labels.v1', '{broken')
    const snapshot = createLabelRepository(localStorage).load()
    expect(snapshot.categories.map(item => item.id)).toContain('food')
    expect(snapshot.accounts.map(item => item.id)).toContain('wechat')
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm run test:run -- src/features/settings/LabelsPage.test.tsx`

预期：FAIL，标签页尚不存在。

- [ ] **步骤 3：实现标签仓储与状态动作**

```ts
// src/data/labelRepository.ts
import { sampleAccounts, sampleCategories } from '../domain/sampleData'
import type { AccountLabel, Category } from '../domain/types'
import type { SaveResult } from './transactionRepository'

const STORAGE_KEY = 'qizhang.labels.v1'
export interface LabelSnapshot { categories: Category[]; accounts: AccountLabel[] }

export function createLabelRepository(storage: Storage) {
  return {
    load(): LabelSnapshot {
      try {
        const raw = storage.getItem(STORAGE_KEY)
        if (!raw) return { categories: sampleCategories, accounts: sampleAccounts }
        const parsed = JSON.parse(raw) as LabelSnapshot
        return Array.isArray(parsed.categories) && Array.isArray(parsed.accounts)
          ? parsed
          : { categories: sampleCategories, accounts: sampleAccounts }
      } catch {
        return { categories: sampleCategories, accounts: sampleAccounts }
      }
    },
    save(snapshot: LabelSnapshot): SaveResult {
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
        return { ok: true }
      } catch {
        return { ok: false, message: '标签保存失败，请重试。' }
      }
    },
  }
}
```

`FinanceState` 已在任务 3 包含分类和账户集合。本任务扩展 `FinanceAction`：

```ts
type LabelAction =
  | { type: 'category/created'; category: Category }
  | { type: 'category/renamed'; id: string; name: string }
  | { type: 'category/deactivated'; id: string }
  | { type: 'category/reordered'; orderedIds: string[] }
  | { type: 'category/deleted'; id: string }
  | { type: 'category/migrated'; fromId: string; toId: string }
  | { type: 'account/created'; account: AccountLabel }
  | { type: 'account/renamed'; id: string; name: string }
  | { type: 'account/deactivated'; id: string }
```

`category/migrated` 把所有 `fromId` 交易改为 `toId`，然后移除旧分类。Provider 先保存新交易数组，再保存新标签；若标签保存失败，立即把旧交易数组写回交易仓储并且不 dispatch。

Provider 启动时用 `labelRepository.load()` 覆盖 `initialFinanceState.categories` 和 `initialFinanceState.accounts`。创建、重命名、排序、停用和无引用删除都先保存标签快照，成功后再 dispatch。

- [ ] **步骤 4：实现两个页签和规则**

“分类”页签支持创建、重命名、排序和停用。存在引用交易时提供“迁移并删除”，要求选择同类型目标分类；没有引用时删除前显示确认对话框。“账户标签”页签支持创建、重命名和停用，不显示余额或资产信息。

- [ ] **步骤 5：验证标签管理**

运行：`npm run test:run -- src/features/settings src/data/labelRepository.test.ts`

预期：使用中分类迁移、未使用分类删除、账户重命名、停用和标签仓储回退测试全部 PASS。

- [ ] **步骤 6：Commit**

```bash
git add src/features/settings src/data/labelRepository* src/app src/styles/global.css
git commit -m "feat: add category and account labels"
```

## 任务 10：补齐状态、无障碍、响应式和端到端集成验证

**文件：**
- 创建：`src/components/AsyncPanel.tsx`
- 创建：`src/components/EmptyState.tsx`
- 创建：`src/components/components.test.tsx`
- 修改：`src/app/App.test.tsx`
- 修改：`src/features/overview/OverviewPage.tsx`
- 修改：`src/features/analytics/AnalyticsPage.tsx`
- 修改：`src/styles/global.css`
- 创建：`README.md`

- [ ] **步骤 1：写失败的状态组件测试**

```tsx
// src/components/components.test.tsx
import { describe, expect, it, vi } from 'vitest'
import { click, render } from '../test/render'
import { AsyncPanel } from './AsyncPanel'

describe('AsyncPanel', () => {
  it('局部错误保留标题并提供重试', async () => {
    const retry = vi.fn()
    const { container } = await render(<AsyncPanel title="支出趋势" status="error" onRetry={retry}>图表</AsyncPanel>)
    expect(container.textContent).toContain('支出趋势')
    expect(container.textContent).toContain('此区域暂时无法加载')
    await click(container.querySelector<HTMLButtonElement>('button')!)
    expect(retry).toHaveBeenCalledOnce()
  })
})
```

- [ ] **步骤 2：写失败的跨功能集成测试**

```tsx
// 追加到 src/app/App.test.tsx
// 同时把现有 render import 改为：
import { changeInput, click, render } from '../test/render'

it('新增支出后首页汇总和最近明细同步更新', async () => {
  const { container } = await render(<App />)
  await click(container.querySelector<HTMLButtonElement>('[data-open-entry]')!)
  const amount = container.querySelector<HTMLInputElement>('input[name="amount"]')!
  await changeInput(amount, '68')
  const merchant = container.querySelector<HTMLInputElement>('input[name="merchant"]')!
  await changeInput(merchant, '晚餐')
  await click(container.querySelector<HTMLButtonElement>('[data-save]')!)
  expect(container.textContent).toContain('¥6,910')
  expect(container.textContent).toContain('晚餐')
})
```

- [ ] **步骤 3：运行测试验证失败**

运行：`npm run test:run -- src/components src/app/App.test.tsx`

预期：FAIL，共享状态组件和完整交互尚未接通。

- [ ] **步骤 4：实现共享加载、错误和空状态**

```tsx
// src/components/AsyncPanel.tsx
export function AsyncPanel({ title, status, onRetry, children }: { title: string; status: 'loading' | 'ready' | 'error'; onRetry(): void; children: React.ReactNode }) {
  return (
    <section aria-busy={status === 'loading'} aria-labelledby={`${title}-heading`}>
      <h3 id={`${title}-heading`}>{title}</h3>
      {status === 'loading' && <div className="panel-skeleton" aria-label={`${title}加载中`} />}
      {status === 'error' && <div role="alert">此区域暂时无法加载。<button onClick={onRetry}>重试</button></div>}
      {status === 'ready' && children}
    </section>
  )
}
```

`EmptyState` 使用 `variant="first-use" | "no-results" | "insufficient-history"`，每个变体都有固定标题、说明和唯一主操作。

- [ ] **步骤 5：完成焦点、对比度和减少动效规则**

```css
:focus-visible { outline: none; box-shadow: var(--focus-ring); }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}

@media (max-width: 1279px) and (min-width: 1024px) {
  .app-shell { grid-template-columns: 72px 1fr; }
  .nav-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
}
```

所有趋势同时呈现箭头、百分比和文字。所有 SVG 图表带 `title`、`desc` 与可见文字摘要。

- [ ] **步骤 6：补充 README 运行说明**

`README.md` 只包含产品一句话说明、Node/npm 前提、`npm install`、`npm run dev`、`npm run check`、`npm run build` 和浏览器本地数据说明。

- [ ] **步骤 7：运行完整验证**

```bash
npm run coverage
npm run check
npm run build
```

预期：

- Vitest 全部 PASS。
- `src/domain` 与 `src/app` 行覆盖率不低于 90%。
- TypeScript 严格检查无错误。
- Vite 生产构建成功。
- 首页只显示 5 条最近交易，但汇总基于该月全部 11 条记录。

- [ ] **步骤 8：人工验收桌面布局**

运行：`npm run dev -- --host 0.0.0.0`

在 1440×900 和 1024×768 两个视口检查：侧栏、四项指标、图表、快捷记账、洞察下钻、删除撤销、打印预览和键盘焦点顺序。将检查结果写入提交说明，不创建截图文件。

- [ ] **步骤 9：Commit**

```bash
git add src README.md
git commit -m "feat: complete accessible finance dashboard"
```

## 最终规格映射

| 规格要求 | 实现任务 |
|---|---|
| 总览与 5 条最近明细 | 任务 2、4 |
| 快捷记账与输入保护 | 任务 3、5 |
| 明细筛选、来源说明、删除撤销 | 任务 3、6 |
| 趋势、分类、对比与洞察下钻 | 任务 2、4、7 |
| 月度报告与 PDF 导出入口 | 任务 2、8 |
| 分类与账户标签 | 任务 2、9 |
| 加载、空状态、局部错误 | 任务 3、6、10 |
| 1024 px 以上桌面适配 | 任务 4、10 |
| 键盘、焦点、对比度、减少动效 | 任务 5、10 |
| localStorage 持久化和损坏回退 | 任务 3 |
| 完整验证与覆盖率 | 任务 10 |
