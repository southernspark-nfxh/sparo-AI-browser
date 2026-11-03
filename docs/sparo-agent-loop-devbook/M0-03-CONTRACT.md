# M0-03 契约冻结

> 版本：`verifier-rubric-1`，2026-10-29。同日修订：补必填身份、Artifact、恢复语义和关单 trace；并收紧 Guard 失败不写 `mission.closed`。rubric 条款没有改。
> 不冻结预算数字，不采样全文，不改运行时代码。
> 产品书第 8、9、12 节的接口字段和必填关系继续有效。本文是冻结针。下文列出的语义不能删。上文没再列的可选字段，仍按产品书，不能因为本文没重复就去掉。

## 1. 这次冻结什么

| 项 | 状态 |
|---|---|
| Mission、观察、证据、交付、验收结果、关单、分级、恢复 | 冻结为本文，并继承产品书 §8、§9 |
| Artifact 最小结构 | 冻结为本文第 3 节。采样仍未开始 |
| v2 trace 事件名和负载 | 冻结为本文第 4 节，并继承产品书 §12.3 |
| Verifier rubric `verifier-rubric-1` | 冻结为本文第 5 节 |
| 预算的轮次、Token、墙钟上限 | 不冻结，全部 `[TBD]` |
| O-01 临时 Token 预算 | 不填。没有全文 Artifact 之前不能填 |
| O-06 的保留期长短 | 不冻结。到期不自动关单这一条已经生效 |
| 现行 `missions.jsonl` | 不迁移。没有 `schemaVersion` 的旧行仍按旧结构读 |

## 2. 关单与入句

状态只有 `propose`、`running`、`waiting_human`、`blocked`、`done`、`cancelled`。不增加 `incomplete` 状态。

| close.reason | state | 何时可以写 |
|---|---|---|
| `done` | `done` | 独立验收或轻量结构校验通过，并且 Close Guard 通过 |
| `incomplete` | `cancelled` | 用户看过缺口后明确要求按现状结束。侧栏写未完成，不写用户取消 |
| `cancelled` | `cancelled` | 用户主动取消或放弃 |
| `runtime_rollback` | `cancelled` | 运行时紧急回滚 |

`blocked` 和 `waiting_human` 不写 `close`。Close Guard 失败也不写 `close`，Mission 保持 `running`，或按原因进入 `blocked` / `waiting_human`。预算耗尽、验收耗尽、可恢复异常的原因是 `budget_exhausted`、`verification_exhausted`、`error`，不是关单原因。

入句先看 `blocked.reason`。只有 `missing_input` 可以补槽。`budget_exhausted`、`verification_exhausted`、`error`、`needs_decision` 走恢复选项。「继续」或一个城市名不得写入这些单的槽位。

登录、验证码、付款、授权进入 `waiting_human`，不进入 `blocked`。

## 3. 字段语义

### Mission

必填：`schemaVersion=2`、`id`、`runtime="v2"`、用户原句、目标、约束、交付契约、计划、`executionClass`、`evidenceIds`、状态、预算、确认状态。

`blocked` 时必填 `reason`、`summary`、`gaps`、`recoveryOptions`。`close` 只在终态出现，含 `reason`、`summary`、`gaps`。

约束至少有一条用户原话或已确认修订，并标明来源是用户还是确认后的修订。

计划步至少有稳定 `stepId`、工具名、意图、预期产出、状态，以及关联上的 `observationId`。`covers` 只表示计划意图，不能当完成证据。空的入口 turn 不是观察，不参与完成。

### ToolObservation

`schemaVersion=1`。必填 `observationId`、`missionId`、`callId`、工具名、脱敏后的 `argsSummary`、起止时间、`executionOk`、摘要、`artifactIds`。`callId` 不能代替 `observationId`。

`executionOk` 只表示工具按契约执行完。失败也写一条观察，`executionOk=false`。有错误时必填错误码、给模型的说明，以及 `retryable`。错误码只使用：`UNKNOWN_TOOL`、`INVALID_ARGS`、`PERMISSION_DENIED`、`TIMEOUT`、`PAGE_STATE`、`NOT_FOUND`、`NO_PROGRESS`、`BUDGET_EXCEEDED`、`CANCELLED`、`INTERNAL`。不把堆栈给侧栏。

Cookie、密码、云端 Key 不进入观察或 trace。

截断必须标明单位和下一段游标。滚动增量必须指向上一次 `observationId`，并给出字符增量。`+0` 是无进展，不是完成。

### Evidence

必填 `evidenceId`、`missionId`、来源（含 `capturedAt`）、`kind`、`certainty`、`valid`。

`kind` 只使用：`fact`、`content_item`、`page_state`、`artifact`、`user_input`。

`observed` 必须对得上某次观察或用户输入。`inferred` 必须有来源 `evidenceId` 和 `inferenceRationale`，而且 `kind` 不变。

证据指向正文时必填 `contentArtifactId` 和 `contentRange`。区间单位与对应 Artifact 一致。

### 交付

必填 `deliverableId`、`kind`、`description`、`required`、`acceptedArtifactKinds`、`evidenceIds`、`artifactIds`、`status`。

种类只使用：`answer`、`report`、`document`、`collection`、`page_action`、`draft`、`sent`、`form`。状态只使用 `pending`、`satisfied`、`missing`、`invalid`。

「最好上百条」是偏好，不是硬性 100 条。报告写实际样本量。草稿存在不等于已发送。

### 验收结果

`VerificationResult` 必填 `verificationId`、`missionId`、`mode`、`goalSatisfied`、逐项交付状态与证据 id、`unexecutedStepIds`、`invalidEvidenceIds`、`actionableGaps`、`confidence`、`rationale`，以及 `rubricVersion=verifier-rubric-1`。

`mode` 只使用 `lightweight` 或 `independent`。不得只返回布尔值。

### 分级

必填 `initialClass`、`currentClass`、`decidedBy`、`reason`、`planSummary`、`planDigest`、`eligibleConditions`、`modelVersion`、`promptVersion`。思路卡已确认时保留 `confirmedPlanVersion`。

`decidedBy` 固定为 `actor`。`initialClass` 写入后不覆盖。`currentClass` 只能从 `lightweight` 变成 `full`。升级只追加记录，含原因、计划指纹和时间。本地结构校验拒绝轻量时，把未满足条件写入记录，并在执行前升级。不改写模型原来的理由。

轻量资格必须同时满足：单交付、单计划步、无长采集、无多来源对照、无报告或文档、无发布、发送、付款或其他外部写。缺任何一条，执行前就是完整路径。不用句式表改判。

同一 Mission 升到完整路径后不能降回轻量。

### 恢复

`waiting_human` 时 `recovery` 必填：墙类型（登录、验证码、付款或授权）、当前 URL、待恢复动作、给用户的提示。

只读恢复从最后一条完整观察继续。页面身份变了就重新读取，不沿用旧 DOM。

副作用恢复要核对 `idempotencyKey` 和结果 Artifact。无法确定是否已经执行时询问用户，不自动重发。

`blocked.recoveryOptions` 只用于阻塞单的恢复选项。它不代替上面的恢复记录，也不能给非 `missing_input` 的单补槽。

### Artifact

采样和运行时正文都使用同一最小结构：

- 稳定 `artifactId`、`missionId`
- 来源（工具名和 `observationId`，或用户输入）和 `capturedAt`
- 内容种类或 MIME、内容长度、长度单位
- 内容哈希或冻结版本
- 本地定位。给模型的引用不含安装目录的绝对路径
- 可按区间读取。同一冻结版本的同一区间重复读取结果一致

Cookie、密码、云端 Key 和完整个人敏感信息不写入 Artifact 正文。历史 journal 里的 500 字 finding 不是这种 Artifact。

### 预算字段

`limits` 与 `used` 都含 Actor 轮次、工具次数、Verifier 轮次、墙钟、输入 Token、输出 Token。具体上限是 `[TBD]`。用量只由 Runtime 记一笔。

任一相关模型事件的 Token 仍是 `[TBD]` 时，这张 Mission 的输入和输出 Token 用量也是 `[TBD]`，不记 0。缺测量不能判成 Token 预算耗尽。

## 4. Trace

事件名只使用这些：

```text
mission.opened
mission.confirmed
mission.revised
execution_class.decided
execution_class.upgraded
model.requested
model.completed
model.failed
tool.requested
tool.validated
tool.completed
tool.failed
artifact.created
evidence.linked
plan.reconciled
verification.completed
budget.updated
mission.suspended
mission.resumed
mission.closed
context.compacted
```

每条事件必填 `schemaVersion=1`、`eventId`、`missionId`、时间、运行时版本。关联的 step、observation、evidence、artifact、verification id 有则必填。下面几类事件的负载是必填，不能只留 id。

`execution_class.decided` 与 `execution_class.upgraded` 必填理由、`planSummary`、`planDigest`、`eligibleConditions`、`modelVersion`、`promptVersion`。升级事件还要写从轻量到完整，以及时间。

`model.completed` 按 `actor`、`verifier` 或 `compact` 记录模型版本、未缓存输入 Token、缓存输入 Token、输出 Token、价格版本、可得成本，以及按需读过的 Artifact 区间。读不到这些数时记 `[TBD]`，不估算。不默认复制正文全文。

`model.failed` 在供应商返回用量时，记录与完成事件相同的 Token、价格版本和可得成本。没有返回时记 `[TBD]`，不记 0。

`tool.completed` 与 `tool.failed` 都必填 `observationId` 和 `callId`。失败观察的 `executionOk` 为 false。

`verification.completed` 必填 `verificationId` 和 `rubricVersion=verifier-rubric-1`，并带上持久化的 `VerificationResult`，或能定位到这份结果的稳定引用。回放要能读到 `goalSatisfied`、`confidence`、逐项交付状态和缺口。Guard 失败项作为该事件的附加 `closeGuard` 结果或稳定引用持久化，并反馈 Actor。检查项是：必交付 Artifact 是否存在、该打开的报告是否已经打开、计划步是否有观察、发送权限与幂等、预算和状态是否合法。不新增第 22 个事件名。

`mission.closed` 只在 Mission 实际进入终态时写，并必填 `close.reason`、`summary`、`gaps`。`close.reason=done` 时必须附 Close Guard 通过结果，检查项与上面相同。用户取消、按现状结束或运行时回滚不要求 Guard 通过；这些关单可以附最近一次 Guard 结果，没有则不附。Guard 失败时不得写 `mission.closed` 或 `close`。

`mission.suspended` 在 `blocked` 或 `waiting_human` 时必填原因和缺口。`waiting_human` 还要带上第 3 节的恢复字段。若因 Guard 失败而挂起，本事件引用那份 `closeGuard` 结果。

压缩事件必须仍能指回原事件。压缩后保留：原句和已确认修订、未完成计划步、未满足交付、阻塞原因、全部精确 id、来源 URL 和游标、最近失败、已执行副作用的幂等键。

回放只读。用 trace 回答：用户要什么，模型决定什么，实际执行什么，页面返回什么，证据如何绑定，Verifier 为何通过或拒绝，Close Guard 为何放行或拒绝。不重放浏览器副作用。

## 5. Verifier rubric `verifier-rubric-1`

独立 Verifier 没有浏览器或外部动作工具，也不接收 Actor 的自由叙述。输入是原句、约束、计划摘要、交付契约、证据索引和候选产物摘要。摘要不够时，只允许按指定 Artifact 区间补读。不得把「每次读完全文」当成输入前提。

输出必须是第 3 节的 `VerificationResult`。失败要指出交付物或证据，并给出建议动作。建议不是强制路由。

`goalSatisfied=true` 只有在下面全部成立时才允许：

1. 每个必交付都是 `satisfied`，并带 `evidenceId`。
2. 必跑计划步都有真实观察。调研任务缺 `research_mission`、旅行任务缺 `trip_plan` 时，这一条失败。Runtime 不在问模型之前替它插入这两步。
3. 同一条证据不自动抵充同类型的多个独立计划段。
4. `inferred` 有来源和依据，且没有被写成 `observed`。报告上的可见标记是 M2 的事；本条只拒绝无依据推断，不要求报告界面。
5. 长文、侧栏篇幅或 `covers` 不能代替报告、文档或计划步。
6. `draft` 没有被当成 `sent`。未授权的发送使验收失败。
7. `confidence=low` 且关键交付无法判断时，不得 `goalSatisfied=true`。

轻量路径不调用独立 Verifier。它只做结构校验，并把 `mode` 记为 `lightweight`。发布、发送、付款和外部写操作不能走这条路径。G6 只要产出文档，也不能走这条路径。

Close Guard 在 Verifier 或轻量结构校验之后另行检查：必交付文件存在、该打开的报告已经打开、计划步有观察、发送权限与防重复、预算和状态合法。Verifier 通过而 Guard 失败，仍然不能 `done`。

同一缺项再次出现时，下一次 Actor 动作必须不同，或说明为什么无法修复。验收轮次用尽后进入 `blocked`，原因 `verification_exhausted`，不写 `close`。

## 6. 成本口径

组合成功成本的分子包括成功单、失败单（含 `incomplete`）、用户取消单、运行时回滚单，以及仍为 `blocked` 且原因是 `budget_exhausted` 或 `verification_exhausted` 的单。同一 Mission 在冻结截止时只计一次。成功数为 0 时只报总成本和样本量，不做除法。

这条规则已经冻结。数字没有冻结。M0-05A 之前不得用 500 字 finding 填 Token。失败的模型调用有用量就计入，没有用量就保持 `[TBD]`。

## 7. 仍不做

- 全文采样不在本契约里做。确认后的采样记录见 `M0-05A-SAMPLE.md`，不改本文件的字段、trace 和 rubric。
- 不把 v2 Loop 写入 `browser.ts`。
- 不改 `DECISION-POINTS.md`。调研整手和旅行整手的登记仍分别在 M2-01、M3-03 开工前。
- 不选择 A、B、C。
