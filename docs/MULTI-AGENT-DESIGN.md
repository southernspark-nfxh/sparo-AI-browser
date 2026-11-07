# 多 Agent 并行 + 页面归属标识（MULTI-AGENT）

状态：设计稿，未开工。上一本任务书收在 T46（`docs/FREE-SOUL-TASKBOOK.md`），本文件从 T47 起编号。

---

## 0. 北极星目标

> **一个 Sparo，多个 agent 同时干活，互不串台；每个被 agent 使用的页面一眼可辨归属；没被 agent 使用的页面保持原样（白色）。**

拆成三条可验收的硬指标：

1. **并发不串台**：3 个外部 agent 同时提交任务，各自标签、对话历史、工作单、云端计量 ID 完全隔离，日志里 0 次交叉。
2. **一眼可辨**：agent 正在用的页面，头部有一条 32px 归属标识条 + 专属颜色；标签页有色点；用户自己的页面**不增加任何多余像素和颜色**。
3. **可查可接管**：点侧栏任务卡 → 切到那个页面 → 同时切到那个 agent 的对话；能看出「谁在用、第几步、卡在哪、在等谁」。

北极星之外的东西（独立窗口、跨机器、agent 之间互相通信）本轮不做。

---

## 1. 现状：底座有，隔离漏

| 能力 | 现状 | 位置 |
|---|---|---|
| 每个 MCP 客户端一个 `clientId` | 已有，`initialize` 时下发并回写响应头 | [mcp-server.ts](../src/main/mcp-server.ts#L859-L875) |
| 每个 client 自己的标签页，不抢用户当前页 | 已有 | [mcp-sessions.ts](../src/main/agent/mcp-sessions.ts#L23-L42) |
| 异步提交 + 轮询 | `submit_task` / `get_task` 已有 | [browser.ts](../src/main/browser.ts#L6399-L6455) |
| 后台并发上限 3 | 已有 | [task-pool.ts](../src/main/agent/task-pool.ts#L8) |
| 任务卡点开切标签 | 已有雏形 | [shell.html](../src/renderer/shell.html#L2765-L2802) |
| 任务级作用域 | 机制已有（`AsyncLocalStorage`），**后台 agent 任务没用上** | [browser.ts](../src/main/browser.ts#L727-L749) |
| 对话历史 | **全局一份 `chatLog`**，甲乙互灌 | [browser.ts](../src/main/browser.ts#L6329-L6356) |
| 云端计量 ID | **写共享单例** `freeSoul.setTaskId`，并发互相覆盖 | [browser.ts](../src/main/browser.ts#L4470-L4474) |
| 池满行为 | agent 任务直接返回 `pool_full`，**不排队、无恢复** | [browser.ts](../src/main/browser.ts#L6569-L6590) |
| 任务归属 | `get_task` 任何人可查任意任务 ID | [browser.ts](../src/main/browser.ts#L6421-L6435) |

**一句话**：现在是「两个 agent 能同时提交，但会互相踩页面」。

---

## 2. 页面归属标识（本轮视觉重点）

### 2.1 三层，颜色统一

同一个 agent 在三个地方同一颜色：

| 层 | 表现 | 无 agent 时 |
|---|---|---|
| 标签页 | 左侧 6px 色点 + 1px 同色底描边；hover 显示「Agent 甲 · 操作中」 | 完全不变，白色 |
| 页面头部条 | 页面内容上方 32px 横条：左侧色点 + `Agent 甲 · 操作中 · 第 3 轮` + 最后动作一句话 | 不渲染，0 像素 |
| 侧栏任务卡 | 左侧 3px 同色边 + agent 名 + 状态 | 不出现 |

颜色映射：`clientId` 哈希 → 8 色安全色板取一个，同一 agent 全局恒定。深色主题用同色相低透明度。

### 2.2 标识条画在壳层，不往网页 DOM 里注

三种做法对比：

| 做法 | 问题 |
|---|---|
| 注入 DOM + `insertCSS` 固定条 | SPA 重渲染会清掉；和站点吸顶头打架；截图/报告/PDF 会带上假头；部分站点有 DOM 监控 |
| 独立浮层 `WebContentsView` | 多一层原生视图，坐标/焦点/截图都要跟着改，成本高 |
| **壳层横条 + 页面视图下移**（选这个） | 不碰页面 DOM，页面布局、锚点、选择器、截图完全不受影响 |

落地方式，复用现有 page-hole 机制：

- `shell.html` 的 `.page-hole` 里加 `#agentBanner`（绝对定位，`top:0;height:32px`，默认 `display:none`）。
- `reportHole()` 上报时把横幅高度扣掉：`y + 32`、`height - 32`，见 [shell.html](../src/renderer/shell.html#L3675-L3690)。
- 主进程 `pageBounds()` 已经允许 `y ∈ [76, 200]`，`76+32=108` 合规，**不用动 `CHROME_H=76`**，也不用动顶栏 36/40 网格，见 [browser.ts](../src/main/browser.ts#L2242-L2261)。
- 切标签时先推壳层状态、再触发一次 `requestHoleReport()`，避免视图瞬时盖住横幅。

### 2.3 状态文案

| 状态 | 条上写什么 |
|---|---|
| 正在跑 | `Agent 甲 · 操作中 · 第 3 轮 · 正在读页` |
| 等你 | `Agent 甲 · 等你处理 · 需要登录` |
| 排队 | `Agent 甲 · 排队中（第 2 位）` |
| 完成 | `Agent 甲 · 已完成 · 页面已休眠`（点标签可唤醒） |
| 用户页 | 无条 |

数据来源：`taskPool` 的任务状态 + `ownerForTab(tabId)`。

### 2.4 agent 怎么称呼

- 优先取 MCP `initialize` 参数里的 `clientInfo.name`（Cursor、Claude Desktop 之类会带）。
- 没带就按接入顺序叫「Agent 甲 / 乙 / 丙」。
- `clientId` 仍是内部主键，显示名只用于 UI 和日志。

---

## 3. 隔离三件套（不修，标识做得再漂亮也是假的）

### T47 后台 agent 任务进任务作用域

- 改：`browser.ts` `runAgentTask`。
- 把 `freeSoul.run(...)` 整段包进 `this.runScoped("background", tabId, work)`，让 `agentTabId` / `activeMission` / `cloudTaskId` 走作用域而不是全局 fallback。
- 删掉手工 `previousAgentTab` 存取（作用域退出自动回退），保留 `fallbackAgentTabId` 给非任务路径。
- 验收：两个 agent 并发跑，`[free-soul]` 日志里每一轮的 tabId 恒定且等于各自绑定的标签。

### T48 对话历史按会话隔离

- 改：`browser.ts`。
- `chatLog` → `Map<sessionKey, ChatTurn[]>`，`sessionKey = "user"` 或 `"agent:<clientId>"`。
- 传给模型的 `history` 只取本会话。
- `getSidebarPayload` 增 `sessions` 与 `selectedSession`；默认选中当前激活标签的归属会话。
- `saveChatMemory` 保持落 user 会话，agent 会话按 clientId 分片存（上限沿用现有条数）。

### T49 云端计量按任务，不写共享实例

- 改：`free-soul.ts`、`browser.ts`。
- `run()` 增加可选 `taskId`，`completion` 优先用调用方传入的值，`config.taskId` 降级为兜底。
- `beginCloudTaskIfNeeded` 不再 `setTaskId` 到共享单例，改为把 `t.taskId` 随 `run` 传入；`finishCloudTask` 只清本任务。
- `deepseek` provider 的 `setTaskId` 保留，它走的是另一条非并发路径。

### T50 池满排队 + 任务归属

- 改：`task-pool.ts`、`browser.ts`、`mcp-server.ts`。
- `PoolTask` 增 `clientId / agentName / color / lastLine`。
- `submitAgentTask` 池满时不再返回 `pool_full`，改为入 `agentQueue` + 池内 `queued`，任务结束后 `pumpAgent()` 依次放行（**不能复用侧栏的 `backgroundQueue`**，两者取任务的 `pumpBackground` 会互相抢）。
- `get_task` 只返回同 `clientId` 的任务；跨 client 查询一律 `unknown`。
- 新增 `list_tasks`（本 client 在跑/排队的任务）与 `list_agents`（全局有哪些 agent、占用几张标签、当前状态，**不含对话正文**）。

### T51 身份与颜色

- 改：`mcp-server.ts`、`mcp-sessions.ts`。
- `initialize` 时读 `clientInfo.name`，存进会话表；顺序分配「甲乙丙」兜底名。
- 新增 `colorForClient(clientId)`，8 色板稳定映射。
- 名字与颜色注入 `listTabs`、`list_agents`、任务卡。

---

## 4. 分身面板（P2）

- 侧栏顶部加一行：`使用中 2 · Agent 甲 / 乙`，点谁切谁。
- 任务卡：同色左边条 + agent 名 + 状态；`waiting_human` 的卡置顶并高亮。
- 点卡片 = `switchTab(tabId)` + `selectSession(agent:<clientId>)`，一次完成「看页面 + 看它在想什么」。
- 只显示当前选中会话的对话，不把多个 agent 的话混在一屏。

---

## 5. 独立窗口（P3，本轮不做）

每个 agent 一个 `BrowserWindow`、共享同一个 session partition（登录态共用）是可行的，但要重写：窗口生命周期、最小化挂起、截图坐标、后台点击注入、焦点规则、`page-hole` 布局。**先把标签页级分身跑稳，独立窗口另开一本任务书评估。**

---

## 6. 任务清单

| 编号 | 内容 | 触及 | 优先级 |
|---|---|---|---|
| T47 | 后台 agent 任务进 `runScoped` | `browser.ts` | P0 |
| T48 | 对话历史按 clientId 隔离 + 侧栏会话字段 | `browser.ts`、`shell.html` | P0 |
| T49 | 云端 taskId 随调用传，不写共享单例 | `free-soul.ts`、`browser.ts` | P0 |
| T50 | agent 任务池满排队 + `get_task` 归属 + `list_tasks`/`list_agents` | `task-pool.ts`、`browser.ts`、`mcp-server.ts` | P1 |
| T51 | clientInfo 显示名 + 8 色映射 | `mcp-server.ts`、`mcp-sessions.ts` | P1 |
| T52 | 标签页色点 + hover 归属 | `browser.ts` `listTabs`、`shell.html` | P1 |
| T53 | 页面头部 32px 标识条（壳层，page-hole 扣高） | `shell.html` 为主 | P1 |
| T54 | 分身面板：会话切换 + 任务卡联动 | `shell.html`、`browser.ts` | P2 |
| T55 | 头部条「暂停」按钮（`agentAborts` 改 `Map<taskId, AbortController>`） | `browser.ts`、`shell.html` | P2，可选 |

**提交纪律**：T47–T51 属于隔离/脑区链路，单独提交；T52–T54 属于 UI，另起一个提交。不得混在一起。

---

## 7. 验收

### 自动测试建议

- `tests/multi-agent-isolation.test.ts`：两个 clientId 并发 `submit_task`，断言各自 `get_task` 的 rounds/最终 URL 不交叉；`get_task` 跨 client 返回 `unknown`。
- `tests/task-pool-agent-queue.test.ts`：4 个问题同时提交，第 4 个 `queued`，前一个完成自动放行；`waiting_human` 不占名额。
- `tests/list-tabs-owner.test.ts`：`listTabs` 带 `owner/agentName/agentColor`，用户标签三项均为空。
- 壳层横幅：`reportHole` 在横幅显示时 y 加 32、height 减 32，隐藏时回到原值。

### 真机场景

| 编号 | 场景 | 过线标准 |
|---|---|---|
| Q23 | 甲乙丙各提交一个任务 | 三张标签、三条对话、三个计量 ID 互不干扰；页面无串台 |
| Q24 | 切到 agent 页 / 用户页 | agent 页有 32px 条 + 标签色点；用户页截图像素与改动前一致（无条、无染色） |
| Q25 | 4 个 agent 同时提交 | 第 4 个显示排队，前一个完成后自动开跑，不需要重提 |
| Q26 | 用乙的 clientId 查甲的 taskId | 返回 `unknown`，不泄露甲的进度与结果 |
| Q27 | 点侧栏任务卡 | 同时切到该页 + 该 agent 的对话；切回用户页对话恢复用户历史 |

---

## 8. 禁区

1. **不改顶栏**：`CHROME_H` 保持 76，36/40/1fr 网格不动；标识条属于内容区，靠 page-hole 扣高实现。
2. **不往网页注入 DOM**（`insertCSS` / `document.insertBefore`）做归属条，默认方案明确禁止；要做另立任务并单独评估。
3. **用户标签零装饰**：没被 agent 使用的页面不得出现颜色、色点、横幅。
4. **不新增提前结束任务的本地判断**；若出现，必须先写进 `docs/DECISION-POINTS.md`。
5. 不动 `docs/listings/`，不出现价格/付款 UI。
6. 不做独立窗口（P3 另议）。
7. 隔离类改动与 UI 改动不得合并为一个 commit。

---

## 9. 完成交付格式

照旧：改动文件、测试名、决策点、未跑项如实写。真机未跑就写未跑，不许用单测绿代替 Q23–Q27。
