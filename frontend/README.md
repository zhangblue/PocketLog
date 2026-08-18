# 栖账

一个帮助个人快速记录收支、理解消费趋势并回顾月度变化的桌面端记账 Web UI。

## 运行

需要 Node.js 与 npm。

```bash
npm install
npm run dev
```

开发服务器启动后，在浏览器中打开命令行显示的本地地址。

## 检查与构建

```bash
npm run check
npm run build
```

## 本地数据

交易、分类和账户标签仅保存在当前浏览器的 `localStorage` 中。清除浏览器站点数据会移除本地记录；应用未连接远程账户或同步服务。
