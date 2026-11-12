# 附录 D：店小秘采集编辑页「保存」接口采样

> 采样时间：2026-11-12（Asia/Shanghai）
> 采样方式：真实编辑页 `https://www.dianxiaomi.com/web/productCrawl/edit?id=167842582606445464`，在页面内挂 XHR hook，**点现有「保存」按钮**，按原值重存。
> 全程未改任何业务字段，未认领，未发布。
> 结论供第二阶段实现消费；Cursor 不得自行再探接口。

## D1. 请求

| 项 | 值 |
|---|---|
| 方法 | `POST` |
| URL | `/api/crawl/updateNew.json`（同源相对路径） |
| Content-Type | `multipart/form-data`（浏览器自动带 boundary） |
| 显式请求头 | 只有 `Accept: application/json, text/plain, */*` |
| 鉴权 | 无 CSRF 头、无自定义 token 头；**只靠登录 cookie**（页面上下文 `fetch` 自动携带） |
| 表单字段 | 只有 1 个：`file` |
| `file` 类型 | `Blob`，`type: "application/zip"`，本次 1553 字节 |
| zip 内容 | 单个条目 `crawlSave.txt`（deflate 压缩），里面是 UTF-8 JSON |

## D2. zip 结构（构造要点）

标准 ZIP 单文件条目，`crawlSave.txt` 使用 deflate：

- Local file header：`PK\x03\x04`，offset 18 起是 compressedSize（4 字节小端），offset 26 是文件名长度，28 是 extra 长度
- 数据区 = `30 + 文件名长度 + extra长度`，长度取 compressedSize
- 之后是 central directory + EOCD（`PK\x01\x02` / `PK\x05\x06`）

页面用 `DecompressionStream("deflate-raw")` 可解；主进程用 `zlib.deflateRawSync` 可以把同样的 zip 造出来。

## D3. 载荷 JSON（13 个字段，全量，不是补丁）

```jsonc
{
  "sourceUrl": "https://detail.1688.com/offer/1053360059482.html?...",  // 原商品链接
  "fullCid": "5054612-",                    // 店小秘分类 id，"-" 结尾
  "spu": "",
  "name": "仓鼠毛发收集器…",                 // 标题（对应 input[placeholder=请填写标题]）
  "instructionUrl": "",
  "imgUrl": "https://…jpg|https://…jpg|…", // 竖线分隔，本次 1359 字符
  "videoUrl": "https://cloud.video.taobao.com/play/…/566872795461.mp4",
  "variant": "[{…},{…},{…}]",               // 字符串化的数组，本次 1625 字符
  "price": "0.47",
  "itemSpecifics": "产地:浙江\n体重:50g\n货号:1007299348\n…",  // 换行分隔的键值
  "detail": "<div id=\"offer-template-0\">&nbsp;</div>…",     // 详情 HTML，本次 1703 字符
  "packageInfo": "{\"weight\":\"0.05\",\"length\":\"\",\"width\":\"\",\"height\":\"\"}", // 字符串化对象，重量单位 kg
  "id": "167842582606445464"                // 记录 id，与 URL 的 ?id= 一致
}
```

### variant 数组元素（每个变种一条）

```jsonc
{
  "id": 0, "puid": null, "productId": 6259648766861, "name": null,
  "imageUrls": "https://…jpg",
  "price": "0.47", "discountPrice": "",
  "sourceCurrency": "CNY", "sourcePrice": "3.2",
  "sourcePriceUsd": "0.47", "sourceDiscountPrice": "", "sourceDiscountPriceUsd": "",
  "quantity": "2000",                       // 库存（对应每行第 6 个 input[placeholder=请输入]）
  "attribute": "{\"Color\":\"仓鼠挂件（可爱腮红款）\"}",  // 字符串化对象
  "uniqueType": null, "uniqueValue": null, "skuId": null, "sortNum": null,
  "title": "", "skuWeight": "", "skuLength": "", "skuWidth": "", "skuHeight": "",
  "updateTime": null, "createTime": null
}
```

## D4. 响应

```json
{"code":0,"msg":"修改成功！","msgCode":null,"data":null}
```

- 成功判据：`code === 0`
- **`data` 恒为 `null`，响应里没有 recordId / productId**。续跑锚点只能用请求里的 `id`（它等于 URL 上的 `?id=`），不能指望回执给。
- 失败结构未采样到（本次只有成功路径）；实现时 `code !== 0` 或 JSON 解析失败一律按 `unknown` 处理，退回点按钮。

## D5. 对实现的硬约束

1. **必须全量提交**：服务端按整对象覆盖，`imgUrl` / `videoUrl` / `detail` / `itemSpecifics` / `packageInfo` / `variant` 都要带。只发改动字段会把其余字段写空或报错。
   → 所以接口化保存的正确姿势是：**先从页面读出当前完整状态 → 只改要改的 3 项 → 整份提交**。不能凭空拼载荷。
2. **鉴权只在 cookie**：必须在该标签的页面上下文里发（`fetch("/api/crawl/updateNew.json", …)`），主进程直接发 HTTP 拿不到 cookie。
3. **`id` 必须来自当前页**，不许从上一次记录沿用（否则把 A 商品写到 B 上）。
4. **成功只认 `code === 0`**；不要用 `msg` 做判断，也不要把 HTTP 200 当成功。
5. **失败要能退回**：接口 4xx / 5xx / 解析失败 / `code !== 0` → 记降级原因，退回「点 `button.btn-orange` 保存 + reload 回读」。
6. **不改字段顺序以外的语义**：`variant`、`packageInfo`、`attribute` 都是**字符串化的 JSON**，读出来要原样回填，不要二次解析再序列化（键序变化也可能被服务端判为脏数据）。

## D6. 与判重接口的关系

判重走 `/api/smtProduct/pageList.json`（`src/main/workflows/dxm-smt-api.ts`），保存走 `/api/crawl/updateNew.json`，两者参数完全不同，**不能互相套用**。
