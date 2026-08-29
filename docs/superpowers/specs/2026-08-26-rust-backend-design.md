# 栖账 Rust 后端设计规格

- 日期：2026-08-26
- 状态：书面规格已确认
- 适用工程：PocketLog / 栖账
- 后端技术：Rust、Axum、SeaORM、PostgreSQL

## 1. 目标与已确认决策

本设计为现有栖账 Web 应用增加一个单用户、无认证的 Rust 后端。PostgreSQL 成为财务数据的唯一事实来源，现有 `localStorage` 财务数据不迁移、不继续同步。

已确认的关键决策如下：

- 采用分层模块化单体，不拆分微服务。
- Axum 同时提供 JSON API 和打包后的前端静态文件。
- SeaORM 负责 PostgreSQL 访问和数据库迁移。
- 后端负责交易、标签、汇总、趋势、洞察和月报的全部业务逻辑。
- 前端只负责交互、展示和短生命周期界面状态，不重复推断业务结论。
- 数据库为空且从未初始化时，由后端写入演示数据；不导入旧 `localStorage`。
- schema 迁移只能通过显式 `pocket-log-backend migrate` 命令执行。
- `pocket-log-backend serve` 启动时只检查 schema 版本，不执行迁移或 DDL。
- 所有后端 Rust 代码、迁移和后端交付配置均位于 `backend/`。

## 2. 范围

### 2.1 本期包含

- 交易创建、查询、删除和限时恢复。
- 支出、收入和账户间转账。
- 分类创建、重命名、排序、停用、删除和迁移。
- 账户标签创建、重命名和停用。
- 月度总览、交易筛选、消费分析、自动洞察和月度报告。
- PostgreSQL schema、约束、索引、迁移和演示数据。
- 统一 JSON 错误、请求追踪、健康检查和优雅停机。
- 前端静态资源服务与单页应用路由回退。
- 真实 PostgreSQL 集成测试及前后端接入测试。

### 2.2 本期不包含

- 注册、登录、鉴权、多用户或多账本隔离。
- 旧 `localStorage` 数据导入、离线写入或双向同步。
- 编辑已有交易。
- 预算、资产、订阅、账单导入、多人协作或远程同步。
- Redis、消息队列、物化视图、事件溯源或独立分析服务。
- 启动服务时自动执行 schema 迁移。

## 3. 总体架构

请求链路如下：

```text
HTTP 请求
  → Axum Router / Middleware
  → Handler / DTO
  → Application Service
  → Domain Rule
  → Repository Port
  → SeaORM Repository
  → PostgreSQL
```

建议目录：

```text
backend/
├── Cargo.toml
├── src/
│   ├── main.rs
│   ├── config/
│   ├── api/
│   │   ├── routes/
│   │   ├── dto/
│   │   ├── error.rs
│   │   └── middleware/
│   ├── application/
│   │   ├── transactions/
│   │   ├── labels/
│   │   ├── analytics/
│   │   └── reports/
│   ├── domain/
│   │   ├── transaction.rs
│   │   ├── category.rs
│   │   ├── account.rs
│   │   ├── money.rs
│   │   └── date_range.rs
│   ├── infrastructure/
│   │   ├── persistence/
│   │   │   ├── entities/
│   │   │   └── repositories/
│   │   └── static_files.rs
│   └── migration/
├── tests/
└── compose.yaml
```

模块职责：

- `api`：路由、参数提取、DTO 转换、HTTP 状态码和统一错误，不写业务规则。
- `application`：编排用例、事务、仓储调用、幂等和数据修订，不依赖具体 HTTP 类型。
- `domain`：金额、日期范围、交易、标签、分析和报告规则，不依赖 Axum 或 SeaORM。
- `infrastructure`：SeaORM 实体、仓储实现、迁移、种子、静态文件和外部运行设施。
- `config`：从环境加载并校验只读配置。

`AppState` 只保存数据库连接池和只读配置。业务状态不常驻进程内存，不引入进程内数据缓存。

依赖基线使用 Axum 0.8 稳定系列、SeaORM 1.1 稳定系列和 Tokio。实现时锁定补丁版本，不采用仍处于候选发布阶段的 SeaORM 2。

## 4. PostgreSQL 数据模型

### 4.1 分类 `categories`

关键字段：

- `id UUID PRIMARY KEY`
- `name TEXT NOT NULL`
- `normalized_name TEXT NOT NULL UNIQUE`
- `kind TEXT NOT NULL CHECK (kind IN ('expense', 'income'))`
- `emoji TEXT NOT NULL`
- `color TEXT NOT NULL`
- `semantic_key TEXT NULL UNIQUE`
- `sort_order INTEGER NOT NULL`
- `active BOOLEAN NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- `updated_at TIMESTAMPTZ NOT NULL`

`normalized_name` 由服务端对名称去除首尾空白并按统一大小写规则生成，用于保持与现有全局名称唯一规则一致。名称按 Unicode 字符计数为 1 至 40 个字符，`emoji` 为 1 至 16 个字符，颜色只接受六位十六进制格式。`id, kind` 建立唯一约束，供交易表复合外键引用。`sort_order` 使用可延迟唯一约束，使整体换位能在一个事务中完成且最终状态不得重复。

`semantic_key` 只用于需要稳定语义的内置分类，不允许通过 API 修改。演示数据中的交通分类使用 `transport`；重命名不改变其语义，删除或迁移掉该分类后不再生成交通专项洞察。

### 4.2 账户标签 `account_labels`

关键字段：

- `id UUID PRIMARY KEY`
- `name TEXT NOT NULL`
- `normalized_name TEXT NOT NULL UNIQUE`
- `active BOOLEAN NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- `updated_at TIMESTAMPTZ NOT NULL`

账户只作为交易来源和去向标签，不保存余额。名称按 Unicode 字符计数为 1 至 40 个字符。

### 4.3 交易 `transactions`

关键字段：

- `id UUID PRIMARY KEY`
- `kind TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer'))`
- `amount NUMERIC(18,2) NOT NULL CHECK (amount > 0)`
- `category_id UUID NULL`
- `account_id UUID NOT NULL`
- `target_account_id UUID NULL`
- `merchant TEXT NOT NULL`
- `note TEXT NOT NULL`
- `occurred_at TIMESTAMPTZ NOT NULL`
- `local_date DATE NOT NULL`
- `local_time TIME NOT NULL`
- `utc_offset_minutes SMALLINT NOT NULL`
- `pending_delete_until TIMESTAMPTZ NULL`
- `deletion_token UUID NULL`
- `created_at TIMESTAMPTZ NOT NULL`
- `updated_at TIMESTAMPTZ NOT NULL`

数据库必须保证：

- 支出和收入必须有关联分类，且不得设置转入账户。
- 分类类型必须与支出或收入类型相同，使用 `(category_id, kind)` 复合外键保证。
- 转账不得关联分类，必须有转出和转入账户，且二者不同。
- 分类和账户外键使用 `RESTRICT`，不级联删除历史交易。
- 时区偏移范围为 `-840` 至 `840` 分钟。
- 删除截止时间和删除令牌要么同时为空，要么同时存在。
- `merchant` 去除首尾空白后为 1 至 120 个 Unicode 字符，`note` 最多为 1000 个 Unicode 字符。

常用索引包括：

- `local_date, occurred_at DESC`
- `kind, local_date`
- `category_id, local_date`
- `account_id, local_date`
- `target_account_id, local_date`
- `pending_delete_until` 的部分索引

查询默认排除带有删除截止时间的交易，无论清理任务是否已物理删除该行。

### 4.4 应用状态与幂等

`app_state` 是单例表，至少保存：

- `seed_version`
- `data_revision`

`idempotency_requests` 保存交易创建请求的幂等键、请求指纹、完成状态和成功响应。相同键与相同请求重放原响应；相同键用于不同请求时返回冲突。服务端保证幂等记录至少保留 24 小时，客户端不得在 24 小时后重试旧创建请求；过期记录由清理任务回收。

### 4.5 金额与时间

PostgreSQL 使用精确的 `NUMERIC(18,2)`，Rust 领域层使用十进制定点金额类型。API 金额使用两位小数字符串，例如 `"32.00"`，禁止经过 `f32` 或 `f64`。

PostgreSQL 会将 `TIMESTAMPTZ` 规范化，因此同时保存用户输入的本地日期、时间和 UTC 偏移。月份、日期范围、星期和周末判断一律基于 `local_date`，排序在本地时间相同时再使用绝对时间和 ID 形成稳定顺序。服务器、数据库和测试宿主时区不得改变结果。

## 5. 数据库迁移与种子

后端程序提供两个子命令：

```text
pocket-log-backend migrate
pocket-log-backend serve
```

`migrate`：

1. 读取并校验数据库配置。
2. 连接 PostgreSQL 并获取迁移锁。
3. 使用 SeaORM Migration 执行所有待应用迁移。
4. 成功退出 `0`，失败退出非零并记录脱敏错误。

`migrate` 可安全重复执行。多个迁移命令并发时必须由迁移锁串行化。

`serve`：

1. 连接 PostgreSQL。
2. 只读检查迁移表和程序期望的 schema 版本。
3. 数据库未初始化、存在待执行迁移或版本不兼容时立即启动失败。
4. schema 正确后检查 `app_state.seed_version`。
5. 仅当演示数据从未初始化时，在单个事务内写入演示分类、账户和至少五条交易，并更新种子版本。
6. 种子完成后启动 HTTP 服务。

`serve` 的任何启动路径都不得执行 DDL 或 schema 迁移。用户后来删除全部交易不会触发重新写入演示数据。种子任一步失败时全部回滚，服务拒绝启动。

标准部署顺序为：

```text
pocket-log-backend migrate
pocket-log-backend serve
等待 /health/ready 成功
```

容器入口不得隐式执行迁移。

## 6. HTTP API

API 使用 `/api/v1` 前缀，JSON 字段采用 `camelCase`。日期使用 `YYYY-MM-DD`，带时间点使用含偏移的 RFC 3339 格式。

### 6.1 初始化和健康检查

- `GET /api/v1/bootstrap`：返回分类、账户、已有交易月份、数据修订号和服务端时间。
- `GET /health/live`：只表示进程存活。
- `GET /health/ready`：验证数据库连接和 schema 版本，不泄露内部地址。

### 6.2 交易

- `GET /api/v1/transactions`
  - 支持月份、日期范围、单个或多个类型、分类、账户、周末条件和游标分页。
  - 日期范围与月份条件互斥，非法组合返回参数错误。
- `POST /api/v1/transactions`
  - 创建支出、收入或转账。
  - 要求 `Idempotency-Key`。
- `DELETE /api/v1/transactions/{id}`
  - 返回 `deletionToken`、固定 `undoUntil` 和新数据修订号。
- `POST /api/v1/transactions/{id}/restore`
  - 携带删除令牌恢复；超时或令牌不匹配返回冲突。

首期不提供编辑交易接口。

### 6.3 分类与账户

- `POST /api/v1/categories`
- `PATCH /api/v1/categories/{id}`：重命名或停用
- `PUT /api/v1/categories/order`
- `DELETE /api/v1/categories/{id}`：删除未引用分类
- `POST /api/v1/categories/{id}/migrate`：迁移交易并删除源分类
- `POST /api/v1/accounts`
- `PATCH /api/v1/accounts/{id}`：重命名或停用

所有修改请求通过 `If-Match: "<dataRevision>"` 头携带期望修订号。服务端在同一事务中锁定 `app_state` 并比较修订号，缺少或格式错误返回 `400`，过期请求返回 `409 revision_conflict`。

### 6.4 总览、分析与报告

- `GET /api/v1/overview?month=YYYY-MM`
- `GET /api/v1/analytics?...`
- `GET /api/v1/reports/monthly?month=YYYY-MM`

`overview` 返回本月汇总、真实上期比较、趋势、分类构成、自动洞察和最近五笔交易。`analytics` 支持本月、近三个月、自定义日期和账户筛选。月报完全由服务端确定性生成。

每个可下钻结果返回：

- `sourceLabel`
- `currentFilter`
- `previousFilter`，仅在需要上期证据时存在
- `includedCategoryIds`，仅在“其他”聚合时存在

前端直接使用这些条件查询证据，不重新推断筛选范围。

## 7. 写入事务与并发

### 7.1 创建交易

创建交易在一个数据库事务内完成：

1. 根据幂等键查询既有结果。
2. 已完成的相同请求直接重放；键冲突返回 `409`。
3. 锁定 `app_state` 并校验 `If-Match` 中的期望修订号。
4. 校验金额、文本、日期、本地时间和时区偏移。
5. 锁定并校验分类、账户仍启用。
6. 校验交易类型、分类类型和转账关系。
7. 插入交易、记录幂等结果并增加一次数据修订号。
8. 提交后返回已创建交易和新修订号。

同一幂等请求重放发生在修订冲突判断之前，保证网络重试能够取得已成功结果。

### 7.2 标签操作

- 收入、支出分别至少保留一个启用分类。
- 账户至少保留一个启用标签。
- 停用标签可用于历史展示和筛选，但不得用于新交易。
- 只有未被交易引用的分类可以直接删除。
- 分类迁移要求源、目标类型相同且目标启用。
- 分类迁移锁定源、目标和应用状态，在同一事务中更新所有引用、删除源分类并增加修订号。
- 分类整体排序在同一事务中完成，输入必须恰好包含当前全部分类 ID，且不得重复。

### 7.3 删除与恢复

删除不是立即物理删除：

1. 删除接口写入随机删除令牌和固定的 `pending_delete_until = now + 5 秒`。
2. 所有正常查询立即排除该交易。
3. 截止时间内，正确令牌可以恢复。
4. 恢复成功清除令牌和截止时间，并增加修订号。
5. 截止时间后，即使记录尚未清理，也永久拒绝恢复。
6. 后台周期任务物理删除过期记录；周期任务不影响业务截止时间。

每次删除拥有独立令牌和截止时间，页面切换、重试或连续删除都不能延长窗口。
物理清理不会改变任何可见业务状态，因此不增加 `data_revision`。

## 8. 查询与业务计算

总览、分析和月报使用 PostgreSQL `REPEATABLE READ` 只读事务，使一份响应中的指标、图表、洞察和证据条件来自同一个数据快照。

### 8.1 汇总

- 月支出和收入排除转账。
- 交易笔数包含支出、收入和转账。
- 日均支出为当月全部支出除以该自然月真实天数。
- 结余率为 `(收入 - 支出) / 收入 × 100%`，保留一位小数。
- 收入为零时结余率为不可计算，不返回伪造的 `0%`。
- 趋势按本地日期聚合，并补齐请求范围内的零值日期。
- 最近交易按本地日期、本地时间、绝对时间和 ID 稳定倒序，最多返回五条。

### 8.2 分类构成与环比

- 分类构成只统计支出。
- 按金额降序、分类 ID 升序形成稳定顺序。
- 返回前四类，其余合并为“其他”，同时返回其全部分类 ID。
- 上期该分类金额为零时，返回当前和上期金额，但增长率为不可计算。
- 比较期没有真实收支记录时不生成趋势或增长结论。
- 月份范围比较上一自然月；近三个月比较紧邻的前三个月；自定义范围比较之前天数相同的连续区间。

### 8.3 自动洞察

洞察最多三条，并且每条都包含可执行的证据筛选：

- 周末交通洞察只统计 `semantic_key = 'transport'` 分类在真实周六、周日发生的支出。当周末金额大于零且不低于同月工作日交通金额时生成，证据不包含工作日或其他分类。
- 分类环比只在存在有效上期基线时生成，当前期与上一期证据同时返回。
- 结余率洞察同时提供收入和支出证据，明确排除转账。

规则使用固定阈值、固定舍入和稳定排序；同一数据必须生成完全一致的洞察集合。

### 8.4 月度报告

月报由真实月度汇总、分类比较和代表性交易确定性生成。有可计算结余率时，评分为 `clamp(round(结余率 + 37), 0, 100)`；75 分及以上为“稳健”，55 至 74 分为“平衡”，其余为“需关注”。没有收入时评分不可计算，不使用默认分数代替。

最大节省只从变化率小于零的可比分类中选择，最大增长只从变化率大于零的可比分类中选择；先按变化率幅度排序，再按收支绝对差排序，最后按分类 ID 排序。故事使用固定模板及固定金额格式，所有规则集中在领域层并有直接测试。

出现以下情况时诚实降级：

- 本期没有有效收支。
- 本期没有收入，无法计算结余率评分。
- 上期没有可比收支。
- 某分类上期为零，无法形成百分比变化。

评分、亮点和故事不得与同一响应中的汇总值矛盾。

## 9. 错误契约

错误使用 `application/problem+json`，包含：

- `code`：稳定、可供前端分支处理的错误码
- `title`：简短错误类别
- `detail`：可展示说明
- `fieldErrors`：字段错误列表
- `requestId`：日志关联 ID
- `retryable`：当前错误是否适合原请求重试

状态码约定：

- `400`：JSON、头部或查询参数格式错误
- `404`：资源不存在
- `409`：修订冲突、幂等键冲突、撤销过期或业务状态冲突
- `422`：字段或领域规则不合法
- `503`：数据库暂时不可用

数据库内部错误、SQL、连接地址和堆栈不得出现在客户端响应中。

## 10. 前端接入与状态一致性

前端以异步 `FinanceApi` 替换现有交易和标签 `localStorage Repository`。财务数据不再写入或读取 `localStorage`；旧键既不导入，也不参与初始化判断。

### 10.1 初始化与查询

- 应用启动通过 `bootstrap` 建立分类、账户、月份和修订上下文。
- 失败时保留页面框架并提供唯一重试操作，不回退到浏览器演示数据。
- 月份和分析范围快速变化时取消旧请求或通过请求序号丢弃旧响应。
- 聚合响应携带数据修订号，低于当前已知修订号的响应不能覆盖新状态。
- 局部查询失败只替换对应面板，并明确标记最后确认数据可能已过期。

### 10.2 保存

- 打开抽屉时生成幂等键，同一次保存失败后继续使用该键。
- 请求期间保留输入并阻止同一提交重复触发。
- 服务端成功后才更新前端交易状态。
- 普通保存成功后关闭抽屉。
- “保存并继续”成功后保留类型和日期时间，清空金额、名称和备注，并生成新幂等键。
- 字段错误聚焦首个错误控件；服务错误保留全部草稿。

### 10.3 删除、恢复和标签修改

- 删除成功后才隐藏交易，倒计时使用服务端 `undoUntil`。
- 恢复成功后才重新显示交易。
- 截止前的临时失败使用原令牌重试；服务端确认过期后结束撤销状态。
- 标签修改只在服务端成功后提交到 UI。
- `revision_conflict` 触发相关数据刷新并提示本次操作未生效，不做本地猜测性合并。

前端继续自行管理抽屉未保存确认、焦点陷阱、焦点归还、筛选控件、滚动恢复和可访问反馈。

## 11. 静态资源与运行行为

- `/api/v1/*` 只匹配 API，不得回退到 HTML。
- 前端静态资源来自配置的 `frontend/dist` 目录。
- 未匹配且接受 HTML 的前端路由回退到 `index.html`。
- 哈希静态资源使用长期不可变缓存；`index.html` 禁止长期缓存。
- 静态资源目录缺失时服务启动失败，并给出明确配置错误。
- 生产环境前后端同源，默认不开启 CORS。
- Vite 开发环境通过开发代理访问 API。
- 服务默认监听 `127.0.0.1`；开放到其他地址必须显式配置。
- Axum 使用优雅停机，停止接收新请求后等待在途请求完成。

## 12. 配置、日志与安全边界

核心配置包括：

- `DATABASE_URL`
- `BIND_ADDR`
- `FRONTEND_DIST_DIR`
- 数据库连接池最小和最大连接数
- 数据库连接与获取超时
- HTTP 请求超时
- 请求体大小上限
- 日志级别

配置只从环境读取，提供不含密钥的示例文件。缺少必填项或配置非法时启动失败。

每个请求生成或透传请求 ID。结构化日志只记录路由模板、方法、状态码、耗时、错误码和请求 ID，不记录交易名称、备注、完整请求体、幂等键、删除令牌或数据库凭据。

本期无鉴权，因此默认回环监听是安全边界的一部分。若部署者显式开放到局域网或公网，必须在文档中警告该服务没有访问控制。

## 13. 测试与质量门禁

### 13.1 后端测试层次

- 领域单元测试：金额、日期范围、月份、周末、交易、标签、分析和报告规则。
- 应用用例测试：使用可控时钟和仓储替身验证事务编排、幂等、修订冲突、删除恢复和失败回滚。
- PostgreSQL 集成测试：使用真实 PostgreSQL 验证迁移、索引、外键、检查约束、精确金额、仓储和事务，不使用 SQLite 替代。
- Axum API 测试：通过进程内 Router 和真实 PostgreSQL 验证完整请求、响应、状态码与持久化结果。
- 前后端集成测试：使用真实 Provider、真实 HTTP API 和真实 PostgreSQL 覆盖跨页面行为。

### 13.2 必测边界

- `+14:00`、负时区、跨日、月末、跨年、闰年和周末判断。
- `0.01`、最大金额、零值、负值、超精度和非法金额。
- 相同幂等键串行及并发提交只生成一笔交易。
- 幂等键复用到不同请求时返回冲突。
- 旧修订号写入不改变数据。
- 分类迁移任一步失败时完全回滚。
- 删除窗口截止前后、删除重试和连续删除。
- 种子初始化失败回滚，多次启动不重复种子。
- 历史不足时不生成虚假趋势、增长率、洞察或评分。
- 未迁移数据库、待迁移数据库和版本不兼容数据库均拒绝启动。
- `migrate` 可重复执行，并发迁移由锁串行化。
- `serve` 的任何启动路径都不执行 DDL。

### 13.3 门禁

合入或交付前必须通过：

- Rust 格式检查。
- 严格 Clippy，警告作为错误。
- 后端单元测试和真实 PostgreSQL 集成测试。
- 后端 `domain` 与 `application` 行覆盖率不低于 90%。
- 现有前端 TypeScript 严格检查、完整测试和生产构建。
- 现有前端 `src/domain` 与 `src/app` 行覆盖率继续不低于 90%。
- Rust release 构建和完整静态资源集成构建。

浏览器双视口、键盘、控制台和打印预览验收只使用 Chrome DevTools MCP，不使用 Chrome CLI、CDP、curl、Playwright 或其他浏览器替代方案。

## 14. 交付物

最终实现应交付：

- `backend/` 下完整 Rust 后端工程。
- SeaORM 实体、仓储和显式迁移命令。
- PostgreSQL schema、索引和幂等演示种子。
- Axum API、静态资源服务、健康检查和优雅停机。
- 后端配置示例、运行说明和本地容器编排。
- 后端单元、集成和 API 测试及覆盖率门禁。
- 前端 API 适配与现有业务选择器的服务端迁移。
- 更新后的前端测试、跨页面集成测试和生产构建。

本规格只定义设计，不包含实现代码。进入实现前，应根据本规格另行编写逐任务实现计划。

## 15. 参考依据

- Axum 0.8 Router 状态、提取器、中间件和优雅停机文档。
- SeaORM 1.1 PostgreSQL 连接、事务和迁移文档。
- PostgreSQL 当前版关于精确数值、日期时间、约束、外键和索引的文档。
