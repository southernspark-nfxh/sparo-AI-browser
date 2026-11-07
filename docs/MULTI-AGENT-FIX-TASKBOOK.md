# 多 Agent 并行缺陷修复任务书（T56–T62）

状态：待执行。来源：2026-11-06 真机验收。上一轮 T47–T54 已验收通过 Q23/Q25/Q26，本文件只处理验收暴露的 6 个缺陷。

**执行顺序：T56（取证）→ T57 → T58 → T59 → T60 → T61 → T62。**
T56 不做完不许改代码——现在没有崩溃现场，任何"顺手修一下"都是猜。

---

## 全局红线

1. `CHROME_H` 保持 76，顶栏 36+40 网格不动。
2. 不向网页注入 DOM/CSS，标识只在壳层。
3. 用户标签不染色、不加横幅。
4. 每条至少一个 commit，`git add` 逐文件列名，禁止 `git add -A`。
5. 改完 `npm run typecheck` 退出码 0 + `npm test` 全绿，再做下一条。
6. 修 UI 的提交不得混入脑区/工具层改动。

---

# T56 崩溃取证与内存护栏（先取证，禁止盲修）

## 现象

agent 任务「读维基百科第二次世界大战条目、逐节汇报」跑到第 28 轮时，整个 Sparo 进程消失。日志最后一条是正常工具返回，**没有 JS 异常、没有堆栈**。同一时段连续切标签后壳层（标签栏/地址栏/侧栏）整体空白、点击失效，最小化再还原才恢复。

## 已知事实与不确定项

- 现场日志显示该任务每轮 `page_text` 返回 80000 字符（r2/r4/r8/r14 均满额），共 28 轮。
- 日志里 `[chrome-hole] heal` 在崩前 20 秒内每 2 秒触发一次，连续 10+ 次，old/new 两次 bounds 完全相同。
- 不排除是我方用 `npm run start` 后台启动、被工具链在超时后终止（该后台命令退出码 -1）。**在拿到独立进程的崩溃日志前，不得断言是代码崩溃。**

## 改哪

`src/main/index.ts`（或 app 启动入口）、`src/main/browser.ts`。

## 怎么做

1. 加进程级取证，全部写 `%APPDATA%\sparo-store\diag\crash-YYYYMMDD-HHmmss.log`：
   - `process.on("uncaughtException")`、`process.on("unhandledRejection")`；
   - `app.on("render-process-gone", (_e, wc, details) => ...)`，记录 `details.reason`、`exitCode`、`wc.getURL()`；
   - `app.on("child-process-gone", (_e, details) => ...)`。
2. 加内存采样：仅 dev（`!app.isPackaged`）时每 30 秒写一行
   `[mem] rss=<MB> heapUsed=<MB> heapTotal=<MB> external=<MB> tabs=<n> running=<n>`。
   崩前最后 10 行足以判断是不是 OOM。
3. 检查并记录（不改逻辑，只在完成记录里写结论）：
   - `chatLog` 是否有单会话条数上限；
   - 传给模型的 `history` 是否截断（多轮 80000 字页面文本是否整段进上下文）；
   - `page_text` 80000 字符全文是否每轮重复入栈。
4. 如果第 3 步确认有「全文重复入栈且无上限」，**先只写测试证明会无限增长**，修复放到 T63 单独立项，不要在本条顺手改。

## 验收

- 用独立窗口启动（不要用会被工具超时杀掉的子进程），复现一次长任务；
- 人为触发 `process.emit` 一次测试异常，确认 crash 日志落盘；
- 完成后贴出 `diag/` 下新增文件名和 `[mem]` 最后 10 行。

---

# T57 页面视图 heal 死循环（白屏与卡顿的直接嫌疑）

## 现象

验收日志显示 `[chrome-hole] heal` 每 2 秒一次、连续 10+ 次，且每次打印的 `old`（视图实际 bounds）与 `new`（上报的洞）**完全相同**，例如：

```
[chrome-hole] heal old={"x":0,"y":76,"width":966,"height":829} new={"x":0,"y":76,"width":966,"height":829}
```

同时期出现壳层空白、点击失效。这条循环在 T52–T54 之前就存在（`armChromeGuard` 是旧机制），但新增的 banner 显隐会在切标签时反复改变洞高度，有放大嫌疑。

## 根因（已定位）

`src/main/page-bounds.ts:43` 的 `pageViewCoversChrome` 只返回 `true/false`，不告诉你命中的是哪一条：

```ts
if (actual.y < hole.y - 1) return true;
if (actual.x < hole.x - 1) return true;
if (actual.width > hole.width + 4) return true;
if (actual.x + actual.width > hole.x + hole.width + 4) return true;
if (actual.height > hole.height + 8) return true;
```

`src/main/browser.ts:2523` 命中后走 heal，但 heal 里 `applyViewBounds` 再次计算 bounds 时，若 `pageBounds()` 与上报的 hole 存在 >1px 的持续差异（例如侧栏宽度、1px 取整、banner 高度变化），视图被设回后仍满足覆盖条件，于是下个 2 秒又 heal。日志里 old==new 正是"设了等于没设"的表现。现有 `takeChromeCoverFix` 只有 200ms 去抖，挡不住 2 秒一次的长尾循环。

## 改哪

`src/main/page-bounds.ts`、`src/main/browser.ts`。

## 怎么做

1. `pageViewCoversChrome` 改为返回命中分支，保留布尔语义的包装避免改动调用方：

```ts
export type CoverReason = "y" | "x" | "width" | "right" | "height" | null;
export function chromeCoverReason(actual: PageRect, hole: PageRect): CoverReason { ... }
export function pageViewCoversChrome(a: PageRect, h: PageRect): boolean {
  return chromeCoverReason(a, h) !== null;
}
```

2. heal 日志加分支与差值：`[chrome-hole] heal reason=width dw=281`，让下次真机一眼看出是哪条在抖。
3. 加「无进展抑制」：同一标签连续 heal 且 `applyViewBounds` 后视图 bounds 与 heal 前在 1px 内（即没修动），累计 3 次后**停止对该标签的 heal**，写一条 `[chrome-hole] give-up tab=<id> reason=<r>`，直到窗口 `resize`/`restore`/`switchTab` 时重置。
   - 注意：`restore` 已有的 `resetChromeCoverBudget` 要一起重置这个计数。
4. 不许把 2 秒守卫整体删掉——它救的是真实白屏。只加抑制。

## 测试

- `chromeCoverReason` 单测：6 种输入分别命中正确分支，正常矩形返回 null。
- 抑制逻辑单测：连续 3 次同几何 heal 后第 4 次不再调 `applyViewBounds`；`switchTab` 后计数归零。
- 真机：连续切标签 15 次，日志里 heal 不得出现连续 3 次以上 old≈new；壳层不得白屏。

---

# T58 32px 归属横幅从未显示

## 现象

三次真机验收（任务运行中、等你态、崩前）都没看到横幅。日志可证：整个会话期间页面视图 bounds 的 `y` 恒为 76，从未出现 76+32=108，说明壳层从未上报带横幅的洞。

## 根因（已定位）

`listTabs` 的 `agentState` 依赖 `taskPool.tasks` 里存在该 `tabId` 的任务（T52 实现）。而**任务池状态变化时没有推送 chrome-state**：任务入池时 `tabId` 还是空字符串，真正绑上标签是在 `runAgentTask` 里才补；此后每轮跑动、排队、完成都不触发 `pushChromeState()`。壳层手上的 `chromeState` 是任务开始前的快照（那时 `agentState` 还是 undefined/idle），所以 `renderAgentBanner` 一直隐藏。任务结束时推一次，此时任务已 `finish` 移出池 → 又回到 idle。

## 改哪

`src/main/browser.ts`、`src/main/agent/task-pool.ts`、`src/renderer/shell.html`。

## 怎么做

1. `submitAgentTask` 入池时就把 `tabId` 定下来：先 `bindAgentTab(clientId)` 拿 tab，再 `enqueue({ ..., tabId })`，不要先建卡后补。
2. 池状态每次变化后统一推一次：
   ```ts
   private syncTaskChrome(): void {
     this.pushChromeState();
     this.requestHoleReport();
   }
   ```
   在 `start / markRunning / setStep / suspend(waiting_human) / finish / pumpAgent` 之后调用。
   **注意频率**：`setStep` 可能每轮调一次，`pushChromeState` 里做 100ms 节流，避免每步都全量重绘壳层。
3. `agentState` 计算补一层兜底：任务已 `finish` 但标签还在时，用 `tab.agentStatus === "done"` 返回 `"done"`，不要返回 `idle`（这条同时修 T59）。
4. 壳层 `renderAgentBanner` 增加一个断言式日志：`hidden` 变化时 `console.log("[banner]", show, name, state)`，真机验收时可直接确认。

## 测试

- 单测：任务从 queued→running→done 的过程中，`pushChromeState` 至少被调用 3 次；`listTabs` 的 `agentState` 依次为 `"queued"→"running"→"done"`。
- 真机：提交一个任务，任务一开始就切到它的标签，横幅必须在 1 秒内出现且高度 32px；任务结束后横幅变成「已完成 · 页面已休眠」而不是消失。

---

# T59 任务完成后状态丢失

## 现象

任务跑完后，标签 tooltip 显示「空闲」，横幅消失。设计文档要求显示「已完成 · 页面已休眠」。

## 根因

`taskPool.finish` 把任务从 `tasks` 移出后，`listTabs` 找不到任务、`tab.agentStatus` 又没在 finish 时置为 `"done"`（目前只在标签被 discard 时才置），于是落到 `"idle"`。壳层 `agentState !== "idle"` 才显示横幅，自然消失。

## 改哪

`src/main/browser.ts` 的 `runAgentTask` finally 与 `listTabs`。

## 怎么做

1. `runAgentTask` 的 `finally` 里，`taskPool.finish(...)` 之前给该标签打 `agentStatus = "done"`（用局部 `tabId`，不要用 `this.agentTabId`）。
2. 标签被复用于新任务时重置 `agentStatus = "running"`；标签被 discard 时清空。
3. `listTabs` 保持返回 `agentState: "done"`，横幅文案走「已完成 · 页面已休眠」。

## 测试

- 单测：任务结束后 `listTabs()` 里该标签 `agentState === "done"`；重新派任务后变 `"running"`；标签关闭后字段清空。

---

# T60 agent 任务中新开的标签没有归属

## 现象

任务执行中打开的第二个页面（维基条目）没有色点、没有横幅，被当成用户标签。

## 根因（已定位）

`src/main/agent/mcp-sessions.ts` 的 `owners` 只在 `bindClientTab`（或等价登记函数）时记录**一张**标签。任务过程中通过 navigate/点链接触发的新建标签没有任何登记路径，`ownerForTab` 返回空 → 壳层按用户标签处理。

## 改哪

`src/main/agent/mcp-sessions.ts`、`src/main/browser.ts`。

## 怎么做

1. 新增 `claimTabForClient(clientId, tabId)`（若无则复用现有的登记函数），允许一个 client 拥有多张标签。
2. 在**任务作用域内**创建标签的所有路径上调用它：`createTab` / `createAgentTab` / `navigate` 新建标签的分支。判断是否在 agent 任务里，用 `this.taskStore()?.chatKey?.startsWith("agent:")` 取 clientId，不要靠全局变量。
3. `ownerForTab` 支持多标签；`bindClientTab` 取最近一次登记的标签作为主标签。
4. 用户自己手动新建的标签（不在任务作用域内）不登记。

## 测试

- 单测：模拟一个 agent 任务连续创建 3 张标签，`ownerForTab` 三张都返回同一个 `agent:<id>`；在作用域外创建的第 4 张返回空。
- 真机：让 agent 读一个会开新页的任务，新标签必须带同色色点和横幅。

---

# T61 「使用中 11」列的是历史，不是当前

## 现象

侧栏显示「使用中 11：验收甲 验收乙 … VisualQA2」，把之前所有接入过的 agent 都列出来。实际在用的只有 0–3 个。

## 根因（已定位）

`src/main/browser.ts:861` 的 `sessionViews()`：

```ts
const keys = new Set<string>(["user"]);
for (const key of this.chatBook().keys()) keys.add(key);
```

`chatBook()` 保留所有产生过对话的会话（agent 会话不落盘但常驻内存），因此历史全会进来。

## 改哪

`src/main/browser.ts` 的 `sessionViews()`。

## 怎么做

1. 只列满足任一条件的会话：`running > 0`、`queued > 0`、`waiting_human > 0`，或该 agent 仍有未关闭的标签（`ownerForTab` 命中）。
2. `user` 永远保留并排第一。
3. 已经没有任何痕迹的 agent 会话从 `chatBook` 里删掉它的 key（内存回收），避免越积越多。删除前确认 `selectedSession` 不是它，是则回落到 `"user"`。

## 测试

- 单测：3 个 agent 跑完并关标签后，`sessionViews()` 只剩 1 个 user；其中 1 个仍在跑时返回 2 个。

---

# T62 中文 agent 名显示成「?????」（先复测，不急着改代码）

## 现象

标签 tooltip 显示 `????? · 空闲`，而不是「视觉验收员」。

## 先判断责任方

验收时用 PowerShell 5 的 `Invoke-WebRequest -Body '<含中文的 JSON>'` 发送，PS5 默认按非 UTF-8 编码发送，中文在到达服务端前就会变成 `?`。**这很可能是测试方法的问题，不是产品 bug。**

## 怎么做

1. 用 UTF-8 明确编码复测一次：`[System.Text.Encoding]::UTF8.GetBytes($json)` 作为 `-Body`，或直接用 Node 的 `fetch`（本项目已有 Node）。
2. 若 UTF-8 发送后仍显示 `?????`，再查两处：
   - `mcp-server.ts` 读 body 是否 `Buffer.concat` 后 `toString()` 默认 UTF-8；
   - `registerClientName` 是否做了 ASCII 清洗。
3. 如果是字体渲染（UIA 抓文字得到 ???? 但截图正常），不算 bug，在完成记录里注明。

## 测试

- 单测：`registerClientName(id, "验收甲")` 后 `name` 必须是原字符串，长度按字符数截断（不是字节数）。

---

## 完成交付

写入 `docs/FREE-SOUL-TASKBOOK.md` 末尾，逐条写：改动文件、根因一句话、测试名、真机步骤、未验证项。

**特别要求**：T56 的 `diag/` 日志与 `[mem]` 采样必须贴出来；T57/T58 必须贴真机日志片段（heal 不得连续 3 次 old≈new；`[banner] true ...` 出现过）。没跑真机就写没跑。
