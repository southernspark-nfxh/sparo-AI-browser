# 第一阶段开发任务书：店小秘到速卖通真实发布闭环

> 版本：v1.1 · 2026-11-07（已经无上下文执行者复审）  
> 维护：规划方（Trae）  
> 执行：Cursor  
> 复审与真机验收：规划方，真实发布需用户在场确认  
> 上位路线：[ECOMMERCE-DEV-ROADMAP.md](./ECOMMERCE-DEV-ROADMAP.md)  
> 本文件可独立交给 Cursor，不依赖其他会话记录

## 0. 北极星与完成定义

用户在 Sparo 侧栏说：

> 把店小秘采集箱里的这个商品编辑、翻译并发布到我的指定速卖通店铺。

最终要形成：

**通用采集箱商品定位 → 认领到指定店铺 → 动态字段编辑 → 图片与文字翻译 → 发布前 QA → 用户确认 → 提交平台 → 查询审核/发布结果 → 在线商品链接或在线商品读回。**

这里的“用户确认 → 提交平台”描述第一阶段唯一认证的**逐步确认模式**。自动执行模式继续遵守 `DECISION-POINTS.md` #34：发布可按用户任务指令直接执行，但不属于本阶段真机验收范围；不得借本任务扩大自动发布范围或宣称 auto 已通过验收。收费翻译、支付和删除不因 auto 而免除独立确认。

第一阶段只验收**单商品、单店铺、单平台、串行执行**。最终完成只认 `published_online`，必须满足至少一项：

1. 获得可打开且与目标商品一致的在线商品链接；
2. 在速卖通在线商品列表读回到同一平台商品 ID，并能对应本工作单。

以下都不是最终完成：

- 打开或填过编辑页；
- 图片/文字翻译按钮点过；
- 保存到草稿或待发布；
- 点击发布按钮；
- 店小秘显示已提交；
- 平台仍待审核；
- 单测、构建或侧栏“已完成”文案。

`submitted_pending_review` 是合法中间状态，必须如实显示“已提交，平台处理中，尚未上线”，不得关成成功。

---

## 1. 现行架构与不可漂移的约束

### 1.1 主路径

- 侧栏主路径是 `src/main/agent/free-soul.ts` 的 Free Soul。路线和下一步仍由模型决定。
- 浏览工具经 `src/main/browser.ts` 的 `runCoreTool()` / `runAgentTool()` 执行。
- 现有 `run_workflow` 执行入口在 `src/main/browser.ts`，旧店小秘实现位于 `src/main/workflows/dianxiaomi.ts`。
- **禁止把 `handleChat` 接回旧 `executeMission`、意图路由、旧工作单循环或 `parseLocalIntent`。**
- 新概念“商品工作单”是本次链路的执行记录和验收凭据，不是恢复旧任务脑区。

### 1.2 旧资产边界

可复用：

- `dianxiaomi.ts` 中经过真机验证的弹窗、图片菜单、图片翻译、文字翻译等纯执行经验；
- `listing-playbook.ts` 的草稿保护和“图片翻译 ≠ 文字翻译”等约束；
- `qa/dianxiaomi-smt.ts` 的基础探针思路；
- `strategies/skills/dxm-crawl-prep.json` 的页面入口与已知缺口。

禁止直接复用为完成方案：

- `runFullListing()` 仍有分类、属性、SKU、模板缺口，结尾只暂停让人保存；
- 固定“主图必须恰好 6 张”和固定 SKU 定价公式不得进入新默认规则；
- `best_effort` 不得映射为 QA 通过或工作单完成；
- `src/main/features.ts` 的 `dxmEnabled()` 当前固定为 `false`，**本任务不得把它改成 true，也不得批量解禁旧工作流**；
- 旧 `dxm-crawl-prep` 合同禁止代点“保存并认领”，本任务不篡改该技能来绕过原合同。

### 1.3 新实现方式

新增独立链路，建议符号与文件如下；如现有结构需要微调，保持职责不变，不做架构扩张：

| 建议位置 | 职责 |
|---|---|
| `src/main/workflows/dxm-smt-listing.ts` | 新工作流入口、状态机、准备/发布分离 |
| `src/main/workflows/dxm-smt-page.ts` | 页面识别、字段探针、读回和平台回执 |
| `src/main/workflows/dxm-smt-journal.ts` | 本机商品工作单与证据日志 |
| `tests/dxm-smt-listing.test.ts` | 状态机、字段、幂等和准备流程 |
| `tests/dxm-smt-publish.test.ts` | 确认边界、超时查重、回执与上线判定 |

需要复用旧私有函数时，提取最小共享执行 helper，保持旧导出行为不变；不得复制两份大段菜单脚本。

Free Soul 通过新增的 `run_workflow` 工具调用本链路。新 ID **不得加入旧 `WORKFLOWS`，不得经旧 `runWorkflow()` 解锁**。统一参数为 `{ id, params? }`：

- `dxm_smt_probe`：`{ workOrderId?: string }`；无工作单时只探测当前绑定标签；
- `dxm_smt_prepare`：`{ workOrderId?: string, sourceRecordId?: string, useCurrentEditPage?: boolean, shopId?: string, shopName?: string }`；
- `dxm_smt_status`：`{ workOrderId: string }`；
- `dxm_smt_publish`：`{ workOrderId: string, draftFingerprint: string }`。

`runCoreTool()` 对新 ID 先做预览开关和精确白名单检查，再分发到新的 `dxm-smt-listing.ts` 入口；其他 ID 直接拒绝，不得回落旧 `runWorkflow()` 或 `dxm_full_listing`。旧工作流的其他调用入口和导出行为保持不变。

新入口必须接收浏览器内部提供的当前 Agent `tabId` 和本次 run 的 `AbortSignal`，二者不由模型参数伪造。所有页面 helper 使用绑定标签；每次认领、写字段、翻译、保存、发布之前以及等待之后，先检查取消/暂停状态。收到停止、新指令打断或暂停后，保存断点，不再执行队列中的任何副作用动作。

新能力在复审前使用独立预览开关 `SPARO_DXM_SMT_PREVIEW=1`，不得复用或修改旧 `dxmEnabled()`。预览关闭时，`run_workflow` 和新技能的 `run_skill` 只返回“该能力尚未开放”，不得返回可继续执行的操作路线，不得回落旧店小秘工作流。

---

## 2. 全局禁区（违反即打回）

1. 不直接自动操作 1688；第一阶段从店小秘已授权采集结果开始。
2. 不绕过登录、验证码、人机识别、平台权限或风控。
3. 不自动批量认领、批量发布、换店铺、创建运费模板或删除重复商品。
4. 不虚构价格、库存、重量、尺寸、品牌、资质、运费模板、海关或合规信息。
5. 不在编辑页刷新、重开、点“访问”或替换当前标签；来源页必须另开标签。
6. 不循环逐字 `fill`；input/textarea 使用可靠赋值、事件派发和读回。
7. 图片翻译、图片白底等可能收费的功能必须单独确认；不得用任务总确认代替付费确认。
8. 发布确认继续遵守 `DECISION-POINTS.md` #28 和 #34：逐步确认模式走 `request_confirm`；自动执行模式边界不被本任务改写。支付、删除始终另行确认。
9. 不新增第二套发布审批卡，不复用旧 `requestApproval` 代替 Free Soul 确认。
10. 不删旧 QA 闸门、`looksLikeSubmitAction`、`qaGate`、`requestApproval`，不扩大 #31 的布尔短路。
11. 新增会提前结束、绕过模型或改变任务走向的本地判断，先登记 `DECISION-POINTS.md`；状态核验和动作读回本身不等于路线判断。
12. 不把云端 Key 写入客户端，不改云任务计量，不碰 `docs/listings/`。
13. 不提交 git，不运行 `npm run dist`，不顺手重构无关模块。
14. 真实账号中的字段赋值、分类修改、图片处理、普通/收费翻译、认领、保存和发布都属于有副作用操作。Cursor 未经用户当场明确授权不得执行其中任何一项；单项授权不等于授权其他动作，收费和发布仍有各自独立确认门。代码完成与全量测试绿不得写成真机通过。

---

## 3. 统一数据合同

### 3.1 商品工作单

新链路至少保存以下字段，命名可微调，语义不得缺失：

```ts
type DxmListingWorkOrder = {
  id: string;
  source: {
    productId?: string;
    crawlRecordId?: string;
    sourceUrl?: string;
    titleSnapshot?: string;
  };
  target: {
    platform: "aliexpress";
    shopId?: string;
    shopNameSnapshot?: string;
  };
  claimedDraftId?: string;
  platformProductId?: string;
  state: DxmListingState;
  tabs: { sourceTabId?: string; editTabId?: string };
  checkpoint?: { reliableState: DxmListingState; reason: string; nextAction: string; at: number };
  qa?: { result: "pass" | "waiting_human" | "fail"; checkedAt: number; draftFingerprint: string };
  draftFingerprint?: string;
  fields: Record<string, {
    value?: unknown;
    provenance: "source" | "user" | "approved_rule" | "readback";
    verified: boolean;
  }>;
  missing: Array<{ field: string; reason: string; action: string }>;
  evidence: Array<{
    at: number;
    action: string;
    observed?: unknown;
    changed?: unknown;
    verified?: unknown;
    url?: string;
  }>;
  receipt?: {
    kind: "draft" | "submitted" | "rejected" | "online";
    text?: string;
    productId?: string;
    url?: string;
  };
};
```

不得在日志中保存密码、Cookie、Token、完整支付信息或整页无关正文。日志只留本机 `%APPDATA%\sparo-store` 下的独立店小秘链路文件；不得写入旧 `missions.jsonl` 冒充旧工作单。

任一关键字段、店铺、SKU、模板或页面身份变化后，旧 QA 必须失效。`waiting_human` 和 `failed` 不得只覆盖 `state` 而丢失可恢复状态。`draftFingerprint` 的“稳定”是指相同规范化业务内容得到相同指纹；实现必须固定键排序、空白、数字格式以及图片/SKU 顺序的规范化规则，修改关键内容后指纹必须变化。

### 3.2 状态机

```ts
type DxmListingState =
  | "observed"
  | "claimed"
  | "editing"
  | "draft_ready"
  | "saved_draft"
  | "submitted_pending_review"
  | "published_online"
  | "waiting_human"
  | "failed";
```

硬性规则：

- `dxm_smt_prepare` 最多到 `draft_ready` 或 `saved_draft`，不能到已提交/已上线。
- `waiting_human` 和 `failed` 必须保存断点、原因和下一步，不得伪造成终态成功。
- `submitted_pending_review` 只能由提交回执或提交记录支持。
- `published_online` 只能由商品链接或在线商品读回支持。
- 工具 `ok` 只表示本次工具调用是否执行成功；业务状态必须放在 `data.state` 和消息中明确表达。

### 3.3 动作证据与幂等

每个副作用动作按三层记录：

1. `observed`：动作前的商品、店铺、页面和已有状态；
2. `changed`：实际提交的变更；
3. `verified`：动作后的读回、平台回执或在线证据。

幂等身份优先使用来源记录 ID + 目标店铺 ID。缺少可靠 ID 时不得只靠标题判重。认领、保存和发布重试前必须先查目标位置是否已有同一商品；无法判重时停问，不再次点击。

---

## 4. 开发任务（按顺序执行）

### 执行前置：人工基线与决策登记

1. 规划方提供上位路线 P1-A 的脱敏人工基线和可用于只读复核的授权页面。未提供时，Cursor 只能完成纯状态机、夹具和适配器实现；真实选择器、平台回执和在线证据全部标“未跑/待基线”，不得声称真实链路已验证。
2. 实现前先把新链路决策点登记到 `DECISION-POINTS.md`，至少覆盖：身份/店铺不唯一停等、登录/权限/入口变化停等、标签失效和中断停止副作用、QA/指纹门、提交结果未知禁止重试。登记后再实现对应代码；不得新增本地意图路由接回旧脑区。
3. E8–E10 不得通过虚构业务值、故意发布违规商品或盲目断网重试制造结果。故障注入形式及能否计入产品退出由规划方事先明确；真实场景未发生就记“未跑”，不能用单测替代真实通过。

### T1：纯状态机、数据合同与测试夹具

**要求：**

1. 实现 §3 的工作单、状态和证据类型。
2. 用纯函数实现合法状态迁移，拒绝“准备完成直接变上线”等跳跃。
3. 建立最小 HTML/对象夹具：通用采集列表、通用编辑、速卖通编辑、提交回执、在线商品读回。
4. 夹具不包含真实账号、Cookie 或商业秘密。

**TDD 验收：**

- 草稿、待审、上线三状态严格区分；
- 无回执不能进入待审，无在线证据不能进入上线；
- `waiting_human` / `failed` 保留断点；
- 同一来源和店铺重复开执行记录时可关联原单，不重复认领。

### T2：只读页面探针与身份识别

**要求：**

1. 实现 `dxm_smt_probe`，只读识别：
   - `/web/productCrawl/dataAcquisition`；
   - `/web/productCrawl/edit?id=`；
   - 速卖通平台采集箱与 `/web/smt/edit`；
   - 店小秘提交/失败记录及可用的平台在线商品证据。
2. 读取来源记录 ID、草稿 ID、目标店铺和当前页面类型；无法唯一识别时返回人话原因。
3. 区分未加载、登录失效、验证码、无权限、入口变化和字段缺失。
4. 探针不得点击认领、保存、发布或修改字段。

**TDD 验收：**

- 各类页面不会互相误判；
- 非店小秘页面不会进入速卖通 QA；
- 店铺不唯一、商品不唯一时返回 `waiting_human`；
- 真机只读可由 Cursor 在已登录页面自测；未运行则如实记“未跑”。

### T3：本机证据日志、断点与标签绑定

**要求：**

1. 实现追加式本机日志和重启恢复，记录 §3 数据，不接入旧任务路由。
2. 工作单绑定来源标签和编辑标签；编辑中不得因来源查看而替换编辑页。
3. 恢复后先探测当前页面和已有结果，再决定可执行的下一步。
4. 运行中用户暂停、停止或新指令打断时，不得继续提交队列中的副作用动作。

**TDD 验收：**

- 重启回放后商品、店铺、草稿 ID 和状态一致；
- 已有关单不会被重复执行；
- 日志损坏单行不会让整个恢复崩溃；
- 编辑标签被关闭或 URL 改变时停止写操作，不刷新找回草稿。

### T4：单商品定位与认领到指定店铺

**要求：**

1. `dxm_smt_prepare` 支持参数：来源记录 ID/当前编辑页、目标店铺 ID 或用户明确选择的店铺名称。
2. 多商品、多店铺或无目标店铺时停问，不默认第一条。
3. 认领前查询目标速卖通采集箱是否已有同源草稿。
4. 认领后读回新草稿 ID、店铺绑定和来源关系，再进入编辑页。
5. 本任务只处理单商品，不实现批量认领。

**TDD 验收：**

- 已认领时复用现有草稿，不再次点击；
- 认领工具返回成功但读回不到草稿时不得进入编辑完成；
- 店铺授权失效、认领入口变化、页面超时均安全停等；
- 真机认领未获用户授权时只跑夹具，不得擅自操作。

### T5：动态编辑器与发布前字段模型

**要求：**

1. 按分组读取：基本信息、分类、属性、主图、变种图、描述图、SKU、价格库存、包装、模板、描述和合规信息。
2. 选择叶子分类后重新扫描当前类目必填项；不得使用固定字段白名单判断所有商品。
3. 下拉、共享弹层和屏幕外菜单采用“定位控件 → 打开 → 选择 → 读回 → 关闭”流程。
4. 每个字段记录来源与 `verified`。模型生成内容只能作为建议，未读回不得标 verified。
5. 价格、币种、货值、库存、重量、尺寸、模板、品牌和资质只接受：
   - 可靠来源值；
   - 用户明确提供值；
   - 用户明确批准的规则。
6. 缺运费模板时给处理说明，不自动创建；缺品牌/类目资质时不填“无品牌”等猜测值绕过。
7. 翻译后检查空译文、超长、SKU 变量丢失和可疑残留。残留中文只作风险项，不误伤合法品牌/专有名词，不自动删除。

**TDD 验收：**

- 分类变化后出现的新星号项会进入缺项清单；
- SKU 行列映射不串规格、价格和库存；
- 无模板、无资质、缺业务值时 QA 不得通过；
- 改值未读回不算成功；
- 合法英文品牌或专有名词不会因语言启发式被自动破坏。

### T6：图片与文字处理，复用旧执行经验

**要求：**

1. 分别跟踪主图、变种图、描述图，不以主图处理完成代替全部图片。
2. 图片尺寸处理按用户策略和当前平台要求执行，不机械凑满 6 张。
3. 图片翻译和页顶文字一键翻译分开调用、分开记录、分开验收。
4. 图片翻译、图片白底等可能收费的功能，在逐步确认和 auto 模式下都必须由模型先调用 `request_confirm`。确认内容写明工作单、具体收费功能、图片范围和页面可读取的费用信息；该确认独立于最终发布确认。只有用户下一条明确同意后才执行该次收费动作，不用本地“已确认”布尔值代替模型历史判断。用户拒绝后记录拒绝结果，保持对应图片项未完成，不扣费、不重试。
5. 文字字段一次性赋值并读回；图片任务等待处理完成，不点“取消”中止任务。
6. 复用旧 helper 时保留其有效保护，但不得调用旧 `runFullListing()`。

**TDD 验收：**

- 主图成功、变种图失败时整体图片项不得通过；
- 文字翻译成功不能抵图片翻译；
- 付费未确认不会执行收费动作；
- 图片处理中不会被弹窗清理逻辑取消；
- 改尺寸或翻译后无读回证据只记“已发起”，不记“已验证”。

### T7：发布前 QA、准备结果与草稿指纹

**要求：**

1. QA 输出 `pass | waiting_human | fail`，不得输出 `best_effort pass`。
2. `pass` 至少需要：商品/店铺身份一致、动态必填项齐、关键字段读回、图片失败项已处理、业务值有来源、无未解决权限/合规缺项。
3. `dxm_smt_prepare` 返回用户可读摘要：店铺、标题、类目、价格区间、库存合计、图片/翻译状态和风险。
4. 按 §3.1 的规范化规则对确认摘要和关键字段生成稳定 `draftFingerprint`；字段变化后指纹必须变化，旧 QA 同步失效。
5. 准备阶段不得调用发布，不得自动保存并发布合一。保存草稿若与发布是不同按钮，分开记录。

**TDD 验收：**

- 缺任一星号项、未读回字段或人工待办时 QA 不通过；
- QA 通过也不等于已上线；
- 修改价格、店铺、SKU 或模板后指纹变化；
- 准备结果消息不包含“发布完成”“已上线”等误导文案。

### T8：确认后发布、回执查询与防重复

**要求：**

1. `dxm_smt_publish` 只接受工作单 ID 和准备阶段 `draftFingerprint`，执行前重新读取当前草稿并比对。
2. 指纹不一致、工作单身份不一致、QA 失效或页面已变化时停止，要求重新准备/确认。
3. 逐步确认模式的模型路径必须先 `request_confirm`，`detail` 包含工作单 ID、目标店铺、准备摘要和本次 `draftFingerprint`；得到用户下一条明确同意后，才以同一工作单和指纹调用 `dxm_smt_publish`。不得在本地存“已确认”布尔值绕过模型历史判断；指纹变化必须重新准备、重新确认。
4. 自动执行模式保持 #34 现行语义；本阶段真机验收先只认证逐步确认模式，不借本任务扩大自动发布范围。
5. 每个工作单的发布调用必须串行化；已有发布调用执行中时，后续调用只返回当前尝试状态，不得再次点击。
6. 点击发布前先持久化 `publish_attempt_started`，包含工作单、店铺、草稿指纹和时间；点击后追加 `publish_clicked`。只有不存在未决发布尝试、QA 有效且指纹一致的 `draft_ready` / `saved_draft` 工作单可以进入点击步骤。
7. 出现 `publish_attempt_started` 或 `publish_clicked` 但没有最终回执时，无论超时、重启还是恢复，都先视为“提交结果未知”，进入 `waiting_human`，只允许状态查询；无法排除已提交时绝不再次点击。
8. `submitted_pending_review`、`published_online` 以及提交结果未知的工作单，重复调用 `dxm_smt_publish` 均只查询并返回已有状态，不再次提交。
9. 平台拒绝写入 `state=failed`、`receipt.kind="rejected"`，保留错误原文和字段定位。拒绝后不得直接重试；必须修改或补齐资料、重新 prepare、生成新指纹，并在逐步确认模式重新取得发布确认。
10. `dxm_smt_status` 不修改平台数据，但可以追加本机查询证据并更新工作单业务状态。查询不到结果不得自行推断失败或成功。状态查询按店小秘提交/失败记录、平台商品 ID、在线商品的顺序收集证据。
11. 在线链接必须对应本工作单的平台商品 ID 和目标店铺；不能凭任意可打开链接进入 `published_online`。

**TDD 验收：**

- 未准备、指纹不符、店铺改变时拒绝发布；
- 点击后、写点击证据前发生模拟崩溃，恢复后不二次点击；
- 待审、提交结果未知和已上线状态重复 publish 均不二次提交；
- 同一工作单并发 publish 只产生一次点击；
- 平台拒绝后旧指纹不能直接重发；
- 提交回执只能进入待审，无关联在线链接不能判上线；
- 只有本商品、本店铺的在线链接或在线列表读回才能进入 `published_online`。

### T9：接线、回归与交付记录

**要求：**

1. 按 §1.3 接入 Free Soul 和预览开关，不改变旧 `dxmEnabled()`，不把新 ID 加入旧 `WORKFLOWS`。
2. 新增一个 `dxm-smt-listing` 技能元数据，不为四个工具各建重复技能。只要求“数据采集箱上品前编辑、不认领”时使用旧 `dxm-crawl-prep`；明确要求“认领到指定速卖通店铺并发布”时由模型选择新技能。不得新增本地正则意图路由，不得修改旧技能合同兼容发布。
3. 新技能路线只能引导模型调用四个白名单工作流，不得用通用 `click` / `execute` 绕过 publish 的 QA、确认和防重逻辑。元数据写全 `declared_domains`、`declared_actions`、`human_gates`、`knownGaps`；预览关闭时目录可显示“尚未开放”，但 `run_skill` 不返回可执行路线，`run_workflow` 不执行。
4. 核对实现中的本地路线判断与执行前置的 `DECISION-POINTS.md` 登记编号一致；只有确实未新增任何本地路线判断时才写“无”。
5. 将 E1–E12 验收场景追加到 `QA-GOLDEN-SCENARIOS.md`，真实结果未跑就写未跑。
6. 在本文件末尾追加 Cursor 完成记录，列改动文件、测试、命令结果、真机结果和已知缺口。

**接线验收：**

- 四个 ID 的参数确实到达新入口，旧 ID 被 Free Soul 新通道拒绝；
- 关闭预览后 `run_workflow`、`run_skill` 均不能进入执行；
- 在认领、保存、收费翻译、发布前取消，后续动作均未发生；
- 来源标签和编辑标签不会串用，新旧技能选择及预览开关均有测试；
- §5 全部工程检查通过，没有真实证据的项目明确标“未跑”。

---

## 5. Cursor 必跑工程检查

每完成一个任务先跑对应测试；全部完成后运行：

```powershell
npm test
npm run typecheck
npm run lint
npm run build
```

要求：

- 先写失败测试再实现，测试只断言真实合同，不为迁就实现改坏既有测试。
- `lint` 不突破仓库允许的警告上限，也不新增与本次链路有关的警告。
- 全量测试失败时区分本次回归与既有失败，提供失败名称，不得只写“基本通过”。
- 不运行 `npm run dist`，不提交 git。
- 调试版侧栏相关按钮必须自点：点得到、下一步原地出现、暂停可续跑、控制台无报错。

---

## 6. 真机验收分工

### 6.1 Cursor 可做

- 默认只执行夹具、单测、静态检查、真实页面只读探针和侧栏接线检查。
- 未经用户当场明确授权，不得对真实账号页面执行任何写操作或任务动作，包括字段赋值、分类修改、图片处理、普通文字翻译、收费翻译、认领、保存和发布。
- 用户授权某一项动作不等于授权其余动作；收费功能和发布仍分别遵守独立确认门。
- §2 的全局禁区不因当场授权失效：仍不得批量认领/发布、换店铺、自动创建运费模板、删除重复商品、绕过验证码或直接自动操作 1688。
- 所有未执行的真实场景如实写“未跑”。

### 6.2 规划方复审

1. 逐任务审查 diff，重点检查是否接回旧脑区、解禁旧工作流或引入假完成。
2. 独立复跑全量测试、类型检查、lint、build。
3. 检查 `%APPDATA%\sparo-store` 商品工作单底账与平台证据是否一致。
4. 复跑只读场景、异常场景、确认门和防重复场景。
5. 真实认领、收费翻译和发布由用户在场授权后执行；发布前确认目标店铺、测试商品和可能留下的真实商品记录。

### 6.3 真机黄金场景

| 编号 | 场景 | 通过标准 |
|---|---|---|
| E1 | 无变种、资料齐全商品 | 正确店铺，草稿读回，确认后提交，最终获得在线链接 |
| E2 | 多变种商品 | SKU 不串行，价格库存逐一读回，规格变量未丢失 |
| E3 | 分类后新增星号属性 | 能发现新必填项；缺资料进入人工待办 |
| E4 | 无品牌/类目资质 | 不虚构、不发布，指出处理入口 |
| E5 | 无运费模板 | 不随机选择、不自动创建，给出处理说明 |
| E6 | 拒绝付费图片翻译 | 不扣费、不重复请求，图片项保持未完成 |
| E7 | 登录失效或验证码 | 停等，用户处理后从原工作单续跑 |
| E8 | 保存成功、发布被拒 | 草稿和发布失败分开显示，保留平台错误原文 |
| E9 | 发布点击后超时 | 先查重查回执，不二次发布，状态可核验 |
| E10 | 入口或弹层变化 | 能安全重定位才继续，否则暂停，不死点不误提交 |
| E11 | 中断后说“继续” | 同商品同店铺从断点续跑，不重新认领 |
| E12 | 安装包完整回归 | 规划方制作安装包后，电商完整链路取得真实回执，且现行 G1、G2、G3 无回归 |

第一阶段退出口径：

1. 单工作单只有取得 §0 的 `published_online` 证据才算业务完成；E3–E10 等异常场景按各自“安全停等、正确报错、无副作用或不重复发布”的标准验收，不要求上线。
2. 在最近连续 10 次“资料齐全、目标明确、用户已确认、本可上线”的完整真实发布尝试中，至少 9 次取得 `published_online`。这是连续 10 次尝试，不是宣称连续 10 次成功。
3. E3–E10 不计入上述上线成功率分母，但必须分别达到场景预期；全部真实执行中的假完成和重复发布均为 0。
4. E12 由规划方在代码复审后运行 `npm run dist` 制作安装包并复测。Cursor 不运行该命令，因此 Cursor 代码交付完成不等于 E12 或第一阶段产品验收完成。
5. 没有真实证据的项目写“未跑”；单测、故障夹具和调试版结果不得改写成安装包或真实平台通过。没有平台测试环境时，不为了凑次数自动创建或删除真实商品。

---

## 7. 完成定义与打回条件

### Cursor 代码交付完成

- T1–T9 均有代码、测试和完成记录；
- 全量测试、类型检查、lint、build 通过；
- 预览关闭时不暴露执行，预览打开时只暴露新白名单工作流；
- 未获授权的真实操作全部标“未跑”。

### 第一阶段产品验收完成

- 规划方复审通过；
- E1–E12 真实场景达到上位路线的退出门槛；
- 每次上线成功都有独立商品证据；
- 假完成和重复发布为 0；
- 用户仅凭任务卡就能理解结果与下一步。

### 出现以下任一情况直接打回

- 用旧 `runFullListing()` 代替新链路；
- 把 `dxmEnabled()` 改为 true 或接回旧任务路由；
- 保存、提交、待审被写成上线；
- 发布后超时不查重就重试；
- 价格、资质、模板等由模型猜测补齐；
- 未确认收费或逐步确认模式下未确认发布；
- 只交付单测绿，没有底账、回执和真机记录；
- 顺手修改无关 UI、云订阅、商店文案或其他平台技能。

---

## 8. Cursor 完成记录（执行后填写）

执行日期：2026-11-07。规划方未提供脱敏人工基线，也未当场授权真实写操作。本记录只认夹具和单测。E1–E12 真机全部未跑。未运行 `npm run dist`，未提交 Git。

| 任务 | 改动文件 | 新增测试 | 决策点 | 真机结果 | 已知缺口 |
|---|---|---|---|---|---|
| T1 | `src/main/workflows/dxm-smt-contract.ts` | `tests/dxm-smt-listing.test.ts` 状态迁移；`tests/fixtures/dxm-smt/` 采集列表、编辑页、速卖通编辑、提交记录、失败记录、在线列表、登录、验证码、无权限、未加载、其他站点 | #35 | 未跑 | 夹具没有真实选择器和平台回执 |
| T2 | `src/main/workflows/dxm-smt-page.ts` | 同上，页面分类与身份停等 | #35 #36 | 未跑 | 只读探针没有在已登录页面跑过 |
| T3 | `src/main/workflows/dxm-smt-journal.ts` | 重启回放、坏行跳过、关单不重复执行、编辑标签失效 | #37 #39 | 未跑 | 日志只在测试临时目录验证，未核对 `%APPDATA%\sparo-store\dxm-smt-journal.jsonl` |
| T4 | `src/main/workflows/dxm-smt-listing.ts` 的 `dxm_smt_prepare` | 已认领复用、读回不到草稿不停在编辑完成、授权/入口/超时停等 | #35 #36 #37 | 未跑 | 真实认领未执行 |
| T5 | `dxm-smt-fields.ts` | 分类后新必填项、SKU 对齐、无来源业务值拒绝、专有名词不改写 | #38 | 未跑 | 下拉和共享弹层没有真机“定位→打开→选择→读回→关闭” |
| T6 | `dxm-smt-images.ts` | 主图成功不能抵变种图失败、收费拒绝不调用、图片任务中不取消、无读回只记已发起 | #38 | 未跑 | 未调用真实图片翻译或文字翻译 |
| T7 | `dxm-smt-qa.ts`、`dxm-smt-fingerprint.ts` | QA 只有 pass / waiting_human / fail；指纹随价格、店铺、SKU、模板变化；准备文案不含“发布完成”“已上线” | #38 | 未跑 | QA 通过只存在于夹具 |
| T8 | `dxm-smt-listing.ts` 的 `dxm_smt_publish` / `dxm_smt_status` | `tests/dxm-smt-publish.test.ts`：指纹门、崩溃后不二次点击、待审和已上线不重发、并发只点一次、拒绝保留原文、在线证据才上线 | #38 #39 | 未跑 | 没有真实发布回执。自动发布范围没有扩大 |
| T9 | `dxm-smt-preview.ts`、`dxm-smt-live.ts`、`strategies/skills/dxm-smt-listing.json`；`free-soul.ts` 增加 `run_workflow`；`browser.ts` 的 `runCoreTool` 白名单分发和技能目录“尚未开放”；`skills/runner.ts` 预览关闭不返回路线；`docs/QA-GOLDEN-SCENARIOS.md` 追加 E1–E12；`docs/DECISION-POINTS.md` #35–#39 | 接线测试在 `tests/dxm-smt-listing.test.ts`：新入口、旧 ID 拒绝、预览关闭、取消后续动作、新旧技能合同 | #35–#39 | 未跑 | 见下方缺口。侧栏未新增按钮，因此没有自点 |

同一工作单的四个工作流 ID 是 `dxm_smt_probe`、`dxm_smt_prepare`、`dxm_smt_status`、`dxm_smt_publish`。预览开关是 `SPARO_DXM_SMT_PREVIEW=1`。`dxmEnabled()` 仍固定为 false。新 ID 没有加入旧 `WORKFLOWS`，也不经过旧 `runWorkflow()`。`dxm-crawl-prep` 合同未改。实现里没有调用 `runFullListing()`。

`docs/DECISION-POINTS.md` 的 #35–#39 已在当前 HEAD `91fa329` 中。本记录填写时该文件相对 HEAD 无新增 diff。

`src/main/browser.ts` 的未提交 diff 里，除上述 `run_workflow` 分发和技能“尚未开放”外，还有侧栏增量同步。那部分和 `src/main/sidebar-sync.ts`、`src/renderer/shell.html`、`src/main/page-bounds.ts`、`tests/chrome-hole.test.ts` 不属于本任务。

### 工程命令（2026-11-07 当场结果）

- `npx vitest run tests/dxm-smt-listing.test.ts tests/dxm-smt-publish.test.ts`：2 个文件、44 项通过（listing 36，publish 8）。
- `npm test`：101 个文件，753 项。通过 752，失败 1。失败名称：`tests/chrome-hole.test.ts` > `T2 降频恢复` > `同一次断言会停放每一个仍在屏幕内的后台页`。断言期望第二个后台页 `x === -20000`，实际是 `30`（该文件约第 493 行）。这条失败在本任务未修改的页面洞测试里，本链路两个测试文件均通过。不得写成全量通过。
- `npm run typecheck`：通过，退出码 0。
- `npm run lint`：通过，退出码 0。0 个 error，20 个 warning，未超过上限 50。警告都在既有文件（`chart.ts`、`read.ts`、`travel.ts`、`browser.ts`、`skills/store.ts`），本次 `dxm-smt-*` 没有新增警告。
- `npm run build`：通过，退出码 0。`electron-vite build` 产出 main、preload 和 renderer。
- `npm run dist`：未运行。
- Git：未提交。

### 已知缺口

- 没有脱敏人工基线。`dxm-smt-live.ts` 的写操作（认领、写字段、翻译、保存、发布、选分类）在没有已核对标记时停等，不盲点。真实选择器、平台回执和在线证据都未跑。
- E1–E12 真机全部未跑。E12 安装包不在本次。
- 保存、提交、待审都不是完成。完成只认 `published_online`，且必须是本商品、本店铺的在线链接或在线列表读回。本次没有任何在线商品证据。
- 全量测试有 1 项既有页面洞失败，名称见上。复审时请单独区分，不要算进本链路通过数。

规划方复审意见另追加在下面，不覆盖以上记录。

### 规划方第一次复审（2026-11-07）：打回，暂不进真机或安装包

复审基线：HEAD `841a0db` 加当前未提交的 `dxm-smt-*` 新文件。复审期间工作区有其他任务提交，故工程数量与 Cursor 原记录不同；本记录只描述实际复跑结果。

- `npx vitest run tests/dxm-smt-listing.test.ts tests/dxm-smt-publish.test.ts`：44/44 通过。
- `npm test`：102 个文件、757/757 通过；未复现原记录中的页面洞失败。
- `npm run typecheck`：通过。
- `npm run lint`：通过，0 error、19 个既有 warning。
- `npm run build`：通过。
- 未运行 `npm run dist`，未操作真实账号，E1–E12 真机仍未跑。

测试通过不代表满足任务书。Cursor 需先修完以下问题并补回归测试：

1. **Critical：收费确认过宽。** `dxm-smt-images.ts` 的 `decidePaidAction` 对任意非空且不含拒绝词的文本都返回执行，例如“等待确认”也会通过。这不符合 #28 和 T6。缺失、模糊、未发生确认往返的输入一律不得执行；不得另建本地正则意图路由代替模型看历史。补模糊文本、伪造同意和确认后范围变化测试。
2. **Critical：发布没有强制绑定工作单标签和草稿身份。** `dxm-smt-listing.ts` 发布读取、写字段和点击都使用 `port.tabId`，而 `editTabWritable` 只检查旧绑定标签；当前 Agent 标签切换后可能操作另一张草稿。发布前必须确认当前执行标签就是 `editTabId`，并精确核对来源记录、草稿 ID、店铺 ID 和 URL；认领返回的店铺也必须核对。补跨标签、跨草稿、同内容不同草稿测试。
3. **Critical：指纹与发布前实时 QA 不完整。** `dxm-smt-fingerprint.ts` 未纳入动态 `fields`、描述和图片处理状态，`dxm_smt_publish` 也不重跑完整 QA。确认后修改动态必填属性或图片由通过变失败，旧指纹仍可能通过。指纹必须覆盖全部关键业务内容，点击前重读并重新执行完整 QA。补动态属性和图片状态变化测试。
4. **Critical：prepare 与 publish 存在覆盖竞态。** 当前只有 publish 锁；prepare 持有旧快照时，publish 可写入待审/上线，随后 prepare 又把同单覆盖回草稿，导致再次发布。同一工作单的准备、发布和状态写回必须串行，保存前重载并做版本/CAS 防覆盖。补 prepare/publish 交错测试。
5. **Required：恢复和状态查询不能闭环。** prepare 没有从 `waiting_human` / `failed` 的 checkpoint 恢复；`queryExisting` 忽略 `submitRecord`、`failureRecord` 和 `platformProductId`，且只在已待审时接受在线证据。点击后崩溃的工作单即使查到提交或在线证据也无法正确迁移。现有测试夹具在发布前就预填 `platformProductId=P1`，掩盖了该问题。补无预填平台 ID、点击后崩溃、拒绝后修复再准备、E11 续跑测试。
6. **Required：认领防重和动作证据未完成。** 认领前没有可靠的目标箱同源查重，认领尝试没有在副作用前持久化；多个同源未关单关联为歧义时反而可能新建工作单。认领、写字段、分类、翻译、保存和发布也没有逐项写入 `observed / changed / verified`，保存草稿缺独立回执或读回。`asStoredProvenance` 还会把 suggestion 存成 readback。按 §3.3 和 T4 补齐，歧义必须停等。
7. **Required：文字翻译链路实际未接。** `translateText` 在 prepare 中从未调用，摘要固定写“未发起”；`selectCategory` 的失败结果也被忽略。实现文字翻译独立调用、读回和验收，分类选择失败或读回不是目标分类时不得继续 QA。

修复期间仍不得真实写入或发布。规划方复审上述问题通过后，才进入只读真机、用户在场授权的写操作和后续安装包验收。

### Cursor R1 修复记录（2026-11-07）

当前 HEAD `409656a`。未提交 Git，未运行 `npm run dist`，未操作真实账号。E1–E12 真机仍未跑。mock 通过不是真实链路通过。

| 项 | 修改文件 | 关键设计 | 新增测试 |
|---|---|---|---|
| R1-1 | `dxm-smt-images.ts`；`free-soul.ts` 的 `request_confirm` | 删除“非空且无拒绝词就执行”。收费只消费本次确认句柄，绑定工作单、功能、范围和费用；用过即失效。文本和自报同意不能发句柄。决策点 #40 | `tests/dxm-smt-r1.test.ts` 未确认/模糊/伪造/跨单/跨范围/费用变化不执行；合法句柄只执行一次且不发布 |
| R1-2 | `dxm-smt-page.ts` `publishIdentityMatches`、`resolveIdentity`；`dxm-smt-listing.ts` | 发布前执行标签必须是 `editTabId`，来源、草稿、店铺、URL 都要非空且精确匹配。认领店铺不一致不进入编辑。指定店名无精确匹配时不默认唯一店 | 换标签、换草稿、来源或 URL 不匹配点击数为 0；错误店铺不写字段 |
| R1-3 | `dxm-smt-fingerprint.ts`；发布前重跑 `evaluateQa` | 指纹纳入动态字段、描述、图片处理状态、SKU、模板和页面身份。`verified` 不进指纹，所以值相同但未读回时指纹可以相同，QA 仍拒绝。点击前重新读探针和字段 | 材质、描述、SKU、模板、图片状态变化；新必填和未读回不发布 |
| R1-4 | `dxm-smt-listing.ts` 同单锁；`dxm-smt-journal.ts` `commitOrder` | prepare、publish、会写回的 status 按工作单串行。保存使用 revision。对不上就返回盘上新状态。查询在锁内走无锁 helper。决策点 #41 | prepare 持锁时 publish 不点击，结束后点击 1 次且状态不被盖回；旧 revision 和 status 不能覆盖新回执；不同工作单可并行 |
| R1-5 | `dxm-smt-contract.ts` `applyStatusEvidence`；prepare 恢复断点 | 提交记录写入平台商品 ID 并进入待审；失败记录进入 failed；同 ID 在线证据才上线。点击后崩溃可被查询解析。拒绝后重新 prepare 会重读并换指纹。正常草稿不再预填 `platformProductId` | 无预填 ID 的待审到上线；崩溃后查询不二次点击；旧指纹失效；其他在线商品不能上线；E11 续跑不重新认领 |
| R1-6 | `dxm-smt-listing.ts` 认领与 `evidence` | 认领前查目标箱。副作用前写入 `claim_attempt_started`。多张未关同源单停等且不新建。动作记录 observed / changed / verified。suggestion 保持原样，不再改写成 readback | 落账前崩溃不重复认领；歧义停等；失败动作 verified 为 false |
| R1-7 | `dxm-smt-listing.ts`；`dxm-smt-fields.ts` `textReadbackIssues` | prepare 调用 `translateText` 并读回。摘要写“文字翻译已读回”或“文字翻译失败”，不再固定“未发起”。分类失败或读回不一致时停止写字段。不因此调用收费图片 | 文字和图片分开记录；空译文 QA 不通过；分类失败不再写字段 |

原 `tests/dxm-smt-listing.test.ts` 与 `tests/dxm-smt-publish.test.ts` 共 44 项仍在，并且通过。T6 里“任意同意文本就执行”的两条断言已按 R1-1 收紧为不执行，不是放宽。`tests/dxm-smt-r1.test.ts` 新增 21 项。三份一起是 65 项，全部通过。

### R1 工程命令（2026-11-07 当场）

- `npx vitest run tests/dxm-smt-listing.test.ts tests/dxm-smt-publish.test.ts tests/dxm-smt-r1.test.ts`：3 个文件，65 项通过。
- `npm test`：104 个文件，780 项。通过 779，失败 1。失败名称：`tests/chrome-hole.test.ts` > `T2 降频恢复` > `同一次断言会停放每一个仍在屏幕内的后台页`。期望第二个后台页 `x === -20000`，实际 `30`（约第 493 行）。`git grep` 在 HEAD `409656a` 的该文件里找不到“仍在屏幕内”，这条断言在未提交的 `tests/chrome-hole.test.ts` 和 `src/main/page-bounds.ts` 里。这两处不是 R1 改动，没有改它们。
- `npm run typecheck`：通过，退出码 0。
- `npm run lint`：通过，退出码 0。0 个 error，19 个 warning，未超过上限 50。警告都在既有文件：`chart.ts`、`read.ts`、`travel.ts`、`browser.ts`、`skills/store.ts`。本次 `dxm-smt-*` 和 `free-soul.ts` 没有新增警告。
- `npm run build`：通过，退出码 0。
- `npm run dist`：未运行。
- Git：未提交。

### 仍未完成

- 没有脱敏基线。live 写操作仍然停等，真实选择器、平台回执和在线证据未跑。
- E1–E12 真机未跑。安装包和 E12 不在本轮。
- 保存、提交、待审、结果未知都不是上线。本轮没有在线商品证据。
- 全量测试有 1 项页面洞失败，见上，不算进本链路通过数。

### 规划方第二次复审（2026-11-07）：R1 仍未通过，继续打回

复审基线：HEAD `409656a` 加当前未提交的新链路文件。未修改产品代码，未运行 `npm run dist`，未操作真实账号。

- 三份定向测试：65/65 通过，其中 R1 新增 21 项。
- `npm test`：104 个文件、780/780 通过；本次未复现页面洞失败。
- `npm run typecheck`：通过。
- `npm run lint`：通过，0 error、19 个既有 warning。
- `npm run build`：通过。

R1-4 的同单串行/CAS、基础完整指纹、拒绝后续跑、分类读回和 provenance 保留已基本落实，但以下问题仍阻断代码验收：

1. **Critical：确认句柄仍不证明用户已同意。** `free-soul.ts` 在 `request_confirm` 当轮、用户回答之前就调用 `registerPaidConfirmFromArgs` 发句柄，且没有把句柄交给后续模型调用。`dxm-smt-images.ts` 的 `matchTicket` 又允许省略 confirmId 自动选中同范围票据，所以未确认也能执行。票据没有用户确认轮次、时效或图片 src 摘要绑定。现有测试直接调用 `issuePaidConfirm`，没有走真实确认对话链。必须在用户下一条明确同意后才激活一次性句柄，执行时显式提供句柄，不得自动匹配；补确认前、拒绝、换图、过期和完整对话往返测试。
2. **Critical：发布实时 QA 仍缺页面门禁。** `dxm-smt-listing.ts` 发布前没有检查 `classifyPage(probe)` 的验证码、权限、登录和 fields_missing blocker，也没有把 `probe.missingFields` 纳入 QA。`probe.shops` 只是店铺列表，包含目标店铺不能证明当前草稿属于该店铺。必须验证当前编辑页无 blocker、动态页面缺项为空，并读回当前草稿的实际店铺绑定。
3. **Critical：状态证据可收养其他商品并假上线。** `StatusEvidence.submitRecord` 只有 text/productId，没有来源记录、草稿或店铺关联；`applyStatusEvidence` 在本单无平台 ID 时会直接收养任意 readId，再接受同店同 ID 的在线记录。提交记录和平台 ID 读回必须带来源/草稿/店铺关联并精确匹配，否则只能停等，不能进入待审或上线。补“他品提交记录 + 他品在线记录”的反向测试。
4. **Critical：认领仍有重复和失败绕过路径。** 缺少 `lookupDraft` 时新单被当成 absent，而不是 unknown；claim 失败但返回 draftId 时会先保存该 ID，下次作为 knownDraft 跳过认领；两个无 workOrderId 的并发请求会各自生成新 ID，同单锁无法防止双认领。查重能力缺失必须停等，只有认领成功且店铺/来源读回匹配才能保存 draftId，并按来源+店铺原子预留工作单身份。补这三条测试。
5. **Required：文字翻译仍可能沿用旧验证状态。** prepare 的字段只从旧 fields 复制 verified，第二次读回缺字段或 verified=false 时仍可能保留旧 true；`{ ...reread, ...snapshot }` 让旧快照覆盖新读回，空描述还会被旧描述回填。翻译后的标题、动态字段、描述和 verified 必须以最新读回为准，缺失就失败，不得用旧快照补齐通过。
6. **Required：崩溃回归仍打在点击前。** `tests/dxm-smt-r1.test.ts` 的“点击后崩溃”仍在 `beforeClick` 抛错且点击数为 0。增加点击已发生、本地 clicked/receipt 尚未落账的故障注入，验证平台已提交而本地只有 attempt_started 时，恢复只查询、不再次点击，并能凭关联证据关单。

以上修复前仍不进入真机写操作、真实发布或安装包验收。
