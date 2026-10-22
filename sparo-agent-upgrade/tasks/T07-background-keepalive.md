# T07 · 体验·后台保活不抢屏

> 线：D（体验） · 依赖：T05 已合并 · 风险：中 · 与 T06/T08 并行开工（函数域不重叠）
> 代码根：`d:\download\sparo上架应用商店版`
> 先读：根目录 `AGENTS.md`、`docs/ARCHITECTURE.md`、`sparo-agent-upgrade/PLAN.md`（红线在其中）

## 目标

把「任务一跑窗口就弹回用户脸上」改成「窗口可以一直最小化，任务照跑，完成时任务栏闪一下」。

三条具体：

1. Agent 持有的后台标签关闭渲染节流，最小化/不可见时定时器照跑。
2. 删掉任务路径上所有强制 `restore()` 弹窗，改成 `flashFrame`。
3. 用户的正常浏览标签保持节流（省电省内存）不变。

## 现状（证据）

- [browser.ts](file:///d:/download/sparo上架应用商店版/src/main/browser.ts)：
  - 约 715 行 `makePageView`：`backgroundThrottling: true` 一刀切。
  - 约 1133 行、约 7392 行：任务路径上 `if (this.window.isMinimized()) this.window.restore()`——**抢屏元凶**。
  - `ensureWindowVisible()`（约 615 行附近 unresponsive 处理在用，保留）。
- T05 已建：`createAgentTab()`（后台标签）、`viewForTab(tabId)`。

## 改动清单

### 1. makePageView 加归属参数

- `makePageView(envId?, opts?: { agentOwned?: boolean })`：`opts.agentOwned === true` 时 `backgroundThrottling: false`；否则保持 `true`。
- `createAgentTab` 传 `agentOwned: true`。
- 兼容 env 标签（createEnvTab）路径不动。

### 2. 去掉任务路径上的强制 restore

- 逐处审查 1133、7392 及 grep `isMinimized()) this.window.restore` 全部调用点：
  - **任务执行路径**（navigate/click/fill/报告打开等由 agent 触发的）：删 restore，任务完成时若窗口最小化或未聚焦 → `win.flashFrame(true)`，用户聚焦后 `flashFrame(false)`。
  - **用户主动交互路径**（用户自己点托盘图标、快捷键唤起）：保留 restore。
  - `ensureWindowVisible` 只留给 shell 渲染进程 unresponsive 的救命场景，其它调用点删掉。
- 侧栏新消息到达而窗口最小化：不弹窗，只 flashFrame。

### 3. 最小化时的壳层保活

- 窗口 `minimize` 事件：若存在运行中的 agent 任务（读 T06 的 taskPool 或 T05 的任务表，两者任一 API 可用即可，T06 未合并时先用任务表数组），对 shell `webContents.setBackgroundThrottling(false)`；全部任务结束后恢复 `true`。
- `restore` 事件：统一 `setBackgroundThrottling(true)` 壳层（agent 标签是独立 webContents，不受影响）。

### 4. 单测 `tests/keepalive.test.ts`

- makePageView agentOwned 分支参数断言；restore 删除后的行为用注释+现有测试保回归即可（Electron 窗口行为在 vitest 里测不了，靠人测）。
- 现有全部测试绿。

## 禁区

- 不动 discard/休眠逻辑（T08）。
- 不引入「永远置顶」「全局快捷键唤起」等新交互。
- 前台任务（填表/支付确认）弹回窗口是**产品特性**，不在本任务删除范围——只删后台/报告路径的 restore。
- 不碰 `docs/listings/`、`cloud/`、`envs/`、`cs/`。

## 验收

1. 窗口最小化 → 从托盘/命令行触发一个后台调研任务（或趁最小化前发出任务）→ 5 分钟内窗口**始终不弹** → 完成时任务栏闪烁 → 手册已生成。
2. 前台任务（「帮我回当前页评论」）在窗口最小化时发出 → 允许恢复窗口一次（产品特性），注释里写清理由。
3. 最小化跑任务期间，打开任务管理器观察：后台标签页面 JS 定时器不被节流（用带定时器的测试页验证，例如页面里每秒 console.log 计数）。
4. `npx vitest run` 全绿。

交付物：commit + typecheck/test 输出 + 录屏或 3 张带时间戳截图（最小化运行中、任务栏闪烁、完成后手册）。

## Commit

`feat(t07): 后台任务保活，任务路径不再抢屏`
