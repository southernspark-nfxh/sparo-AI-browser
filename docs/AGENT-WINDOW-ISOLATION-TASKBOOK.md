# 任务书：多 Agent 窗口/标签互不抢占

> 版本：0.5.0 之后（建议 0.5.1）
> 依据：[AGENT-WINDOW-ISOLATION-CHECKLIST.md](./AGENT-WINDOW-ISOLATION-CHECKLIST.md)
> 前置：`git status` 干净；`a84df2f`（对话记忆隔离）已在 master
> 执行：把本文件连同 Checklist 一起交给 Cursor，读完再动手

## 背景（Cursor 必读）

Sparo 是 Electron 单进程应用，可以开多扇 `BrowserWindow`，每扇窗里用 `WebContentsView` 承载多个标签。外部 Agent 通过 MCP（`http://127.0.0.1:3921`）接入，`initialize` 时拿到 6 位 `clientId`，之后每个请求带 `x-sparo-client` 头。

0.5.0 已把**对话记忆**按 clientId 隔离，但**窗口和标签的激活**仍是全局的：任何 client 调 `switchTab()` 都会改掉那扇窗正在显示的标签；`ensure_render` 会把不属于自己的最小化窗口 `restore()+showInactive()` 拉回屏幕；不带 `tabId` 的工具调用会回落到 `activeTabId`，直接改用户当前页。用户的实际体感是「agent 在后台干活，我的窗口/标签被抢走了」。

本任务只做「归属门」，不改架构、不改标签栏交互、不改技能与发布链路。

### 可直接粘贴给 Cursor 的开场指令

```text
仓库：d:\download\sparo上架应用商店版
先读 docs/AGENT-WINDOW-ISOLATION-CHECKLIST.md 和 docs/AGENT-WINDOW-ISOLATION-TASKBOOK.md。
按任务书的 Step 1 → Step 6 顺序执行，再做第七节验收 V1–V8，每步先 npx tsc --noEmit。
不要改 strategies/skills、docs/listings、tests/dxm-*；不要 git push、不要打包。
完成后回报：改了哪些文件、tsc/test 输出、V1–V8 验收结果。读到与代码不符的地方先停下来说明，不要猜。
```

---

## 零、目标与不变式

**只做一件事：让「窗口/标签被切走」这件事有归属门。**

两条不变式，所有改动围绕它们：

- **I1 用户可见窗口的 `activeTabId` 不得被不属于该窗的 client 改动。**
- **I2 不属于某扇窗的 client，不得让这扇窗 `restore()` / `showInactive()` / 切标签。**

不新增提前结束任务的判断；若实现中确实新增了，先写进 `docs/DECISION-POINTS.md` 再合码。

---

## 一、Step 1：抽纯函数门（新文件）

**新建 `src/main/agent/tab-guard.ts`**

```ts
export type WindowActor = { clientId?: string; winId?: string };

export type ActivationInput = {
  actor?: WindowActor;
  tabWinId: string;
  tabOwner: "user" | `agent:${string}`;
  userAction?: boolean;      // 用户点标签栏 / 侧栏开页
  backgroundRender?: boolean; // ensure_render 专用
};

export type ActivationDecision =
  | { ok: true }
  | { ok: false; reason: "other_window" | "not_your_tab" | "no_client_on_user_tab" };
```

规则（严格按此实现，单测按此断言）：

1. `input.userAction === true` → `{ok:true}`。
2. `actor?.clientId` 为空：
   - `tabOwner === "user"` → `{ok:false, reason:"no_client_on_user_tab"}`；
   - 否则 `{ok:true}`（agent 标签之间切换，无窗归属可比）。
3. `actor.clientId` 有值且 `tabWinId !== actor.winId` → `{ok:false, reason:"other_window"}`。
4. 同窗，`tabOwner !== "agent:<actor.clientId>"`：
   - `backgroundRender === true` → `{ok:true}`（后台渲染只在自己的窗里、且不夺焦，见 Step 3）；
   - 否则 `{ok:false, reason:"not_your_tab"}`。
5. 其余 → `{ok:true}`。

**不改** `mcp-sessions.ts` 的 `bindClientTab` 语义。

---

## 二、Step 2：`switchTab` 加门（browser.ts）

位置：`src/main/browser.ts:2120`

签名改为：

```ts
switchTab(
  id: string,
  opts?: { focus?: boolean; actor?: { clientId?: string; winId?: string }; userAction?: boolean; backgroundRender?: boolean },
): ToolResult
```

在函数最前面（`this.tabs.has(id)` 之后、`resetChromeCoverState` 之前）：

1. `const tab = this.tabs.get(id)`；`tabWinId = tab?.winId || "main"`。
2. `actor = opts?.actor ?? this.focusActor() ?? undefined`。
3. 调 `mayActivateTab({ actor, tabWinId, tabOwner: ownerForTab(id), userAction: opts?.userAction, backgroundRender: opts?.backgroundRender })`。
4. `!decision.ok` → `console.log("[tab-guard] deny tab=" + id + " reason=" + decision.reason)`，返回 `{ ok:false, message:"不切换标签：" + reason }`，**不要**改 `activeTabId`、不要 `layout()`、不要 `pushChromeState()`。

调用方逐个补参数（**必须全改，漏一个就还剩一条抢窗口路径**）：

| 位置 | 改动 |
|---|---|
| `browser.ts:3843` `spark:switch-tab` IPC | `this.switchTab(String(id), { userAction: true })` |
| `browser.ts:1059` 任务卡点标签 | `{ userAction: true }`（用户点卡片） |
| `browser.ts:2206`（打开已有标签） | 读上下文判断：用户点击 → `userAction:true`；agent 调用 → 传 actor |
| `browser.ts:2879`、`2885` 标签栏切换 | 用户动作 → `userAction:true`；agent 调用 → 传 actor |
| `browser.ts:6029`（`ensureSidebarWorkTab`）、`8432`（`submitAgentTask`）、`8488`（`runAgentTask`）、`8653` | `this.switchTab(prev, { userAction: true })`（替用户还原他原来的标签；`runScoped:8657` 的 `finally` 本身不切标签，不要改） |
| `browser.ts:1852` `createTab` 的 `activate` 分支 | **先在 `1846` 写 `activeTabId` 之前过门**，见下方 2.1 |
| `browser.ts:1882` `createEnvTab` 末尾 | 改成 `this.switchTab(id, { userAction })`，`userAction` 由新增参数传入，见下方 2.2 |
| `tools/index.ts:152` → `mcp-server.ts:660` `switch_tab` | handler 增加 `tabId`/`clientId` 语义，见下方 2.3 |
| `browser.ts:8135` `ensureRender` | 见 Step 3，改为带 `backgroundRender: true` + actor |

### 2.1 `createTab` 先过门再写 `activeTabId`

现在 `1846` 已经 `if (activate) this.activeTabId = id`，`1850` 已 `layout()`，`1852` 才 `switchTab`。只在 `1852` 加门会留下两个问题：门拒绝后 `activeTabId` 已经改掉，撤不回；用户点「新标签」时 `focusActor()` 为空、新标签 owner 是 `user`，会按规则 2 被误伤。

做法：

- `createTab(target, activate, opts?)` 的 `opts` 增加 `userAction?: boolean`。
- 在 `1846` 之前算一次 `decision = mayActivateTab({ actor: this.focusActor(), tabWinId: winId, tabOwner: agentOwned && clientId ? `agent:${clientId}` : "user", userAction: opts?.userAction, backgroundRender: false })`；`decision.ok === false` 时把 `activate` 置为 `false` 并 `console.log("[tab-guard] deny activate reason=" + decision.reason)`。
  - **`tabOwner` 不能写死 `"user"`**（v2 原文写错了）：`createAgentTab(activate=true)` 走的是侧栏，标签归属是 `agent:<clientId>`；写死会把侧栏开页也降级成后台。也可以直接用 `ownerForTab(id)`，因为 `claimTabForClient` 已经在 `1859` 跑过。
- 壳层 `spark:new-tab` / `newTab()`、快捷键 `cycleTab` / `switchTabByIndex` 一律传 `userAction: true`。
- `createAgentTab` 保持 `activate=false` 默认，不受影响。

### 2.2 `createEnvTab` 增加 `userAction`

`createEnvTab(envId, url, opts?: { userAction?: boolean })`，末尾改成 `this.switchTab(id, { userAction: opts?.userAction })`。

- 壳层「重开环境标签」等用户动作传 `true`。
- agent 的 `navigate({ envId })`（`12304`）不传 → 门拒绝时不写 `activeTabId`，环境标签在后台建好。

### 2.3 `switch_tab` 必须带身份

- `tools/index.ts:152`：`switch_tab: (id, clientId?) => browser.switchTab(id, { actor: clientId ? { clientId, winId: browser.windowOfClient(clientId) } : undefined })`（窗口解析方式按现有 `clientWindows` 取，不要新造映射）。
- `mcp-server.ts:660`：调用 `handlers.switch_tab(id, scope?.clientId)`；`scope?.clientId` 为空 → 直接返回错误文案「switch_tab 需要 clientId：请先 initialize 获取 x-sparo-client」，**不要**再落到 `activeTabId`。

`focusActivePage()`（`3715`）不改。

---

## 三、Step 3：后台渲染不再改用户标签（browser.ts）

位置：`engageBackgroundRender` `8065`、`ensureRender` `8127`、`releaseRender` `8149`

1. **先解析归属窗**：`const winId = this.clientWindows.get(client) || this.activeWinId || "main"`。`client` 为空时按 `focusActor()?.clientId` 取，仍为空才退回 `activeWinId`。**不要**用目标标签自己的 `tab.winId` 当 actor 窗，否则 `backgroundRender:true` 会在别人的窗口上放行。
2. **归属判定放在计数之前**：`client && !this.clientOwnsWindow(client, winId)` → 直接 `return false`，不变动 `renderHoldCount`、不 `restore`、不 `showInactive`，**非 quiet 分支也不再调 `safeFocusClientWindow`**（`quiet` 只表达「不聚焦」，不表达「跳过归属」）。
3. **计数规则**：归属通过后才 `renderHoldCount++`；若 `renderHoldCount > 1` → `return true`（视为已经持有）；只有 `win.isMinimized()` 为真才 `restore()+showInactive()`，然后 `return true`。
4. `engageBackgroundRender` 返回 `boolean`；`ensureRender` 收到 `false` 时回滚它在 `8129` 之前加上的 `renderClients` 计数，并返回 `{ ok:false, message:"窗口不属于该客户端，未恢复后台渲染" }`。`runAgentTask:8507` 不看返回值可以保持原样（后台任务继续跑，但窗口不被拉起来）。
5. **记住用户原标签**：新增 `private renderPrevTab = new Map<string, string>()`（winId → tabId）。
   - `ensureRender` 在 `switchTab` 前：`if (!this.renderPrevTab.has(winId)) this.renderPrevTab.set(winId, this.activeTabs.get(winId) || "")`。
   - `switchTab(id, { focus:false, actor:{ clientId: client, winId }, backgroundRender:true })`（`winId` 用第 1 条解析出的归属窗）。
   - `releaseRender` 计数归零时：若 `renderPrevTab` 有值且用户未把窗口拉回前台（`!this.userClaimedRenderWindow`），先 `switchTab(prev, { userAction:true })` 再走原有 `minimize()`；然后 `renderPrevTab.delete(winId)`。
6. **用户中途拉回窗口**：在 `noteUserClaimedRender()`（`8098`）里，若判定为用户拉回，且 `renderPrevTab` 有值，切回原标签一次并删除记录（`switchTab(prev, { userAction:true })`）。避免用户看到「标签栏是我的、内容是 agent 的」。
7. 不要求改 `applyViewBounds`（`3271`）的 mount/park 逻辑；本期用「切 tab + 归还时切回」的保守方案。若后续要彻底不切可见标签，另开任务。

---

## 四、Step 4：MCP 写操作不再回落用户标签（mcp-server.ts）

位置：`src/main/mcp-server.ts:87-96`

新增：

```ts
const bindForWrite = (tool: string, tabId?: string): string => {
  const resolved = bind(tabId);
  if (resolved) return resolved;
  throw new Error(
    `${tool} 需要 clientId 或 tabId：请重新 initialize 获取 x-sparo-client 请求头，或显式传 tabId。不会默认操作用户当前标签。`,
  );
};
```

把下列**写操作**工具的 `bind(tabId)` 换成 `bindForWrite("工具名", tabId)`：

`navigate`、`click`、`fill`、`execute`、`select`、`upload`、`click_text`、`menu_click`、`press`、`reload`、`go_back`、`go_forward`、`fill_suggest`、`execute_primitives`、`pick_calendar`。

`switch_tab` 单独处理，见 Step 2.3（必须带 clientId，不走 `bindForWrite`）。

保留 `snapshot` / `get_url` / `get_title` / `page_text` / `list_tabs` / `list_portals` / `sparo_info` 只读行为不变。

补充（Cursor 核对）：清单里 `5196 / 6663 / 6937 / 7623 / 8938 / 9224 / 9258 / 9300 / 9342 / 9862 / 9875 / 9910` 是 `tabId = tabId || this.agentTabId || this.activeTabId` 的**赋值行**，多数比函数签名差 1 行；按函数名找，不要按行号硬改。

注意：带 `clientId` 时 `bindClientTab` 一定会返回标签（没有就新建），所以这条只会拦住「没 initialize、又没传 tabId」的裸调用。

---

## 五、Step 5：两处小修（browser.ts）

1. `releaseAgentTab`（`1283`）：
   `if (tabId === this.activeTabId) return;` → `if (tabId === (this.activeTabs.get(tab?.winId || "main") || "")) return;`
2. `clientOwnsWindow`（`723`）：
   未绑定（`!bound`）时不再直接 `return this.wins.size <= 1`，改为：只有该窗没有其他已登记 agent client（`getClientsOnWindow(winId)` 为空）时返回 `true`，否则 `false`。`safeFocusClientWindow` 不改（它已经自带走 `showInactive` 分支）。

> 口径确认（按 Cursor 核对）：清单 #8 的「未绑定一律只 showInactive、绝不 show/focus」**本次不做**，空窗仍按上面返回 `true`；清单 #9（`bindClientTab` 的 `activate` 条件）**本次不改**，登记为后续项。任务书以本节为准。

---

## 六、Step 6：单测

**新建 `tests/tab-guard.test.ts`**，只测 Step 1 的纯函数，覆盖：

| 场景 | actor | userAction | tabOwner | tabWinId vs actor.winId | 期望 |
|---|---|---|---|---|---|
| 用户点标签 | 空 | true | user | — | ok |
| agent 切自己标签 | X/A | false | agent:X | 同窗 | ok |
| agent 切用户标签 | X/A | false | user | 同窗 | not_your_tab |
| agent 跨窗切 | X/A | false | agent:X | B | other_window |
| 无 client 切用户标签 | 空 | false | user | — | no_client_on_user_tab |
| 后台渲染自己窗 | X/A | false | user | 同窗 | ok（backgroundRender=true） |

再补一条 `bindForWrite` 的行为测试：无 scope 无 tabId 抛错；有 tabId 透传。

再补三条行为测试（放在 `tests/tab-guard.test.ts` 或相邻文件）：

- `createTab` 门：agent actor + `userAction:false` + 新标签 owner=user → `activate` 被降为 false；`userAction:true` → 放行。
- `createEnvTab`：`userAction` 缺省时，agent 调用后该窗 `activeTabId` 不变。
- `switch_tab` handler：`scope.clientId` 为空 → 返回错误且不调用 `browser.switchTab`。

不碰 `tests/dxm-*`、`tests/chrome-hole.test.ts` 的既有断言。

---

## 七、验收（必须自己跑，跑完在回报里贴命令与输出）

1. `npx tsc --noEmit` → 0 error。
2. `npm test` → 除既有 `tests/chrome-hole.test.ts` T2（改动前就红）外全绿。
3. **V1 标签不被抢**：窗口 A 停在 `weibo.com`，记下 `list_tabs` 的 `activeTabId`；用带 clientId 的 MCP 调 `navigate("https://example.com")`（不传 tabId）→ A 的 `activeTabId` 与 weibo 标签 URL 不变，agent 自己标签变成 example.com。
4. **V2 窗口不被拉起**：窗口 A 最小化；用不属于 A 的 clientId 调 `ensure_render(A 的标签)` → 返回 `ok:false`，A 仍最小化。
5. **V3 无身份不落用户页**：不带 `x-sparo-client`、不传 tabId 调 `click` / `fill` → 返回上述错误文案；A 页面 DOM 无变化。
6. **V4 侧栏自己的窗仍能跑**：侧栏在自己的窗口发「打开微博网站 weibo.com」→ 任务前后该窗 `activeTabId` 相同（若侧栏独占该窗，允许打开时切换，但任务结束要回到原标签）。
7. **V5 黄金场景**：G1、G2、G3 按 `docs/QA-GOLDEN-SCENARIOS.md` 用底账核对，不允许用侧栏感觉代替。
8. **V6 双窗口手测**：A 窗停在微博、B 窗停在别的站；从 B 窗侧栏发「打开百度」→ A、B 的可见标签都不变，agent 标签在后台加载完成。
9. **V7 `switch_tab` 不越权**：不带 `x-sparo-client` 调 `switch_tab` → 返回错误，`list_tabs` 的 `activeTabId` 不变；带 clientId 调自己标签 → 正常切换。
10. **V8 `envId` 不抢标签**：用户在 A 窗看微博；agent 调 `navigate({ url, envId })` → 新环境标签出现在 `list_tabs`，但 A 窗 `activeTabId` 与可见页面不变。

---

## 八、红线

- 不改 `strategies/skills/*`、`docs/listings/`、`tests/dxm-*`；不碰店小秘保存/认领路径。
- 不给 agent 路径加 `win.show()` / `win.focus()`；`safeFocusClientWindow` 的 `showInactive` 分支保留。
- `ensure_render` 不能变成 no-op：侧栏在自己窗口跑店小秘/导航时还要能后台排版（否则 G1–G3 会退）。
- 门只拦「激活/恢复窗」，不拦「读写自己标签」；不要把 `click`/`fill` 在显式 tabId 下也拦掉。
- 失败要返回 `{ok:false}` 带人话原因，不要静默成功。
- 不调整版本号、不 `git push`；打包与发布由 Trae 这边统一做。
- 改完在 `CHANGELOG.md` 的下一版段落加一条：「多 Agent 窗口/标签互不抢占：切标签、后台渲染、工具默认标签都按 clientId 与窗口归属判定；不属于自己的窗口不会被恢复或切走。」

---

## 九、执行顺序

```text
Step 1 tab-guard.ts（纯函数 + 单测）
  ↓
Step 5 两处小修（先让归属判断正确）
  ↓
Step 2 switchTab 加门 + 全量调用方补参数
  ↓
Step 3 ensure_render 归属 + 原标签归还
  ↓
Step 4 mcp-server 写工具拒绝无身份裸调（含 press / reload / go_back / go_forward / fill_suggest）
  ↓
Step 6 单测 → 七、验收 V1–V8（tsc + npm test + 真机）
  ↓
CHANGELOG 一句，停手并回报结果
```

每步做完先 `npx tsc --noEmit`，不要攒到最后一起修。

---

## 十、修订记录

**v2（2026-11-11，按 Cursor 核对结果）**

| # | 原任务书问题 | 本次处理 |
|---|---|---|
| 1 | 调用方表漏 `switch_tab`（`tools/index.ts:152`、`mcp-server.ts:660`）与 `createEnvTab:1882` | 补进 Step 2 表，新增 2.3；`createEnvTab` 加 `userAction`（2.2） |
| 2 | 只在 `createTab:1852` 加门，`1846` 已写 `activeTabId`，用户新标签会被误伤且撤不回 | 新增 2.1：门提到 `1846` 之前；`spark:new-tab` / `newTab` / `cycleTab` / `switchTabByIndex` 传 `userAction:true` |
| 3 | 清单 #6 与 Step 5 口径不一致 | 清单 #8 改为「本次只修：未绑定且该窗已有别的 agent → false」，Step 5 写明「未绑定一律不 show/focus」本次不做 |
| 4 | 清单 #7 声称本次修，但 Step 1 写明不改 `bindClientTab` | 清单 #9 标记「本次不改」，登记后续 |
| 5 | `engageBackgroundRender` 返回值/计数没写完；`actor.winId` 会误用标签窗 | Step 3 补计数三条规则；`winId` 固定用 client 已绑定窗 |
| 6 | 无身份裸调口子不止 8 个工具；行号是赋值行不是签名；`6029/8432` 不是 `runScoped` | Step 4 补 5 个工具；加行号说明；清单 §三 改成 `ensureSidebarWorkTab` / `submitAgentTask`，并注明 `runScoped:8657` 的 `finally` 不切标签 |
| 7 | 验收只到 V6 | 补 V7（`switch_tab` 不越权）、V8（`envId` 不抢标签） |

---

## 十一、执行状态（2026-11-11）

### 已落地

| 文件 | 状态 |
|---|---|
| `src/main/agent/tab-guard.ts` | 新建，激活判定 / `settleCreateActivate` / `bindForWrite` / 无身份 `switch_tab` 拒绝 |
| `src/main/browser.ts` | `switchTab` 加门；`createTab` 写 `activeTabId` 前过门；`createEnvTab(userAction)`；`releaseAgentTab` 按标签自己的窗口判断；`clientOwnsWindow` 收紧；`ensure_render` 先判归属再计数、归还切回原标签 |
| `src/main/mcp-server.ts` | 写工具改走 `bindForWrite`；`switch_tab` 无 clientId 直接拒绝 |
| `src/main/tools/index.ts` | `switch_tab` 带 client 已绑定窗口 |
| `tests/tab-guard.test.ts` | 新建 17 条，本地实测全绿 |
| `tests/chrome-hole.test.ts` | 只改一处调用为 `switchTab("b", { userAction: true })`，断言未动 |
| `CHANGELOG.md` | 未发布段已加「多 Agent 窗口/标签互不抢占」一句 |

### 待补三条

1. **`createTab` 的 `tabOwner`**：当前实现按 v2 原文写死 `"user"`，会把侧栏 `createAgentTab(activate=true)` 降级成后台。按 2.1 修正为 `agentOwned && clientId ? \`agent:${clientId}\` : "user"`（或 `ownerForTab(id)`）。改完补一条单测：侧栏 client + 同窗 + `activate=true` → 允许激活。
2. **`execute_primitives` / `pick_calendar`** 仍走 `bind()`，无身份且无 `tabId` 时可能落到用户当前页。按 Step 4 一并纳入 `bindForWrite`。
3. **未绑定窗的 client 切自己标签被误拒（V7 暴露）**：**已修**。`switchTab` 现在按 `this.clientWindows.get(clientId) || this.activeWinId || "main"` 补 `actor.winId`（`browser.ts:2167-2170`），未绑定 client 在同窗切自己的标签已放行；跨窗仍拒绝。单测 `tests/tab-guard.test.ts:231/239` 覆盖。

### 真机验收（新进程，2026-11-11）

| 项 | 结果 | 证据 |
|---|---|---|
| V1 | 过 | 用户标签 `e8309fd0` 仍是 `https://weibo.com/`，`activeTabId` 不变；新标签 `f53f9c55`（`agent:3e260d`）为 example.com |
| V2 | 过 | 非本窗 client 调 `ensure_render` 得 `ok:false`「窗口不属于该客户端，未恢复后台渲染」，窗口仍最小化 |
| V3 | 过 | 无 client 无 tabId 的 `click` / `fill` 返回 `bindForWrite` 原文；微博正文前后一致 |
| V4 | 过 | 侧栏「打开微博网站 weibo.com」前后 `activeTabId` 都是 `65fdfbe7`，微博开在侧栏标签 `aa0b9b4a` |
| V6 | 基本过 | 第二扇窗可见标签 `dad5e814`（百度）不变；侧栏标签后台变化；无新 `[tab-guard] deny`。Windows 拒绝切焦点，A 窗 `activeTabId` 未能二次读取 |
| V7 | 过（新进程 pid 47548 复测） | 无 client 的 `switch_tab` 被拒、`activeTabId` 不变；client `defb1c` 只 `navigate` 到 example.com、未 `submit_task`，`switch_tab` 自己的 `69b93f87` 返回 `Switched to tab 69b93f87`；另开一窗后 client `3c3af3` 切 `69b93f87` 返回「不切换标签：other_window」，该窗 `activeTabId` 仍是 `cf9fa0c9` |
| V8 | 未覆盖 | `create_env` 得到 `01c5eb10`；`navigate({ url, envId })` 后用户标签与页面不变，但新标签 `bdff0c4a` 是普通 `agent:` 标签 |
| G1 | 过 | 落到 `https://weibo.com/`、登录正常、读了关注流；前台标签仍是百度，未被切走 |
| G2 | 过 | 前台 `dad5e814` 任务前后不变；落盘 `docs\2026-11-11T10-58-13-汪海林微博近三天内容整理（2026-11-09-至-11-11）.md`（22098 字节，45 条） |
| G3 | 未过（非隔离问题） | 第一次被另一窗侧栏句「打开百家号」打断；重试后移动版只读到首屏约 12 条，没有新的逐条文档，G2 文件未被改写。前台标签未被切走 |

### 本次不做（登记后续）

- **V8 `envId` 不生效**：带 clientId 时 `bind()` 先分配普通标签，`createEnvTab` 根本不会执行，环境隔离对 MCP 客户端形同虚设。这是老行为，不是本次门引入；要修得改 `bind`/`navigate` 的 envId 分支，另开任务。
- **G3 被打断**：另一窗侧栏句进入同一个 Free Soul 会话，打断在跑的任务；加上移动版微博只返回首屏。前者属任务队列/会话归属，后者属采集策略，都不在窗口隔离范围。
- **清单 #9**（`bindClientTab` 的 `activate` 条件）与「未绑定 client 一律不 show/focus」仍不做。

### 验收前置

- 真机 V1–V8、G1–G3 **必须用新源码起进程**：`3921` 上跑的若是改动前的进程，工具调用测的是旧逻辑，还会动到用户窗口。2026-11-11 已按此退旧起新并完成上表验收；换进程时 `npm run start` 退出码 1 是进程树被主动结束，不是启动失败。
- `npx tsc --noEmit` 目前只报 `src/main/skills/runner.ts`（`extraArgs` / `findLast` / `stderr`）。该文件有 59 行未提交改动，来自 `social_publish` / `publish_article` 分支，属另一个窗口的工作，**本任务不要改它**。**打包前必须由该改动负责人修掉类型错误**，否则 `npm run dist` 不可信。
- 全量 `npx vitest run`：122 文件 / 932 条通过（含新增的 `tab-guard` 单测；v2 时为 930，V7 补了两条）。
