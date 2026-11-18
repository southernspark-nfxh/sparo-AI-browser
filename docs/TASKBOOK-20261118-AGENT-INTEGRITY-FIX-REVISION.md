# Sparo Agent 完整性 · 安全边界回撤与模式对齐任务书

> 版本：v1 · 2026-11-18
> 执行者：Cursor（编码窗口）
> 回撤基线：`9bbd24e` + 上轮修复工作树（S-01/S-02/save-gate/publish-gate 相关改动需回撤，P0/P1 修复保留）
> 输入：本轮对话中用户对安全边界的明确澄清；`docs/DECISION-POINTS.md` 需重写第 65–67 条
> 性质：**回撤过度安全修复，恢复大脑自主决策权；不打包、不发布**

---

## 一、任务定位

上一轮修复中，我犯了三个方向错误：

1. **把 step 模式的确认门，套到了 auto 模式上**——用户选自主模式 = 明确授权发布/保存直接干，我却在 `free-soul.ts:417-428` 把 auto 提示改成了"发布、发送、保存仍要先用 request_confirm"，等于抹掉了自主模式的意义。
2. **把"保存"当成了危险动作**——编辑到一半没保存才是坑，`save` 不是安全边界，是大脑应该自动完成的事。我在 `publish-gate.ts` 里给 save 加了 `commit` 类拦截、在 `runner.ts` 里加了 `save-gate.ts` 拦截，都要撤。
3. **把 login/captcha 也当硬拦了**——这是浏览器里大脑自己能处理的事，拦它是给大脑戴手铐。

本任务回撤这些过度安全修复，同时按用户澄清重新划边界，**不触碰 P0/P1 的正确修复**。

---

## 二、三层安全边界（任务书定死，执行者无权改）

| 层级 | 动作 | 谁拦 | 行为 |
|---|---|---|---|
| **硬拦**（本地，大脑绝对不能自己做） | pay / 付款 / 支付密码 / 支付验证码 | `publish-gate.ts` `allowClick` | 恒拦，返回「必须用户亲自完成支付」 |
| **软边界**（大脑做，做完安全网兜着） | delete / 删除 | `publish-gate.ts` + 通知机制 | ① 允许执行；② 执行后通知用户「已删除 XXX，可在 7 天内从垃圾箱恢复」；③ 若该平台/页面有垃圾箱或撤销 API，优先调 API；没有则只做通知 |
| **大脑自主**（step/auto 模式决定是否预问） | save / 保存、send / 发送、publish / 发布、commit / 保存并认领、commit / 保存并发布、login / 登录、captcha / 验证码 | 模式控制（见第三节） | 见第三节 step vs auto 分工 |

---

## 三、step vs auto 模式分工（任务书定死）

| 动作 | step 模式（逐步完成） | auto 模式（完全自主） |
|---|---|---|
| **save / 保存** | 自动保存，不预问；保存后通知「已保存到 XXX」 | 同 step，自动保存 + 通知 |
| **send / 发送**（非客服） | `request_confirm` 一次 → 执行 → 通知 | 直接执行 + 通知「已发送」 |
| **publish / 发布** | `request_confirm` 一次 → 执行 → 通知 | 直接执行 + 通知「已发布到 XXX」 |
| **commit / 保存并认领 / 保存并发布** | `request_confirm` 一次 → 执行 → 通知 | **仍需 `request_confirm`**（跨账户/跨权限动作，不是单次动作的简单组合） |
| **login / 登录、captcha / 验证码** | 大脑自己处理，不拦；遇到真验证码告诉用户「需要人手动过一下」 | 同 step |
| **pay / 付款** | 硬拦（见第二层） | 硬拦（见第二层） |
| **delete / 删除** | 允许执行 + 通知软边界 | 允许执行 + 通知软边界 |
| **客服发送** | 始终只填草稿 + 通知，不代点发送（产品既定） | 同 step |

---

## 四、回撤清单（上一轮修复中要撤掉的）

| 文件 | 回撤内容 | 为什么撤 |
|---|---|---|
| `publish-gate.ts` | `classifyClick` 中 `save` 类 → 撤出；`commit` 类保留（保存并认领/发布），但只在 step 模式下拦截 | save 不是硬边界；commit 是组合动作跨权限，step 下仍需问，auto 下也需问 |
| `publish-gate.ts` | `allowClick` 中 `login/captcha` 拦截 → 撤掉 | 登录和验证码大脑能处理 |
| `publish-gate.ts` | `gateClickText` 中 `freeSoulRunning` 相关逻辑 → 保留重写但去掉 auto 模式豁免语义的前提假设 | 上一轮把 auto 模式的豁免去掉了，现在要按第三节分工重写：auto 模式下 save/send/publish 直接放行，commit 仍需 landedMatches |
| `free-soul.ts:417-428` | auto 模式的 prompt 改回用户原授权语义：「任务指令授权的是执行过程，发布/发送/保存也一并授权；做完通知就行。支付硬拦，删除走软边界。」 | 上一轮把 auto 改成了"发布保存仍要确认"，抹掉了自主模式的意义 |
| `free-soul.ts:181, 390` | step 模式提示保留"发布/发送/保存/支付/删除需 request_confirm"，但加上"auto 模式下 save/send/publish 直接执行、做完通知"的区分 | 让模型根据当前模式做正确决策 |
| `runner.ts` | 删除 `save-gate.js` 模块及其所有调用；上一轮加的五档错误码分类器保留 | save 不该被 runner 拦截 |
| `dxm-crawl-prep.json` | 撤掉 `human_gates` 中新增的 `save` | save 不是技能层面的硬门 |
| `mission-journal.ts:343` | `stepNeedsFreshConfirm` 中的 `保存|认领|发布|发送|支付|付款|删除` → 改为只匹配 `支付|付款|认领|删除`，去掉 `保存|发布|发送` | save/publish/send 大脑自主；commit 类跨权限、pay/delete 跨账户/不可逆才需重确认 |
| `browser.ts` 相关 | 上一轮加的 `persistTaskSummary` 保留（这是 P1-04 的正确修复，不属于回撤范围） | — |

---

## 五、保留清单（上一轮修复中不动的）

| 项 | 为什么不动 |
|---|---|
| P0-01 预览关闭语义改 | 正确：关掉了"能力不存在"的误导，给了 fallback |
| P0-02 技能合同改 + 合同测试 | 正确：技能声明必须是工具集子集，不开放 execute |
| P1-02 目录降级 | 正确：内联稿件不再被目录强槽拦掉 |
| P1-03 结构化错误码 | 正确：区分 transient/validation/hard_gate |
| P1-05 新增 `new_tab` | 正确：补了工具面缺口 |
| P1-04 恢复入口 + 摘要持久化 | 正确：重启后侧栏能看到未关任务 |
| P1-01 追问三档分类 | 正确：可逆字段先给草案，合法硬信息才问 |
| `dxm-smt-editor-ops.json` 改 `click_text('保存')` | 正确：不用 execute，走确认门（step 模式下） |
| `DECISION-POINTS.md` #28 的 request_confirm 机制 | 正确：不可逆动作的中断点，本身保留 |
| `DECISION-POINTS.md` #63（删除环境即失效）| 正确：删浏览器环境和删商品/内容是两回事，不动 |

---

## 六、新增清单（上一轮没做、现在要加的）

### 6.1 delete 软边界设计

**涉及**：`publish-gate.ts`、通知机制（可能复用现有 toast/侧栏提醒）

**要求**：

1. `classifyClick` 中 delete 类保留，但 `gateClickText` 不再拦截，改为**允许执行 + 触发通知**。
2. 执行后通知内容：「已删除 [目标描述]。若该平台有垃圾箱/撤销 API 可 7 天内恢复；否则请确认删除内容。」
3. 通知方式：侧栏醒目提示（不是静默），且记录在任务 trace 里。
4. 不尝试自动调用垃圾箱 API（各平台差异大），只做通知和建议。
5. `agent-guide.ts` 中"删除真人数据"护栏改为"删除真人数据：允许执行，执行后通知用户"。

**绑定验收场景**：

- 开发版真机：在隔离测试页面（如 demo 站点）执行删除操作 → 动作完成 → 侧栏出现删除通知 → 无硬拦截；
- step/auto 两种模式下行为一致。

### 6.2 publish-gate.ts 重写（step/auto 模式感知）

**当前问题**：上一轮修复后，`gateClickText` 不再区分模式，send/save/publish 在 step 和 auto 下都要 landedMatches——这不对。

**重写要求**：

1. `gateClickText` 需要接收 `execMode` 参数（step/auto）。
2. 按第三节分工：
   - **step 模式**：send/publish/commit 需要 landedMatches；save 直接放行；delete 允许 + 通知；pay/login/captcha 不动；
   - **auto 模式**：save/send/publish 直接放行 + 通知语义；commit 仍需 landedMatches（跨权限）；delete 允许 + 通知；pay 硬拦；login/captcha 放行。
3. 允许 FreeSoul 在 step 模式下自行决定是否调 `request_confirm`（门只负责核验已落地的确认，不强制模型必须调）。
4. `allowClick` 撤掉 login/captcha 拦截，只保留 pay。

### 6.3 `DECISION-POINTS.md` 重写

**要求**：

- 撤掉/改写第 65、66、67 条（上一轮加的错误边界）；
- 改写第 28 条，明确"request_confirm 是 step 模式下 send/publish/commit 的推荐路径，auto 模式下 save/send/publish 不走它"；
- 新增第 68 条：三层安全边界的完整定义（本任务书第二节的表格内容）；
- 新增第 69 条：step/auto 模式分工（本任务书第三节的表格内容）；
- 新增第 70 条：delete 软边界设计（6.1 的要点）。

---

## 七、测试与质量门

1. **回撤后 typecheck/test/lint 必须全绿**（上轮是通过的，回撤不能破）。
2. **新增 step/auto 模式感知的门测试**：
   - step 模式：send/publish 无确认 → 拦截；save → 放行；delete → 放行+通知语义；login → 放行；pay → 硬拦；
   - auto 模式：save/send/publish → 直接放行；commit → 无确认仍拦截；delete → 放行+通知语义；login/captcha → 放行；pay → 硬拦。
3. **delete 软边界 mock 测试**：delete 类 click 返回 `ok:true + notify:` 字段，通知内容含目标描述和恢复建议。
4. **合同测试不变**（P0-02 那个正确修复）。
5. 真机自测在开发版（隔离用户数据目录）进行；**不要自行解决登录态**，需要测试账号的场景列清单交用户授权。

---

## 八、交付物

1. 代码回撤与新增改动（不 commit，留在工作树）。
2. `docs/QA-AGENT-INTEGRITY-FIX-NOTES-v2.md`：回撤清单逐项记录——撤了什么、为什么、对应哪个问题 ID、自测结果。
3. `docs/DECISION-POINTS.md` 重写条目。
4. 待授权测试账号清单（含 step/auto 两种模式下需要登录态的场景）。

---

## 九、回撤后再验收

回撤完成后，最终验收 QA 需要覆盖：

1. step 模式：save/publish/send 都要先 request_confirm 再执行；login/captcha 大脑自己处理；delete 放行+通知。
2. auto 模式：save/publish/send 直接执行+通知；commit（保存并认领）仍需确认；pay 硬拦；login/captcha 放行；delete 放行+通知。
3. pay 在两种模式下都硬拦。
4. 三条免登录回退路径仍能走通（预览关闭回落、双标签、重启恢复）。
5. P1-02/P1-03/P1-05/P1-04/P0-01/P0-02 的正确修复不被回撤。

验收通过后由用户决定版本号与打包。
