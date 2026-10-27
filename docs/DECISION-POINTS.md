# 决策点登记册（任务循环）

> 活代码用这一份。技能通道那份在 [THREE-CHANNEL-DESIGN.md](./THREE-CHANNEL-DESIGN.md) §4，两边互相指，不各记各的。
> 新增任何会提前结束任务、绕过脑区、或改变任务走向的本地判断，先在这里登记再合码。约定写在根目录 [AGENTS.md](../AGENTS.md)。
> 行号以 2026-10-27 `1bf9aa0` 为准，改完对不上就改这一份。

处置只用这几句：删 / 降级为带过期的 fallback / 保留并写明理由 / 交还模型 / 待另开任务书。

| # | 决策点 | 位置 | 触发后会怎样 | 依据 | 处置 |
|---|---|---|---|---|---|
| 1 | `siteOpenEndsTheJob` | `reasoner.ts` `siteOpenEndsTheJob` | 回答「能不能当成只是开站」。本身不关单 | 脑区计划，否则 `mission.plan`。两份都没有才交给第 2 条 | 保留。有计划时本地不再用正则拍板 |
| 2 | `openSiteIsTheJob` | `reasoner.ts` `openSiteIsTheJob` | 无计划时仍可能让第 3 条在循环第 0 步结束 | 正则。`打开/前往/进入` 紧跟「的/了/着/过」直接否 | 降级为 fallback，**过期 2027-01-23**。到期没有计划就不许本地判开站完成。禁止往排除词表补「复制\|整理\|文档」 |
| 3 | `namedSiteIsOpen` | `browser.ts` `namedSiteIsOpen`；调用在循环开头、每步之后、循环后关单三处 | 能在第 0 步 `break`，并在人已经在该站上时 `close(done)` | 第 1 条 + 当前 URL 同站且不是登录/验证墙 | 保留。三处必须调用这一个方法 |
| 4 | `skipLoneNavigate` | `plan.ts` `skipLoneNavigate`；只在第 3 条为真、清点之前 | 把唯一的 `navigate` 从 `running` 标成 `skipped` | 结构：恰好一步且 cap 是 navigate | 保留。不许为了纯开站放宽 `earlyExitMayCloseDone` 的未完成判定 |
| 5 | `userDidNotAskToRead` | `reasoner.ts` `userDidNotAskToRead`；调用 `browser.ts` 循环后的「没要求读页」关单 | 计划看起来做完、且点了站点时，可以 `close(done)` 并回「已打开」 | 正则。词表里没有复制、文档、导出 | **待另开** [BUG-20261027-READ-INTENT-EARLY-EXIT.md](./BUG-20261027-READ-INTENT-EARLY-EXIT.md)。本册不改它 |
| 6 | `loginRedirectNote` | `reasoner.ts` `loginRedirectNote`；调用在站点落地之后 | 登录地址被跳回站内时可以收工 | 发现里有过登录 URL 的 navigate | 保留。同一条 `earlyExitMayCloseDone`，采集单不许假 done |
| 7 | `stall >= 3` | `browser.ts` 主循环「连着 3 步没进展」 | 离开循环去汇总，或先问要不要打开站点。不直接 done | 连续失败计数 | 保留。失败收摊，不判完成 |
| 8 | `gateSiteDelivery` | `reasoner.ts` `gateSiteDelivery`；循环内、stall、循环后各一处 | 能改成先 navigate，或 `waiting_human` 问要不要打开 | 点了站点、当前页不在该站、还没 navigate 过 | 保留。只决定要不要先开站，不判任务完成 |
| 9 | `repeatStop` | `deepseek.ts` 同一工具指纹连续 4 次 | 停掉这一轮工具循环，把掐断句交回大脑。不关工作单 | 调用指纹 | 保留。只停重复调用 |
| 10 | mission 二次执行守卫 | `browser.ts` `missionOkRuns >= 1` | 报告单的 mission 整手成功一次后，再要 mission 就离开循环去合成 | 成功次数 | 保留。防同一报告连扫。定点 `search_read` 不受限 |
| 11 | 阅读页改写门岗 | `browser.ts` `judgeReadRewrite`，上一则是阅读页时 | 只有模型答 `rewrite` 才改旧页，否则开新单 | 模型 | 交还模型。保留 |
| 12 | `routeUserGoal` | `intent-router.ts` `routeUserGoal` | 侧栏主路径不靠它分诊。车道分类和 `parseLocalIntent`（启发式手册、阅读口令）仍会走到 | 正则 / 站点表 | 保留并写明：禁止再加句式，用来在侧栏抢答脑区 |
| 13 | `applyHostLessons` | `browser.ts` `executeMission` 进循环之前 | 本机经验要求暂停，且当前是登录/验证墙时，直接 `waiting_human` | 本机 lessons | 保留。没墙只是记一句，不截任务 |
| 14 | `replayHabit` | `browser.ts` `replayHabit`，`dispatchChatJob` 里在进脑之前 | 原话精确命中触发语、门岗没被未关单/附图/引用挡住时，直接跑技能 | 查表 | 保留。这是技能通道已登记的门岗，见三通道 §4 |
| 15 | 站点落地询问 | `browser.ts` 循环后的 `siteLandingPrompt` | 人已经在目标站上时再问模型要不要打开登录页 | 模型 | 交还模型。保留 |
| 16 | `earlyExitMayCloseDone` | `verify.ts` `earlyExitMayCloseDone` | 不决定做什么。计划还有 pending/running/failed，或报告/填表没交，就不许 `close(done)` | 计划状态 + `report`/`form` | 保留。必交付 `page` 不在这道清点里，和要求 5 同一张另开的单 |
| 17 | 入口 turn 算执行过 | `browser.ts` `executeMission` 里进循环前的 `journalMissionTurn`；`mission-journal.ts` `missionWasExecuted` | 计划第 0 步在创建时就是 `running`，这条空 `findings` 的 turn 仍让 `turns > 0` | 有 turn 行 | **待另开** [BUG-20261027-ENTRY-TURN-COUNTS-AS-RUN.md](./BUG-20261027-ENTRY-TURN-COUNTS-AS-RUN.md) |
| 18 | 模型收摊 | `browser.ts` `thought.synthesize \|\| !thought.next` | 离开循环。计划仍有未完成步时，清点不许 done | 模型 | 保留 |
| 19 | 挂起短肯定 | `intent-router.ts` `isShortAffirmative`；`browser.ts` 挂起单分支 | 全句是「打开 / 好 / 继续」时续跑挂起单，不开新单 | 全句正则 | 保留。带宾语的「打开微博」不认 |
| 20 | `pageBlocksDone` | `verify.ts` `pageBlocksDone`；`browser.ts` 登录落地、没要求读页、最终 `verifyContracts` 三处关 done 之前 | 目标站点和当前页不同站时不许 `close(done)` | 当前 URL 与 `site` / `siteUrl` | 保留。登录墙若仍在该站（含子域）不算挡住。没点站点的单不拦 |
| 21 | 关单流水对上计划步 | `verify.ts` `unmetPlanSteps` 的标签与发现重叠 | 计划步的标签有连续 4 字出现在某条成功发现的标签、query、URL 或正文里，关单不再写「还没执行」 | 实际 turn 流水，不看计划状态假设 | 保留。对不上的采集步仍挡住 done，见 `kernel.test.ts`「采集步没跑」 |

模型把采集句编成「一步 navigate + 只有 answer」时，第 1 条仍会当成只是开站。这是信脑区计划的残留，不是词表漏洞。无计划又带「复制」的句子在过期日前仍走第 2 条。
