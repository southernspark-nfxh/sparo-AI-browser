# 进循环前的空 turn 被当成已经执行

> 走查发现。2026-10-27 只登记。

`executeMission` 在 `for` 循环之前就 `journalMissionTurn`。那时 `findings` 还是空的，计划第 0 步在创建时已经被标成 `running`。

`missionWasExecuted` 看到 `turns > 0` 就当这张单执行过。恢复卡、以及「同一句里还没跑过的影子单」会把这条空 turn 算进去。

10-26 晚 `m-mvp5ukto-ncuax` 的时间线里，19:15:49.211 那条 turn 就是这一笔，不是步骤。黄金场景若用「至少一条 turn」当通过，零执行关单会假绿。核对标准已改到 [QA-GOLDEN-SCENARIOS.md](./QA-GOLDEN-SCENARIOS.md)：真实步骤要 `findings` 至少 1 条。

修的时候只改「怎样算执行过」，不要把入口这笔账删掉。杀进程时仍要知道这张单进过 `executeMission`。空 `findings` 的那条 turn 不能单独让 `missionWasExecuted` 返回 true。
