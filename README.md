# 栖账（PocketLog）

栖账是一个面向个人用户的单用户记账 Web 应用。当前工程已经包含完整的前后端交付物：前端负责总览、收支明细、消费分析、月度报告和分类/账户标签等页面；后端负责 `/api/v1` 接口、PostgreSQL 持久化、演示数据初始化，以及前端静态资源托管。

项目采用前后端分离开发、统一可执行文件部署的方式：

- 前端：React、TypeScript、Vite
- 后端：Rust、Axum、SeaORM
- 数据库：PostgreSQL

后端代码全部位于 `backend/` 目录中，正式账本数据全部存储在 PostgreSQL，不依赖浏览器 `localStorage` 作为持久化数据源。

## 目录结构

```text
.
├── frontend/          # 前端源码与构建脚本
├── backend/           # Rust 后端、迁移、配置模板、测试
├── release/           # package 命令生成的发行包
└── README.md
```

## 环境要求

- Node.js 及 npm
- Rust 稳定版工具链及 Cargo
- PostgreSQL

## 本地开发

### 1. 安装前端依赖

```bash
npm --prefix frontend install
```

如果希望严格按照锁文件安装，也可以使用：

```bash
npm --prefix frontend ci
```

### 2. 构建前端

```bash
npm --prefix frontend run build
```

开发调试前端页面时，可以单独启动 Vite：

```bash
npm --prefix frontend run dev
```

### 3. 显式执行数据库迁移

`serve` 启动时不会自动迁移数据库。首次运行或 schema 更新后，必须先显式执行一次 `migrate`：

```bash
DATABASE_URL='postgresql://<user>:<password>@127.0.0.1:5432/<database>' cargo run --manifest-path backend/Cargo.toml -- migrate
```

例如，你当前本地环境可以替换为自己的实际连接串；不要把真实密码写入 README 或提交到仓库。

### 4. 启动后端

```bash
DATABASE_URL='postgresql://<user>:<password>@127.0.0.1:5432/<database>' FRONTEND_DIST_DIR='/absolute/path/to/frontend/dist' cargo run --manifest-path backend/Cargo.toml -- serve
```

如果不传 `FRONTEND_DIST_DIR`，后端默认读取当前工作目录下的 `dist/`。在本仓库开发阶段，通常建议显式指向 `frontend/dist`。

命令边界如下：

- `migrate`：只负责显式变更数据库 schema。
- `serve`：只校验 schema、准备静态资源和演示数据，然后启动服务。
- `package`：只负责构建前端与后端，并组装发行包，不连接数据库。

默认情况下，不带参数运行后端等价于执行 `serve`。

## 编译

### 分别编译前后端

前端生产构建：

```bash
npm --prefix frontend run build
```

后端调试版编译：

```bash
cargo build --manifest-path backend/Cargo.toml
```

后端发行版编译：

```bash
cargo build --release --manifest-path backend/Cargo.toml
```

### 生成可直接部署的发行包

```bash
cargo run --manifest-path backend/Cargo.toml -- package
```

该命令会自动完成以下 3 件事：

- 先构建前端生产产物；
- 再构建 Rust release 可执行文件；
- 最后输出到 `release/qizhang-<arch>-<os>/`。

当前机器上的输出目录通常类似：

```text
release/qizhang-aarch64-macos/
```

## 部署

### 发行包结构

`package` 生成的发行目录为固定布局：

```text
release/qizhang-<arch>-<os>/
├── pocket-log-backend  # Windows 下为 pocket-log-backend.exe
├── config.toml
├── dist/
└── logs/
```

各项作用如下：

- `pocket-log-backend`：唯一启动入口，直接运行即可同时提供前端页面和后端 API。
- `config.toml`：部署配置文件，放在可执行文件同级目录。
- `dist/`：前端静态资源目录。
- `logs/`：后端日志目录，程序启动后会写入按天滚动的 JSONL 日志文件。

### 部署步骤

1. 在构建机执行：

```bash
cargo run --manifest-path backend/Cargo.toml -- package
```

2. 将 `release/qizhang-<arch>-<os>/` 整个目录部署到目标机器。

3. 编辑发行目录中的 `config.toml`，填写目标环境的数据库地址和监听配置。

4. 如果目标数据库尚未完成 schema 初始化，先显式执行迁移：

```bash
./pocket-log-backend migrate
```

5. 迁移完成后，直接启动同级可执行文件：

```bash
./pocket-log-backend
```

程序启动后会同时提供前端页面和 `/api/v1` 接口。

### 配置加载规则

发行包模式下，配置优先级是固定的：

- 如果可执行文件同级存在 `config.toml`，程序只读取这个文件。
- 只有当同级 `config.toml` 不存在时，运行时才会回退到环境变量；这一回退主要用于仓库内开发场景。

这意味着部署时不要依赖宿主机残留环境变量覆盖发行配置。

### 配置示例

默认模板来源于 `backend/config.toml.example`，示例如下：

```toml
database_url = "postgres://<user>@127.0.0.1:5432/<database>"
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

建议部署前重点确认：

- `database_url` 是否指向可访问的 PostgreSQL。
- `bind_addr` 是否符合目标机器的监听策略。
- `logs/` 目录是否具备写权限。

### 日志说明

后端日志写入可执行文件同级的 `logs/` 目录，文件名格式为：

```text
logs/qizhang-YYYY-MM-DD.jsonl
```

同时，后端也会向控制台输出简洁日志，便于本地运行和部署排障。

### 迁移边界

部署时需要特别注意：

- `serve` 不会自动迁移数据库。
- 直接运行 `./pocket-log-backend` 的默认行为也是 `serve`。
- 数据库 schema 变更只能通过显式 `migrate` 完成。

### 配置文件保留规则

重复执行 `package` 时，会刷新可执行文件和 `dist/`，但如果发行目录里已经存在 `config.toml`，该文件不会被覆盖，便于保留部署环境的本地配置。
