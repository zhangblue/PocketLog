# 分类图标紧凑选择与编辑实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让分类页采用紧凑 Emoji 选择器，并允许用户安全地编辑既有分类的名称和图标。

**架构：** 前端分类行以局部编辑草稿承载名称与 Emoji，保存时经 FinanceProvider 调用一个原子分类更新动作。后端扩展现有 PATCH 分类请求与事务服务，在一次 revision 校验和写事务中更新名称、图标或两者；成功响应后前端才替换分类状态。

**技术栈：** React、TypeScript、Vitest、Rust、Axum、SeaORM、PostgreSQL。

---

## 文件结构

- `frontend/src/features/settings/LabelsPage.tsx`：新增分类紧凑图标选择器和分类行内编辑交互。
- `frontend/src/features/settings/LabelsPage.test.tsx`：从真实页面行为覆盖新增图标布局、编辑保存、失败与取消。
- `frontend/src/app/FinanceProvider.tsx`：暴露原子分类更新动作，并只在 API 成功后替换内存分类。
- `frontend/src/app/FinanceProvider.test.tsx`：验证 Provider 向 API 发送名称和 Emoji 更新，且失败不污染状态。
- `backend/src/api/dto.rs`：允许分类 PATCH 请求携带可选 `emoji`。
- `backend/src/api/router.rs`：将名称/Emoji PATCH 请求分发到原子更新服务，同时维持 active 分支。
- `backend/src/application/labels.rs`：在单一写事务内更新提供字段并推进 revision。
- `backend/src/infrastructure/repositories.rs`：实现分类 Emoji 更新（含 `updated_at`）。
- `backend/tests/labels_test.rs` 与 `backend/tests/api_test.rs`：覆盖真实 PostgreSQL 服务和 API 的名称+图标更新及 revision 契约。

### 任务 1：原子分类名称与 Emoji 更新接口

**文件：**
- 修改：`backend/src/api/dto.rs`
- 修改：`backend/src/api/router.rs`
- 修改：`backend/src/application/labels.rs`
- 修改：`backend/src/application/ports.rs`
- 修改：`backend/src/infrastructure/repositories.rs`
- 测试：`backend/tests/labels_test.rs`
- 测试：`backend/tests/api_test.rs`

- [ ] **步骤 1：先写服务层失败测试**

在 `labels_test.rs` 新建停用/启用无关的测试：创建或选取分类，记录当前 revision，调用将名称改为 `“水电费”`、Emoji 改为 `“💧”` 的更新动作；断言返回分类两个字段均更新，且 revision 仅加一。该测试应在缺少原子更新方法时无法编译或失败。

- [ ] **步骤 2：运行服务测试验证红灯**

运行：

```bash
TEST_DATABASE_URL='postgresql://root:123456@127.0.0.1:5432/pocket_log' cargo test --manifest-path backend/Cargo.toml --test labels_test update_category_name_and_emoji -- --nocapture
```

预期：FAIL，原因是原子更新方法或 Emoji 更新能力不存在。

- [ ] **步骤 3：先写 PATCH 真实 API 失败测试**

在 `api_test.rs` 使用真实 app 和 PostgreSQL：先取 bootstrap revision，发送 `PATCH /api/v1/categories/{id}`，携带 `{ "name": "水电费", "emoji": "💧" }` 与 `If-Match`，断言 `200`、响应数据字段更新，并使用响应 revision 继续请求。该测试必须覆盖真实 JSON DTO 与路由。

- [ ] **步骤 4：运行 API 测试验证红灯**

运行：

```bash
TEST_DATABASE_URL='postgresql://root:123456@127.0.0.1:5432/pocket_log' cargo test --manifest-path backend/Cargo.toml --test api_test patch_category_updates_name_and_emoji -- --nocapture
```

预期：FAIL，原因是 PATCH DTO 忽略/拒绝 `emoji`，或响应未更新该字段。

- [ ] **步骤 5：实现最小原子更新路径**

1. 给 `LabelPatch` 增加 `emoji: Option<String>`。
2. 在 ports 上提供 `update_category(id, name: Option<String>, emoji: Option<String>)`，仓储读取目标分类、仅替换提供字段、为名称复用既有规范化/唯一性校验、设置 `updated_at` 并返回 DTO。
3. 在 `LabelService` 添加 `update_category`：开始写事务，锁住并校验 revision，调用仓储更新，递增 revision，使用既有 `finish` 保障失败回滚。
4. 路由保持 `active: false` 与 `active: true` 的专用生命周期分支；其余只要 `name` 或 `emoji` 非空便调用原子更新，否则返回既有 `label.patch_invalid`。

```rust
pub async fn update_category(
    &self,
    id: Uuid,
    name: Option<String>,
    emoji: Option<String>,
    expected: DataRevision,
) -> Result<Mutation<CategoryDto>, AppError> {
    let mut tx = self.repository.begin_write().await?;
    let state = tx.lock_app_state().await?;
    check_revision(state.data_revision, expected)?;
    let result = async {
        let value = tx.update_category(id, name, emoji).await?;
        let revision = tx.increment_data_revision().await?;
        Ok(Mutation { value, data_revision: revision })
    }.await;
    finish(tx, result, expected).await
}
```

- [ ] **步骤 6：运行后端绿灯与格式检查**

运行：

```bash
cargo fmt --manifest-path backend/Cargo.toml --check
TEST_DATABASE_URL='postgresql://root:123456@127.0.0.1:5432/pocket_log' cargo test --manifest-path backend/Cargo.toml --test labels_test update_category_name_and_emoji -- --nocapture
TEST_DATABASE_URL='postgresql://root:123456@127.0.0.1:5432/pocket_log' cargo test --manifest-path backend/Cargo.toml --test api_test patch_category_updates_name_and_emoji -- --nocapture
```

预期：三条命令均成功。

### 任务 2：紧凑选择器与分类行内编辑

**文件：**
- 修改：`frontend/src/app/FinanceProvider.tsx`
- 修改：`frontend/src/app/FinanceProvider.test.tsx`
- 修改：`frontend/src/features/settings/LabelsPage.tsx`
- 修改：`frontend/src/features/settings/LabelsPage.test.tsx`

- [ ] **步骤 1：先写页面失败测试**

在 `LabelsPage.test.tsx` 增加以下真实页面行为测试：

```tsx
it('编辑分类时保存名称与图标', async () => {
  const api = createFixtureApi()
  const patchCategory = vi.spyOn(api, 'patchCategory')
  const { container } = await render(<FinanceProvider api={api}><LabelsPage /></FinanceProvider>)
  await click(screen.getByRole('button', { name: '编辑 餐饮' }))
  await changeInput(screen.getByLabelText('编辑分类名称'), '餐馆')
  await changeSelect(screen.getByLabelText('编辑分类图标'), '🍜')
  await click(screen.getByRole('button', { name: '保存分类修改' }))
  expect(patchCategory).toHaveBeenCalledWith('food', { name: '餐馆', emoji: '🍜' }, expect.any(Number))
})
```

另加测试断言 `[aria-label="分类图标"]` 的 computed width 为紧凑宽度（或其 CSS class 的可观察尺寸），取消编辑不调用 `patchCategory`，以及 API 拒绝时输入值与编辑区仍保留。

- [ ] **步骤 2：运行页面测试验证红灯**

运行：

```bash
npm --prefix frontend run test:run -- LabelsPage.test.tsx
```

预期：FAIL，因为编辑按钮、编辑字段和原子保存动作尚不存在。

- [ ] **步骤 3：先写 Provider 失败测试**

在 `FinanceProvider.test.tsx` 的 probe 中调用 `actions.updateCategory('food', { name: '餐馆', emoji: '🍜' })`；断言成功后分类名称和 Emoji 均来自 API 响应。另为 `patchCategory` reject 的 fixture 断言 action 返回失败且分类仍保留原始名称与 Emoji。

- [ ] **步骤 4：运行 Provider 测试验证红灯**

运行：

```bash
npm --prefix frontend run test:run -- FinanceProvider.test.tsx
```

预期：FAIL，因为 `updateCategory` 尚未暴露。

- [ ] **步骤 5：实现最小前端行为**

1. 在 FinanceProvider 的 actions 类型与实现增加 `updateCategory(id, input)`，调用 `patchCategory`，仅在成功后更新 revision、`categoriesRef` 和 reducer 状态。
2. 在 LabelsPage 增加单一编辑目标和草稿 state；“编辑 {分类名}”展开行内字段，默认使用当前名称和 Emoji。
3. 固定图标下拉选择器使用共享的 Emoji options；若当前值不在选项内，插入当前 Emoji 选项。自定义 Emoji 非空则作为请求 emoji，否则使用固定选择。
4. 保存调用 `updateCategory`；成功关闭编辑区，失败显示项目既有友好错误且不清空草稿。取消关闭编辑区而不请求 API。
5. 为新增与编辑固定图标 select 增加紧凑 CSS class，例如：

```css
.category-icon-select {
  width: 44px;
  min-width: 44px;
  padding-inline: 4px;
  font-size: 1.15rem;
}
```

保留原生箭头、标签与 `:focus-visible`，避免将实际命中区域缩小到低于现有控件高度。

- [ ] **步骤 6：运行前端绿灯、全量检查和生产构建**

运行：

```bash
npm --prefix frontend run test:run -- LabelsPage.test.tsx FinanceProvider.test.tsx
npm --prefix frontend run check
npm --prefix frontend run build
```

预期：所有定向测试、全量测试、严格类型检查和构建成功。
