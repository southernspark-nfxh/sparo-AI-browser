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

### Cursor R2 修复记录（2026-11-07）

当前 HEAD `d4dbe83`。未提交 Git，未运行 `npm run dist`，未操作真实账号。E1–E12 真机仍未跑。真实选择器和安装包仍未验收。定向测试通过只代表代码验收候选，不是真机上线。

| 项 | 修改文件 | 时序 / 合同 | 新增测试 |
|---|---|---|---|
| R2-1 | `dxm-smt-images.ts`；`free-soul.ts` | `request_confirm` 当轮只登记 pending，句柄放进工具结果 data，不写进给用户看的正文。下一条用户消息的 Free Soul run 才允许显式 confirmId 消费。省略句柄不再自动匹配。消费、跨轮、过期、换图、换费用、换工作单都失效。决策点 #40 已改成“请求时 pending，下一条明确同意后显式消费” | `tests/dxm-smt-r2.test.ts`：脚本化两轮往返；未回答、拒绝、模糊不调用准备；省略句柄、换图、过期、跨轮、跨单不执行；同意只执行一次且不发布 |
| R2-2 | `dxm-smt-page.ts`；`dxm-smt-listing.ts` | 发布读字段前先 `classifyPage`。登录、验证码、无权限、未加载、入口变化、非编辑页、`fields_missing` 都停等并留断点。`probe.missingFields` 并入 QA。当前草稿必须有 `draftShopId`，店铺列表不能代替 | 六类页面门点击数为 0；shops 含 S1 但草稿属于 S2、店铺字段缺失都不点；合法 S1 才进入后续 QA 并点击 |
| R2-3 | `dxm-smt-contract.ts` `applyStatusEvidence` | 提交、失败、平台 ID 至少要 draftId + shopId，有 sourceRecordId 时也必须一致。裸 productId 不改变状态。多条记录按关联挑选，不取最新一条。本单还没有关联提交写入的平台 ID 时，不从在线列表收养 | 他品提交 + 同店在线不上线；缺关联、草稿/来源/店铺冲突都停等；他品失败不让本单失败；合法关联提交给 P1 后再同店同 ID 上线 |
| R2-4 | `dxm-smt-listing.ts` | 没有 `lookupDraft`、超时或无法判定都是 unknown，认领数为 0。claim 失败或来源/店铺未读回时不写 `claimedDraftId`。来源 + 店铺在生成新工作单前原子预留。`afterClaim` 落在平台返回之后、草稿落账之前 | 无查重不认领；失败草稿号不能绕过下次查重；同来源并发只建一单；不同来源可并行；平台已认领、本地崩溃后复用目标箱 |
| R2-5 | `dxm-smt-listing.ts`；`dxm-smt-fields.ts` | 标题、描述、动态字段和 verified 只来自翻译后的 reread，不再用旧快照回填。空标题、空描述进入 `textReadbackIssues`。图片仍单独读回。指纹和准备摘要用这份最新视图 | 翻译后字段缺失或 verified=false 时 QA 不通过；空标题和空描述不通过；最新标题进入指纹；完整读回才 `draft_ready` |
| R2-6 | `dxm-smt-listing.ts` `afterClick` | `clickPublish` 成功返回之后、回执落账之前注入崩溃。本地只留下 `publish_attempt_started`。恢复的 status 和再次 publish 都不再点击。R1 的点击前崩溃测试保留并改名 | 点击数先到 1，回执未落账；关联提交收成待审，同店同 ID 在线收成上线，点击数保持 1 |

原 65 项仍在：`tests/dxm-smt-listing.test.ts` 36 项，`tests/dxm-smt-publish.test.ts` 8 项，`tests/dxm-smt-r1.test.ts` 21 项。`tests/dxm-smt-r2.test.ts` 新增 10 项。四份一起 75 项，全部通过。

R1 里会把无关联提交记录收成待审的夹具，已补上 draftId、shopId、sourceRecordId，断言仍是待审或上线，不是放宽。点击前崩溃测试保留，点击数仍是 0。

### R2 工程命令（2026-11-07 当场）

- `npx vitest run tests/dxm-smt-listing.test.ts tests/dxm-smt-publish.test.ts tests/dxm-smt-r1.test.ts tests/dxm-smt-r2.test.ts`：4 个文件，75 项通过。
- `npm test`：106 个文件，797 项。通过 796，失败 1。失败名称：`tests/chrome-hole.test.ts` > `T2 降频恢复` > `同一次断言会停放每一个仍在屏幕内的后台页`。期望 `x === -20000`，实际 `30`（约第 493 行）。`tests/chrome-hole.test.ts` 与 `src/main/page-bounds.ts` 相对 HEAD `d4dbe83` 无本地改动，这条失败在当前 HEAD 上复现。没有改它们。
- `npm run typecheck`：通过，退出码 0。
- `npm run lint`：通过，退出码 0。0 个 error，19 个既有 warning，未超过上限 50。警告仍在 `chart.ts`、`read.ts`、`travel.ts`、`browser.ts`、`skills/store.ts`。本次 `dxm-smt-*` 和 `free-soul.ts` 没有新增警告。
- `npm run build`：通过，退出码 0。
- `npm run dist`：未运行。
- Git：未提交。

### 仍未完成

- 没有脱敏基线。live 写操作仍然停等。真实选择器、平台回执和在线商品证据未跑。
- E1–E12 真机未跑。安装包和 E12 不在本轮。
- 保存、提交、待审、结果未知都不是上线。
- 全量测试有 1 项页面洞失败，见上，不算进本链路通过数。
- 复审通过前继续禁止真实写操作和发布。

### 规划方第三次复审（2026-11-07）：R2 主路径有进展，但仍不通过

复审基线：HEAD `d4dbe83` 加当前未提交文件。未修改产品代码，未运行 `npm run dist`，未操作真实账号。复审期间工作区另有页面可见性测试加入，因此全量数量与 Cursor 记录不同。

- 四份定向测试：75/75 通过，其中 R2 新增 10 项。
- `npm test`：107 个文件、800 项，799 通过；唯一失败仍是 `tests/chrome-hole.test.ts:493`，第二个后台页期望 x=-20000、实际 30。
- `npm run typecheck`、`npm run lint`、`npm run build`：通过；lint 0 error、19 个既有 warning。

已落实：无 confirmId 自动匹配已删除，pending/下一轮显式消费主路径成立；发布 blocker、draftShopId 和动态缺项门已加入；提交/失败/在线证据按 draft+shop 关联；真正的 afterClick 崩溃恢复已覆盖。

仍有以下阻断问题：

1. **Critical：原子建单仍可绕过。** `dxm-smt-listing.ts:160-187` 只有“未传 workOrderId 且 sourceRecordId、shopId 都已传”才进入身份锁。两个未预传来源/店铺的当前页请求，或分别指定不同新 workOrderId 的请求，都能绕过同身份串行并重复认领。身份解析后必须再次按来源+店铺原子预留；显式 workOrderId 也要核对同身份未关单。
2. **Critical：错店草稿仍会被写入。** `dxm-smt-listing.ts:239-297` 直接采用 `probe.draftId`，没有核对其 `draftShopId`；查到的 found 草稿缺 shopId 也会接受。目标 S1、当前草稿 D1/S2 时仍可能执行 writeField 和 translateText。所有 knownDraft/probe/found 路径都必须精确读回 draftId+shopId+recordId，缺关联只能停等。
3. **Critical：空 SKU 或变量整项丢失仍可能通过并发布。** `dxm-smt-listing.ts:354-358,402-433` 只从翻译后的 SKU 收集变量；reread.skus=[] 时没有 token、对齐成功，`dxm-smt-qa.ts:21-25` 又不检查 SKU。必须把翻译前 SKU 行数、规格变量和关键值与翻译后逐行核对；原本有 SKU 而读回为空、规格/价格/库存丢失均不得 QA 通过。
4. **Required：最新字段读回仍被旧状态覆盖。** `dxm-smt-listing.ts:687-704` 在旧字段 verified=false 时，即使最新 reread 已 verified=true，也保留旧值并标 false，导致修复后无法通过。最新读回必须决定值和 verified，旧数据只保留来源等元信息。
5. **Required：变种图/描述图的合法收费确认无法消费。** Free Soul 要求 scope 是当前图片 src 摘要，但 `dxm-smt-listing.ts:375,765-769` 通过“变种/描述”文字推断组；纯 src 摘要会被归到 main，再与实际 variant/description 摘要比对失败。确认合同应显式携带 group + srcDigest，执行时同时精确匹配，不再靠文字猜组。
6. **Required：lookupDraft 异常没有转成安全停等。** `dxm-smt-listing.ts:624-627` 未捕获 reject/timeout，不能按合同返回 unknown，也不会保存 waiting_human/checkpoint。捕获异常并保留原因、可靠断点和下一步。

修复前仍不进入真机写操作、真实发布或安装包验收。

### Cursor R3 修复记录（2026-11-07）

HEAD `40f61dc` 加未提交改动。没有提交 Git，没有运行 `npm run dist`，没有操作真实账号，没有改页面洞、侧栏或 `docs/listings/`。`dxmEnabled()` 仍是 false。

- **R3-1** `dxm-smt-listing.ts`：身份解析之后、选定工作单之前加来源+店铺锁。当前页没传来源和店铺也会锁。显式新工作单号如果已有同身份未关单，并到那张单，不另认领。
- **R3-2** 同文件：采用草稿前必须同时读回 draftId、shopId、recordId。对不上或缺少任一项就停等，不写字段、不翻译、不把缺店铺的 found 写成已认领。恢复夹具补了 `recordId: "R1"`。
- **R3-3** `dxm-smt-fields.ts` `skuContinuityIssues`，`dxm-smt-qa.ts` 增加 `skuProblems`。翻译前有 SKU，读回为空、规格、价格或库存丢失，QA 不通过，发布点击数为 0。原先没有 SKU 的空对空不误伤。
- **R3-4** `projectTranslatedFields` 的值和 verified 跟最新读回。旧字段只保留来源等元信息。`改值未读回不算成功` 改为：写操作证据仍是未验证；最新读回已验证时 QA 可以通过。
- **R3-5** 收费确认显式带 `group`（main / variant / description）和 src 摘要。不再用「变种 / 描述」猜组。缺组、组与摘要不一致都不执行。变种图 `v1.jpg`、描述图 `d1.jpg` 可以各执行一次。决策点 #40 已改成同一口径。
- **R3-6** `lookupClaim` 捕获 reject / timeout，转成 unknown，停在 `waiting_human`，checkpoint 留下原因、可靠断点和下一步。认领数为 0。

测试：`tests/dxm-smt-r3.test.ts` 8 项。定向五份合计 83/83（listing 36、publish 8、r1 21、r2 10、r3 8）。

当场结果：

- `npm test`：109 个文件、813 项，812 通过。唯一失败仍是 `tests/chrome-hole.test.ts:493`，第二个后台页期望 x=-20000、实际 30。本轮没有改这个文件。
- `npm run typecheck`：通过。
- `npm run lint`：0 error、19 个既有 warning。
- `npm run build`：通过。

未跑：E1–E12、真实选择器、真实发布、安装包。保存、提交、待审都不是上线。复审通过前继续禁止真实写操作和发布。

### 规划方第四次复审（2026-11-08）：R3 仍不通过

复审基线：HEAD `40f61dc` 加当前未提交改动。规划方未修改产品代码，未提交 Git，未运行 `npm run dist`，未操作真实账号。

独立复跑结果：

- 九份定向测试合计 105/105，通过范围包括店小秘五份 83 项及 Free Soul v16–v19 等相关回归。
- `npm test`：109 个文件、813/813 通过。此前页面洞用例在本次复跑中通过，本轮未修改该模块。
- `npm run typecheck`、`npm run lint`、`npm run build`：通过；lint 为 0 error、19 个既有 warning。

已核实落实：最新字段读回决定值和 verified；写操作自身未读回时仍保持未验证；收费确认显式绑定图片组和 src 摘要；查重异常可留下 waiting_human、原因和可靠断点。现有 R3 测试覆盖了这些正向路径。

仍有以下三项阻断问题：

1. **Critical：首次探针失败或暂时缺身份时，仍会绕过来源+店铺原子建单。** `dxm-smt-listing.ts:163-188` 的 `resolveBound()` 在 `readProbe` reject 或身份不完整时返回 `undefined`，`runPrepare()` 随即无身份锁进入 `openPrepare()`。两个并发请求若首次探针都失败、第二次探针又恢复为同一 R1/S1，会分别按不同工作单号建单并认领；现有测试只覆盖首次探针成功。探针异常或身份不足必须安全停等，不能降级为无锁建单，并需补“首次失败、随后恢复”的并发回归。
2. **Critical：持久化工作单身份仍被冒充为当前页面草稿读回。** `dxm-smt-listing.ts:270-285` 在当前 probe 没有 draftId 时，用工作单自己的 claimedDraftId、shopId、recordId 构造 `knownDraft`。这只是工作单自证，不是当前草稿的 draft+shop+record 读回，后续仍可能写字段和翻译。已认领草稿也必须在当前执行页面重新核对三项身份；缺当前读回只能停等，并补该路径的零写操作、零翻译测试。
3. **Critical：SKU 连续性仍允许改值和新增行。** `dxm-smt-fields.ts:122-141` 只遍历翻译前 SKU，价格、库存只检查是否变空，不检查未经批准的变化，也不检查 after 新增行。红色 SKU 从 price=10/stock=5 变成 999/0，或额外增加蓝色 SKU，均可能通过 QA 并进入发布。翻译前后必须核对完整行集合、规格、价格和库存；业务值变化只能走有明确来源的独立变更路径，并补改值、新增行及发布点击数为 0 的回归。

结论：R3 代码复审不通过，暂不进入只读真机、真实写操作、真实发布或安装包验收。测试全绿不能替代上述未覆盖路径。

### Cursor R3 复审修复记录（2026-11-08）

HEAD `40f61dc` 加未提交改动。没有提交 Git，没有运行 `npm run dist`，没有操作真实账号，没有改页面洞。

- **探针失败或身份不完整不再无锁建单。** 没有同时传来源和店铺时，第一次探针如果失败，或身份还不完整，直接停等，不进入准备、不建单、不认领。并发里前两次探针失败、后面即使能读回同一 R1/S1，认领数也是 0，工作单数是 0。
- **已认领草稿必须由当前页读回。** 页面没有 draftId 时，不再用工作单里保存的草稿号、店铺和来源继续。这种情况下写字段和翻译都是 0。
- **SKU 改值和新增行不能通过。** 价格、库存必须和翻译前逐字相同，多出来的行算「新增 SKU 行」。红色 SKU 从 10/5 变成 999/0，或再加一行蓝色，QA 都不通过，发布点击数为 0。

决策点 #35、#38 补了这两条停等，没有新编号。

测试：`tests/dxm-smt-r3.test.ts` 现为 12 项。店小秘五份定向与本轮相关用例已通过。

当场结果：

- `npm test`：109 个文件、819 项，818 通过。唯一失败是 `tests/chrome-hole.test.ts:493`，第二个后台页期望 x=-20000、实际 30。本轮没有改这个文件。复审那次全量是 813/813，这次又复现了这个失败。
- `npm run typecheck`：通过。
- `npm run lint`：0 error、19 个既有 warning。
- `npm run build`：通过。

未跑：E1–E12、真实选择器、真实发布、安装包。复审通过前继续禁止真实写操作和发布。

### 规划方第五次复审（2026-11-08）：代码复审通过，真机仍未验收

复审基线：HEAD `40f61dc` 加当前未提交改动。规划方未修改产品代码，未提交 Git，未运行 `npm run dist`，未操作真实账号。

独立核对：

- `dxm-smt-listing.ts:163-198`：`resolveBound` 改为 `{ ok:false }` 返回，探针异常和身份不完整都在建单前停等，`openPrepare` 只能从加锁分支进入。并发用例（前两次探针失败、随后恢复 R1/S1）断言认领数 0、工作单数 0。
- `dxm-smt-listing.ts:281-292`：当前页没有 `draftId` 时不再用工作单保存的身份兜底；已认领草稿缺当前读回直接停等。用例断言写字段 0、翻译 0，工作单仍保留 D1。
- `dxm-smt-fields.ts:122-141`：按规格逐行匹配，价格、库存严格比较，多出的行记为「新增 SKU 行」。用例覆盖 10/5→999/0 和新增蓝色行，QA 均不通过且发布点击数 0。
- 独立复跑：九份定向 111/111（`dxm-smt-r3.test.ts` 现 12 项）；`npm test` 109 个文件、819/819 通过（本轮页面洞用例通过，该用例仍属并行不稳定项，不计入本链路结论）；`npm run typecheck`、`npm run lint`（0 error、19 个既有 warning）、`npm run build` 通过。

非阻断观察：价格、库存用字符串严格比较，若平台读回对数值做格式化（如 `10` 与 `10.00`），真机可能出现保守拦截。方向是挡住发布而非放过，留到只读真机时核对一次读回格式即可。

结论：本轮代码复审通过，可以进入只读真机。仍不进入真实写操作、真实发布和安装包验收；E1–E12 未跑，live 写适配器仍在停等，保存、提交、待审都不是上线。

### 只读真机第一段发现（2026-11-08，规划方执行）

环境：工作区开发版（`npm run start`，76 工具，含 R4 修复）。真实页面：`productCrawl/edit?id=167842582613033710`（账号 jiuyecc，F19 挂腰风扇，登录态有效）。

发现：

1. 真实采集编辑页**没有任何 `data-*` 探针标记**（`dataAttrCount: 0`）。PROBE_SCRIPT 依赖的标记全部是 mock 约定，`dxm_smt_probe` 在真实页面会安全停等——行为符合设计，但链路不可用。
2. recordId 可靠来源是 URL 参数（`edit?id=…`）；页面为 Vue + Ant Design Vue；标题输入 `input[placeholder="请填写标题"]`；描述在 CKEditor iframe；SKU 变种区是 div 网格（非 table）；价格读回 `1.75 USD` 带单位、库存为空；按钮「保存并认领」存在但未点击。
3. 店铺列表在编辑页不存在（顶栏无切换器），入口待定位（可能在「保存并认领」弹窗或店铺管理页，均未触碰）。

产出：`docs/ECOMMERCE-PHASE1-FIX-R5-CURSOR-TASKBOOK.md`（真实只读选择器基线，R5-1 探针改造 / R5-2 字段读回与价格剥离 / R5-3 真实 fixture / R5-4 店铺来源占位）。R5 完成并复审后，规划方补采店铺管理页出 R6。

### Cursor R5 完成记录（2026-11-08）

HEAD `40f61dc` 加未提交改动。没有提交 Git，没有运行 `npm run dist`，没有操作真实账号。真机探针未跑。E1–E12 继续未跑。

- **R5-1。** 采集编辑页的来源号先看 `data-record-id`，没有再读 URL 的 `id`。`urlId` 单独留下。页面类型要路径 `/web/productCrawl/edit` 再加上这个 id；「保存并认领」不能单独决定类型。
- **R5-2。** `readFields` 读标题输入和变种信息网格。`parsePriceCell` 把 `1.75 USD` 收成 `1.75`，原文留在 `rawPrice`。价格、库存比较用剥离后的值。描述只标「iframe 待基线」，不读 iframe。
- **R5-3。** 新测试共用 `tests/fixtures/dxm-crawl-edit.html`。里面没有真实账号、店铺和可识别商品标题。
- **R5-4。** 采集编辑页读不到店铺时停等原因是「店铺来源待基线（R5-4）」，同时写明页面无店铺来源。不猜店铺。这是已知缺口，不冒充完成。店铺管理页留给 R6。

认领、写字段、翻译、保存、发布、选分类仍是停等。没有点击「保存并认领」。

改动文件：`src/main/workflows/dxm-smt-page.ts`、`dxm-smt-live.ts`、`dxm-smt-fields.ts`，`tests/dxm-smt-r5.test.ts`，`tests/fixtures/dxm-crawl-edit.html`，`docs/DECISION-POINTS.md`（#35 补了一句，没有新编号）。

新测试（`tests/dxm-smt-r5.test.ts`，7 项）：

- 没有 data 标记时，recordId 来自 URL，页面是采集编辑，缺店铺就停等
- data-record-id 仍优先于 URL，保存并认领按钮不能单独决定页面类型
- parsePriceCell 剥离单位，空和非数字返回空
- 真实变种区读回 8 行，价格剥离，库存为空，描述标成 iframe 待基线
- 变种区没有行时不猜，SKU 连续性仍报读回为空
- 价格比较用剥离后的值，规格仍按原文
- 认领、保存、发布仍然停等，不会去点保存并认领

当场结果：

- `npm test`：110 个文件、826 项。收尾这次 825 通过。唯一失败是 `tests/chrome-hole.test.ts:493`，第二个后台页期望 x=-20000、实际 30。本轮没有改这个文件。同一会话里紧挨着的另一次全量是 826/826，这是已知抖动。
- `npm run typecheck`：通过。
- `npm run lint`：0 error、19 个既有 warning。
- `npm run build`：通过。`out/main/index.js` 1,403.35 kB。

未跑：E1–E12、真实采集编辑页探针、真实写操作、真实发布、安装包。店铺来源仍待基线。

### 规划方第六次复审（R5，2026-11-08）：代码复审通过，真机探针待跑

对照 R5 任务书（`ECOMMERCE-PHASE1-FIX-R5-CURSOR-TASKBOOK.md`）逐条独立核对：

- **R5-1 通过。** `PROBE_SCRIPT` 与 `probeFromHtml` 都是标记优先、URL `id` 兜底，`urlId` 独立返回（`dxm-smt-page.ts` L64-67、L99-101）。`crawl_edit` 判型要求路径 `/web/productCrawl/edit` **加** URL id（`crawlEditUrlId`），按钮文字不参与判型，测试覆盖「只有按钮不是编辑页」。`crawlEditUrlId` 同时约束「别的页面带 id 不当来源」。
- **R5-2 通过。** `READ_FIELDS_SCRIPT` 以「变种信息」文本锚点定位网格、按 `.cell` 读行；列头对不上或没有行返回空 SKU 并写明原因，不猜。`parsePriceCell` 四类用例全过；`SkuRow.rawPrice` 留原文；`skuContinuityIssues` 价格/库存用剥离值比较、规格仍按原文。描述只标「iframe 待基线」。
- **R5-3 通过。** 单一 fixture `tests/fixtures/dxm-crawl-edit.html`，测试里断言不含 `data-*` 标记、真实账号（jiuyecc）、真实商品（挂腰风扇）。
- **R5-4 通过。** `missingShopReason` 对采集编辑页返回「店铺来源待基线（R5-4）」，经 `resolveIdentity` → `runProbe` / `resolveBound` 透传到 probe 和 prepare 的停等消息。无店铺猜测逻辑。
- **停等边界未破。** claim / writeField / translateText / translateImages / saveDraft / clickPublish / selectCategory 全部仍返回停等；测试断言认领、保存、发布拒绝。未接回 `runFullListing()`，未动 `dxmEnabled()`。
- **决策点纪律。** `DECISION-POINTS.md` 只给 #35 补句（URL 来源号 + 店铺待基线），无未登记的新本地判断；#38/#40 的改动是 R2–R4 轮累计未提交内容，非本轮新增。

独立复跑（规划方本机）：

- 定向 `tests/dxm-smt-r5.test.ts`：7/7 通过。
- 全量 `npm test`：110 文件、**826/826 通过**（本轮 `chrome-hole.test.ts:493` 也绿，确认是既有抖动）。
- `npm run typecheck`：通过。`npm run lint`：0 error、19 既有 warning。`npm run build`：通过。

非阻断观察（留 R6 顺带处理，不要求返工）：

1. `missingShopReason` 的原因串把三种说法拼在一句里（「店铺来源缺失，店铺来源待基线（R5-4），页面无店铺来源（等待店铺基线）」），能用但啰嗦，可在 R6 收敛成一句。
2. `READ_FIELDS_SCRIPT` 假定网格行内是 `.cell` 类名——真实页面的类名未经采样核实。若不符，读回会安全停等（列头对不上→空数组+原因），不会猜，但需要真机 probe 验证后按实际结构修正。
3. `parsePriceCell("10")` 与 `parsePriceCell("10.00")` 仍不相等，价格格式变化会保守拦截（R4 已观察，行为一致，非回退）。

结论：**R5 代码复审通过。**

**真机只读验收（2026-11-08，规划方执行）：通过。** 带 `SPARO_DXM_SMT_PREVIEW=1` 重启开发版（工作区 electron，76 工具），在真实采集编辑页（`productCrawl/edit?id=167842582613033710`，登录态保持）做了两层验证：

1. **探针脚本层**（MCP `execute` 直跑 PROBE_SCRIPT）：`recordId=167842582613033710` 来自 URL、`urlId` 独立返回、页面无任何 `data-*` 标记、`shops` 空数组、`draftId`/`draftShopId` 空。
2. **工作流层**（`sidebar_chat` 端到端，Free Soul 模型实际调用 `run_workflow`）：门控放行（预览变量生效）；probe 返回 `state: waiting_human`、`pageKind: crawl_edit`、原因「店铺来源缺失，店铺来源待基线（R5-4），页面无店铺来源」；prepare 返回 `refused: true` 同一原因、未建工作单；status 如实返回找不到工作单；在非店小秘页面上 probe 也停等不乱动。模型全程零写操作，并主动声明「保存并认领需用户明示才动」。

非阻断新观察（真机）：非店小秘页面上 probe 的停等原因显示「没有目标店铺，已停等」（身份失败优先于页面分类），可读性略差，R6 可顺带把 `runProbe` 的原因优先级调成 blocker 优先。

R5 全部验收完成。下一步 R6：店铺来源基线（店铺管理页 DOM 采样 + 认领弹窗只读采样）。E1–E12、T63 维基压测、真实写操作、发布、安装包继续挂未跑。

### Cursor R6 完成记录（2026-11-08）

HEAD `40f61dc` 加未提交改动。没有提交 Git，没有运行 `npm run dist`，没有操作真实账号，没有重启正在跑的开发版。真机「刷新店铺基线」未跑。E1–E12 继续未跑。认领弹窗没有采样。

- **R6-1。** `readShops` 直开授权页，按行内第 1 到第 4 个单元格读店名、速卖通 ID、币种、托管状态和授权时间。`rowid` 为空，或速卖通 ID 不是 `cn` 加数字开头，这一行作废并计数。表格没出来、0 行、行全部作废都返回空列表和原因，不猜。当前标签是采集编辑页时另开标签读，读完关闭，不导航编辑页。
- **R6-2。** 读到店铺才写入 `%APPDATA%\sparo-store\dxm-smt-shops.json`。失败不覆盖已有缓存。新工作流 `dxm_smt_shops` 已进预览白名单，语义是刷新店铺基线。编辑页没有页面内店铺时用这份缓存：多家且没指定店名就停等并列出店名；指定店名后按名字绑定；只有一家可以默认绑定并注明。
- **R6-3。** 采集编辑页没有基线时，停等改成一句：「页面读不到店铺，店铺基线未就绪（先跑 dxm_smt_shops）」。探针在非店小秘页面上先说页面分类原因。
- **R6-4。** 夹具 `tests/fixtures/dxm-auth-shops.html` 用编造店名。测试断言里面没有真实店铺名。

认领、写字段、翻译、保存、发布、选分类仍是停等。没有点击重新授权、修改、更多，也没有点保存并认领。`dxmEnabled()` 仍是关闭。`dxm_smt_shops` 没有进旧工作流清单。

改动文件：`src/main/workflows/dxm-smt-shops.ts`、`dxm-smt-page.ts`、`dxm-smt-listing.ts`、`dxm-smt-live.ts`、`dxm-smt-preview.ts`，`src/main/browser.ts`，`src/main/agent/free-soul.ts`，`strategies/skills/dxm-smt-listing.json`，`tests/dxm-smt-r6.test.ts`，`tests/fixtures/dxm-auth-shops.html`，`tests/dxm-smt-r5.test.ts`（停等句改成新的一句），`docs/DECISION-POINTS.md`（#35 补了一句，没有新编号）。

新测试（`tests/dxm-smt-r6.test.ts`，9 项）：

- 授权页解析出 3 家编造店铺，空编号和非 cn 编号记入坏行
- 表格没出来或一行都没有时返回空列表和原因
- 刷新店铺基线会把列表和读取时间写进缓存
- 编辑页没有缓存时，停等是一句人话
- 缓存有 3 家店且没有指定店名时，停等并列出店名，不建单
- 指定店名后身份完整并建单，认领和发布仍然停等
- 当前标签是采集编辑页时，读店铺另开标签，不导航编辑页
- 非店小秘页面的探针先说明页面不对
- 认领、保存、发布仍然拒绝

当场结果：

- `npm test`：111 个文件、835 项，835 通过。这次 `chrome-hole.test.ts:493` 也通过，它仍是既有抖动，本轮没有改那个文件。
- `npm run typecheck`：通过。
- `npm run lint`：0 error、19 个既有 warning。
- `npm run build`：通过。`out/main/index.js` 1,411.13 kB。

未跑：E1–E12、侧栏「刷新店铺基线」真机、真实写操作、真实发布、安装包、认领弹窗采样。

### 规划方第七次复审（R6，2026-11-08）：代码复审通过，真机验收待跑

对照 R6 任务书逐条核对四个新文件与接线，全部通过：

- **R6-1**（`dxm-smt-live.ts` readShops + `dxm-smt-shops.ts` READ_SHOPS_SCRIPT）：裸 URL 直开授权页（无 go 参数）；轮询 10 秒 / 间隔 400ms；行解析按「行内第 1–4 个 td + 内容特征」双保险，不碰 colid；`rowid` 空 / 店名空 / aliId 不匹配 `/^cn\d+/` 计入 badRows；表没出来 / 0 行 / 全作废各有一句原因，不猜。**硬边界核实**：port tab 是采集编辑页（`crawlEditUrlId` 判定）时 `openTab` 另开标签、`finally closeTab` 关闭、绝不 `navigate` 编辑页；新标签 `createTab(url, false, { agentOwned: true })`，符合决策点 #42/#47 的 agent 标签语义。
- **R6-2**（`dxm-smt-listing.ts` runShops/runPrepare + `dxm-smt-page.ts` resolveIdentity）：`journalDir = configDir()`，缓存落 `%APPDATA%\sparo-store\dxm-smt-shops.json`；读到店铺才写，失败不覆盖；`dxm_smt_shops` 只进预览白名单（`gateFreeSoulWorkflow` 放行、`WORKFLOWS` 不含、`dxmEnabled()` 未动）；页面直读为空时用缓存，多店无 shopName 停等并列店名、shopName 精确匹配（不唯一 / 不匹配都停等，不猜）、单店默认绑定并注明。
- **R6-3**：`missingShopReason` 编辑页收敛为一句「页面读不到店铺，店铺基线未就绪（先跑 dxm_smt_shops）」；`runProbe` 原因优先级改为页面分类（blocker / not_dianxiaomi）优先于身份失败——R5 留的「非店小秘页显示没有目标店铺」已修。
- **R6-4**：fixture 3 好行 + 空 rowid 坏行 + 非 cn 坏行，编造店名，结构与真实采样一致；9 项测试与任务书逐条对应。
- **停等边界**：claim / writeField / translateText / translateImages / saveDraft / clickPublish / selectCategory 仍全部停等（`dxm-smt-live.ts` L46–56），测试第 9 项回归覆盖；READ_SHOPS_SCRIPT 纯 querySelector，无任何点击。free-soul 提示词同步更新（「用户说刷新店铺基线时用 dxm_smt_shops」）。

独立复跑（规划方执行，2026-11-08 20:40–20:41）：

- 定向 `tests/dxm-smt-r6.test.ts`：9/9 通过。
- 全量：834/835，唯一失败 `chrome-hole.test.ts:493`（既有抖动；单独复跑该文件 15/15 通过，与 R6 改动无关）。
- `npm run typecheck` 通过；`npm run lint` 0 error、19 个既有 warning；`npm run build` 通过。

非阻断观察（记档，不要求本轮处理）：

1. `runShops` 对 openTab/navigate **抛异常**（而非返回 ok:false）的路径没有本地兜底，异常会传播到 `runDxmSmtWorkflow` 之外——与 R5 同模式，browser.ts 接线层返回结果不抛错，上游 `runCoreTool` 有兜底，实际风险低。
2. 页面直读出多店时报「店铺不唯一，已停等」不列店名，与缓存多店的「列出店名请指定」略不对称——R5 既有行为，页面直读店铺来自 data-shop-id 路径，实际罕见。

**结论：R6 代码复审通过。**

**真机验收（2026-11-08 20:42–20:48，规划方执行）：通过。** 带 `SPARO_DXM_SMT_PREVIEW=1` 重启开发版（工作区 electron，76 工具），全程只读：

1. **刷新店铺基线 ✓**：侧栏「刷新店铺基线」→ 模型调 `dxm_smt_shops` → 返回 3 家真实店铺（PetLifeGlobal/8420150、Charmify Store/8441427、cn1093224020zuhae/8922322），badRows 0，落缓存 `%APPDATA%\sparo-store\dxm-smt-shops.json`，全字段（币种/托管/授权时间）与 11/8 早间人工采样一致。侧栏另自发去授权页逐条核对实况，如实报告 Charmify Store 未授权的差异。
2. **强制重抓 ✓**：明确指令「重新抓取不要用上次结果」后 fetchedAt 从 12:44:21Z 更新到 12:47:05Z——代码无任何「回快照」路径，此前时间戳未变纯属模型复述行为（见观察 1）。
3. **编辑页 probe ✓**：采集编辑页上探针不再报店铺缺失，改为「店铺基线有多家店铺，请指定目标店铺：PetLifeGlobal、Charmify Store、cn1093224020zuhae」停等列店名；`pageKind: crawl_edit` 判型正确。
4. **prepare 带 shopName ✓**：`shopName: "PetLifeGlobal"` 被采纳，建单 `dxm-mw7tswnm-aa8c6b`（空记录）与 `dxm-mw7tuiy5-1151e2`（有料记录 167842582613033710，标题/39 图/8 变种/6183 字描述齐全），两张单均 `waiting_human` 停在判重（保护性停等），`dxm_smt_status` 如实查单，**模型全程零写操作**且两次主动声明「写操作需用户点头」。

真机新观察（记档，R7 候选）：

1. **模型第一次猜错 prepare 参数名**（传 `shop` 无效，换 `shopName` 才生效）；强制重抓时模型自己发明了 force/refresh/noCache 参数（被工作流忽略，无害）。free-soul 提示词可补一句「prepare 指定店铺用参数 shopName；dxm_smt_shops 无参数、每次必重抓」。
2. **判重读不到 disabled 控件**：有料记录的来源 URL 输入框（`#form_item_sourceList_0_path`）有值但 `disabled: true`，侧栏推断判重把禁用控件读成空 → 无法判重停等。R7 探针适配候选（读 disabled 输入框的 value 而非交互态）。
3. **外部 MCP 直调 `run_workflow` 的 dxm_smt_* 被拒**（「Vertical workflows are disabled…SPARO_ENABLE_DXM=1」）——符合设计：dxm_smt_* 只从 Free Soul 侧栏路径开放。
4. 侧栏发现规划方 URL 抄错一位（58261→58613 空记录）并如实提醒；尝试只读核对采集箱列表被站点重定向回编辑页，两次后停手没硬闯——纪律符合预期。

认领弹窗采样未做（需用户当场授权点一次「保存并认领」，该动作会先真实保存草稿），挂 R7。E1–E12、真实写操作、安装包验收继续挂账。

### Cursor R7 完成记录（2026-11-08）

HEAD `40f61dc` 加未提交改动。没有提交 Git，没有运行 `npm run dist`，没有操作真实账号，没有重启正在跑的开发版。真机判重未跑。E1–E12 继续未跑。认领弹窗没有采样。

R6 真机里「判重读不到 disabled 输入框」这个推断不成立。停等是因为 `lookupDraft` 一直返回 unknown，没有去读采集箱。本轮换成真读。

- **R7-1。** 打开速卖通采集箱草稿列表。0 行或「暂无数据」视为没有同源草稿，准备会继续走到认领停等。列表有行时，用编辑页标题做精确搜索：对不上视为没有；对上一条或多条就停等，原因写明匹配条数，并说明没有按店铺过滤。第一版不产生 found。编辑页读不到标题，或列表没加载出来，就停等并说明原因。当前标签是采集编辑页时另开标签读，读完关闭，不导航编辑页。搜索只允许带 `title` 参数打开，或填搜索框并点「搜索」。不点行内编辑、删除、刊登。
- **R7-2。** 侧栏工作流说明写明：`dxm_smt_prepare` 指定店铺用参数 `shopName`；`dxm_smt_shops` 没有参数，每次调用都重新抓取。
- **R7-3。** 夹具是 ant 表格。0 行用 `tests/fixtures/dxm-smt-box-list.html`，2 行编造草稿用 `tests/fixtures/dxm-smt-box-rows.html`。测试确认里面没有真实店铺名和真实商品标题。

认领、写字段、翻译、保存、发布、选分类仍是停等。判重通过后，停等文案是「认领入口没有已核对标记，已停等」，页面上没有认领点击。

改动文件：`src/main/workflows/dxm-smt-box.ts`、`dxm-smt-live.ts`、`dxm-smt-listing.ts`，`src/main/agent/free-soul.ts`，`strategies/skills/dxm-smt-listing.json`，`tests/dxm-smt-r7.test.ts`，`tests/fixtures/dxm-smt-box-list.html`，`tests/fixtures/dxm-smt-box-rows.html`，`docs/DECISION-POINTS.md`（#35 补了判重这一句，没有新编号）。

新测试（`tests/dxm-smt-r7.test.ts`，7 项）：

- 采集箱 0 行视为没有同源草稿
- 有草稿但标题精确搜索没有对上时，判重通过
- 标题精确对上就停等人确认，不记成已找到
- 编辑页读不到标题时停等，并说明原因
- 当前标签是采集编辑页时，判重另开标签，不导航编辑页
- 判重通过后停在认领入口，页面上没有认领点击
- 认领、保存、发布和写字段仍然拒绝

当场结果：

- `npm test`：112 个文件、842 项。841 通过。唯一失败是 `tests/chrome-hole.test.ts:493`，第二个后台页期望 x=-20000、实际 30。本轮没有改这个文件。
- `npm run typecheck`：通过。
- `npm run lint`：0 error、19 个既有 warning。
- `npm run build`：通过。`out/main/index.js` 1,417.79 kB。

未跑：E1–E12、有料记录上的真机 prepare、真实写操作、真实发布、安装包、认领弹窗采样。

### 规划方第八次复审（R7，2026-11-08 21:29–21:40）：代码复审通过，真机验收待跑

复审基线：HEAD `40f61dc` 加当前未提交改动。规划方未修改产品代码，未提交 Git，未运行 `npm run dist`，未操作真实账号，未动正在跑的开发版和标签页。

对照 R7 任务书逐条核对，全部通过：

- **R7-1**（`dxm-smt-box.ts` 新模块 + `dxm-smt-live.ts` lookupDraft 真读）：unknown 桩已换成完整状态机——0 行/「暂无数据」→ `absent`（判重通过，链路走向认领停等）；有行时先用 URL `?title=` 参数打开并核对 `searchValue` 回显（回显不符即回落），回落路径只 `fill` 搜索框 + 点文字恰为「搜索」且不在表格行内的按钮，无任何行内操作列点击；0 匹配 → `absent`，1+ 匹配 → `ambiguous` 且原因写明「标题精确匹配 N 条（未按店铺过滤）」；`decideBoxLookup` 纯函数第一版不产生 `found`。recordId/shopId 缺一仍直接 unknown（判重合同保持）。轮询 10 秒/间隔 400ms，列表没出来 → unknown 不猜。**硬边界核实**：port tab 是采集编辑页（`crawlEditUrlId` 判定）时 `openTab` 另开标签、`finally closeTab` 关闭、绝不 `navigate` 编辑页；非编辑页才允许直接 navigate。标题由调用方传入——`lookupClaim` 先 `readFields` 编辑页取标题，读不到且列表有行时停等「编辑页读不到标题，无法判重」（0 行判 absent 不需要标题，与任务书一致）。
- **R7-2**：`free-soul.ts` L246 工作流说明已含「dxm_smt_prepare 指定目标店铺用参数 shopName；dxm_smt_shops 没有参数，每次调用都重新抓取」；`strategies/skills/dxm-smt-listing.json` 同步写明「不要改用 shop、force、refresh 或 noCache」。
- **R7-3**：`tests/fixtures/dxm-smt-box-list.html`（0 行+暂无数据）与 `dxm-smt-box-rows.html`（2 行编造草稿「示例夹子风扇草稿/box-9001」「示例另一草稿/box-9002」），测试断言不含真实店铺名/真实商品标题/真实记录 ID；7 项测试与任务书 R7-3 清单逐条对应，第 6 项走完整 `runDxmSmtWorkflow` 验证 absent 后停在「认领入口没有已核对标记」且 claim 零调用、无「保存并认领」脚本。
- **停等边界**：claim / writeField / translateText / translateImages / saveDraft / clickPublish / selectCategory 仍全部停等（测试第 7 项回归覆盖）；`dxmEnabled()` 未动；`DECISION-POINTS.md` #35 补了判重条款（另开标签、0 行视为没有、标题匹配停等不视为找到），没有新编号，符合登记要求。

独立复跑（规划方执行，2026-11-08 21:29–21:36）：

- 定向 `tests/dxm-smt-r7.test.ts`：7/7 通过。
- 全量：112 个文件、842/842 全过（Cursor 报的 `chrome-hole.test.ts:493` 本轮未复现，确认是既有时序抖动）。
- `npm run typecheck` 通过；`npm run lint` 0 error、19 个既有 warning；`npm run build` 通过（out/main/index.js 1,417.79 kB）。

非阻断观察（记档，不要求本轮处理）：

1. `searchBox` 的 URL 参数路径带 `?title=` 打开是真机上未验证的假设——若站点不支持该参数，回显核对不符会自动回落到填搜索框+点搜索，行为正确但多一次导航；真机验收时留意实际走哪条路径。
2. `READ_BOX_SCRIPT` 的 `loaded` 判定是「暂无数据 ∥ 存在 .ant-table ∥ 有行」——若站点把左侧导航或其他 ant 表格也渲染进页面，可能在列表数据未出时就判定 loaded；10 秒轮询从第一次 loaded 即返回，极端时会把「还没渲染完」当成 0 行判 absent。真机主场景（0 条采集箱）验收时确认「暂无数据」先于表格壳出现即可。

**结论：R7 代码复审通过。** 真机验收待跑：带 `SPARO_DXM_SMT_PREVIEW=1` 重启开发版，在有料记录 `id=167842582613033710` 上 prepare（shopName=PetLifeGlobal），期望判重 absent 后停等原因变为「认领入口没有已核对标记，已停等」、判重走独立标签且编辑页未被导航。认领弹窗采样仍需用户当场授权，不同意就挂 R8。E1–E12、真实写操作、安装包验收继续挂账。

### Cursor R8 完成记录（2026-11-08）

HEAD `40f61dc` 加未提交改动。没有提交 Git，没有运行 `npm run dist`，没有操作真实账号，没有重启正在跑的开发版。附录 A 仍是待填。选择器没有回填。live 认领仍停在「认领入口没有已核对标记，已停等」。认领不可用。采样没做：用户还没有当场授权，也没有指定测试采集记录和店铺。R7 只读真机验收仍未跑。E1–E12 继续未跑。

本轮只交付不碰真实页面的部分。

- **R8-2。** 新增 `src/main/workflows/dxm-smt-claim.ts`。`pickClaimShop` 先按店铺编号精确匹配，再按店名精确匹配。0 条或多条都停等并列出候选，不默认第一家。`planClaim` 在弹窗没出现、读不到店或找不到确认时，不把「确认」放进点击计划。只读脚本不含 `.click(`。弹窗标题和确认文案常量仍是空的，`claimSelectorsReady()` 为 false。
- **R8-3。** 只留骨架。live `claim` 在选择器未就绪时直接停等，不点「保存并认领」，不选店，不点确认，不新开标签，不刷新。
- **R8-4。** `dxm_smt_prepare` 新增 `claimConsent`。缺原话时在写入认领尝试之前停等，文案是「认领需要你当场确认，已停等，没有点保存并认领」，认领调用次数为 0。上次认领没落账的分支仍在授权检查之前，所以带了原话也不会二次认领。认领三证核对通过后先升到 `claimed`，当前标签地址不含该草稿号就停等：「认领已提交，但没有进入草稿编辑页，已停等。草稿号 …」。不刷新、不改绑。侧栏说明和技能准备步骤写明：用户明确说「认领」或「保存并认领」后，才把当次原话放进 `claimConsent`。决策点 #43、#44 本轮已在登记里，没有新编号。
- **R8-5。** 夹具 `tests/fixtures/dxm-smt-claim-dialog.html`（示例店铺A/9001、示例店铺B/9002）和 `dxm-smt-claim-empty.html`。测试确认里面没有真实店铺名、真实商品标题、真实记录号。

新测试（`tests/dxm-smt-r8.test.ts`，10 项）：

- 弹窗里唯一精确命中目标店时，计划只点保存并认领、该店和确认
- 没有匹配到目标店时停等并列出候选，不点确认
- 多家同名时停等列候选，不默认第一家
- 弹窗没出现时停等，工作单不写草稿号
- 确认后读回缺草稿号时不进入编辑
- 没有认领原话时零调用，页面零点击
- 确认后本地没落账时，再查不到草稿也不二次认领
- 写字段、翻译、保存、发布和选分类仍然拒绝
- 带认领原话并读回三证后，不再停在判重或认领入口
- 认领后编辑页地址没有草稿号就停等，并记下草稿号

写字段、翻译、保存、发布、选分类仍是停等。既有会走到认领的测试补了当次原话 `claimConsent: "认领"`，停在认领之前的测试没有补。

当场结果：

- `npm test`：113 个文件、852 项，852 通过。`tests/chrome-hole.test.ts` 本轮通过，文件没有改。
- `npm run typecheck`：通过。
- `npm run lint`：0 error、19 个既有 warning。
- `npm run build`：通过。`out/main/index.js` 1,419.08 kB。

未跑：附录 A 采样、live 认领点击、R7 只读真机验收、E1–E12、真实写操作、真实发布、安装包。不得把本轮当成认领已可用。

### 规划方第九次复审（R8，2026-11-08 22:05–22:12）：代码复审通过（降级交付），认领不可用属预期

复审基线：HEAD `40f61dc` 加当前未提交改动。规划方未修改产品代码，未提交 Git，未运行 `npm run dist`，未操作真实账号，未动正在跑的开发版。本轮按任务书第 1 节降级条款验收：附录 A 未回填、无采样授权，live 认领保持停等是**合规状态**，不是缺陷。

对照 R8 任务书逐条核对，全部通过：

- **R8-2**（`dxm-smt-claim.ts`）：`SMT_CLAIM_TEXT` 弹窗标题/确认/取消文案留空，`claimSelectorsReady()` 判定常量齐备才放行；`READ_CLAIM_DIALOG_SCRIPT` 纯只读（测试断言不含 `.click(`）；`pickClaimShop` shopId 精确优先、店名精确其次，0 条或多条都停等并列候选（不默认第一家）；`claimDialogIssue` 弹窗没出现/读不到候选/找不到确认各有停等原因；`planClaim` 点击计划只含「保存并认领 + 目标店铺 + 确认」三处，失败路径不含「确认」；`claimProofIssue` 三证缺一或对不上各有文案。
- **R8-3 骨架**：live `claim` 用 `claimSelectorsReady()` 把门——选择器未回填即返回「认领入口没有已核对标记，已停等」，零点击，符合任务书「附录 A 未回填时只交骨架」条款。
- **R8-4**：`claimConsent` 授权门位置正确——在 `claim_attempt_started` 落账之前、**未落账恢复检查之后**（`dxm-smt-listing.ts` L356–363），所以上次认领未落账时即使带原话也不会二次点击（测试 7 覆盖）；缺原话停等文案与任务书逐字一致，认领零调用（测试 6 覆盖）。#44 落点检查（L399–410）：三证核对通过、升 `claimed` 后，当前标签 URL 不含草稿号即停等并报草稿号，不刷新、不改绑（测试 10 覆盖）。free-soul L246 与技能 json 均写明「用户明确说认领/保存并认领后才放原话，不能自己编」。决策点 #43/#44 无新编号。
- **R8-5**：两份夹具均为编造店铺（示例店铺A/9001、示例店铺B/9002），secret 正则断言不含真实店铺名/真实记录 ID；10 项测试覆盖任务书 9 项要求并多出「带原话读回三证后不再停在判重或认领入口」的正向断言；既有走到认领的测试补了 `claimConsent`，未走到的没补——修改面判断正确。
- **停等边界**：写字段/翻译/保存/发布/选分类全部仍拒绝（测试 8 覆盖，含 live port）；`dxmEnabled()` 未动；`dxm_smt_*` 仍只走侧栏白名单。

独立复跑（规划方执行，2026-11-08 22:05–22:09）：

- 定向 `tests/dxm-smt-r8.test.ts`：10/10 通过。
- 全量：113 个文件、852/852 全过。
- `npm run typecheck` 通过；`npm run lint` 0 error、19 个既有 warning；`npm run build` 通过（out/main/index.js 1,419.08 kB）。

非阻断观察（记档，不要求本轮处理）：

1. `READ_CLAIM_DIALOG_SCRIPT` 按 `label + input[value]` 读候选、按钮按「确认/取消」文字精确匹配——都是基于夹具的假设，真实弹窗（可能是 ant Select 下拉而非 radio）需在附录 A 采样后校准；采样时优先核对控件类型。
2. `claimConsent` 是非空字符串即放行，与 `paidConsent` 同信任模型（模型转述用户原话）；R8 真机验收时留意侧栏是否如实携带原话、不自行编造。

**结论：R8 代码复审通过（降级交付）。认领不可用是采样未做的直接后果，解锁条件是附录 A 回填。** 后续顺序：① R7 只读真机验收（重启开发版跑一次 prepare，验证判重推进到认领停等）；② 用户授权后附录 A 采样（点一次「保存并认领」，会真实保存草稿）；③ 附录 A 回填 → R9 实现 live 认领点击。E1–E12、真实写操作、安装包验收继续挂账。

### Cursor R9 完成记录（2026-11-09）

HEAD `40f61dc` 加未提交改动。没有提交 Git，没有运行 `npm run dist`，没有操作真实账号，没有重启正在跑的开发版。附录 B 仍是待采。附录 A 的弹窗容器、复选项结构和取消按钮仍是待采。没有点「保存并认领」。挂腰风扇那条草稿没有删。E1–E12 继续未跑。

判重读取层没有改。`READ_BOX_SCRIPT` 和 `boxListFromHtml` 仍是 R7 的 ant 选择器，仍会把全文「暂无数据」当成加载完成。**判重不可用。** live 认领仍停在「认领入口没有已核对标记，已停等」。**认领不可用。**

- **R9-1。** 只加了纯函数，没有接到 live。`assessBoxLoad`：有行或空表标记才是加载完成；0 行且没有空表标记是未加载，不看「暂无数据」。`lookupFromLoad` 在未加载时返回 unknown，文案含「没有加载出来」，不返回 absent。已渲染且 0 行才 absent。标题精确匹配仍是 ambiguous。`boxPollExhausted` 在样本全是未加载时同样停等。`boxSearchAttempt` 在搜索框或按钮缺一个时 `filled:false` 且 `clicked:false`。三份夹具是待定骨架：`tests/fixtures/dxm-smt-box-vxe-rows.html`、`dxm-smt-box-vxe-empty.html`、`dxm-smt-box-vxe-loading.html`。里面写了「待定」，没有真实店铺名、真实标题、真实记录号。读取层不解析它们。原 ant 夹具仍被 R7 测试引用，因为读取层按任务书没改。
- **R9-2。** 只改提示词。`free-soul.ts` 的 `run_workflow` 描述追加：「dxm_smt 工作流返回停等（ok:false 或 waiting_human）时就是停等。禁止绕过工作流用 click_text、execute_primitives 或任何页面工具去手动点『保存并认领』『保存』『认领』『发布』类按钮；停等后只向用户说明原因并等待指示，不得替用户完成写操作。」技能卡准备步骤和 `agentPlaybook` 写了同一禁令：停等就是停等，禁止用这些页面工具手动点保存并认领、保存、认领、发布，停等后只说明原因并等待指示。没有改执行层，没有改 #28/#31/#33。
- **R9-3。** 准备入口在编辑标签不一致时，先读当前标签。只有当前页是采集编辑页，且 `crawlEditUrlId` 和工作单来源记录一致，才把 `editTabId` 改成当前标签，并落账 `tab_rebound`，原因是「同记录编辑页，改绑当前标签」，然后继续。不同记录、非编辑页、探针失败都维持「当前执行标签不是工作单的编辑标签，已停等，不会在新标签继续」。不新开标签，不刷新。`bindTabs` 仍是旧值优先。决策点 #45、#46 本轮已在登记里，没有新编号。
- **R9-4。** 常量按已采行为回填：弹窗标题「选择店铺-认领到采集箱」，确认按钮「确定」。取消仍为空。`SMT_CLAIM_DOM` 的容器、复选项、「已选(N)」节点仍是空的，所以 `claimSelectorsReady()` 仍是 false，live `claim` 零点击。只读脚本改用「确定」，不再查找「确认」。`planClaim` 增加复选规则：目标店以外还有勾选就停等，原因含「认领弹窗里有其他店铺被勾选（已选 N）」，点击计划里没有「确定」，也不代用户取消。目标店已经勾上时，计划不再点它。

新测试（`tests/dxm-smt-r9.test.ts`，10 项）：

- 表体已渲染且标题精确对上一条时停等，原因含 1 条
- 已渲染空表标记才是没有草稿
- 只有占位文本时不判 absent，轮询耗尽后说没有加载出来
- 搜索框或按钮对不上时两个都不做
- 同一来源记录的采集编辑页会改绑并落账
- 不同记录、非编辑页或探针失败都不改绑
- 没有其他勾选时，计划只点保存并认领、目标店和确定
- 目标店以外还有勾选时不点确定
- 确认按钮常量是确定，只读脚本不再找确认
- 没有认领原话仍零调用，写翻译保存发布选分类仍拒绝，落点检查仍在

当场结果：

- `npm test`：114 个文件、862 项，862 通过。`tests/chrome-hole.test.ts` 本轮通过，文件没有改。
- `npm run typecheck`：通过。
- `npm run lint`：0 error、19 个既有 warning。
- `npm run build`：通过。`out/main/index.js` 1,421.72 kB。

未跑：附录 B 只读采样、附录 A 的 DOM 采样、判重读取层重写、live 认领点击、真机改绑、E1–E12、真实发布、安装包。不得把本轮当成判重已修好或认领已可用。附录 B 回填后才能改读取层。DOM 项回填后才能写认领点击。

### Cursor R9-1 读取层（2026-11-09）

附录 B 已回填后补上判重读取层。HEAD `40f61dc` 加未提交改动。没有提交 Git，没有打包，没有重启开发版，没有点保存或认领，没有删挂腰风扇草稿。认领弹窗 DOM 仍待采，live 认领继续停等。

- 行只认 `tr.vxe-body--row`。ant 表格选择器已从读取脚本和离线解析里拿掉，原 ant 夹具已删。
- 标题取 `td[2]` 的第一行，去掉「店铺名」那一行。产品 ID 从整行文本取第一段 7 位以上数字，不写死列号。
- `.vxe-table--empty-block` 不算空表。有行就是有数据，哪怕页面上有「暂无数据」或空表节点。行数为 0 且 `.vxe-table--empty-content .empty-container` 可见，才算真空并判 absent。只有占位文本或单独的空表节点时 `loaded:false`，轮询到上限是「采集箱列表没有加载出来，无法判重」，不判 absent。
- 搜索后若结果还没加载完，不用旧行或空行判 absent。搜索框是表格外第一个 `input.ant-input`，搜索按钮取第一个「搜索」。缺一就 `filled:false` 且 `clicked:false`，停等，不改别的框。
- 决策点 #45 的依据改成行数加真空结构，没有新编号。

当场结果：

- 定向 `tests/dxm-smt-r7.test.ts`、`tests/dxm-smt-r9.test.ts`、`tests/dxm-smt-r8.test.ts`：27 项通过。
- `npm test`：115 个文件、866 项。865 通过。唯一失败是 `tests/chrome-hole.test.ts:493`，期望 x=-20000、实际 30。本轮没有改这个文件。
- `npm run typecheck`：通过。
- `npm run lint`：0 error、19 个既有 warning。
- `npm run build`：通过。`out/main/index.js` 1,424.42 kB。

未跑：真机判重、附录 A 的 DOM 采样、live 认领点击、E1–E12、真实发布、安装包。不得把认领当成已可用。

### Cursor R9B 完成记录（2026-11-09）

HEAD `5f2b12a` 加未提交改动。没有提交 Git，没有运行 `npm run dist`，没有重启正在跑的开发版，没有在真实账号上点「保存并认领」或「确定」。挂腰风扇草稿没有删。E1–E12 继续未跑。决策点 #48 已按登记实现，没有新编号。`dxmEnabled()` 没改，`dxm_smt_*` 仍不进旧 `WORKFLOWS`。`parkPageView`、`backgroundThrottling` 和布局系统没改。

**判重和认领都还不能说可用。** 判重要等规划方同记录 prepare 复验，期望停 ambiguous「标题精确匹配 1 条」。认领点击已经写进代码，但成功落点、成功后 URL、draftId / shopId / recordId 的页面位置仍是附录 A 待采；真机认领要等用户当场授权。本轮没有跑 live prepare，也没有跑认领路径。

- **R9-6。** `createLiveDxmSmtPort` 增加 `activateTab`、`getActiveTabId`、`hasTab`。`activateTab` 只改 `activeTabId`、`lastActiveAt`，然后 `layout()` 和 `pushChromeState()`。不调用 `window.focus()`、`focusActivePage()`、`flashFrame`、`wakeTab`。用户正看着窗口时会看到标签短暂切换，这是 #48 已接受的代价。
- 代码入口是 `lookupDraft`（任务书写的 lookupOrder 就是它）。采集编辑页仍先 `openTab` 采集箱，记下 `prevActive`，立刻 `activateTab(boxTabId)`，再走原来的 `pollBox` / `searchBox` / `decideBoxLookup`。`finally` 里关掉采集箱标签；`prevActive` 还在才切回去。原标签已经没了，不恢复、不抛错。判重期间采集箱标签被关掉，返回 unknown「采集箱列表没有加载出来，无法判重」，不抛错、不等满 10 秒。`pollBox` 仍是 10 秒 / 400 毫秒。`hasTab` 缺省时不当成已关闭，避免旧测试的标签列表被误判。
- **R9-4。** 常量已按附录 A 回填：标题「选择店铺-认领到采集箱」，确定「确定」，取消按钮是「关闭」。`claimSelectorsReady()` 现在为 true。读弹窗只收可见复选（`offsetParent` 加上 computed style 的 display / visibility）。隐藏且默认勾选的「eBay产品默认认领到原站点」不计入其他勾选，也不去取消它。checkbox 的 value 恒为 on，shopId 不从 DOM 读。选店仍是 shopId 优先、否则店名精确；弹窗没有 shopId 时走店名。目标店以外还有可见勾选就停等，原因是「认领弹窗里有其他店铺被勾选（已选 N），已停等」，确定点击次数为 0。
- live `claim` 只在采集编辑页上做，不新开标签、不导航、不刷新、不重试。顺序：点「保存并认领」（按钮不在 `tr` 里；没点到就立刻停等，不空等 10 秒）→ 等弹窗 → 匹配店铺 → 目标未勾才点那一家 → 只点可见的「确定」→ 读三证。三证只认 `data-draft-id` / `data-draft-shop-id` / `data-record-id`，草稿号也可以来自 `/web/smt/edit` 的 URL id。采集编辑页 URL 上的记录号不当成 recordId。读不全就停等，不返回 `ok:true`，不猜落点。弹窗还开着就说「点确定后认领弹窗没有结束，已停等」。`claimedDraftId` 和 #44 仍走现有 listing，本轮没改。
- 夹具 `tests/fixtures/dxm-smt-claim-dialog.html` 改成附录 A 结构，店名只有示例店铺 A/B，按钮是「确定」和「关闭」，另有一条 `display:none` 的默认勾选。不含真实店铺名、真实标题、真实记录号。R8 选店断言改为按店名，shopId 为空。R7「判重通过后」改为：会执行一次打开弹窗的脚本；模拟点击没有 `clicked:true` 时不点确定。

当场结果：

- 定向 `tests/dxm-smt-r5.test.ts` 至 `tests/dxm-smt-r9b.test.ts`：6 个文件、51 项通过。其中 R9B 8 项覆盖任务书的 3 项激活和 5 项认领。
- `npm test`：118 个文件、884 项，884 通过。`tests/chrome-hole.test.ts` 本轮通过，文件没有改，断言没有改。上一轮 R9-1 全量曾在第 493 行失败（期望 x=-20000，实际 30）。本轮 R9-6 没有改停放位，这一次该断言是通过的；它和 park 停放位同源，以后再抖仍不许改断言。
- `npm run typecheck`：通过。
- `npm run lint`：0 error、19 个既有 warning。
- `npm run build`：通过。`out/main/index.js` 1,439.86 kB。

未跑：同记录 prepare 真机复验、用户当场授权后的认领、成功落点 DOM、E1–E12、真实写字段 / 翻译 / 保存 / 发布 / 选分类、安装包。
