# 前端数据加载与测试稳定性实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 修复前端测试的日期脆弱性与数据加载竞态，并使文档与 PostgreSQL 架构一致。

**架构：** 测试在全局 setup 固定时间，生产状态继续使用真实本地时间。Provider 将初始化账本元数据的 bootstrap 请求与交易筛选、分页请求解耦；页面在 API 数据到达前仅使用空状态和加载面板。

**技术栈：** React 19、TypeScript、Vitest、Vite。

---

## 文件与职责

- 修改：`frontend/src/test/setup.ts`，固定测试运行时的系统时间。
- 修改：`frontend/src/app/FinanceProvider.test.tsx`，覆盖筛选不会重新 bootstrap 的回归行为。
- 修改：`frontend/src/app/financeReducer.test.ts`，覆盖初始状态不携带样例交易。
- 修改：`frontend/src/app/FinanceProvider.tsx`，收紧 bootstrap effect 的依赖并移除样例交易初值。
- 修改：`frontend/src/app/financeReducer.ts`，以空集合创建生产初始数据状态。
- 修改：`frontend/README.md`，更新持久化与开发说明。

### 任务 1：先固定测试时钟并补充 Provider 回归测试

- [ ] 在 `setup.ts` 的每个测试开始前调用 `vi.useFakeTimers()` 与 `vi.setSystemTime(new Date('2026-08-18T12:00:00+08:00'))`。
- [ ] 在 `FinanceProvider.test.tsx` 创建真实 fixture API 的 bootstrap 计数包装器；加载 Provider 后更改筛选，断言 bootstrap 只调用一次。
- [ ] 运行：`npm --prefix frontend exec vitest run src/app/FinanceProvider.test.tsx`。
- [ ] 预期：新增断言在现有 bootstrap effect 依赖下失败。

### 任务 2：移除生产初始样例数据

- [ ] 在 `financeReducer.test.ts` 断言 `createInitialFinanceState(new Date('2026-08-18T12:00:00+08:00'))` 的交易、分类和账户数组为空。
- [ ] 运行：`npm --prefix frontend exec vitest run src/app/financeReducer.test.ts`。
- [ ] 预期：断言因当前样例初始值而失败。
- [ ] 将 `createInitialFinanceState` 的三个初始集合改为 `[]`；保留 API 成功后更新状态的 reducer 分支。

### 任务 3：解耦 bootstrap 与筛选及分页

- [ ] 从 `FinanceProvider.tsx` 删除 `sampleTransactions` 导入与 Provider 初始化时对其的覆盖。
- [ ] 将 bootstrap effect 的依赖数组收紧为 `[activeApi]`；显式重试仍经由 `retryDataLoad` 替换或触发 bootstrap。
- [ ] 运行两个任务中的定向测试，确认它们通过。

### 任务 4：更新文档并完成验证

- [ ] 把 `frontend/README.md` 的 localStorage 描述替换为 Vite 开发代理、`/api/v1` 和 PostgreSQL 持久化说明。
- [ ] 运行：`npm --prefix frontend run check`。
- [ ] 运行：`npm --prefix frontend run build`。
- [ ] 运行：`cargo test --manifest-path backend/Cargo.toml --lib`。
