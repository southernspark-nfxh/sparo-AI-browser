# AGENTS.md — Sparo（30 秒）

You are controlling **Sparo**: a local professional agent in a work browser.

Tagline: *会动手的 AI 浏览器 — 发送前你确认。*

**先读这些，不要扫整个 `src/`：**

| 文档 | 干什么 |
|---|---|
| 本文 | 30 秒路径、禁区 |
| [docs/INSTALL.md](./docs/INSTALL.md) | 人下载安装包 / 复制给 AI 自动装 |
| [docs/CLOUD-SUBSCRIPTION.md](./docs/CLOUD-SUBSCRIPTION.md) | 云订阅：计量、客户端、验收、禁区 |
| [docs/PRICING.md](./docs/PRICING.md) | 点数货架（v4） |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | 模块、侧栏闭环、页面洞 |
| [docs/AI-LEARNING.md](./docs/AI-LEARNING.md) | 卡住就问、经验只留本机 |
| [docs/SKILL-COMMUNITY-M2.md](./docs/SKILL-COMMUNITY-M2.md) | 技能社区（**未开工**，M1 人测过完再开） |
| [docs/SKILL-FORMAT.md](./docs/SKILL-FORMAT.md) | 技能包命名与字段（本机 `run_skill`，以后才分享） |
| [docs/PRODUCT-TASKBOOK.md](./docs/PRODUCT-TASKBOOK.md) | 现行任务、QA、待办（v0.3.5） |
| [CHANGELOG.md](./CHANGELOG.md) | 对外变更（现 0.1.17） |
| [docs/PRODUCT.md](./docs/PRODUCT.md) | 商店定位，不是任务书 |

**此后主线就在本目录改。** 原版 `D:\download\Sparo`（3920 / `%APPDATA%\sparo`）只同步侧栏能力，不要把云订阅搬过去。

数据在 `%APPDATA%\sparo-store`。MCP：`http://127.0.0.1:3921`。  
云端模型走独立代理服务（本仓库不含密钥）。**不要**把云端 Key 写进客户端。  
不要改 `docs/listings/`（提审前另做一轮）。主进程不热更。安装包不会自动更新。

## Fast path

Human: double-click `Sparo-Setup.exe`, then open Sparo from the Desktop. See [docs/INSTALL.md](./docs/INSTALL.md). Never tell them to use a terminal.

Developer:

```text
1. npm run start          — debug
2. npm run dist           — Windows installer in release\Sparo-Setup.exe
3. Optional MCP: GET http://127.0.0.1:3921/health
```

**改完先自己 QA，再让人验收。** 侧栏按钮必须自己点通：点得到、下一步在原地出现、控制台无报错。不要把「看起来像按钮」的半成品丢给用户当测试员。

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
侧栏每一句先进工作单：**有未关的单就续跑**；新开时模型只填槽，不能选 ask。缺的是合法空槽才问；省名先出思路再动手；吃喝玩接上一趟；「我打算」不是城。  
**死规则：** 多种信息调研（比价 / 选品 / 筛选 / 对比 / 研报）必须出报告页并在窗口打开，侧栏只留一句 + 卡片。禁止把对照表堆进聊天框。不要点进一堆详情循环。吃喝玩不是筛选报告。  
识图：侧栏粘贴/拖图；`screenshot` 回 base64。纯文本模型降级省略附图。见 [docs/VISION.md](./docs/VISION.md)。  
云端模型：设置里「自己的 Key / 云端模型」；一句对话一个 `task_id`。已登录后点套餐在本窗口付款，不要再甩到 Chrome。见 `docs/CLOUD-SUBSCRIPTION.md`。

## Anti-patterns

- Looping `fill` on Xiaohongshu title/body
- Putting cloud model keys in the client, or counting each HTTP call as one “task”
- Shipping store-channel builds that mention prices / payment UI
- Telling end users to `npm run start`
- 改完侧栏/引导就喊人测；自己没点过的按钮不要当完成
