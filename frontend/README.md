# 栖账

一个帮助个人快速记录收支、理解消费趋势并回顾月度变化的桌面端记账 Web 应用。

## 运行

需要 Node.js、npm、Rust 与 PostgreSQL。前端开发服务器会将 `/api` 和 `/health` 代理至后端；可通过 `VITE_BACKEND_ORIGIN` 指定后端地址。

```bash
npm --prefix frontend install
npm --prefix frontend run dev
```

开发服务器启动后，在浏览器中打开命令行显示的本地地址。

## 检查与构建

```bash
npm --prefix frontend run check
npm --prefix frontend run build
```

## 数据与后端

交易、分类、账户标签和自定义图标均通过 `/api/v1` 写入 PostgreSQL；浏览器不使用 `localStorage` 作为账本数据源。首次运行请在项目根目录按照 `migrate → init → demo → serve` 的顺序初始化后端，完整部署说明见根目录 [README](../README.md)。
