# T06 · 架构·并行任务池

> 线：C（架构） · 依赖：T05 已合并 · 风险：**高** · T05 合并后与 T07/T08 并行开工
> 代码根：`d:\download\sparo上架应用商店版`
> 先读：根目录 `AGENTS.md`、`docs/ARCHITECTURE.md`、`sparo-agent-upgrade/PLAN.md`（红线在其中）

## 目标

拆掉 `chatRunning` 全局串行锁，换成任务池：

- **前台任务**（填表、支付确认、客服草稿、飞书草稿、登录墙等待）：仍串行互斥，同人同窗——「发送前你确认」哲学不变。
- **后台任务**（调研/比价/出差/监控类 mission、长检索）：进任务池并行，每个任务绑自己的后台标签（T05 地基），上限 **3** 个并发，超出排队。
- 侧栏加任务状态条：每个在跑任务一张迷你卡（标题、当前步、转圈/打勾），点卡片跳到对应标签。

## 现状（证据）

- 串行锁：[browser.ts](file:///d:/download/sparo上架应用商店版/src/main/browser.ts) 约 4712 行 `handleChat`：`chatRunning` + `chatQueue`，一句没做完下一句排队。
- T05 已建：`viewForTab(tabId)`、`createAgentTab()`、`releaseAgentTab(tabId)`，任务链路全程传 tabId。
- 任务分类素材：`agent/mission.ts` 的 kind 枚举（local_outing/compare_shop/research/job_apply/rent/…）、`intent-router.ts` 路由。
- 工作单状态机：`runtime.ts`（waiting_human 语义已有）。

## 改动清单

### 1. 任务分类（新增 `src/main/agent/task-class.ts`）

```ts
export type TaskLane = "foreground" | "background";
export function laneFor(kind: string, step?: { cap?: string }): TaskLane;
```

- foreground：fill_form、reply_draft、feishu、print、支付/登录相关 act、waiting_human 中的任何任务。
- background：mission 全类、travel_search、trip_plan、search_read 调研、定时监控类。
- **分类用现有 kind/cap 查表即可；拿不准的默认 foreground（宁可串行，不抢屏）。**

### 2. TaskRunner 池（browser.ts）

```ts
type RunningTask = { id: string; tabId: string; title: string; lane: TaskLane; state: string };
private taskPool: Map<string, RunningTask>;   // 并发上限 3（常量，注释说明可调）
```

- `handleChat` 重写：
  - foreground：沿用「同时只跑一个」——有前台任务在跑则进 `chatQueue`（现有行为）。
  - background：`createAgentTab()` 拿标签 → 进池即跑；池满则排队，侧栏提示「排队中（第 N 位）」。
  - 任务完成/失败/取消 → `releaseAgentTab(tabId)` → 从池移除 → 唤起队首。
- 后台任务**不切换 activeTabId**，用户当前页不动。
- waiting_human：后台任务遇登录墙进 waiting_human 不占并发名额（挂起），侧栏任务卡显示「等你处理」，用户点卡片跳过去处理完说「继续」。

### 3. 侧栏任务状态条（shell.html）

- 新增独立容器 `#taskStrip`（planStrip 旁边或上方）：每张卡=任务标题+lane 徽标+状态。
- **冲突域纪律：只加新容器和新渲染函数，不动 renderChat/quoteStrip/planStrip 内部。**
- `pushSidebarState` 推任务列表。

### 4. 单测 `tests/task-pool.test.ts`

- 分类查表；池上限排队；前台互斥；后台任务不抢 activeTabId；waiting_human 不占名额；完成释放。
- 现有全部测试绿。

## 禁区

- 上限 3 写死，不做用户设置项（后续再说）。
- 不动 `makePageView` 的 throttling（T07）、不动 discard 策略（T08）。
- 报告页打开方式不变（仍窗口内打开——后台任务出报告时才允许 `switchTab` 到新报告标签，这是唯一例外，写进注释）。
- 不碰 `docs/listings/`、`cloud/`、`envs/`、`cs/`。

## 验收

口令（开发窗侧栏实测）：

1. 先发「戴森吹风机 在淘宝和京东比价」→ 不等完成，紧接发「下周一从上海去广州出差两天 机票酒店」→ **两个任务并行**，侧栏两张任务卡，用户当前标签不被切走。
2. 再连发两个调研 → 第 4 个提示排队，前面完成一个后自动开跑。
3. 并行中发「帮我回一下当前页评论」（前台）→ 等后台不占前台锁，直接在当前标签执行。
4. 后台任务遇登录墙 → 任务卡显示「等你处理」，点卡片跳过去，登录后说「继续」→ 原任务续跑。
5. `npx vitest run` 全绿。

交付物：commit + typecheck/test 输出 + 3 张截图（双任务并行、排队提示、登录墙挂起）。

## Commit

`feat(t06): 前后台任务分类与并行任务池`
