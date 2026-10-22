# T04 · 大脑·工作单持久化与断点续跑

> 线：B（大脑） · 依赖：T03 已合并 · 风险：中
> 代码根：`d:\download\sparo上架应用商店版`
> 先读：根目录 `AGENTS.md`、`docs/ARCHITECTURE.md`、`sparo-agent-upgrade/PLAN.md`（红线在其中）

## 目标

工作单（ActiveMission）现在只在内存：杀进程、崩溃、重启就归零。本任务把工作单做成**事件溯源**：每次状态变迁追加写 `missions.jsonl`；启动时回放恢复未完成的单；崩溃后重启能问一句「上次跑到一半，继续？」接着跑。

这是未来「盯三天机票价格」这类跨天任务的地基。

## 现状（证据）

- 工作单：[runtime.ts](file:///d:/download/sparo上架应用商店版/src/main/agent/runtime.ts) `ActiveMission`（goal、state、findings、plan[T03 新增] 等），`applyTurn` 是状态机入口。
- 执行循环：`browser.ts` `executeMission`（waiting_human 状态会被保留等待用户答话——已有概念，只是没落盘）。
- 本机数据目录：`%APPDATA%\sparo-store\`（`paths.ts` `storeConfigDir()`）；聊天记忆 `profile/chat-memory.ts` 已有「追加+回放」的先例可参考。

## 改动清单

### 1. 事件日志 `src/main/agent/mission-journal.ts`（新建）

```ts
export type MissionEvent =
  | { t: number; op: "open"; mission: ActiveMission }
  | { t: number; op: "turn"; id: string; state: MissionState; plan?: Plan; findings?: StepFinding[] }
  | { t: number; op: "close"; id: string; reason: string };
```

- `appendMissionEvent(evt)`：追加写 `%APPDATA%/sparo-store/missions.jsonl`（一行一事件，写失败只警告不中断任务）。
- `replayMissions()`：启动时读全文件，折叠出 `state != "done"` 且未 close 的最新工作单快照。
- 日志超 2000 行时压缩：只留每个未完成单的最新快照 + 最近 200 行。

### 2. runtime.ts 打点

- `applyTurn` 每次 state 变化、plan 变化、findings 追加时 `appendMissionEvent({op:"turn",…})`。
- 新开单 open、完成/取消 close。
- browser.ts 启动流程：`replayMissions()` 有未完成单 → 侧栏推一张恢复卡：「上次『……』跑到第 N 步，继续？」用户说「继续」→ 从快照恢复 activeMission 续跑；说「算了」→ close 掉。
- 恢复卡只在启动后第一条用户消息前出现一次，不反复烦人。

### 3. 崩溃恢复语义（写清楚给 Cursor）

- 恢复的是「工作单状态」，不是「浏览器现场」：页面标签丢了就按 plan 当前步重新打开，不追求 DOM 级复原。
- waiting_human 的单恢复后仍 waiting_human，等用户答话。
- 恢复时若发现是 7 天前的旧单，提示语加日期，用户多半会说「算了」。

### 4. 单测 `tests/mission-journal.test.ts`

- 事件追加/回放/折叠；损坏行跳过不崩；2000 行压缩；恢复卡在「继续/算了」两个分支。
- 现有全部测试绿。

## 禁区

- 不做多设备同步、不加密（本机文件，隐私文档另行说明）。
- 不改 T03 的 plan 结构；findings 序列化时注意截断超长 text（单条 finding text 存前 500 字）。
- 不碰 `docs/listings/`、`cloud/`、`envs/`、`cs/`。

## 验收

1. 开发窗发「下周一从北京去上海出差两天 要机票和酒店」→ 跑到一半（计划卡有勾有圈）→ **直接杀进程** → 重启 → 侧栏出恢复卡 → 说「继续」→ 从断点继续跑完出手册。
2. 完成一单后 `missions.jsonl` 有完整 open→turn*→close 链。
3. 说「算了」后该单 close，不再出现恢复卡。
4. `npx vitest run` 全绿。

交付物：commit + typecheck/test 输出 + 2 张截图（恢复卡、续跑完成）+ 一份 missions.jsonl 样例片段。

## Commit

`feat(t04): 工作单事件溯源持久化与断点续跑`
