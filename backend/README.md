# 栖账后端

## 生成并使用发行包

在项目根目录执行：

```bash
cargo run --manifest-path backend/Cargo.toml -- package
```

该命令会先运行前端生产构建和 Rust release 构建，再生成当前平台的
`release/PocketLog-<target>/` 目录。其中包含可直接运行的
`pocket-log-backend`（Windows 为 `.exe`）、同级 `dist/`、`config.toml` 和
`logs/`。重复打包会更新程序与前端资源，但不会覆盖已经存在的
`config.toml`。

在发行目录中编辑 `config.toml`，填写部署环境的 PostgreSQL 连接信息后，直接运行
可执行文件即可同时提供前端和 `/api/v1`：

```bash
./pocket-log-backend
```

首次部署或 schema 更新必须显式执行迁移：

```bash
./pocket-log-backend migrate
```

`serve`（包括不带参数时的默认启动）只校验 schema，绝不会自动迁移。后端按日 JSONL
日志保存在可执行文件同级的 `logs/PocketLog-YYYY-MM-DD.jsonl`，控制台同时输出简洁日志。
不要将包含真实数据库密码的 `config.toml` 提交、上传或发送给他人。

## 本地运行

1. 启动 PostgreSQL，并设置 `DATABASE_URL`（可复制 `.env.example`）。
2. 编译后执行一次显式迁移：`cargo run --manifest-path backend/Cargo.toml -- migrate`。
3. 启动服务：`cargo run --manifest-path backend/Cargo.toml -- serve`。
4. 检查就绪状态：`curl http://127.0.0.1:3000/health/ready`。

`serve` 启动不会执行迁移；schema 不完整或静态目录缺失时会失败。默认监听回环地址且服务无鉴权。若设置开放监听地址，必须自行增加反向代理、认证和网络访问边界。

## Compose

先启动数据库：`docker compose -f backend/compose.yaml up -d postgres`；随后显式运行迁移：`docker compose -f backend/compose.yaml --profile migration run --rm migrate`；最后启动后端：`docker compose -f backend/compose.yaml up backend`。
