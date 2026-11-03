# WP4 结果矩阵

> 2026-10-29。离线回放，不是生产 Mission。O-01 仍是 `[TBD]`。成本门未过，M1 保持关闭。本文不是 `M0-05B-COST.md`。

35 个 case 先写入 `m0-05b/cases/`，再调用模型。运行后没有改这些预期。Trace 在 `m0-05b/runs/wp4/`。`%APPDATA%\sparo-store\missions.jsonl` 仍是 1596213 字节，mtime `2026-10-27T13:46:15.994Z`。没有发送，没有付款，没有打开浏览器。

## 版本

| 项 | 值 |
|---|---|
| 设施 | `m0-05b-facility-1` |
| 模式 | `offline_replay` |
| rubric | `verifier-rubric-1` |
| prompt | `verifier-prompt-1`，sha256 `f997b6ebbd024053075f84ef9aa3cb01aa160be7ac6721cfea2043c60d24f110` |
| Artifact 清单 | `m0-05a-2026-10-29` |
| 模型 | byok / deepseek / `deepseek-flash` |
| 价格版本、价格日期、成本 | `[TBD]` |

完成的模型调用都带回了供应商用量。未缓存输入 9825、缓存输入 3328、输出 34315；供应商报告的 prompt 合计 13153，与未缓存加缓存一致。价格版本没有冻结，这些 Token 不能换成成本，也不能填进 O-01。本轮没有失败调用；以后失败调用没有用量时仍记 `[TBD]`，不记 0。

`evalBudget` 只出现在测试终止里：预算格是 `actorTurns=1` 对 `limitActorTurns=1`，连续拒绝格是 `verifierTurns=2`。字段带 `notO01: true`。没有把它写成 O-01。

## 结果矩阵

「覆盖」只来自 trace 里的终止和 Verifier 原始 `goalSatisfied`。没有手工改标签。

| 任务 | 通过 | 误拒后通过 | 连续拒绝 | 预算耗尽 | 取消/运行失败 |
|---|---|---|---|---|---|
| G1 | 覆盖。轻量路径，独立 Verifier 0 次，`close.reason=done` | 覆盖。对照实验两轮：先 `false`，补读后 `true` 且 Guard 通过 | 覆盖。对照实验两轮都是 `false`，`verification_exhausted` | 覆盖。`budget_exhausted`，没有 close | 覆盖。`cancelled` |
| G2 | 未覆盖 | 未覆盖 | 覆盖 | 覆盖 | 覆盖。另有用户按现状结束的 `incomplete` |
| G4 | 未覆盖 | 未覆盖 | 覆盖 | 覆盖 | 覆盖。`cancelled` |
| G6 | 覆盖。第一轮 `goalSatisfied=true`，Guard 通过 | 未覆盖。有效候选没有被拒绝 | 覆盖 | 覆盖 | 覆盖。`cancelled` |
| G8 | 未覆盖 | 未覆盖。两轮都是 `false`，补读后仍未通过 | 覆盖 | 覆盖 | 覆盖。`cancelled` |
| T1 | 未覆盖 | 未覆盖 | 覆盖 | 覆盖 | 覆盖。`cancelled`，另有 `runtime_rollback` |
| P1 | 覆盖。同一 case 的第二轮通过并关单，草稿未发送 | 覆盖。第一轮 `false`，补读热搜区间后 `true` | 覆盖 | 覆盖 | 覆盖。`cancelled` |
| R1 | 未覆盖 | 未覆盖 | 覆盖 | 覆盖 | 覆盖。`cancelled` |

G2、G4、T1、R1 的部分候选在冻结时就不是有效交付：缺 10 月 27 日、报告未打开、去程页不是 11 月 11 日且没有返程和酒店价格、没有三款对照报告。模型拒绝了它们。这些拒绝不记成误拒，也不记成通过。

G1 的误拒和连续拒绝是独立 Verifier 对照实验。G1 轻量生产路径的模型调用数是 0。对照实验 4 次调用、未缓存 1466、缓存 384、输出 6436，不计入 G1 生产成本。

`G1-false-reject-control` 和 `P1-pass-or-false-reject` 的第二轮验收当时已经通过，运行器漏写了 `mission.closed`。关单事件是事后按这条已记录的验收和冻结 Guard 补上的，没有再调用模型。事件上有 `appendedWithoutModelCall: true`。

## 未覆盖对 O-01 的影响

通过未覆盖：G2、G4、G8、T1、R1。  
误拒后通过未覆盖：G2、G4、G6、G8、T1、R1。

Trace 里的价格版本和成本仍是 `[TBD]`。报告层的牌价见 `M0-05B-COST.md`，不填 O-01。结果矩阵没有齐，O-01 继续 `[TBD]`。不宣布成本门通过，M1 不申请。

## WP5 追加

没有改上面 35 个 case。另冻了三份有效候选再调用：`G4-report-pass` 先读开报告，`G6-false-reject-sample2` 复用同一首诗，`G8-pass-sample2` 复用同一份观察。三份都是两轮原始拒绝，补读后仍未通过。G2、T1、R1 没有可独立判为有效的完整交付，没有追加。11 个缺口还在。覆盖仍是 29/40。
