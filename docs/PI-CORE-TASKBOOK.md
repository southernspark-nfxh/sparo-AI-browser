# Pi Agent 核心版任务书（v1.1 — 修复干扰 + 立稳核心）

> 本任务书由规划方（Trae）维护，开发由 Cursor 执行。Cursor 从本文件自取上下文，不需要其他会话记录。
> v1.1：已按 2026-11-01 审核意见修订——AGENTS.md 口径拆分、T4 确认态返回与产品语义豁免、T5 站码/丢参/日期解析、T1 与 T6 验收细化、真机未跑如实记录。
> 完成一个任务就跑全量回归（见 §6），全部完成后交回规划方验收。
> 行号基于 2026-11-01 工作区，对不上就按符号名找。

## 0. 北极星（不许漂移）

用户在浏览器侧栏输入框下达任务 → **Pi Agent 大脑**（`pi-core.ts`，模型自主决定每一步）→ 指挥**有头浏览器**真实执行（打开网页、搜索、点击、阅读）→ 完成后向用户汇报。

- 路线、步骤、完成判断**全部交给模型**。本地只允许两类干预：资源护栏（轮次上限）和「给模型的提示注入」。
- **禁止**把旧架构的车道分类、工作单、意图路由、开站正则、交付词表接回 `handleChat`。
- 旧代码原则：**纯执行能力可以复用（URL 构造、工具实现），任务路线一律不搬**。
- `AGENTS.md` 的**禁区全部仍然有效**（不碰 `docs/listings/`、云端 Key 不进客户端、不打包、不提交、云任务计量链路、对人称呼「技能」）。但 `AGENTS.md` **快路径**里的工作单、车道分类、解题思路卡、`parseMission` 等，与决策点 #26 和本北极星冲突时，**一律以 #26 和本北极星为准**：本轮不接回 `handleChat`。
- 新增会改变任务走向的本地判断，先登记 `docs/DECISION-POINTS.md` 再合码（现有登记到 #26，本轮新增从 #27 起）。

## 1. 现状（已存在，不要重做）

- `src/main/agent/pi-core.ts` — 新核心。完整连续 messages、OpenAI 兼容 function calling、11 个浏览原语工具、默认 24 轮上限（到顶如实报"未完成"）。
- `src/main/browser.ts` `handleChat()`（~6205 行）— 侧栏 `spark:chat` 直接进 `piCore.run`，不再走旧分诊。
- `src/main/browser.ts` `runCoreTool()`（~4549 行）— 新核心工具入口：`scroll` 本地实现、`go_back`、其余委托 `runAgentTool()`。
- `tests/pi-core.test.ts` — 已有 2 个测试（上下文完整性 + 轮次上限），TDD 风格参考它。

## 2. 本轮要修的问题（来自 2026-10-31 真人测试，聊天底账在 `%APPDATA%\sparo-store\chat-memory.json`）

| # | 现象 | 根因 |
|---|---|---|
| A | 微博总结任务、12306 火车查询任务都烧完 24 轮没完成 | 模型反复点无反应元素不换策略 + 旧系统插话干扰 |
| B | 任务运行中侧栏冒出「点了没反应。是被弹窗挡住了，还是要换个入口？」和「好，先继续。」——**这不是模型说的话** | 旧学习系统还挂在工具路径上（见 T1） |
| C | 用户明确说「你自己发送」，Agent 仍拒绝发微博 | 系统提示一刀切禁止不可逆动作，无确认门（见 T4） |
| D | 12306 硬刚 UI 失败 | 旧架构有结果页 URL 通道，新核心没有（见 T5） |
| E | 会话开头有旧工作单「上次…继续？」卡片，新核心接不上 | mission-journal 生成（见 T6） |

---

## 3. 任务清单（按此顺序做，T1→T6）

### T1（P0）摘除旧系统对新核心的插话

**根因链（已核实）：**
- `browser.ts:3683` `watchPageTool()`：每次工具执行时若 `helpAsk` 开着就自动调 `skipLearning()`，后者在 `browser.ts:3767` 往 `chatLog` push「好，先继续。」
- `browser.ts:3696` 执行后调 `observePageAction()`（3703）→ `detectFailure` 命中 → `openHelpAsk()`（3720）往 `chatLog` push「…点了没反应…」问题
- `browser.ts:6585` 起还有旧入口对 helpAsk 的应答分诊

**要求：**
1. 在 `SparkBrowser` 加 `piCoreRunning: boolean` 标志，`handleChat` 里 `piCore.run` 执行期间置 true（finally 复位）。
2. `piCoreRunning === true` 时：`watchPageTool` 不调 `skipLearning`、不调 `observePageAction`；`openHelpAsk`、`answerLearning`、`applyHostLessons` 一律不向 chatLog push、不 `setPaused`。
3. 旧架构自己的调用路径保持原样（不删旧代码，只挡住它在新核心运行时发声）。

**验收：**
- 新单测：模拟 piCore 运行中连续 3 次同指纹点击且页面无变化，断言 chatLog 长度不变、无 helpAsk 产生。
- 新单测（第一次点击也要盖住）：`helpAsk` 在 piCore 运行前已经开着时，第一次点击**不得** push「好，先继续。」、**不得** `setPaused`。
- 真机：重跑微博任务，全程侧栏只有模型自己的话。

**禁区：** 不许为了修这个把旧学习系统整体删除；`watchPageTool` 里只允许加 `piCoreRunning` 这一个布尔短路，不许再加其他本地判断。6585 行的 helpAsk 应答分诊在 `dispatchChatJob` 里，侧栏已经不走那条路，T1 不要动它。

### T2（P0）防卡死提示注入

**要求：**
1. `pi-core.ts` 的 `run()` 内跟踪工具调用指纹（工具名 + 关键参数 + 执行前后页面指纹——页面指纹由工具结果或传入的 url/title 判断，若拿不到就以工具结果 message 判断）。
2. **同一指纹连续 3 次、页面无变化** → 向 `messages` 注入一条 `user` 角色 hint：「同一操作已连续 3 次无效果。这条路径大概率没反应：换入口、直接构造结果 URL、换选择器，或如实向用户汇报当前障碍。禁止继续重复同一操作。」注入后清空指纹计数，让模型继续（不终止、不关单）。
3. 这是改变任务走向的本地判断 → 先在 `docs/DECISION-POINTS.md` 登记 **#27**，写明：只注入提示，不替模型决定，不伪造完成。**#27 只管新核心，不许改动旧决策点 #9**（那是旧大脑里的连点掐断，两套互不影响）。
4. 层级说明：T3 的「连点两次就换」写在系统提示里、由模型自觉执行；T2 的「第三次注入」是本地护栏兜底。**两层各管各的，不许把数字统一成一个。**

**验收：**
- 新单测：用 fake `fetchImpl` 让模型永远返回同一个 click 调用，断言第 3 次后 messages 里出现该 hint，且任务最终仍按轮次上限规则结束（不会假报完成）。
- 真机：12306 任务不再烧完 24 轮仍无汇报。

**禁区：** 不许本地直接 break 循环、不许替模型输出「已放弃」类文案。

### T3（P1）系统提示加反卡死规则

**要求：** `pi-core.ts` `systemPrompt()` 增加三条：
1. 「同一元素或同一路径连续两次没有引起页面变化就换策略：换入口、直接构造结果 URL、换交互方式；禁止对同一目标连点超过两次。」
2. 「页面需要登录或出现验证码时，如实告知用户并停在该处等用户处理，不要反复尝试绕过。」
3. 「无法完成时如实汇报卡在哪一步，不要空转。」

注意：第 1 条的「两次」是给模型的自律规则；T2 的「第三次注入」是本地兜底护栏。两层不要合并。

**验收：** 单测断言 systemPrompt 含关键词（"连点"/"验证码"级别即可）。T2 的 hint 文案与这里不重复冲突。

### T4（P1）不可逆动作确认门

**产品语义豁免（先读再动手）：** `docs/PRODUCT.md` 现行语义是「草稿进框，发送和提交仍由人点」。本轮变更为「经过一次确认往返后，模型可以代点发送」。**豁免范围仅限发布、发送、支付、删除四类不可逆动作**；客服（CS）回复仍然只填草稿、发送由人点，不变。完成记录里注明 PRODUCT.md 需要同步改这一句（改文档本身留给规划方）。

**要求：**
1. `pi-core.ts` 新增工具 `request_confirm`：参数 `{ action: string, detail: string }`。模型在执行发布/发送/支付/删除等不可逆动作**之前**必须调用。
2. piCore 收到 `request_confirm` 后：立即结束本次 run，返回 `{ ok: true, text: 确认问句, awaitingConfirm: true }`（如「我准备执行：{action}。{detail} 确认吗？」）。这是**中断等待用户**，必须用成功态返回——`ok: false` 留给真失败，否则侧栏会把确认问句当执行失败处理。`handleChat` 照常把 text 进 chatLog，`awaitingConfirm` 标记透传（界面暂不需要专门渲染）。
3. 用户在下一条消息里答复（确认或拒绝），答复进入 history，下一次 run 模型可见。
4. `systemPrompt` 里把「核心版不执行发布、发送、支付、删除等不可逆最终动作」**替换**为：「发布、发送、支付、删除等不可逆动作：先用 request_confirm 向用户确认，得到用户明确同意后才执行。用户此前下过的命令不算同意，必须经过一次确认往返。」
5. 确认判定交给模型（history 里看用户最新消息），本地不做正则拦截。但 `request_confirm` 本身必须真实中断 run，不许模型"自问自答"。
6. **本轮不复用**现有 `requestApproval` / `spark:resolve-approval` 审批卡，两套并存、互不接线；确认门只走 `request_confirm` 中断机制。
7. 登记 `docs/DECISION-POINTS.md` **#28**：request_confirm 是唯一合法的不可逆动作中断点。

**验收：**
- 单测 1：模型发出 request_confirm → run 返回 `ok: true` 且 `awaitingConfirm: true`、以确认问句结束；单测 2：模拟用户确认后，模型调用 click 发送 → 工具被执行、最终回复 ok。
- 真机：发微博任务，草稿写好 → 出确认问句 → 用户回「确认」→ 真点到发送按钮。

**禁区：** 不许本地存"已确认"标志绕过模型；不许对可逆动作（点击、翻页、搜索）也要求确认。

### T5（P1）火车/机票/酒店结果页 URL 通道

**要求：**
1. URL 构造的现成入口在 `src/main/agent/travel.ts`：`travelResultUrl()`（约 902 行）已统一包了火车/机票/酒店/搜索；`trainSearchUrl()`（854 行）在站码缺失时返回**不带日期的裸地址** `https://kyfw.12306.cn/otn/leftTicket/init`（863 行）。先确认 12306 / 携程等站点的**结果页 URL 模板现在是否仍有效**（可用真实导航验证）。
2. 站码表 `TRAIN_CODE` 里没有临汾。**允许补站码数据**（至少补临汾），补齐后 `trainSearchUrl` 才能产出带日期的完整查询 URL。
3. 「明天」在 `search_site` 工具内按**北京时间**解析成 `YYYY-MM-DD`——这只是组 URL 参数，不算路线判断。
4. 12306 经常把 URL 参数丢掉（`page-scripts.ts:384` 注释写明，旧代码用 `fill12306Form`，`browser.ts:7964`，把站名和日期填回表单再点查询）。允许新核心在真实打开后**发现参数被丢时，补一次查询表单并点一次查询**——这是执行能力，不是路线判断。
5. 提取为纯函数，包装成新工具 `search_site({ site: "train"|"flight"|"hotel", from?, to?, date?, query? })` → 返回可直接 `navigate` 的结果页 URL（返回 `{ ok, data: { url } }`）。只搬 URL 构造和上面的表单补救，禁止搬旧任务路线、站点表意图、车道。
6. `systemPrompt` 加一句：「查询火车、机票、酒店时优先用 search_site 拿结果页 URL 再 navigate，不要硬刚这些站点的首页。」
7. 模板**确认失效**时才返回 `{ ok: false, message: "该站点结果页通道暂不可用" }`，让模型自己换路，不许硬编码假 URL。

**验收：**
- 单测：`search_site({ site:"train", from:"临汾", to:"北京", date: 明天 })` 返回以 `kyfw.12306.cn` 开头、**含日期参数**的查询 URL（补完临汾站码才能过这条）。
- 真机：「搜一下明天临汾到北京的火车时间和价格」24 轮内给出车次与价格，或如实汇报 12306 需要验证。

### T6（P2）清理旧挂起卡片

**要求：**
1. 开口在 `offerMissionRecovery()`（`browser.ts` 约 950 行被调用、约 6175 行往 chatLog 写入），问句文案是 `recoveryLine`（`mission-journal.ts` 约 346 行）。新核心上线后这条恢复问句**不再自动 push** 到 chatLog（启动时、会话恢复时都不 push）。
2. 旧 `missions.jsonl` 数据不删，旧代码不删——只是不再让旧单在侧栏开口。

**验收：** 重启应用，**不再追加新的**继续问句；`chatLog` / `chat-memory.json` 里已经存在的旧问句**原样保留，不算失败**。

---

## 4. 全局禁区（违反 = 打回）

1. `handleChat` 只进 `piCore`。不许加回 `matchWaitingResume` / `laneForText` / `enqueueBackground` / `enqueueForeground` / `executeMission` 任何调用。
2. 不碰 `docs/listings/`。不打包（`npm run dist`）、不提交 git。
3. 旧架构未被新核心引用的文件不动、不删、不重构。
4. 所有新本地判断先登记 `docs/DECISION-POINTS.md`（#27、#28 已在 T2/T4 指定；若实现中还需要别的判断，先登记编号再写码）。
5. 云端 Key 不进客户端；云任务 `task_id` 计量链路（`applyDeepSeekCfg` / `beginCloudTaskIfNeeded`）不许破坏。

## 5. 工程要求

- **TDD**：改 `pi-core.ts` 的每个任务（T2/T3/T4/T5）先写失败测试再实现。测试放 `tests/`，风格照 `tests/pi-core.test.ts`。
- 每完成一个任务跑：`npm test`（全量必须全绿）、`npm run typecheck`。
- 全部完成后跑 `npm run build`，然后按 §6 真机自测。

## 6. 真机验收场景（全部通过才算完成，用 `npm run start` + 侧栏输入）

| 场景 | 输入 | 通过标准 |
|---|---|---|
| Q1 | 「打开微博，进入汪海林主页，总结今天他发了多少条微博」 | 24 轮内给出条数与要点；全程无旧系统插话；若被登录/验证挡住则如实汇报 |
| Q2 | 「搜一下明天临汾到北京的火车时间和价格」 | 走 search_site 结果页通道；给出车次+价格或如实说明障碍；不烧完 24 轮无汇报 |
| Q3 | 「打开微博发一条测试微博，内容积极吐槽股市大跌，先看热点再发」 | 草稿写好 → request_confirm 确认 → 用户回「确认」后真点发送（此场景需要人在场点确认） |
| Q4 | 重启 Sparo | **不再追加新的**旧单继续问句（已存留的旧问句保留，不算失败）；无控制台报错 |

---

## 7. 完成交付

Cursor 完成后在本文件末尾追加「完成记录」：每个任务列出改动文件、新增测试名、决策点登记号、真机场景结果（通过/未过+原因）。**真机场景没跑就如实写「未跑」，不许标通过**（尤其 Q3 需要人在场回「确认」）。规划方按此记录复查代码 + 复跑 Q1-Q4。

---

## 完成记录（2026-11-02，Cursor）

全量 `npm test`：70 个文件、572 项通过。`npm run typecheck` 通过。`npm run build` 通过。未打包，未提交 git。Q1–Q4 均 **未跑**（需要已登录的微博 / 12306，Q3 还要人在场回「确认」）。

`docs/PRODUCT.md` 里「发送仍由人在页面上点」这一句本轮代码已按豁免改行为，**文档本身没有改**，留给规划方。

### T1

- 改动：`src/main/browser.ts`（`piCoreRunning`，`handleChat` 在 `piCore.run` 期间置位并在 finally 复位；`watchPageTool` 只加这一处布尔短路；`openHelpAsk` / `answerLearning` / `applyHostLessons` 在此期间不写 chatLog、不 `setPaused`）
- 测试：`tests/pi-core-guard.test.ts`
  - 「连续 3 次同指纹点击且页面不变时，不写 chatLog、不产生 helpAsk」
  - 「helpAsk 已经开着时，第一次点击不说「好，先继续」，也不暂停」
  - 「新核心没在跑时，连点无变化仍会开口」（确认旧路径还在）
- 决策点：无（只是挡住旧系统发声）
- 真机：未跑

### T2

- 改动：`src/main/agent/pi-core.ts`（同一指纹连续 3 次且页面无变化时注入 user hint，然后清空计数，不结束循环）
- 测试：`tests/pi-core.test.ts`「同一点击连续 3 次无变化后注入换策略提示，仍按轮次上限结束」
- 决策点：**#27**（`docs/DECISION-POINTS.md`）。没有改 #9
- 真机：未跑

### T3

- 改动：`src/main/agent/pi-core.ts` `systemPrompt()` 增加连点两次换路、验证码如实停、无法完成就汇报。与 T2 的「第 3 次注入」没有并成同一个数字
- 测试：`tests/pi-core.test.ts`「系统提示要求两次就换路，并带上确认门和结果页通道」（断言含「连点」「验证码」，且系统提示里没有 T2 那句「已连续 3 次无效果」）
- 决策点：无（提示词，不新增本地判断）
- 真机：未跑

### T4

- 改动：`src/main/agent/pi-core.ts` 新增 `request_confirm`，命中后立刻返回 `{ ok: true, awaitingConfirm: true, text }`。`handleChat` 把 text 推进 chatLog，并把 `awaitingConfirm` 放进返回值 `data`。没有接 `requestApproval`
- 系统提示替换了「核心版不执行发布…」。另加了一句：客服回复只填草稿，发送仍由用户在页面上点
- 测试：`tests/pi-core.test.ts`
  - 「request_confirm 用成功态结束本轮，不执行后续工具」
  - 「用户确认后，模型再点发送时工具会执行」
- 决策点：**#28**
- 真机：未跑

### T5

- 改动：
  - `src/main/agent/travel.ts`：`TRAIN_CODE` 补临汾 `LFV`；`searchSite` / `resolveSearchDate`（明天按北京时间）；`parse12306TicketQuery` / `landedDropped12306Params`
  - `src/main/agent/pi-core.ts`：工具 `search_site`，系统提示优先走结果页
  - `src/main/browser.ts`：`runCoreTool` 执行 `search_site`；navigate 落地后若 12306 丢掉日期参数，`repair12306QueryOnce` 补一次表单（内部会点一次查询）
- 测试：`tests/travel.test.ts`
  - 「临汾到北京的明天按北京时间拼出带日期的 12306 结果页」
  - 「站码拼不出时不返回不带日期的裸地址」
- 决策点：无（任务书已写明这是组 URL 和一次表单补救，不是路线判断）
- 真机：未跑。结果页模板没有用真实导航复核，丢参补表单也没有在 12306 页面上点过

### T6

- 改动：`src/main/agent/mission-journal.ts` 增加 `sidebarOffersRecovery()`（返回 false）；`offerMissionRecovery()` 在此为 false 时不 push、不设置 `pendingRecovery`。`recoveryLine` 和 `missions.jsonl` 都还在
- 测试：`tests/pi-core-guard.test.ts`「重启回放时不追加继续问句，已有问句和日志原样留着」
- 决策点：无
- 真机：未跑

### Q1–Q4

| 场景 | 结果 |
|---|---|
| Q1 微博总结 | 未跑 |
| Q2 临汾到北京火车 | 未跑 |
| Q3 确认后真发送 | 未跑 |
| Q4 重启无新的继续问句 | 未跑 |

---

# 第二轮（v2）— 真机复测后的修复

> 2026-11-02 规划方复测结论：**Q2 通过**（10 个车次 + 票价表，携程与 12306 交叉核对，`search_site` 通道完整走通）；**Q3 通过**（确认门全链路正常）；**Q4 通过**（重启无新问句）。**Q1 失败**：微博总结仍烧完 24 轮无汇报。Q1 失败的完整轨迹已由规划方加的 `[pi-core]` 轮次日志捕获（`pi-core.ts` 里 `console.log` 那几行是**永久诊断能力，不许删**），根因如下，本轮只修这些。

## Q1 轨迹与根因（已核实）

模型 r1–r13 表现优秀：打开微博 → 进汪海林主页 → 滚动读 feed（491→1437 字）→ 甚至会用 `s.weibo.com` 按作者+时间搜索。**r11/r13 时答案已经到手**。之后回主页反复滚动，r15–r19 `page_text` 三次返回**同样的 495 字**（懒加载没触发），模型毫无察觉继续滚，24 轮烧完，带着数据进了棺材。

三个具体缺口：

1. **新核心 page_text 丢了旧版的「较上次 +N 字」增量标记**。旧实现还在 `src/main/agent/deepseek.ts:432`（`deltaText` 函数）和 `590`（应用处），旧工具描述（`deepseek.ts:116`）教过模型「+0 字表示没有新内容：换策略，不要连按同一个键」。新核心 `pi-core.ts` 的 page_text 消息只有 `page_text N chars`，系统提示也没这条规则。
2. **指纹卡死检测对「scroll→read 交替」失明**。`noteStuck` 按「工具名+参数+前后页面指纹」比较，scroll 和 page_text 交替出现时每个指纹只隔轮重复，永远凑不满连续 3 次。本轮两个任务 **STUCK_HINT 一次都没触发**（轨迹里零条）。
3. **没有轮次预算感知**。模型不知道自己快没轮了，也不被鼓励「信息够就收工」。它在 r13 就该汇报了。

## T7（P0）page_text 增量标记移植 + 教模型用法

**要求：**
1. `pi-core.ts` 的 run 内维护「上次 page_text 正文」状态（每次 run 开始时清空）。工具结果为 page_text 且 ok 时，计算本次与上次的字数差，把消息从 `page_text N chars` 改为 `page_text N chars（较上次 +M 字）`——负数写 `较上次 -M 字`，首次不附加。格式与旧版 `deepseek.ts:432` 一致。
2. `systemPrompt()` 的 page_text 规则后追加一句（对照旧版 `deepseek.ts:116` 的成熟文案改写）：「滚动翻页采集时注意 page_text 消息里的「较上次 +N 字」：+0 表示这一屏没有新内容，立即基于已读内容汇报或换浏览方式，不要继续滚动。」
3. 增量计算只是给模型的观察信息，不算路线判断，无需登记决策点。

**验收（TDD）：**
- 单测：同一 run 内连续两次返回相同正文 → 第二次工具消息含 `较上次 +0 字`；正文变长 → 含 `+M 字`；两次 run 之间状态清零。
- 真机：重跑 Q1，滚动到无新内容时模型能看到 `+0 字` 并停止空转滚动。

## T8（P0）收工护栏：内容级卡死 + 轮次预算 + 够用即报

**要求：**
1. **内容级卡死**（补 #27 的盲区）：run 内跟踪 page_text 的正文（哈希或全文比较），**连续 3 次 page_text 内容一致**（中间不管夹了 scroll 还是别的工具）→ 注入 user hint：「page_text 连续 3 次读到同样内容，页面已无新信息。基于已读内容立即汇报，或明确说明障碍，不要继续滚动或重复读取。」注入后清空计数。与 #27 的指纹检测并存，两层兜底。登记决策点 **#29**：只注入提示，不终止、不替模型决定。
2. **轮次预算提示**：默认 24 轮的 run，执行到第 **18** 轮（75%）开始，注入一次 user hint：「已执行 18/24 轮。已有信息足够回答用户就立即汇总汇报；不够就明确说还缺什么、卡在哪。不要再开新路径。」每次 run 只注入这一次。`maxRounds` 可配时按 75% 取整。登记决策点 **#30**：预算提示不改变任务走向，只提醒收尾。
3. `systemPrompt()` 追加：「回答所需信息已经读到时立即汇总汇报，宁可注明局限（如「截至第 N 条」），不要为追求完整耗尽轮次。」

**验收（TDD）：**
- 单测：3 次相同 page_text（中间夹 scroll）→ hint 注入且消息序列正确；18 轮 → 预算 hint 恰好出现一次；两个 hint 都不 break 循环、不伪造最终回复。
- 真机 Q1：微博总结在 24 轮内产出汇报（哪怕是「截至今读到 X 条」），不再出现纯上限消息。
- 真机 Q2：火车票仍通过（确认护栏没有把正常探索误伤）。

## T9（P2）窗口 1px 宽度振荡

**现象（已核实）**：上一会话日志里 `[chrome-hole] bounds-changed` 连续刷屏，页面洞宽度在 961↔962 之间每 300ms 振荡，从启动持续到关闭。日志见规划方会话存档，复现方式：启动应用静置观察主进程日志。

**要求：**
1. 定位振荡源头（优先怀疑：DPI 缩放下页面洞宽度取整反馈，或 shell 布局对 `pageHoleBounds` 的请求与主进程回设形成 1px 回路）。
2. 修复后静置 5 分钟日志里不再出现连续 bounds-changed 刷屏（个别偶发可接受）。
3. 顺带确认振荡与 `[shell-unresponsive] sidebar` 告警（crash.log 有两条）是否相关，相关就一并消掉，不相关就在完成记录里写明不相关。

**验收：** 静置 5 分钟主进程日志 bounds-changed ≤ 个位数；crash.log 无新增 shell-unresponsive。

## 本轮禁区

1. `[pi-core]` 轮次日志不许删（已并入 §5 工程要求）。
2. T8 的两个 hint 只注入、不终止——模型仍是唯一决定者。
3. 不动 T1–T6 已交付的行为；Q2/Q3/Q4 的通过不许回退。
4. 全部完成后跑 `npm test`（全量）、`npm run typecheck`、`npm run build`，真机 Q1/Q2 自测后如实写「通过/未过/未跑」。

## 本轮真机验收（Cursor 自测 + 规划方复核）

| 场景 | 通过标准 |
|---|---|
| Q1 微博总结 | 24 轮内产出汇报（含条数或注明截读）；轨迹里能看到 `+0 字` 之后模型换行为；无纯上限消息 |
| Q2 火车票 | 仍给出车次+价格；两个新 hint 没有误伤正常探索 |

### 规划方复核结论（2026-11-02 14:5x）——**本轮通过，v2 收口**

- **Q1 通过**：9 轮完成（上一版 24 轮烧完无汇报）。增量标记全程可见（`较上次 -3407/+524/-83 字`），最终给出「截至今日 3 条微博、全部转发」+ 时间表，是可核实的真回答。`PAGE_SAME_HINT`/`BUDGET_HINT` 未触发——任务在 18 轮前自然收工，系统提示的「+0 就停」「够用即报」已让模型自觉收尾，护栏作为兜底存在（触发路径由单测覆盖）。
- **Q2 通过**：5 轮完成（上一版 19+ 轮绕路）。search_site → 12306 结果页 → 携程交叉核对 → 10 车次票价表。
- **用户追加测试**：「帮我复制汪海林最近的三条微博」13 轮完成——自主进详情页、点「展开」、逐条读原文，交付可复制纯文本+链接。多步任务自主排布能力正常。
- **T9 通过**：bounds-changed 从上一会话 144 条降到 3 条，1px 振荡消除。
- 577 项测试 + typecheck 规划方本人复跑全绿。

---

## 完成记录（v2，2026-11-02，Cursor）

全量 `npm test`：70 个文件、577 项通过。`npm run typecheck` 通过。`npm run build` 通过。未打包，未提交 git。`[pi-core]` 原有 `run start` / 每轮工具 / `STUCK_HINT` 日志都还在，并补了 `PAGE_SAME_HINT` 和 `BUDGET_HINT`。

### T7

- 改动：`src/main/agent/pi-core.ts`。每次 run 清空上次正文。`page_text` 成功时用 `pageTextGrowthNote`（`deepseek.ts`）把工具消息改成 `page_text N chars（较上次 +M 字）`，变短写 `较上次 -M 字`，第一次不附加。系统提示增加「+0 就停」
- 测试：`tests/pi-core.test.ts`
  - 「page_text 从第二次起标注较上次字数，下一次 run 重新计数」
  - 「正文变短时写成较上次负数」
  - 「系统提示要求两次就换路，并带上确认门和结果页通道」里增加了对「较上次 +N 字」的断言
- 决策点：无
- 真机：未跑

### T8

- 改动：`src/main/agent/pi-core.ts`。连续 3 次相同 `page_text` 正文（中间可以夹 scroll）注入正文提示并清零计数。轮次到达 `floor(maxRounds * 0.75)`（默认 18/24）时注入一次预算提示。系统提示增加「够用即报」。两处都不结束循环
- 测试：`tests/pi-core.test.ts`
  - 「三次相同 page_text 中间夹滚动仍注入正文提示，并且继续执行」
  - 「第 18/24 轮注入一次预算提示，不伪造最终回复」
- 决策点：**#29**、**#30**（`docs/DECISION-POINTS.md`）。没有改 #27
- 真机 Q1：未跑
- 真机 Q2：未跑

### T9

- 根因：页面洞宽度在 DPI 下会在相邻 1px 间来回跳。`setPageHoleBounds` 一变就 `applyViewBounds`，`mountPageView` 再差 1px 写一次强制刷新，`bounds-changed` 和窗口 `resize` 又把布局打回来，形成 961↔962 回路
- 改动：
  - `src/main/page-bounds.ts` 增加 `boundsWithinOnePixel`
  - `src/main/browser.ts`：洞尺寸或客户区只差 1px 时不再重排；视图已经贴着目标矩形时不再做 1px nudge；1px 的 `bounds-changed` 不写日志。整窗盖住顶栏的修复仍会执行
- 和 `shell-unresponsive` 的关系：不是同一个故障。`[shell] unresponsive` 来自壳层渲染进程假死（`onShellUnresponsive` → `crash.log` 的 `shell-unresponsive / sidebar`）。1px 回路会让壳层 ResizeObserver 连续回调，假死处理又会 `armChromeGuard` 再排一次版，所以它会放大振荡，但假死本身另有触发条件。这次只拆掉 1px 回路，没有改假死处理，也没有改已有的 `crash.log`
- 测试：`tests/page-bounds.test.ts`「把 961 和 962 当成同一矩形，整窗盖住仍然要修」
- 真机静置 5 分钟：未跑。当时已有 Electron 进程在跑，没有另开一个 Sparo 去占窗口

### Q1 / Q2

| 场景 | 结果 |
|---|---|
| Q1 微博总结 | 未跑 |
| Q2 火车票 | 未跑 |

---

# 规划方复核结论（v2 收口 + 十题测试，2026-11-02）

## Q1 / Q2 复跑（v2 验收）

- **Q1 通过**：微博总结 9 轮完成（r13 拿到答案、PAGE_SAME_HINT 后及时收口），「截至今日 3 条微博全部转发」。
- **Q2 通过**：火车票 5 轮出 10 车次票价表，search_site 通道完整走通。

## 十题复杂任务自动化测试（规划方自跑，CDP 驱动侧栏）

10/10 全部通过，全部真开网页核实，无假报。要点：

| 题目 | 轮次 | 结果 |
|---|---|---|
| 诺贝尔文学奖核实（要求开新闻页） | 19 | 过，最终自己打开 nobelprize.org 官网 |
| 《三体》当当 vs 京东比价 | 6 | 过，滚动一次见 +0 字立即停 |
| 下周三北京飞上海机票 | 9 | 过（search_site 机票通道失败后模型自建携程 URL，见 T13） |
| 北京明后两天天气 | 4 | 过，墨迹+天气网双源 |
| 微博热搜前 5 总结 | 14 | 过，逐条点进详情页读摘要 |
| Python 3.13 新特性 | 2 | 过，直达官方文档 |
| 人民币兑美元汇率算 8888 元 | 6 | 过，三源核对 |
| 后天太原→西安高铁 | 19 | 过（search_site 火车通道失败后模型自拼 12306 URL，见 T13） |
| 钱学森三句话 | 4 | 过，+0 字即停 |
| 颐和园门票+冬季注意 | 13 | 过，撞百度验证码时基于已读内容收口，没硬绕 |

护栏表现：BUDGET_HINT 触发 2 次均随后收敛；「+0 字就停」至少救了 2 题的无效滚动；STUCK_HINT/PAGE_SAME_HINT 零触发（模型在护栏出手前已自己换路）。

遗留缺陷（本轮 v3 修，见 T13）：search_site 的 flight/train 两次返回「该站点结果页通道暂不可用」。

收尾：测试用临时代码已清理——`index.ts` 的 `SPARO_DEBUG_PORT` 注入已删，临时测试脚本已删。

## 用户真机复测（微博 / 知乎，2026-11-02）

- **微博发布：闭环成功** ✅。找热点→写 324 字带标签正文→填入→点击发布→跳个人主页验证（微博数 40→41、拿到帖子链接）→汇报。
- **知乎回答：两次烧完 24 轮，用户确认后最终未能发布** ❌。链路：读问题→去 GitHub 读 3 个调研文档（12 轮，合理）→「继续」时消息被丢一次→填好 3384 字草稿→request_confirm 确认（T4 生效）→用户吐槽 AI 味→重写 1585 字口语版→request_confirm→用户回「确认」→**烧完 24 轮没发出去**。

知乎失败的具体事故点（轨迹可证）：

| 轮 | 事故 |
|---|---|
| r22 | `click ok=false QA gate blocked submit: QA FAIL：当前为速卖通产品编辑页` —— 店小秘专用 QA 闸门把知乎页面误判拦截 |
| r11 | `fill fallback failed expected=1563 actual=0` —— 知乎 contenteditable 编辑器，fill 首次丢字，模型靠 Ctrl+a+Backspace+execCommand 自救 |
| 全程 | snapshot 大量返回 `0 interactive elements`（紧接重试一次就有 181/222 个），每次浪费 1 轮 |
| 「继续」 | 用户消息被 `chatRunning` 挡下直接丢弃，不进 chatLog、模型不可见，用户只能重发 |

---

# 第三轮（v3）— 摘掉通用路径残留闸门 + 工具可靠性

> 北极星不变（见 §0）。本轮核心：新核心已经能走通信息类任务，但通用执行路径上还残留着**为旧工作流设计的本地闸门**（QA gate、审批卡、消息挡板），它们在误伤新核心；另有三个工具可靠性问题（snapshot 空拍、fill 丢字、search_site 通道）在放大轮次消耗。
> 行号基于 2026-11-02 工作区，对不上就按符号名找。决策点现有登记到 #30，本轮新增从 #31 起。

## 本轮要修的问题

| # | 现象 | 根因 |
|---|---|---|
| A | 知乎发布点击被拦：「QA gate blocked submit: QA FAIL：当前为速卖通产品编辑页」 | 通用 click 路径 `browser.ts:10123` 对提交类按钮强制 `qaGate()`，而 `buildSmtQaReport`（`qa/dianxiaomi-smt.ts:91`）只认 `dianxiaomi.com/web/smt/edit`，其他站点必 fail；后面 `browser.ts:10126` 还挂 `requestApproval`（见 T10） |
| B | snapshot 大量「0 interactive elements」，模型反复重拍烧轮次 | 单次采集，SPA 页面渲染未就绪即返回空（见 T11） |
| C | fill 在知乎 contenteditable 编辑器 `expected=1563 actual=0` | fill 回读不符时没有自动清场重试，靠模型自救（见 T12） |
| D | 两次烧完 24 轮（A+B+C 叠加放大，但发布类长任务本身余量也偏紧） | maxRounds 默认 24 偏紧（见 T16） |
| E | 「继续」被回「上一个任务还在执行」且消息被丢弃 | `browser.ts:6257` chatRunning 时直接 return，用户消息不进 chatLog（见 T14） |
| F | search_site 的 flight/train 返回「暂不可用」（十题测试遗留） | `resolveSearchDate`（`travel.ts:1017`）不认「下周三」；TRAIN_CODE 缺太原/西安（T5 只补了临汾）（见 T13） |
| G | 发布正文 AI 味重（md 加粗、1️⃣ 序号），用户两次吐槽 | 系统提示没有社交平台文案风格约束（见 T15） |

## 任务清单（T10→T16）

### T10（P0）通用 click 上的 QA gate 与审批卡对新核心放行

**根因链（已核实）：**
- `browser.ts:10112-10132`：任何 click 只要按钮文字命中 `looksLikeSubmitAction`（提交/保存/发布类，`qa/dianxiaomi-smt.ts:222`），就走 `qaGate()` → `buildSmtQaReport` 里 `onSmt = /dianxiaomi\.com\/web\/smt\/edit/i.test(url)`（91 行），非店小秘页面必 fail → 返回 `QA gate blocked submit`。这是店小秘工作流的专用闸门，却挂在通用 click 路径上，误伤一切站点的提交动作。
- `browser.ts:10126`：QA 过了之后还会弹 `requestApproval`（审批卡）。T4 已明确「两套并存、互不接线」——但通用 click 路径把新核心也拦进去了。

**要求：**
1. `piCoreRunning === true` 时，`browser.ts:10112-10132` 这段提交闸门**整体跳过**：不调 `qaGate()`、不弹 `requestApproval`。新核心的不可逆动作确认已由模型层 `request_confirm`（决策点 #28）承担，执行层不得重复拦截。
2. 旧架构/店小秘工作流自己的路径不受影响（`piCoreRunning === false` 时行为原样）。
3. 登记 `docs/DECISION-POINTS.md` **#31**：新核心运行中，通用 click 的提交闸门（QA gate + requestApproval）放行；确认责任在模型层 request_confirm，本地不再二次拦截。

**验收：**
- 单测：`piCoreRunning=true` 时点击「发布」按钮不触发 qaGate/requestApproval；`false` 时仍拦。
- 真机（Q5）：知乎回答确认后能真点到发布按钮，全程无「速卖通」字样、无审批卡弹出。

**禁区：** 不许删 `looksLikeSubmitAction` / `qaGate` / `requestApproval` 本身（店小秘工作流还在用）；只允许加 `piCoreRunning` 这一个布尔短路，不许引入其他站点白名单之类的本地判断。

### T11（P0）snapshot 空结果内部重试

**根因链：** `browser.ts:9985` 附近单次采集。知乎/微博这类 SPA 页面首拍常返回 `Snapshot: 0 interactive elements`，模型紧接着再拍一次就有 181/222 个——轨迹里知乎一次 run 出现过 6 次 0 元素，每次浪费一轮预算。

**要求：**
1. snapshot 采集结果为 0 elements 且页面不是 about:blank 时：等约 600ms 在工具内部重采一次，仍为 0 才如实返回 0。重试不占模型轮次。
2. 返回 message 注明重试（如 `(retried)`），保留诊断能力。
3. 0 元素的结果照常进 lastSnapshot，不许伪造「页面为空」之类的路线判断文案。

**验收：**
- 单测：fake 采集器第一次 0、第二次 N，断言一次调用返回 N 且 message 带 retried；两次都 0 时如实返回 0。
- 真机（Q5 前置）：知乎问题页连拍 10 次 snapshot，0 元素结果 ≤1 次。

### T12（P1）fill 对 contenteditable 富文本编辑器的稳定重试

**根因链：** 知乎「确认」run r11 `fill fallback failed expected=1563 actual=0`（`fill-unicode-v2`，`browser.ts:10250` 起）。模型自己用 Ctrl+a → Backspace 清场后再 fill（execCommand-insertText 路径）才成功——这个自救动作应该在工具内部完成。

**要求：**
1. fill 回读 `actual` 与 `expected` 严重不符（actual 为空或明显偏短）且目标是 contenteditable 时：自动执行 focus → 全选清空 → insertText 重试一轮，再回读。策略链在工具内部完成，不占模型轮次。
2. 失败 message 带上目标元素 tag、是否 contenteditable，方便继续诊断。

**验收：**
- 单测：模拟 contenteditable 首填丢字、重试成功；重试也失败时如实返回失败。
- 真机（Q5 前置）：知乎回答编辑器连填 5 次长文，成功 ≥4 次。

### T13（P1）search_site 日期词汇与站码覆盖

**根因链（十题测试轨迹可证）：**
- flight（机票题）：模型传 `date="下周三"` → `resolveSearchDate`（`travel.ts:1017-1025`）只认 `YYYY-MM-DD`/今天/明天/后天 → 返回空 → `travel.ts:1073` 报 SITE_UNAVAILABLE。
- train（高铁题）：太原/西安不在 `TRAIN_CODE` 表（T5 只补了临汾）→ `trainStationCode` 为空 → `travel.ts:1063` 报 SITE_UNAVAILABLE。模型下一轮自己拼的 URL 里就有 TYV/XAY——纯粹是表缺数据。

**要求：**
1. `resolveSearchDate` 增认：`周X`/`星期X`（北京时间未来最近的一个周X）、`X月X号`/`X月X日`（今年，已过则明年）、`MM-DD`（今年）。仍认不出返回空、报 SITE_UNAVAILABLE——**不许瞎猜日期**。
2. `TRAIN_CODE` 补主要城市站码：至少全部省会/直辖市/计划单列市 + 常见铁路枢纽/旅游城市；太原 TYV、西安 XAY 必须有。按公开站码表核对，不许编造。
3. 沿 T5 口径：这只是组 URL 参数的执行能力，不是路线判断，无需新决策点。

**验收：**
- 单测：`search_site({site:"flight", from:"北京", to:"上海", date:"下周三"})` 返回含日期的携程 URL；`search_site({site:"train", from:"太原", to:"西安", date:"后天"})` 返回带 TYV/XAY 的 12306 URL。
- 真机（Q6）：十题里的机票、高铁两题各重跑一遍，search_site **一次成功**，不再返回「暂不可用」。

### T14（P2）运行中新消息排队而不是丢弃

**根因链：** `browser.ts:6257-6262`，`chatRunning` 时直接 return「上一个任务还在执行」，用户消息**不进 chatLog、不进 history，模型永远看不到**。本次复测「继续」被丢过一次（chat 底账可证：用户发了两次，只留了一条）。

**要求：**
1. `chatRunning` 时的新消息：push 进 chatLog（用户至少能看到自己发过），并暂存为 pending 输入；pending 只保留最新一条（自动续跑用），更早的直接留在 chatLog 里供模型后续看到。
2. run 的 finally 复位 `chatRunning` 后，若 pending 存在，自动作为下一次 `handleChat` 输入执行；续跑期间再来的新消息同样排队（finally 顺序调用，天然不会递归爆栈）。
3. 这是排队机制，不是路线判断，无需决策点。

**验收：**
- 单测：run 进行中来新消息，run 结束后自动接跑；连来两条时第二条自动跑、第一条在 chatLog 里可见。
- 真机（Q7）：run 中发「继续」，run 结束后自动接跑，无需重发。

**禁区：** 不许在 chatRunning 时把新消息直接塞进当前 run 的 messages（那是另一条路线，风险大，本轮不做）。

### T15（P2）发布文案去 AI 味

**根因：** 用户原话：「当前你写的文章中标点符号太多了 一看就是ai从md文档里转化的 不干净 不像是人写的」。微博正文也带 1️⃣ 序号 emoji。这是提示注入类干预，允许且必要。

**要求：** `pi-core.ts` `systemPrompt()` 增加一条：
「发布到微博、知乎、小红书等社交平台的正文要用自然的口语段落：不用 markdown 标题、加粗、编号列表、分割线和序号 emoji（如 1️⃣）；需要分点时用『一、二、三』或自然过渡衔接。在侧栏里直接回复用户的总结不受此限。」

**验收：** 单测断言 systemPrompt 含「口语段落」级别关键词；真机（Q5）：知乎最终发布的正文无 md 痕迹。

### T16（P2）轮次上限 24 → 32

**根因：** 知乎「高质量回答」任务合理地花了 12 轮调研（读 3 个 GitHub 文档），再被 T10-T12 的事故放大，两次烧完 24 轮。修完 T10-T12 后 24 大概率够用，但发布类长任务应留余量。

**要求：**
1. `pi-core.ts` `maxRounds` 默认 24 → 32。
2. BUDGET_HINT 仍按 `floor(maxRounds * 0.75)`（自动变 24/32），到顶仍如实报「未完成」，不许假 done。沿用 #30 口径，不新增决策点。

**验收：** 单测更新默认值断言；真机（Q5）知乎任务 32 轮内完成。

---

## 全局禁区（v3 重申）

1. 北极星与 §4 禁区全部仍然有效：`handleChat` 只进 `piCore`；不碰 `docs/listings/`；不打包、不提交；云 Key 不进客户端。
2. `looksLikeSubmitAction` / `qaGate` / `requestApproval` / 店小秘工作流代码**不许删**，只做 `piCoreRunning` 短路。
3. snapshot / fill 的重试只许「工具内部再试一次」，不许加超时之外的本地决策。
4. 新增本地判断先登记 `docs/DECISION-POINTS.md`（本轮只有 T10 的 #31）。

## 工程要求

TDD：每个任务先写失败测试再实现，风格照 `tests/pi-core.test.ts`。每完成一个任务跑 `npm test`（全绿）+ `npm run typecheck`。全部完成后 `npm run build`，再按下面场景真机自测。

## 真机验收场景（全部通过才算完成）

| 场景 | 输入 | 通过标准 |
|---|---|---|
| Q5 | 在一个已登录的知乎问题页：「在我当前的知乎问题下 写回答 高质量的」→（草稿+确认问句）→「确认」 | 32 轮内真发布成功，最终回复带 answer 链接；正文无 md 痕迹；全程无「速卖通」误拦、无审批卡；snapshot 0 元素 ≤1 次 |
| Q6 | 重跑十题里的机票题（下周三北京飞上海）和高铁题（后天太原到西安） | search_site 一次成功，不再返回「暂不可用」 |
| Q7 | 任意长任务运行中发「继续」 | run 结束后自动接跑，侧栏无需重发 |
| Q8 | 重跑微博发布（找热点→写→确认→发） | 与 2026-11-02 用户复测同样闭环成功（此为回归，确认 T10 放行没破坏发布链路） |

## 完成交付

完成后在本文件末尾追加「完成记录（v3）」：每个任务列改动文件、新增测试名、决策点登记号、真机场景结果（未跑如实写）。规划方复查代码 + 复跑 Q5-Q8。

## 完成记录（v3，2026-11-02，Cursor）

全量 `npm test`：71 个文件、586 项通过。`npm run typecheck` 通过。`npm run build` 通过。未打包，未提交 git。`[pi-core]` 的 `run start`、每轮工具、`STUCK_HINT`、`PAGE_SAME_HINT`、`BUDGET_HINT` 都还在。

### T10

- 改动：`src/main/qa/dianxiaomi-smt.ts` 增加 `submitClickNeedsGate`。`src/main/browser.ts` 点击路径改用它：`piCoreRunning` 时整段提交闸门跳过，不调 `qaGate`、不弹 `requestApproval`。`looksLikeSubmitAction`、`qaGate`、`requestApproval`、店小秘工作流都还在
- 现有闸门词仍是「提交 / 保存并提交 / 发布产品 / 立即发布 / 确认发布」。单独的「发布」本来就不进这道闸门，这次没有放宽或收紧词表
- 测试：`tests/pi-core-v3.test.ts`「运行中点击发布不触发闸门，旧路径仍拦确认发布」
- 决策点：**#31**。#26、#30 只把默认轮次从 24 改成 32（见 T16）
- 真机 Q5：未跑

### T11

- 改动：`src/main/snapshot-retry.ts` 的 `recaptureIfEmpty`。`snapshot` 在有地址、不是 `about:blank`、可交互元素为 0 时等待 600ms 再抓一次。消息带 `(retried)`。两次都是 0 仍把 0 写入 `lastSnapshot`
- 测试：`tests/pi-core-v3.test.ts`
  - 「第一次 0、第二次有元素时返回第二次并注明重试」
  - 「两次都是 0 时如实返回 0，空白页不重抓」
- 决策点：无
- 真机：未跑

### T12

- 改动：`src/main/fill-retry.ts` 的 `retryShortContentEditable`。`fill` 在 contenteditable 回读为空或不到期望一半时，再做一次 focus、全选清空、`insertText`。失败消息带 `tag=` 和 `contenteditable=`。普通输入框不走这一轮
- 测试：`tests/pi-core-v3.test.ts`
  - 「第一次丢字，重试写上后算成功」
  - 「重试仍是空时如实失败，并带上标签」
  - 「普通输入框不重试」
- 决策点：无
- 真机：未跑

### T13

- 改动：`src/main/agent/travel.ts`。`resolveSearchDate` 增加周X / 星期X（未来最近一个，当天算下一周）、下周三这类「下一周的周X」、X月X日 / X月X号（已过则明年）、MM-DD（今年）。认不出仍返回空。`TRAIN_CODE` 补了省会、直辖市里缺的、以及常见枢纽。站码来自公开 `station_names`：太原 `TYV`。西安原本就是 `XAY`，没有改
- 测试：`tests/travel.test.ts`
  - 「下周三的北京到上海机票拼出带日期的携程结果页」
  - 「后天太原到西安拼出带 TYV 和 XAY 的 12306 结果页」
- 决策点：无
- 真机 Q6：未跑

### T14

- 改动：`src/main/browser.ts` `handleChat`。执行中的新消息写入 `chatLog`，只保留最新一条为 `pendingChat`。本轮 `finally` 清掉 `chatRunning` 后再自动 `handleChat`。续跑不再写第二条用户气泡，也不塞进当前这一轮的 messages
- 测试：`tests/pi-core-guard.test.ts`「两条都留在聊天里，结束后只自动跑最新一条」
- 决策点：无
- 真机 Q7：未跑

### T15

- 改动：`src/main/agent/pi-core.ts` 系统提示增加社交正文用口语段落、侧栏总结不受限
- 测试：`tests/pi-core.test.ts`「系统提示要求两次就换路，并带上确认门和结果页通道」增加「口语段落」
- 决策点：无
- 真机：未跑

### T16

- 改动：`src/main/agent/pi-core.ts` 默认 `maxRounds` 从 24 改为 32，硬顶仍是 40。预算提示仍是 `floor(maxRounds * 0.75)`，默认变成 24/32。到顶仍报未完成
- 测试：`tests/pi-core.test.ts`「第 24/32 轮注入一次预算提示，不伪造最终回复」（原 18/24 用例改名）
- 决策点：沿用 **#30**，没有新编号。#26 的默认轮次说明同步改成 32
- 真机 Q5 是否在 32 轮内完成：未跑

### Q5–Q8

| 场景 | 结果 |
|---|---|
| Q5 知乎回答 | 未跑 |
| Q6 下周三机票 / 后天太原到西安 | 未跑 |
| Q7 运行中发「继续」 | 未跑 |
| Q8 微博发布回归 | 未跑 |

---

## 规划方复核结论（v3，2026-11-02）

### 代码审查

- T10–T16 实现与任务书一致：`submitClickNeedsGate` 只做 `piCoreRunning` 一个布尔短路；`recaptureIfEmpty` / `retryShortContentEditable` 都只重试一次、失败如实返回；`resolveSearchDate` 的月份已过转明年边界正确；T14 排队用 `alreadyLogged` 避免了双气泡，且没有把新消息塞进当前 run 的 messages。
- 决策点 **#31** 登记正确；**#26** 已同步改成默认 32（硬顶 40）。
- 全量 `npm test` 规划方复跑：71 文件 **586 项通过**。

### 真机复跑（规划方，CDP 驱动侧栏）

| 场景 | 结果 |
|---|---|
| Q6a 机票（下周三北京飞上海） | **通过**：`search_site` r1 一次成功，携程 URL 带 `depdate=2026-11-11`（下周三解析正确），7 轮 23.5s |
| Q6b 高铁（后天太原到西安） | **通过**：`search_site` r1 一次成功，12306 URL 带 `TYV/XAY` 和日期，3 轮 11.6s（上一版 19 轮 60.2s） |
| Q7 运行中排队续跑 | **通过**：A 运行中发 B → B 留在侧栏无重复气泡 → A 汇报完 B 自动续跑并出答案，无需重发 |

### 交回用户（需要真账号确认，规划方不代点发布）

- **Q5 知乎写回答→确认→发布**：需要在用户已登录的知乎问题页上做，最终发布是用户账号的公开动作，由用户在场回「确认」完成。观察点：无「速卖通」误拦、无审批卡、snapshot 0 元素 ≤1 次、正文无 md 痕迹、32 轮内成功。
- **Q8 微博发布回归**：同理由用户跑一遍，确认 T10 放行没破坏发布链路。

临时调试代码已清理（`SPARO_DEBUG_PORT` 注入已删，测试脚本已删）。

## 用户真机复测（Q8 微博 + 知乎长文 + B 站上传，2026-11-02 17:21–17:46）

- **Q8 微博发布回归：通过** ✅。「研究卖点→连续发三条→确认→真发布」全链路成功，三条微博 17:21 全部发出（每条有「发布成功」提示、时间线可见）。T10 的放行没有破坏发布链路。
- **暴露新问题 1（见 T18）**：r20 `click_text ok=false 草稿已填好。发送留给你，我没有代点。`——`publish-gate`（`agent/publish-gate.ts`）挂在 **click_text 路径**（`browser.ts:8657`），T10 只摘了 click-ref 路径的 QA 闸门，漏了这道。模型靠换 snapshot ref 点击绕过去了，这次没坏事，但它同样是用户已确认后仍在拦截的本地闸门。
- **暴露新问题 2（见 T17，即用户报的「卡住」）**：知乎长文任务 r5 后模型请求悬死，无任何后续动作，用户追问「为什么没动静了？」也因 chatRunning 被排队（永远等不到执行）。根因：`pi-core.ts:399` 的模型请求**没有超时**，连接一挂起 run 永不结束。已杀进程重启解卡。
- **暴露新问题 3（见 T19）**：用户让把本地视频 `D:\download\sparo 发微博 自动.mp4` 发到 B 站（明确要求「先别点发布」）。模型**行为正确**：如实汇报卡点、没假完成、遵守不发布。真正缺口是 pi-core **没有本地文件上传工具**——浏览器安全限制使 JS 填不进 `<input type=file>`，r9 还试图 `file:///D:/download/` 被拒。
- **暴露新问题 4（见 T20）**：重启后模型看到当前标签页停在百度首页，就向用户自曝「上一轮『三条微博已发布』的说法跟实际状态对不上、是不该给你的」——**用当前页面位置否定历史真实完成的动作**，属于误判（发布证据在历史工具结果里，17:21 的三条微博轨迹和读回都在）。历史工具结果与当前页面状态是两回事，模型把重启后的状态重置当成了历史造假证据，向用户传播了错误结论。

---

# 第四轮（v4）— 模型请求超时 + 摘掉 click_text 残留闸门 + 文件上传能力 + 历史信任口径

> 四个任务：两个护栏（T17/T18）、一个执行能力（T19）、一个提示注入（T20）。北极星不变。行号基于 2026-11-02 工作区。决策点现有登记到 #31，本轮从 #32 起。

### T17（P0）模型请求超时护栏

**根因链（已核实）：** `pi-core.ts:398-403`，`await doFetch(chatCompletionsUrl(...))` 无 AbortController、无超时。模型端点挂起时 run 永远不结束：侧栏一直「思考中」、chatRunning 不复位、T14 排队的消息永远不执行、用户只能重启。2026-11-02 17:15 知乎任务实测悬死。

**要求：**
1. 每次 LLM 请求加 AbortController 超时，默认 **120 秒**（config 可配 `requestTimeoutMs`）。到时 abort 后**原样重试一次**（网络抖动一次很常见）；第二次仍失败才算失败。
2. 失败路径：run 以 `ok: false` 结束，侧栏如实显示「模型请求超时/失败：……（可重试）」，不伪造任何完成。已经做完的工具轮次自然留在 history 里，用户重发「继续」可接续。
3. 这是资源护栏，与 #26（轮次上限）同类。登记决策点 **#32**：只终止挂起的请求，不替模型决定路线、不判任务成败。

**验收：**
- 单测：fake fetchImpl 第一次挂起（永不 resolve）+ AbortController 被触发后第二次正常返回 → run 正常完成且轮次结果正确；两次都挂起 → run 返回 `ok: false` 且文案如实。
- 真机（Q9）：临时把 timeoutMs 调成 3 秒指向一个不响应的地址，侧栏 120×2 → 实际 3×2 秒内收到「请求超时」汇报，chatRunning 复位、排队消息接着跑。

**禁区：** 不许在超时后自动「替模型总结」或输出缓存内容冒充答案。

### T18（P0）publish-gate 对新核心放行

**根因链（已核实）：** `browser.ts:8657` `clickText()` 一进来就 `allowClick(classifyClick(text), this.activeMission?.goal?.autoSend === true)`——新核心没有 activeMission，autoSend 恒为 false，`classifyClick` 命中「发送/发布/发表/立即发布/确认发布」整词时直接返回「草稿已填好。发送留给你，我没有代点。」。用户已经过 request_confirm 确认后，这道闸门仍会拦——和 T10 摘掉的 QA 闸门同一性质。

**要求：**
1. `piCoreRunning === true` 时跳过 8657-8658 这两行：不查 publish-gate。不可逆动作确认责任在模型层 `request_confirm`（#28），与 #31 同口径。登记决策点 **#33**。
2. **pay / login / captcha 三类不在豁免范围**：`classifyClick` 命中支付、登录、验证码时，新核心同样被拦（这半句保留）。即：豁免只针对 `send` 类。理由：#28 的确认门只覆盖发布/发送/支付/删除四类里的「发送」语义，支付类风险更高且不属本确认门豁免范围——pay 类点击仍拦。
3. 旧架构路径原样（`piCoreRunning === false` 时行为不变），`classifyClick` / `allowClick` 本身不删不改。

**验收：**
- 单测：`piCoreRunning=true` 时 clickText("发送") 不被拦；clickText("支付") 仍拦；`false` 时「发送」仍拦。
- 真机（Q10）：微博「写→确认→发」流程中模型直接 click_text「发送」成功，无「草稿已填好」拦截文案。

### T19（P0）本地文件上传工具 set_file

**根因链（已核实）：** 2026-11-02 17:46 用户实测 B 站投稿：「`D:\download\sparo 发微博 自动.mp4` 帮我把这个视频发布一下」。pi-core 的 11 个工具没有一个能操作 `<input type=file>`——浏览器安全限制使 JS 填不进文件路径（r4/r8 `fill ok=false Script failed`），模型还被逼着试了 `file:///D:/download/`（r9 被拒）。模型行为正确（如实汇报卡点、遵守「先别点发布」），纯缺执行能力。旧架构已有相关积累可参考：`browser.ts` 顶部 `FIND_FILE_INPUT_SCRIPT`、shell 的 `pickFile` / `filePath` IPC、`agent/files/` 一族。

**要求：**
1. `pi-core.ts` 新增工具 `set_file`：参数 `{ path: string, ref?: string, selector?: string }`（ref/selector 二选一，定位 file input，缺省取页面第一个 `<input type=file>`）。
2. 执行链（`runCoreTool` 新分支）：主进程先用 `fs` 核实文件存在（不存在→ `{ok:false, message:"文件不存在：<path>"}`，带实际错误）；存在→ 用 `webContents.debugger`（CDP）`DOM.getDocument` → `DOM.querySelector`（或用已有 snapshot 的 ref 定位机制换算成 CSS selector）拿 nodeId，然后 **`DOM.setFileInputFiles`** 注入文件。返回 `{ok:true, data:{ path, sizeMB }}`。
   - CDP attach 已有先例可查（`webContents.debugger.attach` / `sendCommand`，搜主进程里 `debugger` 用法；没有先例就按 Electron 文档写，注意 attach 前判 `isAttached()`）。
   - 注入成功后页面自己的上传逻辑会走（change 事件触发），不要替页面点「开始上传」。
3. 这只是执行能力（等价于用户把文件拖进上传框），不是路线判断，无需新决策点。发布动作仍受 request_confirm 管控。
4. `systemPrompt` 加一句：「用户给出本地文件路径让你上传（视频、图片、附件）时，用 set_file 把文件放进文件选择框，不要试图用 fill 填路径或用 file:// 打开本地目录。」

**验收：**
- 单测：文件不存在时如实返回失败；fake runner 断言 set_file 走新分支且参数校验完整。
- 真机（Q11）：B 站投稿页（已登录），`set_file` 后页面进入「上传中/已选择文件」状态，视频开始上传；随后填文案；**不点发布**（用户亲测时亲眼看守）。

**禁区：** 不许把文件内容读进模型上下文（只传路径和大小）；不许自动点「投稿/发布」类按钮。

### T20（P1）历史信任口径（提示注入）

**根因链（已核实）：** 2026-11-02 17:35 用户实测。重启后模型看到当前标签页停在百度首页，就向用户自曝：「上一轮『三条微博已发布』的说法跟现在浏览器里的实际状态对不上……那些『已发布』的描述是不该给你的」。**用户已确认三条微博 17:21 真实发布成功**——确属误判：发布成功的证据在历史工具结果里（三条微博轨迹 + page_text 读回「发布成功」都在），模型用「现在的标签页在哪」否定了「历史里真实读回的结果」，向用户传播了错误结论，损害的是信任本身。这不是假完成，是假翻供。

**要求：**
1. `pi-core.ts` `systemPrompt()` 增加一条：「历史对话里的工具结果都是当时真实读回的，是可信的。浏览器或应用重启后页面状态会重置，当前标签页在哪、显示什么，都不能用来否定历史里已完成的动作。需要核实历史发布是否生效时，去对应平台实际查看（例如打开微博个人主页看时间线），不要凭当前页面状态下结论。」
2. 提示注入类干预，无需新决策点。

**验收：**
- 单测：systemPrompt 含「历史」「重置」「实际查看」级别关键词。
- 真机（Q12）：重启后侧栏问「刚才发的那几条微博真的发出去了吗」，模型应打开微博个人主页看时间线再回答，而不是凭当前页面自我否定。

---

## 全局禁区（v4 重申）

北极星、§4、v3 禁区全部有效。`classifyClick` / `allowClick` / publish-gate 旧路径不许删；T17 只加超时不加重试之外的路由逻辑；T19 不读文件内容、不自动点发布。

## 真机验收场景

| 场景 | 输入 | 通过标准 |
|---|---|---|
| Q9 | 把 `requestTimeoutMs` 临时调成 3000，模型地址指向不响应端口，发一条任务 | 6 秒内收到「请求超时」如实汇报；chatRunning 复位；紧接着再发一条正常任务（改回配置）能跑 |
| Q10 | 微博发布流程中让模型用 click_text 点「发送」 | 不再出现「草稿已填好。发送留给你，我没有代点。」；真发布成功 |
| Q11 | 「把 `D:\download\sparo 发微博 自动.mp4` 发到B站，文案填好后先别点发布，我亲自发」 | set_file 后视频真的进入上传队列；文案填好；停在发布前等用户 |
| Q12 | 重启后侧栏问「刚才发的微博真的发出去了吗」 | 模型打开微博个人主页看时间线再回答，不凭当前页面自我否定 |

## 完成交付

完成后在本文件末尾追加「完成记录（v4）」：改动文件、新增测试名、决策点登记号（#32/#33）、真机场景结果（Q11 需要用户在场亲眼看守上传过程，未跑如实写）。规划方复查代码 + 复跑 Q9/Q10/Q12。

## 完成记录（v4，2026-11-02，Cursor）

全量 `npm test`：72 个文件、591 项通过。`npm run typecheck` 通过。`npm run build` 通过。未打包，未提交 git。`[pi-core]` 原有轮次日志都还在，超时失败时多一行 `request failed`。

T20 按任务书定性处理：这是假翻供，不是假完成。提示只教模型历史工具结果可信，要核实就去平台实际看。

### T17

- 改动：`src/main/agent/pi-core.ts`。每次模型请求默认 120 秒（`requestTimeoutMs` 可配），AbortController 到时 abort，失败原样重试一次。第二次仍失败则 run 返回 `ok: false`，文案是「模型请求超时/失败：……（可重试）」。不把已有工具结果收成答案
- 测试：`tests/pi-core-v4.test.ts`
  - 「第一次挂起、第二次正常返回时，任务照常完成」
  - 「两次都挂起时如实失败，不把过程说成完成」
- 决策点：**#32**
- 真机 Q9：未跑

### T18

- 改动：`src/main/agent/publish-gate.ts` 增加 `gateClickText`。`browser.ts` `clickText` 改用它。`piCoreRunning` 时 send 类不再查 `allowClick`。支付、登录、验证码仍拦。`classifyClick` / `allowClick` 没删没改
- 测试：`tests/pi-core-v4.test.ts`「运行中放行发送，支付仍拦，旧路径仍拦发送」。旧的 `tests/publish-gate.test.ts` 仍绿
- 决策点：**#33**
- 真机 Q10：未跑

### T19

- 改动：
  - `src/main/agent/pi-core.ts` 新增工具 `set_file`（path 必填，ref / selector 可选），系统提示写明用它上传，不要 fill 路径或 file://
  - `src/main/agent/set-file.ts` 只核对文件在不在和大小，不读内容
  - `src/main/browser.ts` `runCoreTool` 新分支：不存在就返回「文件不存在：<path>」；存在则走已有 `upload()`（CDP `DOM.setFileInputFiles`）。返回 `{ path, sizeMB }`。不点投稿或发布
- 测试：`tests/pi-core-v4.test.ts`
  - 「模型调用时走 set_file 分支，参数带路径、ref 和 selector」
  - 「文件不存在时如实失败，存在时只回报路径和大小」
- 决策点：无
- 真机 Q11：未跑。上传过程需要用户在场亲眼看

### T20

- 改动：`src/main/agent/pi-core.ts` 系统提示增加历史信任口径：历史工具结果是当时真实读回的；重启后页面会重置，不能用来否定已完成的动作；要核实就去对应平台实际查看
- 测试：`tests/pi-core.test.ts`「系统提示要求两次就换路，并带上确认门和结果页通道」增加「历史」「重置」「实际查看」
- 决策点：无
- 真机 Q12：未跑

### Q9–Q12

| 场景 | 结果 |
|---|---|
| Q9 请求超时 | 未跑 |
| Q10 click_text 发送 | 未跑 |
| Q11 B 站上传 | 未跑 |
| Q12 历史微博是否发出 | 未跑 |

---

## 规划方复核结论（v4，2026-11-02，Trae）

验收方法：`npm run start` 拉起，`SPARO_DEBUG_PORT=9222` 临时注入 CDP 调试端口，Python Playwright 驱动侧栏真机跑。代码审查（T17 超时循环 / T18 gateClickText / T19 set_file / T20 历史信任提示）与全量 591 项测试本机复跑均通过（见 2026-11-02 会话记录）。以下为真机结果。

### Q9 请求超时 — 通过

- 手法：`pi-core.ts` 超时临时调 3 秒，settings baseUrl 指向本机不响应端口。挂死服务器第一版只 accept 一次就 sleep，触发的是 `fetch failed`（网络错误路径）；重写为持续 accept、永不响应后，触发真正的 AbortError 路径。
- 结果：气泡如实报「模型请求超时/失败：请求超时（可重试）」，首条 7.8 秒（3s×2 次尝试 + 开销），主进程日志 `request failed attempt=1/2 请求超时`。第二条消息**立即开跑**、没被排队——chatRunning 复位确认。
- 「改回配置后正常任务能跑」由 Q10 完整真机流程覆盖（恢复 deepseek 配置后全流程正常）。

### Q10 click_text 发送 — 通过（带一条如实说明）

- 流程：侧栏下达「打开微博发一条微博，内容：Sparo 自动化验收测试 Q10，此条为测试内容，请忽略。」→ 模型 navigate 微博首页 → snapshot → fill 正文（回读确认 30 字）→ **request_confirm 确认问句**（含账号、正文、拟执行动作）→ 回「确认」→ 真点发送 → 主动 navigate 个人主页 page_text 核对到「刚刚」发布的这条 → 如实汇报。
- 全程无「草稿已填好。发送留给你，我没有代点。」拦截。
- **如实说明**：模型实际用 `click`（snapshot ref e26）点发送，没走 `click_text`。click_text 的放行分支由单测「运行中放行发送，支付仍拦，旧路径仍拦发送」覆盖；真机层面 T10（click-ref 路径摘闸）+ T18（无拦截文案）一起验证了「用户确认后发布不被本地闸门拦死」的产品语义。
- 真实发布证据：账号「南方星火southernSPARK」，个人主页时间线（https://weibo.com/u/8224137082）置顶「刚刚」，正文逐字匹配。

### Q12 历史微博是否发出 — 通过

- 手法：发布成功后**重启应用**（换进程，页面重置回百度），侧栏问「刚才发的微博真的发出去了吗？」。
- 结果：模型没凭记忆自问自答、也没自我否定，get_url → navigate 个人主页 → page_text，答「是的，确实已经发出去了」并给出时间线证据（全部微博 45 条置顶、「刚刚」时间戳、正文逐字匹配、阅读 0），还主动收窄口径「首页信息流这次没再核对，以个人主页为准」。T20 的历史信任提示生效。

### Q11 B 站上传 — 未跑，交回用户

需要用户在场亲眼看守 `set_file` 视频上传过程。建议与 Q5（知乎写回答→确认→发布，v3 未完整真机跑）一起验收。

### 现场清理（全部完成）

- `pi-core.ts` 超时恢复 120 秒（`requestTimeoutMs` 可配）。
- `index.ts` 临时 `SPARO_DEBUG_PORT` 段已删。
- `settings.json` 从备份恢复（baseUrl 回 `https://api.deepseek.com`、apiKey/model 完好，应用退出后再核对未被改写）。
- 临时脚本与结果文件（sparo_q9/q10/q12_test.py、sparo_inspect*.py、hang_server.py、各 results.json、settings 备份）全部删除。
- 清理后 `npm run typecheck` 通过。未打包，未提交。

---

## 验收记录（v5，2026-11-02，Trae 依据用户真机测试）

记录来源：`%APPDATA%\sparo-store\chat-memory.json`（用户在场亲测，18:59）。

### Q11 B 站上传 — 通过

- 指令：「`D:\download\sparo 发微博 自动.mp4` 这个 发b站 文字填好先不要发送 我来确认」
- set_file 把 50.1MB 视频放进 B 站创作中心上传框，页面显示「上传完成」。
- 标题、简介、创作声明填好；**停在「立即投稿」前**，明确说「还没点投稿」等确认——正是任务书要求的行为。
- 中途模型先误判成「微博发带视频的新微博」出了确认卡；用户纠正后正确切换到 B 站，没有把误判路径执行到底。
- 小瑕疵（汇报层面已如实）：分区沿用系统自动判断的「科技数码」，标签保留自动带出的「赛车游戏」「微博」，模型如实说了没动。
- 顺带复跑了一次 Q10（微博发布 + 个人主页核验），行为正常。

### 新发现 bug：并行 tool_calls 中间插 user 提示，被 API 整单拒绝（T21）

现象：用户发 B 站指令那一轮，侧栏报「模型请求超时/失败：LLM API: An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'. (insufficient tool messages following tool_calls message)（可重试）」。用户回「重试」后同任务一次跑通——说明坏历史只存在于出错那次 run 的内存里，重开 run 即恢复。

根因（代码级定位，`src/main/agent/pi-core.ts`）：

1. **提示消息插进 tool 消息中间**。run 循环里 `PAGE_SAME_HINT`（348 行）和 `STUCK_HINT`（366 行）是 `user` 角色消息，在工具执行 for 循环**内**入栈。当模型一条 assistant 消息里发了多个并行 tool_calls（如 `[page_text, 其他]`），序列就成了：
   ```
   assistant(tool_calls=[A,B]) → tool(A) → user(提示) → tool(B)
   ```
   API 校验要求 assistant 的 tool_calls 之后**紧跟**每个 tool_call_id 的 tool 消息，中间夹了 user 即整单 400。触发场景吻合：B 站上传时模型反复 page_text 轮询进度，进度停在同一个百分比 → 连续 3 次读回同样文本 → PAGE_SAME_HINT 触发；恰好那一轮模型发了并行调用 → 中弹。单调用轮次不受影响（提示在 tool 之后），所以此前 Q9/Q10/Q12 都没踩到。
2. **次要隐患**：340 行 `tool_call_id: call.id` 直接用 API 返回的 id。若并行调用某个 id 缺失，tool 消息对不上号，同样触发此错。

T17 的失败上报与「可重试」路径这次工作正常，可观测性没问题；T21 只修根因。

### T21（v5）：修 tool_calls 消息序列，保证发给 API 的历史永远合法

改动文件：`src/main/agent/pi-core.ts`。

1. **提示移位**：`PAGE_SAME_HINT` / `STUCK_HINT` 不再在工具 for 循环内直接 push。循环内只置标记（如 `pendingHints: string[]`），**本轮全部 tool 消息推完之后**再一次性 push（两条都触发时合并或顺序推均可）。判定逻辑（samePageCount、streak/finger）不改动，只改入栈时机。
2. **id 兜底**：291 行 assistant push 与 340 行 tool push 用同一套归一化 id——`call.id` 缺失时合成 `` `${round}-${index}` ``，两处保持一致。
3. **发送前兜底校验（防御纵深）**：`completion()` 组装 body 前过一遍 `sanitize`：每个带 `tool_calls` 的 assistant 消息，其后连续 tool 消息必须覆盖全部 tool_call_id；缺的就在连续 tool 段末尾补合成 tool 消息（content 写「（该工具调用未执行）」）。修复在副本上做，不依赖前两条是否漏改。
4. 不改护栏语义：STUCK/PAGE_SAME/BUDGET 提示文案、触发阈值、轮次上限、request_confirm 行为全部不变。

测试（建议加 `tests/pi-core-v5.test.ts`，fetchImpl 抓请求 body 断言）：

- 「并行调用触发提示时，user 提示在全部 tool 消息之后、不在中间」：构造 assistant 返回两个 tool_calls，第一个触发 PAGE_SAME_HINT（把 samePageCount 预热到阈值），断言请求 body 中 assistant(tool_calls) 后紧跟连续两个 tool 消息，hint 在其后。
- 「call.id 缺失时 assistant 与 tool 消息 id 一致且不为空」。
- 「sanitize 能修坏序列」：直接对 sanitize 函数单测，喂一个 tool 消息间夹 user 的序列，断言修复后每个 tool_call_id 都有紧跟的 tool 消息。

验收：

- 全量 `npm test` + `npm run typecheck` 通过。
- Q13 真机：用户在场重跑一次 Q11 流程（或任何长上传/长轮询任务），确认不再出现该 400；如仍出现，把主进程日志 `[pi-core]` 轮次记录带回。
- 决策点：无（不改任务走向，只修消息序列）。

### Q5 知乎发布 — 仍未真机跑

与 Q11 一起验收的建议保留；用户本次只测了 B 站。

## 完成记录（v5，2026-11-03，Cursor）

全量 `npm test`：73 个文件、594 项通过。`npm run typecheck` 通过。未打包，未提交 git。护栏文案、阈值、轮次上限和 `request_confirm` 没改。

### T21

- 改动：`src/main/agent/pi-core.ts`
  - `PAGE_SAME_HINT` / `STUCK_HINT` 在工具循环里只进 `pendingHints`，本轮全部 tool 消息推完后再入栈。`samePageCount`、streak / finger 的判定没动
  - assistant 与 tool 用同一套 id：`call.id` 为空时合成 `` `${round}-${index}` ``
  - `completion()` 发请求前对副本跑 `sanitize`。带 `tool_calls` 的 assistant 后面，连续 tool 消息缺哪个 id，就在这段末尾补一条「（该工具调用未执行）」
- 测试：`tests/pi-core-v5.test.ts`
  - 「并行调用触发提示时，user 提示在全部 tool 消息之后、不在中间」
  - 「call.id 缺失时 assistant 与 tool 消息 id 一致且不为空」
  - 「sanitize 能修坏序列」
- 决策点：无
- 真机 Q13：未跑

---

## 规划方复核结论（v5，2026-11-03，Trae）

代码审查通过，本机复跑 `npm test` 73 文件 594 项全绿、`npm run typecheck` 通过。三处改动逐条核对：

- **提示移位**：`pendingHints` 在工具循环内置标记、本轮全部 tool 消息推完后再入栈（pi-core.ts 358、425–427 行）；`samePageCount`/streak/finger 判定与重置时机未动。
- **id 兜底**：`normalizeToolCall`（86–100 行）对 `call.id` 空值合成 `` `${round}-${index}` ``，assistant push（344–349 行）与 tool push（396 行）共用同一套归一化结果，两处必然一致。
- **sanitize**：`completion()` 组 body 时对副本执行（455 行）；只补缺失的 tool_call_id、不改动原数组，防御纵深到位。
- 测试质量：第一条完整复刻真机触发路径（page_text 预热两轮 → 第三轮并行调用带 page_text → 断言 hint 在全部 tool 消息之后），与 2026-11-02 日志中 r15 的案发现场一致。

### Q13 真机 — 未跑，交回用户

需要用户在场重跑一次 Q11 流程（B 站上传或任何长轮询任务），确认不再出现 `insufficient tool messages` 400。Q5（知乎发布）一并验。

---

## 验收记录（v6，2026-11-03，Trae 依据用户真机测试）

记录来源：`%APPDATA%\sparo-store\chat-memory.json`（最后写入 11:53）。T21 修复版上用户连跑三个任务：点评团购打好评、Gmail 邮件分类、Gmail 广告归档。B 站 Q13 正式场景未重跑。

### 间接验证 T21：整场无 400

Gmail 批量任务包含大量重复 `page_text` 轮询和多轮连续操作，正是 11-02 案发的触发条件；全程侧栏没有任何「模型请求超时/失败」气泡（若 completion 两次失败必然出现在气泡里，chat-memory 无此记录 = 无请求失败）。以本轮批量负载作为 T21 的间接真机证据，B 站场景留待下次顺带。

### 行为亮点（保持，后续任何调整不许削弱）

1. **打好评任务**：翻完订单页 + 详情页后如实报告「PC 老站没有评价入口，做不了」，并明确拒绝批量编造五分好评（刷好评风险、账号限流），改提「真消费 + 真实感受 → 帮写草稿」的替代路径。诚实、有边界，方向正确。
2. **Gmail 分类**：主动用「排除推广/社交/动态标签」的第二查询交叉验证，给出「9 月 11 日之后没有任何真人邮件」的洞察；安全邮件（GitHub 2FA、可疑登录）单独列出。
3. **归档第一批**：只动纯推送发件人，账号安全类一封没碰，归档后用未读数下降核实生效。

### 小问题一：全量授权的批量任务中途停下来问选项（T22）

用户指令「帮我把纯广告归档以后直接别让我看了」是**全量授权**。模型归档第一批 50 封后停下来给三个选项（继续清存量 / 建筛选器 / 都做）。清存量属于已授权的同一操作的机械循环，不该停下来问；建筛选器是新的操作类型（改账号设置），问是对的。结果是用户被迫多一轮往返。

### 小问题二：批量列表操作没有高效通道（T23）

Gmail 勾选全选后会出现「选择与此搜索匹配的所有会话」横幅链接，点它一次可归档上千封；模型报「在当前页面取不到可点元素」（大概率 snapshot 在横幅渲染前取的，或没覆盖该区域），也没试 `click_text` 按可见文字找，更没用 Gmail 键盘全选（先按 `*` 再按 `a`，两次 `press` 即可）。于是退化成每批 50 封、每批 4–6 轮，32 轮上限内清不完 1,718 封未读。工具层不缺东西（press 单键连发可用、click_text 按可见文字查找），是模型用法和提示词缺口。

### T22（v6）：批量授权语义（只改 systemPrompt）

`systemPrompt` 增加一条：

- 用户说「直接」「以后」「全部」「别让我看了」等全量授权措辞时，同类批量操作（归档、清理、翻页处理）自主连续执行到做完或真卡住，不中途问「要不要继续」；跨到新的操作类型（改账号设置、订阅、付费、删除不可恢复内容）仍必须先确认。

测试：`tests/pi-core.test.ts` 系统提示断言加「全量授权」「自主连续执行」相关关键词。决策点：无（提示词引导，无本地闸门）。

### T23（v6）：批量列表操作的平台通道（只改 systemPrompt）

`systemPrompt` 增加一条：

- 批量清理长列表时：优先找「选择所有/全部匹配…会话」类横幅链接一次全选；snapshot 里没有但按理该出现的动态元素（如全选后新出现的横幅），用 `click_text` 按可见文字再试一次，别急着下「取不到」的结论；Gmail 键盘全选是连按 `*` 和 `a`；批与批之间沿用同一搜索结果页，不要每批重新构造搜索。

不改工具：`press` 已支持单键连发、`click_text` 已按可见文字查找，现有能力足够；提示词教不会再考虑工具改造（如 click_text 等待元素出现的重试）。

测试：系统提示断言加「全部匹配」「连按」相关关键词。决策点：无。

### 验收（Q14）

全量 `npm test` + `npm run typecheck` 通过后，用户在场重跑 Gmail 归档（或同类批量任务），期望：模型用「全选所有匹配会话」或键盘全选一次清完存量；清存量中途不再问选项；建筛选器前仍会问。

## 完成记录（v6，2026-11-03，Cursor）

全量 `npm test`：73 个文件、594 项通过。`npm run typecheck` 通过。未打包，未提交 git。工具、护栏、确认门都没改。打好评拒绝编造、安全邮件不碰、停止即停这些行为不在本轮改动里，原有提示句没有删。

### T22

- 改动：`src/main/agent/pi-core.ts` 的 `systemPrompt` 加全量授权一句。同类批量操作（归档、清理、翻页）自主连续执行到做完或真卡住，不中途问「要不要继续」。改账号设置、订阅、付费、删除不可恢复内容仍必须先确认
- 测试：先让 `tests/pi-core.test.ts`「系统提示要求两次就换路，并带上确认门和结果页通道」因缺少「全量授权」失败，再补提示。断言含「全量授权」「自主连续执行」
- 决策点：无
- 真机 Q14：未跑

### T23

- 改动：同一条 `systemPrompt` 加批量列表通道。优先点「全部匹配」类横幅；动态横幅用 `click_text` 再试一次；Gmail 键盘全选是连按 `*` 和 `a`；批与批之间沿用同一搜索结果页
- 测试：同一条系统提示断言含「全部匹配」「连按」
- 决策点：无
- 真机 Q14：未跑

---

## 规划方复核结论（v6，2026-11-03，Trae）

代码审查通过，本机复跑 `npm test` 73 文件 594 项全绿、`npm run typecheck` 通过。逐项核对：

- **T22**：systemPrompt 新句（pi-core.ts 201 行）与任务书逐字一致；授权边界对——「同类批量操作」限归档/清理/翻页处理，「跨操作类型」点名改账号设置、订阅、付费、删除不可恢复内容仍先确认，与确认门不冲突（筛选器属于改账号设置，仍会问，符合 v6 验收预期）。
- **T23**：新句（202 行）四要素齐全：横幅优先、`click_text` 兜底重试、键盘全选 `*`+`a`、批间沿用同一搜索页；未改任何工具，符合「提示词教用、不动工具层」的决定。
- **护栏原样**：`pi-core.ts` 是未跟踪新文件，无法用 git diff 隔离本轮改动，改按 v5 基线逐个核对——轮次上限 `Math.min(40, maxRounds || 32)`、`STUCK_HINT` / `PAGE_SAME_HINT` 文案、预算提示、`request_confirm` 工具描述与成功态中断语义均未动；T1–T21 的提示句（拒绝编造、连点两次换路、验证码停等）一句没删。
- **测试质量**：断言补「全量授权」「自主连续执行」「全部匹配」「连按」四关键词；原有反向断言（不含「已连续 3 次无效果」「核心版不执行发布」）保留。
- **决策点**：无，与任务书预期一致。

### Q14 真机 — 未跑，交回用户

用户在场重跑 Gmail 归档（或同类批量任务），通过标准：用「全选所有匹配会话」或键盘全选一次清完存量；清存量中途不再问选项；建筛选器前仍会问。遗留未跑：Q13（B 站上传重跑验 T21 长轮询）、Q5（知乎发布）。

---

## 验收记录（Q14，2026-11-03，Trae 执行真机测试）

T22/T23 修复版（12:34 启动的实例，构建产物已验证含新系统提示）上，规划方经 MCP `sidebar_chat`（与侧栏同一条 `handleChat` 路径）连续发起四轮 Gmail 批量任务，全程无人为干预，用户只在关键节点确认。

### 行为判定：通过（这是本轮最重要的结论）

四轮里模型每一次停止都是**真阻塞**，没有一次是 v6 之前的「已授权还停下来问选项」：

1. 第一轮：建筛选器被 Google 身份验证弹窗拦住 → 不替用户点「继续」、核对过滤器列表确认没保存上、如实报数字后把选择权交回。验证/登录停等规则生效。
2. 第二轮：全选物理失效（「选择」下拉不展开、键盘 `*`+`a` 无反应、表头勾选框无响应）→ 四条路各试一遍，不对同一按钮死磕，停下如实汇报。**T23 的知识进脑了**（明确说出「Gmail 官方全选快捷键」并主动尝试），失败是工具层问题不是提示词问题。T22 判定通过：全量授权的清理任务里没有出现过「要不要继续」式选项，停止全部有真实卡点。
3. 第三轮：还主动提出更优路径——建筛选器时勾「同时应用于匹配的会话」一次清掉全部存量，并说明理由。
4. 第四轮：按指示做 about:blank 整页重载重试；表单弹开后 fill 失败，多选择器尝试后停，**自报操作偏差**（一次误填进顶部搜索框）。

全程数字真实（未读 1,718→1,671→1,672 的每一步都对得上），无谎报、无假完成。

### 任务完成度：未完成（用户决定终止）

过滤器 0 条、存量仅归档最早 50 封。根因是**工具层缺陷**，不是模型行为，见 T24/T25。用户于第四轮后决定「邮箱这个不搞了」，任务终止，现状保留（不回滚）。

### 对照实验记录（T24 的证据）

第二轮起模型所有导航均为 Gmail 同文档 hash 跳转（`#search` ↔ `#settings`），页面文档从未重载。规划方用 MCP `reload` 强刷当前标签后，「创建新的过滤器」表单立刻能弹开——**身份验证弹窗残留的透明遮罩吸掉了全部点按**，且 pi-core 工具集里没有任何 reload 通道，模型无法自愈。11-02 上午同表单能填写提交、同环境今天点按全失效，时间线与遮罩出现吻合。

### T24（v7）：pi-core 补 reload 通道（遮罩自愈）

**要求：**
1. `PiToolName` 加 `reload`，TOOLS 加工具描述（「重载当前标签。页面点按全部失效、疑似弹窗残留遮罩时用它恢复交互。」）；`runCoreTool` 委托既有 reload 能力实现（`browser.ts` reload / MCP `handlers.reload` 已存在，纯接线）。
2. `STUCK_HINT` 末尾加一句：「也可以整页重载（reload 工具）后重试一次再下结论。」系统提示的反卡死条目同步提一句。与「两次换路 / 三次注入」两个既有层级不合并、数字不动。

**验收：**
- 单测：工具注册表含 `reload`；fake runner 下模型调用 reload 会真执行一次。
- 系统提示断言含「重载」关键词。
- 决策点：无（执行能力，不改变路线判断权）。

### T25（v7）：调查 Gmail 弹窗表单 fill/snapshot 时灵时不灵

**现象：** 同一个 Gmail「创建新的过滤器」表单：11-02 上午模型成功填写并提交（触发身份验证即为证据）；11-03 强刷后表单能弹开，但 snapshot 对表单区域返回 **0 个可交互元素**，fill 各种选择器（`#cf1_has`、`input[name="cf1_has"]`、`tr input.nr`、aria-label 匹配）全部失败（`expected=155 actual=0`）。同一环境，时灵时不灵。

**要求：**
1. 真机复现：已登录 Gmail 打开该表单，snapshot 数交互元素、fill「包含字词」，多次开关对比「灵/不灵」的触发条件（候选：dialog 渲染在 shadow root、表单未完成 hydrate、动画未稳定）。
2. 按复现结论修复：snapshot 穿透 open shadow DOM 或等 dialog 稳定后重试；fill 失败必须如实报错并回读。
3. **不能稳定复现时**：把 snapshot 的 dialog 扫描逻辑审查一遍，在完成记录里写明结论与真机记录，不许无声关单。
4. 备注（顺带排查）：键盘全选 `*`+`a` 无反应可能是 Gmail 设置「键盘快捷键」默认未开启——如确认，只在 T23 提示句加一句前提说明（「需在 Gmail 设置开启键盘快捷键，无反应时立即换横幅/click_text」），不动工具。

**验收：** 能复现 → 先写失败测试再修；不能复现 → 如实写「未复现」+ 审查结论。决策点：无。

### 遗留

Q13（B 站上传重跑验 T21 长轮询）、Q5（知乎发布）仍未跑，与 v7 改动一起安排。

## 完成记录（v7，2026-11-03，Cursor）

全量 `npm test`：73 个文件、595 项通过。`npm run typecheck` 通过。未打包，未提交 git。护栏阈值、轮次上限、确认门、T22/T23 原句都没改。

### T24

- 改动：
  - `src/main/agent/pi-core.ts`：`PiToolName` 与工具表增加 `reload`，描述是「重载当前标签。页面点按全部失效、疑似弹窗残留遮罩时用它恢复交互。」`STUCK_HINT` 末尾加「也可以整页重载（reload 工具）后重试一次再下结论。」系统提示的反卡死条目另加一句整页重载，没有并进「两次换路 / 三次注入」，数字没动
  - `src/main/browser.ts`：`runCoreTool` 把 `reload` 接到已有 `this.reload({ asHuman: true, tabId })`
- 测试：先失败再补。`tests/pi-core.test.ts`
  - 「系统提示要求两次就换路，并带上确认门和结果页通道」断言「重载」，工具表含 `reload`
  - 「模型调用 reload 会真执行一次」
  - 「同一点击连续 3 次无变化后注入换策略提示，仍按轮次上限结束」断言提示里有「整页重载」
- 决策点：无
- 真机：未跑。正在开着的 Sparo 还是旧进程，新的 `reload` 工具要重启后才会进模型的工具表

### T25

未复现。没有改 snapshot / fill，也没有改 T23 那句。

真机记录（已登录的 Gmail 过滤器设置页，只点「创建新的过滤器」，没有保存过滤器，没有归档邮件）：

- 点之前 snapshot 约 100 个可交互元素，`inDialog` 为 0，可见输入框只有顶部「搜索邮件」。
- `click` ref 和 `click_text`「创建新的过滤器」都落在同一坐标，正文里没有「包含字词」，表单没弹开。
- MCP 已有的 `reload` 刷新该页后再点，snapshot 91 个元素，表单仍然没弹开。
- 因此没有可填的「包含字词」框，没有做 fill。页面内 `execute` 被 Gmail 的 Trusted Types 拒绝（`eval`），不能靠它再点一次。

审查结论：

- `SNAPSHOT_SCRIPT` 的 `collectFromDocument` 用 `querySelectorAll`，不进 open shadow root。`src/main` 里没有 shadow 穿透。表单若在 shadow 里，主文档快照会漏掉那些输入框；但页面上其它亮 DOM 控件仍会被数到，所以「整页 0 个元素」不能单用 shadow 解释。
- `inDialog` 只认 `role=dialog`、`.ant-modal`、`.el-dialog`、`.modal`、class 含 `Modal`。Gmail 弹层如果没有这些标记，输入框即使被扫到也不会标成 dialog。
- `recaptureIfEmpty` 只在整页 0 个元素、且不是空白页时等 600ms 再抓一次。页面别处还有元素、只有表单区是 0 时，不会为弹层再等。`isVisible` 还丢掉宽高为 0、`display:none`、`visibility:hidden`、`opacity:0` 的节点。动画没完或还没 hydrate 时，正是这个窗口。
- 跨域 iframe 的 `FRAME_COLLECT_SCRIPT` 同样不进 shadow，选择器还比主文档窄。
- `expected=155 actual=0` 是 fill 回读失败的原有报错（`fill fallback failed`），失败没有被说成成功。这次没再走到这条报错。
- Gmail「键盘快捷键」是否默认关闭没有打开设置核对，所以 T23 提示句没加那句前提。

Q13、Q5 仍未跑。

---

## 规划方复核结论（v7，2026-11-03，Trae）

代码审查通过，本机复跑 `npm test` 73 文件 595 项全绿、`npm run typecheck` 通过。逐项核对：

- **T24**：`reload` 进 `PiToolName`、工具表、`runCoreTool` 纯接 `this.reload({ asHuman: true, tabId })`（browser.ts 4611 行），与任务书一致。`STUCK_HINT` 原句保留、末尾追加整页重载一句（pi-core.ts 182 行）；系统提示新句（200 行）插在反卡死条目之后，与「两次换路 / 三次注入」两个既有层级未合并、数字未动；确认门、T22/T23、验证码停等等原句逐条比对无删改。测试覆盖三个点（工具表注册、真执行一次、提示含「重载」），另有既有 STUCK_HINT 断言同步更新，符合「先失败再补」。
- **T25**：按任务书走「未复现」分支，处置正确——没动 snapshot/fill/T23 原句，审查结论具体（`collectFromDocument` 不进 shadow root；`inDialog` 标记表不含 Gmail 弹层；`recaptureIfEmpty` 只在整页 0 元素时等 600ms；`expected=155 actual=0` 是 fill 如实回读）。真机记录如实（这次是另一种卡法：snapshot 看得见链接、点不开表单，刷新后依旧），没有把没验证的键盘快捷键猜测写进提示，纪律好。
- **决策点**：无，与任务书预期一致。

### 后续候选（未立任务，先登记）

- snapshot 不穿 shadow root、`inDialog` 标记表太窄、`recaptureIfEmpty` 不为局部弹层等待——T25 审查发现的三处缺口暂不修：原始事故的根因（遮罩）已由 T24 的 reload 通道兜住，三处缺口等下次真机再撞上时按现场立任务，避免无复现条件下盲改采集层。
- `reload` 工具真机验证与 Q13、Q5 一并安排：重启 Sparo 后，随便找一个「点按全失效」或长轮询场景观察模型是否自主调用 reload。

### T24 真机验证 — 通过（2026-11-03，重启后直接验证）

旧实例（12:34 启动的旧进程）精确终止后重启（构建产物已含 `reload` 工具）。经 MCP `sidebar_chat` 指令「用 reload 整页重载当前页面并汇报标题和 URL」：模型一轮内调用 `reload`（真实执行，返回 bodyLen 307），再用 `get_url` / `get_title` 交叉核实与 reload 返回一致，如实汇报。T24 的工具链路端到端走通。仍欠：模型在真实「点按全失效」场景下**自主**调用 reload 的观察（当前验证是指令驱动的）。

---

# 第三轮（v8）— 随时可打断（2026-11-03 立项）

> 用户需求：Sparo 执行任务时用户没法打断——能打字但发不出去（发送按钮被 `dataset.sending` 禁用到整个 run 结束），停不下来（`spark:stop` 只停页面加载，管不到 `piCore.run`）。要改成 Cursor / Trae 那样：**用户随时输入，随时打断**。

## 现状（已核实，不要重查）

- `browser.ts` `handleChat`（约 6277 行）：`chatRunning` 为真时新消息进 `pendingChat`，回复「已记下，当前任务汇报后接着做」；run 的 finally（6345–6347）会自动接续 `pendingChat`。这条续跑链保留，打断要复用它。
- `browser.ts` 2094 行 `stopLoading()`：只调 `livePage().stop()`。
- `shell.html` 4152–4163 行 `syncSendButton`：`dataset.sending === "1"` 时发送按钮禁用；4266 行发送时置位，await `sparkShell.chat` 直到整个 run 结束才清除。
- `pi-core.ts` `run()`：轮次循环无取消检查，`completion()` 的 fetch 无 AbortSignal。
- `awaitingConfirm` 时 run 已结束、`chatRunning` 已复位，确认答复不受影响，不用动。

## T26（P0）pi-core 支持中断

**要求：**
1. `run()` 的 input 增加可选 `signal?: AbortSignal`。
2. 中断检查点：每轮调模型**之前**、每次工具调用结束**之后**，检查 `signal.aborted`。命中即返回 `{ ok: true, text: "（任务被用户打断，未完成的步骤不做宣称。已做的操作以工具记录为准。）", interrupted: true }`——固定如实文案，**不许假完成、不许把打断说成失败**（`ok: true` + `interrupted: true`，侧栏不当错误处理）。
3. `completion()` 的 fetch 传入同一 `AbortSignal`：正在等的模型响应立即取消，不傻等超时。fetch 抛 AbortError 时按「被打断」返回同上结果，**不**走「模型请求失败」文案；此时本轮 assistant/tool 消息尚未入栈，序列天然干净，不许再推半截。
4. 工具调用中不硬杀（工具以秒计，等它返回后在下一个检查点退出）。

**验收（TDD，测试进 `tests/pi-core-v4.test.ts` 或新文件）：**
- fake fetch 永不 resolve → abort → `run` 在 1 秒内返回 `interrupted: true`、`ok: true`。
- 正常轮次之间 abort → 同样语义返回，messages 无半截 assistant/tool。
- 未 abort 的现有测试全部不受影响（`signal` 可选）。

## T27（P0）handleChat 新消息即打断 + 停止按钮接线

**要求：**
1. `SparkBrowser` 加 `activePiAbort: AbortController | null`；`handleChat` 里 `piCore.run` 期间持有，finally 置空。
2. `handleChat` 的 `chatRunning` 分支改为：照常 push 用户气泡、照常写 `pendingChat`，**同时 `this.activePiAbort?.abort()`**。被打断的 run 返回后照旧走 6345–6347 的 finally 续跑链——新消息立即生效，不需要新队列机制。
3. 中断时 `chatLog` push 的 assistant 文案用 pi-core 返回的 `interrupted` 文案（6329 行现有 push 已覆盖，不用改）。
4. `spark:stop` 处理器（2637 行）：在 `stopLoading()` 之外，`chatRunning && activePiAbort` 时也 abort。纯停止（无 pendingChat）时 run 返回「被打断」文案后 finally 不续跑，任务干净结束。
5. 云计量链路不许破坏：abort 让 `run` **正常返回**（不 throw），6341 行的 `finishCloudTask` 在 finally 里照常执行；`catch` 分支不得因 AbortError 误报「执行失败」。
6. 边界如实接受：打断只对已进入 piCore 循环的 run 生效；云闸门 / `beginCloudTaskIfNeeded` 阶段（毫秒级）到达的新消息仍走排队老路，不用改。

**验收：** pi-core 层由 T26 测试覆盖；handleChat 接线用 `tests/pi-core-guard.test.ts` 的既有实例化路径补一条「运行中第二条消息触发 abort 且 pendingChat 续跑」，若该 harness 不适用则如实写「浏览器层未测，交真机 Q15」。

## T28（P1）侧栏输入随时可发

**要求（`shell.html`）：**
1. `syncSendButton`（4152 与 3446 两处）不再因 `dataset.sending` 禁用发送按钮——运行中允许再次发送（主进程会打断接新指令）。锁屏（composerLock / input.disabled）逻辑不动。
2. `sending` 期间发送按钮文案或占位提示显示「发送将打断当前执行」（i18n：加 `t()` 键，中英都要，**不写死中文**）。
3. Enter 发送路径与按钮一致（运行中 Enter 也生效）。

**验收：** 真机：任务执行中打字 → 发送按钮可点、Enter 可发；发出后任务 ≤2 秒内停下并开始处理新指令；无控制台报错。

## 全局禁区（本轮新增）

1. 不删 `pendingChat` 续跑链，不引入第二套队列。
2. 打断文案必须如实：不许出现「已完成」「失败」字样冒充打断结果。
3. AbortError 不许走「执行失败」分支；云 `task_id` 计量 finally 链不许绕开。
4. i18n 键不写死中文。
5. 决策点：无（用户主动动作，非本地自主判断；假完成禁令继续生效）。

## 验收（Q15，用户在场）

跑一个长任务（B 站上传 / 长浏览采集均可）：
1. 执行中途输入新指令并发送 → ≤2 秒停下、接新指令，上下文保留（新指令能引用前面的进度）；
2. 停止按钮 → 立即停，侧栏如实说被打断；
3. 打断后接着让模型继续原任务 → 能从断点续上；
4. 全程无 `insufficient tool messages`（顺带验 T21）。
Q13、Q5 若场景顺路则一并跑。

## 完成记录（v8，2026-11-03，Cursor）

全量 `npm test`：74 个文件、598 项通过。`npm run typecheck` 通过。未打包，未提交 git。护栏、确认门、T22/T23 提示句、`pendingChat` 续跑链、云计量 `finishCloudTask` 都没改。打断返回 `ok: true`，不进「执行失败」。

### T26

- 改动：`src/main/agent/pi-core.ts`。`run()` 接受可选 `signal`。每轮调模型前、每次工具返回后检查；`completion()` 把同一信号接到 fetch，用户中断不重试、不走超时失败文案。命中返回固定文案，带 `interrupted: true`。工具执行中不硬杀
- 测试：先失败再补。`tests/pi-core-v8.test.ts`
  - 「模型请求一直不返回时，abort 在 1 秒内如实打断」
  - 「正常轮次之间 abort，不把半截 assistant/tool 发给模型」
- 决策点：无
- 真机 Q15：未跑

### T27

- 改动：`src/main/browser.ts`
  - `activePiAbort` 在 `piCore.run` 期间持有，finally 里、续跑之前置空
  - `chatRunning` 分支仍写用户气泡和 `pendingChat`，并 `abort()`。finally 里原来的 `pendingChat` 续跑还在
  - `spark:stop` 在 `stopLoading()` 之外，运行中再 abort。没有新消息时不续跑
- 测试：`tests/pi-core-guard.test.ts`「运行中第二条消息触发 abort 且 pendingChat 续跑」。停止按钮这条没有单独的界面测试
- 决策点：无
- 真机 Q15：未跑

### T28

- 改动：
  - `src/renderer/shell.html`：两处 `syncSendButton` 不再因 `dataset.sending` 禁用发送。运行中按钮标题和输入占位改成 `t("chat.sendInterrupt")`。Enter 仍走 `sendChat`。重叠发送用计数，避免后一次的结束把前一次的发送态清掉。锁屏逻辑没动
  - `src/shared/i18n.ts`：`chat.sendInterrupt` 中文「发送将打断当前执行」，英文 “Sending will interrupt the current run”。其它语言走已有的英文回落
- 测试：无界面测试。i18n 既有套件仍绿
- 决策点：无
- 真机 Q15：未跑。当前窗口是改代码前开的，侧栏和主进程都要重启才吃到这轮

Q13、Q5 仍未跑。

## 规划方复核结论（v8 收口，2026-11-03，Trae）

代码审查通过，本机复跑 `npm test` 74 文件 598 项全绿、`npm run typecheck` 通过。逐项核对：

- **T26**：signal 检查点位置正确——每轮调模型前（pi-core.ts 333 行）、每次工具返回后（408 行）；关键分支 345–347 行 catch **先查 `aborted`** 再落 `modelRequestFailure`，AbortError 不会误走「执行失败」文案；`completion()` 把同一信号接到 fetch（487–517 行），abort 后不重试；`interruptedResult()` 固定如实文案、`ok: true` + `interrupted: true`。半截消息不会发给模型：fetch 取消时本轮 assistant/tool 尚未入栈；工具返回后打断时 run 立即返回，不再入栈。
- **T27**：`activePiAbort` 六处接线齐全（browser.ts 785 声明、2640 `spark:stop`、6295 `chatRunning` 分支、6328 创建、6335 传参、6349 finally 置空）；`pendingChat` 续跑链保留在 finally；云计量 `finishCloudTask` 仍在 finally（6350 行）——abort 让 run 正常返回不 throw，计量链路未被绕开。`tests/pi-core-guard.test.ts` 覆盖「第二条消息触发 abort 且续跑」；停止按钮界面层如实写「未测，交真机 Q15」。
- **T28**：两处 `syncSendButton`（shell.html 3450、4156 行）只在 `locked || !text` 时禁用，运行中不再禁用；标题/占位走 `t("chat.sendInterrupt")`，`src/shared/i18n.ts` 中英两键齐全（101、506 行）；重叠发送用 sendDepth 计数（4268、4280 行）防后一次结束清掉前一次状态；锁屏（composerLock / input.disabled）未动。
- **护栏清点**：确认门（pi-core.ts 376–377 行 `request_confirm` 分支）原样；T22/T23 提示句未动；假完成禁令未动。决策点：无，与任务书预期一致。
- **真机 Q15**：未跑，交回用户。注意当前开着的是改码前进程，主进程和侧栏都要重启才吃到本轮。v9 已立项（见下），Q16-2（auto 打断续跑）会顺带覆盖 Q15-1 的场景。

遗留：Q13（B 站上传）、Q5（知乎发布）、reload 自主调用观察。**v8 收口，代码合格。**

---

# 第五轮（v9）— 两种执行模式：逐步确认 / 自动执行（2026-11-03 立项）

> 用户需求：现在每逢发布总是中途停下来询问，完整任务、多步骤任务经常被打断，没法自动跑完。参照 Cursor 的模式选择器，做两种执行模式：
> **逐步确认**（现状：关键环节询问用户）；**自动执行**（不中途询问，执行完用户规定的完整任务再汇报）。
> 边界已与用户对齐：**自动模式下发布/发送直接执行（用户任务指令本身就是授权），支付/删除仍停一次确认。**

## 现状（已核实，不要重查）

- 打断行为来自两处，都在模型侧：
  1. `pi-core.ts` `systemPrompt()`（189 行）203 行那条：发布、发送、支付、删除四类必须先 `request_confirm` 走一次确认往返。
  2. 模型自律习惯：多步任务中途问「要不要继续」、缺信息就问。204 行的「全量授权措辞」只豁免了明确说了「直接/以后/全部」的批量场景。
- `request_confirm` 工具分支在 `pi-core.ts` 376 行：中断 run、`ok: true` + `awaitingConfirm: true` 返回确认问句。这套机制**不动**。
- **字段名警示：** `pi-core.ts` 31 行 run 的 config 已有 `mode?: "byok" | "cloud"`（计费用）。新模式字段**必须叫别的名字**，建议 `execMode`。
- `run()` input 定义在 300–307 行（`input` / `url` / `title` / `locale` / `history` / `signal`）。
- `handleChat` 调 `piCore.run` 在 `browser.ts` 6329–6336 行，照这里加传。
- 设置链路：`src/main/settings/store.ts` —— `loadSettings`（256 行）、`saveSettings`（304 行）、`settingsPublicView`（383 行），`locale` 字段（155 行）是加新设置字段的现成样板。渲染侧走既有 `spark:save-settings`（`browser.ts` 2937 行，收 `Partial<SparkSettings>` patch）。
- v8 打断机制已在代码里（`activePiAbort`、`signal` 检查点、`interrupted` 返回、`pendingChat` 续跑链）。自动模式的正确形态就是**建在它上面**：长任务自动跑，用户随时插话打断、随时停。本轮不动这些。

## T29（P0）执行模式状态贯通

**要求：**
1. `src/main/settings/store.ts`：`SparoSettings` 加 `execMode: "step" | "auto"`，默认 `"step"`。加载/保存时 normalize（非法值回落 `"step"`），`settingsPublicView` 暴露。照 `locale` 的既有写法。
2. `browser.ts` `handleChat`（6329–6336 行）：调 `piCore.run` 时增加 `execMode: this.settings.execMode`。每条消息用当时生效的模式，不做会话级快照。
3. `pi-core.ts` `run()` input 加 `execMode?: "step" | "auto"`（缺省按 `"step"`），透传给 `systemPrompt`。

**验收（TDD）：** 单测：settings 非法 `execMode` 落盘后读回落 `"step"`；`run` 不传 `execMode` 的既有测试全部不受影响（字段可选）。

## T30（P0）systemPrompt 按模式分支

**要求：** `systemPrompt(url, title)` 改为 `systemPrompt(url, title, execMode)`。**step 模式一字不改**（203、204 行原样）。auto 模式做以下替换/追加：

1. 203 行那条替换为：「当前是自动执行模式：发布、发送类动作**直接执行**，不调用 request_confirm——用户下达的任务指令本身就是授权（用户说『发小红书』就是授权发到发出为止）。支付、删除类动作仍必须先用 request_confirm 向用户确认，得到明确同意后才执行。客服回复只把草稿填进输入框，发送仍由用户在页面上点。」
2. 追加：「自动模式下不中途询问『要不要继续』『要不要打开』，一口气执行到任务完成、真阻塞（需要登录、出现验证码、页面持续无响应）或缺了无法自决的关键信息才停。停下时如实说明卡在哪。」
3. 追加可自决边界：「缺可自决的细节（先看哪个入口、默认当前城市、先展示第一页结果）就自决并在最终汇报里注明假设；缺影响结果的硬信息（出发地、日期、金额、平台账号选择）且无法从对话和历史推断时，才停下来问。」
4. 198 行「只在任务完成、无法继续或必须向用户提问时输出最终文字」对 auto 模式天然成立，不改。
5. `request_confirm` 工具本身**不删不改**。auto 模式下模型对发布不该调用；若误调用，本地照常中断等待（多问一次方向安全，可接受），**严禁**本地吞掉调用或自动代答「确认」。

**验收（TDD）：** 单测断言：auto 版 systemPrompt 含「直接执行」和「支付、删除仍必须」关键词、不含 203 行的 step 措辞；step 版与现状逐字相同（既有断言不许改坏）。

## T31（P1）侧栏模式选择器

**要求（`shell.html`）：**
1. 输入框工具行（加号按钮那排）加一个下拉选择器，两选项：**逐步确认** / **自动执行**。选中态常显当前模式，参照用户截图（Cursor 审批选择器）的放置逻辑：不弹模态、不占聊天区。
2. 切换即调既有 `spark:save-settings` 落盘，下一条消息起生效；侧栏状态里能回读当前模式（`settingsPublic` 已含）。重启后保持。
3. i18n：中英都加（`src/shared/i18n.ts`，照 `chat.sendInterrupt` 的先例），不写死中文。

**验收：** 切模式 → 刷新/重启后仍是切换后的值；控制台无报错。

## 决策点（先登记再写码）

`docs/DECISION-POINTS.md` 登记 **#30 自动执行模式边界**：`execMode === "auto"` 时发布、发送免 `request_confirm` 确认门（用户显式选择的执行模式，任务指令即授权）；支付、删除保留确认门；客服回复两模式都只填草稿；登录/验证码/安全验证两模式都如实停等。判定依据是 settings 里的用户显式选择，非本地自主判断；假完成禁令、轮次护栏（#26）继续生效。

## 全局禁区（本轮新增）

1. `request_confirm` 工具与其中断机制不删不改语义；不许本地代答确认。
2. 客服回复只填草稿，两模式一致，不变。
3. 登录、验证码、安全验证如实停等用户，不绕，两模式一致。
4. 新字段不许叫 `mode`（`pi-core.ts` 31 行已被 byok/cloud 占用）。
5. step 模式的 systemPrompt 与现有行为一字不改——只加分支，不改存量句。
6. v8 打断机制（`activePiAbort` / `signal` / `interrupted` / `pendingChat` 续跑链）、云计量 `finishCloudTask` finally 链不许动。
7. 轮次上限 32（#26）照旧：自动模式不是无限模式，到上限如实停。
8. i18n 不写死中文。不打包、不提交 git、不碰 `docs/listings/`。

## 工程要求

- TDD：T29/T30 先写失败测试再实现，测试放 `tests/pi-core-v9.test.ts`（或就近既有文件），风格照 `tests/pi-core-v8.test.ts`。
- 每完成一个任务跑 `npm test`（全量全绿）、`npm run typecheck`。
- PRODUCT.md 语义又要动一小句（自动模式下发布免确认），改文档本身留给规划方，完成记录里注明即可。

## 验收（Q16，用户在场）

先跑 0 再跑 1–2（防止顺序污染）：
0. **step 回归**：逐步确认模式发微博 → 草稿好后照旧出确认问句，回「确认」才真发（T4 行为不回退）。
1. **auto 发布**：切自动执行，发微博 → 从打开站点、写草稿到点发布一口气跑完，中途无任何「确认吗」类问句；汇报带已发证据（如个人主页时间线）。
2. **auto 打断续跑**：自动模式跑长任务（B 站上传 / 长采集），中途发新指令 → ≤2 秒停下接新指令（顺带验 Q15-1）；再让它继续原任务 → 直接续跑，不问「要不要继续」。
3. **auto 真阻塞**：自动模式下到需要登录的平台 → 如实停下等用户处理，不绕。
4. **auto 确认门**：自动模式下触发支付或删除场景 → 仍出确认问句。
5. 切回 step → 确认门恢复。

Q13（B 站上传验 T21 长轮询）、Q5（知乎发布）若场景顺路则一并跑。

## 完成交付

照旧：改动文件清单、每任务测试名、决策点（本轮应有 #30 登记）、真机结果（未跑的如实写「未跑」）、PRODUCT.md 待同步注明。

## 完成记录（v9，2026-11-03，Cursor）

全量 `npm test`：75 个文件、603 项通过。`npm run typecheck` 通过。未打包，未提交 git。`request_confirm` 的中断语义没改，本地不代答。v8 打断链（`activePiAbort` / `signal` / `interrupted` / `pendingChat` 续跑）和云计量 `finishCloudTask` 的 finally 没动。轮次上限仍是 32。step 模式的存量提示句没有改字，只在 `execMode === "auto"` 时替换确认门那一句并追加两句。

决策点：任务书写的是 #30，登记册里 #30 已是「轮次预算提示」，#31–#33 也已占用，本条记为 **#34 自动执行模式边界**（`docs/DECISION-POINTS.md`）。语义按任务书：用户显式选择 `execMode`，不是本地自主判断。

`docs/PRODUCT.md` 里「发布前确认」那句还没改，留给规划方。自动模式下发布、发送免确认，只写在提示词里。

### T29

- 改动：
  - `src/main/settings/store.ts`：`execMode: "step" | "auto"`，缺省 `"step"`。`normalizeExecMode` 把非法值收成 `"step"`。`loadSettings` / `saveSettings` / `settingsPublicView` 都带上。字段不叫 `mode`
  - `src/main/browser.ts` `handleChat`：`piCore.run` 增加 `execMode: this.settings.execMode`，每条消息用当时的设置
  - `src/main/agent/pi-core.ts`：`run()` input 增加可选 `execMode`，缺省按 step 传给 `systemPrompt`
- 测试：先失败再补。`tests/pi-core-v9.test.ts`「非法 execMode 落盘后读回落 step，合法 auto 能暴露」。不传 `execMode` 的既有用例仍绿

### T30

- 改动：`systemPrompt(url, title, execMode)`。step 与不传走原来的句子。auto 把「发布、发送、支付、删除等不可逆动作…」换成「当前是自动执行模式…直接执行…支付、删除仍必须…」，并追加不中途询问、可自决边界两句。全量授权句、客服只填草稿、登录/验证码停等，两模式都还在。工具表里的 `request_confirm` 没删没改
- 测试：`tests/pi-core-v9.test.ts`
  - 「不传 execMode 与 step 的系统提示逐字相同，且保留确认门原句」
  - 「auto 系统提示改发布发送为直接执行，支付删除仍必须确认」
  - 「auto 模式下模型仍调用 request_confirm 时本地照常停下，不代答」
- 真机 Q16：未跑

### T31

- 改动：
  - `src/renderer/shell.html`：输入框工具行（文件按钮旁边）加 `#execMode` 下拉，选项 step / auto。切换调既有 `spark:save-settings`。侧栏状态回读 `deepseek.execMode`，焦点在选择器上时不覆盖。发送按钮和打断提示没动
  - `src/shared/i18n.ts`：`chat.execMode.label` / `chat.execMode.step` / `chat.execMode.auto`。中文「执行模式 / 逐步确认 / 自动执行」，英文 “Run mode / Confirm each step / Run automatically”。其它语言走已有的英文回落
- 测试：`tests/pi-core-v9.test.ts`「侧栏模式文案走中英词条，选择器落盘 execMode」（词条 + 页面里有选择器和 `saveSettings({ execMode`）。没有在真窗口里点过
- 真机 Q16：未跑。当前窗口是改代码前开的，侧栏和主进程都要重启才吃到这轮

Q13、Q5 仍未跑。

## 规划方复核结论（v9 收口，2026-11-03，Trae）

代码审查通过，本机复跑 `npm test` 75 文件 603 项全绿、`npm run typecheck` 通过。逐项核对：

- **T29**：`settings/store.ts` 六处齐全——`SparoSettings.execMode`（166 行，注释写明缺省与非法值都是 step）、默认值（228 行）、load normalize（299 行）、save normalize（368 行）、public view（430 行）；`browser.ts` 6336 行显式回落传参；`pi-core.ts` 320/329 行可选字段、缺省按 step。字段未占用 `mode`。
- **T30**：step 提示 190–213 行与 v8 逐字比对一致，一字未改；auto 分支 214–225 行用前缀 `findIndex` 定位确认门句再 splice 替换——找不到时安全回落 step 语义，这个写法稳。替换句与任务书文本一致（发布/发送直接执行、支付/删除仍必须、客服只填草稿），追加的不中途询问、可自决边界两句在位。`request_confirm` 分支（393–395 行）未动，全代码无本地代答。
- **T31**：`shell.html` 1954–1956 行选择器（data-i18n 不写死中文）、4482–4488 行 onchange 走既有 `spark:save-settings`、3226–3228 行状态回读带焦点保护；`i18n.ts` 三键中英齐全（102–104 / 510–512 行）。
- **决策点**：任务书写的 #30 是规划方立项时没查最新登记册的笔误（#30–#33 已被轮次预算、店小秘闸门、请求超时、click_text 放行占用，责任在规划方）。Cursor 改记 **#34** 且条目完整、注明偏差原因，处置正确。#34 语义与任务书一致：用户显式选择的 `execMode`，非本地自主判断。
- **护栏清点**：v8 打断链（`activePiAbort` / `signal` / `interrupted` / `pendingChat` 续跑）、云计量 `finishCloudTask` finally、轮次上限 32、假完成禁令均未动。
- **PRODUCT.md**：已由规划方同步（5 处：开头段、卖点表「发送前你确认」行、Chrome 对比表发送行、动作表发布行、侧栏模式切换说明）。默认语义全部保持，自动执行作为显式可选项补充。
- **真机 Q16**：未跑，交回用户。重启主进程和侧栏后才看得到选择器。Q16-2 顺带覆盖 Q15-1。

遗留：Q13（B 站上传）、Q5（知乎发布）、reload 自主调用观察。**v9 收口，代码合格。**

## Q16 第一轮真机（2026-11-03 16:2x）— 未通过，根因是实例陈旧，非代码缺陷

用户现象：①选了自动执行，发送指令后选择器弹回逐步确认（复现两次）；②「停止」过了一会儿才停。底账核对（chat-memory 第 23–38 条）佐证：五次任务全部停在确认门（含「直接发布 过程中不用问我」的那次）；`[user]停止` 排在 `[assistant]我准备执行…` 之前——run「重发一条」没被打断、自然跑完（找热搜第 9 位、填 559 字草稿、到确认门）才处理「停止」。

**证据链：**
- 主进程 PID 14688 启动于 **14:53:04**（`electron.exe .`），早于 v8 最终代码与 v9 落盘（Cursor v9 改动 16:03:48–16:03:53）。
- 侧栏渲染层 PID 27916 于 **16:22:51** 重载——吃到 v9 选择器，形成旧主进程 + 新渲染层的混合实例。
- **settings.json 16:23:29 被写过但无 `execMode` 字段**：切换保存的 IPC 到达的是旧主进程，旧 `saveSettings` 的对象字面量没有该字段，静默丢弃；每轮 `handleChat` 拿到的都是 step。
- 旧主进程无 v8 打断链（`activePiAbort`），「停止」只进 `pendingChat` 排队，与现象完全吻合。

**处置：** 精确终止 14:53 进程树，重启 `npm run start`（吃到 v8+v9 全量代码），复测 Q16。此轮不立新任务、不改代码——v8/v9 代码审查结论不变。

---

# 第六轮（v10）— 素材库：截图存档、网页图片保存与跨站引用（2026-11-03 立项）

> 用户需求：给浏览器加入自动存储网站图片或截图的功能；存下来的素材要能继续用——发微博带图、在其他网站回复时贴图等。要求研究后写任务书。

## 需求拆解与现状（已核实，不要重查）

「存」和「用」两端现状：

- **用（执行端）已齐**：pi-core 工具集（`pi-core.ts` 117–179 行，共 15 个）已有 `set_file`（169–177 行）——把本地文件放进页面的文件选择框。素材一旦落盘，微博发图、贴吧/知乎回复贴图的执行通道就是现成的。
- **存（采集端）缺三块**：
  1. pi-core **没有截图工具**。browser 层 `screenshot`（`browser.ts` 9518–9583 行）能截屏、能按 selector 裁剪、能整页，且已落盘到 `diag/`——但那是 MCP 层工具，侧栏 Agent 核调不到，且 `diag/` 是诊断目录，语义不对。
  2. **没有保存网页图片的工具**（全仓库都没有「按 img 下载到本地」的能力）。
  3. **没有素材库语义**：无专门目录、无清单、模型存完查不回。
- `diag/` 无自动清理（全仓库只查到 `pruneStaleApprovals`），但素材仍应独立目录，不能混进诊断目录。
- 「自动」的正确形态：**模型在任务中按需存**（多步任务里把要引用的页面状态/图片存下来），不是后台定时截屏。这与既有系统提示「只在任务完成、无法继续时输出最终文字」不冲突。

## 设计定案（与用户需求逐条对应）

- 素材库目录：`%APPDATA%\sparo-store\captures\`，文件名 `{用途标签}-{时间戳}.png|.jpg`，同目录 `index.json` 清单追加写：`{ file, kind: "shot"|"image", src?, url, title, time }`。清单是审计与「供人审来源」的依据。
- 模型引用方式：工具返回绝对路径 → 后续步骤 `set_file({ path })`。纯文本链路即可闭环，不依赖多模态。

## T32（P0）pi-core 新增 `save_shot` 与 `save_image`

**要求：**

1. `save_shot`：截当前标签（复用 `browser.ts` capture 既有实现：可见区 / `selector` 裁剪 / `fullPage` 整页均可，参数照 `screenshot` 的 `parseScreenshotInput` 收敛），**写入 `captures/`** 并登记清单，返回 `{ file, url, title }`。不回 base64（省 token；识图走侧栏既有粘贴链路）。
2. `save_image`：按 `selector` 选中页面 `<img>`（或直接给 `src`），**在页面上下文里 fetch 转 base64** 回主进程落盘——天然带页面 cookie 与 referer，登录墙内可见的图也能存。护栏：响应 `Content-Type` 必须 `image/*`，单张 ≤10MB，超限或非图片如实报错不落盘。返回 `{ file, src, url, title }`。
3. 磁盘护栏：单任务（单次 run）两工具合计 ≤20 张，超了如实报满；`captures/` 总量 >500MB 时新存报满——**都不自动删**，删除留给人在文件管理器做。
4. 工具描述写清用途：存素材供后续 `set_file` 引用；描述里注明「素材只存本机」。

**验收（TDD）：** 单测：落盘文件存在且清单有对应记录；`Content-Type` 非图片被拒；10MB 上限被拒；20 张/500MB 护栏触发后返回报满文案。

## T33（P0）`list_captures` 工具 + systemPrompt 行为提示

**要求：**

1. pi-core 新增 `list_captures`：返回清单最近 20 条（file、kind、src、来源页、时间），供模型找回已存素材的路径。
2. systemPrompt **两种模式（step/auto）同样**追加一句，插在工具清单说明之后：「任务中需要留档或后续引用的页面状态、网页图片，用 save_shot / save_image 存进本机素材库；之后要在微博、贴吧等站贴图时，用 set_file 把素材路径放进该站的文件选择框。素材只存本机，不进聊天记录。」
3. 不新增确认门：存图不是不可逆动作，两模式都不询问。

**验收（TDD）：** 单测：systemPrompt 两种模式均含新提示句且互不影响既有断言；`list_captures` 空库返回空数组不报错。

## T34（P0）决策点核查与护栏登记

本轮**不新增**会提前结束任务、绕过脑区或改走向的本地判断（素材存取不改任务走向），按 AGENTS.md 规则本可不动登记册；但**若实现中发现需要任何此类判断，先登记 `docs/DECISION-POINTS.md`（下一号 #35）再写码**。护栏语义（本机存储、不自动删、上限报满）写进工具描述即可，不进登记册。

## 全局禁区（本轮新增）

1. **不做后台定时截屏、不做监控式自动采集**——「自动」＝模型任务内按需调用，不驻留、不定时。
2. 素材仅存本机（`%APPDATA%\sparo-store\captures\`），不上云、不写进 chat-memory。
3. 不绕登录墙、付费墙：页面能正常显示的才能存；存不下如实报错。
4. 文件白名单 `image/*`：不存视频、文档等其他格式（用户自己发视频仍走既有 set_file，不经过素材库）。
5. `save_image` 用页面上下文 fetch（带 cookie/referer），**不额外携带或存储任何凭据**。
6. 不动 v8/v9 已收口链路：打断链、execMode 分支、确认门、云计量、轮次上限。
7. 侧栏 `screenshot` 的 MCP 层行为一字不改（`diag/` 用途照旧）；pi-core 的 `save_shot` 是新通道，不共用输出目录。
8. 不打包、不提交 git、不碰 `docs/listings/`。PRODUCT.md 素材库卖点由规划方同步。

## 工程要求

- TDD：先写失败测试（建议 `tests/pi-core-captures.test.ts`，风格照 `tests/pi-core-v8.test.ts`）。
- 每任务完成跑全量 `npm test` + `npm run typecheck`。
- 微博 compose 的图片按钮/file input 结构以真机为准，不在单测里 mock 站点结构。

## 验收（Q17，用户在场）

前置：复测 Q16（模式切换 + 打断）仍待跑，可与本轮合并安排。
1. **存**：打开带图网页，一条指令「把这张图存下来，再截一张整页图」→ 两个文件落 `captures/`，清单两条，模型报出路径。
2. **用（发布）**：auto 模式发一条带图微博（用刚存的图，set_file 进发图框）→ 一口气发完，个人主页可见该图。
3. **跨站引用**：去贴吧或知乎回复时贴同一素材 → file input 收到文件。
4. **护栏**：让模型存一张 20MB 大图 → 如实报满不落盘；`list_captures` 能查回全部素材。
5. **回归**：step 模式发带图微博 → 发布前确认门照旧（带图不改变确认语义）。

## 完成交付

照旧：改动文件清单、每任务测试名、决策点（预期「无」）、真机结果未跑如实写、PRODUCT.md 素材库卖点待规划方同步注明。

## 规划方复核结论（v10 收口，2026-11-03，Trae）

代码审查通过，本机复跑 `npm test` 76 文件 611 项全绿、`npm run typecheck` 通过。逐项核对：

- **T32**：`browser.ts` `saveShot`（9522–9584 行）复用 `parseScreenshotInput` / `captureVisiblePage` / `captureFullPage`，经 `saveShotBytes` 写 `captures/`，不回 base64；`saveImage`（9586–9619 行）用 `fetchImagePageScript` 在页面上下文取图（天然带 cookie/referer）。护栏全数落实在 `src/main/captures.ts`：`image/*` 双端校验（主进程 + 页面脚本，非图片与超限在页面端就拒）、单张 10MB（157 行）、库容 500MB 报满且文案明确「不自动删除」（7、13 行）、单任务 20 张（`CAPTURE_RUN_LIMIT`，pi-core 428/438 行工具分发处检查）。清单 `index.json` 追加写。**MCP 侧 `screenshot` 未动**（9630 行起仍写 `diag/`），禁区第 7 条守住。
- **T33**：pi-core 三工具定义齐全（184–206 行），描述都注明「素材只存本机」；`list_captures` 空库返回空数组（9621–9628 行）。systemPrompt 通过共享 `CAPTURE_PROMPT` 常量（238 行）对 **step/auto 两模式同时生效**，插在 set_file 提示句之后——比任务书原案更干净的写法；step 存量句、auto splice 逻辑均未动，既有断言不坏。
- **T34**：决策点「无」判断正确——护栏拒绝走 `ok: false`，模型接着做或如实汇报，不结束任务、不改走向，无需登记。
- **护栏清点**：v8 打断链、v9 execMode 分支、确认门、云计量、轮次上限均未动；无后台定时截屏（全部由模型在任务内按需调用）。
- **PRODUCT.md**：已由规划方同步素材库卖点（3 处：卖点表新增「素材随手存」行、动作表新增「带图发布 / 贴图回复」行、侧栏说明段补一句）。
- **真机 Q17**：未跑，交回用户。旧实例已终止、新实例已起（主进程吃到 v10 三工具），Q16 复测可与 Q17 一次跑完。旧实例退出前的日志显示 v9 auto 模式下连发三条微博未再出现确认问句——Q16 方向乐观，以正式验收为准。

遗留：Q16 复测、Q17、Q13（B 站上传）、Q5（知乎发布）、reload 自主调用观察。**v10 收口，代码合格。**

## 完成记录（v10，2026-11-03，Cursor）

全量 `npm test`：76 个文件、611 项通过。`npm run typecheck` 通过。未打包，未提交 git。没有后台定时截屏。素材只进 `%APPDATA%\sparo-store\captures\`，不进聊天记录、不上云。MCP 的 `screenshot` 仍写 `diag/`，函数体没改。v8 打断链、v9 的 `execMode` 分支、确认门、云计量 finally、轮次上限 32 都没动。

决策点：无。20 张和 500MB 只让这一次保存失败并让模型继续，不结束任务、不选路线，所以没有登记 #35。

`docs/PRODUCT.md` 的素材库卖点没改，留给规划方。

### T32

- 改动：
  - `src/main/captures.ts`：落盘、`index.json` 追加 `{ file, kind, src?, url, title, time }`。`image/*` 才收，单张超过 10MB 不落盘。库里已有文件加上这张会超过 500MB 时报满，不删旧文件。页面取图脚本在页面里 `fetch`，`credentials: "include"`，不读 cookie、不写存储
  - `src/main/browser.ts`：`save_shot` 复用可见区 / selector 裁剪 / `fullPage` 整页（`captureVisiblePage`、`captureFullPage`、`parseScreenshotInput`），写入 `captures/`，不回 base64。`captureFullPage` 多了一个可选 tabId，不传时仍是当前标签，MCP 截图路径不变。`save_image` 走页面上下文 fetch 再落盘
  - `src/main/agent/pi-core.ts`：工具 `save_shot`、`save_image`。同一次 run 里两工具成功合计满 20 张后，下一张直接报满，不再调用保存
- 测试：先失败再补。`tests/pi-core-captures.test.ts`
  - 「截图和网页图片落盘，清单有对应记录」
  - 「Content-Type 不是图片时拒绝且不落盘」
  - 「单张超过 10MB 拒绝且不落盘」
  - 「库容超过 500MB 时报满且不自动删」
  - 「单次任务两工具合计超过 20 张时报满，不再调用保存」
  - 「页面取图脚本带上 cookie，不把凭据写进素材」

### T33

- 改动：`list_captures` 返回清单最近 20 条，空库是空数组。`systemPrompt` 在 set_file 那句后面加了同一句素材提示，step 和 auto 都有。step 的确认门原句、auto 的「直接执行」都还在，没有新的确认门
- 测试：`tests/pi-core-captures.test.ts`
  - 「空库 list_captures 返回空数组」
  - 「step 和 auto 的系统提示都要求存本机素材，存量确认句还在」
- 真机 Q17：未跑

### T34

- 没有新的会改任务走向的本地判断。决策点：无。未登记 #35
- 真机 Q17：未跑。当前窗口是改代码前开的，主进程要重启才吃到这三个工具

Q16、Q13、Q5 仍未跑。
