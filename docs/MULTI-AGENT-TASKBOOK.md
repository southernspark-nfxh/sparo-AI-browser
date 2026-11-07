# 多 Agent 并行任务书（T47–T55）

状态：待执行。设计依据见 [MULTI-AGENT-DESIGN.md](./MULTI-AGENT-DESIGN.md)。编号接 `docs/FREE-SOUL-TASKBOOK.md` 的 T46。

**执行顺序：T47 → T48 → T49 → T50 → T51 → T52 → T53 → T54（→ T55 可选）。**
前一条测试绿了再动下一条，不许并行改同一条链路。

---

## 全局红线（每条任务都适用）

1. `CHROME_H` 保持 76，顶栏 `36px + 40px` 网格不动。
2. 不向网页注入 DOM / `insertCSS` 做归属标识，只允许壳层实现。
3. 用户自己的标签页不出现色点、色条、横幅。
4. 不新增「提前结束任务」的本地判断；出现就先进 `docs/DECISION-POINTS.md`。
5. 不碰 `docs/listings/`，不出现价格/付款 UI。
6. 隔离链路（T47–T49）与 UI（T52–T54）不得合并提交。
7. 每轮改完自己跑 `npm run typecheck` + `npm test`，绿了再提交。

---

# T47 后台 agent 任务进任务作用域

**要解决的问题**：`runAgentTask` 在作用域外直接读写 `this.agentTabId`，两个 agent 并发时后启动的会覆盖前者，导致甲的工具落到乙的页面。

**改哪**：`src/main/browser.ts`，`runAgentTask`（约 6602–6660）。

**怎么做**：

1. 把整个方法体包进作用域：

```ts
private async runAgentTask(task, clientId: string): Promise<void> {
  const tabId = this.bindAgentTab(clientId);
  const before = this.activeTabId;
  if (before && this.activeTabId !== before) this.switchTab(before);
  if (!tabId) {
    this.settleMcpTask(task, { ok: false, text: "无法为这个 agent 创建独立标签。" });
    this.taskPool.finish(task.taskId, "failed");
    return;
  }
  await this.runScoped("background", tabId, async () => {
    // 原来 freeSoul.run 那一整段搬进来，不再碰 this.agentTabId 的存取
  }, undefined, `agent:${clientId}`);
}
```

2. 删除 `previousAgentTab` 的保存/还原逻辑，以及方法里所有 `this.agentTabId = ...` 赋值；`getUrl()/getTitle()/settleMcpTask` 里改成显式用 `tabId`（`settleMcpTask` 增加可选 `tabId` 参数）。
3. `runScoped` 增加第 5 个可选参数 `chatKey`（T48 用），此时先接住不实现，或与 T48 合并提交。
4. `finally` 里的 `releaseBackgroundRender()`、`agentAborts.delete`、`taskPool.finish` 仍留在方法内、作用域外执行。

**测试**（`tests/multi-agent-isolation.test.ts`）：
- 两个 clientId 并发 `submitTask`，注入的假 `freeSoul.run` 每次被调用时读 `(browser as any).agentTabId`。
- 断言：甲的每次读取都等于甲的标签，乙的每次读取都等于乙的标签；结束后 `activeTabId` 仍是用户原来的标签。

**完成标志**：日志 `[free-soul] run start` 两条交错出现时，两边的 tabId 各自恒定。

---

# T48 对话历史按会话隔离

**要解决的问题**：`chatLog` 是全局一份（约 60 处 `this.chatLog.push`），甲乙对话互灌，且被当作 `history` 传给模型。

**改哪**：`src/main/browser.ts`、`src/renderer/shell.html`（只加字段不重做 UI）。

**怎么做**：

1. 底层存成 Map，但**保留 `chatLog` 这个成员名**，用 getter/setter 承接，这样 60 处 push 一行不用改：

```ts
private chatSessions = new Map<string, ChatTurn[]>();
private chatKeyFallback = "user";

private get chatLog(): ChatTurn[] {
  const key = this.taskStore()?.chatKey || this.chatKeyFallback;
  let list = this.chatSessions.get(key);
  if (!list) { list = []; this.chatSessions.set(key, list); }
  return list;
}

private set chatLog(list: ChatTurn[]) {
  const key = this.taskStore()?.chatKey || this.chatKeyFallback;
  this.chatSessions.set(key, list);
}
```

2. `TaskScope` 增加 `chatKey: string`；`runScoped(lane, tabId, work, mission?, chatKey?)` 写入 `scope.chatKey`。
   - 前台用户任务：`"user"`。
   - 后台 agent 任务：`agent:<clientId>`（T47 已把参数铺好）。
3. 加载与落盘：
   - 构造时 `this.chatLog = loadChatMemory(...)` 只落到 `user`。
   - `pushSidebarState` 里 `saveChatMemory(this.configDir(), this.chatSessions.get("user") || [])`；**agent 会话本轮不落盘**，重启即清，完成记录里写明。
   - `clearChat` 只清当前选中会话。
4. 侧栏数据（`getSidebarPayload`，约 3357–3375）：
   - `chat: this.turnsFor(this.selectedSession).slice(-40)`
   - 新增 `selectedSession: string`
   - 新增 `sessions: Array<{ key: string; label: string; color: string; running: number }>`
   - `selectedSession` 默认取当前激活标签的归属会话；新增 IPC `spark:select-session`。
5. `noteSidebarMessages`（约 1750）只统计 `user` 会话，避免 agent 的进度把人吵醒。

**测试**：
- 甲 push 一条、乙 push 一条，断言两条互不可见；`getSidebarPayload` 切会话后 `chat` 跟着变。
- 重启（新建实例）只恢复 user 会话。

**完成标志**：甲乙同时在跑时，侧栏任选一个会话，看到的只有那个 agent 的话。

---

# T49 云端计量 ID 按调用传，不写共享单例

**要解决的问题**：`freeSoul.setTaskId()` 改的是单例配置，并发时计量请求头 `X-Sparo-Task` 互相覆盖，结算记错账。

**改哪**：`src/main/agent/free-soul.ts`、`src/main/browser.ts`。

**怎么做**：

1. `free-soul.ts`：`run(input)` 增加可选 `taskId`；`completion(messages, signal, taskId)` 里用 `taskId || this.config.taskId` 决定 `X-Sparo-Task`。
2. `browser.ts`：
   - 删除 `beginCloudTaskIfNeeded` 里的 `this.freeSoul?.setTaskId(...)` 与 `finishCloudTask` 里的 `this.freeSoul?.setTaskId(undefined)`。
   - `handleChat` 与 `runAgentTask` 在 `beginCloudTaskIfNeeded` 之后读一次 `const cloudTaskId = this.cloudTaskId`，随 `freeSoul.run({ taskId: cloudTaskId })` 传入。
   - `deepseek?.setTaskId` 保留（非并发路径）。

**测试**：假 `fetch` 捕获两个并发任务的请求头，断言 `X-Sparo-Task` 各自等于自己的云端任务 ID。

**完成标志**：`get_task` 两个并发任务结算后，云端用量分别归到各自任务。

---

# T50 agent 任务池满排队 + 任务归属

**要解决的问题**：池满直接返回 `pool_full`，agent 无法等待；`get_task` 可越权查别人的任务。

**改哪**：`src/main/agent/task-pool.ts`、`src/main/browser.ts`、`src/main/mcp-server.ts`。

**怎么做**：

1. `PoolTask` / `TaskCardView` 增加 `clientId?: string`、`agentName?: string`、`color?: string`、`lastLine?: string`；`start/enqueue` 的入参同步可选。
2. `submitAgentTask`：
   - 池满时 `task.status = "queued"`，`taskPool.enqueue({...})`，推进新队列 `agentQueue: Array<{ task; clientId }>`，返回 `{ status: "queued" }`。
   - 返回类型联合里加 `"queued"`。
3. 新增 `pumpAgent()`：`while (canStartBackground() && agentQueue.length)` 取队首 → `markRunning` → `runAgentTask`。
   - `runAgentTask` 的 `finally` 里 `taskPool.finish(...)` 之后调用 `pumpAgent()`。
   - **不要复用 `backgroundQueue` / `pumpBackground`**，否则侧栏任务会和 agent 任务互相抢队列项。
4. `getTask(taskId, clientId?)`：任务记录的 `clientId` 与调用方不一致时返回 `status: "unknown"`（不返回任何进度/结果）。`mcp-server` 把 `scope.clientId` 传进去。
5. 新增 MCP 工具：
   - `list_tasks`：本 client 在跑/排队/等你的任务（id、状态、轮次、标签）。
   - `list_agents`：全局有哪些 agent、显示名、占用标签数、是否在跑（**不含对话正文、不含任务正文**）。

**测试**（`tests/agent-task-queue.test.ts`）：
- 连续提交 4 个 agent 任务：前 3 个 `running`、第 4 个 `queued`；第一个完成后第 4 个自动 `running` 并最终 `done`。
- 甲用乙的 taskId 调 `get_task` 返回 `unknown`。
- `waiting_human` 的任务不占并发名额。

**完成标志**：4 个 agent 同时来，不需要重提，全部依次跑完。

---

# T51 agent 显示名与颜色

**改哪**：`src/main/agent/mcp-sessions.ts`、`src/main/mcp-server.ts`、`src/main/browser.ts`。

**怎么做**：

1. `mcp-sessions.ts`：
   - `ClientSession` 增加 `name: string`、`color: string`、`seat: number`。
   - 新增 `registerClientName(clientId, rawName)`：有 `clientInfo.name` 就用它（截断 24 字），没有就按接入顺序分配「Agent 甲 / 乙 / 丙 / 丁…」。
   - 新增 `colorForClient(clientId)`：`clientId` 哈希取 8 色板下标，稳定不变。
   - 色板写死 8 个，深色主题用同色相 `color-mix` 降低透明度：

```ts
export const AGENT_COLORS = [
  "#2f6feb", "#0e9f6e", "#c2410c", "#7c3aed",
  "#0891b2", "#be123c", "#4d7c0f", "#a16207",
];
```

2. `mcp-server.ts`：`initialize` 分支里读 `(parsedEarly as any).params?.clientInfo?.name`，调用 `handlers.register_client(clientId, name)`。
3. `listTabs`、`list_tasks`、`list_agents`、任务卡都带 `agentName` / `agentColor`。

**测试**：同名两个客户端颜色不同；不带 `clientInfo` 时依次拿到甲、乙；同一 clientId 颜色跨调用恒定。

---

# T52 标签页色点与归属

**改哪**：`src/main/browser.ts`（`listTabs`，约 1440–1475）、`src/renderer/shell.html`（`renderChrome`，约 2361–2400）。

**怎么做**：

1. `listTabs` 每个 tab 增加：

```ts
owner: "user" | `agent:${string}`;
agentName?: string;
agentColor?: string;
agentState?: "running" | "waiting_human" | "queued" | "done" | "idle";
```

`agentState` 从 `taskPool` 里按 `tabId` 找任务；找不到但 `tab.agentStatus === "done"` 则为 `done`；否则 `idle`。
2. 壳层：`tab.owner` 以 `agent:` 开头时才渲染 6px 色点（`background: tab.agentColor`）和 1px 底描边；`title` 拼上「Agent 甲 · 操作中」。
3. 用户标签：不加类名、不加内联样式，保持原样。

**测试**：`listTabs` 对用户标签三个字段为空；agent 标签三个字段齐全；`agentState` 随任务状态变化。

---

# T53 页面头部 32px 归属标识条

**改哪**：`src/renderer/shell.html`；`src/main/browser.ts` 仅加一次 `requestHoleReport()` 调用。

**怎么做**：

1. `.page-hole`（`id="pageHole"`）内新增：

```html
<div class="agent-banner" id="agentBanner" hidden>
  <span class="agent-dot"></span>
  <span class="agent-name"></span>
  <span class="agent-state"></span>
  <span class="agent-line"></span>
</div>
```

样式：`position:absolute;left:0;top:0;right:0;height:32px;display:flex;align-items:center;gap:8px;padding:0 12px;font-size:12px;background:color-mix(in srgb, var(--agent-color) 12%, var(--paper));border-bottom:1px solid color-mix(in srgb, var(--agent-color) 35%, transparent);z-index:2;`
`hidden` 时 `display:none`，用户页面不占像素。

2. 纯函数抽出来，便于单测：

```js
function holeRectWithBanner(rect, bannerH) {
  const h = Math.max(0, Math.min(bannerH || 0, rect.height - 80));
  return { x: rect.left, y: rect.top + h, width: rect.width, height: rect.height - h };
}
```

`reportHole()` 用 `banner.offsetHeight`（`hidden` 时为 0）调用它。

3. 横幅显隐后**手动调用一次 `reportHole()`**（绝对定位不改变 hole 尺寸，ResizeObserver 不会触发）。
4. 文案按 [MULTI-AGENT-DESIGN.md](./MULTI-AGENT-DESIGN.md) 2.3；内容来自 `chromeState.tabs` 里当前 `activeId` 的 `agentName/agentColor/agentState/lastLine`。
5. 主进程：`switchTab` 成功后、`pushChromeState()` 之后调用 `this.requestHoleReport()`，避免切标签瞬间视图盖住横幅。

**测试**：
- `holeRectWithBanner` 单测：无横幅原样返回；32px 时 y+32 / height−32；横幅超过高度时夹到 `height-80`。
- 真机：agent 标签有 32px 条、切换无闪烁；用户标签截图像素与改动前一致。

**完成标志**：看截图就能判断「这页是谁在用」，且用户页没有多出任何像素。

---

# T54 分身面板

**改哪**：`src/renderer/shell.html`、`src/main/browser.ts`。

**怎么做**：

1. 侧栏顶部一行：`使用中 2 · Agent 甲 · Agent 乙`；点名字 = `switchTab` 到它最近的任务标签 + `spark:select-session`。
2. 任务卡（`renderTaskStrip`）：
   - `background` 卡片显示 agent 名与同色左边条。
   - `waiting_human` 的卡片置顶并高亮（复用 `.is-waiting_human`）。
   - 点击 = 切标签 + 切会话，一次完成。
3. `spark:select-session` IPC：设置 `selectedSession` 并 `pushSidebarState()`。

**测试**：两个 agent 各跑一个任务，点卡片后 `selectedSession` 与 `activeId` 同时切到对应项；切回用户页恢复用户会话。

---

# T55（可选）横幅「停止」按钮

只在 T47–T54 全绿后做。

1. `agentAborts` 由 `Set<AbortController>` 改为 `Map<taskId, AbortController>`（`abortAgentRuns` 遍历 values）。
2. 横幅右侧加「停止」按钮 → IPC `spark:stop-task(taskId)` → `abort()` → 任务 `interrupted`，卡片显示「已停止」，标签归属保留。
3. 停止属于用户主动操作，不加确认门。

---

## 提交批次

| 批次 | 内容 | 说明 |
|---|---|---|
| C1 | T47 + T48 + T49 | 运行隔离链路，单独提交，便于回滚 |
| C2 | T50 + T51 | 任务池、归属、身份 |
| C3 | T52 + T53 | 视觉：标签色点 + 头部横幅 |
| C4 | T54 | 分身面板 |
| C5 | T55 | 可选，单独提交 |

`git add` 逐文件列名，不用 `git add -A`。

---

## 真机验收（Q23–Q27）

| 编号 | 场景 | 过线标准 |
|---|---|---|
| Q23 | 甲乙丙各提交一个任务 | 三张标签、三条对话、三个计量 ID 互不干扰；无串台；用户标签始终不变色 |
| Q24 | 切到 agent 页 / 用户页 | agent 页有 32px 条 + 标签色点；用户页与改动前截图逐像素一致 |
| Q25 | 4 个 agent 同时提交 | 第 4 个排队，前一完成自动开跑，无需重提 |
| Q26 | 乙查甲的 taskId | 返回 `unknown`，不泄露进度与结果 |
| Q27 | 点侧栏任务卡 | 页面与对话同时切换；切回用户页恢复用户历史 |

真机未跑就写未跑。不许用单测绿代替 Q23–Q27。

---

## 完成交付

照旧：改动文件、测试名、决策点、真机未跑项，逐条写清。另附一句：并发 3 个 agent 时主进程内存与 CPU 是否明显升高（看一眼任务管理器即可，不需要精确值）。
