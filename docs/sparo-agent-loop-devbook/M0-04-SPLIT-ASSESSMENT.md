# M0-04 browser.ts 拆分评估

> 2026-10-29。只读 `src/main/browser.ts`。没有下刀，没有改运行时代码。
> 结论：可以按下面五刀拆。每一刀都能单独撤掉。Mission 的现行写入口只有 `SparkBrowser` 的 `activeMission` setter 一条，但它背后有两块存储。v2 不得再写这两块，否则拆分门不能过。

## 调用

`executeMission()` 的入口都在 `browser.ts`：

| 入口 | 位置 | 谁拥有这张单 |
|---|---|---|
| 恢复未完成单后继续 | `takeRecoveryAnswer` | 回放出来的那张单 |
| 挂起后的短肯定 | `dispatchChatJob` | `waiting_human` 的原单 |
| 学习提问得到回答 | `dispatchChatJob` | 当前 `activeMission` |
| 继续协议 | `handleChat` 的 resume | 当前单，且状态是 `waiting_human` 或 `running` |
| 旁问 | `handleChat` 的 side | 旁问单先跑；只有它 done 或 cancelled 才把原来的单放回 |
| 新单或续跑 | `handleChat` | `turn.mission` |

`runLoopStep()` 只被 `executeMission()` 调用，包括普通步和循环后的 final gate。它同时做三件事：用目标里的城市和日期填默认值，打开或读取页面，再用正文长度决定 `ok`。

`runLlmGoal()` 不写 Mission 关单。它从三类入口进来：侧栏的 `act` / `llm` 动作、填表预览、本地资料填进当前网页。它调用 `deepseek.chat()`，再 `takeMutations()` 并可能沉淀技能。

云任务在 `executeMission()` 开头 `beginCloudTaskIfNeeded`，`finally` 里 `finishCloudTask`。关单由同一函数及其调用的 `closeMissionRecord` 写入 journal。

## 共享状态

`activeMission`、`lastMission`、`agentTabId`、`helpAsk`、`cloudTaskId` 的 setter 都先看 `AsyncLocalStorage` 里有没有 `TaskScope`。有就写入 scope，没有就写入同名的 fallback 字段。一次赋值不会同时写两块，但两块可以各持有一张单。

此外：

| 字段 | 写者 | 并发 |
|---|---|---|
| `waitingMissions` | `runJob` 在挂起时保存当前单 | 按任务 id |
| `taskPool` | 前后台车道，后台最多 3 个 | 与前台 fallback 不是同一张单 |
| `chatLog` | 几乎所有侧栏回复 | 全局一条 |
| `tabs` / `activeTabId` | 标签操作 | 全局 |
| `approvals` | 批准请求 | 全局，过期会删 |
| `pageFinger` | 不是字段，是每次用当前 URL 和标题算出来的值 | 跟 tab 走 |

现行没有第二个类在写 `activeMission`。风险是 v2 如果再写 fallback 或 scope，就会和旧循环同时持有同一张单。拆分门要求 v2 使用自己的 Mission 存储，只按 mission id 读写，不调用这个 setter。

## 副作用

导航、读页、滚动和点击在 `runLoopStep` 与 `runLlmGoal` 的工具循环里发生。超时后页面可能已经打开，日志里只有失败句，不能把这一步再自动重放。

会留下外部状态的还有：云任务开始和结束、`missions.jsonl`、侧栏 `chatLog`、报告和文档文件、草稿或发布、技能蒸馏、窗口拉回和任务栏闪烁。

回滚时保留已经写下的报告、草稿和 journal。禁止重放的是发布、发送、付款和未知是否已经提交的表单。

现行有一处关单语义要原样留在 legacy：无进展收尾时 `state` 被写成 `done`，journal 的 reason 却是 `incomplete`（`executeMission` 的 stall 分支）。M0 不改这个行为。v2 按已定口径走 `blocked`，不借拆分去改旧链路。

## 下刀顺序

每一刀只加边界，不搬语义。撤掉该刀时，legacy 仍走原来的函数。

1. **浏览器动作适配。** 把 `runLoopStep` 使用的导航、读页和点击收成只读接口。legacy 改为调用接口，判定仍留在原函数。撤掉适配后恢复直接调用。
2. **Artifact / Evidence。** 新存储写在 journal 旁边。旧的 500 字 finding 继续负责恢复。撤掉后只剩 journal。
3. **Tool Gateway。** 只接 `runtime=v2` 的新单。未知工具、参数错误和异常回写给 v2。legacy 的 `runLoopStep` 不经过它。
4. **Actor / Runtime。** 新模块持有 v2 的消息历史和 Mission 存储。不在 `executeMission` 里加分支。
5. **Close Guard。** 只在 v2 关单时运行。legacy 的 `earlyExitMayCloseDone` 留到对应场景验收之后。

禁止的切法是在 `executeMission` 内部用 if 分出 v2。那样两套循环会共用 setter，这一刀不能单独撤掉，拆分门失败。

## 拆分门

调用图、写入口、副作用和回滚点已经写明。Mission 写者没有第二处隐式类。前提是实现时遵守第四节：v2 不写 fallback，也不写 `TaskScope.mission`。

这只完成 M0-04。M1 仍要等 M0-05 的成本门和 O-07 的提审记录。
