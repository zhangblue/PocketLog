# 分类图标选择器实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让用户在创建分类时选择固定常用图标或输入自定义 Emoji，并将其持久化。

**架构：** 图标配置及表单状态由 `LabelsPage` 管理，直接复用 `createCategory` 已有可选 `emoji` 参数与后端 API 契约。图标按钮是语义化 button，自定义输入和固定图标共同写入同一个选中 Emoji 状态。

**技术栈：** React、TypeScript、Vitest、原生 CSS。

---

## 文件结构

- 修改：`frontend/src/features/settings/LabelsPage.tsx` — 固定图标集、选择状态、表单传值与可访问交互。
- 修改：`frontend/src/features/settings/LabelsPage.test.tsx` — 覆盖类型网格、固定选择、自定义输入与键盘操作。
- 修改：`frontend/src/styles/global.css` — 图标网格、选中态和自定义输入布局。

### 任务 1：图标选择与持久化

**文件：**
- 修改：`frontend/src/features/settings/LabelsPage.tsx`
- 修改：`frontend/src/features/settings/LabelsPage.test.tsx`
- 修改：`frontend/src/styles/global.css`

- [ ] **步骤 1：编写失败测试**

在 `LabelsPage.test.tsx` 增加测试：渲染支出网格中的“通讯 📱”“网络 🌐”；切到收入后显示“其他 🏷️”且不显示支出专属项；点击闪电后提交请求包含 `emoji: '⚡'`；输入自定义 Emoji 后提交包含该值，切换类型仍保留它；键盘 Enter 或 Space 可选择图标。

```tsx
expect(container.querySelector('[data-category-icon="📱"]')).toBeTruthy()
await click(container.querySelector('[data-category-icon="⚡"]')!)
expect(api.createCategory).toHaveBeenCalledWith(expect.objectContaining({ emoji: '⚡' }))
```

- [ ] **步骤 2：运行定向测试验证失败**

运行：`npm --prefix frontend run test:run -- LabelsPage.test.tsx`

预期：图标控件和 `emoji` 请求断言失败。

- [ ] **步骤 3：实现最小图标选择器**

在 `LabelsPage.tsx` 定义支出与收入固定图标数组和默认值 `🏷️`，新增 `categoryEmoji` 与
`customEmoji` 状态。类型改变时仅在当前选择是另一类固定图标时回退默认值；自定义输入值不
重置。提交时调用现有动作：

```tsx
actions.createCategory({ name: categoryName, kind: categoryKind, emoji: categoryEmoji })
```

图标按钮使用 `type="button"`、`data-category-icon`、带名称的 `aria-label` 和
`aria-pressed`；使用现有 button 原生键盘行为。输入框以修剪后的非空值覆盖选择，清空后
保留最近固定选择或默认值。

- [ ] **步骤 4：实现网格样式**

在 `global.css` 为 `.category-icon-picker` 和图标 button 添加可换行网格、图标/文字布局、
`[aria-pressed="true"]` 选中边框，以及与现有 `:focus-visible` 一致的焦点样式；保持
1024px 视口不溢出。

- [ ] **步骤 5：运行定向测试验证通过**

运行：`npm --prefix frontend run test:run -- LabelsPage.test.tsx`

预期：图标选择器相关测试及原有标签管理测试全部通过。

### 任务 2：完整验证

**文件：**
- 修改：本计划复选框状态

- [ ] **步骤 1：运行前端检查与构建**

运行：`npm --prefix frontend run check && npm --prefix frontend run build`

预期：TypeScript 检查、全部测试和生产构建通过。

- [ ] **步骤 2：Chrome DevTools 验收**

打开分类管理页，验证支出网格含通讯/网络、收入网格含其他、选择态清晰、手动 Emoji 输入
可覆盖固定图标，且在 1024×768 视口无关键内容裁切。
