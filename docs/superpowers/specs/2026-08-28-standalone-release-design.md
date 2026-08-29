# 栖账独立发行包设计

## 目标

交付一个 Rust release 可执行文件。用户在发行目录中直接运行该文件，即可由同一 Axum 进程提供后端 API 和前端 `dist/` 静态资源；程序从可执行文件同级读取 `config.toml`，并将后端日志写入同级 `logs/`。

## 发行目录

`package` 命令生成以下目录，目录名包含当前目标平台：

```text
release/qizhang-<target>/
├── pocket-log-backend          # Windows 为 pocket-log-backend.exe
├── config.toml
├── dist/
│   ├── index.html
│   └── assets/…
└── logs/                       # 初始为空；首次启动时确保存在
```

所有默认路径均相对可执行文件所在目录解析；改变 shell 当前目录不会影响配置、前端资源或日志位置。

## 命令语义

- 不带参数执行可执行文件，等价于 `serve`。
- `serve` 使用发行目录的默认路径启动；不执行 schema migration。
- `migrate` 使用同一 `config.toml` 连接数据库并显式执行 migration。
- `package` 仅作为开发/构建环境命令：构建前端、构建 release 二进制、复制默认配置与 `dist/` 到发行目录；不连接数据库、不启动服务。

`serve` 在绑定端口前依次校验：可读的配置文件、存在的 `dist/index.html`、数据库连接和完整 schema。任何失败都写标准错误并返回非零退出码；不会自动迁移数据库。

## 配置文件

配置使用可读的 TOML，敏感数据库密码只由部署者写入该文件，不回显至错误信息或日志。

```toml
# config.toml
database_url = "postgres://user:password@127.0.0.1:5432/pocket_log"
bind_addr = "127.0.0.1:3000"
pool_min = 1
pool_max = 10
request_timeout_secs = 15
database_connect_timeout_secs = 5
pool_acquire_timeout_secs = 5
body_limit_bytes = 1048576

[logging]
level = "info"
retention_days = 14
```

`frontend_dist_dir`、日志目录和配置目录不是用户配置项：它们固定为可执行文件同级 `dist/`、`logs/`、`config.toml`，避免发行包路径配置相互矛盾。

环境变量仅作为开发模式兼容入口：若未找到同级 `config.toml`，现有 `Config::from_map` 仍可用于 `cargo run`。发行模式下配置文件存在但无效时必须失败，不得悄悄混用环境变量。

## 日志

启动时创建 `logs/`（包含父目录不存在时）。使用 `tracing` 的非阻塞 JSON 格式文件 writer，按本地自然日滚动写入：

```text
logs/qizhang-2026-08-28.jsonl
```

每条记录包含时间、级别、目标模块、请求 ID、HTTP 请求 span 与错误码（若有）。控制台同时保留紧凑的文本日志，便于前台启动诊断。

启动完成后和每日滚动前，清理名称匹配 `qizhang-YYYY-MM-DD.jsonl` 且早于 `retention_days` 的日志；不删除未知文件。`retention_days` 必须是正整数。日志目录不可创建、不可写或日志订阅器初始化失败时，程序启动失败，避免无日志运行。

## 实现边界

- 新增配置文件加载与发行目录路径解析模块，供 `main`、命令层和日志初始化共用。
- 保留现有 API、业务服务、SeaORM 仓储和显式迁移行为；只替换配置来源与 logging 初始化。
- `package` 的组装实现为 Rust 子命令，不依赖 shell 脚本，保证发行结构可在支持的本机目标平台复现。
- 默认配置模板作为受版本控制的 `backend/config.toml.example` 存在；`package` 将它复制为发行目录 `config.toml`，且绝不覆盖已有目标配置。

## 验证

- 单元测试：路径从伪造可执行文件路径解析；TOML 成功/失败解析、敏感信息脱敏、日志保留文件筛选。
- 运行时测试：临时发行目录可启动并托管静态资源；缺 `config.toml`、缺 `dist/index.html`、不可写日志目录和未迁移 schema 均失败；`serve` 不创建 migration 记录。
- 打包测试：`package` 产生可执行文件、`config.toml` 和完整 `dist/`，重复执行不会覆盖已存在的配置。
- 最终执行后端格式、Clippy、真实 PostgreSQL 全量测试、release 构建，以及前端检查、覆盖率门禁和生产构建。
