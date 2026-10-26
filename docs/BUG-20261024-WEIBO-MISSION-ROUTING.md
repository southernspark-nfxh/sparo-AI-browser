# 微博任务跑错：病因分析与修复任务书（2026-10-24）

> 本文档统一记录：用户在 Sparo 上跑的 4 条微博相关任务的实际执行证据、根因定位（精确到代码行）、问题分析、修复方案与验收标准。
> 适用范围：本目录（`d:\download\sparo上架应用商店版`）。不要搬去原版 `D:\download\Sparo`。

---

## 0. 一句话病因

**不是功能没做完，是任务路由又跑错了：新指令被「阅读页改写捷径」吞掉、正经 research 单被「双胞胎单」顶死，采集动作从头到尾没有执行，模型只能拿手上仅有的约 4 条微博写"材料不足"的说明页交差，而任务系统把这一切当成"done"。**

---

## 1. 现象与证据

证据来源（本机数据，只读）：

| 文件 | 内容 |
|---|---|
| `%APPDATA%\sparo-store\missions.jsonl` | 工作单开/转/关流水 |
| `%APPDATA%\sparo-store\chat-memory.json` | 侧栏对话记录 |
| `%APPDATA%\sparo-store\reports\read-2026-10-24T11-5*.html` | 生成的三份阅读页 |

### 任务 ① 「打开微博」— 正常

- 单号 `m-mvmcbcds-g3afh`，navigate 一步 done，正常关单。无问题。

### 任务 ② 「利用当前热搜发一条微博」— 表面完成，实际存疑

- 单号 `m-mvmcd1hi-3ietf`。read_page done（读到热搜）、fill_form 自称 done（"已填好，发布框已回读确认一致，停在发送前"）。
- **疑点 1**：侧栏记录显示识别到的表单字段是「搜索微博 / #话题# / text_input」——这是 **s.weibo.com 搜索页的字段，不是 weibo.com 首页的发布框**。
- **疑点 2**：执行中出现一次莫名绕行——"打开 s.weibo.com 的登录地址，被站点跳回 `https://weibo.com/?wvr=5`"。
- **疑点 3**：计划里 `reply_draft` 步永远停在 running，但 fill_form 已抢先 done，步骤顺序倒置。
- 需要人工目验：当时首页发布框里是否真的有那段 175 字文案。若没有，则 fill_form 填错了位置且"回读确认"机制被骗过（回读的是它自己填错的字段）。

### 任务 ③ 「研究博主 tomkeeper 画像，最好上百条」— 有名无实

**同一句话被开了两张单（双胞胎）：**

| 单号 | 时间 | kind | 结局 |
|---|---|---|---|
| `m-mvmcgo0g-1pjnh` | 19:57:31 | **chat（误判）**，approach="按原话做事" | 跑了一次 read_page，19:58:19 close(done) |
| `m-mvmcgisj-q54g8` | 19:57:33 | research（模型正解），脑区计划 5 步含「翻页抽样上百条」 | **零执行记录，19:58:19 同时被 close(done)** |

- 最终产物《tombkeeper 微博画像》（`reports\read-2026-10-24T11-58-19.html`）的全部材料是 chat 单那一次 read_page 看到的**约 4 条微博**——findings 里模型自己写明"当前正文里能看到的主微博只有约 4 条"。
- 「研究上百条」从未发生：没有滚动、没有翻页、没有任何采集步的 turn 记录。

### 任务 ④ 「把最近 3 天微博逐条复制下来」（用户说了两遍）— 根本没进任务系统

- **missions.jsonl 在 19:58:19 之后再无任何记录**（文件最后修改时间即 19:58:19），但 chat-memory.json 记录持续到 19:59:33。
- 两句「复制 3 天微博」**连工作单都没建**，全部被「阅读页改写捷径」吃掉（见根因 1）。
- 产出的两份阅读页（`read-2026-10-24T11-58-58.html`、`read-2026-10-24T11-59-32.html`）正文内容全是免责声明："当前材料未包含原文……本页不能提供逐条复制……不编造"。
- 模型的诚实兜底（不编造）本身是对的，**但系统把"写一份说没数据的说明"当成交付完成**，而不是去执行采集或转 waiting_human 求助。

---

## 2. 根因定位（精确到代码行）

### 根因 1：阅读页改写捷径越权拦截新任务

[src/main/browser.ts](file:///d:/download/sparo上架应用商店版/src/main/browser.ts#L6294-L6297)：

```ts
const priorRead = this.priorReadPage(cleanQuotes);
if (priorRead && !routeUserGoal(text) && !isPauseText(text) && !isResumeText(text)) {
  return this.reviseReadPage(text, priorRead);
}
```

- 只要上一条助手消息带阅读页产物（[priorReadPage](file:///d:/download/sparo上架应用商店版/src/main/browser.ts#L6596-L6612)），且这句话没被 `routeUserGoal` 的正则/启发式认出（[intent-router.ts:331](file:///d:/download/sparo上架应用商店版/src/main/agent/intent-router.ts#L331)），就**直接进改写，永远到不了工作单系统**。
- [reviseReadPage](file:///d:/download/sparo上架应用商店版/src/main/browser.ts#L6637-L6697) 只拿上一页正文 + 用户这句让模型改写，**不浏览、不采集、不开单、不进 missions.jsonl**。
- 「复制最近 3 天微博」不在 routeUserGoal 的任何硬编码模式里 → 被吞。这违反 AGENTS.md 的死规则：「侧栏每一句先进工作单」。

### 根因 2：双胞胎单——启发式抢先开单，模型单被顶死

- [browser.ts:6308](file:///d:/download/sparo上架应用商店版/src/main/browser.ts#L6308) 注释自己写了：「兜底要等模型超时再跑。提前跑会先开一张启发式单，和模型单变成同一句的双胞胎。」——**这个已知的坑这次真的炸了**。
- 实际时序：19:57:31 启发式先开 chat 单（"按原话做事"），19:57:33 模型才开出 research 单（含「翻页抽样上百条」的正确计划）。
- chat 单占住 activeMission 跑了一次 read_page 就 synthesize 关单（[browser.ts:5615-5618](file:///d:/download/sparo上架应用商店版/src/main/browser.ts#L5615-L5618)），research 单同一时间被连坐 close(done)，**零 turn、零 findings**。
- 结果：正确的脑区计划被误杀，浅层的启发式单决定了全部执行深度。

### 根因 3：关单不校验交付物，"材料不足的说明"算完成

- 关单逻辑（[browser.ts:5554-5618](file:///d:/download/sparo上架应用商店版/src/main/browser.ts#L5554-L5618)）只看 `verifyContracts` 的覆盖判断，不校验**采集类步骤是否真的执行过**。
- research 单计划里的「翻页抽样」「归类统计」一步没跑，照样 close(done)。
- 改写捷径产出的"材料不足说明页"也照常回复「已写成阅读页，在窗口里打开了」，侧栏没有任何"没完成"的信号。
- 缺数据时正确的行为应该是：继续执行采集步，或转 `waiting_human` 告诉用户"我只看到 4 条，要翻页拿更多，是否继续"——而不是写免责声明关单。

---

## 3. 分析：为什么会跑错

这三个根因是同一条退化链上的三环，与此前已确认的系统性问题（脑手分离在热修压力下自发退化）一脉相承：

1. **捷径优先于系统**：阅读页改写是为了"改语气/缩短"这类轻修改加的便民捷径，但门岗条件写得太宽（只排除 pause/resume 和 router 认得的句子），把"采集新数据"这种重任务也拦进了轻通道。**脑区（开单、计划、采集）被整个绕过。**
2. **启发式抢跑脑区**：双胞胎单是设计里留了注释、留了 20 秒超时等待、但仍然发生的坑——说明防抢跑机制在实际时序下失效。启发式单 kind=chat 的浅分类（"按原话做事"）直接决定了执行深度只有"看一眼"。
3. **完成定义太松**：关单不问"计划里的采集步跑没跑"，模型写一份"材料不足"就算交付。诚实兜底文案 + 宽松的完成判定 = 用免责声明冒充交付物，用户看到的就是"说完成了但实际没有"。

**一句话：计划排给脑区看，执行偷偷走捷径，关单不做清点。**

---

## 4. 修复方案（三条，按优先级）

### 修复 1（最高优先）：阅读页改写捷径收窄

位置：[browser.ts:6294-6297](file:///d:/download/sparo上架应用商店版/src/main/browser.ts#L6294-L6297)。

- 改写捷径**只放行纯改写意图**：改语气、缩短、换标题、润色、纠错别字这类"不依赖新数据"的句子。
- 判定不许用本地正则硬编码清单（防退化红线）——**交给模型判**：把用户这句 + "上一份是阅读页"的上下文给模型，问"这句是改写上一页，还是需要新数据/新动作？"，是后者就放行去开单。
- 在模型判之前，默认放行开单（宁可多开单，不可再吞任务）。
- **验收**：上一句助手消息是阅读页后，说「把 XX 最近 3 天的微博逐条复制下来」必须开出工作单并进 missions.jsonl，绝不进 reviseReadPage。

### 修复 2：双胞胎单灭活

位置：[browser.ts:6308 附近开单时序](file:///d:/download/sparo上架应用商店版/src/main/browser.ts#L6308) + 工作单运行时 [src/main/agent/runtime.ts](file:///d:/download/sparo上架应用商店版/src/main/agent/runtime.ts)。

- 启发式兜底开单前，先等模型分类结果（注释里写的 20 秒超时纪律要真正生效）。
- 同一句 raw 已存在未关单时，**禁止再开第二张**；若第二张已开出且分类更准（research > chat），应关掉启发式浅单、保留模型单，而不是反过来连坐。
- **验收**：同一句话在 missions.jsonl 里只能有一张有效单；出现两张时，活下来的是模型分类那张，且关单记录里能看到"dup"原因的关停。

### 修复 3：关单前清点交付物与计划执行

位置：[browser.ts:5554-5618](file:///d:/download/sparo上架应用商店版/src/main/browser.ts#L5554-L5618)。

- close(done) 前校验：计划里的采集类步骤（read_page / act / 翻页）**有 turn 记录且 ok=true**，否则只能 close(incomplete) 并在侧栏明说缺了什么。
- 缺数据时禁止用"说明页"关单：要么继续采集，要么转 waiting_human 问用户（如"只读到 4 条，需要翻页抓取上百条，要继续吗"）。
- **验收**：任务 ③ 重跑时，若样本量 < 用户要求的量级，侧栏必须出现明确的缺口提示，报告页 eyebrow 标「未完成」，不允许静默 close(done)。

### 顺带核实（不单独立项）

- 任务 ② 的 fill_form：检查"回读确认"是否真的定位在 weibo.com 首页发布框（而非搜索页字段），步骤顺序（reply_draft 未完成 fill_form 先 done）是否暴露了计划状态机的乱序。

---

## 5. 红线（不许这么做）

- **不许**给改写捷径加正则关键词白名单/黑名单来区分"改写 vs 新任务"——这是又一次本地硬编码抢答脑区，违反决策点显式登记的约束。
- **不许**把"材料不足说明页"改成默认静默成功——缺数据必须显式暴露给用户。
- **不许**改 `package.json` 版本号；三条修复各自独立 commit，触及脑区（开单/关单/分类）的改动单独成 commit，不与 UI 或工具层合并。
- 改完必须 `npm test` 全绿 + `npm run typecheck` 退出码 0，再提交。
- 不要动 `docs/listings/`；不要把本修复同步到原版 `D:\download\Sparo`。

---

## 6. 验收清单（QA 用）

- [ ] 阅读页之后说「复制/采集/研究」类新指令 → 开新工作单，missions.jsonl 有 open 记录，不进改写。
- [ ] 阅读页之后说「缩短一点 / 换个标题」→ 仍走改写捷径，不开单。
- [ ] 「研究某博主，上百条」→ 只有一张单，kind=research，采集步有真实滚动/翻页 turn 记录，报告注明样本量。
- [ ] 样本不足时 → 侧栏明说缺口 + 报告标「未完成」，close(incomplete)，不静默 done。
- [ ] 发微博任务 → fill_form 的字段回读定位在首页发布框，步骤顺序不倒置。
- [ ] `npm test` 全绿，`npm run typecheck` 退出码 0。

---

## 附：关键时间线（2026-10-24 晚，本机 Asia/Shanghai）

| 时间 | 事件 |
|---|---|
| 19:52-19:55 | 任务② 发博：读热搜 done → 填表自称 done（字段疑为搜索页） |
| 19:57:31 | 任务③ 启发式抢开 chat 单 `m-mvmcgo0g-1pjnh` |
| 19:57:33 | 模型开出 research 单 `m-mvmcgisj-q54g8`（正确计划 5 步） |
| 19:57:51 | chat 单 read_page 一次（约 4 条微博） |
| 19:58:19 | 画像报告落盘；两张单同时 close(done)，research 单零执行 |
| 19:58:19 之后 | missions.jsonl 再无记录 |
| 19:58:58 / 19:59:32 | 任务④ 两次「复制 3 天微博」被改写捷径吞掉，各产出一份"材料不足"说明页 |

---

## 附：修复验收记录（2026-10-24 晚）

### 两处事实更正（落地前已核对）

1. **chat 单不是 20 秒兜底开出来的。** `m-mvmcgo0g-1pjnh` 由 `applyTurn` 同步写入底账，12ms 后进入执行；模型单 `m-mvmcgisj-q54g8` 于 2.5s 后由 `applyTurnAsync` 写入，零执行。两张单在 8ms 内先后被记 done，后一张是收尾连坐。
2. **关单块本身区分 done/incomplete。** 把「没跑」判成完成的真凶是 `verifyContracts` 的「回答很长就算覆盖」叠加连坐关单。

### 三笔提交（各自独立，未推送）

| commit | 内容 | 验收 |
|---|---|---|
| `2ab4c32` | 阅读页之后默认开单，只有模型明确答 `rewrite` 才改写；无模型/超时/答非所问一律开单；无用户原话词表 | ✅ diff 与测试（`tests/read-rewrite.test.ts`，含"提示词不含改写词清单"断言） |
| `0ed59c1` | `holdModelTurn`：模型分类期间启发式不落底账；`adoptModelMission` 把同句浅单记 `dup`；`preferredMission` 改走更深的开着那张 | ✅ diff 与测试（`tests/mission-journal.test.ts`） |
| `72d0c44` | `unmetPlanSteps`：采集步无成功观察不得 close(done)；侧栏带缺步说明，阅读页眉标「未完成」；浅单收尾不连坐深单（`journalCloseUtterance` origin/depth 守卫） | ✅ diff 与测试（`tests/kernel.test.ts` 关单清点、连坐测试） |

### 复跑结果

- `npm run typecheck`：退出码 0。
- `npm test`：56 个文件、478 项全过（含新增 3 组用例）。复跑时间 20:51。

### 遗留观察（不阻塞本次验收）

- 预览入口 [browser.ts:4757](file:///d:/download/sparo上架应用商店版/src/main/browser.ts#L4757)（`hands:false`）里 `applyTurn` 仍会先落一张启发式单——它早于 `applyTurnAsync` 拿锁，靠 `adoptModelMission` 事后记 `dup` 兜底。主防线有效，此处留作观察。
- 任务② 发博：底账显示 fill_form 自称填入并回读、后续页面文字是首页发布区，但「175 字是否真的在输入框」底账证明不了，需下次人眼目验。

### 状态

验收通过，可以推送。推送前注意：`git status` 里有未跟踪文件（本 bug 文档、QA 报告等），推送时用具名 add，不要 `git add -A`。
