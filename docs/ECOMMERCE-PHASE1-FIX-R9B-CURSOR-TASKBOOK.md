# 电商一期 R9B 任务书（Cursor 执行）：判重读取解堵（R9-6）+ live 认领（R9-4）

> 前置：R9 主体（判重返工 R9-1、禁绕话术 R9-2、标签改绑 R9-3）已交付且真机验收通过（六轮 unknown 停等不再假 absent、三次 tab_rebound verified、六轮零写点击，详见 R9 任务书 §6）。真机验收发现判重被渲染阻塞堵死，认领弹窗 DOM 已于 2026-11-09 采样回填（附录 A）。本轮就两件事：**R9-6 判重读取解堵** + **R9-4 live 认领**。
> 写字段、翻译、保存、发布、选分类本轮继续停等，一个都不放开。不提交 Git，不打安装包。

## 0. 本轮背景（必读）

- **判重安全但堵死**：判重 openTab 的采集箱标签不激活时 vxe 表体永不渲染（规划方三角插桩实证：后台标签、被盖住的标签都不渲染，激活后秒读 100 行）。R7 假 absent 事故的完整根因也是它。当前六轮 prepare 全部停「采集箱列表没有加载出来，无法判重」。
- **认领停等原因**：`dxm-smt-claim.ts` 的 `SMT_CLAIM_TEXT` 常量未回填，`claimSelectorsReady()` 恒 false。附录 A 已回填（文末），具备开写条件。
- 决策点 #45–#48 已登记在 `docs/DECISION-POINTS.md`，合码前核对本轮改动与 #48 措辞一致。

## 1. R9-6 判重读取解堵

**问题**：判重 openTab 的采集箱标签不激活 → vxe 行永不渲染 → pollBox 10 秒超时 → 判重永远无法完成。

**修复（方案 A）**：

1. `src/main/browser.ts` `createLiveDxmSmtPort`（现约 L5510-5532）增加两个能力：
   - `activateTab: (tabId: string) => void`——内部即 switchTab，只改 activeTabId + layout，**不 `window.focus()`、不闪任务栏、不抢前台**；
   - `getActiveTabId: () => string | undefined`。
2. `src/main/workflows/dxm-smt-live.ts` `lookupOrder`（现约 L120-145）：openTab 拿到 boxTabId 后，先记当前活动标签 prevActive，立即 `activateTab(boxTabId)`，再走现有 pollBox / searchBox / decideBoxLookup；finally 里 `closeTab(boxTabId)` 后若 prevActive 仍存在则 `activateTab(prevActive)` 恢复。
3. 激活期间维持「后台任务不把窗口拉回前台」的死规则。用户若正看窗口会看到标签短暂切换，属已接受的代价（决策点 #48）。
4. pollBox 10 秒预算不动（实测激活后 100 行秒级渲染）。
5. 用户在判重期间手动关掉采集箱标签 → 仍走现有 unknown 停等，不许崩、不许卡死。

**不做**：不改 parkPageView、不动 backgroundThrottling、不新开渲染通道。备选方案 B（XHR 数据源）本轮不议，挂 R10。

## 2. R9-4 live 认领实现

先把 `dxm-smt-claim.ts` 常量按附录 A 已核对事实回填并对齐脚本：

1. `SMT_CLAIM_TEXT`：`dialogTitle:"选择店铺-认领到采集箱"`、`confirm:"确定"`、`cancel:"关闭"`（附录 A 已核对，取消按钮**不是**「取消」也不是「确认」）。`READ_CLAIM_DIALOG_SCRIPT` 里硬编码的「确认/取消」改用常量。
2. 店铺复选语义：`READ_CLAIM_DIALOG_SCRIPT` 读回弹窗内全部**可见**复选项及勾选态 + 「已选(N)」计数；勾选态读回必须过滤不可见项（弹窗里有隐藏勾选项「eBay产品默认认领到原站点」默认 checked 且 `display:none`，不过滤会误判「有其他店铺被勾选」触发误停等）。弹窗 DOM 里 checkbox 无有效 value、**shopId 不在 DOM**——`pickClaimShop` 的店名精确匹配是唯一通路（0/多条停等列候选语义不变）。

`dxm-smt-live.ts` 的 `claim` 按 R8 任务书 R8-3 的顺序实现（硬边界全部沿用），另加两条复选特有规则：

- 弹窗里**目标店铺之外还有别的可见店铺被勾选** → 不选、不点确定，停等，原因写明「认领弹窗里有其他店铺被勾选（已选 N），已停等」，**不代用户取消勾选**；
- 只允许「勾选目标店铺（若未勾）」和「点确定」两个动作；目标已勾选时不再点它。

成功落点与三证读回：附录 A 的成功落点各项仍待采（弹窗 DOM 内无 shopId，成功后页面读回位置未验证），实现时按 R8-3 已定顺序写好框架，读不回三证就停等说人话，不猜落点。`claimedDraftId` 与 `state: claimed` 仍由现有 listing 逻辑落账，本轮不改。

## 3. 测试与夹具

- **R9-6 单测**（新增）：
  1. 激活-恢复时序：mock port 断言调用顺序为 activateTab(boxTabId) → pollBox 读取 → closeTab(boxTabId) → activateTab(prevActive)；
  2. prevActive 已不存在（用户关了原标签）→ 关闭 boxTab 后不恢复、不报错；
  3. 判重期间采集箱标签被手动关掉 → unknown 停等，不抛异常。
- **R9-4 认领夹具**（新建，按附录 A 结构编造数据，**断言不含真实店铺名/真实标题/真实 ID**）：
  1. 复选唯一精确匹配且无其他勾选 → 只点「保存并认领」「目标店铺」「确定」三处，读回三证成功；
  2. 弹窗里目标外还有**可见**勾选 → 停等零确定点击，原因含「其他店铺被勾选」；
  3. 夹具确认按钮是「确定」而非「确认」、取消按钮是「关闭」——断言脚本不再找「确认」「取消」；
  4. 夹具放一个 `display:none` 且默认 checked 的隐藏勾选项（模拟「eBay产品默认认领到原站点」）→ **不触发**「有其他店铺被勾选」停等，流程正常继续；
  5. 边界回归：没有 claimConsent 仍零调用；写字段、翻译、保存、发布、选分类仍全部拒绝；#44 落点检查不变。
- 夹具结构按附录 A：`.ant-modal-wrap` > `.ant-modal` > `.ant-modal-title`；店铺项 `label.ant-checkbox-wrapper`（内含 `div.flex.w-145` 店名区）；计数 `span.inline-block.p-left5.h16` 文本「已选(N)」；footer「确定」`button.ant-btn-primary`、「关闭」`button.ant-btn-default`。
- 全量回归无新增失败（`chrome-hole.test.ts:493` 既有时序抖动，**注意它与 park 停放位同源，若 R9-6 改动使其行为变化要如实报告，不许偷偷改断言**）。

## 4. 禁区

- 写字段、文字/图片翻译、保存草稿、发布、选分类继续停等；认领弹窗之外不点任何按钮。
- 不代用户取消弹窗里别人店铺的勾选；不批量认领、不换店铺、不删除草稿、不碰分类。
- 不在无 `claimConsent` 时点「保存并认领」；授权不落盘、不跨次复用。
- 不改 `dxmEnabled()`；`dxm_smt_*` 仍只走 Free Soul 侧栏白名单，不进 `WORKFLOWS`。
- R9-6 只加 activateTab/getActiveTabId 和 lookupOrder 时序，不动 parkPageView / backgroundThrottling / 布局系统。
- 不提交 Git；不打安装包；E1–E12 继续挂未跑。

## 5. 验收标准

- 定向测试（R9-6 三项 + R9-4 五项）全绿；全量回归无新增失败。
- typecheck / lint（0 error）/ build 通过。
- 完成记录写在 `docs/ECOMMERCE-PHASE1-CURSOR-TASKBOOK.md`「Cursor R9B 完成记录」。
- 不声称判重「可用」直到真机复验停 ambiguous；不声称认领「可用」直到真机三证读回（两者都是规划方复审环节，不是 Cursor 自测环节）。

## 6. 真机验收（规划方复审时执行，Cursor 不执行）

1. R9-6：同记录跑 prepare → 期望停 **ambiguous**「标题精确匹配 1 条…」（当前六轮全 unknown）。
2. R9-4：用户当场授权后侧栏带 claimConsent 跑 prepare → 判重 → 弹窗勾目标店 → 确定 → 读回三证 → 工作单落 `claimedDraftId` → 停在写字段/翻译入口。顺路采成功落点 DOM（附录 A 剩余待采项）。
3. 认领完成后再跑一次同记录 prepare → 判重应停 ambiguous，不二次认领。

### 验收记录（2026-11-09，规划方执行）

- **R9-6 判重解堵：真机通过**。同记录 prepare 侧栏驱动，journal 落账（at 1794212972522）：`目标采集箱无法判重（标题精确匹配 1 条（未按店铺过滤），请人工确认是否同源草稿），已停等，不会认领`——判重自上线以来首次真正完成读取并给出 ambiguous。同轮 tab_rebound e68439a4→8007055a verified；采集箱标签读完即关、活动标签恢复原状（验收后 activeId 仍为用户原标签）。
- 代码复审（stash 只读核对）三项通过：`activateTab` 无 `window.focus()`/无闪任务栏、lookupOrder 激活-恢复时序含 hasTab 防御、claim 常量「关闭」+ 可见性三重过滤。
- 过程插曲：R2–R9B 半成品曾在打包期间被 `git stash -u`，验收前已确认工作区完整恢复；开发版与安装版共享 userData（单实例锁 + 3921），安装版退出后开发版才起得来；会话恢复仍会带回百度首页标签（本次未带崩，挂观察）。
- R9-4 认领路径：**未跑**——判重停 ambiguous（草稿在）走不到认领门。需用户删除挂腰草稿验 absent 路径后再当场授权认领，挂下一轮。

## 附录 A：认领弹窗采样表（DOM 级已回填，2026-11-09 规划方只读采样）

采样环境：开发版（带 `SPARO_DXM_SMT_PREVIEW=1`），挂腰风扇草稿（记录 167842582613033710）编辑页上由用户人工点「保存并认领」触发弹窗，规划方 MCP `execute` 只读采样两轮，采完由用户点「关闭」取消，**未点确定、未发生认领**。

| 项目 | 采样值 |
|---|---|
| 弹窗标题 | **已核对**：选择店铺-认领到采集箱。节点 `.ant-modal-title`（本例 id `vcDialogTitle0`，id 不稳定不要依赖） |
| 弹窗容器选择器 | **已核对**：`.ant-modal-wrap` > `.ant-modal`（附加 class `exchange-btn-position`、`css-l8jjhh`）。右上角关闭 × 为 `button.ant-modal-close` |
| 店铺选择控件类型 | **已核对**：复选。结构 `label.ant-checkbox-wrapper > span.ant-checkbox > input.ant-checkbox-input`，店名在 label 内 `div.flex.w-145` 区域文本 |
| 候选店铺读取方式（名称/值） | **已核对**：`input` 无有效 value（恒 "on"），**shopId 不在 DOM**——只能按 label 文本（店名）精确匹配。弹窗内分组：产品开发（草稿箱）；速卖通（PetLifeGlobal、Charmify Store、cn1093224020zuhae）；速卖通全托管 |
| 默认勾选店铺 | **已核对**：无（全部未勾选，「已选(0)」） |
| 「已选(N)」计数节点 | **已核对**：`span.inline-block.p-left5.h16`，旁边有「重置」链接 `a.inline-block.h16`（父容器 `div.flex.jcsb`） |
| 确认按钮文字 | **已核对**：确定（footer，`button.ant-btn-primary`） |
| 取消按钮文字 | **已核对**：**「关闭」**（footer，`button.ant-btn-default`；**不是**「取消」）。右上角另有 × 关闭按钮 |
| 其他必选项（采集箱/分组/分类） | 平台渠道分区（全部/速卖通/速卖通全托管，UI 分组非表单控件）；「选择模板」区域（本轮未展开，实现时按需再采）；「已认领至相同店铺的产品不再认领」可选勾（默认未勾）。**陷阱**：存在隐藏 checkbox「eBay产品默认认领到原站点」，默认勾选且 `display:none`——读回勾选态必须做可见性过滤（如 `offsetParent !== null`） |
| 成功落点（同标签/新标签/弹窗提示） | 待采（已知结果文案「认领到采集箱 状态：已完成！详情：速卖通采集认领执行完成，成功 1 条，失败 0 条，跳过重复数据 0 条」） |
| 成功后 URL 形态 | 待采 |
| draftId 读回位置 | 待采 |
| shopId 读回位置 | 待采（弹窗 DOM 内无 shopId，成功后页面能否读回待验） |
| recordId 读回位置 | 待采 |
| 失败/重复认领提示文案 | 待采 |
| 采样时间与记录 ID | 2026-11-08 行为级 + 2026-11-09 DOM 级两轮只读采样（记录 167842582613033710）；全程未点确定、未新增认领 |
