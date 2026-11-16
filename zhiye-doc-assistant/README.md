# 知页 · 独立文档问答网站

这个目录是可独立部署的完整项目，与仓库根目录的交通问答项目分开。页面和问答 API 由一个 Node.js 服务提供，不依赖 Sites、ChatGPT 登录、Cloudflare Workers 或 D1。

## 本地运行

需要 Node.js 24 或更新版本。无第三方运行依赖，无前端构建步骤。

1. 复制 `.env.example` 为 `.env`，填写 `LLM_API_KEY`。
2. 执行 `npm start`，打开 `http://localhost:8000`。
3. 执行 `npm test` 验证文档、流式转发、限额与真实 HTTP 路由。测试不调用外部模型。

## 部署到 Render

新建一个独立 Web Service，源仓库使用本仓库，选择包含本目录的分支：

- Runtime：Node
- Build command：`cd zhiye-doc-assistant && npm test`
- Start command：`cd zhiye-doc-assistant && npm start`
- Plan：Free
- Node version：24.22.1
- 可用健康检查地址：`/api/health`

在服务的环境变量中设置 `LLM_API_KEY`、`LLM_BASE_URL=https://api.deepseek.com` 和 `LLM_MODEL=deepseek-flash`。真实密钥不应提交到 GitHub。`PORT` 由平台注入，服务监听 `0.0.0.0`。

同一个服务托管页面与 API，无跨站接口依赖；普通浏览器直接打开服务 URL 即可。GitHub Pages 只能托管静态文件，不能代替这里的后端。

## 功能与数据

支持 TXT/Markdown 上传、UTF-8/GB18030 解码、原文行号、多轮对话、流式回答、停止生成和复制。文档最多 24,000 字符 / 256 KB。

密钥仅在后端读取；文档和对话仅保留在当前页面内存，请求时发送至 DeepSeek，不存入数据库。SQLite 只存全站累计次数。每分钟最多 5 次、每天最多 100 次模型请求，按北京时间零点换日；失败或停止的调用也计数。

默认 SQLite 路径为 `.data/usage.sqlite`，可通过 `DATABASE_PATH` 修改。**Render 免费实例的文件系统不持久，休眠、重启或重新部署会重置计数；这些限额不构成严格的费用上限。** 如需跨重启保持计数，可改用持久磁盘或外部数据库。免费实例闲置后会休眠，再次访问可能需要等待唤醒。

官方说明：[GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)、[Render 免费实例限制](https://render.com/docs/free)。
