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
| [docs/MULTI-ACCOUNT.md](./docs/MULTI-ACCOUNT.md) | 多账号环境：同站点同时登多个号 |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | 模块、侧栏闭环、页面洞 |
| [docs/AI-LEARNING.md](./docs/AI-LEARNING.md) | 卡住就问、经验只留本机 |
| [docs/SKILL-COMMUNITY-M2.md](./docs/SKILL-COMMUNITY-M2.md) | 技能社区（**未开工**，M1 人测过完再开） |
| [docs/SKILL-FORMAT.md](./docs/SKILL-FORMAT.md) | 技能包命名与字段（本机 `run_skill`，以后才分享） |
| [docs/THREE-CHANNEL-DESIGN.md](./docs/THREE-CHANNEL-DESIGN.md) | 三通道架构（**设计稿，未开工**，评审后按分期落地） |
| [docs/PRODUCT-TASKBOOK.md](./docs/PRODUCT-TASKBOOK.md) | 现行任务、QA、待办（v0.3.7） |
| [docs/DECISION-POINTS.md](./docs/DECISION-POINTS.md) | 能提前结束任务的本地判断，先登记再合码 |
| [docs/QA-GOLDEN-SCENARIOS.md](./docs/QA-GOLDEN-SCENARIOS.md) | 黄金场景，用底账核对，不看侧栏感觉 |
| [CHANGELOG.md](./CHANGELOG.md) | 对外变更（现 0.3.2） |
| [docs/PRODUCT.md](./docs/PRODUCT.md) | 商店定位，不是任务书 |

**此后主线就在本目录改。** 原版 `D:\download\Sparo`（3920 / `%APPDATA%\sparo`）只同步侧栏能力，不要把云订阅搬过去。

**称呼：** 对人、对界面、对模型说「技能」。不要说「妙招」。工具名仍是 `match_skill` / `run_skill`。店小秘采集箱上品前编辑用技能 `dxm-crawl-prep`。

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

## 多账号（2026-11-12 起）

同一站点可同时登录多个号：每个环境一套独立 Chromium partition（Cookie / localStorage / IndexedDB / 缓存互不可见），不是切换登录态。

- 人：**设置 → 账号**，新建 / 打开 / 删除环境；每个环境各登各的号。
- Agent：`list_envs` 拿 `envId` → `navigate({ url, envId })` / `new_tab({ url, envId })`；技能用 `run_skill({ query, params: { envId } })`。不传 `envId` = 默认登录态。
- 环境标签会认领给发起调用的 client，后续不带 `tabId` 的 click / fill / execute 仍停在这个号里。
- 细节见 [docs/MCP-API.md](./docs/MCP-API.md#多账号环境account-envs) 与 [docs/MULTI-ACCOUNT.md](./docs/MULTI-ACCOUNT.md)。

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
任务循环（0.1.19 起）：新任务先出**解题思路卡**，用户确认才开工。长采集滚动翻页时 `page_text` 从第二次起带「较上次 +N 字」，+0 就换策略，不连按同一个键。**关单必有声**：必交付没齐、计划采集步没跑完，不许假 done——只开站 / 没要求读页 / 登录落地三条早退都过同一套清点，缺什么侧栏说人话。挂起任务问「要不要打开 / 换个入口」时，回「打开 / 好 / 继续 / 换个入口」就接回续跑。计划里还有未完成步骤时，「继续」接着做，不再重问要不要打开站点。  
「打开的 / 了 / 着 / 过」是状态，不是开站指令。多步计划，或要读页、出报告、填表时，必须进循环。火车、机票、酒店同一能力有多段时，一条发现只抵一段，缺段单列。填表只认回执或读回有字。没说自动发时只填草稿。五分钟没有新进展先换策略，再不行说人话关单。  
**死规则：** 多种信息调研（比价 / 选品 / 筛选 / 对比 / 研报）必须出报告页并在窗口打开，侧栏只留一句 + 卡片。禁止把对照表堆进聊天框。不要点进一堆详情循环。吃喝玩不是筛选报告。后台调研在最小化时继续跑。填表、发帖、采集、出报告都不把窗口拉回前台，完成只闪任务栏，出报告只切标签。  
识图：侧栏粘贴/拖图；`screenshot` 回 base64。纯文本模型降级省略附图。见 [docs/VISION.md](./docs/VISION.md)。  
云端模型：设置里「自己的 Key / 云端模型」；一句对话一个 `task_id`。已登录后点套餐在本窗口付款，不要再甩到 Chrome。见 `docs/CLOUD-SUBSCRIPTION.md`。

## Anti-patterns

- Looping `fill` on Xiaohongshu title/body
- Putting cloud model keys in the client, or counting each HTTP call as one “task”
- Shipping store-channel builds that mention prices / payment UI
- Telling end users to `npm run start`
- 改完侧栏/引导就喊人测；自己没点过的按钮不要当完成
- 新增会提前结束任务、绕过脑区或改走向的本地判断，却没先写进 `docs/DECISION-POINTS.md`
- 用单测绿代替黄金场景；重打包前不跑受影响场景。安装包至少复测 G1、G2、G3（见 `docs/QA-GOLDEN-SCENARIOS.md`）
- 想靠「切登录态」在同一个标签里换账号（应建账号环境，见 `list_envs` 与 [docs/MULTI-ACCOUNT.md](./docs/MULTI-ACCOUNT.md)）
- 给环境标签的 `WebContentsView` 顶层传 `session`（会被 Electron 静默忽略、退回共用登录态；必须走 `webPreferences.partition`）
