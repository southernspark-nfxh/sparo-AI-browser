# 店小秘 R5 任务书 — 真实只读选择器基线（采集编辑页）

> 规划方（Trae）维护，Cursor 执行。从本文件自取上下文，不需要其他会话记录。
> 前置：R4 六项修复已通过规划方第五次复审（见 `docs/ECOMMERCE-PHASE1-CURSOR-TASKBOOK.md` 第 8 节）。
> 本轮只做**读**。全部写操作继续停等，边界一个不许动。

## 0. 背景：只读真机发现（2026-11-08）

R4 复审通过后，规划方在真实店小秘采集编辑页（账号 jiuyecc，`productCrawl/edit?id=167842582613033710`，商品 F19 挂腰风扇）跑了探针脚本，发现：

1. **真实页面没有任何 `data-record-id` / `data-shop-id` / `data-draft-id` / `data-product-id` 标记**（`dataAttrCount: 0`）。PROBE_SCRIPT 现在依赖的标记全部是 mock 约定，真实页面读回全空。
2. 因此 `dxm_smt_probe` 在真实页面会安全停等——行为符合设计（识别不到身份不动手），但链路在真实页面不可用。
3. recordId 的可靠来源是 **URL 参数**：`/web/productCrawl/edit?id=<recordId>`。
4. 店铺列表在采集编辑页上不存在（顶栏无切换器、无原生 select、`[class*=shop]` 只有 SVG 图标）。大概率在「保存并认领」弹窗或独立店铺管理页，本轮不点任何按钮，先留占位。

## 1. 真实页面锚点（2026-11-08 真机采样，已脱敏）

| 项 | 真实锚点 |
|---|---|
| recordId | URL searchParams `id`（`/web/productCrawl/edit?id=…`） |
| 技术栈 | Vue scoped（`data-v-*`）+ Ant Design Vue（`ant-input`、`ant-checkbox-input`） |
| 页面分区 | 锚点菜单 `.anchor-menu`：`#dxmInfo`（店小秘信息）、`#productInfo`（产品信息）等 |
| 标题输入 | `input.ant-input-sm[placeholder="请填写标题"]`，value 为真实标题 |
| SPU 输入 | `input.ant-input.w-750\!`（placeholder 以「示例：华为P60」开头） |
| 供货渠道 | `input.ant-input-disabled` |
| 描述 | CKEditor iframe（`.cke_wysiwyg_frame`），描述正文在 iframe 内 |
| SKU 变种区 | **div 网格，不是 table，也不是 ant-table**（页面 11 个 table 全是侧边导航）；列头：颜色/尺寸/SKU/货源价格(CNY)/折扣价/价格(USD)/促销价/库存/包裹尺寸/包裹重量 |
| 价格读回 | `1.75 USD` 带单位后缀；库存为空 |
| 图片勾选 | `ant-checkbox-input` |
| 操作按钮 | button 文本：`一键翻译`、`保存`、`保存并认领` |
| 店铺列表 | 编辑页不存在；来源待规划方补采（见 R5-4） |

## 2. 任务清单

### R5-1：PROBE_SCRIPT 真实基线改造（`src/main/workflows/dxm-smt-page.ts`）

**要求：**

1. `recordId` 改为三源读取，任一命中即用：`data-record-id` 标记（保留，测试与未来注入用）→ URL searchParams `id`（`pathname` 含 `/web/productCrawl/edit` 时）→ 均无则空。
2. `pageKind` 判定加入真实规则：`/web/productCrawl/edit` 路径 + `id` 参数 → 采集编辑页；同时保留现有 draft 页规则。按钮存在性（`保存并认领`）可作为辅助确认，不作为唯一依据。
3. `shops` 读取保持现有 `data-shop-id` 逻辑；真实页面读不到时返回空数组，**不允许**为了过身份校验去猜或写死店铺。
4. PROBE_SCRIPT 返回值新增 `urlId` 字段（URL 参数读到的 recordId），与标记读到的 `recordId` 分开记录，便于诊断来源。
5. `classifyPage` / `resolveIdentity` 相应调整：采集编辑页身份 = `recordId` + 至少一个店铺。缺店铺时 `identity.ok` 仍为 false，但失败原因要写明「页面无店铺来源（等待店铺基线）」，与「标记缺失」区分。

**验收：**

- 新增 fixture 单测：真实 URL + 无 data 标记的采集编辑页 HTML → probe 读回 `recordId` 来自 URL、kind 为采集编辑页、shops 空、身份失败原因含店铺来源缺失。
- 现有全部单测不回退。

### R5-2：readFields 真实读回（`src/main/workflows/dxm-smt-live.ts`）

**要求：**

1. `readFields` 从只返回 title 扩展为：标题（`input[placeholder="请填写标题"]` 的 value）+ SKU 变种区读回。
2. SKU 读回用真实结构：定位「变种信息」区块（文本锚点 `变种信息` 或对应 `data-v` 容器），按行读颜色/尺寸/价格/库存。**读不到行时返回空数组并写明原因，不允许猜。**
3. 价格剥离：新增纯函数 `parsePriceCell(text)` —— `1.75 USD` → `1.75`；`1.75` → `1.75`；空/非数字 → 空。`SkuRow.price` 存剥离值，原始读回进快照 `rawPrice`（诊断用）。库存同样处理（无单位）。
4. `skuContinuityIssues` 的价格/库存比较用剥离值（规格 token 仍按原文）。
5. 描述（CKEditor iframe）本轮**不做**读回——跨 iframe 读取留给 R6，`readFields` 对描述返回明确的「iframe 待基线」标记，不算失败。

**验收：**

- 单测：`parsePriceCell` 覆盖 `1.75 USD` / `1.75` / 空 / `abc`。
- 单测：真实变种区结构 fixture（用第 1 节列头做最小 fixture）→ 读回 8 行 SKU，价格剥离正确，库存空。
- 单测：SKU 读回为空时 `skuContinuityIssues` 仍报「SKU 读回为空」。

### R5-3：真实脱敏 fixture

**要求：**

1. 新建 `tests/fixtures/dxm-crawl-edit.html`（或等价形式）：按第 1 节锚点构造最小真实结构——URL 无法进 fixture 的部分用注入 `history.replaceState` 或测试内直接调解析函数覆盖。
2. fixture 脱敏：不含真实账号、真实店铺、可识别商品标题。
3. R5-1、R5-2 的单测都用这份 fixture，不另造互相不一致的假结构。

### R5-4：店铺来源占位

**要求：**

1. `readShops` 在真实页面返回空时，probe / prepare 的停等原因统一为「店铺来源待基线（R5-4）」。
2. 不实现任何店铺列表猜测逻辑。店铺管理页基线由规划方下次真机采样后，出 R6 任务书补上。
3. 在 `docs/ECOMMERCE-PHASE1-CURSOR-TASKBOOK.md` 第 8 节完成记录里写明：店铺来源为已知缺口，不冒充完成。

## 3. 全局禁区（违反 = 打回）

1. **写操作全部保持停等**：claim / writeField / translateText / saveDraft / clickPublish / selectCategory 一个都不许实现真实版本。
2. **不点页面上的任何按钮**：`保存`、`保存并认领`、`一键翻译` 都不许碰（单测里也不许模拟真实点击副作用）。
3. 不动 `dxmEnabled()`，不把新 ID 加进旧 `WORKFLOWS`，不接回 `runFullListing()`。
4. 不提交 git，不打包（`npm run dist`），不碰 `docs/listings/`。
5. E1–E12 真机验收继续挂未跑，不许在记录里写成通过。

## 4. 工程要求

- TDD：先写失败测试再实现。新测试放 `tests/dxm-smt-r5.test.ts`。
- 每完成一项跑 `npm test` 全量 + `npm run typecheck`；全部完成后跑 `npm run build` 和 `npm run lint`。
- 完成后在 `docs/ECOMMERCE-PHASE1-CURSOR-TASKBOOK.md` 第 8 节追加「Cursor R5 完成记录」：改动文件、新增测试名、真机部分如实写「未跑」。

## 5. 验收（规划方执行）

1. 代码复审：对照本任务书逐条核对，含停等边界未被破坏。
2. 定向 + 全量复跑。
3. 真机只读：在真实采集编辑页跑 probe，期望返回 recordId（URL 来源）+ 采集编辑页分类 + 店铺来源缺失的明确停等原因。
4. 真机验收通过后，规划方补采店铺管理页 DOM，出 R6（店铺基线 + 认领弹窗只读采样）。
