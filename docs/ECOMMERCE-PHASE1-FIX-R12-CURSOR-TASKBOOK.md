# R12 任务书：潜意识/意识协作 + 店小秘上架复用发布链路经验

> 版本：v1 · 2026-11-11  
> 执行方：Cursor。规划方：本窗口。真机验收：需已登录店小秘 + 用户在场。  
> 参考实现：`strategies/skills/social-media-publish/scripts/`、[SOCIAL-PUBLISH-PIPELINE-DESIGN.md](./SOCIAL-PUBLISH-PIPELINE-DESIGN.md)。  
> 决策点：[DECISION-POINTS.md](./DECISION-POINTS.md) #52。  
> 一句话：**能固定成步骤的交潜意识，交不动的立刻还给意识；两边都不许单独关单。**

---

## 0. 用户裁决：潜意识与意识是合作关系

定义：

- **意识 = 大模型**。负责理解原话、判断目标、规划路线、处置异常。
- **潜意识 = 技能 / 脚本 / 页面内接口调用**。负责固定步骤、确定性回读、批量重复动作。

三条硬规则：

1. **默认先潜意识**：技能已登记且步骤完整时直接回放，不让模型逐步重新想。
2. **卡住必交还**：出现缺槽、页面结构不符、回读不一致、接口非 0 回执、同因连续失败两次——立即停手交还意识。不许硬撑重试，不许猜。
3. **重复即沉淀**：意识每次都要临场想的同类步骤，攒够两次做成技能；潜意识同因连败两次，摘掉触发语回退意识。

四条禁止：

- 潜意识不许用模糊匹配猜「用户想做哪件事」，只认已登记技能 id 或精确触发语。
- 意识不许逐字重做固定步骤（不许循环 `fill`，不许一步步点发布表格）。
- 任何一边都不许单独判完成：潜意识跑完也要过终审；意识不能没有回读证据就关单。
- 潜意识不许绕 `human_gates`（登录 / 验证码 / 付钱 / 保存并认领 / 发布）。

可观测要求：每次「潜意识 → 意识」交还，ledger 必须留一行 `handoff`，写清交还原因。

与现有设计的关系：本条与 [THREE-CHANNEL-DESIGN.md](./THREE-CHANNEL-DESIGN.md) 的「无意识 / 有意识通道」一致，不另建架构。三通道仍按该稿分期，本任务书只落地店小秘这一条链路。

---

## 1. 从发布链路移植的四件事（已核实）

| 能力 | 他的位置 | 复用理由 |
|---|---|---|
| 确定性回读 | `publish.mjs --self-check`、`titlesEqual`、`scheduleMatches` | 全文相等 / 数值相等，不做前缀或截断比对 |
| 网络回执判定 | `adapters/baijiahao.mjs` hook 发布响应取 `errno` / `article_id` | 页面提示可能不弹，回执不会骗人 |
| 断点续跑 + 防串稿 | `engine.mjs` 的 `--from` + `canResume` | 续跑前核对标题，防止把 A 稿字段写进 B 稿 |
| 失败降级表 + ledger | 设计稿 §4、`ledger/2026-11.jsonl` | 失败有码可查，不靠回忆 |

已实测：`node strategies/skills/social-media-publish/scripts/publish.mjs --self-check` → `SELF_CHECK_OK`（2026-11-11）。说明这套断言可脱离浏览器跑，**先测后改**成立。

不照搬的部分：他的 `commit`（点发布）不可逆、必须前台；店小秘的保存可重复，更适合接口化。但「保存并认领」是不可逆写，等同他的发布，必须留在 #43 授权门后面。

---

## 2. 第一阶段（可立刻开工，零风险）：字段级回读契约

现状：`strategies/skills/dxm-crawl-prep.json` 的 reload 回读只核对标题、重量、库存三项，`knownGaps` 明确写着「其它字段是否一起落库未逐项核对」。

目标：升级为**字段级契约**，任一项不符即抛错停手，侧栏说人话列出差异。

| # | 字段 | 判据 |
|---|---|---|
| 1 | 产品标题 | 全文相等；空标题只在意图也为空时通过 |
| 2 | 包装重量 | 数值相等（`Number` 比较，0.05 与 0.050 相等，50 与 0.05 不等） |
| 3 | 变种行数 | 与意图变种数相等（读不到行数就停，不猜） |
| 4 | 每个变种库存 | 每行都等于目标上限；缺一行即失败 |
| 5 | 主图尺寸（仅本次改过时） | 短边等于目标值 |
| 6 | 分类（仅本次改过时） | 面包屑文本与意图一致 |

要求：

- 回读返回结构化 diff（字段、期望、实际），不只抛一句「不一致」。
- 失败文案固定格式：`回读不一致：标题(期望X/实际Y)、变种2库存(期望2000/实际1999)`。
- 不通过不进入后续步骤，不写「已保存」。
- 保留现有 reload + 4 次重试 1500ms 的时序，不加轮询抢答。

先测后改（必须按顺序）：

1. 用 MCP `execute` 在真实编辑页**只读**跑一遍新回读脚本，确认 6 个字段都读得到，且不改任何字段。
2. 用 `tests/fixtures/` 现有 dxm 编辑页夹具，把脚本抽出来跑离线断言；不通过不许合码。
3. 真机在同一记录上跑完整技能：改 3 项 → 保存 → reload → 6 项全过。

已执行记录（2026-11-11，规划方本窗口）：

1. 真机只读采样通过：记录 `167842582606445464`，标题 / 重量 `0.05` / 3 个变种行 / 每行库存 `2000` / `.img-size` 23 个（首个 `800 X 800`）/ 分类「未分类 + 管理分类」，未改任何值。
2. 离线夹具与断言：`tests/fixtures/dxm-crawl-edit-sku.html` + `src/main/workflows/dxm-crawl-readback.ts` + `tests/dxm-crawl-readback.test.ts`（7 例）。`npx tsc --noEmit` 0 error，`npm test` 123 files / 939 tests 全绿，`publish.mjs --self-check` 仍为 `SELF_CHECK_OK`。
3. D1 原地重存通过（用户选的口径）：按现值重写标题 / 重量 / 库存 → 点 `button.btn-orange`「保存」→ reload → 6 项全过，无差异；业务内容未改。
4. 失败文案实测：把重量期望写成 `50`，页面返回 `回读不一致：重量(期望50/实际0.05)`。
5. 技能 `dxm-crawl-prep` 升 v8，`readback` 由 3 项扩为 6 项；`variantCount` / `imgShortSide` / `category` 为可选意图，未传时跳过该项。
6. **整单跑通（2026-11-12）**：`run_skill({query:"dxm-crawl-prep", params:{editUrl, title, weight, stock, variantCount, imgShortSide, category}})` 在真实记录上 15 步全 `ok`：打开编辑页 → 标题 → 重量 → 标记库存 → 8 个库存槽 → 保存 → reload → 6 项回读。窗口未置前，读回全过。
   - 注意：`run_skill` 只认技能 id 或已登记触发语，传中文别名只返回候选（P1 行为，符合三通道设计）。
   - 注意：技能 `params` 是空对象，`{{editUrl}}` 等槽位不会被自动推导，调用方必须显式传 `editUrl`。

---

## 3. 第二阶段（需先采样，书面放行后才改代码）：保存接口化

动机：R10 的根因是「后台标签不渲染 / 视口为 0」。判重已用接口解决（`src/main/workflows/dxm-smt-api.ts`），保存仍是 UI。发布链路的结论是：**读和写不该依赖布局，只有点击才依赖布局。**

范围：只做「保存」一个动作。不动认领，不动发布，不动分类选择。

步骤：

1. **采样（只读）**：在真实编辑页点一次「保存」，用 XHR/fetch hook 记录 URL、方法、Content-Type、表单字段、鉴权位置（cookie / CSRF header）、响应结构（code / msg / id）。产出 `docs/ECOMMERCE-PHASE1-APPENDIX-D-EDIT-SAVE-API.md`。
2. **契约**：只认采样到的真实字段路径；`code !== 0` 或结构不符一律 `unknown`，不许猜成功。
3. **实现**：页面上下文 `fetch` 优先；4xx / 5xx / 结构不符 → 退回现有「点保存按钮 + reload 回读」，并记降级原因。
4. **幂等**：回执 `data` 恒为 `null`，没有 productId / recordId；续跑锚点用**请求体里的 `id`**（等于 URL 的 `?id=`），保存前必须与当前页 URL 的 id 比对一致，防止把 A 商品写到 B 上。

前置：采样由规划方（本窗口）在有登录态时执行。Cursor 只消费附录 D 的结论，**不许自行探接口**。

**采样已完成（2026-11-12）**，结论见 [ECOMMERCE-PHASE1-APPENDIX-D-EDIT-SAVE-API.md](./ECOMMERCE-PHASE1-APPENDIX-D-EDIT-SAVE-API.md)。三条要点先记住：

- `POST /api/crawl/updateNew.json`，`multipart/form-data`，唯一字段 `file` = zip（内含 `crawlSave.txt` 的 deflate JSON），鉴权只靠 cookie。
- 响应 `{"code":0,"msg":"修改成功！","data":null}`；`data` 恒空，**没有 recordId**，续跑锚点只能用请求里的 `id`。
- 服务端按整对象覆盖：必须「先读全量 → 改 3 项 → 整份提交」，不能只发改动字段。

用户尚未对该实现书面放行，代码不动。

---

## 4. 第三阶段（第一、二阶段验收后再排）：续跑与 ledger

- 续跑：中断后用 `recordId` + 标题双校验恢复（对应 `canResume`）。recordId 不符或标题不符一律从头跑，不许把 A 商品字段写进 B 商品。
- ledger：每次技能执行追加一行到 `%APPDATA%\sparo-store\dxm-crawl-ledger.jsonl`，字段：`at / recordId / title / ok / step / reason / fields(差异) / handoff / hint`。
- 只追加，不改写工作单日志 `dxm-smt-journal.jsonl`。

---

## 5. 验收

| 编号 | 场景 | 通过标准 |
|---|---|---|
| D1 | 回读契约全过 | 改 3 项保存后 reload，6 项全过，侧栏不出错 |
| D2 | 回读拦截 | 故意把重量写错（50 vs 0.05），必须停手列出差异，不许假 done |
| D3 | 空标题 | 标题为空时抛「标题为空，未保存」，不点保存 |
| D4 | 最小化下保存 | 窗口最小化，`button.click()` 路径仍保存成功，回读通过 |
| D5 | 接口降级 | 保存接口返回 500，自动退回点按钮路径，ledger 记 `fallback` |
| D6 | 续跑防串稿 | 用记录 A 的 recordId 打开记录 B，必须拒绝续跑 |
| D7 | 潜意识交还 | 页面结构不符（缺变种行）时停手交还意识，ledger 记 `handoff` |

D1–D3、D7 走第一阶段；D4–D6 分别在第二、三阶段各自验收。**单测绿不等于真机过**，D4–D6 必须在已登录店小秘上跑。

---

## 6. 禁区

- 不改 `dxmEnabled()`；`dxm_smt_*` 仍只走 Free Soul 侧栏白名单。
- 不点「保存并认领」（#43 授权门不变）；不碰认领弹窗；不动 `docs/listings/`。
- 不存鉴权 token；不 Node 侧直发；不并发同站多标签。
- 不在页面里 `dispatchEvent` 绕过写闸门。
- 新增任何「本地提前结束 / 改走向」的判断，先登记 `DECISION-POINTS.md`（本任务书对应 #52）。
- 潜意识脚本不得自己决定「任务完成」，完成判定仍归终审。

---

## 7. 交付

- 技能 JSON 与代码分开提交，一个阶段一个 commit。
- 提交前：`npm run typecheck` 退出码 0、`npm test` 全绿、`node strategies/skills/social-media-publish/scripts/publish.mjs --self-check` 仍为 `SELF_CHECK_OK`（证明没把发布链路改坏）。
- 回报格式：D 编号逐条 pass / fail + ledger 摘录 + 差异日志原文。
