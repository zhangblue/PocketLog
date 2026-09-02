# 前端数据加载与测试稳定性设计

## 目标

消除测试对宿主日期的隐式依赖，避免筛选与分页触发重复 bootstrap 请求，并确保首次加载期间不展示样例账本数据。

## 设计

- 测试环境统一冻结系统时间为 `2026-08-18T12:00:00+08:00`。生产代码继续以用户本地当前月份初始化。
- `FinanceProvider` 的 bootstrap effect 只依赖 API 实例；筛选、月份和分页分别由其已有的交易、总览、分析和报告 effect 负责刷新。
- 初始状态的交易、分类和账户均为空。页面已有的异步面板在 bootstrap 完成前显示加载态，成功后以 API 返回值填充状态。
- 前端 README 与根 README 保持一致，说明开发代理、API 前缀与 PostgreSQL 持久化边界。

## 验收标准

- 在任意宿主日期运行，前端测试均使用固定的八月样例月份。
- 变更筛选或请求下一页交易不会再次调用 bootstrap。
- 初始加载时不含任何样例交易，bootstrap 成功后才展示服务器数据。
- `npm --prefix frontend run check` 与 `npm --prefix frontend run build` 通过。
