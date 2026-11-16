# 知页 · 独立文档问答网站

这个目录是可独立部署的完整项目，与仓库根目录的交通问答项目分开。页面和问答 API 由一个 Node.js 服务提供，不依赖 Sites、ChatGPT 登录、Cloudflare Workers 或 D1。

## 本地运行

需要 Node.js 24.22.1 或更新的 24.x 版本。首次执行 npm ci 安装文档解析库，无需前端构建。既有 Render 的 npm test 构建命令会按锁文件自动准备缺失的依赖。

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

支持各种纯文本（TXT、Markdown、CSV、TSV、JSON/JSONL、XML、YAML、TOML、INI、日志、字幕、代码、无后缀文本），并提取 PDF、Word DOC/DOCX、RTF、HTML、EPUB、ODT/ODS/ODP、XLSX、PPTX 的文字。自动识别 UTF-8、UTF-16/32、GB18030 及常见旧编码；建议有条件时保存为带 BOM 的 Unicode 或 UTF-8。文件上限 8 MB，提取文字仍限 24,000 字符，不静默截断。

密钥仅在后端读取；文档和对话仅保留在当前页面内存，请求时发送至 DeepSeek，不存入数据库。SQLite 只存全站累计次数。每分钟最多 5 次、每天最多 100 次模型请求，按北京时间零点换日；失败或停止的调用也计数。

默认 SQLite 路径为 `.data/usage.sqlite`，可通过 `DATABASE_PATH` 修改。**Render 免费实例的文件系统不持久，休眠、重启或重新部署会重置计数；这些限额不构成严格的费用上限。** 如需跨重启保持计数，可改用持久磁盘或外部数据库。免费实例闲置后会休眠，再次访问可能需要等待唤醒。

官方说明：[GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)、[Render 免费实例限制](https://render.com/docs/free)。

复杂文档在独立 Worker 中解析，限制为同时 1 个、20 秒超时、受限内存；ZIP 容器检查解压体积和文件数量，不获取远程资源、不执行宏或脚本。文档中的图表/排版仅提取可读文字，不还原页面外观。扫描 PDF 需要先做 OCR；加密文档需先解密；旧 XLS/PPT 需转为 XLSX/PPTX。损坏、未知二进制、压缩包和超限文件会明确报错。

解析库参考：[officeParser](https://github.com/harshankur/officeParser)、[word-extractor](https://github.com/morungos/node-word-extractor)。
