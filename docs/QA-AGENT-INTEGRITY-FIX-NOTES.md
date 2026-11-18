# Agent 完整性修复记录

> 日期：2026-11-18
> 基线：`9bbd24e` + 工作树（未 commit、未打包）
> 任务书：`docs/TASKBOOK-20261118-AGENT-INTEGRITY-FIX.md`
> 自测：`npm run typecheck` 通过；`npm run test` 144 个文件、1094 条通过；`npm run lint` 0 error、21 warning（与改前同级，未新增）

三个未提交的发布脚本 `baijiahao.mjs`、`toutiao.mjs`、`page.mjs` 没有被还原。本轮只在其他文件上叠加。

没有登录态真机。需要账号的场景列在文末，等授权后再按原任务书和补审 v1.1 做最终验收。

---

## S-01 发送门核验确认

**改了什么**

- `src/main/agent/publish-gate.ts`：`classifyClick` 增加 `save`。`保存并认领`、`保存并发布` 先判成更严的 `commit`，不会被普通「保存」吞掉。`gateClickText` 在新核心运行时不再凭 `freeSoulRunning` 放行；本会话里 `request_confirm` 已被答复「确认」且对象对得上，才放行一次。否则返回「草稿已填好，发送/保存留给你确认。」支付、登录、验证码仍不代点。
- `src/main/agent/free-soul.ts`：run 开头记下用户答复；`request_confirm` 记下对象。自动模式删掉「任务指令本身就是授权」。发布、发送、保存仍走 `request_confirm`。
- `docs/DECISION-POINTS.md` #28、#33、#34 改写，新增 #65。

**自测**

- `tests/publish-gate.test.ts`、`tests/agent-integrity-s01.test.ts`、`tests/free-soul-v4.test.ts`、`tests/free-soul-v9.test.ts`、`tests/free-soul-v16.test.ts`、`tests/free-soul-captures.test.ts`
- step / auto 未确认点「发布」拦截；确认后只放行一次「发布」；「保存」与「保存并认领」分属 save / commit；确认「保存」盖不到认领；支付、登录、验证码仍拦截。

**未做**

- 没有在真实站点上点发布。

## S-02 技能保存门

**改了什么**

- `src/main/skills/save-gate.ts`：不看 `human_gates`。execute 脚本里成对引号的「保存」加 `.click()` 算保存；「保存并认领 / 保存并发布」算更严一类。「未保存」这类报错不算。
- `src/main/skills/runner.ts`：命中后先暂停，文案含「需确认保存」，`data.paused` 与 `code: waiting_human`。确认「保存」后只跑普通保存；同一轮后面的认领点击跳过。
- `strategies/skills/dxm-crawl-prep.json`：`human_gates` 增加 `save`，与「保存并认领」并列。版本 9。
- 决策点 #66。

**自测**

- `tests/agent-integrity-s02.test.ts`
- 未确认：保存脚本不执行。确认后：只跑「保存」，不跑「保存并认领」，并 reload、回读。
- 真实 `dxm-crawl-prep` 的保存步能被门检测到，回读脚本不算保存点击。
- 非蒸馏技能扫描：含保存类点击的步骤都能被门检测到。

**未做**

- 没有打开真实商品页。真实页只验证到门前，等店小秘测试账号。

## P0-01 预览关闭文案

**改了什么**

- `src/main/workflows/dxm-smt-preview.ts`：文案改为「店小秘专用工作流未开放，可改用通用页面工具继续；保存、认领、发布、付费仍需确认」。`previewClosedToolResult()` 带 `closed: true`、`fallback: "generic_page_tools"`、`code: "preview_closed"`。
- `src/main/browser.ts` 的 `run_workflow` 关闭分支、`src/main/skills/runner.ts` 的主技能关闭分支都走这一份。五个白名单 id 共用 `gateFreeSoulWorkflow`。

**自测**

- `tests/agent-integrity-p0.test.ts`、`tests/dxm-smt-listing.test.ts`
- 五个工作流 id 和 `dxm-smt-listing` 的 `run_skill` 都返回同一文案和同一结构。

**未做**

- 开发版里没有真的关掉开关再让模型从店小秘首页改走只读通用工具。返回结构已由单测盖住。

## P0-02 编辑技能改用现有工具

**改了什么**

- `strategies/skills/dxm-smt-editor-ops.json` 版本 6。`declared_actions` 改为 `list_tabs`、`get_url`、`navigate`、`snapshot`、`page_text`、`click`、`click_text`、`fill`、`reload`、`request_confirm`。剧本不再写页面脚本。保存是 `request_confirm` 之后 `click_text`，文字严格等于「保存」。
- `src/main/agent/free-soul.ts` 导出 `freeSoulToolNames()`。
- 其他 `distilled: true` 技能的 `declared_actions` 去掉了 FreeSoul 没有的 `wait_for`。这些技能的 steps 里仍可能写着 `wait_for`，但蒸馏技能不执行 steps，只回剧本。
- 合同测试：`tests/agent-integrity-p0.test.ts`。`execute` 不在 FreeSoul 工具集里。

**未做**

- 已登录商品页上没有跑这条剧本。等店小秘测试账号。无账号时，合同测试已证明剧本工具都在工具集内。

## P1-02 目录不再是唯一稿件来源

**改了什么**

- `src/main/agent/slots.ts` `hasInlineArticle`：同时有「标题」和「正文」时，不再把 `articleDir` 放进缺槽。
- `src/main/agent/loop.ts` `legalSlots` 同样放行。
- `src/main/agent/intent-router.ts` 英文提示改成目录、内联、粘贴、历史稿件并列。不再出现 “ask for two things” 和 “do not just open the publish page”。中文三条走法仍在。
- `strategies/skills/social-media-publish.json`、`weixin-publish.json`：改为优先 `run_skill`；没有目录但有内联稿件时走通用填稿。

**自测**

- `tests/agent-integrity-p1.test.ts`
- 只给平台和内联标题正文时，`legalSlots` / `sealWorkOrder` 不再问目录。

**未做**

- 中/英侧栏没有真实填进头条草稿箱。等头条测试账号。不发布。

## P1-03 结构化错误

**改了什么**

- `src/main/skills/runner.ts` `runnerFailureCode`：`hard_gate` / `waiting_human` / `validation_failed` / `transient_tool_failure`。预览关闭沿用 `preview_closed`。
- `run_workflow` 工具说明：只有 `waiting_human` 和 `hard_gate` 停等；前三类换变体、换通用工具或换策略。禁止绕过保存、认领、发布、付费仍保留。

**自测**

- 找不到技能返回 `validation_failed`。登录类文案是 `hard_gate`。页面找不到按钮是 `transient_tool_failure`。保存门是 `waiting_human`。

## P1-05 `new_tab`

**改了什么**

- `free-soul.ts` 增加 `new_tab({ url })`。说明是新开标签、认领给当前调用方、不抢当前页焦点，不设站点白名单。
- `browser.ts` `runCoreTool`：`createTab(url, false)`，若活动标签被换走就切回去。

**自测**

- 工具已注册，描述含「不抢用户正在看的页面焦点」。

**未做**

- R4 真机：没有同时留下 Example 与 IANA 两个标签并用 `list_tabs` 核对。不需要登录，可在最终验收时用开发版重跑。

## P1-01 追问三档

**改了什么**

- `free-soul.ts` 系统提示和 `dxm-smt-editor-ops.json` 的 intent：可逆可推断先做并汇报假设；页面事实有值就提取，读不到不编；品牌授权、HS、责任人、资质才问。保存、认领、发布、付费不在自决范围内。

**自测**

- 提示文本含「提问分三档」和上述边界。

**未做**

- 正常非 0×0 编辑页上的停问次数没有统计。等店小秘测试账号。

## P1-04 恢复预览

**改了什么**

- `mission-journal.ts`：`sidebarOffersRecovery()` 改为 true。预览包含目标、最后完成步骤、当前页面、待确认动作。`freshConfirmReply`：下一步是保存、认领、发布、发送、支付或删除时不自动重做。
- `browser.ts` `takeRecoveryAnswer` 先走这道确认。
- `src/main/agent/task-summary.ts`：任务摘要（taskId、目标、状态、最后步骤、时间、clientId）写入 `agent-task-summaries.json`。进程内被挤出最近 10 条的任务仍查不到；重启后内存里没有的任务可以查到。崩溃时仍标成 running 的，查询结果改为 `interrupted`，不自动重放。别人的 client 查不到。
- 工作台发布记录页写明「续跑未接入，页面上不提供续跑按钮」。`studio:resume-task` 仍返回「续跑尚未接入，不会创建发布批次」，没有假按钮。
- 决策点 #67。

**自测**

- `tests/free-soul-guard.test.ts`：回放只追加预览，不改 `missions.jsonl`。
- `tests/agent-integrity-p1.test.ts`：预览字段、危险步骤重新确认、摘要读写。
- `tests/mcp-task.test.ts`、`tests/agent-task-queue.test.ts`：最近 10 条和跨 client 查询仍是 unknown。

**未做**

- 没有杀开发版进程再看侧栏。预览文案和落盘由单测覆盖。

---

## 待授权测试账号

| 账号 | 用途 | 可见范围 |
|---|---|---|
| 店小秘，已登录 | 编辑页只读与可逆字段；保存只停在门前；统计普通字段停问 | 只用隔离测试商品。不点保存落地、不认领、不发布、不付费、不代填验证码 |
| 头条号，已登录 | 中文、英文各一条侧栏内联稿，填到草稿后只读核验草稿箱 | 不点发布、群发、定时、删除 |

不需要登录、留给最终验收的真机：

- 关掉店小秘预览开关后，从首页改走通用只读工具。
- R4：同时保留 Example 与 IANA 两个标签，`list_tabs` 核对，且不抢焦点。
- 发起任务后杀进程再开，侧栏出现恢复预览；危险动作要求重新确认。
