# PocketLog 发布命名统一实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将 `package` 发行目录、日志文件及所有当前运行/发布标识由旧品牌统一为 PocketLog。

**架构：** 保持可执行文件 `pocket-log-backend` 不变；发布目录和日志采用用户可见的 `PocketLog`，而 PostgreSQL、测试 schema 与临时目录采用小写安全技术标识。发布组装和日志模块分别拥有命名常量，测试固定其可观察产物。

**技术栈：** Rust、Cargo、Axum、tracing-appender、PostgreSQL、Markdown。

---

## 文件结构

- 修改：`backend/src/package.rs` — 生成 `release/PocketLog-<target>`，并使测试夹具使用新技术名称。
- 修改：`backend/src/infrastructure/logging.rs` — 轮转和清理仅匹配 `PocketLog-YYYY-MM-DD.jsonl`。
- 修改：`backend/src/{config.rs,release.rs,command.rs}` — 更新示例数据库/路径的技术命名。
- 修改：`backend/tests/**/*.rs` — 更新数据库、临时目录、触发器等运行时测试标识。
- 修改：`backend/{README.md,config.toml.example,Dockerfile}` 与 `README.md` — 更新发布布局、日志和示例名称。
- 修改：`docs/superpowers/{specs,plans}/2026-08-{26,28}-*.md` — 更新当前后端与发布设计记录；不触碰废弃 localStorage 的历史计划。

### 任务 1：发布目录与日志命名

**文件：**
- 修改：`backend/src/package.rs`
- 修改：`backend/src/infrastructure/logging.rs`

- [x] **步骤 1：先写失败测试，固定新名称**

在 `package.rs` 测试中新增纯路径断言，验证 `package_current_project` 所用目录名为
`PocketLog-<arch>-<os>`；将日志测试期望改为 `PocketLog-2026-08-01.jsonl`，并保留
一个旧格式日志文件断言其为未知文件。

```rust
assert_eq!(release_directory_name("aarch64-macos"), "PocketLog-aarch64-macos");
assert_eq!(expired, vec!["PocketLog-2026-08-01.jsonl"]);
assert!(legacy_log.is_file());
```

- [x] **步骤 2：运行定向测试，确认红灯**

运行：`cargo test --manifest-path backend/Cargo.toml package::tests infrastructure::logging::tests`

预期：发布目录断言或新日志前缀断言失败。

- [x] **步骤 3：以最小改动实现名称常量**

在 `package.rs` 提取 `release_directory_name(target: &str) -> String` 并让组装路径调用它；
在 `logging.rs` 将前缀常量改为 `PocketLog-`，同步测试夹具名称。

```rust
fn release_directory_name(target: &str) -> String {
    format!("PocketLog-{target}")
}

const LOG_PREFIX: &str = "PocketLog-";
```

- [x] **步骤 4：运行定向测试，确认绿灯**

运行：`cargo test --manifest-path backend/Cargo.toml package::tests infrastructure::logging::tests`

预期：全部通过，旧前缀不会被过期清理删除。

### 任务 2：技术标识与部署文档统一

**文件：**
- 修改：`backend/src/config.rs`、`backend/src/release.rs`、`backend/src/command.rs`
- 修改：`backend/tests/**/*.rs`、`backend/config.toml.example`、`backend/Dockerfile`
- 修改：`README.md`、`backend/README.md` 与当前后端/发布设计、实施文档

- [ ] **步骤 1：编写失败的配置/运行时断言**

将受影响测试中的 URL、临时目录和数据库 schema 示例改为 `pocket_log` 或
`pocket-log`，并让运行时测试断言 `logs/PocketLog-YYYY-MM-DD.jsonl`。

```rust
assert!(layout.logs_dir.join("PocketLog-2026-08-20.jsonl").is_file());
assert!(config.database_url.contains("pocket_log"));
```

- [ ] **步骤 2：运行受影响测试，确认红灯**

运行：`cargo test --manifest-path backend/Cargo.toml --test runtime_test --test migration_test --lib`

预期：旧名称的断言失败。

- [ ] **步骤 3：替换当前运行和发布链路中的旧品牌标识**

根据规格将数据库/测试 schema 改为 `pocket_log`，路径和 Docker 用户改为
`pocket-log`，文档目录与日志示例改为 `PocketLog`。不修改只描述废弃 localStorage
键名的历史计划。

- [ ] **步骤 4：运行受影响测试，确认绿灯**

运行：`cargo test --manifest-path backend/Cargo.toml --test runtime_test --test migration_test --lib`

预期：全部通过。

- [ ] **步骤 5：端到端打包验证**

运行：`cargo run --manifest-path backend/Cargo.toml -- package`

预期：输出 `release/PocketLog-<arch>-<os>/`，其中存在 `pocket-log-backend`、
`config.toml`、`dist/index.html` 与 `logs/`。

### 任务 3：最终核验

**文件：**
- 修改：本计划中的复选框状态

- [ ] **步骤 1：格式化并运行完整后端测试**

运行：`cargo fmt --manifest-path backend/Cargo.toml --check && cargo test --manifest-path backend/Cargo.toml --all-features`

预期：格式和全部后端测试通过。

- [ ] **步骤 2：核查发布命名残留**

运行：检查后端、README 与当前后端/发布设计、实施文档中不再出现旧品牌标识。

预期：只保留明确说明“不修改”的废弃 localStorage 历史记录之外的零匹配。
