# 运行时数据命令实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将迁移、演示数据、服务启动和账本清理拆分为显式且可验证的运行时命令。

**架构：** `command` 模块解析并分发 `migrate`、`demo`、`clean`、`serve` 与 `package`。演示写入和账本清理封装在 `infrastructure::seed`，各自使用数据库事务；`serve` 仅验证 schema 与静态资源后启动，不再写入账本。

**技术栈：** Rust、Tokio、SeaORM、SeaORM Migration、PostgreSQL。

---

## 文件职责

- 修改：`backend/src/infrastructure/seed.rs` — 保留空账本演示数据初始化，并提供原子账本清理操作。
- 修改：`backend/src/command.rs` — 注册 `demo`/`clean` 命令、移除 `serve` 的演示写入、更新使用说明。
- 修改：`backend/tests/persistence_test.rs` — 验证演示数据只写入空账本和清理后的重新填充。
- 修改：`backend/tests/runtime_test.rs` — 验证命令边界、`migrate` 空表、`serve` 无写入以及 `clean` 事务效果。

### 任务 1：账本清理与演示数据边界

**文件：**
- 修改：`backend/src/infrastructure/seed.rs`
- 测试：`backend/tests/persistence_test.rs`

- [ ] **步骤 1：编写失败的 PostgreSQL 集成测试**

在 `persistence_test.rs` 添加测试：迁移后的空账本执行 `seed_if_needed` 会产生 6 个分类、4 个账户和 17 条交易；执行新的 `clear_ledger` 后分类、账户、交易、自定义图标、幂等请求均为零，`app_state.seed_version` 回到 0；再次 `seed_if_needed` 会再次产生完整演示数据。

- [ ] **步骤 2：运行测试验证失败**

运行：

```bash
TEST_DATABASE_URL='postgresql://root:123456@127.0.0.1:5432/pocket_log' cargo test --manifest-path backend/Cargo.toml --test persistence_test clean_ledger_resets_the_empty_book_for_demo -- --nocapture
```

预期：FAIL，因为 `clear_ledger` 尚不存在。

- [ ] **步骤 3：实现最少的原子清理代码**

在 `seed.rs` 新增 `clear_ledger(db: &DatabaseConnection) -> Result<(), AppError>`。使用一个写事务，依次删除 `transactions`、`idempotency_requests`、`custom_icons`、`categories`、`account_labels`，再将单例 `app_state` 更新为 `seed_version = 0` 并递增 `data_revision`。任一步失败时回滚。

- [ ] **步骤 4：运行测试验证通过**

运行步骤 2 的命令；预期：PASS。

### 任务 2：运行时命令分发与服务只读边界

**文件：**
- 修改：`backend/src/command.rs`
- 测试：`backend/tests/runtime_test.rs`
- 测试：`backend/src/command.rs`

- [ ] **步骤 1：编写失败的命令边界测试**

在 `runtime_test.rs` 添加集成测试：

1. `run(Command::Migrate, config)` 后验证业务表中没有分类、账户、交易。
2. `run(Command::Demo, config)` 在空账本中写入演示数据，重复调用不重复写入。
3. `prepare_serve(config)` 在迁移后的空账本中成功返回，且账本仍为空。
4. `run(Command::Clean, config)` 清空已演示填充的账本，并允许之后 `run(Command::Demo, config)` 再次填充。

在 `command.rs` 单元测试中断言 `demo` 和 `clean` 能解析，`USAGE` 包含全部五个命令，并且它们与 `migrate`/`serve` 一样需要运行时配置。

- [ ] **步骤 2：运行测试验证失败**

运行：

```bash
TEST_DATABASE_URL='postgresql://root:123456@127.0.0.1:5432/pocket_log' cargo test --manifest-path backend/Cargo.toml --test runtime_test runtime_commands_have_explicit_data_boundaries -- --nocapture
```

预期：FAIL，因为 `Demo` 和 `Clean` 命令尚不存在，且 `serve` 仍会调用 seed。

- [ ] **步骤 3：实现最少的命令分发代码**

在 `Command` 中增加 `Demo` 与 `Clean` 变体；将解析值、使用说明和运行时配置判定更新为 `migrate|demo|clean|serve|package`。`run` 中：

```rust
Command::Demo => {
    let db = connect(&config).await.map_err(|_| CommandExecutionError::Startup)?;
    verify_schema(&db).await.map_err(|_| CommandExecutionError::Startup)?;
    seed_if_needed(&db, &crate::application::clock::SystemClock)
        .await
        .map_err(|_| CommandExecutionError::Startup)
}
Command::Clean => {
    let db = connect(&config).await.map_err(|_| CommandExecutionError::Startup)?;
    verify_schema(&db).await.map_err(|_| CommandExecutionError::Startup)?;
    clear_ledger(&db).await.map_err(|_| CommandExecutionError::Startup)
}
```

从 `prepare_serve` 删除 `seed_if_needed` 调用，使其只连接、校验 schema 与校验静态资源。

- [ ] **步骤 4：运行测试验证通过**

运行步骤 2 的命令，以及：

```bash
cargo test --manifest-path backend/Cargo.toml --lib
TEST_DATABASE_URL='postgresql://root:123456@127.0.0.1:5432/pocket_log' cargo test --manifest-path backend/Cargo.toml --test persistence_test -- --nocapture
```

预期：全部 PASS。

### 任务 3：命令行帮助与完整验证

**文件：**
- 修改：`README.md`
- 测试：`backend/tests/runtime_test.rs`

- [ ] **步骤 1：编写失败的发布二进制帮助测试**

在 `runtime_test.rs` 的二进制测试区域添加断言：传入未知命令时 stderr 使用新的完整帮助文本 `Usage: pocket-log-backend [migrate|demo|clean|serve|package]`。

- [ ] **步骤 2：运行测试验证失败**

运行：

```bash
cargo test --manifest-path backend/Cargo.toml --test runtime_test binary_reports_all_supported_commands -- --nocapture
```

预期：FAIL，因为帮助文本尚未更新。

- [ ] **步骤 3：更新运维文档**

在 `README.md` 的运行命令部分明确：首次部署依次执行 `migrate`、可选 `demo`、`serve`；`clean` 会删除账本业务数据但不会删除表，需谨慎使用。

- [ ] **步骤 4：运行完整验证**

运行：

```bash
cargo fmt --manifest-path backend/Cargo.toml --check
TEST_DATABASE_URL='postgresql://root:123456@127.0.0.1:5432/pocket_log' cargo test --manifest-path backend/Cargo.toml --all-features -- --test-threads=1
```

预期：格式检查与全部 Rust 测试 PASS。
