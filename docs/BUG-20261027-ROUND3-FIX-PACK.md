# 第三轮合并修复任务书（2026-10-27）——高铁静默丢步 / form 假覆盖 / 关单文案不对账 / 抢焦漏网

> 范围：第二轮重跑（批次书末尾「第二轮修复后重跑」，提交 `4f528d6`）暴露的 3 条不过 + R4 抢焦复发。
> 证据单：`BUG-20261027-S7-TRAINS-NOT-RUN.md`、`BUG-20261027-S3-READING-PAGE-DONE.md`、`BUG-20261027-S6-CLOSE-STILL-SKIPS.md`、`BUG-20261027-R4-RESTORES-AGAIN.md`，外加仍开着的 `BUG-20261027-TRAVEL-DATE-FALLBACK.md` 本轮一并收。
> 本書只修这四类，不顺手做别的。

## 修复顺序（按严重度）

T1 高铁步静默丢步（+日期回落） > T2 form 假覆盖假 done > T3 关单文案不与交付对账 > T4 抢焦漏网（壳层，独立 commit）。

---

## T1. 计划层拒收的步静默消失，高铁两段从头到尾没跑（并收日期回落单）

- 症状：S7 `m-mvqk186v-2ymra` 计划里两步 `train_search` 从创建到关单一直 pending，没有 12306 URL、没有「没有对应的手」、没有人话解释，约 50 秒 close=incomplete，侧栏只有「还缺：车票」。
- 根因：R1 之后组不出腿的步在计划编译层被拒收（`loop.ts` 约 L827，`console.warn("[plan] 拒收没有手的步骤")` 后 `continue`）。步从可执行手册里删了，但 `brainPlan` 卡片仍挂着 pending；没有任何 finding 会替它回写状态（`plan.ts` `notePlanStep` 只认观察）；也没有补位——不追问、不换策略、不标失败。同时 `known.start=2026-11-07` 是酒店入住日，`travelSearchLeg` 的日期回落（`step.date || known.start`）会把高铁查到入住日上去，见 `BUG-20261027-TRAVEL-DATE-FALLBACK.md`。
- 修法：
  1. 拒收要留痕：被拒收的步在 brainPlan 上标 failed 并写人话 note（哪一步、缺什么槽），不许静默 pending 到关单。
  2. 拒收要补位：高铁/机票步组不出腿时，先用 `goal.raw` 与 `known` 再拆一次 from/to/date；拆得出就补槽进循环，拆不出且缺的是出发地这类合法空槽就问人。不允许不尝试直接关单。
  3. 收日期回落单：`train_search`/`flight_search` 的日期只许来自 `step.date` 或从 step.label/query/原句里拆出的该段日期；`known.start` 是酒店/行程日的，不许回落。拆不出该段日期就按缺槽走第 2 条，不许默用入住日。S7 去程必须是 11 月 6 日、返程 11 月 8 日。
- 测试：S7 原句重跑，两段 train_search 要么真跑出 12306 URL 且日期是 11-06 / 11-08，要么关单文案逐段说清哪段没跑、为什么；拒收步在脑区卡片上是 failed 带 note，不是 pending。「北京到南京」无日期 + known.start 是别段日期时，不许拿 known.start 组腿。

## T2. form 交付物被结构覆盖假抵，S3 假 done

- 症状：S3 `m-mvqjr1zb-tf641` 发布框是空的（妙招第 2 步 `click requires ref or selector`），阅读页自己写「未生成可发布内容」，却 close=done。
- 根因：[verify.ts](file:///d:/download/sparo上架应用商店版/src/main/agent/kernel/verify.ts#L190-L196) 里 `form` 先查 `publishReceipt`，查不到就回落到通用结构覆盖——任何 `ok` 且 `covers` 含 `form` 的 finding 都能把 form 抵掉。起草/读页类发现于是能冒充「草稿已填好」。R5 只做了停用连通，「动作后自检、读回核对」没有落到 verify 层。
- 修法：`form` 必交付只认两种回执——发布手写下的（`已发送` / `发布成功` / `已写入草稿`），或填表/发布手动作后**读回输入框核对成功**的回执。读回是空的就必须说没填上，不许拿阅读页当交付。普通 ok finding 一律不抵 form。注意别误伤 S12 类通用填表：fill_form 手补做读回核对，核对成功的回执同样算数。
- 测试：发布框为空 + 有阅读页 → 不许 done；fill 后读回有字 → form 可抵；读回为空 → incomplete 且文案说「没填进发布框」。

## T3. 关单文案的「没执行」清单不与已交付对账

- 症状：S6 `m-mvqjzpdf-74cup` 天气答案已给出（搜索 URL 已打开、finding 有天气文本、侧栏已答），关单仍写「计划里这些步还没执行：搜今天北京天…」，close=incomplete。R2 的 `labelInFinding` 抵扣没拦住。
- 根因：[verify.ts](file:///d:/download/sparo上架应用商店版/src/main/agent/kernel/verify.ts#L199-L214) `stepNote` 只看 `unmetPlanSteps`，不看交付物是否已齐。搜索实际以 navigate 形式跑到了结果页，只是没记在同 cap 步上。实现者先用 S6 底账逐条对 `unmetPlanSteps` 的三条抵扣路（exact / capOnly / labelInFinding），查清这条天气 finding 为什么没抵上（ok 标记？url 字段？时序？），再补兜底。
- 修法：兜底口径——某计划步的所有 covers 都已被交付（在 `covered` 里或对应交付物非必交付且已有成功发现）时，该步视为已执行，不进「没执行」清单；`missing` 为空时不许再出 stepNote。这条是关单走向的本地判断，**动手前先登记 `docs/DECISION-POINTS.md`**。
- 测试：S6 原句重跑：答案给出 → close=done，文案无「没执行」；答案没给出 → 照旧 incomplete。S10 类报告单回归不破。

## T4. 最小化抢焦的漏网路径（壳层，独立 commit）

- 症状：R4 之后仍 6 次自己回前台：S9 出报告 1 次（18:19:35），S2 采集期间 5 次（18:29–18:30）。
- 已查到的漏网面：
  1. [browser.ts](file:///d:/download/sparo上架应用商店版/src/main/browser.ts#L1114-L1119) `did-create-window`：网页 `window.open` 出的子窗口无条件 `show()`+`focus()`，没有最小化守卫。微博页常开弹窗，和 S2 五次连发对得上。
  2. [browser.ts](file:///d:/download/sparo上架应用商店版/src/main/browser.ts#L2365-L2372) `focusShell()` 直接 `webContents.focus()`，无 `isMinimized` 守卫（`focusActivePage` 有，它没有）。
  3. [browser.ts](file:///d:/download/sparo上架应用商店版/src/main/browser.ts#L1524-L1549) `withoutStealingMinimizedWindow` 是「先抢后按回去」：work() 里的 restore/focus 已经抢到前台，finally 再 minimize 补救，前台监视照样记一次。S9 出报告那次对得上。要改成从源头不抢：最小化期间 switchTab/createTab/wakeTab 路径上的 focus 调用点全部守卫，而不是事后 remini。
- 修法：窗口最小化时——子窗口不得 show/focus（挂起或载成背景标签）；`focusShell` 加守卫；`withoutStealingMinimizedWindow` 改为「全程不抢」而非「抢了再按」。完成仍只闪任务栏。逐调用点核一遍 `src/main` 里 `restore()`/`show()`/`focus()`（本書调查时已列出候选，不许只修这三处就交差）。
- 测试：原 R4 测试只断言 `coPresenceMayRestore` 返回值，所以绿了还抢——本轮必须在最小化状态实跑「采集 + 出报告 + 网页 window.open」三条路径，断言全程未发生 restore/focus（可加计数钩子供测试读）。

## 提交纪律

- T1/T2/T3 全在脑区/kernel，**每项各自独立 commit**；T4 壳层一笔。禁止跨层合并。
- T1 第 2、3 条与 T3 都是关单/走向类本地判断，动手前先写进 `docs/DECISION-POINTS.md`（R2 那笔 `97f92d0` 的做法照旧）。
- 每项配测试；全部完成后 `npm test`、`npx tsc --noEmit` 全绿。
- 版本号 0.1.19 不动，不推线上。

## 验收

1. 重跑 S3、S6、S7 三条 + 最小化抢焦规程（沿用 `QA-20261027-ROUND2-RERUN.md` 口径，S2/S5/S9 已过的不用重跑，但 S7 重跑顺带复核 S2 类采集不再抢焦）。
2. S7：三段都有交代；去程 11-06、返程 11-08，有 12306 URL 或逐段人话缺口；不再有静默 pending 到关单的步。
3. S3：发布框空就不许 done，说人话；S6：答案给了就 done，无「没执行」。
4. 抢焦 0 次。
5. 全过后登记进批次书，另起一节「第三轮修复后重跑」；不过的照旧开 BUG 单。
