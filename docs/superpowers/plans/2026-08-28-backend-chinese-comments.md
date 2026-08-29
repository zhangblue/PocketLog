# 后端中文注释实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:subagent-driven-development` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法跟踪进度。

**目标：** 为 `backend/` 的 Rust 生产代码补充准确、简洁的中文注释，帮助维护者理解职责、业务约束、事务边界和运行时行为，而不改变逻辑。

**架构：** 注释按代码层次分为 API、应用服务、领域模型、基础设施与迁移五个独立任务。每个文件补模块职责说明，并只在非直观的公共类型、关键分支、数据库事务、并发控制或安全边界处增加“为什么”注释；不逐行翻译语法，也不修改测试语义。

**技术栈：** Rust、Axum、SeaORM、PostgreSQL、Cargo fmt、Clippy。

**全局约束：** 所有业务代码维持在 `backend/`；只编辑注释和此计划，不改变行为、公开 API、SQL、迁移内容或测试断言；不运行 Git 命令、不创建提交或分支。测试模块仅在测试场景目的不明显时补一行中文说明。

---

### 任务 1：标注 API 与命令边界

**文件：**
- 修改：`backend/src/api/**/*.rs`
- 修改：`backend/src/command.rs`
- 修改：`backend/src/config.rs`
- 修改：`backend/src/main.rs`

- [x] **步骤 1：检查 API 的现有职责与非直观分支**

阅读路由、中间件、错误映射、DTO、处理器、配置与命令入口，列出请求 ID 归一化、Problem Details、静态文件缓存、readiness 和参数解析等需要解释的边界。

- [x] **步骤 2：添加中文职责与约束注释**

在模块、关键类型和关键分支前添加类似如下的注释，不修改可执行语句：

```rust
// 所有 API 失败都归一为 Problem Details，避免提取器失败绕过统一错误契约。
pub async fn normalize_errors(/* 保持原签名 */) { /* 保持原逻辑 */ }

// `serve` 只验证 schema；迁移必须由显式 `migrate` 命令完成。
async fn serve(/* 保持原签名 */) { /* 保持原逻辑 */ }
```

- [x] **步骤 3：格式化并验证 API 层不变**

运行：`cargo fmt --manifest-path backend/Cargo.toml --check && cargo test --manifest-path backend/Cargo.toml --lib api::`

预期：格式检查与 API 库内测试通过。

### 任务 2：标注应用服务与领域规则

**文件：**
- 修改：`backend/src/application/**/*.rs`
- 修改：`backend/src/domain/**/*.rs`

- [x] **步骤 1：检查业务不变量和服务编排点**

阅读交易、标签、洞察、报告、金额、日历与端口定义，确定需要解释的验证顺序、修订版本、幂等键、时区、本地日期、转账、洞察证据与只读快照语义。

- [x] **步骤 2：添加中文领域与编排注释**

为模块和关键不变量添加注释，例如：

```rust
// 修订版本在写入前比较，防止并发客户端以旧页面状态覆盖新数据。
fn check_revision(/* 保持原签名 */) { /* 保持原逻辑 */ }

// 本地日期独立保存，避免服务进程所在时区改变月度统计与周末判断。
pub struct LocalDateTime { /* 保持原字段 */ }
```

- [x] **步骤 3：格式化并验证领域与应用层不变**

运行：`cargo fmt --manifest-path backend/Cargo.toml --check && cargo test --manifest-path backend/Cargo.toml --lib application:: domain::`

预期：格式检查、应用层和领域层库内测试通过。

### 任务 3：标注持久化、迁移和运行时基础设施

**文件：**
- 修改：`backend/src/infrastructure/**/*.rs`
- 修改：`backend/src/migration/**/*.rs`
- 修改：`backend/src/lib.rs`

- [x] **步骤 1：检查事务、schema 和后台任务的安全边界**

阅读连接、实体、仓储、seed、schema、静态资源、清理任务与迁移，确定需要解释的事务原子性、隔离级别、seed 幂等性、迁移锁、删除过期记录与静态资源缓存策略。

- [x] **步骤 2：添加中文基础设施注释**

在关键边界添加注释，例如：

```rust
// 标签迁移与源标签删除位于同一数据库事务，任一步失败都会回滚。
async fn migrate_category(/* 保持原签名 */) { /* 保持原逻辑 */ }

// 初始演示数据只在 seed_version 为 0 时写入，避免每次启动覆盖用户账本。
pub async fn seed_if_needed(/* 保持原签名 */) { /* 保持原逻辑 */ }
```

- [x] **步骤 3：格式化并运行真实 PostgreSQL 相关测试**

运行：`cargo fmt --manifest-path backend/Cargo.toml --check && TEST_DATABASE_URL="$TEST_DATABASE_URL" cargo test --manifest-path backend/Cargo.toml --test migration_test --test persistence_test --test runtime_test`

预期：格式检查和指定迁移、持久化、运行时测试通过。

### 任务 4：统一注释质量并完成最终回归

**文件：**
- 修改：任务 1–3 中被审查发现需要调整的文件
- 修改：`docs/superpowers/plans/2026-08-28-backend-chinese-comments.md`

- [x] **步骤 1：审查全体生产文件的注释质量**

检查 `backend/src`，确认每个生产模块都有中文职责说明或存在足够的关键注释；删除重复代码字面含义、过期描述和与实际行为不一致的注释。

- [x] **步骤 2：记录完成状态**

将本计划中的所有已验证步骤标记为完成，并在末尾附上实际运行命令与结果摘要；不使用 Git 作为记录方式。

- [x] **步骤 3：运行完整后端回归**

运行：`cargo fmt --manifest-path backend/Cargo.toml --check && cargo clippy --manifest-path backend/Cargo.toml --all-targets --all-features -- -D warnings && TEST_DATABASE_URL="$TEST_DATABASE_URL" cargo test --manifest-path backend/Cargo.toml --all-features && cargo build --manifest-path backend/Cargo.toml --release`

预期：所有命令退出码为 0，行为与注释前一致。

## 验证记录（2026-08-28）

- `cargo fmt --manifest-path backend/Cargo.toml --check`：通过。
- `cargo clippy --manifest-path backend/Cargo.toml --all-targets --all-features -- -D warnings`：通过。
- `TEST_DATABASE_URL=… cargo test --manifest-path backend/Cargo.toml --all-features`：102 个测试通过。
- `cargo build --manifest-path backend/Cargo.toml --release`：通过。
- API、应用/领域、基础设施/迁移及全局注释审查均完成；最终复审未发现未解决问题。
