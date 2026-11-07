# 多 Agent 并行缺陷修复任务书（T73–T78）

状态：T73–T76 已执行并验收（2026-11-07，复测当日模型已恢复）。复测结论：T75 并行成立（侧栏 30 轮 + MCP agent 32 轮同跑互不干扰）；T74 增量**未生效**（数据见 T77）；T76 完整跑通。**T77 / T78 待执行**，来自 2026-11-07 复测。

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

### T74（2026-11-07）

- 改动：`src/main/sidebar-sync.ts`、`src/main/browser.ts`、`src/main/shell-preload.ts`、`src/main/profile/chat-memory.ts`、`src/renderer/shell.html`
- 根因：侧栏每次把整段对话全量推给壳层，没有 100ms 合并。T72 基线是 sidebar req=26 flush=26 avgBytes=10470，最高 20321。
- 对话带单调序号。100ms 内多次推送合成一拍，只带上次序号之后的条目。壳层本地追加。初始化、换会话、壳层 `did-finish-load`、序号对不上，才发全量。对不上时壳层调用 `requestChatFull`，不做补洞。任务卡仍走 `syncTaskChrome`。拖出屏幕、Ctrl+\ 能恢复的那类白屏没动。
- 测试：`tests/sidebar-sync.test.ts`「合并窗口里追加 10 条只形成一条增量，壳层结果与全量一致」「换会话发全量」「序号对不上就请求全量，不把缺口拼进本地」「壳层重载后下一拍是全量」「100ms 内 10 次推送只发出一拍」
- 真机未跑。没有 30 轮长对话的 `[push]` 前后对比，所以没有新的 sidebar avgBytes。对照基线仍是 T72 的 avgBytes=10470。

### T75（2026-11-07）

- 没复现。没有拿用户的 3921 跑，临时窗口也没有可用模型，做不出「标签 A 采集、标签 B 填表、标签 C 打字」的现场。所以没有改填写、焦点和车道。`focusPageForInput` 失焦直接返回，没动。
- 加了日志，不改结果：填表最终没对上、以及走进 `Input.insertText` 时打 `[fill] tab= active= focused= method= matched=`。侧栏和 MCP 开工打 `[lane]`，分类结果和实际走的路分开记。`freeSoulRunning` 挡住旧学习时打 `[learn] swallowed …`。
- 代码审查，不是现场结论：
  1. 自由核心的 click / fill / press / snapshot 在 `runAgentTool` 入口拿 `agentTabId || activeTabId` 再传下去。真正不传、会落到用户当前标签的是：`setDxmProductTitle` 的 execute 和 fill、`translateDxmTitle` 的 clickText / execute、`repair12306QueryOnce` 的 `fill12306Form`、旧的 `runAgentTool`→`runWorkflow`、`menuClick` 里选菜单项的那次 `clickText`。侧栏 `handleChat` 一进来就把 `agentTabId` 设成用户正在看的标签，所以侧栏填表打的就是这张。
  2. `freeSoulRunning` 的早退只在 `openHelpAsk`、`applyHostLessons`、`answerLearning`。不包住 fill / click。门禁响了也只是旧学习没插话，不是工具被当成成功。
  3. 侧栏不走 `laneForText`。`handleChat` 用 `chatRunning` 串行，忙就排队并打断当前这轮。`enqueueForeground` 没有调用点。MCP 带 clientId 的任务写死 `background`。`laneForText` 兜底 foreground 目前没接到侧栏入口。
- 测试：`tests/parallel-log.test.ts`「填表失败日志带上标签、是否前台、是否有焦点」「车道日志分开记分类结果和实际走的路」「学习门禁早退单独记，不假装工具做成了」。
- 真机未跑。要看这三行日志，得重启 `npm run start` 后再做标签 A / B / C 那一场。

### T76（2026-11-07）

- 改动：`src/main/browser.ts`、`src/renderer/shell.html`
- 根因：不带 clientId 的 `submitTask` 走 `handleChat`，不进 taskPool。`stopAgentTask` 只搜任务卡，所以返回「没有可停止的任务」。
- 停止这条侧栏对话时 abort `activePiAbort`，mcp 记录标失败，对话写「已手动停止」。有排队就清掉 `pendingChat`，并补一句「排队的消息也一并取消了」。打断文案不再推进对话，复用 `manualStopIds`。`finally` 里 chatRunning / activePiAbort / agentTabId 的复位没动。侧栏仍不出任务卡。
- 输入区在 `chatRunning` 时显示红色「停止」，点击走 `spark:stop-task`，传 `sidebarTaskId`。空闲时藏起来。
- 测试：`tests/sidebar-stop.test.ts`「不进任务池的侧栏任务能停，排队取消，停完马上能再跑」「跑动中输入区有停止，空闲时藏起来」。单测日志有 `[task] stop <id> state=running`。
- 真机未跑。没有在窗口里点输入区「停止」，也没有用 MCP `stop_task` 停一条侧栏任务。停完再发新任务只在单测里跑过。

---

# T76 侧栏发起的任务停不了（T73 验收缺口）

## 现象

2026-11-07 真机验收实测：`submit_task` **不带 clientId**（= 用户在侧栏输入框直接发起的任务）running 中调 `stop_task`，返回「没有可停止的任务」，任务继续跑到自然结束。GUI 上侧栏任务也没有任务卡、没有任何停止入口。带 clientId 的 agent 任务停止已验收通过，本条只补侧栏路径。

## 根因（已定位）

`src/main/browser.ts` 的 `submitTask`（约 L7165）：`if (opts?.clientId) return this.submitAgentTask(...)`；无 clientId 时 `void this.handleChat(clean)`（约 L7183）——侧栏任务走 chat 流程，**不进 taskPool、没有任务卡**。

`stopAgentTask` 只搜 `this.taskPool?.tasks` 里的 live 卡（running / queued / waiting_human），搜不到 handleChat 里的任务，于是返回「没有可停止的任务」。

handleChat 的执行控制在三个字段上：`chatRunning`（约 L7091）、`activePiAbort`（约 L7119，传给 `freeSoul.run` 的 signal）、`pendingChat`（约 L7082，chatRunning 期间用户又发消息时排队，上一条跑完自动接着跑）。侧栏任务的 mcp 记录由 `rememberMcpTask` 维护，taskId 就是 `submit_task` 返回值；当前跑着的 taskId 在 `activeMcpTaskId`（约 L7181）。

## 改哪

`src/main/browser.ts`（stopAgentTask / handleChat / submitTask）、`src/renderer/shell.html`（输入区停止按钮）。

## 怎么做

1. **stopAgentTask 覆盖侧栏任务**：除池内卡外，再处理「`activeMcpTaskId` 对应的 mcp 记录还在 running / queued」的场景。停侧栏任务 = `this.activePiAbort?.abort()` + 该 mcp 记录置 failed（lastAssistant「已手动停止」）+ 侧栏会话追加一条「已手动停止」+ **清空 `pendingChat`**（停就要停干净，别让排队消息自动接着开跑；清了以后侧栏说明一句「排队的消息也一并取消了」，只在真有排队消息时说）。
2. **侧栏输入区加停止入口**：`chatRunning === true` 时，输入区显示「停止」按钮（发送按钮旁或替换发送位置，按现有 UI 风格做，红色系停止样式）。点击走已有的 `spark:stop-task` IPC，传 `activeMcpTaskId`。空闲时恢复原样。**不要**给侧栏轻对话出任务卡——侧栏每句话都跑 freeSoul，出卡会刷屏。
3. **手动停止的收尾自洽**：abort 后 `freeSoul.run` 返回 interruptedResult，handleChat 会把它 push 进 chatLog——手动停止场景下这条要覆盖为「已手动停止」，参考 `runAgentTask` 里 `manualStopIds` 的既有做法（复用同一个 Set 即可）。`finally` 里 chatRunning / activePiAbort / agentTabId 的复位路径不动。
4. MCP `stop_task` 传侧栏任务的 taskId 也能停（第 1 条天然覆盖，验收要覆盖）。

## 测试

- 单测：
  - handleChat 跑动中（freeSoul 永挂的假实现）stopAgentTask → mcp 记录 failed、chatLog 有「已手动停止」、`pendingChat` 被清、收尾后 `chatRunning === false`；
  - 带排队消息时停止，排队消息不接着跑；
  - 停止后立刻再发新任务，能正常跑（不被残留 abort / 状态卡住）。
- 真机：
  - 侧栏发起一个多步任务，跑动中点输入区「停止」→ 3 秒内出「已手动停止」、按钮恢复发送形态、马上再发一条新任务正常执行；
  - MCP `stop_task` 停侧栏任务同验。

## 验收

停止后不需要重启实例就能继续用侧栏。日志贴 `[task] stop` 一行。

---

# T77 sidebar 推送每拍仍发全量（T74 增量未生效）

## 现象（2026-11-07 复测实测数据）

模型恢复后跑 30 轮侧栏任务 + 32 轮 MCP agent 任务并行，`[push]` 日志全程：

- 任务跑动期 sidebar avgBytes 25800–29500，30 轮和 60 轮时数值相同（不再线性涨——窗口封顶了，但基线高一倍）
- **空闲拍也有 26500**（该分钟 req=1 flush=1，无任何新对话轮次）
- 对照基线：同实例 11-07 15:38 刚启动、无任务时固定字段约 11550
- 跳变证据：清朝 6 轮任务期间 avg 从 11627 直接跳到 28388——若 delta 生效，每拍只应带新增的几条 turn（几百字节到 2K），不该整段跳变
- 落盘 `chat-memory.json` 的 user 会话末 40 条窗口序列化约 15–25K，与 26K 吻合

## 两个假设（都能解释全部现象，第一步诊断区分，禁止跳过直接改代码）

- **(a) delta 每拍被判成 full**：cursor 被某处清空 / gap 判定频繁命中 / resync 循环（壳层 `applyChatFrame` 基线对不上 → `spark:chat-resync` → 主进程 chatResync=true → full → 壳层又对不上……）
- **(b) 固定字段膨胀**：sessions（多 agent 会话残留）、tasks、notes 等随使用累计涨到 26K，delta 本身其实是正常的

## 第一步：诊断（必须先做）

flush 路径（`browser.ts` 约 L3944，`getSidebarPayload(true)` 调用处）加一行诊断日志：

```text
[push-frame] key=<会话key> sync=<full|delta> chatN=<本拍对话条数> chatBytes=<n> totalBytes=<n> cursor=<n>
```

开发实例跑一个 10 轮以上任务 + 静置 2 分钟，贴出这些行。**完成记录里必须写清**：26K 里 chat 占多少、固定字段占多少、sync 是 full 还是 delta。没贴这个不许进入第二步。

## 第二步：按诊断结果对症修（二选一，两个都占就都修）

- **若 (a)**：修 cursor / gap / resync 逻辑。重点排查：
  - `chatSyncCursors` 是否被某处重置（注意 `getSidebarPayload()` 不带参的全量调用点：约 L1959 字节采样、约 L3348 `spark:get-status`——确认它们确实不动 cursor）；
  - 壳层 `spark:chat-resync` 是否被循环触发：什么场景下壳层 seq 与主进程 chatSeq 对不上；
  - 会话切换时 cursorMap 的 key 是否串了（agent 会话与 user 会话交替推送时）。
- **若 (b)**：固定字段瘦身。sessions 只发当前会话 + 活跃列表（标题/预览）；skills / notes / lessons / tasks 分频（仅变化时发）；chat 窗口从 40 条收紧到 20 条。壳层相应字段改为「缺省沿用上次」。

## 改哪

`src/main/browser.ts`（getSidebarPayload 约 L4038、flush 约 L3944）、`src/main/sidebar-sync.ts`、`src/renderer/shell.html`（若做分频）。

## 测试

- `planChatFrame` / `applyChatFrame` 现有单测保持全绿；
- 新增：模拟一次 resync 后，下一拍 full、再下一拍恢复 delta（证明不循环）；
- 若做固定字段瘦身：payload 构成回归测试（固定字段 JSON 序列化 ≤ 8K）。

## 验收（真机）

- 10 轮以上任务跑动中，`[push]` sidebar avgBytes ≤ 13000；静置 2 分钟后的空闲拍 ≤ 13000；
- 壳层对话渲染不回归：新轮次即时出现、换会话内容正确、壳层 reload 后对话恢复；
- 完成记录贴前后 `[push]` 对比数字和 `[push-frame]` 诊断行。

---

# T78 侧栏任务征用用户当前标签（T75 复测的结构性发现）

## 现象（2026-11-07 真机实测）

用户在标签 A 浏览，侧栏发「打开维基百科唐朝条目逐节汇报」→ 任务把**标签 A 直接导航走**，任务结束时 A 停在维基 API 页（实测 `list_tabs`：owner 为 "user" 的标签 cfeaeab3 标题变成 `wikitext section=11`）。对照：MCP agent 任务有独立标签（owner "agent:xxx"），从不碰用户页面。这是用户中午「Agent 操作浏览器时人没法用」反馈的结构性原因。

## 根因（已定位）

`src/main/browser.ts` 约 L7091：handleChat 开工时 `this.agentTabId = this.activeTabId`——侧栏任务的工作标签无条件设为用户当前标签，freeSoul 的 navigate 全打在它上面。

## 期望行为（验收标准）

- 用户在标签 A 浏览，侧栏发需要开站的任务 → **新标签 B** 打开目标站，A 不动；
- B 带侧栏任务归属（色点 + 横幅，参照 MCP agent 工位样式，名称用「侧栏」），任务完成后「已下班 · 页面已休眠」；
- 新建 B 不抢焦点、不把窗口拉回前台（沿既有承诺，完成只闪任务栏）；
- **「读当前页」类任务不受影响**：划词 / 页面引用（quotes）发送时仍作用用户当前标签；`page_text` 不带 tabId 仍读用户当前页；
- 下一个侧栏任务复用还开着的侧栏标签（同 MCP agent 复用逻辑）。

## 改哪

`src/main/browser.ts`（handleChat 约 L7091、navigate 工具的标签解析）、可能 `src/main/agent/mcp-sessions.ts`（复用 claimTabForClient 给逻辑 client "sidebar"）。

## 怎么做

1. handleChat 去掉无条件的 `agentTabId = activeTabId`。侧栏任务开工时 agentTabId 保持空，freeSoul 工具在侧栏任务作用域内**首次需要页面时**：若无绑定标签则新建（不抢焦点）并 claim 归属，之后都打这张。
2. 带 quotes（划词 / 页面引用）或用户明确指当前页的任务：工作标签就是当前 active（现状行为），不新建。
3. 归属 owner 记为 `agent:sidebar`，横幅 / 色点走现有 agent 渲染链路（工位号给侧栏留一个固定位）。
4. `chatRunning` 期间侧栏任务与 MCP agent 任务并存时各用各的标签，互不干扰（T75 已验证的并行不回退）。

## 测试

- 单测：无 quotes 的侧栏任务 navigate 一次后 `ownerForTab(新标签) === "agent:sidebar"`，用户 active 标签 url 不变；带 quotes 的任务不新建标签；第二个侧栏任务复用同一张侧栏标签。
- 真机：标签 A 百度 + 侧栏维基任务 → A 仍是百度、B 维基带横幅；划词发送 → 作用当前页不新建；任务跑动中用户继续在 A 打字搜索不受影响。

## 红线提醒

不向网页注入 DOM；用户标签不染色不加横幅；新建标签不抢焦点。修 UI 的提交不混入脑区 / 推送层改动（T77 与 T78 分开提交）。
