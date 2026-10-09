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

## 网页必须铺满「页面洞」

左上角只剩汉堡菜单 / 「Micros」半截，是 `WebContentsView` 没铺满 `#pageHole`（Windows 标题栏叠层 + 先 load 后排版）。  
`shell.html` 用 `ResizeObserver` 上报洞的位置 → `spark:page-hole` → `setPageHoleBounds`。  
新建/唤醒标签：先 `layout()` 再 `loadURL`。后台标签移到 `x: -20000`，不要叠在左上角。最大化也要重排。

## 侧栏一句话怎么走

```text
用户原话
  → kernel 入句分类：新开 / 续跑 / 补槽 / 改需求 / 取消 / 旁路读页
  → 工作单：blocked(合法空槽) | propose(省名拆城) | running
  → 推理器每次只决定下一步（看见观察再改路），护栏否决非法 ask
  → 能力表执行一手，回报 finding
  → 契约验收：酒店页不能算餐厅。齐了才合成手册
  → 学习层挂当前 step，不关单
```

上一句没写完手册，下一句进 `chatQueue`，避免把手册写脏。

## 核心模块

| 模块 | 作用 |
|---|---|
| `index.ts` | 进程生命周期、MCP 鉴权文件 |
| `browser.ts` | 共享窗口、标签、点击填写、`handleChat` / 队列、出行与任务执行、超时停加载 |
| `agent/stub.ts` | 本地意图 → `ChatAction`（手，不是脑） |
| `agent/kernel/` | Agent 内核：入句、推理下一步、能力表、契约验收 |
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
