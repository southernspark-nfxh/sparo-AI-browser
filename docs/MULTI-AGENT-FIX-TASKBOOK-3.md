# 多 Agent 并行缺陷修复任务书（T73–T75）

状态：执行中（T73 已改，T74 / T75 未做）。来源：2026-11-06 T70–T72 验收通过后的用户新反馈 + 验收遗留。上一轮见 [MULTI-AGENT-FIX-TASKBOOK-2.md](./MULTI-AGENT-FIX-TASKBOOK-2.md)（T70–T72 已验收通过，状态字段已改为「已完成」）。

**执行顺序：T73 → T74 → T75。T75 第一步是复现取证，没复现前不许改行为代码。**

---

## 全局红线

1. `CHROME_H` 保持 76，顶栏 36+40 网格不动。
2. 不向网页注入 DOM/CSS，标识只在壳层。
3. 每条至少一个 commit，`git add` 逐文件列名，禁止 `git add -A`。
4. 改完 `npm run typecheck` 退出码 0 + `npm test` 全绿，再做下一条。
5. 修 UI 的提交不得混入脑区/工具层改动。
6. 「后台任务不抢用户焦点」是既有承诺（`focusPageForInput` 的语义），T75 修复不许牺牲它。

---

# T73 任务卡死无法救（模型调用超时 + 停止入口）

## 现象

真机验收时「读宋朝+明朝两个维基条目」任务在第 30 轮挂起：模型调用 15 分钟以上无响应、无报错、无超时。期间三层都打不掉它：

1. 任务卡上只有「聚焦」，没有停止按钮；
2. `abortAgentRuns()` 的 AbortSignal 打不到挂起的模型调用；
3. 连 agent 标签被休眠（discard）后，任务卡仍显示 running。

MCP 侧也没有 stop 工具（调用返回 `Tool stop not found`）。最终只能重启实例。对照组：单条目任务（唐朝）从未复现，怀疑与长上下文收尾轮有关。

## 改哪

`src/main/browser.ts`（runAgentTask / agentAborts / 任务卡推送）、freeSoul 模型请求层（`freeSoul.run` 的 LLM fetch）、`src/main/mcp-server.ts`、`src/renderer/shell.html`（任务卡）。

## 怎么做

1. **模型调用超时兜底**：freeSoul 每轮 LLM 请求在既有 `signal` 之外再挂 `AbortSignal.timeout`（单轮无首字 180 秒可断，接到首字后取消该计时）。超时后任务走 failed，侧栏说人话：「模型长时间无响应，已停止。可重试。」不许静默吞掉。
2. **任务卡补「停止」按钮**：running / waiting_human 状态的任务卡显示停止。点击 → abort 对应任务的 controller → `settleMcpTask` + `taskPool.finish(id, "failed")` → 侧栏一条「已手动停止」。
3. **abort 真正覆盖模型请求**：审查 `freeSoul.run` 的 signal 是否接进了每一次 fetch；没接的补上。这是第 2 条能生效的前提。
4. **MCP 补 `stop_task` 工具**：入参 taskId（可选，缺省停该 client 的），复用第 2 条的停止链路。
5. **标签休眠不等价于任务终止**：agent 标签被 discard 后任务仍 running 属于状态错位——停止入口（第 2 条）必须在这种状态下也能用；不需要自动判死。

## 测试

- 单测：模拟无响应模型（fetch 永挂）→ 180 秒逻辑触发后任务 failed 且 chatLog 有「模型长时间无响应」；stop 按钮路径把 running 任务变 failed；`stop_task` 工具同链路。
- 真机：提交一个长任务，跑动中点任务卡「停止」，任务卡 3 秒内消失、侧栏有提示、agent 标签横幅转「已下班」。

## 验收

日志里能看到超时/停止事件；停止后实例不需要重启就能接新任务。

---

# T74 壳层白屏：sidebar 全量推送瘦身（T72 数据落地）

## 现象

用户长期偶发「右侧栏 + 顶部整块全白」。T72（6fdea12）已取证：

- chrome 推送有节流合并层：req 103 → flush 55，avg 922 字节；
- **sidebar 推送没有合并层，26 次请求 26 次全发，平均约 10KB、最高 20321 字节**——每次把整段对话全量推给壳层渲染进程。用户判断「对话一长先顶满渲染进程」，与偶发白屏（顶部+侧栏同属壳层渲染进程）吻合。
- 另有一类白屏窗口被拖出屏幕+布局错乱，Ctrl+\ 可恢复，crash.log 无记录——这类不动，靠 T72 已加的 crash-context 日志区分。

## 改哪

`src/main/browser.ts`（`getSidebarPayload` / `pushSidebarState` 推送链）、`src/renderer/shell.html`（对话渲染侧）。

## 怎么做

1. **chat 推送增量化**：对话消息带单调递增序号。新增/变更只发 delta（`chat-delta`，携带自上次已发序号之后的条目），壳层本地 append/patch；以下情况才发一次全量：壳层初始化、会话切换（chatKey 变更）、壳层渲染进程 reload 之后（`webContents` did-finish-load 或既有重连时机）。
2. **delta 也过合并层**：与 chrome 推送同规格的 100ms 节流合并，高频轮次（`onSidebar` 每轮都推）不再逐次直发。
3. **全量语义保留**：`pushSidebarState` 的其它字段（输入框状态、任务卡等）不混进 chat delta，避免互相触发全量。任务卡推送走 T58 已有的 `syncTaskChrome` 节流，不动。
4. **reload 自愈验证**：壳层渲染进程 reload（T72 后 render-process-gone 会触发）后，靠第 1 条的全量重同步把对话完整恢复——这是增量化最容易翻车的点，必须专门测。
5. 序号回绕/乱序防护：delta 带基线序号，壳层发现缺口（收到的基线 ≠ 本地末尾）时主动请求一次全量，不做复杂补洞。

## 测试

- 单测：连续 push 10 条消息，跨过合并窗口后 delta 条数 < 10 且壳层最终状态与全量一致；会话切换发全量；缺口触发全量请求。
- 真机：跑一个 30+ 轮长对话任务，`[push]` 计量日志里 sidebar avgBytes 相比 T72 基线（约 10KB）明显下降；对话内容无丢失、无重复气泡；任务中途 kill 壳层渲染进程，reload 后对话完整。

## 验收

用户此前「对话一长就白屏」的场景复跑不白屏；`[push]` 日志贴进完成记录。

---

# T75 人机 / 多 Agent 并行互不干扰（先复现取证，禁止盲修）

## 现象（用户 2026-11-06 中午原话归纳）

Agent 操纵浏览器期间，用户自己另开新网页、再让侧栏 Agent 去做事，侧栏 Agent「没法工作，输入不了内容」。

## 期望行为（验收标准）

- Agent 在标签 A 工作时，用户在标签 B 搜索、打字，互不抢焦点、互不阻塞；
- 多个 Agent（MCP 外部 agent + 侧栏 agent）各自在各自标签并行工作；
- 用户随时能在侧栏给 Agent 下新指令。

## 已排除项（不要重复怀疑）

- `runScoped` 用 `AsyncLocalStorage`（browser.ts:7304），作用域并发安全；
- `TASK_POOL_LIMIT = 3`（task-pool.ts:8），后台任务可 3 个并行；
- `bindClientTab` 不抢用户 active 标签（mcp-sessions.ts:103）。

## 嫌疑点（取证清单，逐条加日志或复现验证）

1. **fill 的后台焦点依赖**：`focusPageForInput`（browser.ts:2142）在窗口失焦时直接 return（正确，防抢焦点）；但 fill 的 CDP `Input.insertText` fallback（browser.ts:11501）在标签后台 / 窗口失焦时可能失效。在 fill 失败路径加日志：`[fill] tab=<id> active=<bool> focused=<bool> method=<m> matched=<bool>`，复现时看是哪层失败。
2. **fill/click 的 tabId 兜底**：browser.ts:11403 `this.viewForTab(tabId || this.activeTabId)`——审查 freeSoul 工具链所有 click/fill/select/execute 调用是否都带 scope 的 tabId。不带时会打到用户 active 标签（这比失败更糟），逐个列出确认。
3. **freeSoulRunning 门禁**：browser.ts:4256 附近 `if (this.freeSoulRunning) return { ok: true, message: "" }`——MCP agent 跑动时这个静默放行会不会把侧栏 Agent 的工具调用吞成「成功但啥都没做」。同样审查 4184–4256 的观察器逻辑。
4. **foreground 串行**：`laneForText` 兜底返回 "foreground"（task-class.ts:98），侧栏多步任务若被判 foreground，会与其它 foreground 任务互斥（`foregroundBusy`）。复现时记录侧栏任务实际被判的车道。

## 怎么做

1. 第一步只做复现 + 日志：MCP agent 跑一个长任务（标签 A），同时侧栏提交一个需要 fill 的任务（标签 B），用户在标签 C 浏浏览。用上面 4 条日志定位是哪层拦住或失败，结论写进完成记录。
2. 按定位结果修，方向约束：
   - 若是焦点依赖 → 后台标签 fill 改走不依赖真实焦点的路径（JS setter / CDP evaluate），保留 `focusPageForInput` 对前台的语义；
   - 若是 tabId 兜底 → 全部改为显式取 scope tabId，删掉 `|| this.activeTabId` 兜底；
   - 若是门禁误吞 → 门禁只对用户手势触发的动作生效，agent 作用域内不放行也不吞，正常执行；
   - 若是车道误判 → 只调这一类的分类，不动全局默认。
3. 不改 `focusPageForInput` 的「失焦不抢焦点」语义。

## 测试

- 单测按实际根因补（如 fill 在非 active 标签的执行路径、门禁对 agent scope 的放行）。
- 真机（即验收标准原文）：MCP agent 标签 A 采集、侧栏 agent 标签 B 填表、用户标签 C 搜索打字，三者同时进行互不干扰；期间用户在侧栏输入框打字不被页面焦点抢走。

---

## 完成交付

写入 `docs/PRODUCT-TASKBOOK.md` 对应条目，逐条写：改动文件、根因一句话、测试名、真机步骤、未验证项。

**特别要求**：T73 必须贴真机「停止按钮生效」的日志或截图；T74 必须贴前后 `[push]` sidebar avgBytes 对比；T75 没有复现结论就写没复现，不许编。没跑真机就写没跑。

## 完成记录

### T73（2026-11-07）

- 改动：`src/main/agent/free-soul.ts`、`src/main/browser.ts`、`src/main/shell-preload.ts`、`src/main/tools/index.ts`、`src/main/mcp-server.ts`、`src/renderer/shell.html`、`docs/DECISION-POINTS.md`（#32）
- 根因：单轮请求虽有 120 秒 abort，但 fetch 不认中断时计时器取消不了等待；任务卡没有停止；abort 集合没有按任务对上；MCP 没有 `stop_task`。
- 无响应头 180 秒（`AbortSignal.timeout`，测试可把 `requestTimeoutMs` 调短）必失败，文案「模型长时间无响应，已停止。可重试。」接到响应头后不再用这只计时掐正文。用户中断优先。仍重试一次。
- 任务卡在 running / waiting_human 上有「停止」。点下去 abort 对应 controller，任务卡标失败，侧栏写「已手动停止」，标签标已下班。休眠不结束任务，停止照样能用。MCP `stop_task` 走同一条。
- 测试：`tests/free-soul-v4.test.ts`「两次都挂起时如实失败」「fetch 不认中断时，无首字超时仍会停」「用户中断优先于无首字超时」；`tests/stop-task.test.ts`「无首字超时默认 180 秒」「停止按钮和 stop_task 走同一条链路，休眠后也能停」
- 真机未跑。没有在长任务上点「停止」，所以没有停止生效的日志或截图。
