# 电商一期 R7 任务书（Cursor 执行）：判重真读采集箱

> 前置：R6 已通过代码复审 + 真机验收（店铺基线缓存、shopName 绑定、建单全部符合预期）。
> 本轮目标：把 R6 真机验收暴露的最后一个停等桩换掉——`lookupDraft` 恒返回 unknown 导致 prepare 永远停在「目标采集箱无法判重」。实现 live 真读速卖通采集箱，让判重通过后链路停等在**认领**（下一步的真实边界）。

## 1. 真机采样结论（2026-11-08，规划方执行，只读）

### 1.1 停等桩的现状（代码事实，非采样）

- 真机「无法判重」的直接原因：`dxm-smt-live.ts` 的 `lookupDraft: async () => ({ status: "unknown" })` 恒返回 unknown（R4/R5 时代的停等桩），**不是** disabled 输入框读值问题（那是侧栏模型的猜测，已排除）。
- 停等产生处：`dxm-smt-listing.ts` 的 `lookupClaim` 返回 `ambiguous`/`unknown` → `finishStop("目标采集箱无法判重…")`。
- 判重合同（`dxm-smt-contract.ts` `associateExisting` 注释）：**来源记录 ID + 店铺 ID 缺一即禁止判重，禁止只靠标题判重**。

### 1.2 速卖通采集箱草稿列表页

- URL：`https://www.dianxiaomi.com/web/smt/smtProductList/draft`；标题「店小秘--速卖通产品」；面包屑「数据采集 > 速卖通采集箱」。
- **当前账号此列表为 0 条**（页面显示「暂无数据」，页头统计「采集箱 (0)」）——判重第一版的主要真机场景就是 absent。
- 筛选器（页面文本）：「店铺账号: 全部 PetLifeGlobal Charmify Store cn1093224020zuhae」「搜索类型 标题 SKU编码」「搜索内容 搜索」——**没有按来源记录 ID / SPU 搜索的入口**，ant-design 控件（`ant-input`、`rc_select_N`）。
- 表格：**ant-design 表格，不是 vxe-table**（采到的 `tables` 全是左侧导航的 `w-two` 菜单表；正文表格因 0 行只见到「暂无数据」）。表头列（页面文本）：图片、标题/产品ID、分组、价格、库存、运费模板、时间、操作。
- 0 行时的可判标识：页面文本含「暂无数据」。

### 1.3 判重状态机设计（规划方定，照此实现）

判重的可靠键（recordId + shopId）在列表页**没有查询入口**，标题搜索只能当线索不能当证据。第一版状态机：

1. 打开草稿列表（加载判定：出现「暂无数据」或表格行，轮询上限 10 秒）：
   - **0 行（暂无数据）→ `absent`**（判重通过，链路走向认领停等——当前真实主场景）。
2. **>0 行 → 用编辑页标题做精确搜索**（标题来自字段快照 `READ_FIELDS`；优先 URL 参数携带搜索词，不支持则填搜索框 + 点「搜索」按钮——这是查询交互，不改数据，允许）：
   - 0 匹配 → `absent`；
   - 1+ 匹配 → **`ambiguous`**，原因写明「标题精确匹配 N 条（未按店铺过滤），请人工确认是否同源草稿」——让人判，不猜。
3. 编辑页读不到标题 / 列表页加载失败 → `unknown` 停等。
4. **`found` 第一版不产生**（需要开草稿详情页核对 recordId+shopId+draftId 三证，成本高，留给 R8+；ambiguous 停等已覆盖该场景不误认领）。

## 2. 任务

### R7-1 live 适配器实现 lookupDraft（真读，替换 unknown 桩）

- 新模块（如 `dxm-smt-box.ts`，或并入现有文件由你定）：列表解析 `boxListFromHtml(html)` 纯函数 + 采集箱常量 URL。
- live 层 `lookupDraft` 实现按 1.3 状态机：
  - **硬边界（同 R6-1）：绝不在用户的编辑页上导航。** port 的 tab 是采集编辑页（`crawlEditUrlId` 判定）时，必须新开标签（`openTab` + `agentOwned`）去草稿列表、读完 `closeTab`；port tab 不是编辑页才允许直接 `navigate`。
  - 轮询 10 秒等「暂无数据」或行出现；页面没出来 → `unknown` + 原因，不猜。
  - 标题来源：调用方（`lookupClaim` 链路）需把编辑页字段快照的标题传下来——现有 `lookupDraft` 签名没有标题入参，按现有类型扩展（`lookupClaim` 处用 `port.readFields` 或已有快照取标题，取不到就 `unknown` 停等，原因「编辑页读不到标题，无法判重」）。
  - 搜索交互：优先试 URL 参数（如 `?title=` 之类，实现时以真机行为为准，规划方复审时会核）；URL 不支持就 `fill` 搜索框 + `click` 搜索按钮。**只允许这两个查询动作**，禁止点行内「操作」列任何按钮（编辑/删除/刊登）。
- 判重通过（absent）后链路自然走向现有认领停等（「认领入口没有已核对标记，已停等」），**认领本身不动**。

### R7-2 free-soul 提示词补参数说明（R6 真机观察 1）

- `free-soul.ts` 工作流说明段（现 L246 附近）补一句：「`dxm_smt_prepare` 指定目标店铺用参数 `shopName`；`dxm_smt_shops` 没有参数，每次调用都重新抓取店铺列表」（R6 真机：模型第一次传 `shop` 无效，还发明过 force/refresh/noCache）。

### R7-3 测试与夹具

- 新夹具 `tests/fixtures/dxm-smt-box-list.html`：ant 表格结构 + 「暂无数据」场景；再备一份有 2 行**编造**草稿（编造标题、产品ID，如「示例夹子风扇草稿 / box-9001」）的夹具（可两个文件或一个文件两种结构由你定）。断言不含真实店铺名与真实商品标题。
- 新测试 `tests/dxm-smt-r7.test.ts`，至少覆盖：
  1. 0 行列表 → `absent`。
  2. 有 2 行 + 标题搜索无匹配 → `absent`（搜索交互 mock）。
  3. 有 2 行 + 标题精确匹配 1 条 → `ambiguous`，原因含匹配数提示。
  4. 编辑页读不到标题 → `unknown` 停等，原因一句人话。
  5. port tab 是编辑页时 lookupDraft 开新标签、读完关闭、不导航编辑页（mock 断言，同 R6-1 测试模式）。
  6. 判重 absent 后 prepare 停在认领（「认领入口没有已核对标记」），claim 零调用。
  7. 停等边界回归：认领 / 保存 / 发布 / 写字段仍拒绝。
- 全量回归无新增失败（`chrome-hole.test.ts:493` 既有抖动）。

## 3. 禁区（不变）

- 一切写操作（claim / writeField / translateText / translateImages / saveDraft / clickPublish / selectCategory）保持停等；**认领弹窗不碰**。
- 采集箱列表页只允许「打开 + 读 + 填搜索框 + 点搜索」；禁止点行内操作列（编辑/删除/刊登/同步）、禁止点「创建产品」「同步产品」「批量操作」「快捷操作」。
- 不动 `dxmEnabled()`；`dxm_smt_*` 仍只走 Free Soul 侧栏白名单，不进 `WORKFLOWS`。
- 不提交 Git；不打安装包。E1–E12 挂未跑。

## 4. 验收标准

- 定向 `tests/dxm-smt-r7.test.ts` 全绿；全量回归无新增失败。
- typecheck / lint（0 error）/ build 通过。
- 完成记录写在 `docs/ECOMMERCE-PHASE1-CURSOR-TASKBOOK.md` 第 8 节「Cursor R7 完成记录」。

## 5. 真机验收（规划方复审时执行）

1. 带 `SPARO_DXM_SMT_PREVIEW=1` 开发版，侧栏在有料采集记录（`id=167842582613033710`）上 prepare（shopName=PetLifeGlobal）→ 判重 `absent`（采集箱 0 条）→ **停等原因变为「认领入口没有已核对标记，已停等」**（不再是不明判重）。
2. 确认判重过程开的是独立标签、用户编辑页未被导航。
3. 认领弹窗采样（**需用户当场授权**）：用户在编辑页点一次「保存并认领」停在弹窗（该动作会先真实保存草稿，必须用户明确同意），规划方只读采样弹窗 DOM，给 R8 出认领选择器。用户不同意就跳过，挂 R8。
