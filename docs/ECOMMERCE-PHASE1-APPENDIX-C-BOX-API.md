# 附录 C 采样：采集箱列表接口（R11）

> 采样人：规划窗口（本窗口）。只读采样：只发列表查询请求，不改任何草稿，不点行内操作。
> 采样环境：商店版 Sparo（0.4.0）窗口可见，已登录店小秘，`tabId` 定向执行。
> 真实标题、店铺 ID 一律脱敏为 `<existingTitle>` / `<shopId>`。

---

## 1. 端点

| 项 | 值 |
|---|---|
| 方法 | **POST** |
| 路径 | `/api/smtProduct/pageList.json` |
| 完整地址 | `https://www.dianxiaomi.com/api/smtProduct/pageList.json` |
| 同源 | 是（采集箱页所在域） |
| 页面入口 | `https://www.dianxiaomi.com/web/smt/smtProductList/draft` |

## 2. 参数

`Content-Type: application/x-www-form-urlencoded`，表单字段：

| 参数 | 示例 | 含义 |
|---|---|---|
| `pageNo` | `1` | 页码，从 1 开始 |
| `pageSize` | `100` | 每页条数，实测 100 可用 |
| `total` | `0` | 前端固定传 0，服务端不依赖 |
| `searchType` | `0` | **0 = 按标题（subject）包含匹配**；1、2 用标题试过无结果，语义未定，Part B 只用 0 |
| `searchValue` | `<existingTitle>` | 搜索词。**服务端不 trim**，调用方必须先 trim |
| `shopId` | `-1` | `-1` = 全部店铺；传具体 ID 只查该店 |
| `dxmState` | `draft` | 只查采集箱草稿 |
| `dxmOfflineState` | 空 | 留空 |

## 3. 请求头

- 只需登录 Cookie（页面同源 `fetch` 自带，`credentials: include`）。
- **未发现 CSRF token、自定义签名头或 Referer 校验**：页面内直接 POST 成功。
- `Content-Type` 必须是 `application/x-www-form-urlencoded; charset=UTF-8`。

## 4. 响应字段

顶层：

```json
{ "code": 0, "msg": "Successful", "msgCode": null, "data": { "page": { }, "productParam": { } } }
```

`code === 0` 为成功。列表在 **`data.page`**：

| 字段 | 类型 | 说明 |
|---|---|---|
| `data.page.list` | array | 行数组 |
| `data.page.totalSize` | number | **总条数**（判重的 total 用这个） |
| `data.page.totalPage` | number | 总页数 |
| `data.page.pageNo` | number | 当前页 |
| `data.page.pageSize` | number | 每页条数 |

行内关键字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `subject` | string | **标题（不是 `title`）**，判重比对用这个 |
| `puid` | number | 行内产品标识 |
| `id` | number | 行 ID（同页多行可能出现相同值，**不要拿它当唯一键**） |
| `productId` | null / string | 草稿阶段为 `null`，**判重不能依赖它** |
| `shopId` | number | 所属店铺 |
| `dxmState` | string | 草稿为 `"draft"` |

回显：`data.productParam.searchValue` 原样回显本次查询词（含前后空格），可作「过滤已生效」的证据；**没有 `echoTitle` 字段**。

## 5. 三种边界响应

1. **空结果**（肯定不存在的标题）：

```json
{"code":0,"msg":"Successful","data":{"page":{"list":[],"pageNo":1,"totalPage":1,"pageSize":100,"totalSize":0}}}
```

2. **超过一页**（不带搜索词，全量）：

```json
{"code":0,"msg":"Successful","data":{"page":{"list":[...100 行],"pageNo":1,"totalPage":2,"pageSize":100,"totalSize":136}}}
```

第 2 页：`pageNo=2` → 返回 36 行，`totalSize` 仍为 136。

3. **鉴权失效**：**本次未采**。不主动登出，避免影响登录态。Part B 口径：非 200、`code !== 0`、或响应不是 JSON，一律判 `unknown`，不得判 `absent`。

## 6. 双向验证结论

| 用例 | 查询 | 结果 |
|---|---|---|
| 现存标题精确查 | `<existingTitle>` | `totalSize=1`，行内 `subject` 与查询**完全一致** |
| 现存标题子串查 | `<existingTitle>` 前 6 字 | `totalSize=1`，证明是**包含匹配** |
| 肯定不存在 | `zzzz不存在标题QA917` | `totalSize=0` |
| 前后加空格 | `  <existingTitle> ` | `totalSize=0`，证明**服务端不 trim** |
| 目标句 | `挂腰风扇`（页面搜索框实测） | `totalSize=0`，与人工只读核对一致 |
| 数字串 | `7107102`（searchType=0 和 1） | 均为 `0`，**不按商品 ID 匹配** |
| 店铺过滤 | `shopId=<shopId>` | `totalSize=57`（全量为 136） |

**结论：过滤参数可用，且能双向证伪。** 判 `absent` 的前提：`code=0`、`data.page.list` 是数组、`totalSize` 为整数、已读行数盖住 `totalSize`、且标题精确比对无命中；缺一条判 `unknown`。

## 7. 采样时间

2026-11-10，商店版 Sparo 0.4.0，窗口可见，已登录店小秘。

---

## 附：对 Part A 契约的三处修正（Part B 前必须改）

采样结果与 `src/main/workflows/dxm-smt-api.ts` 当前假设不一致：

| 项 | Part A 现状 | 真实接口 |
|---|---|---|
| 列表路径 | `json.list` | `data.page.list` |
| 总数路径 | `json.total` | `data.page.totalSize` |
| 标题字段 | `list[].title` | `list[].subject` |
| 回显字段 | `json.echoTitle` | `data.productParam.searchValue` |
| 请求 | GET（未拼参数） | POST + `x-www-form-urlencoded` + 上表参数 |
| 搜索词 | 原样 | 必须 `trim()`，服务端不 trim |

其余边界（`absent` 四道门、过滤证明、全量翻页兜底）与 Part A 设计一致，不用改。

---

**是否足以支撑 Part B：足以。** 端点、方法、参数、响应路径、标题字段、双向验证、分页边界都已采到；唯一缺口是鉴权失效响应未采，已给出 `unknown` 兜底口径。Part B 动工前先按上表修正 Part A 的解析契约，再接线。
