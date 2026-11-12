# 任务书：店小秘上架提速（脚本 / 大脑分工复核）

> 给 Cursor 审。目标不是再写一套自动化，而是判断「把熟练动作压成脚本、只留必要的大脑判断」这条路在 Sparo 里是否已经到位，还缺哪些主进程能力。

## 1. 目标

一条速卖通商品，从打开编辑页到保存复检完成：

| 指标 | 现在（全程意识系统） | 目标 |
|---|---|---|
| 大脑决策次数 | 30+ 步逐步判断 | ≤ 6 次 |
| execute 调用次数 | 一步一调，约 30–40 次 | 每阶段 1 次启动 + 1–2 次轮询 |
| 单条上架耗时 | 十几分钟，主要耗在反复试错 | 90 秒内（不含人工闸门与图片翻译后台时长） |
| 人工介入 | 频繁 | 只留 2 个闸门：付费翻译、保存前审阅 |

已经真机跑通一单（2026-11-12）：18 张图全 800 宽、6 张主图、图片翻译中文→英文、7 条自定义属性英文化、0 红字、保存成功并重载复检通过。沉淀物是技能 `strategies/skills/dxm-smt-editor-ops.json`（现 v3）。

## 2. 本次实测证据（不是推演）

在真实编辑页上用只读 / 净零操作测得：

| 结论 | 数据 |
|---|---|
| `execute` 不 await Promise，async IIFE 只返回 `{}` | `(async()=>{await sleep(300);return 42})()` → `{}` |
| 页面 job + 轮询可行 | 启动 125ms，job 在页面里跑 5008ms，轮询 6–11ms 拿到结果 |
| MCP 往返本身不慢 | 同一连接内连续 execute：6–15ms；首调 0.5–2s，偶发 12s（一次性） |
| 18 张图 × 2 次点击 = 36 次点击可在一个 execute 内完成 | gap 150ms → 5.8s；250ms → 9.5s；600ms → 23s；三次均 **0 失败**，状态可完整还原 |
| 「编辑图片」下拉 + 弹窗打开可在同一 execute 内完成 | 2.5s，弹窗标题 `批量图片尺寸`，按钮 `生成JPG图片 / 生成PNG图片 / 取消` |
| 下拉不是 DOM 里天生就有的 | 未派发指针序列时 `.ant-dropdown` 数量 = 0；派发后立即出现 |
| `.img-options-action-btn[0]` 不是「编辑图片」 | 实际顺序：`免费体验AI AI商品套图 / 添加水印 / crop编辑图片 / 导出勾选图片 / 批量 / 批量编辑图片` |
| `switch_tab` 用不了 | 新 clientId 拿旧标签 → `not_your_tab`；但 args 里带 `tabId` 的 execute 正常 |
| 隐藏标签的页面定时器仍推进 | `visibilityState=hidden` 下 800ms 定时器正常结束 |

旧技能里两条结论因此作废：

1. 「一次 execute 只能点一张 checkbox」——错。丢点击是同步 for 循环空转造成的，加 `await` 即可。
2. 「取 `.img-options-action-btn` 第一个」——错。第一个是 AI 套图按钮，会静默失败。

## 3. 目标架构（四层）

```
第 4 层  人工闸门：付费翻译确认 / 保存前审阅
第 3 层  大脑（意识）：标题英文提炼、类目取舍、价格库存重量、哪几张图真有中文、保存 verdict
第 2 层  页面 job（潜意识）：一个 execute 内跑完 open→click→wait→assert→retry，自己轮询自己
第 1 层  调用器：initialize 一次，args 直传 tabId，绝不 switch_tab
```

分工判据写死在技能 route 里：**确定性规则 → 第 2 层；需要取舍或估值 → 第 3 层。**

两套系统的互救规则：

- 脚本连续两次断言失败 → 停下跑一次只读快照，把 JSON 交给大脑重新判据。
- 大脑拿不出判据（选择器变了、弹窗不认识）→ 只读探测，改脚本再跑，禁止连点试探。

## 4. 需要 Cursor 回答的问题（请对照 src 给结论，不要只给建议）

1. `src/main/browser.ts` 的 `execute`（约 11080 行，包装在 11150 行）用 `eval` + `JSON.stringify`，因此 Promise 被序列化成 `{}`。是否应该在主进程加 `awaitPromise`（把 `__r` 识别为 thenable 后再 `await`）？加了会影响哪些既有调用方？这是本任务提速的第一杠杆。
2. 是否值得提供 `run_script(id, args)`：把一段脚本存在技能里，一次调用跑完整阶段并返回最终 JSON，失败带 `step/err`。目前只能用「启动 job + 轮询」模拟，多一次往返、且要靠脚本自己保证 finally 落结果。
3. 标签归属：新 clientId 无法 `switch_tab`（`not_your_tab`），只能靠 `tabId` 直传。是否需要「只读激活」或「按 tabId 渲染」的能力，让后台标签也能稳定跑 job？现在后台标签首调偶发 12s，用户会以为挂了。
4. `wait_for` 目前只支持 selector/text 条件。是否需要 `wait_for({ js })`，让「等后台任务完成」这类条件不必写进 job 里轮询？
5. 脚本沉淀的最大漏口：`run_skill` 对 distilled 技能只回 `scaffoldText`（`route.goal` + `pitfalls` + `contract`，`src/main/skills/runner.ts:1164`），脚本所在的 `agentPlaybook` 不会带出，只能靠 `get_skill` 取全文（`src/main/browser.ts:6783` 直接回原始 skill）。而 `route` 的 `fixed` 段只允许 `navigate / page_text / wait_for / report` 四个工具（`src/main/skills/store.ts:24`），`execute` 进不去。是否应该：① 脚本类技能 run_skill 时附带 playbook；② 允许 `fixed` 段跑 `execute`（带超时与失败返回）；③ 维持现状、约定「先 get_skill 再动手」？
6. `qa_gate` 的六项检查是否覆盖：主图恰好 6 张、全部宽度 800、自定义属性无中文、红字为 0、SKU 价格库存已填、类目已定？缺口请指出具体位置。

## 5. 交付物

- [ ] 对第 4 节六问给出结论 + 涉及文件:行号
- [ ] 若采纳第 1 问，给出 `execute` 兼容性影响面清单（哪些技能/工作流依赖「不 await」的现状）
- [ ] 若采纳第 2 问，给出 `run_script` 的最小接口草案（输入、超时、失败返回、与技能版本的关系）
- [ ] 指出技能 v3 里与代码实际行为不一致之处（重点核对 `execute`、`tabId`、`qa_gate`、`run_skill`）

## 6. 禁止事项

- 不要把付费能力（图片翻译、图片白底）做成自动放行。
- 不要按索引点「编辑图片」下拉的菜单项（同组里有「清空图片」）。
- 不要用可信鼠标坐标点 antd 按钮，也不要用 `ws[ws.length-1]` 选弹窗。
- 不要在主进程热更，也不要为了提速绕过保存前 QA。

## 7. 分期

| 期 | 内容 | 验收 |
|---|---|---|
| P1 | 按 v3 流水线重跑一单，统计大脑决策次数与 execute 次数 | ≤ 6 次决策、每阶段 ≤ 2 次 execute、90 秒内 |
| P2 | 落地 `awaitPromise` 或 `run_script` 其中之一 | 同一单耗时再降，且既有技能回归不破 |
| P3 | 把「等后台任务」抽成 `wait_for({js})` 或技能内置轮询器 | 图片翻译阶段不再靠固定 sleep |
| P4 | 单条 → 批量（同店铺多商品串行） | 批量 5 条不串味，每条都有重载复检 |
