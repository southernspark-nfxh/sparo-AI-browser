# M0-02 现行链路基线

> 2026-10-29。只读 `%APPDATA%\sparo-store\missions.jsonl`（715 行：open 180、turn 411、close 124）。没有重跑任务，没有改运行时代码。
> 只统计 `M0-01-TASK-SET.md` 里的原句。词面不同的历史句子不并进该场景。
> 模型调用次数和 Token 在这份日志里没有字段，`src/main/agent/deepseek.ts` 也没有把 usage 落盘。这两列全部是 `[TBD]`，不用墙钟或 finding 数去换算。

墙钟是该条 `open.t` 到最后一条 `close.t`，含排队和人等待。样本少于 8 条，不报 P95。`finding.ok===false` 记为工具失败。`close=done` 且 findings 为 0 记为结构性假完成。QA 文档里已经写明「关成 done 但交付不对」的单，另列，不折成百分比。

## 有原句样本的场景

| 场景 | 原句命中 | 关单 | 工具失败 | 开单到关单 | 无进展 | 模型调用 / Token |
|---|---|---|---|---|---|---|
| G1 | 6 | 全部 `done` | 0 | 最短 1064 ms，最长 2939 ms | 无 `较上次` | `[TBD]` |
| G2 | 4 | `done` 2，`incomplete` 2 | 0 | 最短 4444 ms，最长 263522 ms | `m-mvqjiobt-eeei8` 有 7 条 `较上次 +0` | `[TBD]` |
| G7 | 5 | `done` 3，`incomplete` 2 | 0 | 最短 18160 ms，最长 32023 ms | 无 `较上次` | `[TBD]` |
| T1 | 4，均符合日期模板 | `done` 1，`incomplete` 2，`dup` 1 | 2，都在 `m-mvqcuzkq-3vsuv` | 不含 dup：23697–66458 ms。dup 的关单距开单约 3.3 小时，不当作任务耗时 | 无 `较上次` | `[TBD]` |
| P1 | 4 | `done` 3，`incomplete` 1 | 3，都在 `m-mvqcmhw8-pohvi` | 最短 56421 ms，最长 241525 ms | `m-mvqqc8d4-b8tjj` 有 6 条 `较上次`，其中没有 `+0` | `[TBD]` |

G1 的 6 条都是 2 个 turn、1 条 `navigate` finding。多出来的那个 turn 是空 findings 的入口 turn。

G2 里 `m-mvp5ukto-ncuax` 是 `incomplete`、findings 为 0、墙钟 4444 ms。这是零执行收尾，不是假 `done`。

G7 的 3 条 `done` 里，只有 `m-mvq4oo73-sofnv` 有 `search_read`。另外两条 `done` 的 cap 全是 `navigate`。底账不能据此判定它们是假完成，假完成率保持 `[TBD]`。

T1 计入的原句词序与任务集模板一致，日期是当时换上的可订日期。`m-mvq60gub-oom09` 含「时间好价格」「以及」「晚上」，词面不同，不计入。

## 已有 QA 写明的交付不符

这些不是新跑出来的比例，只是同一批 mission id 上已经写过的判断：

- G2 `m-mvqcifdx-kq02h` 关成 `done`，当时记录没有新文档。见 `docs/QA-20261027-BATCH-COMMON-SCENARIOS.md`。
- P1 `m-mvqcmhw8-pohvi` 关成 `done`，阅读页写「自动填入未完成」。见 `docs/BUG-20261027-WEIBO-SKILL-MISS.md`。
- P1 `m-mvqjr1zb-tf641` 关成 `done`，阅读页未形成可发布正文。见 `docs/BUG-20261027-S3-READING-PAGE-DONE.md`。

结构性「`done` 且 findings 为 0」在上表五个场景里是 0。

## 任务集里没有原句样本

| 场景 | 日志结果 | 基线 |
|---|---|---|
| G3 | 原句命中 0 | 调用、时延、失败、假完成、无进展都是 `[TBD]` |
| G4 | 原句命中 0。日志里有另一句 tomkeeper 画像，词面不同，不拿来充数 | `[TBD]` |
| G5 | 短肯定成功时不应新开单，所以不能用 open 行证明成功。另有一条未关单 `m-mvp0oohl-9p3qx`，raw 正好是 `打开`，findings 为 0 | `[TBD]` |
| G6 | 原句命中 0 | `[TBD]` |
| G8 | 没有独立原句。只在 G2 的 `m-mvqjiobt-eeei8` 上看到 7 次 `+0` | 其余采集句的滚动增量是 `[TBD]` |
| R1 | 首版冻结句命中 0 | 见下文。首版句的调用、时延、失败都是 `[TBD]` |

R1 首版冻结句是 `帮我对比小米15、iPhone16、华为Mate70 哪个值得买`。日志命中 0。当时另有一条不同原句：`帮我对比三款 小米15、iPhone 16、华为Mate 70 哪个值得买`（`m-mvqd6bpj-27mxu`）。多了「三款」和空格，所以没有进入当时的 R1 基线。

## R1 改为历史原句之后

2026-10-29 把冻结句改成 `帮我对比三款 小米15、iPhone 16、华为Mate 70 哪个值得买`。上一段的「首版冻结句命中 0」仍然有效。

按新冻结句，`m-mvqd6bpj-27mxu` 可以计入 R1：

| 项 | 值 |
|---|---|
| 关单 | `incomplete` |
| findings | 1，cap 为 `mission` |
| 工具失败 | 0 |
| 开单到关单 | 157530 ms |
| 无进展 | 无 `较上次` |
| 模型调用 / Token | `[TBD]` |

这一条不是成功样本。不能把它写成 `done`，也不能用它填 Token 或组合成功成本。

## 这次基线不能用来做的事

- 不能填 O-01 的 Token 数。
- 不能计算组合成功成本。
- 不能把 `[TBD]` 场景说成现行链路已通过或已失败。
