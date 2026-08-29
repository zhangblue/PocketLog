# 消费分析柱状图坐标与提示实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让消费分析的支出趋势柱状图显示自适应日期横轴和金额纵轴，并在悬停或键盘聚焦柱子时显示精确金额。

**架构：** 在 `AnalyticsPage.tsx` 内部以纯辅助函数从既有趋势数组计算最多 6 个横轴标签和 4 个纵轴金额刻度。图表组件保持 SVG 实现，使用局部 tooltip 状态响应柱子的鼠标和焦点事件；柱子本身提供点击和键盘下钻，不保留重复的逐日按钮列表。

**技术栈：** React、TypeScript、原生 SVG、Vitest、React DOM 测试工具。

**全局约束：** 不修改后端和 API；不运行 Git 命令；图表仍支持键盘与可访问文字摘要；金额格式复用现有 `formatCurrency`；不改变现有下钻过滤语义。

---

### 任务 1：实现自适应坐标轴与柱状图提示

**文件：**
- 修改：`frontend/src/features/analytics/AnalyticsPage.tsx`
- 修改：`frontend/src/features/analytics/AnalyticsPage.test.tsx`
- 修改：`frontend/src/styles/global.css`

- [ ] **步骤 1：编写会失败的图表交互测试**

在 `AnalyticsPage.test.tsx` 添加一项测试，使用默认 fixture 渲染页面，断言：

```tsx
const axisLabels = container.querySelectorAll('[data-trend-axis-label]')
expect(axisLabels.length).toBeLessThanOrEqual(6)
expect(axisLabels[0]?.textContent).toContain('08-02')
expect(container.querySelectorAll('[data-trend-y-axis-label]').length).toBe(4)

const bar = container.querySelector<SVGRectElement>('[data-trend-column="2026-08-02"]')!
bar.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
await settle()
expect(container.querySelector('[data-trend-tooltip]')?.textContent).toContain('¥1,050')
bar.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
await settle()
expect(container.querySelector('[data-trend-tooltip]')).toBeNull()
```

另以自定义 fixture 构造超过 6 个有支出的日期，断言横轴标签仍不超过 6 个，并保留首尾日期。该测试在实现前应因缺少 `data-trend-axis-label`、纵轴标签、柱子数据属性和 tooltip 而失败。

- [ ] **步骤 2：运行定向测试确认红灯**

运行：

```bash
npm --prefix frontend run test:run -- AnalyticsPage.test.tsx
```

预期：FAIL，原因是新的坐标轴与 tooltip DOM 尚未存在，而不是 TypeScript 或测试环境错误。

- [ ] **步骤 3：实现数据计算和 SVG 交互**

在 `AnalyticsPage.tsx` 中：

```tsx
const MAX_X_AXIS_LABELS = 6

function trendAxisIndexes(length: number) {
  if (length <= MAX_X_AXIS_LABELS) return Array.from({ length }, (_, index) => index)
  return Array.from({ length: MAX_X_AXIS_LABELS }, (_, slot) =>
    Math.round(slot * (length - 1) / (MAX_X_AXIS_LABELS - 1)),
  )
}

function trendScaleMax(maximum: number) {
  if (maximum <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(maximum))
  return Math.ceil(maximum / magnitude) * magnitude
}
```

使用 `trendScaleMax(maxTrend)` 产生从上限到 `0` 的 4 个纵轴刻度。为每根 SVG 柱子增加 `data-trend-column`、鼠标进入/离开和 focus/blur 处理；tooltip 状态保存当前 `{ date, amount }`。使用 SVG `<text>` 渲染 `data-trend-axis-label`、`data-trend-y-axis-label` 与 `data-trend-tooltip`，横轴标签通过 `item.date.slice(5)` 显示月日，tooltip 则显示完整日期和 `formatCurrency(amount)`。

保留现有 `desc` 和 figcaption。移除 `analytics-trend-buttons` 与 `data-trend-bar` 逐日按钮，让可聚焦柱子的 click、Enter 和 Space 作为唯一的当日下钻入口；tooltip 不承担点击行为。

- [ ] **步骤 4：补充样式并验证绿灯**

在 `global.css` 为纵轴、横轴、可聚焦柱子和 SVG tooltip 添加样式：刻度使用 `--color-muted`，tooltip 使用深绿色背景与浅色文字，聚焦柱子有可见轮廓。运行：

```bash
npm --prefix frontend run test:run -- AnalyticsPage.test.tsx
npm --prefix frontend run check
```

预期：新增和既有 AnalyticsPage 测试全部通过，TypeScript 检查通过。

- [ ] **步骤 5：执行前端完整回归**

运行：

```bash
npm --prefix frontend run coverage
npm --prefix frontend run build
```

预期：所有测试和覆盖率门禁通过，`src/app` 与 `src/domain` 逐文件行覆盖率保持至少 90%，生产构建成功。

### 任务 2：移除重复日期按钮并保持柱子可访问下钻

**文件：**
- 修改：`frontend/src/features/analytics/AnalyticsPage.tsx`
- 修改：`frontend/src/features/analytics/AnalyticsPage.test.tsx`
- 修改：`frontend/src/styles/global.css`

- [ ] **步骤 1：编写会失败的可访问下钻与紧凑布局测试**

在 `AnalyticsPage.test.tsx` 新增测试，断言趋势面板没有 `.analytics-trend-buttons` 或 `[data-trend-bar]`，柱子存在 `role="button"` 与可访问名称；聚焦柱子后按 Enter 时，应用进入交易明细且来源说明为该日期支出。测试使用：

```tsx
const column = container.querySelector<SVGRectElement>('[data-trend-column="2026-08-02"]')!
expect(container.querySelector('.analytics-trend-buttons')).toBeNull()
column.focus()
await keyDown(column, 'Enter')
expect(container.querySelector('[data-active-view]')?.getAttribute('data-active-view')).toBe('transactions')
```

- [ ] **步骤 2：运行测试验证失败**

运行：

```bash
npm --prefix frontend run test:run -- AnalyticsPage.test.tsx
```

预期：FAIL，旧逐日按钮仍存在，或 SVG 的可访问语义尚不能支持键盘下钻。

- [ ] **步骤 3：最小实现紧凑图表布局**

从 `AnalyticsPage.tsx` 移除逐日 `analytics-trend-buttons` 渲染；保留每根柱子的 `role="button"`、`tabIndex={0}`、可访问名称、click 与 Enter/Space 事件。将 SVG 从静态图片角色调整为具有 `aria-labelledby` 的分组语义，保留 `<title>` 和 `<desc>`。移除 `global.css` 中只服务于 `analytics-trend-buttons` 的规则。

- [ ] **步骤 4：运行定向测试和页面检查**

运行：

```bash
npm --prefix frontend run test:run -- AnalyticsPage.test.tsx
npm --prefix frontend run check
```

使用 Chrome DevTools MCP 在 `1024×768` 检查趋势图：SVG 宽度不应被日期按钮撑出面板；横轴仍至多 6 个标签；聚焦或悬停柱子仍显示 tooltip。
