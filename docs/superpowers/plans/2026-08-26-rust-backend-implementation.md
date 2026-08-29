# 栖账 Rust 后端实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在 `backend/` 内实现 Axum + SeaORM + PostgreSQL 后端，使 PostgreSQL 成为单用户栖账的唯一财务数据源，并让现有 React 前端通过服务端 API 获取交易、标签、分析和月报。

**架构：** 后端采用分层模块化单体，Axum Handler 调用 Application Service，Application Service 通过仓储端口使用 SeaORM，并由纯 Rust Domain 模块维护金额、时间、交易、标签和分析规则。生产进程同时提供 `/api/v1/*` 和 `frontend/dist`，schema 只能由显式 `pocket-log-backend migrate` 执行，`serve` 只检查迁移版本。

**技术栈：** Rust、Axum 0.8、Tokio、SeaORM 1.1、SeaORM Migration、PostgreSQL、Serde、Tower/Tower HTTP、React 19、TypeScript、Vite、Vitest。

**设计规格：** 实施前完整阅读 `docs/superpowers/specs/2026-08-26-rust-backend-design.md`；本计划中的接口、事务和测试步骤必须服从该规格。

**工程约束：** 本项目不使用 Git。不要创建 worktree、分支、提交或运行任何 Git 命令；每个任务末尾以测试输出、覆盖率结果和文件清单作为审查证据。

---

## 计划文件结构

### 后端运行与配置

- 创建：`backend/Cargo.toml` — 后端包、二进制、依赖、测试特性和严格 lint 配置。
- 创建：`backend/Cargo.lock` — 锁定实际解析的补丁版本。
- 创建：`backend/src/main.rs` — 解析 `migrate` / `serve` 子命令并映射退出码。
- 创建：`backend/src/lib.rs` — 暴露可测试的路由、应用、领域和基础设施模块。
- 创建：`backend/src/config.rs` — 环境配置读取、校验和脱敏错误。
- 创建：`backend/src/command.rs` — 显式迁移、schema 检查、种子和服务启动编排。

### 后端领域与应用

- 创建：`backend/src/domain/mod.rs` — 领域模块出口。
- 创建：`backend/src/domain/error.rs` — 稳定领域错误码。
- 创建：`backend/src/domain/money.rs` — 精确金额解析、运算和序列化边界。
- 创建：`backend/src/domain/calendar.rs` — 本地日期、月份、比较周期和周末判断。
- 创建：`backend/src/domain/transaction.rs` — 交易类型和值对象约束。
- 创建：`backend/src/domain/labels.rs` — 分类、账户、排序、停用和迁移规则。
- 创建：`backend/src/domain/analytics.rs` — 汇总、趋势、构成、比较和洞察。
- 创建：`backend/src/domain/report.rs` — 评分、亮点和故事生成。
- 创建：`backend/src/application/mod.rs` — 应用服务出口。
- 创建：`backend/src/application/clock.rs` — 可替换系统时钟。
- 创建：`backend/src/application/ports.rs` — 仓储与事务端口。
- 创建：`backend/src/application/dto.rs` — 应用层输入输出，不依赖 Axum。
- 创建：`backend/src/application/bootstrap.rs` — 初始化快照用例。
- 创建：`backend/src/application/transactions.rs` — 交易创建、查询、删除和恢复用例。
- 创建：`backend/src/application/labels.rs` — 分类与账户用例。
- 创建：`backend/src/application/insights.rs` — 总览、分析和月报查询用例。

### PostgreSQL 与 SeaORM

- 创建：`backend/src/infrastructure/mod.rs` — 基础设施模块出口。
- 创建：`backend/src/infrastructure/db.rs` — SeaORM 连接池与事务配置。
- 创建：`backend/src/infrastructure/schema.rs` — 当前迁移版本只读检查。
- 创建：`backend/src/infrastructure/seed.rs` — 幂等演示数据事务。
- 创建：`backend/src/infrastructure/cleanup.rs` — 过期删除与幂等记录清理任务。
- 创建：`backend/src/infrastructure/repositories.rs` — 应用仓储端口的 SeaORM 实现。
- 创建：`backend/src/infrastructure/entities/mod.rs` — SeaORM 实体出口。
- 创建：`backend/src/infrastructure/entities/category.rs` — `categories` 实体。
- 创建：`backend/src/infrastructure/entities/account_label.rs` — `account_labels` 实体。
- 创建：`backend/src/infrastructure/entities/transaction.rs` — `transactions` 实体。
- 创建：`backend/src/infrastructure/entities/app_state.rs` — 单例修订和种子状态实体。
- 创建：`backend/src/infrastructure/entities/idempotency_request.rs` — 幂等请求实体。
- 创建：`backend/src/migration/mod.rs` — SeaORM Migrator。
- 创建：`backend/src/migration/m20260826_000001_create_ledger.rs` — 首版 schema、约束和索引。

### Axum API 与静态资源

- 创建：`backend/src/api/mod.rs` — API 模块出口。
- 创建：`backend/src/api/router.rs` — Router、AppState、路由和中间件组合。
- 创建：`backend/src/api/error.rs` — `application/problem+json` 映射。
- 创建：`backend/src/api/middleware.rs` — request ID、追踪、超时和请求体限制。
- 创建：`backend/src/api/dto.rs` — HTTP JSON/query DTO 与 camelCase 序列化。
- 创建：`backend/src/api/handlers/bootstrap.rs` — bootstrap 和健康检查。
- 创建：`backend/src/api/handlers/transactions.rs` — 交易路由。
- 创建：`backend/src/api/handlers/labels.rs` — 分类和账户路由。
- 创建：`backend/src/api/handlers/insights.rs` — 总览、分析和月报路由。
- 创建：`backend/src/infrastructure/static_files.rs` — SPA 静态文件、缓存和回退。

### 后端测试与交付

- 创建：`backend/tests/support/mod.rs` — 真实 PostgreSQL 隔离 schema、固定时钟和测试应用。
- 创建：`backend/tests/migration_test.rs` — 显式迁移与拒绝自动迁移。
- 创建：`backend/tests/persistence_test.rs` — 约束、种子和仓储。
- 创建：`backend/tests/transactions_test.rs` — 创建、幂等、查询、删除和恢复应用服务。
- 创建：`backend/tests/labels_test.rs` — 标签应用服务与迁移事务。
- 创建：`backend/tests/insights_test.rs` — 总览、分析、证据和月报应用服务。
- 创建：`backend/tests/api_test.rs` — 完整 HTTP 路由、DTO 和错误契约。
- 创建：`backend/tests/runtime_test.rs` — 健康检查、静态资源和错误契约。
- 创建：`backend/.env.example` — 无密钥配置样例。
- 创建：`backend/compose.yaml` — 本地 PostgreSQL 和应用服务。
- 创建：`backend/Dockerfile` — 前端与 Rust 多阶段生产镜像。
- 创建：`backend/README.md` — migrate、serve、测试和部署说明。

### 前端接入

- 创建：`frontend/src/api/types.ts` — 服务端 DTO、金额字符串、Problem Details 和下钻结构。
- 创建：`frontend/src/api/financeApi.ts` — fetch、修订头、幂等键、错误归一化和请求取消。
- 创建：`frontend/src/api/financeApi.test.ts` — 客户端契约测试。
- 修改：`frontend/src/domain/types.ts` — 用服务端 DTO 替换本地持久化类型。
- 修改：`frontend/src/app/financeReducer.ts` — 异步加载、请求序号、修订号和局部面板状态。
- 重写：`frontend/src/app/FinanceProvider.tsx` — 通过 FinanceApi 编排所有查询和写入。
- 修改：`frontend/src/layout/AppShell.tsx` — 服务端创建交易、已有月份和异步保存。
- 修改：`frontend/src/features/entry/QuickEntryDrawer.tsx` — Promise 保存、幂等重试和字段错误聚焦。
- 修改：`frontend/src/features/transactions/TransactionsPage.tsx` — 服务端筛选、游标、删除令牌和恢复。
- 修改：`frontend/src/features/settings/LabelsPage.tsx` — 异步标签命令和修订冲突。
- 修改：`frontend/src/features/overview/OverviewPage.tsx` — 展示服务端总览模型。
- 修改：`frontend/src/features/analytics/AnalyticsPage.tsx` — 展示服务端分析和证据条件。
- 修改：`frontend/src/features/reports/MonthlyReportPage.tsx` — 展示服务端月报。
- 修改：`frontend/src/domain/selectors.ts` — 只保留无业务推断的展示格式和前端日期输入校验。
- 删除：`frontend/src/data/transactionRepository.ts` — 删除财务 `localStorage` 仓储。
- 删除：`frontend/src/data/labelRepository.ts` — 删除标签 `localStorage` 仓储。
- 修改：对应现有测试文件 — 使用真实 Provider + Mock HTTP 或真实后端，不再注入本地仓储。
- 修改：`frontend/vite.config.ts` — `/api` 和 `/health` 开发代理及原覆盖率门禁。
- 修改：`frontend/package.json` — 增加契约与完整检查脚本。

## 任务 1：建立可测试的 Rust 运行骨架

**文件：**
- 创建：`backend/Cargo.toml`
- 创建：`backend/src/lib.rs`
- 创建：`backend/src/main.rs`
- 创建：`backend/src/config.rs`
- 创建：`backend/src/command.rs`
- 测试：`backend/src/config.rs`

- [ ] **步骤 1：建立最小测试脚手架并编写配置失败测试**

先创建可运行测试的最小 `Cargo.toml`、`lib.rs` 和仅含测试的 `config.rs`，再添加表格测试，明确缺失数据库地址、非法监听地址、零连接池和零超时都失败：

```rust
#[test]
fn rejects_missing_database_url() {
    let input = ConfigInput::valid().without("DATABASE_URL");
    assert_eq!(Config::from_map(input).unwrap_err().code(), "config.database_url_missing");
}

#[test]
fn defaults_to_loopback() {
    let config = Config::from_map(ConfigInput::valid()).unwrap();
    assert_eq!(config.bind_addr.to_string(), "127.0.0.1:3000");
}
```

- [ ] **步骤 2：运行测试确认骨架尚不存在**

运行：`cargo test --manifest-path backend/Cargo.toml config::tests -- --nocapture`

预期：FAIL，原因是 `ConfigInput`、`Config` 和稳定错误码尚未实现；不能以清单文件缺失、测试未被发现或语法错误作为 RED 证据。

- [ ] **步骤 3：补全包、模块和配置类型**

使用一个 binary + library 包；`main.rs` 只调用可测试入口。配置类型至少固定以下字段：

```rust
pub struct Config {
    pub database_url: SecretDatabaseUrl,
    pub bind_addr: SocketAddr,
    pub frontend_dist_dir: PathBuf,
    pub pool_min: u32,
    pub pool_max: u32,
    pub request_timeout: Duration,
    pub body_limit_bytes: usize,
}

pub enum Command { Migrate, Serve }

pub async fn run(command: Command, config: Config) -> Result<(), StartupError>;
```

`SecretDatabaseUrl` 自定义 `Debug` 只输出 `[REDACTED]`。手工解析且只接受 `migrate`、`serve` 两个子命令；未知或缺失子命令打印用法并返回非零退出码。不要让配置错误的 `Debug` 输出包含 `DATABASE_URL` 值。

配置默认值固定为：监听 `127.0.0.1:3000`、连接池最小 1/最大 10、HTTP 请求超时 15 秒、请求体上限 1 MiB。数据库连接与池获取超时均为 5 秒；环境值必须在建立连接前完成范围校验。

`Cargo.toml` 固定 Axum `=0.8.4`、SeaORM/SeaORM Migration `=1.1.14`，并启用 `sqlx-postgres`、Tokio rustls runtime、UUID、chrono 和 rust_decimal 特性；Tokio、Serde、Tower HTTP、Tracing、UUID、thiserror 与 async-trait 使用当前稳定主版本范围，实际补丁由本任务生成的 `Cargo.lock` 锁定。

```toml
[dependencies]
axum = "=0.8.4"
sea-orm = { version = "=1.1.14", features = ["sqlx-postgres", "runtime-tokio-rustls", "with-uuid", "with-chrono", "with-rust_decimal"] }
sea-orm-migration = { version = "=1.1.14", features = ["sqlx-postgres", "runtime-tokio-rustls"] }
tokio = { version = "1", features = ["macros", "rt-multi-thread", "signal", "sync", "time"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
chrono = { version = "0.4", features = ["serde"] }
rust_decimal = { version = "1", features = ["serde"] }
tower = { version = "0.5", features = ["util"] }
tower-http = { version = "0.6", features = ["fs", "limit", "request-id", "timeout", "trace"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "json"] }
uuid = { version = "1", features = ["serde", "v4"] }
thiserror = "2"
async-trait = "0.1"
```

- [ ] **步骤 4：运行配置和命令解析测试**

运行：`cargo test --manifest-path backend/Cargo.toml --lib`

预期：PASS，且测试覆盖 `migrate`、`serve`、未知命令和脱敏错误。

- [ ] **步骤 5：执行基础静态检查并记录文件清单**

运行：`cargo fmt --manifest-path backend/Cargo.toml --check && cargo clippy --manifest-path backend/Cargo.toml --all-targets -- -D warnings`

预期：两条检查均成功；审查清单中只出现本任务声明的五个文件。

## 任务 2：实现纯领域金额、时间、交易与标签规则

**文件：**
- 创建：`backend/src/domain/mod.rs`
- 创建：`backend/src/domain/error.rs`
- 创建：`backend/src/domain/money.rs`
- 创建：`backend/src/domain/calendar.rs`
- 创建：`backend/src/domain/transaction.rs`
- 创建：`backend/src/domain/labels.rs`

- [ ] **步骤 1：先写金额和时间失败测试**

```rust
#[test]
fn money_requires_positive_two_decimal_amount() {
    assert_eq!(Money::parse("0.00").unwrap_err().code(), "amount.not_positive");
    assert_eq!(Money::parse("1.001").unwrap_err().code(), "amount.scale_exceeded");
    assert_eq!(Money::parse("32.6").unwrap().to_api_string(), "32.60");
}

#[test]
fn local_calendar_ignores_host_timezone() {
    let value = OccurredAt::parse("2026-09-01T00:15:00+14:00").unwrap();
    assert_eq!(value.local_date().to_string(), "2026-09-01");
    assert!(!value.local_date().is_weekend());
}
```

- [ ] **步骤 2：运行领域测试确认失败**

运行：`cargo test --manifest-path backend/Cargo.toml domain::`

预期：FAIL，`Money` 和 `OccurredAt` 尚不存在。

- [ ] **步骤 3：实现精确金额和本地日历值对象**

实现以下公开边界，内部只使用 Decimal、Date 和 Time：

```rust
impl Money {
    pub fn parse(raw: &str) -> Result<Self, DomainError>;
    pub fn zero() -> Self;
    pub fn checked_add(self, rhs: Self) -> Result<Self, DomainError>;
    pub fn to_api_string(&self) -> String;
}

impl OccurredAt {
    pub fn parse(rfc3339: &str) -> Result<Self, DomainError>;
    pub fn local_date(&self) -> LocalDate;
    pub fn local_time(&self) -> LocalTime;
    pub fn utc_offset_minutes(&self) -> i16;
}

impl UtcInstant {
    pub fn parse(rfc3339: &str) -> Result<Self, DomainError>;
    pub fn checked_add(self, duration: Duration) -> Result<Self, DomainError>;
}
```

金额最大值与 `NUMERIC(18,2)` 一致；UTC 偏移只接受 `-14:00` 至 `+14:00`。

- [ ] **步骤 4：写交易和标签规则失败测试**

```rust
#[test]
fn transfer_requires_two_distinct_accounts_and_no_category() {
    let error = TransactionDraft::transfer(money("10.00"), account(1), account(1), occurred()).validate().unwrap_err();
    assert_eq!(error.code(), "transaction.accounts_must_differ");
}

#[test]
fn cannot_deactivate_last_expense_category() {
    let error = validate_category_deactivation(category(1), &[active_expense(1)]).unwrap_err();
    assert_eq!(error.code(), "category.last_active_for_kind");
}
```

- [ ] **步骤 5：实现交易和标签纯函数**

公开接口固定为：

```rust
pub fn validate_transaction(input: &NewTransaction, refs: &ActiveReferences) -> Result<(), DomainError>;
pub fn validate_category_deactivation(target: &Category, all: &[Category]) -> Result<(), DomainError>;
pub fn validate_category_migration(source: &Category, target: &Category) -> Result<(), DomainError>;
pub fn validate_account_deactivation(target: &AccountLabel, all: &[AccountLabel]) -> Result<(), DomainError>;
pub fn validate_complete_order(current: &[CategoryId], requested: &[CategoryId]) -> Result<(), DomainError>;
```

名称标准化、1–40 字符限制、名称/备注长度和颜色格式也在领域层测试。

- [ ] **步骤 6：运行全部领域测试与时区矩阵**

运行：`TZ=Pacific/Kiritimati cargo test --manifest-path backend/Cargo.toml domain && TZ=America/Adak cargo test --manifest-path backend/Cargo.toml domain`

预期：两组测试均 PASS，输出结果完全一致。

## 任务 3：实现显式迁移、schema 检查和数据库约束

**文件：**
- 创建：`backend/src/migration/mod.rs`
- 创建：`backend/src/migration/m20260826_000001_create_ledger.rs`
- 创建：`backend/src/infrastructure/mod.rs`
- 创建：`backend/src/infrastructure/db.rs`
- 创建：`backend/src/infrastructure/schema.rs`
- 创建：`backend/src/infrastructure/entities/*.rs`
- 创建：`backend/tests/support/mod.rs`
- 创建：`backend/tests/migration_test.rs`
- 创建：`backend/compose.yaml`
- 修改：`backend/src/command.rs`

- [ ] **步骤 1：创建真实 PostgreSQL 测试设施**

`compose.yaml` 固定测试数据库和健康检查；`tests/support` 为每个测试创建唯一 schema，并通过 SeaORM `schema_search_path` 隔离：

```rust
pub struct TestDatabase { pub db: DatabaseConnection, pub schema: String }

impl TestDatabase {
    pub async fn migrated() -> Self;
    pub async fn empty() -> Self;
}
```

- [ ] **步骤 2：写迁移行为失败测试**

```rust
#[tokio::test]
async fn serve_check_rejects_unmigrated_database() {
    let test_db = TestDatabase::empty().await;
    let error = verify_schema(&test_db.db).await.unwrap_err();
    assert_eq!(error.code(), "schema.not_initialized");
}

#[tokio::test]
async fn explicit_migrate_is_idempotent() {
    let test_db = TestDatabase::empty().await;
    run_migrations(&test_db.db).await.unwrap();
    run_migrations(&test_db.db).await.unwrap();
    verify_schema(&test_db.db).await.unwrap();
}
```

- [ ] **步骤 3：运行迁移测试确认失败**

运行：`docker compose -f backend/compose.yaml up -d postgres && TEST_DATABASE_URL=postgres://pocketlog:pocketlog@127.0.0.1:5432/pocketlog_test cargo test --manifest-path backend/Cargo.toml --test migration_test`

预期：FAIL，迁移器和表尚不存在。

- [ ] **步骤 4：实现 migration 与实体**

迁移必须创建 `categories`、`account_labels`、`transactions`、`app_state`、`idempotency_requests` 五张表，以及设计规格中的复合外键、可延迟排序唯一约束、Check 约束和索引。Migrator 列表必须只有显式注册的版本：

```rust
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![Box::new(m20260826_000001_create_ledger::Migration)]
    }
}
```

实体字段使用 Decimal、Date、Time、DateTimeWithTimeZone 和 UUID 对应 PostgreSQL 类型。
迁移同时插入唯一的 `app_state` 行，初值为 `seed_version = 0`、`data_revision = 0`。`run_migrations` 在同一数据库会话中获取固定 PostgreSQL advisory lock，执行 Migrator 后释放；`command::run(Command::Migrate, ...)` 是调用它的唯一生产入口。

- [ ] **步骤 5：实现只读 schema 版本检查**

`verify_schema` 只查询 SeaORM migration 记录并比较期望集合：

```rust
pub async fn verify_schema(db: &DatabaseConnection) -> Result<(), SchemaError>;
pub async fn run_migrations(db: &DatabaseConnection) -> Result<(), SchemaError>;
```

让 `verify_schema` 在显式 `READ ONLY` 事务中运行。测试记录调用前后的迁移行集合和 schema 对象 OID 集合，调用后断言两组集合逐项相等；这样任何 DDL 都会被只读事务拒绝，且 schema 不会发生静默变化。

- [ ] **步骤 6：运行约束和迁移测试**

运行：`TEST_DATABASE_URL=postgres://pocketlog:pocketlog@127.0.0.1:5432/pocketlog_test cargo test --manifest-path backend/Cargo.toml --test migration_test -- --nocapture`

预期：PASS；额外断言非法转账、分类类型错配、零金额、非法偏移和重复规范化名称均被 PostgreSQL 拒绝。

## 任务 4：实现仓储、演示种子和 bootstrap

**文件：**
- 创建：`backend/src/application/ports.rs`
- 创建：`backend/src/application/dto.rs`
- 创建：`backend/src/application/mod.rs`
- 创建：`backend/src/application/clock.rs`
- 创建：`backend/src/application/bootstrap.rs`
- 创建：`backend/src/infrastructure/repositories.rs`
- 创建：`backend/src/infrastructure/seed.rs`
- 测试：`backend/tests/persistence_test.rs`

- [ ] **步骤 1：定义仓储端口和事务边界**

```rust
pub struct AppStateSnapshot {
    pub seed_version: i32,
    pub data_revision: DataRevision,
}

pub trait Clock: Send + Sync {
    fn now(&self) -> UtcInstant;
}

#[async_trait]
pub trait LedgerRepository: Send + Sync {
    type Transaction: LedgerTransaction;
    async fn bootstrap(&self) -> Result<BootstrapSnapshot, AppError>;
    async fn begin_write(&self) -> Result<Self::Transaction, AppError>;
    async fn begin_repeatable_read(&self) -> Result<Self::Transaction, AppError>;
}

#[async_trait]
pub trait LedgerTransaction: Send {
    async fn lock_app_state(&mut self) -> Result<AppStateSnapshot, AppError>;
    async fn commit(self) -> Result<(), AppError>;
    async fn rollback(self) -> Result<(), AppError>;
}
```

应用层只能依赖端口；SeaORM 类型不得出现在 `application` 或 `domain` 的公开签名中。

- [ ] **步骤 2：写种子与 bootstrap 失败测试**

```rust
#[tokio::test]
async fn seed_runs_once_and_bootstrap_lists_real_months() {
    let db = TestDatabase::migrated().await;
    seed_if_needed(&db.db, &FixedClock::at("2026-08-26T10:00:00+08:00")).await.unwrap();
    seed_if_needed(&db.db, &FixedClock::at("2026-08-26T10:00:00+08:00")).await.unwrap();
    let snapshot = SeaOrmLedgerRepository::new(db.db.clone()).bootstrap().await.unwrap();
    assert!(snapshot.categories.len() >= 2);
    assert!(snapshot.accounts.len() >= 2);
    assert!(snapshot.months.contains(&"2026-08".to_owned()));
    assert_eq!(count_visible_transactions(&db.db).await, 17);
}
```

- [ ] **步骤 3：运行持久化测试确认失败**

运行：`TEST_DATABASE_URL=postgres://pocketlog:pocketlog@127.0.0.1:5432/pocketlog_test cargo test --manifest-path backend/Cargo.toml --test persistence_test seed_runs_once`

预期：FAIL，仓储和种子尚未实现。

- [ ] **步骤 4：实现幂等种子事务**

锁定 `app_state` 单例；仅当 `seed_version = 0` 时写入现有 17 条演示交易、6 个分类和 4 个账户。交通分类设置 `semantic_key = 'transport'`。全部写入成功后设置 `seed_version = 1` 和 `data_revision = 1`；任一插入失败时保持两个值为零。

- [ ] **步骤 5：实现 SeaORM 仓储和 bootstrap 用例**

`bootstrap` 返回：

```rust
pub struct BootstrapSnapshot {
    pub categories: Vec<CategoryDto>,
    pub accounts: Vec<AccountDto>,
    pub months: Vec<String>,
    pub data_revision: DataRevision,
    pub server_time: String,
}
```

月份按倒序去重，来源为未删除交易的 `local_date`。

- [ ] **步骤 6：验证种子回滚和空账本语义**

运行：`TEST_DATABASE_URL=postgres://pocketlog:pocketlog@127.0.0.1:5432/pocketlog_test cargo test --manifest-path backend/Cargo.toml --test persistence_test`

预期：PASS；测试必须证明用户删除所有交易后重启不会再次写入演示数据。

## 任务 5：实现交易创建、修订控制和幂等

**文件：**
- 修改：`backend/src/application/clock.rs`
- 创建：`backend/src/application/transactions.rs`
- 修改：`backend/src/application/ports.rs`
- 修改：`backend/src/infrastructure/repositories.rs`
- 测试：`backend/tests/transactions_test.rs`

- [ ] **步骤 1：写应用服务并发与幂等失败测试**

```rust
#[tokio::test]
async fn repeated_create_replays_the_same_transaction() {
    let app = transaction_service().await;
    let first = app.create(new_expense(), revision(1), key("entry-1")).await.unwrap();
    let second = app.create(new_expense(), revision(1), key("entry-1")).await.unwrap();
    assert_eq!(first.transaction.id, second.transaction.id);
    assert_eq!(first.data_revision, second.data_revision);
}

#[tokio::test]
async fn stale_revision_does_not_write() {
    let error = transaction_service().await.create(new_expense(), revision(0), key("entry-2")).await.unwrap_err();
    assert_eq!(error.code(), "revision_conflict");
}
```

- [ ] **步骤 2：运行目标测试确认失败**

运行：`TEST_DATABASE_URL=postgres://pocketlog:pocketlog@127.0.0.1:5432/pocketlog_test cargo test --manifest-path backend/Cargo.toml --test transactions_test`

预期：FAIL，创建用例尚不存在。

- [ ] **步骤 3：实现创建事务顺序**

应用服务固定执行顺序：幂等结果查询 → `app_state FOR UPDATE` → 修订比较 → 活跃引用锁定 → 领域校验 → 交易插入 → 幂等响应保存 → 修订加一 → 提交。

```rust
pub async fn create(
    &self,
    input: CreateTransaction,
    expected: DataRevision,
    key: IdempotencyKey,
) -> Result<CreateTransactionResult, AppError>;
```

请求指纹覆盖规范化后的全部字段；同键不同指纹返回 `idempotency_key_reused`。

- [ ] **步骤 4：增加数据库并发测试**

使用 barrier 同时发起两个相同幂等键请求，断言一成功一重放、交易行只增加一行、修订号只增加一。

- [ ] **步骤 5：运行交易创建测试**

运行：`TEST_DATABASE_URL=postgres://pocketlog:pocketlog@127.0.0.1:5432/pocketlog_test cargo test --manifest-path backend/Cargo.toml --test transactions_test repeated_create -- --nocapture`

预期：PASS，且覆盖支出、收入、转账、停用标签、类型错配、金额超精度和幂等键冲突。

## 任务 6：实现交易筛选、游标、删除和恢复

**文件：**
- 修改：`backend/src/application/transactions.rs`
- 修改：`backend/src/application/dto.rs`
- 修改：`backend/src/infrastructure/repositories.rs`
- 创建：`backend/src/infrastructure/cleanup.rs`
- 测试：`backend/tests/transactions_test.rs`

- [ ] **步骤 1：写筛选和稳定游标失败测试**

```rust
#[tokio::test]
async fn category_and_account_filter_keeps_inactive_history() {
    let page = service().list(TransactionQuery::month("2026-08").category(food()).account(wechat())).await.unwrap();
    assert!(page.items.iter().all(|row| row.category_id == Some(food())));
    assert!(page.items.iter().all(|row| row.account_id == wechat()));
}

#[tokio::test]
async fn cursor_never_duplicates_equal_timestamps() {
    let first = service().list(TransactionQuery::month("2026-08").limit(2)).await.unwrap();
    let second = service().list(TransactionQuery::month("2026-08").after(first.next_cursor.unwrap())).await.unwrap();
    assert!(first.items.iter().all(|a| second.items.iter().all(|b| a.id != b.id)));
}
```

- [ ] **步骤 2：实现查询对象与游标**

```rust
pub struct TransactionQuery {
    pub month: Option<YearMonth>,
    pub date_range: Option<DateRange>,
    pub kinds: Vec<TransactionKind>,
    pub category_id: Option<CategoryId>,
    pub account_id: Option<AccountId>,
    pub weekend_only: bool,
    pub cursor: Option<TransactionCursor>,
    pub limit: u16,
}
```

限制 `1..=100`，游标编码本地日期、本地时间、绝对时间和 ID；月份与日期范围互斥，周末条件只允许支出查询。
账户筛选对普通收支匹配 `account_id`；对转账匹配 `account_id` 或 `target_account_id`，确保转入历史也能被该账户筛选找到。

- [ ] **步骤 3：写删除恢复失败测试**

```rust
#[tokio::test]
async fn restore_uses_fixed_server_deadline() {
    let clock = ManualClock::at("2026-08-26T00:00:00Z");
    let deleted = service_with(clock.clone()).delete(tx(), revision(1)).await.unwrap();
    clock.advance(Duration::from_secs(5));
    assert_eq!(service_with(clock).restore(tx(), deleted.token, revision(2)).await.unwrap_err().code(), "restore_expired");
}
```

- [ ] **步骤 4：实现删除、恢复和清理**

删除写入令牌与固定五秒截止时间；恢复使用数据库当前时间或注入时钟并要求 `now < undo_until`，边界时刻视为过期。清理只物理删除过期行且不增加修订号。幂等记录只删除创建时间早于 24 小时的已完成记录。

- [ ] **步骤 5：运行查询与删除矩阵**

运行：`TEST_DATABASE_URL=postgres://pocketlog:pocketlog@127.0.0.1:5432/pocketlog_test cargo test --manifest-path backend/Cargo.toml --test transactions_test`

预期：PASS；包含连续删除、错误令牌、过期重试和清理未运行时仍不可见。

## 任务 7：实现分类和账户命令

**文件：**
- 创建：`backend/src/application/labels.rs`
- 修改：`backend/src/application/ports.rs`
- 修改：`backend/src/infrastructure/repositories.rs`
- 测试：`backend/tests/labels_test.rs`

- [ ] **步骤 1：写标签不变量和迁移回滚失败测试**

```rust
#[tokio::test]
async fn migration_moves_transactions_and_deletes_source_atomically() {
    let result = labels().migrate(food(), dining(), revision(1)).await.unwrap();
    assert_eq!(result.data_revision, revision(2));
    assert_eq!(count_transactions_for(food()).await, 0);
    assert!(find_category(food()).await.is_none());
}

#[tokio::test]
async fn cannot_disable_last_active_account() {
    let error = labels().deactivate_account(last_account(), revision(1)).await.unwrap_err();
    assert_eq!(error.code(), "account.last_active");
}
```

- [ ] **步骤 2：运行标签测试确认失败**

运行：`TEST_DATABASE_URL=postgres://pocketlog:pocketlog@127.0.0.1:5432/pocketlog_test cargo test --manifest-path backend/Cargo.toml --test labels_test`

预期：FAIL，标签应用服务尚不存在。

- [ ] **步骤 3：实现分类命令**

```rust
pub async fn create_category(&self, input: CreateCategory, expected: DataRevision) -> Result<Mutation<CategoryDto>, AppError>;
pub async fn rename_category(&self, id: CategoryId, name: LabelName, expected: DataRevision) -> Result<Mutation<CategoryDto>, AppError>;
pub async fn deactivate_category(&self, id: CategoryId, expected: DataRevision) -> Result<Mutation<CategoryDto>, AppError>;
pub async fn reorder_categories(&self, ids: Vec<CategoryId>, expected: DataRevision) -> Result<Mutation<Vec<CategoryDto>>, AppError>;
pub async fn delete_category(&self, id: CategoryId, expected: DataRevision) -> Result<Mutation<()>, AppError>;
pub async fn migrate_category(&self, from: CategoryId, to: CategoryId, expected: DataRevision) -> Result<Mutation<()>, AppError>;
```

每个命令锁定 `app_state` 和所需标签；迁移在同一事务中先执行 `UPDATE transactions SET category_id = $target WHERE category_id = $source`，再执行源分类 `DELETE`，最后增加一次修订号。

- [ ] **步骤 4：实现账户命令**

只提供创建、重命名和停用；不提供余额、删除或恢复启用接口。命令成功后返回最新账户和修订号。

- [ ] **步骤 5：注入中途失败并验证回滚**

测试仓储在更新交易后、删除分类前返回错误，随后使用新的数据库查询断言源分类和所有交易引用均未改变。

- [ ] **步骤 6：运行标签完整测试**

运行：`TEST_DATABASE_URL=postgres://pocketlog:pocketlog@127.0.0.1:5432/pocketlog_test cargo test --manifest-path backend/Cargo.toml --test labels_test`

预期：PASS，覆盖全局重名、排序重复、漏 ID、跨类型迁移、非启用目标和被引用分类删除。

## 任务 8：实现总览、分析、洞察和月报

**文件：**
- 创建：`backend/src/domain/analytics.rs`
- 创建：`backend/src/domain/report.rs`
- 创建：`backend/src/application/insights.rs`
- 修改：`backend/src/infrastructure/repositories.rs`
- 测试：`backend/tests/insights_test.rs`

- [ ] **步骤 1：移植为明确的领域表格测试**

```rust
#[test]
fn savings_rate_is_unavailable_without_income() {
    let summary = summarize(&[expense("10.00")], august());
    assert_eq!(summary.savings_rate, None);
}

#[test]
fn top_four_plus_other_preserves_evidence_ids() {
    let result = category_composition(five_categories());
    assert_eq!(result.groups.len(), 5);
    assert_eq!(result.groups.last().unwrap().included_category_ids.len(), 1);
}

#[test]
fn weekend_transport_requires_real_weekend_evidence() {
    let insights = build_insights(weekend_transport_data(), august(), july());
    let item = insights.iter().find(|item| item.code == "transport_weekend").unwrap();
    assert!(item.drilldown.current_filter.weekend_only);
}
```

- [ ] **步骤 2：运行分析领域测试确认失败**

运行：`cargo test --manifest-path backend/Cargo.toml domain::`

预期：FAIL，分析与报告模块尚不存在。

- [ ] **步骤 3：实现聚合输入与纯计算**

SQL 仓储只返回精确聚合行和证据所需 ID，领域层负责：自然月天数、零值日期补齐、前四加其他、变化率舍入、历史不足和稳定排序。

```rust
pub fn build_overview(input: OverviewFacts) -> OverviewDto;
pub fn build_analytics(input: AnalyticsFacts) -> AnalyticsDto;
pub fn build_insights(input: InsightFacts) -> Vec<InsightDto>;
pub fn build_monthly_report(input: ReportFacts) -> MonthlyReportDto;
```

- [ ] **步骤 4：实现评分和比较周期测试**

覆盖 `clamp(round(rate + 37), 0, 100)`、75/55 分段、无收入无评分、上期为零无百分比；验证月、近三月和自定义范围的前序区间首尾日期。

- [ ] **步骤 5：实现 repeatable-read 查询用例**

总览、分析和报告每次在一个 `REPEATABLE READ READ ONLY` 事务中读取事实和 `data_revision`。测试在两条聚合查询之间并发插入交易，断言同一响应不混入新修订数据。

- [ ] **步骤 6：运行领域与 PostgreSQL 分析测试**

运行：`TZ=Pacific/Kiritimati cargo test --manifest-path backend/Cargo.toml domain:: && TZ=Pacific/Kiritimati TEST_DATABASE_URL=postgres://pocketlog:pocketlog@127.0.0.1:5432/pocketlog_test cargo test --manifest-path backend/Cargo.toml --test insights_test`

预期：PASS；换成 `TZ=America/Adak` 再运行一次，JSON 快照相同。

## 任务 9：组装 Axum API、错误、中间件和静态资源

**文件：**
- 创建：`backend/src/api/mod.rs`
- 创建：`backend/src/api/router.rs`
- 创建：`backend/src/api/error.rs`
- 创建：`backend/src/api/middleware.rs`
- 创建：`backend/src/api/dto.rs`
- 创建：`backend/src/api/handlers/*.rs`
- 创建：`backend/src/infrastructure/static_files.rs`
- 修改：`backend/src/command.rs`
- 测试：`backend/tests/api_test.rs`
- 测试：`backend/tests/runtime_test.rs`
- 测试：`backend/tests/transactions_test.rs`
- 测试：`backend/tests/labels_test.rs`
- 测试：`backend/tests/insights_test.rs`

- [ ] **步骤 1：写 Router 契约失败测试**

```rust
#[tokio::test]
async fn validation_error_is_problem_json() {
    let response = test_app().post_json("/api/v1/transactions", invalid_amount()).await;
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(response.header(CONTENT_TYPE), "application/problem+json");
    assert_eq!(response.json()["code"], "amount.not_positive");
    assert!(response.json()["requestId"].is_string());
}

#[tokio::test]
async fn api_404_never_returns_index_html() {
    let response = test_app().get("/api/v1/not-found").await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_ne!(response.header(CONTENT_TYPE), "text/html");
}
```

- [ ] **步骤 2：运行 Runtime 测试确认失败**

运行：`TEST_DATABASE_URL=postgres://pocketlog:pocketlog@127.0.0.1:5432/pocketlog_test cargo test --manifest-path backend/Cargo.toml --test runtime_test`

预期：FAIL，Router 尚不存在。

- [ ] **步骤 3：实现 DTO、错误和路由**

Router 包含规格中的全部路径；所有 mutation 提取 `If-Match`，创建交易额外提取 `Idempotency-Key`。错误结构固定为：

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProblemDetails {
    pub code: String,
    pub title: String,
    pub detail: String,
    pub field_errors: Vec<FieldError>,
    pub request_id: String,
    pub retryable: bool,
}
```

成功 mutation 统一返回 `{ "data": <resource-or-result>, "dataRevision": <integer> }`；删除的 `data` 包含 `deletionToken` 和 `undoUntil`，恢复的 `data` 包含恢复后的交易。交易列表返回 `{ "items": [...], "nextCursor": string | null, "dataRevision": integer }`。

JSON rejection、query rejection 和 body-limit rejection 也必须转换为该结构。

- [ ] **步骤 4：实现运行中间件和健康检查**

组合 request ID、结构化追踪、超时、body limit 和安全响应头。`live` 不访问数据库；`ready` 执行轻量查询和 `verify_schema`。启动一个通过 Tokio watch channel 接收优雅停机信号的周期清理任务：启动后立即清理一次，此后每 60 秒运行；清理失败只记录脱敏错误并在下个周期重试，不改变五秒业务截止时间。日志字段不得包含 merchant、note、令牌、幂等键或连接串。

- [ ] **步骤 5：实现 SPA 静态文件规则**

哈希资源返回长期 immutable cache，`index.html` 返回 no-cache；只有接受 HTML 且不在 `/api`、`/health` 下的未知 GET 路由回退到 index。静态目录缺失时 `serve` 在绑定端口前失败。

- [ ] **步骤 6：连接 command 的 migrate/serve**

```rust
pub async fn serve(config: Config) -> Result<(), StartupError> {
    let db = connect(&config).await?;
    verify_schema(&db).await?;
    ensure_static_assets(&config.frontend_dist_dir)?;
    seed_if_needed(&db, &SystemClock).await?;
    run_http(build_router(db, config.clone()), config.bind_addr).await
}
```

`serve` 不得调用 `run_migrations`；用函数调用记录测试再次证明这一点。

- [ ] **步骤 7：运行全部后端 API 测试**

运行：`TEST_DATABASE_URL=postgres://pocketlog:pocketlog@127.0.0.1:5432/pocketlog_test cargo test --manifest-path backend/Cargo.toml --tests`

预期：PASS，包含 bootstrap、交易、标签、分析、错误、健康和静态资源。

## 任务 10：建立前端 API 契约与客户端

**文件：**
- 创建：`frontend/src/api/types.ts`
- 创建：`frontend/src/api/financeApi.ts`
- 创建：`frontend/src/api/financeApi.test.ts`
- 修改：`frontend/src/domain/types.ts`
- 修改：`frontend/vite.config.ts`

- [ ] **步骤 1：写 fetch 契约失败测试**

```ts
it('mutation sends revision and keeps idempotency key across retry', async () => {
  const fetchMock = vi.fn()
    .mockRejectedValueOnce(new TypeError('network'))
    .mockResolvedValueOnce(jsonResponse({ data: expense, dataRevision: 2 }))
  const api = createFinanceApi({ fetch: fetchMock, baseUrl: '/api/v1' })
  await expect(api.createTransaction(input, { revision: 1, idempotencyKey: 'entry-1' })).rejects.toMatchObject({ retryable: true })
  await api.createTransaction(input, { revision: 1, idempotencyKey: 'entry-1' })
  expect(fetchMock.mock.calls[1][1].headers).toMatchObject({ 'If-Match': '1', 'Idempotency-Key': 'entry-1' })
})
```

- [ ] **步骤 2：运行客户端测试确认失败**

运行：`npm --prefix frontend run test:run -- src/api/financeApi.test.ts`

预期：FAIL，API 客户端尚不存在。

- [ ] **步骤 3：定义与服务端一致的 TypeScript DTO**

```ts
export type Money = string
export interface ApiProblem { code: string; title: string; detail: string; fieldErrors: FieldError[]; requestId: string; retryable: boolean }
export interface Mutation<T> { data: T; dataRevision: number }
export interface Drilldown { sourceLabel: string; currentFilter: TransactionFilter; previousFilter?: TransactionFilter; includedCategoryIds?: string[] }
```

金额不得在 API 层转换为 `number`。展示格式使用字符串安全处理千位和两位小数。

- [ ] **步骤 4：实现 FinanceApi 和错误归一化**

所有方法接受可选 `AbortSignal`；204、JSON、Problem Details、非 JSON 5xx 和网络错误分别处理。客户端不得自动重放 POST，只把 `retryable` 交给已有 UI 重试动作。

- [ ] **步骤 5：配置 Vite 开发代理**

仅在开发模式把 `/api` 和 `/health` 代理到 `VITE_BACKEND_ORIGIN`，默认 `http://127.0.0.1:3000`；生产构建保持同源相对路径。

- [ ] **步骤 6：运行客户端测试与 TypeScript 检查**

运行：`npm --prefix frontend run test:run -- src/api/financeApi.test.ts && npm --prefix frontend exec -- tsc -b --noEmit`

预期：PASS，无隐式 `any`，API 金额字段均为字符串。

## 任务 11：把 FinanceProvider 改为服务端异步状态机

**文件：**
- 修改：`frontend/src/app/financeReducer.ts`
- 重写：`frontend/src/app/FinanceProvider.tsx`
- 修改：`frontend/src/app/FinanceProvider.test.tsx`
- 修改：`frontend/src/app/financeReducer.test.ts`
- 修改：`frontend/src/test/render.tsx`

- [ ] **步骤 1：写 bootstrap、陈旧响应和修订冲突失败测试**

```tsx
it('discards an older month response that resolves last', async () => {
  const api = deferredFinanceApi()
  render(<FinanceProvider api={api}><StateProbe /></FinanceProvider>)
  await changeMonth('2026-07')
  await changeMonth('2026-08')
  api.resolveOverview('2026-08', overviewAugust)
  api.resolveOverview('2026-07', overviewJuly)
  expect(screen.getByTestId('month')).toHaveTextContent('2026-08')
  expect(screen.getByTestId('overview')).toHaveTextContent('August')
})
```

- [ ] **步骤 2：运行 Provider 测试确认失败**

运行：`npm --prefix frontend run test:run -- src/app/FinanceProvider.test.tsx src/app/financeReducer.test.ts`

预期：FAIL，Provider 仍依赖同步本地仓储。

- [ ] **步骤 3：重构 reducer 状态**

状态至少包含：

```ts
interface FinanceState {
  bootstrap: AsyncState<BootstrapResponse>
  overview: AsyncState<OverviewResponse>
  analytics: AsyncState<AnalyticsResponse>
  report: AsyncState<MonthlyReportResponse>
  transactions: AsyncState<TransactionPage>
  dataRevision: number
  requestSequence: Record<string, number>
  pendingDeletions: PendingDeletion[]
}
```

reducer 只有当 response sequence 等于当前 panel sequence 且 response revision 不低于当前修订时才提交。

- [ ] **步骤 4：重写 Provider 查询与 mutation 编排**

Provider 构造 `AbortController`、调用 FinanceApi、映射异步状态并在卸载时取消。mutation 成功后更新修订和受影响资源；`revision_conflict` 重新 bootstrap 并保留用户草稿。测试仍允许注入 FinanceApi，但不允许注入 localStorage repository。

- [ ] **步骤 5：实现局部失败和数据过期状态**

bootstrap 失败只提供初始化重试；overview/analytics/report 失败保留最后成功值并标记 stale。重试只请求失败面板。

- [ ] **步骤 6：运行 Provider 与 reducer 测试**

运行：`npm --prefix frontend run test:run -- src/app/FinanceProvider.test.tsx src/app/financeReducer.test.ts src/test/render.test.tsx`

预期：PASS，覆盖取消、乱序、旧修订、409 刷新和卸载后不更新。

## 任务 12：接入全部页面并删除本地财务仓储

**文件：**
- 修改：`frontend/src/layout/AppShell.tsx`
- 修改：`frontend/src/features/entry/QuickEntryDrawer.tsx`
- 修改：`frontend/src/features/transactions/TransactionsPage.tsx`
- 修改：`frontend/src/features/settings/LabelsPage.tsx`
- 修改：`frontend/src/features/overview/OverviewPage.tsx`
- 修改：`frontend/src/features/analytics/AnalyticsPage.tsx`
- 修改：`frontend/src/features/reports/MonthlyReportPage.tsx`
- 修改：`frontend/src/domain/selectors.ts`
- 删除：`frontend/src/data/transactionRepository.ts`
- 删除：`frontend/src/data/labelRepository.ts`
- 修改：上述模块对应测试文件和 `frontend/src/app/App.test.tsx`

- [ ] **步骤 1：先改页面测试以断言服务端模型**

总览测试直接提供 `OverviewResponse`，并验证最近五笔只是响应子集；分析和月报测试提供带 `drilldown` 的服务端响应；交易测试断言筛选触发 API query，而不是对全量数组本地过滤。

```tsx
it('uses server drilldown without rebuilding evidence filters', async () => {
  renderAnalytics({ api, response: analyticsWithComparison })
  await user.click(screen.getByRole('button', { name: '查看证据' }))
  expect(api.listTransactions).toHaveBeenCalledWith(analyticsWithComparison.insights[0].drilldown.currentFilter, expect.anything())
})
```

- [ ] **步骤 2：运行页面测试确认失败**

运行：`npm --prefix frontend run test:run -- src/features src/app/App.test.tsx`

预期：FAIL，页面仍在调用本地 selectors 和同步 actions。

- [ ] **步骤 3：接入总览、分析和月报响应**

移除页面对 `selectMonthlySummary`、`selectCategoryBreakdown`、`selectInsights` 和 `buildMonthlyReport` 的调用。页面只格式化服务端金额字符串、比例和文字摘要；下钻原样提交服务端 filter。分析页返回后恢复原时间范围、账户筛选和保存的滚动位置，`scrollRestorePending` 消费一次后立即清除，测试断言后续渲染不再次滚动。

- [ ] **步骤 4：接入交易服务端筛选与删除令牌**

筛选变化调用 `listTransactions`；分页使用服务端 cursor。删除成功后创建以 `undoUntil` 为准的计时器；恢复携带原 token。切换页面不重建截止时间，连续删除分别维护状态。

- [ ] **步骤 5：接入异步记账和标签操作**

`QuickEntryDrawer.onSave` 改为返回 Promise。抽屉打开时生成幂等键，失败重试复用，成功继续记账生成新键。标签对话框等待服务端成功后关闭；字段错误聚焦首个字段，409 保留输入。

- [ ] **步骤 6：删除财务 localStorage 代码**

删除两个 repository 及其测试，移除 Provider、App、测试设施中的 repository 注入。`selectors.ts` 只保留日期输入校验和不会产生业务结论的展示格式；使用 `rg` 确认：

运行：`rg -n "qizhang\.(transactions|labels)|createTransactionRepository|createLabelRepository|localStorage" frontend/src`

预期：财务生产代码零匹配；测试隔离设施允许使用 `localStorage.clear()` 时必须注明仅清理 UI 测试环境。

- [ ] **步骤 7：运行前端完整检查**

运行：`npm --prefix frontend run check && npm --prefix frontend run coverage && npm --prefix frontend run build`

预期：全部 PASS；`src/domain` 与 `src/app` 每文件行覆盖率不低于 90%。

## 任务 13：完成交付配置、端到端门禁和文档

**文件：**
- 创建：`backend/.env.example`
- 完成：`backend/compose.yaml`
- 创建：`backend/Dockerfile`
- 创建：`backend/README.md`
- 修改：`frontend/package.json`
- 测试：`backend/tests/runtime_test.rs`

- [ ] **步骤 1：写生产运行失败测试**

覆盖静态目录缺失、schema 待迁移、数据库不可用、种子失败和优雅停机。测试使用临时静态目录，不依赖仓库已有 `frontend/dist`。

```rust
#[tokio::test]
async fn serve_refuses_pending_migration_without_applying_it() {
    let db = database_one_migration_behind().await;
    let before = applied_migration_names(&db).await;
    let error = prepare_server(config_for(db.clone())).await.unwrap_err();
    assert_eq!(error.code(), "schema.pending_migrations");
    assert_eq!(applied_migration_names(&db).await, before);
}
```

- [ ] **步骤 2：完成容器和配置文件**

Dockerfile 分为前端依赖、前端构建、Rust 构建和最小运行镜像四阶段；运行镜像包含后端二进制及 `frontend/dist`，使用非 root 用户。入口只运行 `serve`，绝不运行 `migrate`。Compose 将迁移定义为需显式调用的一次性 service。

- [ ] **步骤 3：编写运行文档**

README 给出固定顺序：启动 PostgreSQL → `pocket-log-backend migrate` → `pocket-log-backend serve` → 检查 ready。明确无鉴权服务默认回环监听，开放监听地址前必须自行增加访问边界。

- [ ] **步骤 4：运行后端完整门禁**

运行：

```bash
cargo fmt --manifest-path backend/Cargo.toml --check
cargo clippy --manifest-path backend/Cargo.toml --all-targets --all-features -- -D warnings
TEST_DATABASE_URL=postgres://pocketlog:pocketlog@127.0.0.1:5432/pocketlog_test cargo test --manifest-path backend/Cargo.toml --all-features
cargo llvm-cov --manifest-path backend/Cargo.toml --lib --all-features --fail-under-lines 90
cargo build --manifest-path backend/Cargo.toml --release
```

预期：全部退出 `0`；覆盖率门禁使低于 90% 的构建失败。

- [ ] **步骤 5：运行前端完整门禁**

运行：`npm --prefix frontend run check && npm --prefix frontend run coverage && npm --prefix frontend run build`

预期：TypeScript、全部测试、前端覆盖率和生产构建通过。

- [ ] **步骤 6：运行真实 API 跨页面自动化测试**

使用真实 FinanceProvider、真实 Axum Router 和测试 PostgreSQL 覆盖：新增交易刷新总览、洞察下钻、月份共享、分类迁移、删除恢复和月报证据。测试不得只断言文案，必须查询 PostgreSQL 验证持久状态。

- [ ] **步骤 7：按工程规定完成浏览器验收**

只使用 Chrome DevTools MCP，在 `1440×900` 和 `1024×768` 下检查：关键内容裁切、横向溢出、键盘记账、筛选、焦点陷阱、关闭后焦点归还、删除恢复、控制台错误和打印预览。不得使用 Chrome CLI、CDP、curl、Playwright 或其他浏览器工具替代。

- [ ] **步骤 8：形成最终非 Git 交付证据**

记录各门禁命令、退出码、测试数量、覆盖率摘要、两个视口检查结果、控制台结果和打印结果。使用 `rg --files backend frontend/src/api` 列出新增文件；确认没有执行 Git 命令，也没有设计范围外功能。

## 实施顺序与检查点

- 完成任务 1–3 后检查：Rust 骨架可编译，只有显式 migrate 能修改 schema。
- 完成任务 4–7 后检查：全部写入用例在真实 PostgreSQL 上保持修订、幂等和事务一致性。
- 完成任务 8–9 后检查：后端 API 功能完整，尚未改动前端数据来源也可独立通过 API 测试。
- 完成任务 10–12 后检查：前端完全停止使用财务 localStorage 和本地业务推断。
- 完成任务 13 后检查：覆盖率、构建、真实数据库、双视口、键盘、控制台和打印验收全部留有证据。
