# 跨站导航后整窗覆盖与旧网页残影修复任务书

> 2026-11-07 由规划方（Trae）整理，开发由 Cursor 执行。
> 目标：修复「百家号整窗铺底、头条号旧画面压在左侧，Sparo 标签栏/地址栏/侧栏全部消失」。
> 行号基于 2026-11-07 工作区，对不上时按符号名找。完成一个任务就跑对应测试；全部完成后跑全量回归和真机验收。

## 0. 结论边界（不要改错方向）

这不是百家号/头条号数据串台，也不是发布路由错误，而是 **WebContentsView 原生布局/合成层问题**：

1. 活动网页视图盖住 `#pageHole` 之外的壳层，导致标签栏、地址栏、侧栏消失；
2. 跨站导航后，上一站的原生画面可能残留，与当前站画面同时出现在整窗里；
3. T57 的「连续三次无进展后 give-up」可能把暂时覆盖变成持续覆盖。

已核实的时间线（`%APPDATA%\sparo-store\history.json`）：

- 11:00:28：头条号作品管理；
- 11:01:14：百家号内容管理；
- 11:01:25：百家号收益中心。

原图正是头条号作品管理 + 百家号内容管理同时出现。异常时段没有对应的页面/壳层崩溃记录。

### 已排除与未证实

- 实时 `list_tabs` 只有一个标签，当前 Windows 窗口树也只有一个正常网页子视图；不要按「两个平台路由同时激活」改业务代码。
- 原图没有第二套系统标题栏，不要优先按原生弹窗修。
- 游离视图只是低概率假设，**没有证据前不要自动关闭不认识的 `contentView.children`**。
- 同版 Electron 35.7.5 的轻量测试中，80 次双视图切换和 80 次单视图跨页导航都未复现；完整触发条件可能还包含重页面、主进程卡顿、最小化恢复或窗口缩放。
- 因此可以修明确的守卫缺口，但不许把「未复现」写成「已证明根因消失」。

## 1. 先读这些代码

- `src/main/browser.ts`
  - `switchTab()`：切标签、清抑制、重排；
  - `applyViewBounds()`：只遍历 `tabs`，活动页挂载，其他页停放；
  - `mountPageView()` / `parkPageView()`：正常活动页与 `x=-20000` 后台页；
  - `onPageViewBoundsChanged()`：事件驱动覆盖检查；
  - `assertChromeHole()`：两秒常驻断言，目前只检查活动标签；
  - `healCoveredChrome()`：目前把触发事件之外的修复前后状态都记到 `activeTabId`，并含三次 `give-up`；
  - `did-navigate` / `did-start-navigation`：跨站导航提交与历史记录。
- `src/main/page-bounds.ts`：`chromeCoverReason()`、`boundsWithinOnePixel()`、去抖预算。
- `tests/chrome-hole.test.ts`：现有常驻守卫、覆盖原因、三次无进展抑制测试。
- `docs/BUG-20261027-P4-WHITESCREEN-3RD.md`：此前明确要求「预算只限频，永不永久放弃」。
- `docs/MULTI-AGENT-FIX-TASKBOOK.md` T57：三次抑制是为了消除每两秒一次的 heal 死循环，不能简单删守卫或恢复死循环。

## 2. 全局红线

1. `CHROME_H` 保持 76，顶栏 36+40、侧栏和 `#pageHole` 布局不改；不向网站注入 DOM/CSS 遮盖问题。
2. 不改百家号、头条号发布/采集路由，不改 Free Soul、任务循环、技能、云订阅和计量。
3. 不删两秒常驻守卫；不用「一律隐藏所有网页」「一律重载页面」「定时反复 remove/add」掩盖问题。
4. 正常后台标签仍必须 `setVisible(false)` 并停到屏幕外；活动页仍必须严格落在最近一次合法页面洞内。
5. 不自动销毁未登记视图；本单只增加必要诊断。没有证据证明它属于本 bug，不做危险清理。
6. 不用单页 `webContents.capturePage()` 正常代替整窗验收；它看不到完整原生合成结果。
7. 不碰 `docs/listings/`，不打包、不提交、不推送。本轮是布局和测试修复，不新增任务走向判断，不需要登记 `DECISION-POINTS.md`。

---

## T1（P0）把覆盖检查修到「实际出问题的视图」上

### 已确认缺口

- `assertChromeHole()` 只取 `getActiveTab()`，活动页矩形正常时，屏幕内的后台视图覆盖不会被常驻守卫发现。
- `onPageViewBoundsChanged(view)` 虽能收到任意视图事件，但 `healCoveredChrome()` 内部重新读取活动页作为 `after`，并把 stall 记到活动标签。后台视图触发时，比较的不是同一个对象。

### 要求

1. 常驻断言覆盖所有已登记且未销毁、未休眠的页面视图：
   - 活动标签按活动页规则检查；
   - 后台标签若仍在屏幕内且覆盖壳层，也必须重新走 `parkPageView()`；
   - 正常 `x=-20000` 的后台页继续豁免，不误报。
2. 修复函数显式接收触发它的 `tabId` 和 `view`；`before` / `after` 必须读取同一视图，日志和 stall 也归属同一标签。禁止再在函数内部默认拿活动页替代。
3. 一次 reconciliation 可以同时校正活动页和后台页，但不得改变 `activeTabId`、标签顺序、owner 或任务状态。
4. 对 `contentView.children` 中未登记的视图只记诊断（数量、bounds、是否已销毁等可取信息），不要 close/remove。
5. 保持 overlay、最小化、窗口销毁、标签 discarded 的既有保护语义。

### 先写失败测试

至少覆盖：

- 活动页正常、后台页矩形在屏幕内且盖住壳层时，常驻断言会校正后台页；
- 后台页在 `x=-20000` 时不触发修复；
- 后台视图触发 heal 时，`after` 读后台视图，stall 记录后台 tab，不读活动视图；
- 正常活动页 + 正常停放后台页不产生重排；
- 未登记 child 只诊断，不被关闭或移除。

---

## T2（P0）保留防死循环，但不许真实覆盖被永久放弃

### 目标

同时满足两条历史要求：

- T57：几何长期不变化时，不能每两秒无限做同样的无效重排；
- P4 第四轮：壳层仍被覆盖时，不能三次后永远撒手。

### 要求

1. 删除「同一标签 give-up 后直到 resize/restore/switchTab 才再修」的永久语义。
2. 连续无进展时进入**降频恢复**，而不是停止：
   - 前几次普通重排仍按现有限频；
   - 达到现有三次阈值后，不再每两秒重复相同 `applyViewBounds()`；
   - 壳层覆盖仍存在时，允许经过明确冷却时间后重试，冷却建议 10 秒，写成常量并测试；
   - `resize`、`restore`、`switchTab` 仍可立即重置退避。
3. 达到阈值时先请求壳层重新上报合法 `#pageHole`，避免一直拿陈旧 hole 修。
4. 对「活动页仍整窗覆盖且普通重排三次完全无效」允许做一次**单视图升级恢复**：按既有 `pinViewBeforeMount()` 的顺序重新挂载该活动视图，并立即恢复精确 bounds。每次退避周期最多一次；不要重建 webContents，不要 reload，不要丢登录态。
5. 后台视图不要 remove/add 重挂；校正为不可见并停放到屏幕外即可。
6. 日志区分 `retry-deferred`、`remount`、`retry`，不得再把降频写成永久 `give-up`。日志带 tab、reason、before、after、cooldown，避免泄露网页正文。
7. 若重新上报后 hole 本身不合法，沿用现有合法洞回退，不要把网页直接设成 `{0,0,整窗}`。

### 测试

- 三次同几何后，第 4 个两秒 tick 不做无效重排，防止 T57 死循环回归；
- 冷却后仍覆盖会再次尝试，不能永久停手；
- 达到阈值只重挂一次活动视图，并重新请求 hole；
- 重挂后恢复正常 bounds 时退出退避，不继续重挂；
- 后台覆盖只停放，不重挂、不刷新；
- `switchTab` / `resize` / `restore` 重置退避；
- 更新旧测试「连续 3 次后第 4 次不重排」为「降频但最终恢复」，不能为保留旧断言牺牲本任务目标。

---

## T3（P1，按实测结果执行）跨站提交后的旧帧清理

先跑 §4 的 Q1。若 T1/T2 后整窗仍出现「新站 + 旧站残影」，再做本任务；若不再出现，记录未需要，不增加预防性定时器。

### 允许的最小修向

1. 只在活动视图发生跨文档 `did-navigate` 后做一次主动几何 nudge，促使 Chromium 丢弃旧合成表面；复用现有 `mountPageView()` 的宽度 `-1` 再恢复精确值方式。
2. 每个导航提交最多一次，不添加循环定时器，不 reload，不调用 `stop()`，不影响网页 DOM 和任务历史。
3. 后台视图、overlay 打开、窗口最小化、视图已销毁时不做。
4. 如果一次 nudge 经整窗截图证明无效，不要叠加 hide/show、闪烁白屏或反复重挂；保留诊断并如实报告仍需 Chromium/GPU 层复现。

### 测试

- 活动页跨文档导航后精确 nudge 一次，最终 bounds 与 hole 一致；
- 同一导航事件不重复触发；
- 后台页、最小化、overlay、destroyed 不触发；
- 不改变 `activeTabId`，不额外产生导航历史。

---

## 3. 工程要求与回归

1. TDD：T1/T2 先让新增测试在旧实现上失败，再改实现。优先改 `browser.ts` / `page-bounds.ts` / `tests/chrome-hole.test.ts`；只有确有必要才增加小范围纯函数测试文件。
2. 每完成一个任务运行：

```powershell
npx vitest run tests/chrome-hole.test.ts
npm run typecheck
```

3. 全部完成后运行：

```powershell
npm test
npm run typecheck
npm run build
```

4. 不重跑与本改动无关的历史失败来“修绿”；若全量有既有失败，记录测试名和失败原文，不顺手改业务。
5. 真机使用 `npm run start` 的新开发进程；不要用仍在运行的 0.3.0 安装包验证新代码。

## 4. 真机验收（必须看整窗）

截图必须来自 Windows 整窗截图、Computer Use 或 desktopCapturer，**不能只调用 MCP `screenshot` / 单页 capturePage**。每次检查：标签栏、地址栏、侧栏都在；网页只占 `#pageHole`；没有上一站残影。

| 场景 | 步骤 | 通过标准 |
|---|---|---|
| Q1 原始链路 | 头条号作品管理 → 百家号内容管理 → 百家号收益中心，连续往返 10 轮；只读页面，不发布、不填表 | 每轮整窗无跨站叠图，壳层完整；控制台无报错 |
| Q2 切标签压力 | 至少 3 个重页面标签，连续切换 20 次，再静置 20 秒 | 只有活动标签可见；后台标签不可见且停放；无每 2 秒重复 heal |
| Q3 窗口状态 | Q1 导航中穿插最小化/恢复、最大化/还原、窗口缩放，各 5 次 | 每次稳定后壳层完整；不会永久停留在整窗覆盖 |
| Q4 恢复路径 | 用测试注入或可控 mock 让普通 bounds 修复连续三次无几何进展 | 不死循环；进入降频；冷却或 switch/resize/restore 后能恢复；不 reload 页面 |
| Q5 正常回归 | 打开一个普通网页，切到后台再切回，检查地址栏、后退、侧栏输入 | 原有导航和侧栏交互正常，无额外导航、无页面闪烁循环 |

Q4 的故障注入只允许存在测试/开发诊断路径，不增加用户界面开关，不进入正式产品行为。

真机日志至少保留：

- 异常前后的 `[chrome-hole]` 行；
- 开发进程控制台错误；
- 若发生崩溃，`%APPDATA%\sparo-store\diag\crash.log` 对应片段；
- 一张修复后的整窗截图路径。

没有跑真实百家号/头条号会话就写「未跑」，不能用本地 data URL 测试代替 Q1。

## 5. 完成交付

在本文件末尾追加「完成记录」，逐项写：

1. T1/T2/T3 实际改动文件和核心行为；
2. 新增/修改的测试名，全量测试、typecheck、build 结果；
3. Q1–Q5 每项通过/失败/未跑及证据；
4. 是否仍观察到旧帧残留；若未复现，必须写「未复现」，不能写「已彻底根治」；
5. 未做的范围和遗留风险。

规划方复查重点：同一视图 before/after、后台视图覆盖、三次后的降频恢复、真实整窗截图。单测全绿不等于验收通过。

---

## 完成记录

2026-11-07 Cursor 填写。单测和构建通过。真机 Q1–Q5 未跑。未复现原图，不能写成已彻底根治。

### 1. 改动

T1，`src/main/browser.ts`

- `assertChromeHole()` 检查所有已登记、未销毁、未休眠的页面视图。活动页仍按页面洞校正；屏幕内盖住壳层的后台页走 `parkPageView()`（不可见，`x=-20000`）。停在 `x=-20000` 的后台页继续豁免。
- `healCoveredChrome(tabId, view, actual, hole)` 的 before / after 只读触发它的那一个视图，stall 记在同一个标签上。
- 一次检查可以先后校正活动页和后台页，不改 `activeTabId`、标签顺序、owner 或任务状态。
- `contentView.children` 里未登记的视图只打 `[chrome-hole] unregistered`（数量、bounds、是否已销毁）。不 close、不 remove。
- 窗口销毁、标签 discarded、视图已销毁、overlay 打开时的原有保护还在。最小化仍沿用 `pageBounds()` 的合法尺寸回退。

T2，`src/main/browser.ts`、`src/main/page-bounds.ts`

- 删掉永久 `give-up`。连续 3 次几何不动（`CHROME_HEAL_STALL_LIMIT`）后，两秒节拍不再重复同一次 `applyViewBounds()`。
- 覆盖还在时，冷却 `CHROME_HEAL_COOLDOWN_MS`（10 秒）后再试。日志是 `retry-deferred`、`remount`、`retry`，带 tab、reason、before、after、cooldown，不写网页正文。
- 活动页达到阈值时先 `requestHoleReport()`，再按 `pinViewBeforeMount()` → 重新挂上 → 精确洞做一次 `remountCoveredActiveView()`。同一退避周期只重挂一次。不重建 webContents，不 reload。重挂后 bounds 回到合法洞就退出退避。
- 后台页只停放，不 remove/add，不刷新。
- `resize` / `restore` 原有 `resetChromeCoverState()`。`switchTab` 改为走同一入口，立即清退避和 200ms 去抖。
- 非法洞仍被 `reportedPageHole()` / `pageBounds()` 拒绝，网页不会被设成 `{0,0,整窗}`。

T3，未改代码。Q1 没有在新开发进程上跑，没有实测到「新站 + 旧站残影」，所以没有加跨站几何 nudge，也没有加定时器。

### 2. 测试

`tests/chrome-hole.test.ts` 新增或改写：

- 活动页正常时，屏幕内的后台页会被停放到屏幕外
- 后台页停在 x=-20000 时不触发修复
- 后台视图触发 heal 时，after 与 stall 都属于后台标签
- 正常活动页和正常停放的后台页不产生重排
- 未登记的 child 只记诊断，不关闭也不移除
- 休眠或已销毁的后台页不参与校正
- 冷却常量是 10 秒，三次之后才进入降频
- 连续 3 次同几何后第 4 个两秒 tick 不重排，冷却后会再试且不永久放弃（含 switchTab，以及 resize/restore 共用的 `resetChromeCoverState`）
- 重挂恢复到合法洞后退出退避，同一个退避周期不第二次重挂
- 同一标签在同一毫秒内不会把去抖再烧一次
- 同一次断言会停放每一个仍在屏幕内的后台页
- 后台覆盖只停放，不重挂也不刷新
- 非法页面洞不会把网页设成整窗

结果：

- `npx vitest run tests/chrome-hole.test.ts`：15 通过
- `npm test`：97 个文件、701 个测试通过。2 个套件没加载起来，与这次布局改动无关，未改业务：
  - `tests/dxm-smt-listing.test.ts`：`Cannot find module '../src/main/workflows/dxm-smt-contract.js'`
  - `tests/dxm-smt-publish.test.ts`：同上
- `npm run typecheck`：通过
- `npm run build`：通过

### 3. Q1–Q5

| 场景 | 结果 | 证据 |
|---|---|---|
| Q1 头条号 ↔ 百家号 10 轮 | 未跑 | 没有在 `npm run start` 的新进程里打开这两个站点 |
| Q2 三标签切换 20 次 | 未跑 | 同上 |
| Q3 最小化 / 最大化 / 缩放 | 未跑 | 同上 |
| Q4 三次无进展注入 | 未跑 | 只在单测里覆盖了降频和重挂，没有走开发进程诊断路径 |
| Q5 普通网页切走再切回 | 未跑 | 同上 |

本机当时已有 Sparo 窗口进程。任务书要求用新开发进程做整窗验收，不能拿正在运行的安装包或单页 `capturePage` 代替，所以没有抢同一份 `%APPDATA%\sparo-store` 再开一套。没有整窗截图路径。没有新的 `[chrome-hole]` 真机日志，也没有对应崩溃片段。

### 4. 旧帧

未复现。原因是 Q1 未跑，不是已经证明根因消失。

### 5. 未做和遗留

- 未做 T3。若以后整窗仍能看到新旧站叠在一起，再给活动页的跨文档 `did-navigate` 加一次几何 nudge。一次无效就停，不叠加 hide/show 或 reload。
- 未关未登记视图，只诊断。
- 200ms 去抖仍限制同一个标签。同一次断言里，别的标签可以接着停放，不会被这一下吃掉。
- 未打包、未提交、未推送。未改 `docs/listings/`，未登记 `DECISION-POINTS.md`。
