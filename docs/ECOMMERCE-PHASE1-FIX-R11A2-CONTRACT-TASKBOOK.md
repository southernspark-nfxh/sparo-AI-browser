# 任务书：R11-A2 采集箱接口契约修正

> 依据：[附录 C 采样](./ECOMMERCE-PHASE1-APPENDIX-C-BOX-API.md)（commit `f633f53`）。
> 范围：只修 `dxm-smt-api.ts` 的契约层，**不接运行路径、不动 `lookupDraft`**。Part B 等本单全绿后另放行。

---

## 一、为什么要单开一单

规划窗口已用当前解析器跑过真实响应（临时测试，已删除）：

| 输入 | 结果 |
|---|---|
| 真实响应 `data.page.list[].subject` / `data.page.totalSize` | `httpOk=true`，`shapeOk=false` → `unknown` |
| 原假设 `json.list[].title` / `json.total` | `shapeOk=true`，命中行返回 `ambiguous` |

结论：**四道门的逻辑没问题，错在字段路径和请求拼装**。不改，Part B 接上去会永远 `unknown`。

---

## 二、要改的五处

### A2-1 端点常量（`dxm-smt-api.ts` L6）

```ts
export const BOX_API_ENDPOINT = "/api/smtProduct/pageList.json";
```

- 相对路径，页面同源调用。
- **仍然不许**接入 `lookupDraft`、`browser.ts`、`mcp-server.ts`、任何运行路径。改完只有测试会引用它。

### A2-2 新增请求体构造函数

```ts
export function buildBoxListBody(query: BoxApiQuery): string
```

- 字段顺序固定：`pageNo`、`pageSize`、`total=0`、`searchType=0`、`searchValue`、`shopId`、`dxmState=draft`、`dxmOfflineState=`（空串保留）。
- `searchValue = (query.title ?? "").trim()`：**必须 trim**，服务端实测不 trim，带空格查询会返回 0。
- `shopId = (query.shopId ?? "").trim() || "-1"`。
- `pageNo = query.page ?? 1`，`pageSize = query.pageSize ?? BOX_API_PAGE_SIZE`。
- 返回 `URLSearchParams.toString()`，不要手拼字符串。

### A2-3 改写 `boxApiScript`（L38–55）

- `method: "POST"`，`credentials: "same-origin"`。
- 头：`Content-Type: application/x-www-form-urlencoded; charset=UTF-8`。
- `body` 用 `buildBoxListBody(query)` 的返回值。
- 加 `AbortController`，单页超时 8 秒；中止或网络失败一律返回 `{ status: 0, ok: false, json: null }`。
- 空端点时仍直接返回失败，不发请求（保留现有短路）。
- 返回值形状不变：`{ status, ok, json }`。

### A2-4 改写 `parseBoxApiPage`（L58–89）

只认真实路径，认不出就 `shapeOk: false`，继续不猜字段：

| 项 | 新口径 |
|---|---|
| 成功码 | `json.code === 0`，否则 `shapeOk: false` |
| 总数 | `json.data.page.totalSize`，必须是 ≥0 的整数 |
| 列表 | `json.data.page.list`，必须是数组，且 `list.length <= totalSize` |
| 标题 | 行内 **`subject`**，必须是非空字符串（trim 后） |
| 商品 ID | 行内 `productId` 为字符串则取，`null` 或其它一律 `""` |
| 回显 | `json.data.productParam.searchValue`，字符串则取，否则 `""` |

- `BoxApiPage` 的 `total / rows / echoTitle / httpOk / shapeOk` 字段名不变，避免牵动判定逻辑。
- `decideBoxLookup`、`boxApiFilterProven`、`boxApiVerdict`、`collectBoxApiVerdict`、`readPages` **一行不改**。

### A2-5 超时/预算文案

现在预算耗尽复用了「没有返回 200」的文案，会误导。要求：

- `BoxApiPage` 增加可选 `timedOut?: boolean`。
- `loadPage` 里因 `Date.now() > deadline` 提前返回时置 `timedOut: true`。
- `pageFailure` 优先判断 `timedOut`，文案改为「采集箱接口预算内没读完，无法判重」。
- 其它失败文案保持原样。

---

## 三、测试要求（改 `tests/dxm-smt-r11.test.ts`）

现有 28 项里凡是用 `json.list/title` 造数据的，全部换成真实形状；断言不许放宽。至少覆盖：

1. `buildBoxListBody`：默认 `shopId=-1`、`searchType=0`、`dxmState=draft`；标题前后空格被 trim；`pageNo/pageSize` 可覆盖。
2. `boxApiScript`：含 `POST`、`x-www-form-urlencoded`、`AbortController`，body 里是 trim 后的查询词。
3. 真实全量响应（136 条、第一页 100 行）→ `total=136`、`rows.length=100`、`shapeOk=true`。
4. 真实空结果（`totalSize=0`、`list=[]`）→ 配合回显可判 `absent`。
5. 回显取自 `data.productParam.searchValue`，不是 `echoTitle`。
6. 行内 `productId: null` → `""`。
7. `code !== 0` → `shapeOk=false`。
8. 行内缺 `subject` 或 `subject` 为空 → `shapeOk=false`。
9. **旧形状（顶层 `list/title`）→ `shapeOk=false`**，作为回归锁，防止以后改回去。
10. 第 2 页 36 行 + 首页 100 行 → `total` 一致，流程不误判。
11. 命中标题时结果仍是 `ambiguous`（`found` 属于后续版本，本单不许顺手改）。
12. 预算耗尽 → 文案是「预算内没读完」，不是「没有返回 200」。

---

## 四、白名单

只许改：

- `src/main/workflows/dxm-smt-api.ts`
- `tests/dxm-smt-r11.test.ts`

只许追加记录：

- `docs/ECOMMERCE-PHASE1-FIX-R11-CURSOR-TASKBOOK.md` 末尾「完成记录」，注明 A2。

**不许动**：`dxm-smt-box.ts`、`dxm-smt-listing.ts`、`browser.ts`、`mcp-server.ts`、`tools/index.ts`、`lookupDraft`、`.workbuddy/`。

---

## 五、红线

- 不许接真实接口，不许发真请求，不许跑真机。
- 不许猜 `searchType=1/2` 的语义，只用 0。
- 不许拿 `productId` 判重（草稿为 `null`）。
- 不许假设服务端会 trim。
- 不许把 `lookupDraft` 改成走接口（Part B 才做）。
- 不许改版本号、不许打包、不许合并别的分支。

---

## 六、验收

按顺序全过才算完：

```text
npx vitest run tests/dxm-smt-r11.test.ts tests/dxm-smt-r10.test.ts tests/dxm-smt-r9b.test.ts tests/dxm-smt-r7.test.ts
npm test
npm run typecheck
npm run lint
npm run build
```

- 定向 4 文件全绿；全量 120 文件全绿；typecheck 0；lint 0 error；build 通过。
- 交证据：命令、通过数、`out/main/index.js` 体积、`git status --short`。
- 一个 commit，提交信息：`fix(dxm): R11-A2 按实测响应修正采集箱接口契约`。

---

## 七、Part B 放行条件

本单合并后，Part B 才动 `lookupDraft`：

- 用 `collectBoxApiVerdict` 替换页面读表判重；
- 真实 `fetchPage` 走 `boxApiScript` + `execute`；
- 保留 R7 口径：读不到一律 `unknown`，不得判 `absent`；
- 先拿「已知存在」和「已知不存在」各一条真机双向验证，再谈合入。

Part B 的具体步骤沿用 [R11 任务书](./ECOMMERCE-PHASE1-FIX-R11-CURSOR-TASKBOOK.md) 的 Part B 段，不另开新单。
