# 共享自定义图标库实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为分类管理页增加持久化的共享自定义 Emoji 图标库，并让分类图标下拉框使用该图标库。

**架构：** 后端新增 `custom_icons` 表和受 revision 保护的创建接口，Bootstrap 返回共享图标列表；前端 FinanceProvider 保存图标库状态并提供创建动作，LabelsPage 将内置图标与用户图标合并到紧凑下拉框。分类表单不再提供自由输入 Emoji。

**技术栈：** Rust、Axum、SeaORM、PostgreSQL、React、TypeScript、Vitest、Vite。

---

## 文件结构

- 创建：`backend/src/migration/m20260831_000002_create_custom_icons.rs`，创建自定义图标表及约束。
- 修改：`backend/src/migration/mod.rs`，注册迁移并更新迁移清单测试。
- 修改：`backend/src/application/dto.rs`、`ports.rs`、`labels.rs`，定义图标 DTO、读写端口和校验/事务服务。
- 修改：`backend/src/infrastructure/entities/custom_icon.rs`、`entities/mod.rs`、`repositories.rs`，完成 SeaORM 映射和 PostgreSQL 持久化。
- 修改：`backend/src/api/dto.rs`、`router.rs`，扩展 Bootstrap 和新增 POST API。
- 修改：`backend/tests/migration_test.rs`、`labels_test.rs`、`api_test.rs`，覆盖迁移、服务和 API。
- 修改：`frontend/src/api/types.ts`、`financeApi.ts`，扩展 Bootstrap 类型和创建图标请求。
- 修改：`frontend/src/app/financeReducer.ts`、`FinanceProvider.tsx`，维护 customIcons 状态及动作。
- 修改：`frontend/src/features/settings/LabelsPage.tsx`、`LabelsPage.test.tsx`、`FinanceProvider.test.tsx`，实现独立图标库和下拉联动。

### 任务 1：后端自定义图标持久化与 API

**文件：**上方后端迁移、应用、实体、仓储、API 和测试文件。

- [ ] **步骤 1：编写迁移、领域与 API 失败测试**

先在迁移测试断言迁移数量增加；在服务测试断言 `create_custom_icon("🧋")` 返回图标并使 revision 加一；在 API 测试发送 `POST /api/v1/custom-icons` 后断言 201/200 响应包含 Emoji，随后 bootstrap 包含该图标。补充空白、17 字符和重复 Emoji 返回稳定业务错误的测试。

- [ ] **步骤 2：运行后端测试确认红灯**

```bash
TEST_DATABASE_URL='postgresql://root:123456@127.0.0.1:5432/pocket_log' cargo test --manifest-path backend/Cargo.toml --test labels_test create_custom_icon -- --nocapture
```

预期：因迁移、端口或服务方法不存在而失败。

- [ ] **步骤 3：实现显式迁移和 SeaORM 映射**

创建 `custom_icons` 表：UUID 主键、唯一 `emoji`、`created_at`，增加 `char_length(btrim(emoji)) BETWEEN 1 AND 16` 检查。将迁移注册到 `Migrator::migrations()`，但不修改 serve 启动流程；schema 仍只能由显式 `migrate` 命令变更。新增实体并在仓储 Bootstrap 查询按创建时间排序。

- [ ] **步骤 4：实现服务、路由和 Bootstrap 字段**

为 `BootstrapSnapshot/Response` 增加 `custom_icons: Vec<String>`，新增 `POST /api/v1/custom-icons`。服务在写事务中锁定/校验 revision，trim 并校验 Unicode 字符数，检查重复后插入，成功才递增 revision；错误回滚并映射为 `custom_icon.empty`、`custom_icon.length_invalid`、`custom_icon.duplicate`。

```rust
pub async fn create_custom_icon(
    &self,
    raw_emoji: impl Into<String>,
    expected: DataRevision,
) -> Result<Mutation<CustomIconDto>, AppError> {
    let mut tx = self.repository.begin_write().await?;
    let state = tx.lock_app_state().await?;
    check_revision(state.data_revision, expected)?;
    let emoji = normalize_custom_icon(&raw_emoji.into())?;
    let result = async {
        let value = tx.insert_custom_icon(emoji).await?;
        let revision = tx.increment_data_revision().await?;
        Ok(Mutation { value, data_revision: revision })
    }.await;
    finish(tx, result, expected).await
}
```

- [ ] **步骤 5：运行后端绿灯与格式检查**

```bash
cargo fmt --manifest-path backend/Cargo.toml --check
TEST_DATABASE_URL='postgresql://root:123456@127.0.0.1:5432/pocket_log' cargo test --manifest-path backend/Cargo.toml --test migration_test -- --nocapture
TEST_DATABASE_URL='postgresql://root:123456@127.0.0.1:5432/pocket_log' cargo test --manifest-path backend/Cargo.toml --test labels_test create_custom_icon -- --nocapture
TEST_DATABASE_URL='postgresql://root:123456@127.0.0.1:5432/pocket_log' cargo test --manifest-path backend/Cargo.toml --test api_test custom_icon -- --nocapture
```

### 任务 2：前端独立图标库与分类下拉联动

**文件：**上方前端 API、Provider、reducer、设置页和测试文件。

- [ ] **步骤 1：编写前端失败测试**

增加页面测试：独立图标区域存在；提交 `🧋` 调用 `createCustomIcon`；成功后图标出现在分类图标下拉框；空输入显示友好错误且不请求；分类表单不存在自定义图标输入。增加 Provider 测试断言 bootstrap customIcons 保存，以及创建失败不污染图标库。

- [ ] **步骤 2：运行前端测试确认红灯**

```bash
npm --prefix frontend run test:run -- LabelsPage.test.tsx FinanceProvider.test.tsx
```

预期：因 customIcons 状态、动作和独立图标区域不存在而失败。

- [ ] **步骤 3：实现 Provider/API/reducer 联动**

扩展 Bootstrap 类型与 fixture API；在 reducer 的 bootstrap 成功 action 中保存 `customIcons`；FinanceProvider 暴露 `createCustomIcon(emoji)`，调用 POST，成功后用响应图标和 dataRevision 更新状态，失败保持输入与原列表。分类创建/更新只发送下拉框所选 Emoji。

- [ ] **步骤 4：实现 LabelsPage 图标库 UI**

移除分类新增/编辑区的自由 Emoji 输入和相关 customEmoji 状态；增加“自定义图标”独立表单，输入错误时聚焦输入框。将固定图标与 `state.customIcons` 去重合并为下拉选项，保持约 44px 宽；编辑历史图标不在列表时临时保留当前值。添加成功后清空输入并立即反映在下拉框。

- [ ] **步骤 5：运行前端绿灯与完整验证**

```bash
npm --prefix frontend run test:run -- LabelsPage.test.tsx FinanceProvider.test.tsx
npm --prefix frontend run check
npm --prefix frontend run build
```

预期：定向测试与全量测试通过，TypeScript 严格检查和生产构建成功。
