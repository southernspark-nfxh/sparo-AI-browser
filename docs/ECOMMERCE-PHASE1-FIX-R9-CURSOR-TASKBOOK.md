# 电商一期 R9 任务书（Cursor 执行）：判重返工 + 标签改绑 + 禁绕话术 + live 认领

> 前置：R7 真机验收**不通过**（见 [ECOMMERCE-PHASE1-R7-ACCEPTANCE-RECORD.md](./ECOMMERCE-PHASE1-R7-ACCEPTANCE-RECORD.md)）：真实采集箱表格是 vxe-table，R7 的 `.ant-table` 选择器读不到行；新标签加载期「暂无数据」占位态被当成「0 行已加载」，判重全部走假 absent。R8 代码已合（认领纯函数、claimConsent 授权门、防重复认领）。附录 A/B 均已于 2026-11-09 完成采样回填（见文末），live 认领具备开写条件。R9 真机验收中期记录与新增任务 R9-6 见 §6。
> 本轮目标四块：① 判重返工（vxe 选择器 + 占位态区分）；② 侧栏禁绕话术；③ 工作单标签死绑定修复；④ 附录 A/B 补齐 DOM 级采样后实现 live 认领。
> 写字段、翻译、保存、发布、选分类本轮继续停等，一个都不放开。

## 0. 代码事实（本轮起点）

- `dxm-smt-box.ts`：
  - `READ_BOX_SCRIPT` 用 `.ant-table` / `tr.ant-table-row` 读行——真实页面两者均为 0；`loaded` 的三个来源里 `emptyText`（全文含「暂无数据」）在新标签加载期就会为真，于是出现 `loaded:true, rows:[]` 的假 absent。
  - `boxSearchScript` 只认 `input.ant-input`（真实页面存在，R7 验收已确认）和文字恰为「搜索」的按钮——按钮是否存在于 vxe 页面未确认。
  - `boxListFromHtml`（离线解析）同样是 ant 选择器。
  - `decideBoxLookup`：0 行→absent；标题精确匹配 N 条→ambiguous。语义本身保留，错的是喂进来的 rows。
- `dxm-smt-claim.ts`：`SMT_CLAIM_TEXT.dialogTitle / confirm / cancel` 全部空着，`claimSelectorsReady()` 恒 false。**真机已采到**：弹窗标题「选择店铺-认领到采集箱」、确认按钮文字是「**确定**」（不是 R8 夹具假设的「确认」）、店铺为**复选**（可多选、有「已选(N)」计数）、取消按钮文字未采到。`READ_CLAIM_DIALOG_SCRIPT` 里硬编码找「确认/取消」按钮的文字要与常量对齐。
- `dxm-smt-live.ts` 的 `claim`：`claimSelectorsReady()` 把门，未回填零点击，保持。
- `dxm-smt-contract.ts` `bindTabs`：`editTabId: order.tabs.editTabId || update.editTabId` 旧值永远优先；`dxm-smt-listing.ts` 准备入口 L282-285 据此在标签不符时无条件停等。应用重启或侧栏换工作标签后，旧单永远「不是原编辑标签」，只能归档 journal 绕过（R7 验收已归档两次）。
- `free-soul.ts` L246 `run_workflow` 工具描述已含 claimConsent 规则，但没有「停等后禁止绕过工作流手动代劳」的禁令——R7 验收时侧栏正是这样绕过工作流手动点了「保存并认领」造成一次意外真实认领。
- 真机遗留：采集箱有一条真实草稿（挂腰风扇 / PetLifeGlobal / 7107102），用户决定去留；journal 现行仅 `dxm-mw7zvfpy-107cf8`（waiting_human，停在授权门）。

## 1. R9-0 采样前置（规划方执行，Cursor 不执行）

两份采样都在 Cursor 开工前由规划方完成并回填附录，**附录没填完的模块不许动对应 live 代码**。

### 附录 B：采集箱 vxe 结构（只读，无需用户授权写操作）——**已完成，2026-11-09 采样并回填，见文末附录 B**

带 `SPARO_DXM_SMT_PREVIEW=1` 重启开发版后，在采集箱页面用 MCP 只读采样：

1. vxe 行与单元格：真实行选择器（`tr.vxe-body--row` 或等价）、标题列/产品ID列在第几列、单元格内文本结构（标题和 ID 是否同格分行）。
2. vxe 空表标记：真空表用什么节点表达（`.vxe-table--empty-block` 或等价）；加载占位期「暂无数据」文本出现在什么容器里。
3. 搜索区控件：搜索框真实选择器、搜索按钮文字与选择器。
4. 回填本任务书附录 B。**回填前 R9-1 只能写纯函数和用「待定结构」占位的夹具骨架，不许把猜的选择器当已核对。**

### 附录 A 补齐：认领弹窗 DOM（需用户当场授权）——**已完成，2026-11-09 采样并回填，见文末附录 A**

弹窗只在点「保存并认领」后出现，该动作会真实保存草稿。利用现有那条挂腰风扇草稿走**重复认领**场景：点「保存并认领」→ 弹窗出现后只读采样 → **点取消**（不点确定，不新增认领）：

1. 弹窗容器选择器（ant-modal / 自定义）、标题节点。
2. 店铺复选项结构：label/input 结构、value 与店名来源、「已选(N)」计数节点、默认是否预选。
3. 确认/取消按钮的确切文字与选择器。
4. 若用户同意完整走一次认领（草稿已存在时认领同店会怎样由页面决定），采成功落点：结果文案节点（「认领到采集箱 状态：已完成！…」）、三证（draftId/shopId/recordId）读回位置。
5. 回填附录 A。确认按钮「确定」已采到，可以直接回填；其余 DOM 项回填前 `claim` 继续停等。

用户不授权时：R9-4 只交骨架并把已采到的行为级事实（标题、确定、复选）写进常量，`claim` 仍停等，真机挂 R10。

## 2. 任务

### R9-1 判重返工（附录 B 回填后开写）

`dxm-smt-box.ts` 全部按附录 B 的已核对选择器重写读取层，语义要求：

1. **三态加载判定**，替换现有 `loaded` 布尔：
   - vxe 表体已渲染（行 > 0，或空表标记节点存在）→ 加载完成；
   - 表体未渲染、只有占位文本 → **未加载**（`loaded:false`），上层继续轮询；轮询到上限仍加载不出来 → `unknown` 停等，文案「采集箱列表没有加载出来，无法判重」；
   - **禁止**把全文含「暂无数据」当作加载完成或 0 行依据；真 0 行只能来自已渲染的 vxe 空表标记。
2. 行读取：标题、产品ID按附录 B 的列结构取；读到的 title 为空的行丢弃（同现状）。
3. `boxSearchScript`：搜索框与按钮选择器按附录 B 修正；找不到任一就返回 `{ filled:false, clicked:false }`，由上层停等说人话，不换别的框乱填。
4. `boxListFromHtml`（离线解析）同步改成 vxe 结构，供测试用。
5. `decideBoxLookup` 语义不变：加载完成且真空 0 行→absent；标题精确匹配 1+ 条→ambiguous（reason 含匹配数）。ambiguous 停等文案保持「请人工确认是否同源草稿」。
6. 搜索后重读时同样走三态判定：搜索结果页若还在加载，不许拿旧 rows 或空 rows 判 absent。

### R9-2 侧栏禁绕话术（无采样依赖，先做）

- `free-soul.ts` `run_workflow` 工具描述（现 L246）追加：「dxm_smt 工作流返回停等（ok:false 或 waiting_human）时就是停等。禁止绕过工作流用 click_text、execute_primitives 或任何页面工具去手动点『保存并认领』『保存』『认领』『发布』类按钮；停等后只向用户说明原因并等待指示，不得替用户完成写操作。」
- `strategies/skills/dxm-smt-listing.json` 同步补同一句（措辞可按技能卡格式精简，禁令不得弱化）。
- 只改提示词文本，不改任何执行层判断逻辑；不加站点白名单、不动 #28/#31/#33。

### R9-3 工作单标签改绑（解死绑）

- `dxm-smt-listing.ts` 准备入口（现 L282-285）改逻辑：`order.tabs.editTabId` 与 `port.tabId` 不一致时，不再无条件停等——
  1. 先对当前标签跑 `readProbe`，若当前页是采集编辑页且 `crawlEditUrlId`（来源记录 ID）与工作单来源记录一致 → **改绑**：`editTabId` 更新为 `port.tabId`，evidence 落一行 `tab_rebound`（带原因「同记录编辑页，改绑当前标签」），继续执行；
  2. 否则维持现有停等文案不变。
- 改绑只允许发生在「当前页是同一来源记录的采集编辑页」这一种情况；不同记录、非编辑页、探针失败都不改绑、不新开标签、不刷新。
- `dxm-smt-contract.ts` `bindTabs` 的「旧值优先」语义保留（首绑防误改），改绑由 listing 层显式传入并落账，不在 `bindTabs` 里隐式发生。
- 决策点先登记再合码：#45 判重占位态、#46 同记录改绑（本任务书已同步写入 `docs/DECISION-POINTS.md`）。

### R9-4 live 认领实现（附录 A DOM 回填后开写）

先把 `dxm-smt-claim.ts` 常量按附录 A 已核对事实回填并对齐脚本：

1. `SMT_CLAIM_TEXT`：`dialogTitle:"选择店铺-认领到采集箱"`、`confirm:"确定"`、`cancel:"关闭"`（附录 A 已核对，取消按钮**不是**「取消」也不是「确认」）。`READ_CLAIM_DIALOG_SCRIPT` 里硬编码的「确认/取消」改用常量。
2. 店铺复选语义：`READ_CLAIM_DIALOG_SCRIPT` 读回弹窗内全部**可见**复选项及勾选态 + 「已选(N)」计数；勾选态读回必须过滤不可见项（弹窗里有隐藏勾选项「eBay产品默认认领到原站点」默认 checked 且 `display:none`，不过滤会误判「有其他店铺被勾选」触发误停等）。弹窗 DOM 里 checkbox 无有效 value、**shopId 不在 DOM**——`pickClaimShop` 的店名精确匹配是唯一通路（0/多条停等列候选语义不变）。

`dxm-smt-live.ts` 的 `claim` 按 R8 任务书 R8-3 的顺序实现（本任务书不重复，硬边界全部沿用），另加两条复选特有规则：

- 弹窗里**目标店铺之外还有别的店铺被勾选** → 不选、不点确定，停等，原因写明「认领弹窗里有其他店铺被勾选（已选 N），已停等」，**不代用户取消勾选**；
- 只允许「勾选目标店铺（若未勾）」和「点确定」两个动作；目标已勾选时不再点它。

成功落点与三证读回按附录 A 采到的优先级实现；`claimedDraftId` 与 `state: claimed` 仍由现有 listing 逻辑落账，R9 不改。

### R9-5 测试与夹具

- 判重夹具换 vxe 结构（编造数据，断言不含真实店铺名/真实标题/真实 ID）：`tests/fixtures/dxm-smt-box-vxe-rows.html`（≥2 行编造草稿）、`dxm-smt-box-vxe-empty.html`（已渲染空表标记）、`dxm-smt-box-vxe-loading.html`（只有占位文本、无表体）。原 ant 夹具删除或改为不再被引用。
- `tests/dxm-smt-r9.test.ts`（或扩 R7 测试文件）至少覆盖：
  1. vxe 已渲染 + 标题精确匹配 1 条 → ambiguous，reason 含「1 条」；
  2. vxe 已渲染 + 空表标记 → absent；
  3. **占位文本无表体 → 不判 absent**：loaded:false，轮询耗尽后 unknown 停等，文案含「没有加载出来」；
  4. 搜索框/按钮选择器对不上 → `{ filled:false, clicked:false }`，停等，不乱填别的框；
  5. 改绑：工作单 editTabId 过期，当前标签是同记录采集编辑页 → 改绑成功，evidence 含 `tab_rebound`，流程继续；
  6. 改绑拒绝：当前标签是不同记录 / 非编辑页 → 维持停等文案「不是工作单的编辑标签」；
  7. 认领：复选唯一精确匹配且无其他勾选 → 只点「保存并认领」「目标店铺」「确定」三处，读回三证成功；
  8. 认领：弹窗里目标外还有勾选 → 停等零确定点击，原因含「其他店铺被勾选」；
  9. 认领：确认按钮是「确定」而非「确认」、取消按钮是「关闭」——夹具里只放「确定」「关闭」，断言脚本不再找「确认」「取消」；
  10. 认领：弹窗夹具里放一个 `display:none` 且默认 checked 的隐藏勾选项（模拟「eBay产品默认认领到原站点」）→ **不触发**「有其他店铺被勾选」停等，流程正常继续；
  11. 边界回归：没有 claimConsent 仍零调用；写字段、翻译、保存、发布、选分类仍全部拒绝；#44 落点检查不变。
- 禁绕话术不写单测，交付时在完成记录里贴两处 diff 的关键句。
- 全量回归无新增失败（`chrome-hole.test.ts:493` 既有时序抖动）。

## 3. 禁区

- 写字段、文字/图片翻译、保存草稿、发布、选分类继续停等；认领弹窗之外不点任何按钮。
- 不代用户取消弹窗里别人店铺的勾选；不批量认领、不换店铺、不删除草稿、不碰分类。
- 不在无 `claimConsent` 时点「保存并认领」；授权不落盘、不跨次复用。
- 判重选择器只认附录 B 已核对值；采不到就停等，不猜 ant 也不猜 vxe。
- 改绑不放松停等：只解「同记录编辑页」一种死绑；不做关单/清单通道（挂 R10）。
- 不改 `dxmEnabled()`；`dxm_smt_*` 仍只走 Free Soul 侧栏白名单，不进 `WORKFLOWS`。
- 不提交 Git；不打安装包；E1–E12 继续挂未跑。

## 4. 验收标准

- 定向测试（R9 新增/改动项）全绿；全量回归无新增失败。
- typecheck / lint（0 error）/ build 通过。
- 完成记录写在 `docs/ECOMMERCE-PHASE1-CURSOR-TASKBOOK.md`「Cursor R9 完成记录」。
- 附录 B 未回填时，R9-1 只能交纯函数与待定夹具骨架，不得声称判重可用；附录 A 的 DOM 项未回填时，R9-4 只能交常量回填与骨架，`claim` 仍停等。

## 5. 真机验收（规划方复审时执行，需用户当场授权）

1. 带 `SPARO_DXM_SMT_PREVIEW=1` 重启开发版；用户先决定挂腰风扇草稿去留（保留→验 ambiguous 路径；删除→验 absent 路径，两条都要在验收里跑到）。
2. 判重：跑 prepare 同记录——若草稿在，期望停 ambiguous（不再假 absent 放行）；删掉草稿后再跑，期望 absent 后停在授权门。
3. 标签改绑：关掉工作单原编辑标签、在同一记录的另一个编辑页标签上续跑 → 期望改绑并继续，不停「不是原编辑标签」。
4. live 认领：用户授权后侧栏带 claimConsent 跑 prepare → 判重 absent → 弹窗勾目标店 → 确定 → 读回三证 → 工作单落 `claimedDraftId` → 停在写字段/翻译入口。
5. 禁绕：人为制造一次停等（如不带 claimConsent），观察侧栏是否只说明原因、不手动代点。此条只观察不强制，失败记缺陷。
6. 认领完成后再跑一次同记录 prepare → 判重应停 ambiguous，不二次认领。
7. E1–E12、真实发布、安装包验收继续挂账。

## 6. 真机验收中期记录（2026-11-09，规划方执行）

**已确认通过：**
- **R9-1 安全性达标，不再假 absent**：同记录跑 prepare 六轮，停等原因全部是「目标采集箱无法判重（采集箱列表没有加载出来，无法判重）」= unknown 停等，没有任何一轮把占位态当成 0 行放行到授权门。journal 三次 lookup 停等落账（1794203759376 / 1794204266975 / 1794204409073）。
- **R9-3 标签改绑真机通过**：三次 tab_rebound 全部成功且 verified（c8261a91→c79ae2e3→fcb3bb74→e68439a4，均为同记录编辑页），R7 时期死绑的旧单成功续跑。
- **R9-2 禁绕话术真机通过**：侧栏六轮停等全部只说明原因，未点「保存」「保存并认领」「认领」「发布」任何一个。
- 通路确认：MCP `run_workflow` 被 `dxmEnabled()` 拒绝是设计如此（商店版硬关）；`dxm_smt_*` 走 Free Soul 侧栏 + `SPARO_DXM_SMT_PREVIEW=1` 预览标志，链路正确。

**新缺陷（阻塞判重完成，见 R9-6）：**
- 判重 `openTab` 开出的采集箱标签（不激活）**永远不渲染 vxe 表体行**。park 后台标签被 `setVisible(false)` + x=-20000 移出窗口（[browser.ts parkPageView](../src/main/browser.ts)），Chromium 对非活动 view 的可见性/遮挡判定使懒渲染挂起。
- 规划方已做插桩三角验证（验证后已还原，工作区干净）：① agent 标签保持 visible、移出窗口 → 仍读不到行；② agent 标签停窗口内、保持 visible（被活动 view 盖住）→ 仍读不到行；③ 仅 switch_tab 激活后 → 秒读到 100 行。结论：**渲染当且仅当标签为活动标签**。
- 这也是 R7 事故的完整根因：parked 标签只能读到初始 HTML 的「暂无数据」占位 → R7 判据当成 0 行放行。R9 三态判定把它安全转成 unknown（安全但功能堵死）。判重从上线起就没有真正成功过。
- 全量测试中既有的 `chrome-hole.test.ts:493`（期望 x=-20000）正是 park 停放位测试，与本缺陷同源。

**其他发现：**
- 开发版三次整体崩溃均由一个百度首页标签 `render-process-gone` 带崩（会话恢复把它带回，形成循环）；验收时已关闭该标签。挂待观察，不算 R9 范围。
- 店小秘编辑页有未保存改动时，同标签内导航到列表类路由会被弹回编辑页（页面自身保护）。不影响判重 openTab 新标签路径（验收已证实新标签 URL 稳定不被重定向），但影响侧栏在同一编辑标签里换页探索。
- MCP `execute` 工具无 tabId 参数、永远跟活动标签；workflow 内部 `surface.execute(script, tabId)` 可对指定标签执行。采附录 B 时的 switch_tab 舞步即为绕开此限制。

### R9-6 判重读取解堵（Cursor 执行，本轮新增）

决策点 **#48** 已登记（[DECISION-POINTS.md](./DECISION-POINTS.md)），合码前先核对措辞一致。

**问题**：判重 openTab 的采集箱标签不激活 → vxe 行永不渲染 → pollBox 10 秒超时 → 判重永远无法完成。

**修复（规划方推荐方案 A）**：
1. [browser.ts](../src/main/browser.ts) `createLiveDxmSmtPort` 增加能力：`activateTab: (tabId) => void`（即内部 switchTab，只改 activeTabId + layout，**不 focus 窗口、不抢前台**）与 `getActiveTabId: () => string | undefined`。
2. [dxm-smt-live.ts](../src/main/workflows/dxm-smt-live.ts) `lookupOrder`：openTab 拿到 boxTabId 后，记下当前活动标签 prevActive，立即 `activateTab(boxTabId)`，pollBox 读取；finally 里 `closeTab(boxTabId)` 后若 prevActive 仍存在则 `activateTab(prevActive)` 恢复。
3. 激活期间不 `window.focus()`、不闪任务栏——维持「后台任务不把窗口拉回前台」的死规则。用户若正看窗口会看到标签短暂切换，属可接受代价（AGENTS.md 已允许「出报告只切标签」级别的标签切换）。
4. pollBox 维持 10 秒预算不动（实测激活后 100 行秒级渲染）。

**备选方案 B（A 不可行时再议，倾向 R10）**：判重数据源从 DOM 改为页面列表 XHR 接口重放，彻底摆脱渲染依赖。

**验收**：同记录跑 prepare → 期望停 ambiguous「标题精确匹配 1 条…」；补单测：激活-恢复时序（mock port 断言 activateTab/closeTab/恢复调用顺序）；回归：判重期间用户手动关掉采集箱标签 → 仍走 unknown 停等不崩。


## 附录 A：认领弹窗采样表（DOM 级已回填，2026-11-09 规划方只读采样）

采样环境：开发版（带 `SPARO_DXM_SMT_PREVIEW=1`），挂腰风扇草稿（记录 167842582613033710）编辑页上由用户人工点「保存并认领」触发弹窗，规划方 MCP `execute` 只读采样两轮，采完由用户点「关闭」取消，**未点确定、未发生认领**。

| 项目 | 采样值 |
|---|---|
| 弹窗标题 | **已核对**：选择店铺-认领到采集箱。节点 `.ant-modal-title`（本例 id `vcDialogTitle0`，id 不稳定不要依赖） |
| 弹窗容器选择器 | **已核对**：`.ant-modal-wrap` > `.ant-modal`（附加 class `exchange-btn-position`、`css-l8jjhh`）。右上角关闭 × 为 `button.ant-modal-close` |
| 店铺选择控件类型 | **已核对**：复选。结构 `label.ant-checkbox-wrapper > span.ant-checkbox > input.ant-checkbox-input`，店名在 label 内 `div.flex.w-145` 区域文本 |
| 候选店铺读取方式（名称/值） | **已核对**：`input` 无有效 value（恒 "on"），**shopId 不在 DOM**——只能按 label 文本（店名）精确匹配，R8 `pickClaimShop` 的店名匹配路径即为唯一通路。弹窗内分组：产品开发（草稿箱）；速卖通（PetLifeGlobal、Charmify Store、cn1093224020zuhae）；速卖通全托管 |
| 默认勾选店铺 | **已核对**：无（全部未勾选，「已选(0)」） |
| 「已选(N)」计数节点 | **已核对**：`span.inline-block.p-left5.h16`，旁边有「重置」链接 `a.inline-block.h16`（父容器 `div.flex.jcsb`） |
| 确认按钮文字 | **已核对**：确定（footer，`button.ant-btn-primary`） |
| 取消按钮文字 | **已核对**：**「关闭」**（footer，`button.ant-btn-default`；**不是** R8 夹具假设的「取消」）。右上角另有 × 关闭按钮 |
| 其他必选项（采集箱/分组/分类） | 平台渠道分区（全部/速卖通/速卖通全托管，UI 分组非表单控件）；「选择模板」区域（本轮未展开，实现时按需再采）；「已认领至相同店铺的产品不再认领」可选勾（默认未勾）。**陷阱**：存在隐藏 checkbox「eBay产品默认认领到原站点」，默认勾选且 `display:none`——读回勾选态必须做可见性过滤（如 `offsetParent !== null`），否则会误判「有其他店铺被勾选」触发误停等 |
| 成功落点（同标签/新标签/弹窗提示） | 待采（已知结果文案「认领到采集箱 状态：已完成！详情：速卖通采集认领执行完成，成功 1 条，失败 0 条，跳过重复数据 0 条」） |
| 成功后 URL 形态 | 待采 |
| draftId 读回位置 | 待采 |
| shopId 读回位置 | 待采（弹窗 DOM 内无 shopId，成功后页面能否读回待验） |
| recordId 读回位置 | 待采 |
| 失败/重复认领提示文案 | 待采 |
| 采样时间与记录 ID | 2026-11-08 行为级 + 2026-11-09 DOM 级两轮只读采样（记录 167842582613033710）；全程未点确定、未新增认领 |

## 附录 B：采集箱 vxe 结构采样表（已回填，2026-11-09 规划方只读采样）

采样环境：安装版 Sparo（开发版重启失败，登录态共享，只读采样无需预览标志）；页面 `https://www.dianxiaomi.com/web/smt/smtProductList/draft`（速卖通采集箱，共 137 条草稿，100 条/页）。采样方式：MCP `execute` 只读 DOM 查询 + 一次搜索触发/复原（填 `ZZNOMATCH999` 点搜索读真空态后清空复原，页面已恢复原列表）。全程未点任何保存、认领、批量按钮。

| 项目 | 采样值 |
|---|---|
| 行选择器 | **已核对**：`tr.vxe-body--row`（实测 100 行；带 `rowid` 属性如 `220114600901053096`）。单元格 `td.vxe-body--column` 带 `colid`：checkbox 列 `col_44`、图片 `col_45`、其后顺延 |
| 容器结构 | `.vxe-table` ×1、`.vxe-grid` ×1、`user_table` ×1、`search-table-container` ×1；**ant 表格 0 个**（`ant-table` / `ant-table-row` 均为 0，R7 选择器实锤无效） |
| 表头 | `图片 / 标题/产品ID / 分组 / 价格 / 库存 / 运费模板 / 时间 / 操作`（checkbox 的 th 为空） |
| 标题列位置与单元格结构 | **已核对**：标题在 `td[2]`（0 基），文本结构 `标题\n\n「店铺名」`（店铺名带「」）；`td[0]` checkbox、`td[1]` 图片列（含 1688 链接文字）、`td[7]` 时间列（`创建：…更新：…`）；`td[8]`（操作列）未采样 |
| 产品ID列位置与读法 | **已核对**：产品ID `7107102` 出现在 `td[5]`（与表头逐列对齐落在「库存」位，存在列错位可能）。**实现口径：产品ID 从整行文本提取 7 位以上连续数字，或按 `colid` 逐列核对，不硬编码列号** |
| vxe 空表标记节点 | **已核对**：`.vxe-table--empty-block`，父容器 class `vxe-table--body-wrapper body--wrapper`。**注意：该节点在有 100 行数据时也常驻（count=1），不能单独作空表判据——判空只看 `tr.vxe-body--row` 行数** |
| 真空态结构 | 无匹配搜索后：`vxeBodyRow=0`，`.vxe-table--empty-block > .vxe-table--empty-content` 内为 `empty-container`（图片 + 文案），全文含「暂无数据」 |
| 加载占位「暂无数据」 | 占位文本同样落在 `.vxe-table--empty-block .vxe-table--empty-content`。**僵尸态实证**：休眠唤醒的后台标签可停在「暂无数据 + 采集箱(0)」假空态，reload 轮询后恢复 137 条——三态判定必须区分「表体已渲染」与「只有占位文本」 |
| 搜索框选择器 | **已核对**：表格外第一个 `input.ant-input`（placeholder 为单个空格，无文字提示；实测填它 + 点搜索有效）。页面另有许多 `rc_select_*` 下拉和 `vxe-input--inner`（页数、每页条数），都不是搜索框，不许乱填 |
| 搜索按钮文字与选择器 | **已核对**：文字「搜索」，class `ant-btn ant-btn-primary m-left10 b-rd-4`。页面有**两个**「搜索」按钮（第二个无 `m-left10`），实现取表格外文字匹配的第一个即可 |
| 搜索类型下拉 | 搜索框旁有「标题 / SKU编码」下拉，当前值未采到；R9-1 判重不依赖它 |
| 采样时间 | 2026-11-09（含一次搜索触发与复原；采样后已切回用户原标签） |
