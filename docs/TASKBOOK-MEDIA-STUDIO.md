# 媒体工作台 · 任务书（P0a → P3）

> 执行对象：Cursor。**按段交付，一段一 commit，回绿再下一段，不要一次全做完。**
>
> 仓库根：`d:\download\sparo上架应用商店版`
> 产品书：`d:\download\sparo上架应用商店版\docs\MEDIA-STUDIO-PRODUCT.md`
> 现有发布链路：`d:\download\sparo上架应用商店版\strategies\skills\social-media-publish\`
> 数据目录：`%APPDATA%\sparo-store`
>
> **分期、禁止项、验收以本任务书为准；指标口径、红线、对象字段以产品书第 6、7、8、12、16.1 节为准。** 其余未写明的，按「最小改动、不新增抽象」处理。

---

## 0. 全局红线（每段都适用）

1. **不改** `d:\download\sparo上架应用商店版\docs\listings\`；**不碰**线上环境。
2. **不改** `package.json` 的 `version`；**不推**远程，除非用户另行明说。
3. 发布提交必须由平台页面发起；不在 Node 侧伪造签名、不存 `Acs-Token` / `tt-anti-token`。
4. 数据采集只发 GET，不点任何按钮，不触发状态变更。
5. 工作台**没有发送按钮**：发布要人确认，评论回复要人在平台页点发送。
6. 客户端不出现价格、套餐、付费入口。
7. 遇验证码 / 滑块 / 短信：停，转人工，不写任何绕过逻辑。
8. 测试不许用真实文章乱发：P0a 规则验收只用离线 `--plan`；真实发布只由人在安装包里点。
9. P0a、P0b 的交付门是各段列出的 `node` 命令与现有自测。`npm run typecheck` 不覆盖 `strategies/**/*.mjs`，不把 `typecheck` / `npm run test` 当这两段的交付门。
10. P1 起，每段结束跑：
    ```powershell
    npm run typecheck
    npm run test
    ```
    两样都绿才算交付。hook 失败就修，不许 `--no-verify`。

---

## P0a · 规则表收口 + 立即发布跑通

### 目标

把散落在适配器里的平台规矩搬进 JSON，行为不变；现有八步立即发布链路原样保留，**不含定时，不在本段收敛成三段式**。

### 改动

1. **新建四张规则表**
   - `d:\download\sparo上架应用商店版\strategies\skills\social-media-publish\platforms\toutiao.json`
   - `...\platforms\baijiahao.json`
   - `...\platforms\dayu.json`
   - `...\platforms\sohu.json`
   - 字段按产品书第 8.2 节。值只能从现有适配器抽取，**不许臆造**。
   - 定时：`supported` 按现状填，大鱼保持 `false` 并在表里注 `pending`。

2. **适配器改读表**
   - `...\scripts\adapters\toutiao.mjs`、`baijiahao.mjs`、`dayu.mjs`、`sohu.mjs`
   - 把硬编码的必勾项、必不勾项、封面模式、图片策略、字数与限额移到 JSON；断言逻辑留在代码里。
   - 现有 `readback` 断言一条都不能少。

3. **入口支持多平台与离线计划**
   - `...\scripts\publish.mjs`：新增 `--platforms a,b,c`；保留单平台参数兼容。
   - 新增 `--plan`：离线打印各平台从 JSON 读出的封面、必勾项与限额；不得连接 MCP、打开标签或填稿。
   - `...\scripts\engine.mjs` 的八步 `openBlank → fillTitle → fillBody → insertImages → setCover → setOptions → publishOrSchedule → verify` 与 `--from` 原样保留；`--from setCover` 自测不得受影响。
   - 三段式另开一段，不放进 P0a。
   - 定时逻辑保留但**不纳入本段验收**；不要顺手改大鱼定时。

### 验收（Cursor 自己跑，把输出贴回）

- `node ...\scripts\publish.mjs --help` 能看到 `--platforms`、`--plan` 与四个平台名。
- `node ...\scripts\publish.mjs --platforms toutiao,baijiahao,dayu,sohu --plan`：离线打印四平台从 JSON 读出的封面、必勾项与限额，退出码 0；全程不连接 Sparo、不打开编辑页、不填稿。
- 只改 `platforms\sohu.json` 里一个默认值，再次执行上面的 `--plan`，对应输出跟着变；验证后还原 JSON。
- `publish.mjs` 现有的 `--from setCover` 自测仍通过，八步与 `--from` 续跑能力未变。

### 本段禁止

- 不做 UI，不动 `src/`。
- 不引入新依赖。
- 不把八步收敛成三段式。
- 不用 `--dry-run` 代替 `--plan` 做本段验收，不连接已登录后台填稿。
- 不真实发布；真实验收由人手动做。

---

## P0b · 数据与评论探针（只读）

### 目标

实测四个平台的数据接口、评论接口、状态码与字段名；分页上限和延迟只在能判定时填写，单次快照看不出的明确写「单次快照无法判定」。

### 改动

1. **新建探针**
   - `d:\download\sparo上架应用商店版\strategies\skills\social-media-publish\scripts\probe-data.mjs`
   - `...\scripts\probe-comments.mjs`
   - 行为：连本机 MCP（`http://127.0.0.1:3921`），在已登录的后台标签用页面上下文 `fetch`，**只发 GET**，每个平台一次。
   - 输出：`%APPDATA%\sparo-store\probe\<platform>-data.json`，字段至少含 `url`、`status`、`keys`、`sample`、`capturedAt`。
   - 401/403 记为「登录态缺失」，不是失败退出；不重试、不绕过。

2. **结论写回规则表**
   - 把实测结论写回四张 `platforms\*.json` 的 `dataUrl`、`commentUrl`、`metricsMap`；未知字段留空，不猜、不填默认值。
   - P2 的采集器只读这些 JSON，不解析 Markdown。

3. **结果落人读文档**
   - 新建 `d:\download\sparo上架应用商店版\docs\DATA-ENDPOINTS.md`
   - 按平台逐行登记：数据页 URL、数据接口、评论接口、关键字段名、分页上限、延迟、额外头、实测状态。
   - 同步更新产品书第 10.2 节。

### 验收

- 四个平台各产出探针 JSON。Sparo 没开或未登录时，四份 JSON 写明「登录态缺失」也算本段交付。
- 接口路径、HTTP 状态码、字段名必须有实测记录；无法实测的写「登录态缺失」或「不可用 + 原因」。
- 延迟和分页上限看不出时写「单次快照无法判定」，不得默认写成 T+1，也不得编造分页上限。
- 四张 `platforms\*.json` 的 `dataUrl`、`commentUrl`、`metricsMap` 已按实测写回，未知项留空。
- `docs\DATA-ENDPOINTS.md` 四平台各有一行，允许「单次快照无法判定」，不允许把猜测写成实测。
- 全程无写请求：`probe-*.mjs` 里不出现 `POST` / `PUT` / `DELETE` 调用平台接口。
- 不点任何页面按钮。

### 本段禁止

- 不打开工作台 UI，不动 `src/`。
- 不做评论回复。
- 不用多次轮询去补判延迟或分页上限，不为填满表格而猜值。

---

## P1 · 工作台外壳 + 稿件 / 分发 / 台账 / 瘦总览

### 目标

从侧栏一行入口打开独立标签页 `sparo://studio`，跑通「写稿 → 勾平台 → 预检 → 确认单 → 发布 → 状态台」。

### 改动

1. **工作台页面**
   - 新建 `d:\download\sparo上架应用商店版\src\renderer\studio.html`（如需脚本，同目录新建 `studio.ts`）。
   - 左侧导航只出现：总览、稿件、分发、台账。
   - 布局按产品书 5.1 双栏；确认单按 5.5。

2. **打开方式**
   - 在 `d:\download\sparo上架应用商店版\src\main\browser.ts` 新增 `openStudio()`，由主进程新开标签加载 `out/renderer/studio.html`（dev 下 `src/renderer/studio.html`）；不要复用报告文件打开逻辑。
   - `d:\download\sparo上架应用商店版\src\main\shell-preload.ts` 增加 `openStudio` IPC；`d:\download\sparo上架应用商店版\src\renderer\shell.html` 侧栏加一行入口（文字「媒体工作台」），点击调 IPC。只有用户点击入口时才打开或切换到工作台标签。
   - 侧栏那一行**只做入口和待发篇数计数**，不做表单、不做编辑；P1 不显示待回评论，待回到 P3 才出现。

3. **草稿存储**
   - 目录：`%APPDATA%\sparo-store\drafts\<id>\`
   - 文件：`draft.json`（字段按产品书 8.1，含 `primaryPlatform`）+ `body.md` + `images\` + `cover.*`
   - 兼容读取旧稿件目录里的 `title.txt` / `body.md`。

4. **预检与确认单**
   - 预检逐平台读 `platforms\*.json` 算差异：标题字数、封面模式、不同图数量、默认勾选项、人工补项。
   - 越界**只标红**，不做自动缩短。
   - 确认单逐平台一行；`⚠️` 行默认跳过，其余默认勾选。
   - 人点「确认发布」后，才允许进入后续平台写入流程；Cursor 本段只验到确认单。

5. **状态台与台账**
   - 复用 `...\scripts\ledger.mjs`；工作台只读台账，展示每平台状态与失败原因。
   - 失败必须带 `errorCode` + 人话说明。

6. **瘦总览**
   - 只三行：待发、失败、登录过期。不画阅读、收益、评论。

7. **前台让位**
   - 需要人在平台页操作时（提交发布），工作台主动把前台切到平台页，完成后切回。

### 验收

- 只有用户点侧栏入口时才打开或切换到工作台独立标签页，不被后台任务自动抢前台。
- 新建稿 → 勾四平台 → 预检 → 确认单；差异能定位到平台+字段。Cursor 到此停止，**不执行 stage / review / commit，不向平台写草稿**。
- 标签页和侧栏入口来回切，工作台不丢未保存稿（自动草稿）。
- 总览只出现三行；不出现阅读、收益、待回评论。
- 确认单不出现定时或时间；真实发布由人手动确认，不属于 Cursor 的本段验收。
- `npm run typecheck`、`npm run test` 全绿。

### 本段禁止

- 不做抽屉。
- 不做数据、评论模块（导航里也不出现）。
- 不做定时、不做一键错峰，确认单不出现时间。
- 不做标题自动缩短。
- 不把平台 token 写进草稿或日志。

---

## P2 · 数据模块

### 目标

四平台昨日数据可看；缺数不显示 0；每张卡有来源与采集时间。

### 前置

P0b 已交付，四张 `platforms\*.json` 已按实测写回；没有实测结论的字段保持留空，不猜接口。

### 改动

1. **采集器**
   - 新建 `d:\download\sparo上架应用商店版\strategies\skills\social-media-publish\scripts\collector.mjs`
   - 只读取 `platforms\*.json` 的 `dataUrl`、`metricsMap` 等实测配置，不解析 `DATA-ENDPOINTS.md`；映射到产品书 6.2 的统一字段。
   - 在对应平台已登录标签页的页面上下文里发 GET；工作台页面没有平台 Cookie，不得从 `studio` 页面直接请求平台接口。
   - 写快照，**串行，一次一个平台**；不并发打四家。

2. **存储**
   - SQLite 文件固定为 `%APPDATA%\sparo-store\metrics.sqlite`，一张 `metrics` 表，主键 `platform + accountId + date + articleId`。
   - 账号级记录的 `articleId` 用空字符串。
   - 发布任务和台账继续 JSONL，不搬进 SQLite。
   - `revenue` 分存、元显示。
   - `completeness` 四态：`full / partial / missing / unsupported`。

3. **视图**
   - 按产品书 6.5 做六块：总览卡、趋势、内容榜、平台对比、收益拆分、异常。
   - 总览卡只放阅读、净增粉丝、收益、异常，**不放待回评论**；待回评论到 P3 随互动页一起出现。
   - 打开工作台先画上次快照；昨天快照缺才补拉；手动刷新 5 分钟冷却。
   - 任一平台 `partial`：聚合卡不显示涨跌百分比。
   - 跨平台合计标注「相加，非去重」。
   - 搜狐收益显示「平台未提供」，不显示 0。
   - 本月收益标注「账面相加，非到账」。
   - 净增粉丝用有符号数。

### 验收

- 四个平台昨日数据各有一行；打不通的标红并写原因。
- 断网或接口 4xx 时：上次快照仍显示，角标「数据截至」。
- `unsupported` 与 `missing` 在界面上文字不同。
- 不改代码，只删快照，重启后能重新拉。
- `npm run typecheck`、`npm run test` 全绿。

### 本段禁止

- 不做导出报表、不做自定义透视。
- 不做竞品或公开页抓取。
- 不做后台常驻轮询。

---

## P3 · 评论：只读列表 + 头条/百家回复草稿

### 目标

四平台评论列表只读；头条、百家可以「填进平台回复框」，由人点发送。

### 改动

1. **评论读取**
   - 复用 `probe-comments.mjs` 的接口结论，新增 `...\scripts\comments.mjs`：只发 GET，按平台拉列表，落本地缓存。

2. **互动页**
   - 导航增加「互动」。
   - 默认只看未回复；按平台 / 内容 / 时间筛选。
   - 只显示探针已通的平台。

3. **回复草稿（仅头条、百家）**
   - 点「回复」：内容填进**平台页面的回复框**，工作台把前台让给平台页，由人点发送。
   - 工作台不出现「发送」按钮，不代提交。
   - 常用短语只填入平台回复框。
   - 大鱼、搜狐按钮标「只读，回复未开」，禁用。
   - 回复频率独立写死，不复用发布的 `minGapMinutes`：单条至少间隔 20 秒，每平台每小时不超过 30 条；遇验证码立即停。
   - 是否发送成功只认下一次 GET 能看到这条回复；不提供「我已发送」按钮。

### 验收

- 四平台列表都能显示（探针通的）。
- 头条、百家能填进回复框，且必须由人在平台页点发送；工作台无发送按钮，也没有「我已发送」按钮。
- 大鱼、搜狐只有列表，没有可用的回复入口。
- 回复填写失败不丢内容；只有下一次 GET 能看到该回复才标为已回复，不把填框或人工点击当作成功回执。
- 本段功能验收到此为止。头条、百家上线后的两周并行观察由人执行，**不作为本段 commit 的验收门**；观察项是无自动发送、遇验证码会停、20 秒与每小时 30 条限制生效。
- `npm run typecheck`、`npm run test` 全绿。

### 本段禁止

- 不做私信。
- 不做自动点赞、关注、互关。
- 不做批量回复。

---

## 交付格式

每段完成后，回一段话 + 三样证据：

1. 改了哪些文件（绝对路径清单）。
2. 验收命令的实际输出（贴关键行）。
3. commit hash 与 message。

commit message 用：

```
feat(studio): P0a 平台规则表收口
feat(studio): P0b 数据与评论只读探针
feat(studio): P1 工作台外壳与稿件分发
feat(studio): P2 四平台数据总览
feat(studio): P3 评论只读与头条百家回复草稿
```

---

## 交接前自检（Cursor 逐条打勾）

- [ ] 四张 `platforms\*.json` 存在，值来自现有适配器，无臆造。
- [ ] `--platforms` 与离线 `--plan` 可用，现有八步与 `--from` 仍可续跑。
- [ ] 工作台是独立标签页；侧栏只有一行入口。
- [ ] 工作台没有任何发送按钮。
- [ ] 导航按期出现：P1 四项，P2 加数据，P3 加互动。
- [ ] 数据只发 GET；快照先画、缺才补拉、串行。
- [ ] `partial` 不出涨跌，`unsupported` 不出 0。
- [ ] 无价格、套餐、付费入口。
- [ ] 无 token 落盘、无日志打印 token。
- [ ] P0a、P0b 的 `node` 验收命令与现有自测通过；P1 起 `npm run typecheck` 与 `npm run test` 全绿。
