# PocketLog 发布命名统一设计

## 目标

将当前运行与发布链路中的旧品牌标识统一替换为 `PocketLog`，使 `package`
命令产出的发布目录、日志文件和部署文档
使用一致的产品名称。

## 命名规则

- 用户可见的产品名称和发布目录使用 `PocketLog`：
  `release/PocketLog-<arch>-<os>/`。
- 可执行文件和 Cargo 包维持既有的 kebab-case 技术标识
  `pocket-log-backend`。
- 日志文件采用 `PocketLog-YYYY-MM-DD.jsonl` 前缀；过期日志清理规则
  同步匹配新前缀。
- PostgreSQL 数据库示例、测试 schema 和其他数据库标识使用小写安全
  形式 `pocket_log`。这避免未加引号的 PostgreSQL 标识符发生大小写
  折叠而造成配置误解。
- Unix/Docker 用户与路径、临时目录等技术标识使用 `pocket-log` 或
  `pocket_log`，分别遵循路径/用户与数据库/标识符惯例。

## 修改范围

1. `backend/src/package.rs` 生成 `PocketLog-<target>` 发布目录，并更新
   对应单元测试。
2. `backend/src/infrastructure/logging.rs` 使用 `PocketLog-` 日志前缀，
   并更新清理与轮转测试。
3. 后端配置、Docker、集成测试、测试辅助代码和运行时临时目录中所有
   仍会执行或对使用者可见的旧品牌标识按上述规则替换。
4. 根 README、后端 README、当前发布设计和实施文档中的目录、日志与
   配置示例同步更新。

## 明确不修改

历史前端 `localStorage` 键名示例仅存在于废弃实现的早期设计记录，不是
当前运行或发布链路的一部分，保留原样以维护历史文档的准确性。

## 验收

- `cargo run --manifest-path backend/Cargo.toml -- package` 生成
  `release/PocketLog-<target>/`。
- 产物仍包含 `pocket-log-backend`、`config.toml`、`dist/` 和 `logs/`。
- 后端测试验证日志轮转、过期清理与发布目录新命名。
- 文档不再使用旧品牌作为当前发布、日志或配置命名。
