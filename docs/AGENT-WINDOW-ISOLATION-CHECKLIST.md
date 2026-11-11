# 抢窗口问题清单（多 Agent / 多窗口）

> 触发：2026-11-11 老板问「不同 agent 窗口会互相抢窗口吗？我怎么感觉刚才你好像抢我窗口了」。
> 结论：**会。窗口级隔离没做完。** 对话记忆已按 clientId 隔离（`a84df2f`），但「谁能让哪扇窗、哪个标签变到前台」没有归属校验。
> 适用版本：0.5.0 之后（下一个版本）
> 修订：v2（2026-11-11，按 Cursor 代码核对结果补 3 条路径、改 2 条口径）

## 一、一句话结论

整个进程只有 `BrowserWindow` 的多开实例，没有「每扇窗只归一个 client」的硬门。`switchTab()`、`switch_tab` 工具、`createEnvTab()`、`navigate()`、`ensure_render()` 这几条路都能改到用户正在看的窗口和标签。

## 二、清单

| # | 严重度 | 现象（用户体感） | 触发路径 | 代码位置 | 影响 | 修复取向 |
|---|---|---|---|---|---|---|
| 1 | P0 | 正在看的标签突然换成 agent 的页面，地址栏跟着变 | 任意 agent 调用 `switchTab(id)`；`ensure_render` 内部也会调 | `src/main/browser.ts:2120-2131` | 无任何归属校验，谁调谁切；`focus:false` 只跳过聚焦，**照样改 `activeTabId`** | 加 `actor` 门：非本窗 client 只能切自己的标签；切用户标签只认用户动作 |
| 2 | P0 | 窗口从最小化自己弹回屏幕（不夺焦，但闪出来） | `ensure_render` → `engageBackgroundRender(client, quiet=true)` | `src/main/browser.ts:8127-8146`、`8065-8095` | `quiet=true` **跳过** `clientOwnsWindow` 判断，任何 client 都能 `win.restore()+showInactive()` 别人的窗 | 归属判定不因 `quiet` 放行；不属于自己 → 直接拒绝，不 restore |
| 3 | P0 | 用户当前页被打开新网址/被点按/被改 DOM | 不带 `tabId` 调 `navigate` / `click` / `fill` / `execute` / `select` / `upload` / `click_text` / `menu_click` / `press` / `reload` / `go_back` / `go_forward` / `fill_suggest` | `browser.ts:12317`（`viewForTab(tabId \|\| this.activeTabId)`）；默认值 12 处：`5196 / 6663 / 6937 / 7623 / 8938 / 9224 / 9258 / 9300 / 9342 / 9862 / 9875 / 9910`（**这些是赋值行，多数比函数签名差 1 行**） | 无 clientId 的 MCP 调用（未 `initialize`、老客户端、裸 HTTP）`bind()` 返回 `undefined`，下游回落 `activeTabId` | `mcp-server.ts` 里**写操作**无 clientId 且无 tabId → 明确拒绝，不再回落 |
| 4 | P0 | 用户窗口里的标签栏被换成 agent 标签，归还后也不切回 | `ensureRender` 成功后 `switchTab(id,{focus:false})` | `browser.ts:8135` | 后台渲染必须让目标标签被 `mountPageView`（非 active 会被 `parkPageView`，见 `3271-3291`），代价是改掉可见标签 | 记下用户原标签，归还时/用户拉回窗口时切回；只在**本 client 拥有的窗**里做 |
| 5 | P0 | 外部 agent 一行 `switch_tab` 就把用户标签切走 | MCP 工具 `switch_tab`；`tools/index.ts` 的 `switch_tab` 直接转发，不传 actor | `src/main/mcp-server.ts:660`、`src/main/tools/index.ts:152` | 这是第 1 条的公开入口，只收 `id`，完全绕过任何身份 | 传当前 `clientId` 作为 actor；无 clientId → 拒绝，且不改 `activeTabId` |
| 6 | P0 | agent 带 `envId` 打开环境页，用户当前标签被切走 | `createEnvTab()` 末尾无条件 `switchTab(id)`；`navigate({envId})` 走这里 | `src/main/browser.ts:1882`，调用点 `12304`、`6117`、`6320` | 环境标签创建即激活，与谁调用无关 | `createEnvTab(id, { userAction })`：用户重开/壳层 IPC 传 `true`；agent 路径不传，门拒绝后保持原标签 |
| 7 | P1 | 用户在 A 窗看的标签被 agent 休眠，白屏/重载 | `releaseAgentTab()` 用 `tabId === this.activeTabId` 判断 | `browser.ts:1283-1293`（判断在 `1287`） | `activeTabId` 是**按 `activeWinId` 取**的（`786-789`），A 窗的标签在 B 窗激活时保护失效 | 改成按标签自己的 `tab.winId` 取该窗 active |
| 8 | P1 | 第一个连上的 agent 能把自己的窗 `show()+focus()` 拉到最前 | `safeFocusClientWindow` → `clientOwnsWindow` | `browser.ts:723-732`、`739-757` | 未绑定 + 只有一扇窗时返回 `true`，新 client 直接当窗主 | 本次口径：未绑定且该窗已有别的 agent → `false`；**空窗仍 `true`**。「未绑定一律不 show/focus」留到后续 |
| 9 | P1 | 侧栏新标签把用户当前页顶掉 | `bindClientTab` 的 `activate` 条件 | `src/main/agent/mcp-sessions.ts:198` | `clientId === SIDEBAR_CLIENT_ID && others.length === 0` 只看「本窗其他 client」 | **本次不改**，登记为后续项 |
| 10 | P2 | `list_tabs` 显示 owner 正常，但操作仍落到用户标签 | MCP `scope` 为空 | `src/main/mcp-server.ts:87-96`、`992-1014` | 无 clientId 时 `bind` 原样返回 `tabId`（可能是 `undefined`），与带 clientId 的行为不一致 | 写工具统一要求 clientId 或显式 tabId，错误信息说人话 |
| 11 | P2 | 还没 `submit_task` 的新 client 切不了自己的标签 | `switchTab` 直接用 `actor.winId` 比较 | `src/main/browser.ts` `switchTab` 门内 | client 未绑窗时 `winId` 为空，自己的标签被判 `other_window`（V7 真机暴露，本次门引入） | **已修**：actor 缺 `winId` 时取 `clientWindows.get(clientId) \|\| activeWinId`，不用 `tab.winId`（`browser.ts:2167-2170`） |
| 12 | P2 | MCP 客户端指定 `envId` 仍开成普通标签，环境隔离不生效 | `bind()` 先分配标签，`navigate` 带 `tabId` 后不再走 `createEnvTab` | `mcp-server.ts` `bind`、`browser.ts:12304` | 老行为，本次未改；V8 未覆盖到环境标签 | 另开任务改 `bind`/`navigate` 的 `envId` 分支 |

## 三、已经是对的（不在本次范围）

- 对话记忆按 `clientId` 隔离：`src/main/browser.ts:8509`、`turnsFor(agentTaskChatKey(...))`。
- 任务建标签默认不激活：`createAgentTab(url?, activate=false)`（`1273-1276`）。
- 任务绑定后还原用户标签：`runAgentTask`（`8483-8488`）；`ensureSidebarWorkTab`（`6029`）与 `submitAgentTask`（`8432`）在绑定后还原 `before`。三者都是「还原」，不是「切走」，加 `userAction: true` 合理。
- `runScoped`（`8657`）的 `finally` 本身不切标签，不要把它误当成还原点。
- 用户点标签栏走 IPC `spark:switch-tab`（`3843`），属用户动作，不受新门限制。
- `focusActivePage()` 已有归属分支（`3715-3730`），不用重写。

## 四、验收口径（可断言）

1. 用户窗 A 停在 `weibo.com`；client X 带自己的标签调 `navigate("https://example.com")` → A 的 `activeTabId` 与 URL 全程不变。
2. client Y（不属于 A 窗）调 `ensure_render(tabId)` 指向 A 窗标签 → 返回失败，A 窗保持原状态（最小化就继续最小化）。
3. 无 clientId、无 tabId 调 `click`/`fill`/`navigate`/`press`/`reload` → 返回明确错误，用户页不动。
4. 无 clientId 调 `switch_tab` → 拒绝，`activeTabId` 不变。
5. agent 调 `navigate({ envId })` → 新环境标签创建但不成为用户当前标签。
6. 侧栏在自己的窗口跑任务，`list_tabs` 的 `activeTabId` 在任务前后相同。
7. `npx tsc --noEmit` 0 error；`npm test` 除既有 `tests/chrome-hole.test.ts` T2 外全绿。
8. G1–G3 黄金场景不回退（见 `docs/QA-GOLDEN-SCENARIOS.md`）。
