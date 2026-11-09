# 电商一期 R6 任务书（Cursor 执行）：店铺来源基线

> 规划方第五轮真机采样产出。前置：R5 已通过代码复审 + 真机验收（探针 URL 来源号、crawl_edit 判型、店铺缺失停等全部符合预期）。
> 本轮目标：把「店铺来源待基线（R5-4）」这个缺口补上——从真实店铺授权页读速卖通店铺列表，入本地缓存，让 probe / prepare 的身份解析完整起来。

## 1. 真机采样结论（2026-11-08，规划方执行，只读）

### 1.1 店铺授权页

- URL：`https://www.dianxiaomi.com/web/system/authorization/platform`
- 标题：「店小秘--店铺授权」；面包屑：「平台授权 > 速卖通店铺授权」
- 首页入口：首页上的「店铺授权」按钮（`a.btn`）指向同 URL；首页还有多个「去授权」链接带 `?go=mXXX` 平台参数（m528/m532/m540 等），**不要用 go 参数**，直开裸 URL 即可。
- 筛选器（页面文本）：「平台：全部(74) 已授权(3) 未授权(71)」「跨境店铺(3) 本地店铺(0)」。默认视图就是速卖通已授权店铺列表。

### 1.2 店铺列表 DOM（vxe-table）

- 容器链：`.vxe-grid--table-wrapper > .vxe-table > .vxe-table--render-wrapper > .vxe-table--main-wrapper > .vxe-table--body-wrapper.body--wrapper`
- **行选择器：`.vxe-table--body-wrapper TABLE.vxe-table--body TBODY TR.vxe-body--row`**
- **行属性：`rowid` = 店铺内部 ID**（如 `8420150`）——这是 dxm 侧的店铺主键，认领弹窗大概率也用它
- 表头：`TABLE.vxe-table--header THEAD TR.vxe-header--row TH.vxe-header--column`（列头文本：店铺名称 / 速卖通ID / 店铺属性 / 授权时间 / 操作）

真实行 HTML（结构参考，店铺名为真实数据，测试 fixture 必须用编造名）：

```html
<tr class="vxe-body--row" rowid="8420150">
  <td class="vxe-body--column col_6" colid="col_6">
    <div class="vxe-cell"><div>PetLifeGlobal</div></div>          <!-- 店铺名称 -->
  </td>
  <td class="vxe-body--column col_7" colid="col_7">
    <div class="vxe-cell"><span class="vxe-cell--label">cn1110698603sibae</span></div>  <!-- 速卖通ID -->
  </td>
  <td class="vxe-body--column col_8" colid="col_8">
    <div class="vxe-cell">
      <div> 店铺币种: CNY </div>
      <div> 半/全托管： 已授权半托管 </div>
      <div> 小 B 店铺： -- </div>
    </div>
  </td>
  <td class="vxe-body--column col_9" colid="col_9">
    <div class="vxe-cell"><span class="vxe-cell--label">2026-08-24 11:57:39</span></div>  <!-- 授权时间 -->
  </td>
  <td class="vxe-body--column col_10 col--center col--last" colid="col_10">
    <div class="vxe-cell">重新授权 / 修改 / 更多</div>            <!-- 操作，禁止点击 -->
  </td>
</tr>
```

注意：colid 数字（col_6…col_10）是 vxe-table 动态生成的，**不要硬编码 colid 做唯一定位**；用「行内第 N 个 td + 内容特征」双保险（见 R6-1）。

当前账号真实店铺（3 家已授权）：PetLifeGlobal / cn1110698603sibae / CNY / 已授权半托管；Charmify Store / cn1111995569nicae / CNY / 托管未授权；cn1093224020zuhae / cn1093224020zuhae / CNY / 已授权半托管。

## 2. 任务

### R6-1 live 适配器实现 readShops（真读，不是停等）

- 导航到 `https://www.dianxiaomi.com/web/system/authorization/platform`（URL 直开，**不点页面上任何按钮**），等 `TR.vxe-body--row` 出现（轮询上限 10 秒）。
- 每行解析：
  - `shopId`：行元素 `rowid` 属性（非空字符串；空则该行跳过并计数）
  - `name`：第 1 个 td 的 `.vxe-cell` 直接子 div 文本（trim）
  - `aliId`：第 2 个 td 的 `span.vxe-cell--label` 文本
  - `currency`：第 3 个 td 内匹配「店铺币种:」的 div，冒号后文本（如 `CNY`；读不到留空）
  - `semiAuth`：同 td 内「半/全托管：」冒号后文本（如 `已授权半托管` / `未授权`）
  - `authTime`：第 4 个 td 的 `span.vxe-cell--label` 文本
- 解析同时做结构校验：第 2 个 td 文本须匹配 `/^cn\d+/` 或至少非空，否则该行作废并计入 `badRows`（防 vxe 列结构变化后张冠李戴）。
- 表没出现 / 0 行 / 所有行作废 → 返回空数组 + 原因（「授权页未加载出店铺表格」「已授权店铺为 0」等），**不猜**。
- **硬边界：绝不在用户的编辑页上导航。** readShops 的执行标签规则：port 的 tab（`agentTabId || activeTabId`）如果就是采集编辑页（按 R5 的 `crawlEditUrlId` 判定），必须新开标签去授权页、读完关闭；只有 port tab 不是编辑页时才允许直接导航。防止把用户没保存的编辑草稿导航丢。

### R6-2 店铺基线缓存 + 身份接入

- 新增本地缓存文件（`%APPDATA%\sparo-store` 下，如 `dxm-smt-shops.json`）：`{ fetchedAt, shops: ShopInfo[] }`。
- 新增只读工作流 `dxm_smt_shops`（进 `dxm-smt-preview.ts` 白名单）：调 readShops → 写缓存 → 返回店铺列表摘要。语义是「刷新店铺基线」，模型可在侧栏说「刷新店铺基线」时调。
- `resolveIdentity` 接入：页面直读店铺（R5 的 data-shop-id 路径）为空时，查缓存：
  - 缓存有店：身份的 shops 部分来自缓存；`prepare` 新增可选参数 `shopName`，指定后绑定该店（shopId + name）；未指定且缓存多家 → 停等，原因「店铺基线有多家店铺，请指定目标店铺：{名称列表}」——**让用户选，不猜**。缓存仅一家 → 可默认绑定并在返回里注明。
  - 缓存没有：仍停等，原因收敛为一句「店铺来源待基线：先运行 dxm_smt_shops 刷新店铺列表」。
- 工作单创建链路（prepare）在身份完整后照常建单；**写操作停等边界不变**。

### R6-3 停等原因收敛（R5 非阻断观察，顺带）

- `missingShopReason` 的三连拼接收敛成一句人话（编辑页场景：「页面读不到店铺，店铺基线未就绪（先跑 dxm_smt_shops）」）。
- `runProbe` 的停等原因优先级：**blocker（页面分类原因）优先于身份失败**——在非店小秘页面上，用户应先看到「不是店小秘页面」而不是「没有目标店铺」。

### R6-4 测试与夹具

- 新夹具 `tests/fixtures/dxm-auth-shops.html`：vxe-table 结构，3 行**编造**店铺（如「示例店铺A / cn100000000demoa」），含 rowid、col_6~col_10 结构、一条 rowid 为空和一条 aliId 非 cn 开头的坏行。测试断言 fixture 不含真实店铺名（PetLifeGlobal、Charmify、zuhae、sibae、nicae）。
- 新测试 `tests/dxm-smt-r6.test.ts`，至少覆盖：
  1. readShops 解析 3 行好店铺 + 跳过坏行（badRows 计数）。
  2. 表未加载 / 0 行 → 空数组 + 原因。
  3. 缓存读写 + fetchedAt。
  4. 编辑页 + 无缓存 → 停等原因是新的一句话。
  5. 编辑页 + 缓存 3 店 + prepare 无 shopName → 停等并列出店名。
  6. prepare 带 shopName → 身份完整，建单成功（写操作仍停等）。
  7. readShops 在 port tab 为编辑页时开新标签（mock 层断言不导航编辑页）。
  8. 非店小秘页 probe 停等原因 = 页面分类原因（R6-3 回归）。
  9. 停等边界回归：认领 / 保存 / 发布仍拒绝。

## 3. 禁区（不变）

- 一切写操作（claim / writeField / translateText / translateImages / saveDraft / clickPublish / selectCategory）保持停等。
- 不点「保存」「保存并认领」「一键翻译」「重新授权」「修改」「更多」；不碰认领弹窗。
- 不动 `dxmEnabled()`；不提交 Git；不打安装包。
- E1–E12 挂未跑；认领弹窗 DOM 采样留给规划方（需用户当场配合，见第 5 节）。

## 4. 验收标准

- 定向 `tests/dxm-smt-r6.test.ts` 全绿；全量回归无新增失败（`chrome-hole.test.ts:493` 是既有抖动）。
- typecheck / lint（0 error）/ build 通过。
- 完成记录写在 `docs/ECOMMERCE-PHASE1-CURSOR-TASKBOOK.md` 第 8 节「Cursor R6 完成记录」。

## 5. 真机验收（规划方复审时执行）

1. 带 `SPARO_DXM_SMT_PREVIEW=1` 开发版，侧栏说「刷新店铺基线」→ `dxm_smt_shops` 返回 3 家真实店铺并落缓存。
2. 采集编辑页 probe：不再因店铺缺失停等（身份 = URL recordId + 缓存店铺；多店时停等列店名）。
3. prepare 带 shopName「PetLifeGlobal」→ 建单成功，下一步停等在写操作（符合预期）。
4. 认领弹窗采样（**需用户当场授权**）：用户在编辑页点一次「保存并认领」停在弹窗（该动作会先保存草稿到店小秘采集箱，属于真实写，必须用户明确同意），规划方只读采样弹窗 DOM，给 R7 出认领选择器。用户不同意就跳过，挂 R7。
