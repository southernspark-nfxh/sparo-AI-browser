# Sparo 商店版 — 代码结构

会动手的 AI 浏览器。人机同窗；发送 / 付钱由人点。  
产品文案：[PRODUCT.md](./PRODUCT.md) · 现行任务：[PRODUCT-TASKBOOK.md](./PRODUCT-TASKBOOK.md)

数据在 `%APPDATA%\sparo-store`，MCP 监听 **127.0.0.1:3921**（原版是 3920 / `%APPDATA%\sparo`）。

```
┌──────────────────────────────────────────────┐
│                 Electron 窗                   │
│                                              │
│  ┌────────────┐     ┌─────────────────────┐  │
│  │ Renderer   │     │ Main                │  │
│  │ shell.html │◄───►│ browser.ts          │  │
│  │ 标签+侧栏  │     │  handleChat 队列    │  │
│  └────────────┘     │         │           │  │
│                     │  kernel 推理下一步   │  │
│                     │  runtime / slots     │  │
│                     │  travel / trip-plan  │  │
│                     │  mission（日常多步） │  │
│                     │  report-html 手册    │  │
│                     │  cloud/* 配额闸门   │  │
│                     │         │           │  │
│                     │  tools/index.ts     │  │
│                     │  mcp-server.ts      │  │
│                     └─────────┬───────────┘  │
└───────────────────────────────┼──────────────┘
                                │ HTTP :3921/mcp
                       ┌────────▼────────┐
                       │ Cursor / Hermes │
                       │ 或侧栏本机模型  │
                       └─────────────────┘
  llmMode=cloud → sparo-pay :3940（JWT + X-Sparo-Task，真 Key 不下发）
```

## 启动（`src/main/index.ts`）

1. `app.setName("Sparo")`，用户目录指向 `sparo-store`。
2. 建共享 Chromium 窗（`createBrowser` + `shell.html`）。
3. 工具表 `createToolHandlers` → MCP。
4. MCP 听 `127.0.0.1:3921`，把 `{ endpoint, token }` 写到 `%APPDATA%/sparo-store/mcp-auth.json`。

开发：`npx electron-vite dev -- --remote-debugging-port=9333`。主进程不热更，改 `browser.ts` / `mission.ts` 后要重启。桌面安装包不会自动吃到源码，测布局用开发窗。

## 网页必须铺满「页面洞」，也不能盖住顶栏

页面视图是盖在壳层上面的 `WebContentsView`。洞太窄时，左上角会露出半截导航；洞被拉成整窗时，标签栏、地址栏和侧栏会被盖住，只剩系统按钮。

`shell.html` 用 `ResizeObserver` 上报 `#pageHole` → `spark:page-hole` → `setPageHoleBounds`。视图的 y 不低于顶栏（76px），宽度是窗口宽减去侧栏。新建标签先写成页面洞再挂上。加载之后，以及视图尺寸变化时，若发现它盖住顶栏或侧栏，按页面洞拉回（`page-bounds.ts`）。2026-10-27 起这道守卫常驻比对页面洞，大约每 2 秒看一次活跃视图；修过几次也不再永久放弃，预算只做限频。后台标签移到 `x: -20000`。最大化也要重排。

## 侧栏一句话怎么走

```text
用户原话
  → kernel 入句分类：新开 / 续跑 / 补槽 / 改需求 / 取消 / 旁路读页
  → 工作单：blocked(合法空槽) | propose(省名拆城) | running
  → 推理器每次只决定下一步（看见观察再改路）；有模型时自己写下一步，本地只校验合法 cap / 站点
  → 能力表执行一手，回报 finding
  → 契约验收：齐了才合成手册。酒店页语义交给模型，付钱/登录仍由人点
  → 学习层挂当前 step，不关单
```

上一句没写完手册，下一句进 `chatQueue`，避免把手册写脏。

任务和标签绑在一起：后台任务用 `createAgentTab` 自己的标签，工具调用带 `tabId`，不再跟用户正看着的那一页。`TaskPool` 同时最多跑 3 个后台任务，前台任务独占一条。满了的后台任务进入 `queued`，不把池满当成提交失败。最小化时壳层不节流。填表、发帖、采集、出报告和网页弹窗都不把窗口拉回前台，完成只 `flashFrame`，出报告只 `switchTab`。

## 指挥室、租约和四色（1.00）

指挥室是 `kind: "command"` 的壳层标签。它没有 `WebContentsView`，不进网页休眠，也不能被任务占用。每扇窗口一个入口；总览、父任务组和总指挥聊天是同一份，侧栏会话按这扇窗口自己的活动页路由。

页面 lease（`src/main/agent/page-lease.ts`）按 `tabId + taskId + clientId` 占用，账号环境记 `envId`。分配入口是 `allocateClientTab`。新任务不指定页就另开标签。指定的页已有租约、未结束任务或未解除的归属时返回 `tab_busy`。状态投影在 `src/main/agent/task-state.ts`：排队和进行中为绿，等待人工为黄，失败为红，完成、停止和无任务为灰。灰不表示可以复用。

会话 key：总指挥 `command`，空闲页 `page:<tabId>`，任务 `tabId + taskId`。完成保留结果卡和双位置提醒；点提醒走 `focusTask`，不新建页面。知悉只消提醒。验收或明确结束才释放租约。壳层状态推送只发 `spark:chrome-state`，不 `focus`、不 `show`。

重启读 `agent-task-summaries.json` 里 `schema: 1` 的行。排队和进行中恢复成失败并写明应用中断，不自动接着跑。没有 schema 的旧摘要留在文件里，不当成新任务。

2026-10-31 起，`click`、`click_text`、`menu_click`、`snapshot` 若发现窗口已最小化或客户区过小，会先把窗口放到屏幕外并保持正常宽高（`agent-viewport.ts`），不 `focus`。坐标为负就拒绝点击。`fill` 和页面内赋值不走这条路径。对人说「技能」，不要说「妙招」。

关单照流水对计划步。火车、机票、酒店同一能力有多段时，一条成功发现只抵一段，缺段写进「还缺」，没跑完的步骤不涂成完成。填表只认发布回执或读回有字。没说自动发时，发布只填草稿。五分钟没有新进展先换策略，再不行说人话关单。「打开的 / 了 / 着 / 过」是状态，不是开站指令。这些判断的登记册是 [DECISION-POINTS.md](./DECISION-POINTS.md)。

## 壳层自愈与技能播种（0.6.4–0.7.4）

壳层白屏三轮收口，都在主进程，不靠人最小化/最大化：

- **0.6.4**：看门狗。壳层心跳停 3 拍自动重启壳层渲染进程；窗口在前台时卡死约 1–2 秒恢复（后台窗口按设计不救）。
- **0.7.2**：壳层永不开后台节流，关掉 Windows 原生遮挡判定——最小化/还原不再把壳层判成「被盖住」而停帧。
- **0.7.3**：侧栏打字不抢焦点。覆盖自愈加退避（重挂仍不收敛就停手）、打字时不摘挂网页视图、摘挂后把焦点还回输入框。真机 CDP 打字采样 lost=0；**真实低速输入法打满 60 秒至今未测**（QA 0.7.4 记录）。

技能怎么进包：`strategies/skills/**` 打进 `app.asar`；首启按种子版本号播种到配置目录（v2 盖成 v3、补 `weixin-publish.json`，0.7.4 实测首启 41 个技能）。发布脚本另有 `resources/social-publish-scripts/` 与 `resources/platforms/` 两份可读副本，`profile.mjs` 从相邻 `platforms/` 读平台 JSON。`ledger/` 运行台账数据目录**已排除**（0.7.5 起，electron-builder.yml 负向过滤；仅保留写台账代码 `scripts/ledger.mjs`），0.7.6 包内核验过。

## 核心模块

| 模块 | 作用 |
|---|---|
| `index.ts` | 进程生命周期、MCP 鉴权文件 |
| `browser.ts` | 共享窗口、标签、点击填写、`handleChat` / 队列、出行与任务执行、超时停加载 |
| `agent/stub.ts` | 本地意图 → `ChatAction`（手，不是脑） |
| `agent/kernel/` | Agent 内核：入句、推理下一步、能力表、契约验收 |
| `agent/plan.ts` | 侧栏计划卡 |
| `agent/mission-journal.ts` | 工作单事件溯源，断点续跑 |
| `agent/task-class.ts` | 前台 / 后台分车道 |
| `agent/task-pool.ts` | 并行任务池，上限 3 |
| `agent/site-goal.ts` | 目标站点解析与错配换路 |
| `agent/runtime.ts` | 工作单开单/续跑/补槽 |
| `agent/slots.ts` | 槽位表：出发地/目的地/日期，地点表否决假地名 |
| `agent/loop.ts` | 交付物与手的编译（给能力表用，不当整轮脑） |
| `agent/place.ts` | 城 / 省 / 不是地点；动词不能当城 |
| `agent/intent-router.ts` | 路由：行程 / 出行 / 任务 / 飞书 / 打开+后半句 / 读页 |
| `agent/feishu.ts` | 飞书网页：打开消息、找人、写聊天/日志草稿（不发送） |
| `agent/travel.ts` | 酒店/机票/火车/路线解析与结果页 URL |
| `agent/trip-plan.ts` | 往返/出差拆步骤 |
| `agent/mission.ts` | 比价、周末、调研、求职、租房、挂号、材料、选课、文献、物流 |
| `agent/report-html.ts` | 行程手册、任务手册 |
| `tools/index.ts` | MCP 名 → 浏览器方法 |
| `envs/store.ts` + `browser.ts createEnvTab` | 多账号环境：每个环境独立 `persist:env_<id>` partition，见 [MULTI-ACCOUNT.md](./MULTI-ACCOUNT.md) |
| `mcp-server.ts` | Streamable HTTP + Bearer |
| `shell.html` | 人用的标签栏 + 侧栏对话 |
| `settings/store.ts` | `llmMode: byok \| cloud` |
| `cloud/auth.ts` `quota.ts` `session.ts` | 登录、任务配额、带 JWT 的 fetch |
| 独立 `sparo-pay` 服务 | 代理 + 支付回调（不要把云端 Key 并进本仓库） |
| `learning/*` | 卡住就问；经验在本机 `lessons.json`，见 [AI-LEARNING.md](./AI-LEARNING.md) |

内部类名仍是 `SparkBrowser`；对外产品名是 Sparo。

## 任务五步（统一）

1. 侧栏每一句进 Agent 内核：有未关的单就续跑；推理器每次只走下一步；合法空槽才问  
2. 打开**结果页**（机票不要 `/online/channel`；比价不要京东/淘宝首页）  
3. 读出可点实体（店名、航班、商品、出处）  
4. 写成手册  
5. 付钱 / 发送 / 投递由人在窗口里点  

重站点（京东、淘宝、点评、猫眼）：只记链接或改走百度检索，超时调用 `webContents.stop()`。

## 其它面

- **发布**：`run_skill` / `xhs_inject_*`，标题正文整段写入。见 [PUBLISHING.md](./PUBLISHING.md)。  
- **多账号**：设置 → 账号；MCP `list_envs` / `create_env` / `delete_env`，`navigate` / `new_tab` 带 `envId`。每个环境一套独立 Cookie，可同时登录同站点多个号。见 [MULTI-ACCOUNT.md](./MULTI-ACCOUNT.md)。  
- **填表**：`analyze_page` → `execute_primitives`。[UNIVERSAL-ANALYZER.md](./UNIVERSAL-ANALYZER.md)。  
- **客服**：`cs_draft_reply` 只填草稿。[CUSTOMER-SERVICE.md](./CUSTOMER-SERVICE.md)。  
- **人协议**：`pause` / `resume` / `request_approval`。  
- 店小蜜垂直包仅原版；商店版 `SPARO_ENABLE_DXM` 默认关。  
- **云订阅**：设置双模式；`handleChatJob` 开头 `assertAndStartTask`，结束 `settle`。详见 [CLOUD-SUBSCRIPTION.md](./CLOUD-SUBSCRIPTION.md)。`STORE_CHANNEL=msft` 构建禁止价格文案。

## 相关文档

- 上手：[AGENTS.md](../AGENTS.md)、[docs/AGENTS.md](./AGENTS.md)
- 云订阅 M1：[CLOUD-SUBSCRIPTION.md](./CLOUD-SUBSCRIPTION.md)
- 任务与 QA：[PRODUCT-TASKBOOK.md](./PRODUCT-TASKBOOK.md)
- Hermes：[HERMES-PLAYBOOK.md](./HERMES-PLAYBOOK.md)
- 工具表：[MCP-API.md](./MCP-API.md)
- 变更：[CHANGELOG.md](../CHANGELOG.md)
