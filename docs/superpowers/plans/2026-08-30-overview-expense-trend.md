# 总览支出趋势折线图实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将总览支出趋势改为按日折线图，显示稀疏日期标签、金额纵轴和悬停金额。

**架构：** 保留 OverviewPage 从 API 读取的每日 trend 数据，将坐标计算、标签抽样、金额刻度和点位交互封装在现有 TrendChart 组件中。组件通过 SVG 原生事件和可聚焦数据点提供鼠标、键盘一致的 Tooltip，不改后端接口或统计口径。

**技术栈：** React、TypeScript、SVG、Vitest、Vite。

---

## 文件结构

- 修改：`frontend/src/features/overview/OverviewPage.tsx`，传递每日日期与金额数据，不再把点转换为“第 N 周”。
- 修改：`frontend/src/features/overview/TrendChart.tsx`，实现折线、动态金额 Y 轴、均匀日期 X 轴、Tooltip 与无障碍语义。
- 修改：`frontend/src/features/overview/OverviewPage.test.tsx`，验证总览图表真实渲染与交互。
- 必要时修改：`frontend/src/styles/global.css`，补充趋势图节点、Tooltip 和轴标签样式。

### 任务 1：总览按日支出趋势图

**文件：**
- 修改：`frontend/src/features/overview/OverviewPage.tsx`
- 修改：`frontend/src/features/overview/TrendChart.tsx`
- 修改：`frontend/src/features/overview/OverviewPage.test.tsx`
- 修改：`frontend/src/styles/global.css`（若现有样式不足）

- [ ] **步骤 1：编写失败测试**

在 `OverviewPage.test.tsx` 增加真实页面行为测试：

```tsx
it('按日期展示支出趋势并在日期过多时均匀隐藏部分标签', async () => {
  const transactions = Array.from({ length: 10 }, (_, index) => ({
    id: `daily-${index}`, kind: 'expense' as const, amount: (index + 1) * 100,
    categoryId: 'food', accountId: 'cash', merchant: `商户${index}`,
    occurredAt: `2026-08-${String(index + 1).padStart(2, '0')}T12:00:00+08:00`, note: '',
  }))
  const { container } = await render(<OverviewApp transactions={transactions} />)
  const labels = [...container.querySelectorAll('[data-overview-trend-axis-label]')].map(node => node.textContent)
  expect(labels.length).toBeLessThanOrEqual(6)
  expect(labels[0]).toBe('08-01')
  expect(labels.at(-1)).toBe('08-10')
  expect(container.querySelectorAll('[data-overview-trend-y-axis-label]')).toHaveLength(4)
  expect(container.textContent).toContain('¥0')
})

it('悬停或聚焦总览趋势点时显示精确金额', async () => {
  const { container } = await render(<OverviewApp />)
  const point = container.querySelector<SVGCircleElement>('[data-overview-trend-point="2026-08-08"]')!
  point.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
  await settle()
  expect(container.querySelector('[data-overview-trend-tooltip]')?.textContent).toContain('¥1,050')
  point.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
  await settle()
  expect(container.querySelector('[data-overview-trend-tooltip]')).toBeNull()
})
```

同时更新原有摘要断言：摘要应包含实际 `YYYY-MM-DD` 与金额，不再包含“第 1 周”。增加键盘 focus/blur 断言，确保点具备 `role="button"`、`tabIndex=0` 和包含日期金额的 `aria-label`。

- [ ] **步骤 2：运行测试验证红灯**

运行：

```bash
npm --prefix frontend run test:run -- src/features/overview/OverviewPage.test.tsx
```

预期：新增测试失败，原因是 TrendChart 仍接收周序号点位、没有日期轴/金额轴和 Tooltip。

- [ ] **步骤 3：实现最小按日图表**

1. 在 OverviewPage 将 `apiData.trend` 映射为 `{ date: item.date, amount: Number(item.amount) }`，并将其传给 TrendChart；摘要按实际日期生成。
2. 在 TrendChart 内计算 `maxAmount`（空数据安全为 1）、4 个金额刻度和最大值向上取整；所有点按完整数组等距放置。
3. 横轴使用 `MM-DD`，当点数超过 6 时按 `Math.round(slot * (length - 1) / 5)` 取样，保证首尾和均匀间距；数据点本身全部保留。
4. 以 `<polyline>` 绘制折线，以可聚焦 `<circle>` 绘制节点；节点的 mouseenter/focus 设置 Tooltip，mouseleave/blur 清除 Tooltip。Tooltip 文本格式为 `YYYY-MM-DD · ¥金额`。
5. 为 SVG 增加标题、描述、可见 figcaption，并为节点设置 `role="button"`、`tabIndex={0}`、`aria-label="日期 支出 金额"`；保留现有图表的点击下钻行为（若存在）。
6. 使用现有 CSS 变量与趋势图样式，确保 Tooltip 不截断，金额轴标签与网格线有足够对比度；不引入第三方图表依赖。

```tsx
const axisIndexes = trend.length <= 6
  ? trend.map((_, index) => index)
  : Array.from({ length: 6 }, (_, slot) => Math.round(slot * (trend.length - 1) / 5))
const yTicks = Array.from({ length: 4 }, (_, index) => scaleMax * (3 - index) / 3)
```

- [ ] **步骤 4：运行定向测试验证绿灯**

运行：

```bash
npm --prefix frontend run test:run -- src/features/overview/OverviewPage.test.tsx
```

预期：总览测试全部通过，新增日期抽样、金额轴和 Tooltip 断言均通过。

- [ ] **步骤 5：运行完整检查与生产构建**

运行：

```bash
npm --prefix frontend run check
npm --prefix frontend run build
```

预期：全量 Vitest、TypeScript 严格检查和 Vite 生产构建均成功。
