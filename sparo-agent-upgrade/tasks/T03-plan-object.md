# T03 · 大脑·Plan 计划对象

> 线：B（大脑） · 依赖：无（但 shell.html 冲突域要求：T01 合并后再开工） · 风险：中 · 可与 T05 并行
> 代码根：`d:\download\sparo上架应用商店版`
> 先读：根目录 `AGENTS.md`、`docs/ARCHITECTURE.md`、`sparo-agent-upgrade/PLAN.md`（红线在其中）

## 目标

现在 agent 是 ReAct 单步循环：每轮只看「还缺什么」走一步，用户看不到全局路线。本任务给大脑加 **Plan 对象**：理解完需求后、动手之前，模型先产出一份分步计划；侧栏出计划卡片（步骤逐条打勾）；执行中模型可修订计划；全部勾完才合成手册。

对标：Cursor 接到任务先列 plan 再执行。

## 现状（证据）

- 推理器：[reasoner.ts](file:///d:/download/sparo上架应用商店版/src/main/agent/kernel/reasoner.ts)——`nextThought` / `nextThoughtAsync` 每次只决定下一步；`reasonerPromptV2` 已把「已做/还缺/可用的手」喂给模型；`applyModelPick` 只校验 `cap ∈ LOOP_CAP_SET`、`covers ⊆ DELIVERABLE_IDS`。
- 工作单：[runtime.ts](file:///d:/download/sparo上架应用商店版/src/main/agent/runtime.ts) `ActiveMission`（约 35 行）：`state: MissionState`（blocked/propose/running/done/waiting_human 等），`applyTurn` 推进。
- 交付物契约：`kernel/verify.ts` `verifyContracts` 输出 missing/complete；能力表 `kernel/caps.ts`、`agent/loop.ts` `compileHands`。
- 失败换路：`brain/reconsider.ts`（已有，保留）。
- 侧栏渲染：shell.html `renderChat(log)`（约 2336 行），消息项 `{role, text, images?, doc?}`。

## 改动清单

### 1. 新建 `src/main/agent/kernel/plan.ts`

```ts
export type PlanStep = {
  id: string;
  label: string;          // 人话，如「查去程机票」
  cap: string;            // 必须是合法 LoopCap
  covers: string[];       // 必须是合法交付物 id
  status: "pending" | "running" | "done" | "failed" | "skipped";
  note?: string;          // 失败/跳过原因
};
export type Plan = { steps: PlanStep[]; createdAt: number; revisedFrom?: string };
```

- `planPrompt(goal)`：仿照 `reasonerPromptV2` 的上下文组装，要求模型只输出 `{"steps":[{"label","cap","covers"}...]}` 的 JSON。提示词里写清：3~8 步；cap 和 covers 白名单照抄 reasoner 现有清单；用户点名站点不许换。
- `parsePlanJson(raw)`：正则 `\{[\s\S]*\}` + JSON.parse（与 `parseReasonerJson` 同风格）；本地校验每步 cap/covers 合法，非法步骤丢弃；全非法返回 null。
- `planFromHeuristic(goal)`：模型不给 plan 时的兜底——用现有 `compileHands(goal)` 按 covers 顺序生成计划。**绝不能让「模型没出计划」变成任务卡死。**

### 2. runtime.ts：工作单挂 plan

- `ActiveMission` 加 `plan?: Plan`。
- `applyTurn` 进入 running 时：若无 plan，先调模型出 plan（模型不可用时用 `planFromHeuristic`），挂到工作单上。
- 每步执行完回写 `status`；某步失败 → 走现有 `reconsider` 换路，并把对应 step 标 failed、追加替代步骤（plan 可被修订，`revisedFrom` 记原因）。
- `verifyContracts` 判定 complete 后才允许 synthesize（现行规则不变）。

### 3. 侧栏计划卡片（shell.html）

- 新增独立容器 `#planStrip`（位于对话流上方或当前工作单卡片内），渲染函数 `renderPlanStrip(plan)`：步骤列表 + 状态图标（⏳/✓/✗/跳过），当前 running 步高亮。
- **冲突域纪律：只允许在 `renderChat` 里加一行对 `renderPlanStrip` 的调用或一个独立容器挂载点；卡片 DOM、样式、事件全部写在新函数里。不动 T01 的 quoteStrip 区域。**
- `pushSidebarState` 把 activeMission.plan 推给侧栏。
- 计划出先出卡片再动手：用户看到计划后可说「去掉第 3 步」「先做第 2 步」——`applyTurn` 的 amend/revise 路径把这类话转成 plan 修订（模型判断，不加正则硬规则）。

### 4. 单测 `tests/plan.test.ts`

- parsePlanJson：合法/非法 cap、空 steps、脏 JSON。
- planFromHeuristic 兜底非空。
- applyTurn：running 时挂 plan；步骤状态随执行推进；失败步 reconsider 后追加替代步骤。
- 现有 362 条全绿。

## 禁区

- 不改 `executeHand` / 能力表执行层（T05/T06 的）。
- 不改 `chatQueue` / `chatRunning`（T06 的）。
- 不新增本地意图正则；「去掉第 N 步」这类指令交模型解析。
- 不碰 `docs/listings/`、`cloud/`、`envs/`、`cs/`。

## 验收

口令（开发窗侧栏实测）：

1. 「下周一从北京去上海出差两天 要机票和酒店 大概多少钱」→ 先出 3~8 步计划卡片（可看到每步 label）→ 逐步打勾 → 出手册。
2. 「戴森吹风机 在淘宝和京东比价」→ 计划卡片 → 执行中某步失败能看到 ✗ 和替代步骤。
3. 出计划后说「去掉最后一步」→ 计划被修订，不重新问已填的槽。
4. 断网/模型超时 → 兜底计划照常生成，任务不卡死。
5. 简单单步需求（「总结当前页」）→ 不强制出多步计划（1~2 步即可）。

交付物：commit + typecheck/test 输出 + 3 张截图（计划卡片初始/执行中/修订后）。

## Commit

`feat(t03): 大脑 Plan 计划对象与侧栏计划卡片`
