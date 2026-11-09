# 电商一期 R10 任务书（Cursor 执行）：判重时序抖动修复

> 前置：R2–R9B 已全部提交（`dcf7d19` 0.4.0 收官版），工作区干净，`activateTab`/`getActiveTabId` 已在 `browser.ts` L5598/L5606。本轮只修一件事：**判重读取的时序抖动**（交接单 §4.2，R10 第一优先级）。
> 写字段、翻译、保存、发布、选分类本轮继续停等，一个都不放开。R9-4 live 认领真机验收不归本轮，等规划方安排。不提交 Git，不打安装包。

## 0. 接手勘误（规划方 2026-11-09 17:50 核实，覆盖交接单过时信息）

- 交接单 §3.3「R2–R9B 全部未提交」**已过时**：Trae 收官前已提交 `dcf7d19`（0.4.0），含全部 dxm 源码、测试、任务书与交接单；另有 `a3b1c90` 补交 `DxmSmtLiveSurface` 可选字段类型。当前 HEAD `dcf7d19`，工作区无改动。
- 交接单 §3.2 说的 pollBox 3 行 `[dxm-poll]` 插桩**已不在工作区**（随提交还原或未包含）。现存插桩只有 `src/main/workflows/dxm-smt-live.ts` L201、L222 两行 `console.info("[dxm-smt] claim click …")`——**本轮不要动它们**，全部清理挂真机验收后的收尾轮。
- `stash@{0}` 现为更早的 wip（「incomplete tabId threading in browser.ts」，已被 850be5e/a3b1c90 取代），**不是**交接单说的 R2–R9B 副本。本轮不碰 stash，处置等用户拍板。

## 1. 问题定义（必读）

- 现象：同一判重场景约 50% 成功率。16:50 轮插桩日志：`t=9586 loaded=false rows=0 → t=11610 loaded=true rows=8 → t=12528 又 false → t=14037 true`。vxe 渲染在 10 秒预算内反复翻转，pollBox 赶上或赶不上。
- **风险不止超时，还有误判**：
  1. 部分渲染窗口内单次样本 `loaded=true rows=8`（搜索过滤视图）可能漏掉目标行 → `decideBoxLookup` 误判 **absent** → 流程走向认领门。这是 R7 假 absent 的同类风险，必须与超时一起堵死。
  2. 抖动期内瞬时「0 行 + 真空渲染」样本可能被当成真 0 行误判 absent。
- #45（占位态不判 absent）与 #48（激活时序）语义不变，本轮在读取层加「稳定窗确认」，决策点已登记为 **#50**。

## 2. 修复方案（组合：稳定窗确认 + 预算拉长）

### 2.1 pollBox 稳定窗确认（核心）

采样间隔 400ms 不变，改动在采纳条件：

1. 单次 `loaded=true` 样本**不再立即返回**。
2. 连续两次样本全等（`loaded`、`rows.length`、`emptyRendered`、`searchValue` 四项全等）后，**再等 800ms 做第三次确认读**；三次一致才算「稳定读」，返回该读。
3. 任何一项不一致即清零重计，继续轮询（在剩余预算内）。
4. 预算 10s → **30s**，常量命名 `BOX_POLL_BUDGET_MS = 30_000` 放 `dxm-smt-box.ts`，测试与实现引用同一常量。
5. 预算耗尽时沿用 `boxPollExhausted` 语义：整个窗口内出现过任一次 `loaded=true` → `unknown` 停等（reason 不得带 absent 语义）；从未 loaded → 现有「采集箱列表没有加载出来」。

为什么是三次 + 800ms：实测抖动平台期约 0.9–2 秒，三次一致 + 800ms 确认意味着误判需要 ≥1.6 秒的假稳定，而真终态（渲染完成）是无限稳定的。若真机复验仍抖，备选升级是方案 B（判重数据源 XHR 化，R9-6 任务书备选段），本轮不做。

### 2.2 纯函数

稳定窗判定放 `src/main/workflows/dxm-smt-box.ts`（如 `sameBoxRead(a, b): boolean` + settle 判定），live 层只管采样节奏——照 R9 的纯函数与 live 解耦模式。`decideBoxLookup` 语义**一字不改**；`lookupDraft`/`searchBox` 调用 pollBox 的地方不改逻辑（pollBox 返回值即稳定读）。

### 2.3 明确不做

- 不上 `requestIdleCallback` / vxe 渲染完成标记（备选，不在本轮）。
- 不动 parkPageView、backgroundThrottling、activateTab 时序（#48 原样）。
- `pollClaimDialog` / `pollClaimProof` 的 10s 预算**不动**（认领弹窗不受 vxe 抖动影响）。
- 不改 `dxmEnabled()`；`dxm_smt_*` 仍只走 Free Soul 侧栏白名单。

## 3. 测试（新增，夹具编造数据，断言不含真实标题/店铺/ID）

用 fake surface（`execute` 返回脚本化样本序列）驱动 `pollBox`：

1. **抖动序列**：`[false/0, true/8, false/0, true/8, true/8]` → 只在第三次一致后返回，返回 rows=8；不得在第一个 true 样本就返回。
2. **单样本翻转**：`true/8` 后紧跟不同的样本 → 不提前返回。
3. **稳定空表**：连续三样本 `loaded=true rows=0 emptyRendered=true` → 返回，最终判 absent（合法路径不误伤）。
4. **抖动耗尽**：预算内反复翻转但出现过 loaded=true → `unknown`，reason 不得是 absent 语义。
5. **searchValue 守门**：searchBox 场景两次 rows 相同但 `searchValue` 不同 → 不算稳定。
6. 纯函数单测：`sameBoxRead` 四项全等才算等（含 rows.length 数值比较）。
7. 回归：`chrome-hole.test.ts:493` park 停放位既有时序抖动**不许改断言**（与判重缺陷同源，若本轮改动使其行为变化要如实报告）；R9B 三项单测仍绿；无 claimConsent 零调用、写字段/翻译/保存/发布/选分类拒绝路径不变。

## 4. 禁区（违反 = 返工）

- `decideBoxLookup`、#45、#48 语义一字不改；只加读取层节奏与预算。
- 认领、写字段、翻译、保存、发布、选分类继续停等；无 claimConsent 零点击。
- L201/L222 两行 `[dxm-smt]` console.info 不动；不新增调试插桩进提交内容（真机验收的插桩由规划方自己加）。
- 不提交 Git；不打安装包；E1–E12 继续挂未跑；`docs/listings/` 不动。

## 5. 验收标准

- 上述定向测试全绿；全量回归（884+）无新增失败；typecheck / lint（0 error）/ build 通过。
- 完成记录写进 `docs/ECOMMERCE-PHASE1-CURSOR-TASKBOOK.md`「Cursor R10 完成记录」（改了哪些文件、行数、测试数）。
- **不声称判重「已修好」**——真机复验是规划方环节，不是 Cursor 自测环节。

## 6. 真机验收（规划方执行，Cursor 不执行；此处仅列标准）

1. ambiguous 场景（现有草稿）同记录 prepare 连跑 ≥6 轮：全部在预算内给出稳定结论，无一次 unknown 超时，journal evidence 落账齐全。
2. absent 场景（挂腰风扇草稿已删，136 条箱）连跑 ≥3 轮：全部正确 absent，无一次 unknown、无一次误判。
3. 期间确认：采集箱标签读完即关、活动标签恢复原状、窗口不抢前台（#48 回归）。
4. 全过后：清理 L201/L222 插桩 → 全量回归 → 整理 commit（等用户点头）→ 进入 R9-4 认领收尾（需用户当场授权）。

## 7. 真机验收记录（2026-11-09 晚，规划方执行；**未通过，挂起，根因升级**）

> 复验环境：开发版（`SPARO_DXM_SMT_PREVIEW=1`），工作单 `dxm-mw7zvfpy-107cf8` 续跑，来源记录 167842582613033710，采集箱 136 条（挂腰草稿已删，absent 场景）。规划方自带插桩（[dxm-poll]/[dxm-search]/[dxm-diag]，验收后已全部还原，工作区回到纯 R10）。

### 7.1 结果：0/6 通过，失败根因不在 R10 的稳定窗逻辑

- 窗口**可见**时：判重第一段读取成功——8 行三次一致稳定返回（18:41 轮插桩实证），R10 稳定窗按设计工作，未出现单样本误判。但第二段（按标题搜索）失败：URL 搜索未生效（读回 searchValue 为空，走了点击搜索路径），点击搜索后结果页同样不渲染 → 预算耗尽 unknown。
- 窗口**最小化/完全遮挡**时：30 秒预算内每次读取 `execute ok` 但 0 行 0 真空——页面根本不渲染。

### 7.2 根因升级（三条插桩实证 + 两组对照实验）

1. **窗口最小化时，采集箱页面的数据请求根本不发出**：[dxm-diag] 抓 `performance.getEntriesByType("resource")`，30 秒里只有静态 JS 资源（draft-*.js / list-*.js），无任何列表数据 API。表体 0 行不是渲染慢，是页面在后台状态下压根不取数、不建 DOM。
2. **激活、关后台节流都救不了**：spike 实验（`setBackgroundThrottling(false)`）无效；new_tab→switch_tab 后在最小化状态下采样 43 秒仍 0 行。DOM 读取路线（R9-6 方案 A）在后台场景**无解**。
3. 与 §4.1 的历史结论合并后完整图景：vxe 表体只在页面可见且有数据时存在；后台 = 不取数 = 无 DOM = 判重必败。**DOM 判重与「后台跑」的产品设计根本冲突**（AGENTS：后台调研在最小化时继续跑）。

### 7.3 处置

- R10 的稳定窗与预算改动**保留**（可见路径上仍有效，且堵住部分渲染误判 absent 的 R7 同类风险；单测全绿，复审通过）。但 R10 的「真机验收」标准作废，并入 R11 后台化验收。
- **R11 = 判重数据源接口化（方案 B）**：页面上下文直接 fetch 采集箱列表数据 API，与渲染彻底解耦，后台可跑；同时消灭 #48 的临时激活换标。实现前置：附录 C 接口采样（URL、参数、响应形状、鉴权、按标题搜索的等价参数）——本轮规划方采样未完成（MCP execute 无 tabId、跟活动标签走，采样屡次打错标签），待 mcp-server 的 tabId 线程化改动落地后补采。
  - **2026-11-09 19:15 已出任务书**：`docs/ECOMMERCE-PHASE1-FIX-R11-CURSOR-TASKBOOK.md`（决策点 #51）。Part A（契约 + 解析 + 安全语义 + 单测）可立即开工；Part B（接真实接口）等附录 C 采样完成后书面放行。
- 工作区另发现**非本任务来源的未提交改动**：`mcp-server.ts` / `tools/index.ts` 给 execute/select/upload/click_text/menu_click 加 tabId 参数（18:51 修改，非 Cursor R10 汇报内容，非规划方所改）。typecheck 通过。**来源待用户确认，规划方未动它。**
