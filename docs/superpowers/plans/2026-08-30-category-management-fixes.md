# 分类管理交互修订实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将分类图标改为下拉选择，并修复删除反馈、空名称提示和按钮折行。

**架构：** `LabelsPage` 在提交前执行本地名称校验并通过 `showResult` 呈现友好错误；`FinanceProvider` 将后端标签错误码映射为中文语义。删除继续由服务端判断真实历史引用，前端在对话框内保留失败提示。

**技术栈：** React、TypeScript、Vitest、原生 CSS、现有 Axum API。

---

### 任务 1：分类表单、删除反馈与错误映射

**文件：**
- 修改：`frontend/src/features/settings/LabelsPage.tsx`
- 修改：`frontend/src/features/settings/LabelsPage.test.tsx`
- 修改：`frontend/src/app/FinanceProvider.tsx`
- 修改：`frontend/src/app/FinanceProvider.test.tsx`
- 修改：`frontend/src/styles/global.css`

- [ ] **步骤 1：写失败测试**

覆盖固定图标 `<select>`、选项文字、创建请求 Emoji；空名称不调用 API、显示“请输入分类名称”并聚焦输入；删除 API 返回历史引用错误时对话框保留并显示“该分类已有历史记录，请先停用或迁移”；成功删除后分类从列表消失。

- [ ] **步骤 2：运行定向测试验证失败**

运行：`npm --prefix frontend run test:run -- LabelsPage.test.tsx FinanceProvider.test.tsx`

预期：旧网格结构、原始错误码和删除失败反馈断言失败。

- [ ] **步骤 3：实现最小修订**

用单个 `<select aria-label="分类图标">` 替换固定图标按钮网格，保留自定义输入优先级。
在 `submitCategory` 中空名称短路、设置错误并聚焦名称 ref。将 `label.name_length_invalid`
和分类被引用的 API 错误映射为确定中文文案。删除失败由 `confirmPending` 写入
`dialogError`，不关闭对话框；成功路径保持原有状态更新。

- [ ] **步骤 4：防止按钮折行**

为分类创建提交按钮添加 `white-space: nowrap`、合理最小宽度，并使表单在窄布局中允许
控件换行而不裁切按钮。

- [ ] **步骤 5：运行定向测试验证通过**

运行：`npm --prefix frontend run test:run -- LabelsPage.test.tsx FinanceProvider.test.tsx`

预期：全部通过。

### 任务 2：完整验证

- [ ] **步骤 1：运行前端检查与构建**

运行：`npm --prefix frontend run check && npm --prefix frontend run build`

预期：类型检查、全部测试与生产构建通过。

- [ ] **步骤 2：Chrome DevTools 验收**

在分类管理页确认图标为下拉框；空名称提示友好；删除错误留在对话框；“添加分类”不折行，
并在 1024×768 无关键内容裁切。
