# 第四轮合并修复任务书（2026-10-27）——P4 白屏三发 / 返程被去程抵掉 / 抢焦插桩抓现行

> 范围：第三轮重跑后审计登记的三张单。
> 证据单：`BUG-20261027-P4-WHITESCREEN-3RD.md`（用户截图报障，白屏第三次复发）、`BUG-20261027-S7-RETURN-LEG-SWALLOWED.md`（一条去程发现抵掉整个车票交付）、`BUG-20261027-R4-RESTORES-ROUND3.md`（T4 之后实窗仍 4 次抢焦）。
> 本書只修这三件，不顺手做别的。

## 修复顺序（按严重度）

F3 白屏（可用性事故，用户连界面都看不见） > F1 返程假 done（正确性） > F2 抢焦（骚扰，违 AGENTS.md）。

---

## F3. P4 白屏第三次复发：守卫从「补时机」换成「常驻断言 + 自愈」（壳层，独立 commit）

- 症状：携程机票页把壳层整块盖住，标签栏/地址栏/侧栏全消失（证据 `qa-screenshots/p4-3rd/1-ctrip-whitescreen.png`，判读见单）。
- 根因定性：现行守卫是事件触发清单 + 预算（`armChromeGuard` 4 个延迟重排；`takeChromeCoverFix` 3 秒 8 次后 allow=false 撒手）。Chromium 把子视图拉成整窗的触发面靠列清单补不完——`d8d5199` 已被这次复发证伪。
- 修法：
  1. 常驻低频断言：活跃页视图 bounds 与 `#pageHole` 最近一次上报值持续比对（约 2 秒粒度；窗口销毁、活跃视图不在时除外），盖住壳层立刻按页面洞拉回。
  2. `takeChromeCoverFix` 删除「修 N 次放弃」语义：预算只做限频去抖，永不永久放弃；restore/resize 清预算保留。
  3. 诊断：每次自愈、活跃视图 bounds-changed 记主进程日志（old/new bounds、窗口最小化/最大化态、activeTab、时间）。发生即有账可查。
  4. 靠日志抓「谁把视图拉成整窗」，源头能防就防：核查所有挂载路径都先 `pinViewBeforeMount`。
- 测试：模拟「守卫烧完预算后视图仍被拉整窗」→ 断言常驻检查 2 秒内拉回；模拟连续拉 20 次 → 守卫永不放弃；单测之外跑一次实窗复现规程（开携程机票页 + 微博，中途最小化再恢复），前后截图对比壳层不丢。

## F1. 返程被去程抵掉：同 cap 多段逐段对账（脑区，独立 commit）

- 症状：S7 `m-mvqp0yds-sh0u5` 最后一条 turn 里返程步仍是 running、零返程 finding，下一行 close=done；`closePlan(true)` 把卡片上的返程步涂成 done。
- 根因链（verify.ts / plan.ts）：`observationCovers` 一条 ok 发现抵掉整个 `trains` 交付；`unmetPlanSteps` 的 `COLLECTION_CAPS` 不含 train_search/flight_search/hotel_search，返程步不进「没执行」清单；叠加得 verify.complete=true → done + 卡片粉饰。
- 修法：
  1. 同 cap 多段对账：cap ∈ {train_search, flight_search, hotel_search} 且计划里同 cap 有多步时，一步成功发现只抵一段（逐步配对消耗）；缺哪段，「还缺」用段位说清（如「还缺：返程车票」）。
  2. `closePlan(complete=true)` 不许把 running/pending 步涂 done——仍有未收步就如实标 skipped 带 note，绝不粉饰。对账修好后 complete 为真时本就不该剩同 cap 步，此条是保险丝。
  3. 关单走向类本地判断：动手前先登记 `docs/DECISION-POINTS.md`。
- 测试：复刻 S7 底账（去程有 URL、返程无发现）→ close reason 与返程缺口一致，缺口单列；返程补上发现 → 两段都抵、done 名正言顺；closePlan 单测：complete=true + running 步 → 不出 done 状态。

## F2. 抢焦插桩抓现行：静态清单已穷尽，靠运行时日志指认（壳层，独立 commit）

- 症状：T4（`471c1e3`）之后实窗仍 4 次（S3 两次、S6 两次、S7 零次）；看守按最小化时窗口 iconic=false——窗口被**真 restore**，不只是抢焦。当前 HEAD 所有 `webContents.focus()` 已带 `windowIsMinimized()` 守卫，静态可查的都堵了，抢焦源在清单外。
- 修法：
  1. 插桩：主进程对主窗口 `restore()` / `show()` / `focus()` / `setFocusable()` / `setBounds()` 挂钩（`--sparo-trace` 开关或 dev 生效），记调用栈（截断）+ 调用前后窗口态；窗口 `restore` / `focus` / `maximize` 事件同记。日志落主进程 console 并落盘一份。
  2. 复现：最小化下重跑 S3（开微博 + 填发布框）与 S6（开百度搜索），从日志指认把窗口拉回前台的确切调用点。禁止在指认前改任何抢焦相关代码。
  3. 指认后修掉该路径（最小化时不得 restore/show/focus——切标签 + 闪任务栏，与 R4/T4 同口径）。插桩钩子保留在开关后面，不删。
- 测试：单测维持绿；**实窗最小化复跑 S3/S6 抢焦 0 次是唯一过线，单测绿不算数**。

## 提交纪律

- F3、F2、F1 各自独立 commit；F3/F2 同为壳层但不许合并。F1 动手前先登记 DECISION-POINTS。
- 每项配测试；全部完成后 `npm test`、`npx tsc --noEmit` 全绿。
- 版本号 0.1.19 不动，不推线上。

## 验收

1. F3：守卫单测 + 实窗规程过；白屏若再复现，诊断日志能指出调用方。
2. F1：S7 原句重跑——返程要么真有 12306 URL（日期 11-08），要么「还缺：返程车票」单列、close reason 与缺口一致、卡片不涂 done。
3. F2：S3/S6 实窗最小化抢焦 0 次，日志指认的调用点已修。
4. 三项全过才 `npm run dist`，安装包按最小化规程复测 ★ 五条（S1/S2/S4/S6/S7）。S4 发公开微博前必须停下等用户确认文案——注意当前发布框里躺的是姆巴佩政治向草稿，用户大概率要先换稿。
5. 结果登记进批次书新开一节「第四轮修复后重跑」；不过的照旧开 BUG 单，不现场修。
