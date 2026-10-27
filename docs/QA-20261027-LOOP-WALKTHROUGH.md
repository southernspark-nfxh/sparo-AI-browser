# 任务循环走查（2026-10-27）

> 对照 [DECISION-POINTS.md](./DECISION-POINTS.md)。顺序是理解 → 计划 → 循环入口 → 循环体 → 收尾 → 关单。
> 本轮不改这些洞。新洞另开任务书。代码基线 `1bf9aa0`。

## 理解

侧栏主路径是 `dispatchChatJob` → `applyTurnAsync`，不先走 `routeUserGoal`。`routeUserGoal` 仍负责车道分类，以及启发式手册里的 `parseLocalIntent`。阅读口令在进脑之前被截走，这是登记过的窄路。

采集规模句没有 report 时会再问一次模型（`wantsCollectScale`）。问完仍没有 report 就照实放行。这是提示，不是本地改交付物。

红线仍在做的：无。这一段没有新的「正则直接关单」。

## 计划

`parsePlanJson` / `planFromHeuristic` 把第 0 步标成 `running`，人还没执行。底账若只看 `status === running`，会把「还没开始」读成「正在做」。黄金场景的核对已经改成看 `findings`。

红线仍在做的：无新的抢答。这个状态位造成的假执行信号记在入口 turn 那条。

## 循环入口

`namedSiteIsOpen` 三处已经共用 `siteOpenEndsTheJob`（`8dcee01`）。多步计划、或交付物不是只有 answer，不会在第 0 步 break。`打开` 紧跟「的/了/着/过」不再进入开站正则（`1bf9aa0`）。

进循环前还有两处能把任务送走：

- `journalMissionTurn` 先写一条空 findings 的 turn。
- `applyHostLessons` 在「经验要求暂停且当前是墙」时直接 `waiting_human`。

习惯门岗 `replayHabit` 在进脑之前。精确查表，未关单、附图、引用会让开。这是技能通道的门岗，不是这次微博事故的路径。

红线仍在做的：入口空 turn 被当成执行过。见 [BUG-20261027-ENTRY-TURN-COUNTS-AS-RUN.md](./BUG-20261027-ENTRY-TURN-COUNTS-AS-RUN.md)。

残留（接受，不另开）：没有脑区计划、也没有可执行手册时，`openSiteIsTheJob` 仍可能把「打开微博，把前十条复制下来」判成只是开站。过期 2027-01-23。有计划时这条正则不再拍板。

## 循环体

`gateSiteDelivery` 只负责「点了名的站还没打开」。`stall >= 3` 收摊去汇总。报告 mission 成功一次后不许再扫第二遍。登录墙停下来问人。`repeatStop` 只掐断同一指纹的第四下，不关单。模型说收摊就离开循环，未完成步交给清点。

红线仍在做的：无新的词表抢答。这些都已在登记册里写明为什么留着。

## 收尾

只是开站的 done 走 `namedSiteIsOpen`，并且先 `skipLoneNavigate` 再进清点。登录落地走 `loginRedirectNote`，同样过清点。

`userDidNotAskToRead` 仍是一条独立关单。它的词表没有「复制 / 文档」。`earlyExitMayCloseDone` 只把 `report` 和 `form` 当成必须亲手交的东西，`page` 不算。计划一旦看起来做完，采集句仍可能回「已打开 weibo.com。」。10-26 那次没走到这里，是因为 4 步计划还是 `running`。

红线仍在做的：见 [BUG-20261027-READ-INTENT-EARLY-EXIT.md](./BUG-20261027-READ-INTENT-EARLY-EXIT.md)。

## 关单

正常汇总走 `verifyContracts`。缺交付、计划步没跑，会 incomplete，侧栏带「还缺」和「计划里这些步还没执行」。这道在 10-26 的事故里在岗。

本轮没有发现第四条能绕过清点的 `close(done)`。三条早退仍是：只是开站、没要求读页、登录落地。
