# 给 Trae 的完整接手稿 · Sparo Agent 大脑

把**本文件全文**贴给 Trae。不要只贴摘要。读完再改代码。不要扫整个 `src/`，按本文文件地图打开。

---

## 0. 你是谁、你在哪、先干什么

你在控制 **Sparo 商店版**：本机专业 Agent + 工作浏览器。

- 口号：*会动手的 AI 浏览器 — 发送前你确认。*
- 工作区：`D:\download\sparo上架应用商店版`
- 这是**主线**。原版 `D:\download\Sparo`（3920 / `%APPDATA%\sparo`）只同步侧栏能力，**禁止把云订阅搬过去**。
- 对外版本 **0.1.17**（`package.json`）。任务书正文仍写 v0.3.5，大脑代码已经超前，以本文和测试为准。
- 数据：`%APPDATA%\sparo-store`
- MCP：`http://127.0.0.1:3921`（不是原版 3920）
- 云端模型走独立代理。**不要把云端 Key 写进客户端。**
- 主进程不热更。改 `browser.ts` / agent 后必须重启。安装包不会自动更新。
- 不要改 `docs/listings/`（提审另做）。
- 回复用简体中文。代码注释和提交说明用中文。未经用户明确要求不要 git commit。

开发命令：

```text
npm run start          # 调试
npm test               # vitest run，应对 38 files / 316 tests 全绿
npm run dist           # Windows 安装包 release\Sparo-Setup.exe
GET http://127.0.0.1:3921/health   # 可选 MCP
```

人用安装包，不要让顾客开终端。改完侧栏必须自己点通再给人验收。

---

## 1. 上一任用白话交代的进度（必须保留）

上一任对标 Hermes（Hermes=100），锁定的病根不是「某几个 bug」，而是：

> **侧栏大脑无法分析、无法区分问题，所以无法拆解、无法绑定工具。**  
> 要的是会听懂、会拆、会听见用户需要的 Agent，不是正则傻瓜。  
> 可以参考 Hermes / 开源，但 **不要整包搬 prime-agent（那是编码 Agent 的身体）。**

爬坡过程（用户多次说「继续」）：

| 刀 | 能力 | 状态 | 对标粗分 |
|---|---|---|---|
| 1 | 听整句、拆交付物 | 已落地 `brain/understand.ts` | ~50 |
| 2 | 模型只从合法菜单挑下一步 | 已落地 `kernel/reasoner.ts` | ~58 |
| 3 | 看完一页再改题 / 换查法 | 已落地 `brain/reconsider.ts` | ~55→60 |
| 4 | 用已有 cap 组合下一步 | 已落地 `composeStep` | ~60 |
| 5 | 失败只在登记站点表里换站 | 已落地 `brain/sites.ts` | ~65 |
| 6 | 页上事实写回工作单、按约束验收 | **未写 `absorb.ts`** | 下一刀 |

整颗脑大约 **60–65 / 100**。差的不是再堆正则，而是：

1. 还不能发明新问题类型（只能在已登记交付物 / cap / 站点里组合）。
2. 看见页上结果后，不会判断「这页到底答没答上用户的约束」（预算 500、不要机场）。
3. `observe()` 只追加 `findings`，不把店名/价格写回工作单。

**最后一次全绿：** `npx vitest run` → 38 files / **316 tests**（约 2026-09-15 23:28）。之后没有 commit 要求。工作区有大量未提交改动，不要擅自 commit。

上一任原话交接：

- 站点表已落地并测过。
- 接着本该做「观察回填」：读完页面把事实写进工作单，再决定停还是换手。
- 被用户打断，改口：形成日志、换方式开发（就是现在这份 Trae 稿）。
- 死规则、文件地图、测试命令、禁区都要带上。

---

## 2. 产品是什么

顾客以前在浏览器里反复点（订酒店、买机票、查新闻、查路线），现在改成：**一句话说清目标，Sparo 打开结果页并读回来。**

付钱、登录、验证码仍由人在同窗点。不要在城市弹层 / 热门城市格子上循环空点。

原则：

- 先本地解析（站点 + 地点 + 日期），再走结果页 URL。
- 用户点名哪个站就去哪个站，不要默认抢走携程。
- 读页用 `page_text`，不要用 `snapshot` 当正文。
- 侧栏每一句先进工作单：有未关的单就续跑；新开时模型只填槽，不能选 ask。
- 缺的是合法空槽才问；省名先出思路再动手；吃喝玩接上一趟；「我打算」不是城。
- **死规则：** 比价 / 选品 / 筛选 / 对比 / 研报必须出报告页并在窗口打开；侧栏只留一句 + 卡片。禁止堆对照表。不要点进详情循环。吃喝玩不是筛选报告。
- 识图：侧栏粘贴/拖图。纯文本模型降级省略附图。
- 云端：设置里「自己的 Key / 云端模型」；一句对话一个 `task_id`。已登录后点套餐在本窗口付款，不要甩到 Chrome。

Sparo 本身是 Agent。浏览器是身体。MCP 只是对外再露一双手。操纵的是用户正在看的那一扇窗。

---

## 3. 仓库目录（不要扫 `tmp-*` / `node_modules` / `out` / `release`）

根目录里有大量 `tmp-*.mjs`（上架填表一次性脚本），**不要改、不要当产品代码。**

```
D:\download\sparo上架应用商店版\
├── AGENTS.md                      # 30 秒路径、禁区。先读
├── CHANGELOG.md                   # 对外 0.1.17
├── package.json                   # name: sparo-store, version 0.1.17
├── electron.vite.config.ts
├── electron-builder.yml
├── vitest.config.ts
├── tsconfig.json
├── README.md / STORE.md / LICENSE / SECURITY.md / llms.txt
├── assets\                        # 品牌图、安装图标
├── resources\
├── qa-screenshots\
├── docs\                          # 产品与工程文档，见 §4
├── scripts\                       # 开发/验收/QA 脚本，见 §4
├── strategies\skills\             # 本机技能包 JSON
├── tests\                         # vitest，与 src 对应
├── src\
│   ├── main\                      # Electron 主进程（脑 + 手 + MCP + 云闸门）
│   ├── renderer\                  # 壳 UI
│   │   ├── shell.html             # 标签栏 + 侧栏。页面洞 #pageHole
│   │   └── i18n.ts
│   └── shared\
│       ├── i18n.ts
│       └── types.ts
├── out\                           # 构建产物，勿改
├── release\                       # Sparo-Setup.exe，勿当源码
└── node_modules\
```

### 3.1 `src/main/` 主进程

```
src/main/
├── index.ts                 # 启动：用户目录 sparo-store、建窗、MCP :3921
├── browser.ts               # 核心身体：标签、点击填写、handleChat、executeMission
├── browser-helpers.ts
├── paths.ts                 # storeConfigDir → %APPDATA%\sparo-store
├── features.ts
├── preload.ts / shell-preload.ts
├── page-scripts.ts          # 注入页内脚本
├── page-context-menu.ts
├── mcp-server.ts            # Streamable HTTP + Bearer
├── mcp-security.ts
├── agent-connect.ts         # 「复制给 Agent」真程序路径
├── downloads.ts / history.ts / oauth-popups.ts / cdp-frames.ts
│
├── agent\                   # ★ 侧栏大脑。本轮主改区。详见 §5
├── tools\                   # MCP 工具 → 浏览器方法
│   ├── index.ts             # 工具表
│   ├── navigate.ts / click.ts / fill.ts / snapshot.ts
├── analyzer\                # 通用填表：analyze_page → execute_primitives
│   ├── execute-primitives.ts / match.ts / datetime.ts / strategy-cache.ts / types.ts
├── skills\                  # run_skill
│   ├── runner.ts / store.ts
├── cloud\                   # 云订阅闸门。Key 不进客户端
│   ├── auth.ts / session.ts / quota.ts / config.ts
│   ├── pricing.ts / request-body.ts / validate.ts
├── settings\                # llmMode: byok | cloud
│   ├── store.ts / llm-url.ts
├── profile\                 # 本机画像、侧栏记忆
│   ├── store.ts / signals.ts / chat-memory.ts
├── learning\                # 卡住就问；经验只留本机
│   ├── store.ts / help.ts / apply.ts / detector.ts / types.ts
├── cs\                      # 客服半自动：只填草稿，不代点发送
│   ├── service.ts / draft.ts / intent.ts / scan-script.ts / types.ts
├── envs\                    # 指纹 / singbox 代理（高级）
├── sessions\                # cookie 迁移
├── bookmarks\
├── workflows\               # listing-playbook、dianxiaomi（店小蜜默认关）
└── qa\
```

### 3.2 `src/main/agent/` ★ 大脑（按层读）

```
src/main/agent/
├── types.ts                 # Brief / SlotId / MissionState / IngestKind。脑和手共用
├── place.ts                 # 城/省/不是地点。「我打算」不是城
├── extract.ts               # 事实层：城、预算、极性（只要/别查/已经订）。先抽这里再定 kind
├── slots.ts                 # 合法槽：origin / origin_confirm / destination / start
├── intent-router.ts         # 粗路由：行程/出行/打开+后半句/读页/填表/发布
├── stub.ts                  # 本地意图 → ChatAction（手，不是脑）
│
├── brain\                   # ★ Hermes 级分析器（本轮新写）
│   ├── index.ts             # 再导出
│   ├── understand.ts        # 听整句，拆交付物
│   ├── reconsider.ts        # 观察后改题 / composeStep / nudge
│   └── sites.ts             # 合法站点表、换站、点名锁站
│
├── kernel\                  # 内核门面：工作单 + 推理 + 验收
│   ├── index.ts             # thoughtFor / observe / kernelTick / 再导出
│   ├── reasoner.ts          # 一次只挑下一步；legalNextSteps；模型不能 ask
│   ├── verify.ts            # observationCovers / verifyContracts。酒店页 ≠ 餐厅
│   └── caps.ts              # CAP_REGISTRY 手的登记表
│
├── runtime.ts               # applyTurn：开单/续跑/补槽/取消。侧栏唯一入口分类
├── loop.ts                  # AgentGoal / compileHands / analyzeGoal / synthesizePrompt
│                            # planner.ts 已删除，不要救回来当脑
├── travel.ts                # 酒店/机票/火车结果页 URL
├── trip-plan.ts             # 往返/出差拆段
├── mission.ts               # 比价/调研/吃喝玩等多步日常
├── research-report.ts       # 「值不值得」等必须走报告
├── report-html.ts           # 手册 HTML，窗口打开
├── experience.ts            # 复盘写入本机，脑还没真正用起来
├── remember.ts / vision.ts / feishu.ts / deepseek.ts
```

**不存在的文件（下一刀才写）：** `src/main/agent/brain/absorb.ts`、`tests/absorb.test.ts`

### 3.3 `docs/` 先读这些，不要扫整个 src

| 文件 | 干什么 |
|---|---|
| `../AGENTS.md` | 30 秒路径、禁区 |
| `AGENTS.md` | 连 MCP、侧栏闭环 |
| `ARCHITECTURE.md` | 模块、页面洞 |
| `PRODUCT.md` | 商店定位，不是任务书 |
| `PRODUCT-TASKBOOK.md` | 现行任务/QA（正文滞后；大脑以本文为准） |
| `CLOUD-SUBSCRIPTION.md` | 云订阅；Key 不进客户端 |
| `PRICING.md` | 点数货架 v4 |
| `API-KEYS.md` | 自己的 Key |
| `INSTALL.md` | 人怎么装 |
| `VISION.md` | 识图 |
| `PUBLISHING.md` | 发小红书，禁止循环 fill |
| `UNIVERSAL-ANALYZER.md` | 通用填表 |
| `CUSTOMER-SERVICE.md` | 客服草稿 |
| `HERMES-PLAYBOOK.md` | 旧约定：Sparo=手，Hermes=脑。本轮是把脑做进 Sparo |
| `SKILL-FORMAT.md` | 技能包字段 |
| `SKILL-COMMUNITY-M2.md` | **未开工**，M1 人测过完再开 |
| `MCP-API.md` | 工具表 |
| `listings/` | **不要改** |

### 3.4 `tests/` 与大脑相关

```
tests/
├── brain.test.ts            # 听整句：云南+旅行社、展览+酒店、值不值得
├── kernel.test.ts           # 纽约必须动手不 ask；住完下一步餐厅；预算/排除
├── reasoner.test.ts         # 合法菜单、模型选 ask 无效
├── reconsider.test.ts       # 补 report、锁交付物、失败组合新查询
├── sites.test.ts            # 锁携程、北京换途牛、纽约 booking→airbnb、yahoo 丢掉
├── extract.test.ts          # 每晚500、不要机场、已经订了、便宜点续跑
├── runtime.test.ts          # 工作单开/续/改
├── place.test.ts / loop.test.ts / travel.test.ts / trip-plan.test.ts
├── research-report.test.ts / mission.test.ts / intent-router.test.ts
└── （其余：cloud / i18n / settings / vision / feishu / skills …）
```

回归至少跑：

```text
npx vitest run tests/brain.test.ts tests/kernel.test.ts tests/reasoner.test.ts tests/reconsider.test.ts tests/sites.test.ts tests/extract.test.ts
npx vitest run
```

### 3.5 `strategies/skills/`

本机 `run_skill({ query })`。生活（天气/电影/快递/租房/泰国…）+ 调研（比价/论文/1688/微博热搜…）+ 小红书/飞书/客服。命名与字段见 `docs/SKILL-FORMAT.md`。本轮大脑爬坡**不是**加技能包。

---

## 4. 运行时结构（改脑按这个走）

```
Electron 窗
├── Renderer  src/renderer/shell.html     标签 + 侧栏
└── Main      src/main/browser.ts         handleChat 队列
                  │
                  ├─ agent/runtime.ts     applyTurn 开单/续跑
                  ├─ agent/brain/*        听懂 / 重分类 / 换站
                  ├─ agent/kernel/*       挑下一步 / 验收
                  ├─ agent/loop.ts        编译手、合成提示
                  └─ runLoopStep          真正打开网页、page_text
                        │
                        ├─ tools/*        MCP 同一双手
                        └─ mcp-server.ts  :3921 对外
```

侧栏一句话：

```text
用户原话
  → applyTurn / applyTurnAsync          开单或续跑（有未关的单就续跑）
  → understand + extract + slots        听懂、填槽、封工作单
  → compileHands                        每块交付物至少一只手
  → executeMission 循环（≤8）           browser.ts ~3636
        thoughtForAsync                 合法菜单挑下一步（nudge 可顶上）
        runLoopStep                     按 cap + step.site 打开结果页
        observe                         目前只追加 findings（缺口）
        reconsiderMission               改题 / 组合 nudge / 换站
  → synthesize + verifyContracts
  → 调研/多块交付：写 HTML 报告并打开窗口；侧栏一句 + 卡片
```

`browser.ts` **只执行手，不在那里做决策。** 决策在 kernel / brain / runtime。

---

## 5. 关键类型（抄自源码，改时保持兼容）

`src/main/agent/types.ts`

```ts
BriefKind = trip | eatplay | travel | research | page | publish | form | chat | control
KnownBlock = stay | food | sights | itinerary | flights | trains | report
SlotId     = origin | origin_confirm | destination | start   // 模型不能发明新槽
MissionState = blocked | propose | running | waiting_human | done | cancelled
IngestKind = protocol_pause | protocol_resume | cancel | confirm | revise
           | slot_fill | side | continue | amend | new
```

`BriefKnown`：`origin / region / cities / start / end / hotelPriceMax / hotelMinRating / exclude / prefer / audience / cheaper / hotelAvoid`

`src/main/agent/loop.ts`

```ts
AgentGoal     = { raw, intent, kind, deliverables, known, unknown, decision, ask?, approach, ... }
DeliverableId = stay | food | sights | itinerary | flights | trains | report | page | form | video | answer
LoopCap       = hotel_search | flight_search | train_search | search_read | video_search
              | read_page | fill_form | trip_plan | mission | feishu | run_skill
              | reply_draft | print | navigate | act | synthesize
AgentStep     = { id, cap, label, covers, query?, city?, from?, to?, date?, site?, ... }
StepFinding   = { step, text, url, ok, doc? }
```

`src/main/agent/runtime.ts`

```ts
ActiveMission = { id, raw, goal, plan, findings, state, blockedSlot?, ask?, nudge? }
```

`src/main/agent/kernel/caps.ts` 登记的手（不能发明新 cap）：

| cap | 覆盖 |
|---|---|
| hotel_search | stay |
| flight_search | flights |
| train_search | trains |
| search_read | food, sights, report |
| video_search | video |
| read_page | page |
| fill_form | form |
| trip_plan | stay, flights, itinerary |
| mission | report, food, sights |
| run_skill | form |
| feishu / reply_draft / print / navigate | answer |
| act | answer, food, sights（兜底） |

`src/main/agent/brain/sites.ts` 合法站：

| 车道 | id |
|---|---|
| hotel | ctrip, tuniu, booking, airbnb |
| flight | ctrip, qunar, kayak, gflights |
| train | 12306, ctrip |
| search | baidu, bing, google（自动回退默认 baidu→bing，不自动谷歌） |

国内酒店失败：ctrip → tuniu。国际：booking → airbnb → ctrip。点名站 `lockedSite` 锁死。表外站（yahoo）丢掉。

---

## 6. 已落地文件要守住的行为

### `brain/understand.ts`

混合原话拆多块交付物。「顺便」「还有」「值不值得」「展览+附近酒店」不能只吃第一个关键词。有模型时模型先拆，本机校正地点和合法槽。

### `kernel/reasoner.ts`

一次只决定下一步。`legalNextSteps` + `preferLegalNext`：模型只能点菜单。模型写 ask 无效。酒店查完下一步是餐厅，不是收工。

### `brain/reconsider.ts`

观察后：对照长文可补 `report`。酒店页不能改成餐厅/对照题。原话点名的交付物锁死。没说机票不能加 flights。`composeStep` 只用登记过的手。同一块失败两次且没有新 query/site，停止自动换查。`ActiveMission.nudge` 给下一步。

**已知坑：** `reconsiderLocal` 里「酒店页 + ok」直接 `same:true`。页上酒店对不上预算也不会重试。absorb 必须改这一处，但仍然不许酒店页补 food。

### `brain/sites.ts` + `browser.ts` `runLoopStep`

`AgentStep.site` 已接入酒店/机票/火车/检索。`isLegalSite` 校验后才用。

### `kernel/verify.ts`

`observationCovers`：酒店 URL 不能盖 food/sights。**现在的洞：** 只要有「酒店」字样就盖 stay，不管 `hotelPriceMax` / `hotelAvoid`。

### `extract.ts`

已经能从用户原话抽出 `hotelPriceMax`（每晚 500 / 500 元以内）、`hotelAvoid`（不要机场）、`cheaper`、`exclude`（已经订了）。这些在 `goal.known` 里，验收没用上。

### `observe()`（`kernel/index.ts`）

只做 `findings: [...mission.findings, finding]`。不写回 `known` / `found`。

---

## 7. 产品死规则（破了就不算完成）

每条都要有测试挡回去。

1. 模型不能投票 ask。合法空槽才问人。
2. 「我打算」不是城。
3. 酒店列表 ≠ 餐厅。酒店 URL 上的「餐厅」不能补 food/sights。
4. 点名站不抢。「在携程查…」失败也不许改去途牛。
5. 比价 / 选品 / 筛选 / 对比 / 研报必须出报告页并打开窗口。禁止对照表堆进侧栏。
6. 不要点进一堆详情循环。读列表即可。
7. 吃喝玩不是筛选报告。
8. 云端 Key 不进客户端。一句对话一个 task_id。
9. 付钱 / 登录 / 验证码由人在同窗点。侧栏草稿不代点发送。
10. 不要整包复制 prime-agent。要的是会分析的脑。
11. 不要改 `docs/listings/`。
12. 不要恢复 `planner.ts` 当唯一的脑。
13. 不要用 snapshot 当正文。
14. 不要循环 fill 小红书标题/正文。
15. 不要发明新 kind、新 cap、新槽（除非用户明确要求）。
16. 商店渠道包不要提价格 / 付款 UI（`STORE_CHANNEL=msft`）。

---

## 8. 你现在要做的下一刀：`absorb`

目标：看见一页之后，判断这页是否真的答上了用户的约束，再决定停、换查法、或换站。

### 8.1 建议新文件

- `src/main/agent/brain/absorb.ts`（不要 import `verify.ts`，避免循环）
- `tests/absorb.test.ts`

接线：

- `verify.ts` 的 stay 覆盖改走 absorb 的判断；`verifyContracts` 传入 `hotelPriceMax / hotelMinRating / hotelAvoid`
- `reconsider.ts`：酒店页仍不许补 food；但「ok 却对不上约束」可以 `retry`（换 query，或按站点表换站）
- `kernel/index.ts` 的 `observe()`：`goal = applyAbsorb(goal, findings)`
- `brain/index.ts` 导出 absorb
- 点名站 + 对不上：`site` 仍是锁死的站，只改 query，不换站
- 无约束旧用例必须继续绿

### 8.2 建议行为

1. 从页文抽住宿实体：名、每晚价、评分、是否命中 `hotelAvoid`。
2. 有预算/评分/避开时，必须有**对得上的一条**才算 stay 覆盖。没抽出价格不要误杀（图上的价可先放过）。
3. 对不上：`nudge` 查询带「500元以内」「避开机场」；没点名则按 `sites.ts` 换站。
4. 酒店页仍然不许补 food / sights / report。
5. 对得上的店名写入 `goal.found`（或同等字段，不要污染 BriefKnown 的槽合并）。
6. 无约束回归：纽约希尔顿 984 仍算住；「只查酒店」1200 仍汇总。

### 8.3 建议测试

- 预算 500 + 页上 984/1200 → stay 未覆盖，retry 带「以内」
- 预算 500 + 每晚 388 → 覆盖
- 不要机场 + 全是机场店 → 未覆盖
- 原话点名携程 + 对不上 → `site === "ctrip"`
- 无约束回归（kernel / reconsider 现有用例全绿）

### 8.4 不要在这一刀做

发明新问题类型、新 cap、新槽、搬云订阅、改 listings、commit（除非用户要）、恢复 planner.ts。

---

## 9. absorb 之后的差距（先别做，知道即可）

1. 不能发明新问题类型。
2. 没有「这条路失败过」的持久世界模型（`experience.ts` 有写入，脑没用起来）。
3. 站点表有限，新站必须人登记。
4. 技能社区 M2 未开工。

---

## 10. 改完怎么验

```text
npx vitest run tests/absorb.test.ts tests/brain.test.ts tests/kernel.test.ts tests/reasoner.test.ts tests/reconsider.test.ts tests/sites.test.ts tests/extract.test.ts
npx vitest run
```

必须保持 316+ 全绿。侧栏相关按钮如果动了 UI，自己点通：点得到、下一步在原地出现、控制台无报错。

调试：`npm run start`。主进程改完重启。

---

## 11. 禁区再念一遍

- 云订阅 / 云端 Key / 价格文案不进客户端，不进 `docs/listings/`。
- 原版目录不同步云订阅。
- 不要把「看起来像按钮」的半成品丢给人当测试员。
- 未经用户要求不要 commit / push / amend。

先读：`AGENTS.md`、本文、再打开将要改的那几个 ts。不要扫整个 `src/`。
