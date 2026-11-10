# 交通智问 · 独立部署版

本版本可部署到 Render 或提供 Node.js 24 的云主机，不依赖 chatgpt.site 的访问入口。源码仓库为 https://github.com/syc-sldx/traffic-smart-qa 。源码上传不等于网站上线；需要在 Render 完成部署后才能取得和测试新网址。

保留公开网页、年度数据、历史客流、知识检索、地图服务和模型分析。数据直接取自已发布云端版本的快照与年度整理文件，包含 167 条年度数值及其原单位、来源与核验标签。不会把年度汇总混作每日观测。旧平台的私人报告及用户身份不随迁移复制。

## 运行

需要 Node.js 24。安装与构建：

```sh
npm ci --include=dev
npm run build
npm test
npm start
```

默认监听 `0.0.0.0:10000`，使用 `PORT` 指定端口。`GET /healthz` 是健康检查。分发包已包含编译后的 `runtime.mjs`，直接 `node runtime.mjs` 即可运行，不需要安装运行时依赖。

环境变量：

| 名称 | 用途 |
| --- | --- |
| `DATABASE_PATH` | SQLite 文件路径，默认 `./data/traffic.db`；需要保留报告时应放在持久化磁盘上 |
| `LLM_API_KEY` | 模型密钥，仅在服务端配置 |
| `LLM_BASE_URL` | 默认 `https://api.deepseek.com` |
| `LLM_MODEL` | 默认 `deepseek-flash` |
| `AMAP_API_KEY` | 高德 Web 服务密钥 |
| `TRUST_PROXY_HOPS` | 受信任的反向代理层数，默认 0；直连不要信任客户端提交的转发地址 |

支持使用 `node --env-file=.env runtime.mjs` 读取自行配置的本地环境文件。分发包不包含密钥，已有密钥不会写入 GitHub。

## Render 发布参数

仓库根目录已提供 `render.yaml`。可通过 https://dashboard.render.com/blueprint/new?repo=https://github.com/syc-sldx/traffic-smart-qa 创建部署。它配置了新加坡区域的免费 Web Service、Node.js 24、构建与接口测试、启动命令和 `/healthz` 健康检查。模型和地图密钥在 Render 私密输入框填写，不写入仓库。

免费实例闲置后会休眠，唤醒需要等待；不提供持久化磁盘，重启后内置数据可重建，但新生成的报告会丢失。需要长期保存报告时再选择带持久化存储的部署。配置默认不信任客户端提交的转发地址；若部署平台将全部请求代理到同一个地址，需在核对其转发规则后调整 `TRUST_PROXY_HOPS`，否则访客可能共用每分钟 30 次的查询额度。

新平台是否可从用户网络访问，必须在发布后重新实测，不能仅根据部署成功认定手机已能打开。

## 访问与数据

首页和查询接口无需登录。对话历史保存在浏览器会话；报告需要各自的随机访问凭证，数据库只保存凭证哈希。每个来源地址每分钟最多 30 次有效提问，超过返回 429。数据库自动执行已有迁移并初始化内置快照；重复启动不覆盖报告和已初始化的数据。
