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
| 5 | `userDidNotAskToRead` | `reasoner.ts` `userDidNotAskToRead`；调用 `browser.ts` 循环后的「没要求读页」关单 | 没有脑区产物、计划看起来做完、且点了站点时，可以 `close(done)` 并回「已打开」 | 词表仍是兜底。`kind=page`、必交付 `page`、或多步计划在场时本地不许判「没要求读」 | 保留。禁止往词表补「复制\|文档」。见 [BUG-20261027-READ-INTENT-EARLY-EXIT.md](./BUG-20261027-READ-INTENT-EARLY-EXIT.md) |
| 6 | `loginRedirectNote` | `reasoner.ts` `loginRedirectNote`；调用在站点落地之后 | 登录地址被跳回站内时可以收工 | 发现里有过登录 URL 的 navigate | 保留。同一条 `earlyExitMayCloseDone`，采集单不许假 done |
| 7 | `stall >= 3` | `browser.ts` 主循环「连着 3 步没进展」 | 离开循环去汇总，或先问要不要打开站点。不直接 done | 连续失败计数 | 保留。失败收摊，不判完成 |
| 8 | `gateSiteDelivery` | `reasoner.ts` `gateSiteDelivery`；循环内、stall、循环后各一处。`siteAskYieldsToPlan` 在问句发出前 | 能改成先 navigate，或 `waiting_human` 问要不要打开。计划里还有 pending/running 的非 navigate 步时不问，接着做那些步 | 点了站点、当前页不在该站、还没 navigate 过 | 保留。只决定要不要先开站，不判任务完成。登录墙不走这条让路 |
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
| 22 | 高铁/机票拒收后补槽 | `plan.ts` `settleTravelPlan`；`runtime.ts` 计划挂上之后 | 组不出腿的车次步先用原句和该步标签再拆 from/to/date，拆得出就补进可执行手册；仍缺出发地或这段日期就问人，并在卡片上标 failed 写人话。不许 pending 到关单还不解释 | 原句、步标签、`known` 里的出发地。日期不看第 23 条禁止的入住日 | 保留。只补车次槽，不改酒店步 |
| 23 | 车次日期不回落入住日 | `loop.ts` `travelSearchLeg` | `train_search` / `flight_search` 的日期只取 `step.date` 或该段 label/query/原句里拆出的日期。`known.start` 是酒店或另一段的日子时不拿来组腿 | 该段文字里的月日 | 保留。拆不出日期就走第 22 条，不许默用入住日 |
| 24 | 关单「没执行」先对流水 | `verify.ts` `unmetPlanSteps` 的按段解码 | 页面正文里有残缺 `%` 时不再把整段 URL 解码扔掉；搜索 URL 里的中文查询能对上计划步。对不上的采集步即使 answer 已被长文覆盖，仍写「没执行」并挡住 done | 发现的 URL / query，按百分号片段解码 | 保留。禁止用「必交付已齐」把没跑的采集步移出清单，见「采集步没跑」 |
| 25 | 同 cap 多段逐段对账 | `verify.ts` 车次/机票/酒店多步配对；`plan.ts` `closePlan` | 计划里同一 cap 有多步时，一条成功发现只抵一段。缺的那段在「还缺」里单列（如「还缺：返程车票」），不许 done。`closePlan(complete=true)` 不把仍在 running/pending 的步涂成 done，标 skipped 并写上这段还没跑完 | 计划步顺序、发现的 cap，以及步标签里的月日和发现 URL 里的日期 | 保留。单段计划仍按原交付物对账。禁止一条去程发现抵掉整个车票 |
| 26 | 新核心模型轮次软提示 | `free-soul.ts` `FreeSoul.run()` | 达到 32 轮时**不结束任务**，向侧栏推一条轮次提醒（「已执行 32 轮，任务继续中，可随时停止或发新指令」），循环继续；此后每 8 轮（40、48…）同样提醒一次。**100 轮安全网**：到达才结束 run，文案如实写明已达安全上限、回复继续可接着跑 | 单次任务内连续的 assistant/tool 轮次；提醒频率每 8 轮；安全网 100 轮 | 2026-11-03 按用户要求改写：叫停与否由用户决定，不替用户抉择。安全网只防死循环烧钱，不判任务成败、不选路线；BUDGET_HINT（#30 收尾提醒）保留；打断链全程可用 |
| 27 | 新核心重复操作提示 | `free-soul.ts` `FreeSoul.run()` | 同一工具指纹连续 3 次且页面无变化时，向 messages 注入一条换策略提示，然后清空计数让模型继续。不结束循环，不关单，不替模型写成已放弃 | 工具名、关键参数、执行前后页面指纹；拿不到页面地址就用工具结果 message | 保留。只注入提示，不替模型决定，不伪造完成。只管新核心，不改旧决策点 #9 |
| 28 | 不可逆动作确认门 | `free-soul.ts` `request_confirm` | 模型调用后立即结束本次 run，用成功态返回确认问句（`ok: true` 且 `awaitingConfirm: true`），等用户下一条消息。不复用 `requestApproval` | 模型显式调用。同意与否由下一轮模型看 history 判断，本地不拦 | 保留。`request_confirm` 是唯一合法的不可逆动作中断点。范围只限发布、发送、支付、删除。客服回复不走这道门 |
| 29 | 新核心正文重复提示 | `free-soul.ts` `FreeSoul.run()` | `page_text` 正文连续 3 次相同（中间可以夹别的工具）时，向 messages 注入一条「基于已读内容汇报」的提示，然后清空计数让模型继续。不结束循环 | 同一次 run 里的 page_text 正文全文 | 保留。只注入提示，不终止、不替模型决定。与 #27 的调用指纹并存，不改 #27 |
| 30 | 新核心轮次预算提示 | `free-soul.ts` `FreeSoul.run()` | 执行到轮次上限的 75%（默认 24/32，取整）时注入一次收尾提醒。每次 run 只注入一次，不结束循环 | 当前轮次与本次 `maxRounds` | 保留。预算提示不改变任务走向，只提醒收尾 |
| 31 | 新核心跳过店小秘提交闸门 | `browser.ts` 点击路径 `submitClickNeedsGate` | `freeSoulRunning` 时，提交类点击不调用 `qaGate`、不弹 `requestApproval`。旧路径仍走这两步 | 不可逆确认只留在 #28 的 `request_confirm`。执行层再拦一次会把知乎发布误判成速卖通 | 保留。只这一处布尔短路。不许删 `looksLikeSubmitAction`、`qaGate`、`requestApproval`，不许加站点白名单 |
| 32 | 新核心模型请求超时 | `free-soul.ts` `completion` | 单次请求默认 120 秒，到时 abort，原样重试一次。第二次仍失败则本次 run 以 `ok: false` 结束，文案写明超时或失败、可重试。不把已有工具结果收成答案 | 这一次 HTTP 请求的耗时 | 保留。只终止挂起的请求，不替模型选路线，不判任务成败 |
| 33 | 新核心 click_text 放行发送 | `publish-gate.ts` `gateClickText`；`browser.ts` `clickText` | `freeSoulRunning` 时 send 类不再查 `allowClick`。支付、登录、验证码仍拦。旧路径不变 | 点击文字的分类。确认仍在 #28 | 保留。只豁免 send。不许删 `classifyClick` / `allowClick` |
| 34 | 自动执行模式边界 | `settings/store.ts` `execMode`；`free-soul.ts` `systemPrompt` | `execMode === "auto"` 时提示词要求发布、发送直接执行、不调用 `request_confirm`；支付、删除仍必须确认。模型若仍调用 `request_confirm`，本地照常中断等待，不代答。客服回复两模式都只填草稿。登录、验证码、安全验证两模式都如实停等。step 模式提示词与原先逐字相同 | settings 里用户显式选择的 `execMode`，不是本地自主判断。任务书写作 #30，登记册 #30–#33 已占用，本条为 #34 | 保留。假完成禁令与轮次护栏（#26）继续生效。本地不吞确认、不代答 |

模型把采集句编成「一步 navigate + 只有 answer」时，第 1 条仍会当成只是开站。这是信脑区计划的残留，不是词表漏洞。无计划又带「复制」的句子在过期日前仍走第 2 条。
