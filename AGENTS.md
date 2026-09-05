# AGENTS.md — Sparo（30 秒）

You are controlling **Sparo**: a local AI work browser.

Tagline: *会动手的 AI 浏览器 — 发送前你确认。*

**先读这些，不要扫整个 `src/`：**

| 文档 | 干什么 |
|---|---|
| 本文 | 30 秒路径、禁区 |
| [docs/INSTALL.md](./docs/INSTALL.md) | 人下载安装包 / 复制给 AI 自动装 |
| [docs/CLOUD-SUBSCRIPTION.md](./docs/CLOUD-SUBSCRIPTION.md) | 云订阅 M1：计量、客户端、验收、禁区 |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | 模块、侧栏闭环、页面洞 |
| [docs/PRODUCT-TASKBOOK.md](./docs/PRODUCT-TASKBOOK.md) | 现行任务、QA、待办（v0.3.5） |
| [CHANGELOG.md](./CHANGELOG.md) | 对外变更（现 0.1.15） |
| [docs/PRODUCT.md](./docs/PRODUCT.md) | 商店定位，不是任务书 |

数据在 `%APPDATA%\sparo-store`。MCP：`http://127.0.0.1:3921`。  
云端模型走独立代理服务（本仓库不含密钥）。**不要**把云端 Key 写进客户端。  
不要改 `docs/listings/`（提审前另做一轮）。主进程不热更。安装包不会自动更新。

## Fast path

Human: double-click `Sparo-Setup.exe`, then open Sparo from the Desktop. See [docs/INSTALL.md](./docs/INSTALL.md). Never tell them to use a terminal.

Developer:

```text
1. npm run start          — debug
2. npm run dist           — Windows installer + portable exe in release\
3. Optional MCP: GET http://127.0.0.1:3921/health
```

## Publish

AI detects stage; scripts inject title/body once. Never loop `fill`.

```text
run_skill({ query: "发小红书", params: { title, body, summary?, topics? } })
# or the 发布 button
```

See `docs/PUBLISHING.md`. Unknown forms: **填表** or `analyze_page` → `execute_primitives`.  
CS: **回复** fills draft only; human clicks send.  
Life query: 侧栏原句（打开站点 + 后半句；酒店/机票/火车/路线走结果页 URL）。读页用 `page_text`。  
多步日常（比价 / 调研 / 出差 / 挂号）：`parseMission` / `parseTripPlan`，禁止直开京东/淘宝/点评。  
云端模型：设置里「自己的 Key / 云端模型」；一句对话一个 `task_id`。见 `docs/CLOUD-SUBSCRIPTION.md`。

## Anti-patterns

- Looping `fill` on Xiaohongshu title/body
- Putting cloud model keys in the client, or counting each HTTP call as one “task”
- Shipping store-channel builds that mention prices / payment UI
- Telling end users to `npm run start`
