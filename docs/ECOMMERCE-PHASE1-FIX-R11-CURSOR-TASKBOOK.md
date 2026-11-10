# 电商一期 R11 任务书（Cursor 执行）：判重数据源接口化（方案 B）

> 前置：R10 稳定窗已复审通过（单测全绿），但**真机验收 0/6 未通过**，根因见 R10 任务书 §7。本轮只做一件事：**把判重的数据来源从「读表体 DOM」换成「读采集箱列表接口」**，让判重不再依赖页面渲染，窗口最小化也能跑。
> 写字段、翻译、保存、发布、选分类继续停等，一个都不放开。认领（R9-4）不归本轮。
> **本轮分两段：Part A 现在就能开工；Part B 必须等规划方书面放行（附录 C 采样完成后）才许动。**

## 0. 现场状态与多窗口边界（**动工前必读，越界即返工**）

### 0.1 2026-11-09 19:10 规划方核实

- HEAD `fa7394d`（文档提交）。工作区有**两拨未提交改动**，来源不同：
  1. **R10 本轮成果**：`dxm-smt-box.ts` +31、`dxm-smt-live.ts` +77/−17、`tests/dxm-smt-r7.test.ts`、`tests/dxm-smt-r9b.test.ts`、`tests/dxm-smt-r10.test.ts`（新）、`docs/DECISION-POINTS.md`、`docs/ECOMMERCE-PHASE1-CURSOR-TASKBOOK.md`。
  2. **另一个窗口的 tabId 线程化**：`src/main/mcp-server.ts` +38、`src/main/tools/index.ts` +23（给 execute/select/upload/click_text/menu_click 加 `tabId` 参数）。`browser.ts` 里 `execute(script, opts?: { frame?, tabId? })`、`select(..., tabId?)`、`upload(..., tabId?)` 在 HEAD 里本来就有。
- 结论：**当前是「多个窗口同时改同一个工作区」的状态**。R11 必须按下面的白名单动手术，不许碰别人的地盘。

### 0.2 R11 文件白名单

**允许新建**

- `src/main/workflows/dxm-smt-api.ts`（新模块：接口契约 + 页面上下文 fetch 脚本 + 解析纯函数）
- `tests/dxm-smt-api.test.ts`、`tests/dxm-smt-r11.test.ts`

**允许改（改前先读当前内容，只做增量，不许整文件重排）**

- `src/main/workflows/dxm-smt-box.ts`：只许**追加**新常量/新纯函数，`decideBoxLookup`、`sameBoxRead`、`advanceBoxWindow`、`assessBoxLoad`、`boxPollExhausted`、`lookupFromLoad` 的签名与语义一字不改。
- `src/main/workflows/dxm-smt-live.ts`：Part B 才动，且只动 `lookupDraft` / `searchBox` / `pollBox` 的调用关系。

**禁止碰（别人正在改，或属于规划方）**

- `src/main/browser.ts`（任何一行都不要动；#48 激活时序原样）
- `src/main/mcp-server.ts`、`src/main/tools/index.ts`（tabId 线程化窗口的地盘）
- `docs/DECISION-POINTS.md`（决策点由规划方登记；你只需在完成记录里引用编号）
- `docs/listings/`、`src/main/workflows/dxm-smt-claim.ts`、`dxm-smt-listing.ts`、`dxm-smt-fields.ts`

### 0.3 多窗口纪律（违反任何一条 = 直接返工，不接受辩解）

1. 动工前先跑 `git status --short`，把输出**原样**贴进完成记录开头。
2. **不许** `git stash` / `git checkout -- .` / `git reset` / `git clean` / 切分支。工作区里有别人的未提交改动，这几条命令会静默毁掉别人的活儿。
3. **不许**整文件格式化、不许调整 import 顺序、不许改无关行的缩进。只改自己的行，diff 必须干净到能一行行读。
4. 收工时 `git diff --stat` 里**只允许出现 0.2 白名单里的文件**。出现别的文件 → 停下，报告，不许自己回滚。
5. 不提交 Git、不打安装包、不跑真机（真机验收是规划方环节）。

## 1. 问题定义（为什么必须换数据源）

R10 真机 0/6 的三条实证（R10 任务书 §7.2）：

1. 窗口最小化时，采集箱页面 30 秒内**只下载静态 JS，一个列表数据请求都没发**——表体 0 行不是渲染慢，是页面根本没取数。
2. 激活标签、`setBackgroundThrottling(false)` 两种补救全部无效（spike 已被规划方还原）。
3. 唯一稳定的结论：**vxe 表体只在「页面可见 + 有数据」时存在**。DOM 判重与「Sparo 后台跑」的产品设计根本冲突，靠加预算/加稳定窗都救不了。

反过来看：**网络请求和渲染是两件事**。页面只要还在（标签不被销毁），页面上下文的 `fetch` 就能带 cookie 正常发请求，跟窗口是否可见、表格画没画出来完全无关。所以判重改成「页面上下文 fetch 列表接口 → 解析 JSON → 本地精确比对标题」，一条链路上没有任何渲染依赖。

## 2. 方案

### 2.1 数据在哪执行（关键设计）

- **优先在「当前编辑页标签」上执行 fetch**（同源 `www.dianxiaomi.com`，cookie 自动带上），**不开新标签、不切活动标签**——这样 R9-6 那个「标签闪一下」的毛病在正常路径上直接消失。
- 若附录 C 采样发现接口在**另一个域名**（跨源），则退一步：开一个采集箱标签只做 fetch（不 `activateTab`，不要求可见），读完关掉。**任何情况下都不许再为了判重去激活标签。**
- fetch 只在页面上下文里跑，不在主进程跑（主进程没有登录态 cookie）。

### 2.2 Part A（现在就能开工，不依赖采样）

新建 `src/main/workflows/dxm-smt-api.ts`，只做「契约 + 解析 + 安全语义」，全部可离线测试：

1. 类型：`BoxApiQuery`（标题 / 店铺 / 页码 / 每页条数 / 是否只搜草稿）、`BoxApiPage`（`total`、`rows: BoxRow[]`、`echoTitle`、`httpOk`、`shapeOk`）。
2. `boxApiScript(query)`：生成在页面上下文执行的 fetch 脚本，返回 `{ status, ok, json }`，脚本里不写死任何业务判断。
3. `parseBoxApiPage(raw)`：**纯函数**，把任意 JSON 映射成 `BoxApiPage`。结构不认识时返回 `shapeOk: false`，不许抛异常，不许猜字段。
4. `boxApiVerdict(pages)`：**纯函数**，把「翻完的若干页」判成 `DraftLookup`，规则见 §3。
5. `BOX_API_BUDGET_MS`（建议 20s）与 `BOX_API_PAGE_SIZE`（默认 100）常量。

Part A 交付时**还不接进 `lookupDraft`**（接口地址未采样，接进去也跑不通），只保证编译、单测、类型正确。这样采样和写代码可以并行，不互相堵。

### 2.3 Part B（**规划方书面放行后**才开工）

1. 填入附录 C 采到的真实端点、方法、参数名、必需请求头（含 CSRF 位置）；字段映射按采样结果填，**映射表要写在代码注释里并标注采样日期**。
2. `lookupDraft` 改成：**先接口、后 DOM**。
   - 接口给出 `absent` / `ambiguous` → 直接返回，不再开标签。
   - 接口明确失败（端点 404/401、结构不认识、超时）→ **降级到现有 DOM 路径（R10 稳定窗，原样保留）**，此时才允许开标签/激活；DOM 路径结论照旧。
   - 两条都失败 → `unknown` 停等，reason 分别写清是哪条路失败。
3. journal evidence 必须新增 `source: "api" | "dom"`，让人能一眼看出这条结论是谁给的。没有这个字段的结论视为不可审计。
4. 保留 `decideBoxLookup` 不动：接口路径把「页数据」拼成 `{ loaded, rows }` 后**仍然交给它判**，保证判定语义与现在逐字一致。

## 3. 安全语义：`absent` 三重门（**本轮最重要的一条**）

`absent` 意味着「采集箱里没有这个标题的草稿」，它会放行到认领门。**判错一次就是重复上架事故**。所以接口路径要判 `absent`，必须同时满足：

1. **HTTP 200**（`response.ok` 且 `status === 200`）；
2. **结构可识别**：能取到 `total`（数字）和行数组，每行能取到标题字符串；`shapeOk === true`；
3. **覆盖完整**：`total <= 已读行数`，也就是**翻页翻到了底**。第一页 100 条、`total` 136 条就判 `absent`，等于把剩下 36 条当不存在——**绝对禁止**。

另外两条硬规矩：

4. **过滤必须被证明生效**：如果请求带了标题参数，响应里要能证明服务端认了这个参数（回显查询词、或 `total` 明显小于全量）。证明不了，就**必须翻页读全量再本地精确比对**，不许偷懒只看第一页。
5. **接口给的 `absent` 只在「服务端返回 0 条且过滤已证明生效」时成立**；其余一切情况（超时、4xx、5xx、JSON 解析失败、字段缺失、翻页中任意一页失败）→ `unknown` 停等，reason **不得带 absent 语义**（照 #45 的精神）。

> 换句话说：接口路径只许「敢说没有」，不许「猜没有」。说不准就停等人。

## 4. 测试（新增，夹具全部编造，断言里不许出现真实标题/店铺/商品 ID）

Part A 就能写的：

1. `parseBoxApiPage`：正常页 / 空列表 / `total` 大于本页行数 / 行里缺标题 / `list` 不是数组 / JSON 是 `null` —— 后三种必须 `shapeOk: false` 且不抛。
2. `boxApiVerdict` 三重门：非 200 → `unknown`；`shapeOk: false` → `unknown`；`total` 250 只读了 100 行 → `unknown`（禁止 absent）。
3. 翻页覆盖：`total` 250、每页 100 → 必须请求 3 页；fake surface 计数少一页即 `unknown`。
4. 过滤生效：响应没有回显查询词且 `total` 等于全量 → 不许直接 absent，必须走全量翻页路径。
5. 空箱合法路径：`total: 0` + 200 + 结构正确 → `absent`（不能把正常空箱误伤成 unknown）。
6. 标题精确比对：返回行里有「近似但不等」的标题（多空格、括号注记、大小写不同）→ 按现有 `decideBoxLookup` 语义处理，不许放宽成模糊匹配。

Part B 才写的：

7. `lookupDraft` 走接口时**零次** `openTab` / `activateTab` 调用（fake surface 计数断言为 0）。
8. 接口失败 → 降级 DOM 路径被调用一次，且最终结论 `unknown` 时 reason 能区分两条路。

回归（每轮都必须报）：

9. `decideBoxLookup` 语义未变；R7 / R9B / R10 既有测试**断言不许改**（如需改动，写明理由并单独报告，不许悄悄放宽）。
10. 认领、写字段、翻译、保存、发布、选分类仍是拒绝路径；无 claimConsent 零点击。

## 5. 禁区

- 不许改 `browser.ts`、`mcp-server.ts`、`tools/index.ts`（别的窗口在改）。
- 不许为了「让判重能跑」而放宽 `absent` 条件、增加模糊匹配、或给 DOM 路径加新预算。
- 不许在正常路径上开/激活采集箱标签（Part B 之后，这是硬指标）。
- 不许把接口返回的原始 JSON 整段落进 journal（可能含店铺/标题等业务数据）；evidence 只记 `source`、`httpOk`、`total`、`rows` 条数、是否翻到底。
- 不许提交 Git、不许打安装包、不许跑真机；`docs/listings/` 不动。
- 不许在完成记录里写「判重已修好」——真机复验是规划方环节。

## 6. 验收标准（规划方复审）

- 上述定向测试全绿；全量回归无新增失败（当前基线 119 文件 / 890 项，机器负载下 mission-journal / chrome-hole 偶发超时属既有慢测试，需单独复跑确认）；`typecheck` / `lint`（0 error）/ `build` 通过。
- `git diff --stat` 只出现白名单文件。
- 完成记录写进 `docs/ECOMMERCE-PHASE1-CURSOR-TASKBOOK.md`「Cursor R11 完成记录」：改了哪些文件、行数、测试数、Part A/B 分别做到哪一步。

## 7. 真机验收（规划方执行，Cursor 不执行）

前置：**附录 C 采样完成 + Part B 合码**。验收时**窗口保持最小化**（这是方案 B 要解决的核心场景，不许靠切窗口过关）。

1. absent 场景（采集箱 136 条、目标标题不存在）连跑 ≥3 轮：全部 `absent`，`evidence.source = "api"`，零次开标签/切标签。
2. ambiguous 场景（目标标题存在）连跑 ≥3 轮：全部 `ambiguous`，不误判 absent。
3. 判重全过程：标签栏无闪切、活动标签不变、窗口不抢前台（#48 回归）。
4. 断网/接口改地址模拟：一次故意让接口失败，确认降级 DOM 路径被触发且结论为 `unknown`（**不许 absent**）。
5. 全过后：清 L201/L222 两行日志 → 全量回归 → 整理 commit（等用户点头）→ 进入 R9-4 认领收尾（需用户当场授权）。

## 8. 附录 C：采集箱列表接口采样规程（规划方执行，Cursor 只消费结论）

产物落到 `docs/ECOMMERCE-PHASE1-APPENDIX-C-BOX-API.md`。**采样未完成，Part B 不放行。**

### C.0 前置与纪律

- 采样要真实请求，需要登录态；优先在**窗口可见**时采（这一步的可见性不影响方案 B 的结论，只影响采样手段）。
- 采样依赖「在指定标签上执行脚本」的能力，即 `mcp-server` 的 `tabId` 线程化改动落地（另一个窗口在做）。**该改动未落地前采样会打错标签**（R10 期间已踩过），不要硬采。
- 采样只读：不发写请求、不改任何业务数据、不点页面按钮。

### C.1 路线一：从已加载页面里捞请求地址

1. 打开采集箱页，等表体出数据（窗口可见）。
2. 在页面上下文读 `performance.getEntriesByType("resource")`，筛出含 `smt` / `draft` / `list` 的条目，取回完整 URL + initiator。
3. 记录：方法（GET/POST）、路径、查询串参数名、是否有 `page`/`pageSize`/`total` 语义。

### C.2 路线二：直接试探（路线一拿不到参数时）

- 用页面上下文 `fetch` 试探候选路径与参数名（`title` / `keyword` / `searchTitle` 等），只发**读**请求。
- 每次只改一个变量，记录「200 且 total 变化」还是「200 但结果不变（参数没生效）」还是「4xx/5xx」。

### C.3 必须采到的六件事（缺一条 Part B 不开工）

1. **端点**：完整 path（含前缀），GET 还是 POST。
2. **参数**：分页参数名、标题参数名、店铺参数名（如果有）、状态参数（只搜草稿）。
3. **请求头**：是否需要 CSRF / referer / 自定义 token；token 从哪拿（meta 标签、cookie、全局变量）。
4. **响应形状**：`total` 字段路径、行数组字段路径、行内标题字段、行内商品 ID 字段。文档里只写**字段名和类型**，真实值一律脱敏（`<title>`、`<shopId>`）。
5. **过滤生效双向验证**：用一条**现存**草稿的标题查 → 必须能查到；用一条**肯定不存在**的标题查 → 必须 `total: 0`。两条都成立才算「过滤参数可用」；只成立一条就记「参数语义不明」，Part B 走全量翻页。
6. **边界形状**：空结果、`total` 超过一页、鉴权失效（未登录时返回什么）三种响应各记一份（同样脱敏）。

### C.4 采样产出格式

按「端点 / 参数 / 请求头 / 响应字段 / 三种边界响应 / 双向验证结论 / 采样时间」七段写，末尾附一句「本次采样是否足以支撑 Part B」。**不足以支撑就明写不足以**，不许凑。

## 9. 完成记录位置

`docs/ECOMMERCE-PHASE1-CURSOR-TASKBOOK.md` 末尾追加「Cursor R11 完成记录」。开头必须贴动工前的 `git status --short` 原文。

## 10. 后续（2026-11-10）

- 附录 C 已采完：[ECOMMERCE-PHASE1-APPENDIX-C-BOX-API.md](./ECOMMERCE-PHASE1-APPENDIX-C-BOX-API.md)（commit `f633f53`）。
- 实测响应与 Part A 契约不符，先做 [R11-A2 契约修正](./ECOMMERCE-PHASE1-FIX-R11A2-CONTRACT-TASKBOOK.md)，全绿后才放 Part B。
- Part B 步骤仍以本文 Part B 段为准。

## 11. Part B 执行细则（规划方 2026-11-10 放行）

放行依据：A2 已在 `5c9e08e` 复核通过（定向 4 文件 32 项、全量 120 文件、typecheck 0）。本段把 Part B 的接法钉死，执行方按本段做，不再自己设计。

### 11.1 只加一条链路

`lookupDraft` 拆成两个内部函数：

- `lookupViaApi(surface, input, title, home)`：新链路，失败返回 `undefined` 表示降级；
- `lookupViaDom(surface, input, title)`：**现有实现整体搬进去，逻辑一字不改**（含 openTab / activateTab / pollBox / searchBox / finally 关标签）。

主流程顺序：暂停检查 → `recordId/shopId` 完整性 → **接口** → 失败才 **页面**。前两步保持原样。

### 11.2 在哪个标签上发请求

- `home = input.tabId || surface.tabId`，直接 `surface.execute(script, home)`。
- 前置校验：`new URL(surface.getUrl(home)).hostname === "www.dianxiaomi.com"`（用 URL 解析，不许用 `includes` 判断域名）。不满足 → 跳过接口，直接页面路径，`source` 记 `"dom"`。
- 标题 trim 后为空 → 不发请求，直接页面路径（页面给「编辑页读不到标题」）。
- 接口路径上**零** `openTab` / `activateTab` / `navigate` / `closeTab`。

### 11.3 查询参数

- `title`：trim 后的标题；`pageSize = BOX_API_PAGE_SIZE`。
- **不传 `shopId`**：保持全箱比对，和 `decideBoxLookup` 现在「不按店铺过滤」的口径一致。
- 不传 `draftsOnly`：`buildBoxListBody` 已固定 `dxmState=draft`、`searchType=0`。

### 11.4 fetchPage 适配

```ts
function apiFetcher(surface: DxmSmtLiveSurface, tabId: string) {
  return async (query: BoxApiQuery) => {
    const out = await surface.execute(boxApiScript(query), tabId);
    return out.data?.result;
  };
}
```

调用 `collectBoxApiVerdict({ title, pageSize: BOX_API_PAGE_SIZE }, apiFetcher(surface, home))`。

### 11.5 谁说了算

- 接口 `absent` / `ambiguous`（`found` 本版不会出现）→ **直接返回**，不碰页面路径。
- 接口 `unknown` → **降级页面路径一次**，不重试接口。
- 两条都 unknown → 最终 reason 写成 `接口：<接口原因>；页面：<页面原因>`，两段原样保留，总长不超过 200 字；不许出现 absent 语义。
- 返回对象带 `source: "api" | "dom"`：内部类型 `DraftLookup & { source: "api" | "dom" }`，出口 `as DraftLookup`。**不许改** `dxm-smt-listing.ts` 里的 `DraftLookup` 定义（白名单外）。`source` 只进 evidence，不参与判定。

### 11.6 白名单

- 改：`src/main/workflows/dxm-smt-live.ts`（只动 `lookupDraft` 拆分 + 新增 `lookupViaApi` / `lookupViaDom` / `apiFetcher`）
- 新建：`tests/dxm-smt-r11b.test.ts`
- 只许追加：本文末「Part B 完成记录」
- 不许动：`dxm-smt-api.ts`、`dxm-smt-box.ts`、`dxm-smt-listing.ts`、`dxm-smt-contract.ts`、`browser.ts`、`mcp-server.ts`、`tools/index.ts`、`docs/DECISION-POINTS.md`、`.workbuddy/`

### 11.7 测试（`tests/dxm-smt-r11b.test.ts`，夹具编造）

1. 编辑页 + 接口 `absent` → 返回 `absent`，`source: "api"`，fake surface 的 `openTab` / `activateTab` / `navigate` / `closeTab` 计数全为 0。
2. 接口 `ambiguous` → 同上，reason 含「标题精确匹配」。
3. 接口 404 → 页面路径被调用一次（计数 1），结论与单独跑页面路径一致，`source: "dom"`。
4. 两条都 unknown → reason 同时含「接口」和「页面」，且不含 absent 语义。
5. host 不是 `www.dianxiaomi.com` → `execute` 收到的脚本里从不出现 `pageList.json`，走页面路径。
6. 暂停 / 缺 `recordId` / 缺 `shopId` → 原样 unknown，surface 调用 0 次。
7. 标题 trim 后为空 → 不发接口，页面返回「编辑页读不到标题」。
8. `JSON.parse(JSON.stringify(result)).source` 仍是 `"api"` / `"dom"`（evidence 可序列化）。
9. 既有 R7 / R9B / R10 / R11 测试断言一字不改。

### 11.8 真机双向验证归规划方

执行方**不跑真机**，只交离线证据。规划方拿到代码后验四条：

1. 现存草稿标题 → `ambiguous`；
2. 编造的标题 → `absent`；
3. 窗口最小化重复 1、2 → 结论不变（证明不依赖渲染）；
4. 断网或登录失效 → `unknown`，且文案能区分接口失败与页面失败。

零 `openTab` / 零 `activateTab` 由运行日志核对。

### 11.9 验收

```text
npx vitest run tests/dxm-smt-r11b.test.ts tests/dxm-smt-r11.test.ts tests/dxm-smt-r10.test.ts tests/dxm-smt-r9b.test.ts tests/dxm-smt-r7.test.ts
npm test
npm run typecheck
npm run lint
npm run build
```

- 定向 5 文件全绿；全量无新增失败；typecheck 0；lint 0 error；build 通过。
- 交证据：命令、通过数、`git status --short`。
- 一个 commit：`feat(dxm): R11-B 判重改走采集箱接口，页面读表降级`。

