# T05 · 架构·任务绑标签（pageView → viewForTab）

> 线：C（架构） · 依赖：无 · 风险：**高** · 第一波与 T01/T03 并行开工
> 代码根：`d:\download\sparo上架应用商店版`
> 先读：根目录 `AGENTS.md`、`docs/ARCHITECTURE.md`、`sparo-agent-upgrade/PLAN.md`（红线在其中）

## 目标

这是并行、后台、多 Agent 三个后续任务的**共同地基**，只做一件事：

**把「Agent 的手 = 当前激活标签」这个假设拆掉。**

现在所有工具执行都落到 `tabs.get(activeTabId)`（用户正看的标签）。改完后：每个任务持有自己的 `tabId`，任务全程操作自己的标签；后台任务在屏幕外标签（`x:-20000`）执行，用户无感知。

本任务**不做**并行调度（T06）、**不做**保活（T07），串行队列原样保留——先把绑定关系换血，全量回归绿了才算完。

## 现状（证据）

- 万恶之源：[browser.ts](file:///d:/download/sparo上架应用商店版/src/main/browser.ts) 约 551 行 `private get pageView(): WebContentsView` —— 直接取 `activeTabId`。
- 标签结构：`TabInfo { id, view, title, url, lastActiveAt, discarded? }`（约 406 行）；`createTab(url, activate)`（约 962 行）支持 `activate=false`；后台标签移屏外的 layout 机制已有；`discardTab`（约 872 行）、`wakeTab` 已有。
- 工具注册：[tools/index.ts](file:///d:/download/sparo上架应用商店版/src/main/tools/index.ts) `browser.watchPageTool("navigate", {url}, () => navigateTool(browser, url))` 模式；`tools/navigate.ts`、`click.ts`、`fill.ts`、`snapshot.ts`。
- 任务链路：`handleChatJob` → `executeHand(step.action, …)` / `executeMission(mission, …)`。

## 改动清单

### 1. browser.ts：新增标签寻址 API

```ts
viewForTab(tabId: string): WebContentsView   // 取指定标签；discarded 则 wakeTab；不存在则抛错
createAgentTab(url?: string): string          // createTab(url, false)，返回 tabId
releaseAgentTab(tabId: string): void          // 任务结束调用：保留标签记录；本任务只留接口，T08 才接休眠
```

- `pageView` getter **保留不删**，内部改为 `viewForTab(this.activeTabId)`，加 `@deprecated` 注释：此后 Agent 路径一律显式传 tabId。

### 2. 任务链路穿 tabId

- `handleChatJob` / `executeHand` / `executeMission` / `runTravelSearch` / `runMission` 增加 `tabId` 参数（任务入口决定：本任务阶段默认都用 `activeTabId`，行为与现状一致）。
- 执行链路内部所有 `this.pageView` 调用点改为 `this.viewForTab(tabId)`。用 `grep pageView` 逐个过，**一个不留**（工具函数内部默认参数例外，见下）。
- 预估调用点几十处，全部机械替换；每改完一类跑一遍 `npx vitest run`。

### 3. 工具层加可选 tabId

- `tools/navigate.ts`、`click.ts`、`fill.ts`、`snapshot.ts` 及 `tools/index.ts` 注册表：参数加可选 `tabId`，缺省 = 当前激活标签（**对外行为完全不变**，MCP 客户端无感）。
- `watchPageTool` 包装同样透传。

### 4. 单测

- `tests/task-tab.test.ts`：`viewForTab` 正常/休眠唤醒/不存在抛错；`createAgentTab` 不抢焦点（activeTabId 不变）；工具带 tabId 时寻址到指定标签。
- **现基线 362 条全绿是本任务的硬验收。**

## 禁区

- 不拆 `chatRunning` / `chatQueue`（T06）。
- 不动 `makePageView` 的 `backgroundThrottling`（T07）。
- 不动 `shell.html`。
- 不改任务产物（手册/报告）的生成与打开方式。
- 不碰 `docs/listings/`、`cloud/`、`envs/`、`cs/`。

## 验收

1. `npx vitest run` 全绿（362 + 新增）。
2. 行为零回归——现行 10 场景抽 5 条实测：
   - 「打开百度，搜今天北京天气」
   - 「在携程查9月15日伊斯坦布尔的酒店」
   - 「戴森吹风机 在淘宝和京东比价」
   - 「总结当前页」
   - 「打开 https://www.gov.cn 用中文告诉我这是什么网站」
3. `createAgentTab` 单测证明：创建后台标签后 `activeTabId` 不变、用户当前页不被切换。

交付物：commit + typecheck/test 输出 + `grep -n "this\.pageView" src/main/browser.ts` 剩余调用点清单（应只剩 getter 本体与注释）。

## Commit

`refactor(t05): 任务与标签绑定，pageView 改走 viewForTab(tabId)`
