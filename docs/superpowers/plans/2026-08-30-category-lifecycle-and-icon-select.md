# 分类生命周期与图标下拉实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 精简固定图标下拉为 Emoji，并同步分类启用、停用、删除和迁移操作。

**架构：** 复用现有分类激活 API 和 `FinanceProvider` 动作；`LabelsPage` 根据 `active` 与真实当前列表交易引用呈现操作，仍以服务端拒绝作为最终约束并显示确定中文错误。

**技术栈：** React、TypeScript、Vitest、现有 Axum 标签 API。

---

### 任务 1：图标下拉与分类生命周期

**文件：**
- 修改：`frontend/src/features/settings/LabelsPage.tsx`
- 修改：`frontend/src/features/settings/LabelsPage.test.tsx`
- 修改：`frontend/src/app/FinanceProvider.tsx`
- 修改：`frontend/src/app/FinanceProvider.test.tsx`

- [ ] **步骤 1：写失败测试**

断言图标 select 的每个 option 文本仅为 Emoji；启用分类只有停用按钮；停用未引用分类有启用与删除；停用已引用分类有启用与迁移；点击启用调用 API 后分类恢复 active；服务端 `category.delete_requires_inactive` 在确认框显示“请先停用该分类后再删除”。

- [ ] **步骤 2：运行定向测试验证失败**

运行：`npm --prefix frontend run test:run -- LabelsPage.test.tsx FinanceProvider.test.tsx`

预期：旧的图标文字、缺失启用动作和错误映射断言失败。

- [ ] **步骤 3：实现最小修订**

将 option 内容改为 `{icon.emoji}`。在 FinanceActions 添加 `activateCategory(id)`，通过
`patchCategory(id, { active: true })` 更新 revision、reducer 和 categoriesRef。根据分类 active
与引用状态渲染启用、停用、删除和迁移按钮。将 `category.delete_requires_inactive` 映射为确定中文提示。

- [ ] **步骤 4：运行定向测试验证通过**

运行：`npm --prefix frontend run test:run -- LabelsPage.test.tsx FinanceProvider.test.tsx`

预期：全部通过。

### 任务 2：完整验证

- [ ] **步骤 1：前端检查与构建**

运行：`npm --prefix frontend run check && npm --prefix frontend run build`

预期：全部测试、TypeScript 检查和生产构建通过。
