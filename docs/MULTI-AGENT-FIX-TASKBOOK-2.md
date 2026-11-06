# 多 Agent 并行缺陷修复任务书 二期（T70–T72）

状态：执行中（T70 已改，T71 / T72 未做）。来源：2026-11-06 T66（工位横幅+机器人）真机验收。T66 本体验收通过（运行态/下班态横幅、勿扰胶囊、工位号、色点、用户页面零改动均过），本文件只处理验收暴露的 3 个缺陷。

**执行顺序：T70 → T71 → T72。** T72 是取证任务，不做完调查不许改渲染层代码。

---

## 全局红线（与一期相同）

1. `CHROME_H` 保持 76，顶栏 36+40 网格不动。
2. 不向网页注入 DOM/CSS，标识只在壳层。
3. 用户标签不染色、不加横幅、不显示 roster。
4. 每条至少一个 commit，`git add` 逐文件列名，禁止 `git add -A`。
5. 改完 `npm run typecheck` 退出码 0 + `npm test` 全绿，再做下一条。
6. 修 UI 的提交不得混入脑区/工具层改动。
7. 新增会提前结束任务、绕过脑区或改走向的本地判断，先写进 `docs/DECISION-POINTS.md` 再合码。

---

# T70 「已下班」横幅被内存节省器抹掉

## 现象（真机已复现）

agent 任务完成后，横幅正常显示「N号工位已下班 · 名字 · 页面已休眠」。**闲置约 5 分钟后（memorySaver 开启时），横幅消失**。此时 `list_tabs` 返回该标签 `agentState: "idle"`（应为 `"done"`）、`agentStatus` 为空；标签色点、owner 归属均正常。切到该标签看不到任何横幅。

## 根因（已定位，不要重查）

`src/main/browser.ts` 的 `discardTab`（约 1402–1435 行）在两处无条件 `delete tab.agentStatus`（约 1408、1433 行）。三条调用路径：

| 路径 | 位置 | discard 后是否补设 done |
|---|---|---|
| `releaseAgentTab` | 约 1011–1021 行 | ✅ 1018 行补设 `tab.agentStatus = "done"` |
| `autoDiscardIdleTabs`（memorySaver 自动休眠） | 约 1478–1493 行 | ❌ 不补 |
| `discardInactiveTabs`（手动全休眠） | 约 1461–1476 行 | ❌ 不补 |

任务完成后横幅的「已下班」态依赖 `listTabs` 里 `t.agentStatus === "done"` → `agentState: "done"`（约 1630–1632 行）。自动休眠触发 `discardTab` 把标记删掉，`agentState` 退化 `"idle"`，横幅（渲染条件 `agentState && agentState !== "idle"`，shell.html 约 2476 行）消失。

矛盾点：下班横幅文案就是「页面已休眠」——设计意图是休眠后仍显示，但 `discardTab` 恰好把标记删了。`releaseAgentTab` 的「先 discard 再补设」已经表明了正确意图，只是另外两条路径漏了。

## 怎么改

**方案（推荐）：`discardTab` 不再删 agent 归属标签的 `agentStatus`。**

1. `discardTab` 里两处 `delete tab.agentStatus` 改为：仅当该标签 owner 不是 agent 时才删（用 `ownerForTab(id)`，非 `agent:` 开头才删）。agent 标签的 `agentStatus` 保留。
2. `releaseAgentTab` 1018 行的补设保留不动（幂等，无害）。
3. 清理职责维持现状不变：`closeTab`（约 1743 行已有 `delete tab.agentStatus`）负责关标签时清；任务复用标签时（约 6939 行 `delete reused.agentStatus`）负责开新任务时清。检查一遍这两处仍然覆盖。
4. 排查副作用：`agentStatus === "done"` 的消费点只有 `listTabs` 输出、`renderChrome` 的 tab.done 样式（「已完成」小标）和 tooltip。保留后休眠 agent 标签会同时带 sleeping + done 两个标记，视觉上是「休眠的已完成标签」，符合预期。确认 `wakeTab`（约 1437 行起）不清 `agentStatus`（现状就不清，不要加）。

## 测试

- 单测：`discardTab` 对 agent 归属标签休眠后 `agentStatus` 保留；user 标签休眠后仍删除；`closeTab` 后清空。
- 单测：`autoDiscardIdleTabs` 路径下 agent 标签 `listTabs().tabs[i].agentState === "done"`。

## 验收（真机）

1. 提交一个短任务等它完成，确认横幅「已下班 · 页面已休眠」。
2. 设置里把 memorySaver 闲置时间调到最短（或等 5 分钟），确认标签进入休眠（标签栏月亮标记）后，横幅**仍然**显示「已下班」，`list_tabs` 里 `agentState: "done"`。
3. 关掉该标签重开新标签，确认无残留标记。

---

# T71 「使用中」roster 被对话滚出视口

## 现象（真机已复现）

agent 任务运行中，侧栏看不到「使用中 N」行和 agent 按钮（名字 + 12px 同色机器人）。数据与渲染均正常——验收时临时日志证实 `renderAgentRoster` 收到 `agents.length === 1`（sessions 含 `agent:<clientId>`）并执行了渲染。纯视觉位置问题。短对话时能看到（Q24 验收通过的原因），**对话一长必然看不到**。

## 根因（已定位，不要重查）

`src/renderer/shell.html`：

1. `#agentRoster`（DOM 约 1983 行）位于 `.thread` 容器（CSS 约 709 行：`flex: 1; min-height: 0; overflow: auto`）的**内容流顶部**，welcome 卡之下、`#taskStrip` 之上。
2. `applySidebar` 每次收到 sidebar state 且 `payload.chat.length` 非空时调用 `scrollDockIntoView()`（约 3465 行），把 `.dock`（对话底部）滚进视野——即滚动位置被钉在底部。
3. 任务多轮汇报后 chat 变长，`.thread` 滚到底，顶部的 roster 被滚出视口。

## 怎么改

**方案（推荐）：roster 变 sticky，不挪 DOM。**

1. `.agent-roster` CSS（约 177–199 行）增加：
   ```css
   position: sticky;
   top: 0;
   z-index: 1;
   background: var(--side);
   ```
   （`--side` 与侧栏底色一致，滚动穿过时不透字。）
2. 检查 `padding: 8px 12px 0`——sticky 后顶部贴边可能需要补一点下 padding 或给 `border-bottom` 一条 `var(--line)` 细线，避免对话文字贴着 roster 滚过。以真机效果为准。
3. 不改 `renderAgentRoster` 的 JS 逻辑（数据链是对的）。
4. 备选方案（如果 sticky 在该布局下有副作用）：把 `#agentRoster` DOM 挪出 `.thread`，放到 `.thread-tools` 行（约 1933 行）同一水平区域或其上方。DOM 挪动需同步确认 `body.side-collapsed` 折叠态不破版。

## 测试

- 无现有单测覆盖渲染层滚动，不强求新增；如项目里有 shell 渲染测试基建则补一条「roster 存在且 sticky」即可。

## 验收（真机）

1. 跑一个多轮任务（读维基长条目，10 轮以上汇报）。
2. 任务运行中，侧栏已滚到对话底部时，顶部仍**固定可见**「使用中 N」+ agent 名 + 12px 同色机器人。
3. 无 agent 会话时该行完全消失、不留空白、不出现细线残留。
4. 侧栏收起（Ctrl+\）再展开，布局不破。

---

# T72 shell 渲染进程崩溃排查（先取证，禁止盲修）

## 现象（crash.log 已有记录）

```
2026-11-06T09:29:33.829Z [render-process-gone] reason=crashed exitCode=-1 url=http://localhost:5173/shell.html
2026-11-06T09:29:33.830Z [shell-render-gone] crashed
```

崩溃后自动 `reload()`（browser.ts 约 1083–1091 行）执行了，但 09:33–09:34 仍连续出现 `[shell-unresponsive] sidebar`。用户可见症状：标签栏/地址栏/侧栏整块消失，窗口只剩系统按钮 + 全屏网页视图；**同期 agent 任务照常推进**（页面视图进程独立）。

背景：crash.log 里 `[shell-unresponsive] sidebar` 长期反复出现（本次验收当天就有 30+ 条）。这次第一次拿到了 `render-process-gone reason=crashed` 的实锤。

触发时机（本次）：agent 任务 done → 用户侧栏随即提交新任务 → `syncTaskChrome`/`pushSidebarState`/`pushChromeState` 推送密集期。开发实例（vite dev，localhost:5173）。

## 已知事实与不确定项

- 崩溃的是 shell 渲染进程（BrowserWindow 的 webContents），不是主进程，也不是页面视图。
- `exitCode=-1`、`reason=crashed`，无堆栈——Electron 不给渲染进程崩溃堆栈。
- 不确定：是 OOM、GPU 合成崩溃，还是渲染层 JS 风暴（chrome-state 100ms 节流推送 + chat-log 全量 innerHTML 重渲染）。
- 未验证安装包（非 dev server）是否复现。

## 怎么做（只做 1–3，先出报告）

1. **加强取证**（`src/main/browser.ts` render-process-gone 处理 + `src/main/index.ts`）：
   - 崩溃时记录：窗口 bounds、标签数、`chatBook()` 各会话条数、`taskPool` 状态、距上次 `[shell-unresponsive]` 的时间差；
   - dev 模式下给 shell webContents 每 30 秒采一次 `process.getProcessMemoryInfo()`（在渲染层执行 `executeJavaScript` 取，或用 `app.getAppMetrics()` 里 renderer 条目），写进 diag 日志；
   - `[shell-unresponsive]` 记录时附带当前 sidebar-state 序列化体积（`JSON.stringify(payload).length`）。
2. **统计推送压力**：在 `pushChromeState`/`pushSidebarState` 加计数器（每分钟聚合一行日志：次数 + 平均 payload 字节），确认 100ms 节流是否被频繁打满。
3. **复现**：写一个脚本走 MCP 连续提交任务（done 后立即再提交），循环 5 次，观察是否触发 render-process-gone。开发实例跑；如能复现，再用 `npm run dist` 的安装包复测一次，区分「dev server 特有」还是「普遍」。
4. **修复立项另出任务书**：拿到数据后按结论（OOM → chat-log 渲染瘦身；GPU → 关硬件加速灰度；推送风暴 → 加大节流/增量渲染）单独立项，本条不做修复。

## 验收

- 提交取证报告：崩溃前后的 `[mem]`/payload 体积/推送计数数据；
- 复现脚本 + 是否复现的结论（复现几次、间隔多久）；
- 不改任何渲染层行为代码（加日志除外）。

---

## 完成定义

- T70/T71 各自真机验收项全过，`npm test` 全绿；
- T72 出取证报告并给出修复方向建议（修复本身另行立项）；
- 本文件状态改为「已完成」，并在 `docs/PRODUCT-TASKBOOK.md` 现行任务区登记。

## 完成记录

### T70（2026-11-06）

- 改动：`src/main/browser.ts`、`tests/memory-diet.test.ts`
- `discardTab` 两处不再无条件删 `agentStatus`。owner 不是 `agent:` 才删。`releaseAgentTab` 的补设、`closeTab`、新任务复用时的 delete 都没动。`wakeTab` 仍不清。
- 测试：`tests/memory-diet.test.ts`
  - 「agent 标签休眠后保留已下班，用户标签仍清掉」
  - 「没有视图的 agent 标签休眠也不清已下班」
  - 「关掉标签后已下班标记清空」
  - 「自动休眠后 listTabs 仍是 done」
- 真机未跑。没有等 5 分钟看休眠后横幅是否还在「已下班 · 页面已休眠」。
