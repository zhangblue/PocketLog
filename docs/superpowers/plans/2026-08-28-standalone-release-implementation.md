# 栖账独立发行包实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:subagent-driven-development` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法跟踪进度。

**目标：** 生成可直接运行的 Rust 发行包：同级 `config.toml` 提供配置、同级 `dist/` 提供前端、同级 `logs/` 保存按日滚动的后端日志。

**架构：** 启动时从 `std::env::current_exe()` 推导发行根目录，优先读取根目录 `config.toml` 并构造现有 `Config`；开发时若配置文件不存在则保持环境变量入口。独立日志模块在服务启动前创建目录、清理过期文件并初始化文件/控制台 tracing 层，worker guard 持有到进程结束。`package` 子命令在开发机创建完整发行目录，不修改数据库。

**技术栈：** Rust、Axum、SeaORM、PostgreSQL、Serde、`toml`、`tracing-subscriber`、`tracing-appender`、Cargo、Vite。

**全局约束：** 后端代码只放在 `backend/`；`serve` 绝不执行 schema migration；发行模式的无效 `config.toml` 必须失败，不能回退环境变量；日志与错误不得泄露数据库密码；不运行 Git、不创建提交或分支；所有新增行为遵循 TDD。

---

### 任务 1：发行目录、TOML 配置与配置错误契约

**文件：**
- 修改：`backend/Cargo.toml`
- 修改：`backend/src/config.rs`
- 创建：`backend/src/release.rs`
- 修改：`backend/src/lib.rs`
- 创建：`backend/config.toml.example`
- 测试：`backend/src/config.rs`
- 测试：`backend/src/release.rs`

- [x] **步骤 1：编写发行目录与 TOML 读取失败测试**

在 `release.rs` 的测试模块中使用临时目录与伪造 executable 路径，覆盖：

```rust
#[test]
fn layout_uses_executable_parent_instead_of_current_directory() {
    let layout = ReleaseLayout::from_executable(Path::new("/tmp/qizhang/pocket-log-backend"));
    assert_eq!(layout.root, PathBuf::from("/tmp/qizhang"));
    assert_eq!(layout.config_path, PathBuf::from("/tmp/qizhang/config.toml"));
    assert_eq!(layout.frontend_dist_dir, PathBuf::from("/tmp/qizhang/dist"));
    assert_eq!(layout.logs_dir, PathBuf::from("/tmp/qizhang/logs"));
}

#[test]
fn malformed_toml_is_a_redacted_configuration_error() {
    let error = load_toml_config("database_url = [").unwrap_err();
    assert_eq!(error.code(), "config.file_invalid");
    assert!(!format!("{error:?}").contains("password"));
}
```

- [x] **步骤 2：运行测试确认失败**

运行：`cargo test --manifest-path backend/Cargo.toml --lib release::tests config::tests`

预期：FAIL，缺少 `ReleaseLayout`、TOML 加载器或新错误码。

- [x] **步骤 3：实现路径和 TOML 配置加载**

新增 `ReleaseLayout { root, config_path, frontend_dist_dir, logs_dir }`；使用 `toml::from_str` 反序列化以下私有结构，再转为既有 `Config`：

```rust
#[derive(Deserialize)]
struct FileConfig {
    database_url: String,
    bind_addr: Option<String>,
    pool_min: Option<u32>,
    pool_max: Option<u32>,
    request_timeout_secs: Option<u64>,
    database_connect_timeout_secs: Option<u64>,
    pool_acquire_timeout_secs: Option<u64>,
    body_limit_bytes: Option<usize>,
    logging: LoggingFileConfig,
}

#[derive(Deserialize)]
struct LoggingFileConfig {
    level: Option<String>,
    retention_days: Option<u16>,
}
```

将 `frontend_dist_dir` 固定覆盖为 `ReleaseLayout.frontend_dist_dir`。配置存在且不可读、无效或不合法时返回 `config.file_*` 错误；配置不存在时让调用方明确决定是否使用环境变量。

- [x] **步骤 4：添加模板并通过测试**

创建 `backend/config.toml.example`，使用与规格一致的非敏感示例，包含 `[logging]`。运行：`cargo fmt --manifest-path backend/Cargo.toml && cargo test --manifest-path backend/Cargo.toml --lib release::tests config::tests`

预期：所有新旧配置测试通过。

### 任务 2：文件日志、日志保留和启动初始化

**文件：**
- 修改：`backend/Cargo.toml`
- 创建：`backend/src/infrastructure/logging.rs`
- 修改：`backend/src/infrastructure/mod.rs`
- 修改：`backend/src/main.rs`
- 测试：`backend/src/infrastructure/logging.rs`

- [x] **步骤 1：编写日志目录和保留策略失败测试**

在临时目录中创建以下文件，测试只选择匹配名称且超出保留期的日志：

```rust
#[test]
fn expired_log_selection_ignores_unknown_files() {
    let names = ["qizhang-2026-08-01.jsonl", "notes.txt", "qizhang-invalid.jsonl"];
    let expired = select_expired_log_names(names, Date::from_ymd(2026, 8, 20), 14);
    assert_eq!(expired, vec!["qizhang-2026-08-01.jsonl"]);
}

#[test]
fn logging_setup_creates_the_configured_directory() {
    let root = tempfile::tempdir().unwrap();
    let logs = root.path().join("logs");
    let _guard = initialize_logging(&logs, "info", 14).unwrap();
    assert!(logs.is_dir());
}
```

- [x] **步骤 2：运行测试确认失败**

运行：`cargo test --manifest-path backend/Cargo.toml --lib infrastructure::logging::tests`

预期：FAIL，缺少日志模块。

- [x] **步骤 3：实现 JSON 日志与保留清理**

引入 `tracing-appender`。实现 `initialize_logging(log_dir, level, retention_days) -> Result<WorkerGuard, LoggingError>`：创建目录、删除过期匹配文件、配置按日滚动的 `qizhang-YYYY-MM-DD.jsonl` 非阻塞 writer，以及保留控制台文本层的 `tracing_subscriber` registry。`WorkerGuard` 必须由 `main` 持有，避免进程退出前丢失缓冲日志。

- [x] **步骤 4：接入启动并验证**

在 `main` 中先解析发行布局和配置，再初始化日志，最后调用 `command::entry`。初始化失败写标准错误并退出 `1`。运行：`cargo fmt --manifest-path backend/Cargo.toml && cargo test --manifest-path backend/Cargo.toml --lib infrastructure::logging::tests`

预期：测试通过，启动时文件 writer 有生命周期保证。

### 任务 3：命令分发与发行模式运行时失败路径

**文件：**
- 修改：`backend/src/command.rs`
- 修改：`backend/src/main.rs`
- 修改：`backend/tests/runtime_test.rs`
- 修改：`backend/tests/support/mod.rs`（仅在需要构造隔离配置时）

- [x] **步骤 1：编写运行时失败测试**

覆盖以下外部可观察行为：

```rust
#[tokio::test]
async fn release_serve_refuses_missing_config_before_binding() {
    let layout = temporary_release_layout_without_config();
    let error = launch_release(layout).await.unwrap_err();
    assert_eq!(error.code(), "config.file_missing");
}

#[tokio::test]
async fn release_serve_uses_sibling_dist_not_current_directory() {
    let layout = temporary_release_layout_with_migrated_database().await;
    let app = prepare_release_router(&layout).await.unwrap();
    assert_eq!(get(app, "/").await.status(), StatusCode::OK);
}
```

- [x] **步骤 2：运行测试确认失败**

运行：`TEST_DATABASE_URL="$TEST_DATABASE_URL" cargo test --manifest-path backend/Cargo.toml --test runtime_test release_ -- --nocapture --test-threads=1`

预期：FAIL，当前启动仅从环境与当前目录读取配置。

- [x] **步骤 3：实现默认启动、显式命令与配置优先级**

保留 `migrate`、`serve`，新增 `package`，并将无参数解析为 `serve`。`main` 通过 `ReleaseLayout::current()` 查找同级配置：

```rust
match ReleaseLayout::current()?.load_config() {
    Ok(release) => run_release(command, release).await,
    Err(ReleaseConfigError::Missing) => run_development(command, std::env::vars()).await,
    Err(error) => Err(error.into()),
}
```

发行配置存在时不得合并环境变量；`serve` 继续执行 schema 校验、seed 和 cleanup，但绝不调用 migration。

- [x] **步骤 4：运行定向真实 PostgreSQL 测试**

运行：`TEST_DATABASE_URL="$TEST_DATABASE_URL" cargo test --manifest-path backend/Cargo.toml --test runtime_test -- --nocapture --test-threads=1`

预期：现有和新增运行时测试通过。

### 任务 4：实现 `package` 发行包组装

**文件：**
- 修改：`backend/src/command.rs`
- 创建：`backend/src/package.rs`
- 修改：`backend/src/lib.rs`
- 修改：`backend/README.md`
- 测试：`backend/src/package.rs`

- [x] **步骤 1：编写组装失败测试**

使用临时源/目标目录验证：

```rust
#[test]
fn package_copies_binary_dist_and_template_without_overwriting_config() {
    let fixture = package_fixture();
    std::fs::write(fixture.output.join("config.toml"), "database_url = 'keep-me'").unwrap();
    assemble_release(&fixture.input, &fixture.output).unwrap();
    assert!(fixture.output.join(executable_name("pocket-log-backend")).is_file());
    assert!(fixture.output.join("dist/index.html").is_file());
    assert_eq!(std::fs::read_to_string(fixture.output.join("config.toml")).unwrap(), "database_url = 'keep-me'");
}
```

- [x] **步骤 2：运行测试确认失败**

运行：`cargo test --manifest-path backend/Cargo.toml --lib package::tests`

预期：FAIL，缺少发行包组装器。

- [x] **步骤 3：实现纯 Rust 组装器和子命令**

实现 `assemble_release`：验证已存在 release binary 与前端 `dist/index.html`，创建目标目录、递归复制 `dist/`、复制二进制、仅在目标配置不存在时复制 `config.toml.example` 为 `config.toml`、创建 `logs/`。`package` 子命令先运行 `npm --prefix frontend run build` 与 `cargo build --release --manifest-path backend/Cargo.toml`，再调用组装器；任一步失败返回带上下文但不含敏感信息的错误。

- [x] **步骤 4：测试并更新运行文档**

README 增加开发机打包、直接启动、显式迁移、编辑 `config.toml`、日志位置与安全提示。运行：`cargo fmt --manifest-path backend/Cargo.toml && cargo test --manifest-path backend/Cargo.toml --lib package::tests`

预期：组装器测试通过，文档不暴露真实凭据。

### 任务 5：完整交付验证与文档收尾

**文件：**
- 修改：`backend/README.md`
- 修改：`docs/superpowers/plans/2026-08-28-standalone-release-implementation.md`
- 测试：`backend/tests/runtime_test.rs`

- [x] **步骤 1：验收发行目录**

在临时发行目录运行 `package`，验证包含可执行文件、`config.toml`、`dist/index.html` 和 `logs/`；使用 Chrome DevTools MCP 访问启动后的发行二进制，确认前端和 `/api/v1/bootstrap` 同源可用。

- [x] **步骤 2：运行全量门禁**

运行：

```bash
cargo fmt --manifest-path backend/Cargo.toml --check
cargo clippy --manifest-path backend/Cargo.toml --all-targets --all-features -- -D warnings
TEST_DATABASE_URL="$TEST_DATABASE_URL" cargo test --manifest-path backend/Cargo.toml --all-features
cargo build --manifest-path backend/Cargo.toml --release
npm --prefix frontend run check
npm --prefix frontend run coverage
npm --prefix frontend run build
```

预期：所有命令退出码为 0；前端 `src/app` 和 `src/domain` 每文件行覆盖率保持至少 90%。

- [x] **步骤 3：记录实际验证结果**

在计划末尾记录实际命令、测试数量、发行目录检查结果和浏览器验收；不使用 Git 作为交付记录。

#### 任务 5 实际验证记录（2026-08-28）

- 新增二进制级回归 `binary_gives_valid_sibling_config_precedence_over_environment`：同级的有效 TOML 使用不可连接的本地地址，环境变量使用格式无效的地址，断言进程走同级配置并以 `startup failed` 退出。为确认该测试能捕获回归，临时将入口改为强制读取环境变量，测试按预期由退出码 `1` 变为 `2` 而失败；恢复既有最小优先级分支后再次通过。
- 执行 `cargo run --manifest-path backend/Cargo.toml -- package` 成功，生成 `release/qizhang-aarch64-macos/`。检查确认其中存在可执行文件、`config.toml`、`dist/index.html` 和 `logs/`。在隔离复制目录写入测试配置后，先显式运行同级可执行文件的 `migrate`，再无参数启动它；启动阶段只发生 schema 只读校验、seed/cleanup 与绑定，未执行迁移。运行时测试中 `serve_refuses_an_unmigrated_release_schema_without_migrating_it` 也验证未迁移 schema 会被 `serve` 拒绝且不被改写。
- 使用 Chrome DevTools MCP 访问同源发行服务：根路径渲染“栖账”总览，`/api/v1/bootstrap` 返回 `application/json` 的账本数据；同级 `logs/` 生成当日 JSONL 文件并含 79 行。验收服务通过 Ctrl-C 正常结束。
- 门禁均退出 `0`：`cargo fmt --manifest-path backend/Cargo.toml --check`；`cargo clippy --manifest-path backend/Cargo.toml --all-targets --all-features -- -D warnings`；`TEST_DATABASE_URL=<local-test-database> cargo test --manifest-path backend/Cargo.toml --all-features`（138 个 Rust 测试通过）；`cargo build --manifest-path backend/Cargo.toml --release`；`npm --prefix frontend run check`（17 个文件、193 个测试通过）；`npm --prefix frontend run coverage`（`src/app` 逐文件行覆盖率最低 90.20%，`src/domain` 为 99.19%）；`npm --prefix frontend run build`。
