# 第一阶段修复任务书 R2：第二轮复审阻断项

> 版本：v1.0 · 2026-11-07  
> 执行：Cursor  
> 复审：规划方  
> 原任务书：[ECOMMERCE-PHASE1-CURSOR-TASKBOOK.md](./ECOMMERCE-PHASE1-CURSOR-TASKBOOK.md)  
> 前一轮修复：[ECOMMERCE-PHASE1-FIX-R1-CURSOR-TASKBOOK.md](./ECOMMERCE-PHASE1-FIX-R1-CURSOR-TASKBOOK.md)

## 0. 目标与范围

第二轮复审确认同单串行/CAS、基础完整指纹、拒绝后续跑、分类读回和来源保留已基本落实，但 R1 仍留下 4 项 Critical 和 2 项 Required。

本轮只修原任务书第 8 节“规划方第二次复审”列出的六项，并补能真正复现这些路径的测试。**不要再用直接发句柄、预填证据或点击前抛错代替真实时序。**

先读原任务书 §8 的第一次、第二次复审及本文件。保留已有有效修复，不重写整条链路。

## 1. 禁区

1. 不提交 Git，不运行 `npm run dist`，不操作真实账号，不修改无关页面洞或侧栏代码。
2. 不把 `dxmEnabled()` 改成 true，不把新 ID 加进旧 `WORKFLOWS`，不调用旧 `runFullListing()`。
3. 不接回旧任务脑区，不新增本地关键词/正则意图判断。用户是否同意仍由下一轮模型按 #28 看对话历史判断。
4. 不通过删除、跳过或放宽旧测试转绿；不得为了通过测试预填平台商品 ID、伪造来源关系或把点击前崩溃称为点击后崩溃。
5. 保存、提交、待审、结果未知都不是上线。关联不足的证据只能停等。
6. 本轮仍不实现真实选择器，不声称 E1–E12 真机通过。

## 2. 修复任务

### R2-1：确认句柄必须绑定“请求 → 下一条用户明确同意 → 本次消费”

**根因：** 当前在 `request_confirm` 当轮就发出可用句柄，后续还能省略 confirmId 自动匹配。句柄只证明问过，不证明用户同意。

**按时序实现：**

1. **请求轮：** 模型调用 `request_confirm` 时只创建 `pending` 确认，绑定内部 request/run ID、confirmId、工作单、功能、图片范围摘要和费用；随后立即结束该 run。pending 票据不能被自动选中执行。
2. **确认结果传递：** confirmId 通过该次工具结果的结构化 data 或等价内部上下文交给下一轮模型，不要求把内部 ID 展示成用户界面正文。
3. **下一轮：** 模型看到用户下一条明确同意后，调用 `dxm_smt_prepare` 时必须显式携带同一个 confirmId。模型是否同意仍按 #28 判断，本地不分析同意词。
4. **消费轮：** 执行层只接受显式 confirmId，并核对它来自紧邻的上一次确认请求、仍处于 pending、属于当前确认轮次，且工作单、功能、实际图片 src 范围摘要和当前费用完全一致。删除“省略 confirmId 也能匹配”的路径。
5. **失效：** 消费后立即失效；处理下一条用户消息的那个 Free Soul run 结束后仍未消费的 pending 才失效，不能在模型消费前先过期；新确认替代旧确认；超时、换工作单、换功能、换图、费用变化、跨后续轮次或重复使用均失效。
6. 一次收费确认只授权对应一次收费动作，不能授权发布或另一收费功能。auto 与逐步确认模式都遵守。
7. 更新 `DECISION-POINTS.md` #40，使其明确“请求时是 pending，下一条明确同意后由模型显式带句柄消费”，不能继续写成“request_confirm 发出即可用”。

**必补测试：**

- 用脚本化模型走两轮完整 Free Soul 确认往返，不只直接调用 `issuePaidConfirm`：明确同意时脚本才携带 confirmId 调 prepare；拒绝、模糊或未回答时脚本不调用 prepare，执行层不得根据这些文本自行判票；
- 只请求、用户未回答，不能执行；用户拒绝或回答模糊，不能执行；
- 省略 confirmId、换图、过期等执行层规则另做直接单元测试；省略 confirmId 时，即使存在唯一 pending，也不能执行；
- 明确同意且所有绑定一致才执行一次；重复调用不执行；
- 换图、换费用、跨工作单、跨确认轮次、过期均不执行；
- 确认句柄不能触发发布。

### R2-2：发布前必须通过页面 blocker、动态缺项和当前草稿店铺门

**修改要求：**

1. `dxm_smt_publish` 在读取字段前调用 `classifyPage(probe)`，只允许无 blocker 的 `/web/smt/edit` 当前编辑页。
2. 登录失效、验证码、无权限、未加载、入口变化、非编辑页和 `fields_missing` 均拒绝发布并保留可靠断点。
3. 把 `probe.missingFields` 合并进实时缺项；任何动态必填缺项都不能通过 QA。
4. `PageProbe` 增加能证明**当前草稿绑定店铺**的字段，例如 `draftShopId`。`probe.shops` 只是可选店铺列表，不能替代该读回。
5. 当前草稿的 draftId、recordId、draftShopId、执行 tabId 和 URL 必须与工作单精确一致；空值不算匹配。
6. 发布前完整 QA 和指纹检查继续保留，不用页面门替代字段门。

**必补测试：**

- 分别注入验证码、登录失效、无权限、fields_missing 和非空 missingFields，点击数均为 0；
- shops 列表包含 S1、但当前草稿属于 S2，点击数为 0；
- 当前草稿店铺字段缺失时停等；
- 合法 S1 当前草稿才可进入后续 QA。

### R2-3：提交、失败、平台 ID 和在线证据必须关联本工作单

**修改要求：**

1. 扩展 `StatusEvidence`，提交记录、失败记录和平台 ID 读回必须携带可核验关联信息，至少包括 draftId + shopId；能获得时也带 sourceRecordId。裸 `productId` 或裸 `platformProductId` 不足以改变状态。
2. 只有关联信息与本工作单精确一致的提交记录，才能首次赋予平台商品 ID 并进入待审。
3. 失败记录也必须关联本单，不能把其他商品失败写成自己的拒绝。
4. 在线迁移必须同时满足：本单平台 ID 已来自关联提交证据、在线 productId 相同、shopId 相同、URL 可核验。
5. 本单还没有平台 ID 时，不得从在线列表或无关 submitRecord 收养一个 ID。关联缺失、冲突或无法判定时停等，状态保持安全。
6. 查询接口可以返回多条记录，但选择必须依据关联字段，不能取“最新一条”。

**必补测试：**

- 本单无平台 ID，返回他品 submitRecord(P2) + 同店 online(P2)，不得待审或上线；
- 缺 draftId/shopId 的提交记录只能停等；
- draftId、sourceRecordId 或 shopId 冲突时不得采用证据；
- 合法关联提交记录赋予 P1，随后同店同 ID 在线才上线；
- 他品 failureRecord 不得使本单失败。

### R2-4：认领查重失败关闭，并原子预留来源+店铺工作单身份

**修改要求：**

1. `lookupDraft` 不存在、超时或返回无法判定时统一为 `unknown` 并停等，不能在新工作单中当成 `absent`。
2. `claim` 返回 draftId 但 ok=false、有 blocker、店铺不匹配或来源关系未读回时，不得把它写成已认领的 `claimedDraftId`。
3. 对“平台可能已认领但结果失败”的情况保留未决 claim attempt；恢复先查目标箱，查到同源且店铺匹配的草稿才解决，否则停等，不直接再点。
4. 只有认领成功且草稿、来源、店铺读回匹配后，才能进入 knownDraft 路径。
5. 在生成新工作单 ID 之前，按 `sourceRecordId + shopId` 进入独立身份锁/原子预留：重新检查未关单，只有第一个请求能创建；后续请求关联同一工作单。不同来源/店铺不必全局串行。
6. 新工作单和 claim_attempt_started 必须在对应副作用前持久化，保留现有 revision 防覆盖。

**必补测试：**

- 无 lookupDraft 能力时认领数为 0；
- claim 失败但返回 draftId，下一次不得绕过查重和认领结果核验；
- 两个无 workOrderId 的并发 prepare 使用同一来源+店铺，只创建一个工作单、最多一次认领；
- 不同来源+店铺仍可独立执行；
- 认领平台成功、本地崩溃后，恢复通过目标箱读回复用草稿。

### R2-5：文字翻译后的最新读回是唯一 QA 依据

**修改要求：**

1. 翻译后的 `reread` 是标题、动态字段、描述及其 verified 状态的唯一依据；不得用翻译前 snapshot 把空值、缺字段或未验证状态补回通过。
2. 修正 `{ ...reread, ...snapshot }` 的覆盖方向，但不得仅交换 spread 继续混用旧值。逐项构建最新视图，翻译目标字段全部来自 reread。
3. 旧 fields 中 verified=true 的字段，如果 reread 缺失、值为空或 verified=false，必须改为未验证并进入缺项。
4. 标题和描述空译文都进入 `textReadbackIssues`；SKU 变量、超长和翻译失败继续阻断 QA。
5. 确实不属于文字翻译范围的图片等业务数据可以保留独立读回，但必须在代码中明确分组，不能通过旧对象整体覆盖。
6. 指纹和准备摘要使用同一份最新 QA 视图。

**必补测试：**

- 翻译前字段 verified=true，翻译后字段缺失或 verified=false，QA 不通过；
- 空标题、空描述均不通过，不被旧值回填；
- 最新翻译值进入指纹，旧值不再覆盖；
- 合法完整读回才允许 draft_ready。

### R2-6：补真正的“平台已点击，本地尚未落账”崩溃测试

**修改要求：**

1. 在 port 增加仅用于故障注入的 `afterClick` 或等价钩子，位置在 `clickPublish` 已返回成功之后、`publish_clicked`/receipt 持久化之前。
2. 测试中 clickPublish 必须真实把 mock 点击数加到 1 并返回提交回执，然后 afterClick 抛错；不得再用 beforeClick。
3. 崩溃时本地只保证存在 `publish_attempt_started`；恢复后无论 repeat publish 还是 status，都不得再次点击。
4. 使用 R2-3 的合法关联提交证据将工作单收为待审，再以同店同平台 ID 的在线证据收为上线。
5. 同时保留点击前崩溃测试，两种窗口分别命名、分别断言。

## 3. 回归验收

```powershell
npx vitest run tests/dxm-smt-listing.test.ts tests/dxm-smt-publish.test.ts tests/dxm-smt-r1.test.ts
# 如新增 R2 测试文件，也显式加入定向命令
npm test
npm run typecheck
npm run lint
npm run build
```

要求：

1. 原 65 项和本轮新增测试全部通过；新增测试必须覆盖上述每条反向路径。
2. typecheck、lint、build 全部通过，不新增 lint error。
3. 若出现无关失败，记录 HEAD、失败原文和基线复现结果，不改无关模块。
4. 未跑项如实写“未跑”，不得复制上一次结果。
5. 测试全绿仍只代表代码验收候选，不代表真机上线。

## 4. 交付记录

1. 在原任务书第 8 节追加“Cursor R2 修复记录”，不得删除规划方复审意见。
2. 按 R2-1 至 R2-6 列出修改文件、时序/合同变化和新增测试。
3. 附当前 HEAD、实际命令结果和未跑项。
4. 明确 E1–E12、真实选择器和安装包仍未验收。
5. 交回规划方做第三轮复审；复审通过前继续禁止真实写操作和发布。
