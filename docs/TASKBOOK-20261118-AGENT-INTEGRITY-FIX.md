# Sparo Agent 完整性修复任务书

> 版本：v1 · 2026-11-18
> 执行者：Cursor（编码窗口）
> 修复基线：`9bbd24e` + 当前工作树（含 3 个已披露的未提交发布脚本改动，不得回滚或清理）
> 输入：`docs/QA-AGENT-INTEGRITY-REPORT-20261117-REAUDIT.md`（已审核通过）及其第十一节
> 原任务书：`docs/TASKBOOK-20261117-AGENT-INTEGRITY-QA.md`
> 补审任务书：`docs/TASKBOOK-20261117-AGENT-INTEGRITY-QA-REAUDIT.md`（v1.1）
> 性质：**修复代码与技能，绑定验收场景；不打包、不发布**

---

## 一、任务定位

补审报告确认 0.7.7 开发版验收**阻断**，开放项：P0 × 2、P1 × 5、独立安全项 S-01、S-02。本任务只修复这些问题，不做第二审计轮、不重构无关模块、不改安装打包流程。

修复顺序（安全项最前）：

```
第 1 批（安全）：S-01、S-02
第 2 批（P0）：P0-01、P0-02
第 3 批（P1）：P1-02、P1-03、P1-05、P1-01、P1-04
```

每批完成后跑一次「六、逐批自测」，全绿才进下一批。

---

## 二、全局硬约束（整个任务期间有效）

1. **保留且不得削弱的硬闸门**：`publish-gate.ts` 对支付、登录、验证码的禁止代点；`request_confirm` 机制本身；店小秘对来源/店铺/草稿身份/认领与发布回执的核验；发布前质量门。修复不得借「增强自主」拆除任何一项。
2. **安全基准一句话**：真实发布、真实保存商品必须获得独立确认；初始任务指令本身不是发布/保存授权。
3. 不 commit、不 push、不运行 `npm run pack` / `npm run dist`；版本号与打包由用户验收后另行决定。
4. 不点击真实发布、群发、保存商品、认领、付费、删除；不代填登录、验证码、支付密码。
5. 既有未提交的 3 个发布脚本改动（`baijiahao.mjs`、`toutiao.mjs`、`page.mjs`）是用户工作成果，只可在其基础上叠加，不得还原。
6. 涉及「提前结束任务 / 绕过脑区 / 改走向」的本地判断，须同步登记 `docs/DECISION-POINTS.md`（本任务至少 S-01 的发送授权判定、S-02 的保存门判定两处）。
7. 侧栏/工作台若有 UI 改动（P1-04 恢复预览），改完必须自己在开发版里点通：点得到、下一步原地出现、控制台无报错。

---

## 三、修复项

### 第 1 批 · S-01：发送门必须核验确认状态，auto 不豁免

**根因**（补审报告第七节）：

- `src/main/agent/publish-gate.ts:28-34`：`gateClickText` 在 `freeSoulRunning && classifyClick === "send"` 时无条件 `ok:true`，注释假设「新核心已在 request_confirm 确认过」，但门不核验。
- `src/main/agent/free-soul.ts:403-412`：auto 模式明文「发布、发送类动作直接执行，不调用 request_confirm——用户下达的任务指令本身就是授权」。

**修复要求**：

1. `classifyClick` 增加 `save` 类（`保存|存草稿|保存并发布` 等，注意与 `send` 的顺序：`保存并认领`、`保存并发布` 按更严的一类处理）；`save` 与 `send` 同级管控。
2. `gateClickText` 不再凭 `freeSoulRunning` 放行 send/save：必须核验一次**已落地的确认状态**（如本会话内 `request_confirm` 已被用户答复「确认」且对象匹配该动作），无确认一律拦截并返回「草稿已填好，发送/保存留给你确认」。
3. auto 模式提示改写：任务指令授权的是**执行过程**，不是发布/保存本身；发布、发送、保存类动作仍走 `request_confirm`，删除「本身就是授权」整段。
4. step 模式的 `request_confirm → 确认 → click_text` 往返保持可用；确认状态需要可被门查询（新增内部状态即可，不要求持久化）。

**绑定验收场景**：

- 单测/mock：step 模式未调 `request_confirm` 直接 `click_text('发布')` → 拦截；
- 单测/mock：auto 模式直接 `click_text('发布')` → 拦截；
- 单测/mock：`request_confirm` 确认后 `click_text('发布')` → 放行；
- 单测/mock：`click_text('保存')`、`click_text('保存并认领')` 分别被 save/更严一类拦截；
- `pay/login/captcha` 三类拦截行为与现版完全一致（回归不得破坏）。

### 第 1 批 · S-02：技能内保存必须有真实执行门

**根因**（补审报告第五节）：

- `strategies/skills/dxm-crawl-prep.json:65-73`：save 步骤用 `execute` 定位 `button.btn-orange` 直接 `button.click()`；
- `human_gates` 无普通「保存」；
- `runner.ts:1017-1020` 的 `execute` 直连 `browser.execute`，无门禁包装。

**修复要求**：

1. `dxm-crawl-prep.json` 的 `human_gates` 增加 `save`（与「保存并认领」并列单列）。
2. runner 层做**结构性门禁**，不依赖 JSON 自觉：非蒸馏技能步骤命中保存类动作（execute 脚本中点击保存按钮、或步骤类型标记为 save）时，先产出确认请求并暂停，用户确认后才继续该步骤。最小实现可为：save 步骤执行前经 `request_confirm` 通道（FreeSoul 场景）或返回 `paused:true + 需确认保存`（旧工作单场景），确认态落库后放行一次。
3. `execute` 脚本不得作为绕门手段：runner 对 execute 脚本做保存类检测（按钮文本匹配 `保存`），命中走同一确认门。
4. 确认后只保存，不连带认领/发布。

**绑定验收场景**：

- 静态合同测试：所有非蒸馏技能中含保存类 execute/点击的步骤，必须能被 runner 门检测到（写一个扫描测试）；
- mock 页面：未确认 → 停在保存门前；确认 → 只保存不认领，reload 回读身份与结果；
- 真实商品页只验证到「门前停止」，不真实保存。

### 第 2 批 · P0-02：技能改用 FreeSoul 实际工具（已定方案二，不再二选一）

**根因**：`dxm-smt-editor-ops.json` 声明 `declared_actions: ["execute"]`，剧本依赖页面 JS 执行；内置 FreeSoul 无 `execute`，合同断裂。

**修复要求**：

1. **不**向 FreeSoul 开放 `execute`。
2. 重写 `dxm-smt-editor-ops.json`：`agentPlaybook`/步骤只使用 FreeSoul 实际工具（`click`、`fill`、`click_text`、`snapshot`、`page_text`、`set_file`、`reload` 等），保存步骤改走 `click_text('保存')`（经 S-01 的 save 门）。
3. 同步修正该技能 `declared_actions`。
4. 新增**静态合同测试**：每个蒸馏技能的 `declared_actions` 必须是 FreeSoul 工具集子集，违例时测试失败（防止再次出现纸面技能）。

**绑定验收场景**：

- 合同测试全绿；
- 开发版真机：已登录隔离测试商品（需用户提供授权测试账号；无账号时验证到 `run_skill` 返回剧本 + 剧本首个动作工具真实存在为止，并标「真机未完成」）。

### 第 2 批 · P0-01：预览关闭改为「捷径未开」语义

**根因**：`dxm-smt-preview.ts:15-18` 的 `PREVIEW_CLOSED_MESSAGE = "该能力尚未开放"`。

**修复要求**：

1. 文案改为「店小秘专用工作流未开放，可改用通用页面工具继续；保存、认领、发布、付费仍需确认」。
2. 保留并保持 `data.closed: true` 结构化状态；增加 `data.fallback: "generic_page_tools"` 与 `code: "preview_closed"`。
3. 五个白名单工作流和主技能在开关关闭时返回一致语义（同一常量与结构）。

**绑定验收场景**：

- 单测：关闭态下所有白名单入口返回 `code:"preview_closed"` + 新文案 + fallback 提示；
- 开发版真机：关闭预览开关，FreeSoul 收到文案后能继续走通用只读路径（店小秘首页即可，不需要登录后台）。

### 第 3 批 · P1-02：目录降级为稿件来源之一，清除残留

**涉及**：`slots.ts:407-424`（`articleDir` 强槽）、`loop.ts` 的 `legalSlots/sealWorkOrder`、`intent-router.ts:526`（英文提示）、`social-media-publish.json:27,101`、`weixin-publish.json:20,74`、`types.ts` 相关问句。

**修复要求**：

1. 有内联标题+正文时，不再强制 `articleDir`；目录与内联、粘贴、历史稿件并列为来源之一。
2. 中英文提示同步改写；英文不再出现 "ask for two things / do not just open the publish page" 语义。
3. 技能 JSON 的「只做 run_skill / 缺目录先问」改为「优先 run_skill；无目录但有内联稿件时直接带参数调用或走通用填稿」。
4. 同步受影响的单测与追问话术；`9bbd24e` 中文三条走法保留。

**绑定验收场景**：

- 单测：只给平台+内联标题正文，`legalSlots` 不再产出 `articleDir` ask；
- 单测：英文路由不再索要目录；
- 真机（需测试账号）：中/英 × 侧栏 × 内联路径，真实填到草稿并只读核验草稿箱条目，不发布。

### 第 3 批 · P1-03：结构化错误取代一刀切停等

**涉及**：`free-soul.ts:253-260` 的 `run_workflow` 描述、`runner.ts` 返回结构。

**修复要求**：

1. runner 失败结果带 `code`：`preview_closed / transient_tool_failure / validation_failed / waiting_human / hard_gate`。
2. `run_workflow` 工具描述改为：仅 `waiting_human/hard_gate` 停等；前三类换变体、换通用工具、换策略。
3. 「禁止绕过保存、认领、发布、付费」的表述保留。

**绑定验收场景**：

- 单测：注入临时失败 → 模型收到 `transient_tool_failure`；预览关闭 → `preview_closed`；只有硬门返回 `waiting_human`。

### 第 3 批 · P1-05：FreeSoul 增加受作用域约束的 `new_tab`

**涉及**：`free-soul.ts:13-41` 工具类型与 146-310 行声明。

**修复要求**：

1. 新增 `new_tab({ url })`，语义与外部 MCP 一致：新开标签并认领给当前 client，不抢用户当前页焦点。
2. 声明中加入一句用途说明；不加任何站点白名单限制。

**绑定验收场景**：

- 单测：工具注册与作用域参数；
- 真机重跑 R4：同时保留 Example 与 IANA 两个目标标签，`list_tabs` 核验，且不抢焦点。

### 第 3 批 · P1-01：追问边界——可逆字段先给草案

**涉及**：`dxm-smt-editor-ops.json` 的 intent/分工说明；FreeSoul 提示中关于提问的规则。

**修复要求**：

1. 技能与提示明确三档：① 可逆可推断（标题草案、已有属性语言转换、模板选择）→ 先执行并汇报假设；② 页面事实（重量、尺寸、库存）→ 页面有可靠值就提取换算，读不到不编造、可问；③ 用户/法律事实（品牌授权、HS 编码、责任人、资质）→ 无法推断才问。
2. 保存、认领、发布、付费不在字段自决范围内。

**绑定验收场景**：

- 单测：提示文本含三档分类；
- 真机（需测试账号）：正常非 0×0 编辑页，分别统计普通字段停问次数与合法硬信息停问次数（普通字段应为 0 次停问 + 末尾假设汇报）。

### 第 3 批 · P1-04：恢复——先接通只读预览，再做必要持久化

**涉及**：`mission-journal.ts:337-340`（`sidebarOffersRecovery` 恒 false）、`browser.ts:9000-9011`、`browser.ts:4908-4912`（工作台续跑未接入）、`browser.ts:1232-1245`（mcpTasks 内存）、`task-pool.ts:38-40`。

**修复要求（按此优先级）**：

1. 接通**只读恢复预览**：重启后侧栏可展示未关任务的目标、最后完成步骤、当前页面与待确认动作；此入口打开。
2. mcpTasks 与任务池的关键摘要（taskId、目标、状态、最后步骤、时间）落盘持久化，重启可查询；不要求完整轮次回放。
3. 对无副作用步骤支持幂等续跑；保存/认领/发布/付费一律重新确认，不自动重放。
4. 工作台「续跑」按钮接真实 handler 或先隐藏按钮并注明未接入（二选一，不得留假按钮）。

**绑定验收场景**：

- 开发版真机：发起任务 → 杀进程 → 重启 → 侧栏出现恢复预览 → 只读信息完整；无副作用步骤可续跑；危险动作要求重新确认；
- DECISION-POINTS.md 登记恢复入口的判定规则。

---

## 四、测试与质量门

1. 每批完成后：`npm run typecheck`、`npm run test` 全绿；新增逻辑必须有对应单测（本任务书列出的绑定场景优先）。
2. `npm run lint` 不高于现有 warning 数。
3. 静态合同测试（P0-02 第 4 点、S-02 第 1 点）作为常驻测试入库。
4. 真机自测在开发版（`npm run dev`，隔离用户数据目录）进行；涉及登录的场景**不要自行解决账号**，列清单交用户授权测试账号后由最终验收统一执行。
5. 自测发现的无关 bug 只记录不改（防扩散），交用户决定。

## 五、交付物

1. 代码与技能 JSON 改动（不 commit，留在工作树）。
2. `docs/QA-AGENT-INTEGRITY-FIX-NOTES.md`：逐项记录——改了什么文件:行、对应哪个问题 ID、绑定场景的自测结果（含真机会话的任务 ID 与原话，如有）、遗留未验证项。
3. `docs/DECISION-POINTS.md` 增补两条判定登记。
4. 待授权测试账号清单（店小秘、头条各一，注明用途与可见范围限制）。

## 六、逐批自测清单

| 批次 | 必须全绿才进下一批 |
|---|---|
| 第 1 批 | S-01 四类 mock 场景 + S-02 门禁扫描测试与 mock 停门场景 + typecheck/test/lint |
| 第 2 批 | P0-02 合同测试 + P0-01 关闭态单测 + P0-01 开发版只读回落自测 + typecheck/test/lint |
| 第 3 批 | P1-02/P1-03/P1-05 单测 + P1-04 重启恢复真机自测 + R4 重跑（双标签保留）+ typecheck/test/lint |

## 七、完成后的下一步

用户审核交付物与 FIX-NOTES → 授权测试账号 → 按[原任务书](docs/TASKBOOK-20261117-AGENT-INTEGRITY-QA.md) + [补审任务书 v1.1](docs/TASKBOOK-20261117-AGENT-INTEGRITY-QA-REAUDIT.md) 跑最终验收 QA（含 R1–R5 全场景与登录态闭环）→ 通过后由用户决定版本号与打包。
