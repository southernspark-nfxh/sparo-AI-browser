# 采集死循环 / 静默收尾 / 白屏：病因分析与修复任务书（2026-10-24 第二单）

> 承接 [BUG-20261024-WEIBO-MISSION-ROUTING.md](./BUG-20261024-WEIBO-MISSION-ROUTING.md)（路由三修复已推送，`2ab4c32`/`0ed59c1`/`72d0c44`）。
> 本文档锁定 2026-10-24 晚「王海林 3 天微博复制」任务暴露的**四个新问题**——它们不在上一单覆盖范围内。
> 适用范围：本目录（`d:\download\sparo上架应用商店版`）。四条修复各自独立 commit，触及脑区的改动单独成 commit。

---

## 0.5 评审修订（2026-10-24 第二轮 · 本节优先于下文冲突处）

1. **P3 根因修正：不是静默关单，是早退错杀。**「已打开 weibo.com。」全代码只有两个出处——`browser.ts` 的 `namedSiteIsOpen` 早退分支（`已打开 ${goal.site}。`）与 `userDidNotAskToRead` 早退分支（`已打开 ${live.site}。`）。两处都回写侧栏、都 close(done)，但都**绕开 verifyContracts / unmetPlanSteps**——72d0c44 只给正常关单路径装了清点，旁路还敞着，这也解释了没出报告（走不到汇总块）。修复方向改为：存在未交付 required 交付物（report/form）或计划还有 running 步时，这两条早退旁路不许关单，继续跑或转 incomplete；**任何 close(done) 路径都过同一套清点**。动手前先验证时序：为什么第三 turn 才命中而不是开单即命中（`namedSiteIsOpen` 判定条件、`goal.site` 赋值时机），验证不过不许改。
2. **P1 落点**：重判提示词写进 understand 的 coverage 判定同一处（P2 已落地 `coverage` 机制），不许搞两套分类口径。
3. **P2 落点**：先定位滚动采集是模型驱动工具循环还是确定性采集手。若是前者（repeatStop 在 deepseek.ts 提示很可能是），增量检测实现为**工具结果附增量标注**（page_text 返回「较上次 +N 字」）交脑区决策，不写本地滚动计数器。
4. **P4**：采用「restore/resize 事件重置计数」，不取消 8 次上限。
5. **验收顺序修订**：① 先 `npm run start` 过 P2 任务书 §6 八步 QA（P2 两笔 `a10fa07`/`93ad139` 已落地，未推送、未打包）；② `npm run dist` 重打包，连上一单三笔 + P2 一起验收（安装包还是 10-22 的，距 HEAD 已 7 个 commit）；③ 再开本单四条。行号以动手时的 HEAD 重核。

---

## 0. 一句话病因

**任务死于「分类错 → 采集死循环 → 静默关单」三连，白屏是同时存在的独立布局 bug 把整个失败过程遮住了——用户连"任务死了"都看不见。**

注意：出问题的运行包是 2026-10-22 18:50 打的安装包（`release\Sparo-Setup.exe`），上一单的三笔修复不在其中。验收上一单必须先 `npm run dist` 重打包。

---

## 1. 事故还原（底账实证）

任务：20:55:22「帮我把微博博主"王海林"3天内的所有微博内容都复制一下」，单号 `m-mvmeiuxj-2sc9n`。

证据来源（本机只读）：

| 文件 | 内容 |
|---|---|
| `%APPDATA%\sparo-store\missions.jsonl` | 该单 6 条流水（open×1、turn×4、close×1） |
| `%APPDATA%\sparo-store\chat-memory.json` | 侧栏最后六条消息 |
| `%APPDATA%\sparo-store\diag\crash.log` | 20:51:24 `shell-unresponsive sidebar`（当日累计 10 次） |
| `%APPDATA%\sparo-store\reports\` | **20:55 之后无任何新报告**（最新一份停在 20:38:40） |

时间线：

| 时间 | 事件 |
|---|---|
| 20:51:24 | 壳层渲染进程假死，`onShellUnresponsive` 拉回窗口 → 子视图被拉成整窗，白屏开始 |
| 20:55:22 | 开单，kind=**page**，交付物=填表+读懂当前页（**无 report**） |
| 20:55:36 | read_page done：读到的是 **5 月 14 日**的旧微博；模型自己注明"无法确认哪几条属于 3 天内" |
| 20:56:46 | act done：滚动采集陷入 End 键连按，被 repeatStop 掐断（"你陷入了重复工具调用。请停止操作"） |
| 20:56:53 | read_page running（再无下文） |
| 20:57:08 | **close(done)**——计划里 read_page 仍 running、两个 fill_form 未跑 |
| 收尾 | 侧栏最后一句停在「已打开 weibo.com。」，**无总结、无报告、无缺口提示** |
| 用户操作 | 最小化再弹出 → 窗口尺寸变化触发重排 → 白屏消失（反向证实整窗拉伸） |

---

## 2. 四个新问题（精确到代码行）

### P1 分类错：「复制 N 天内容」被判成填表单，交付物里没有 report

- 底账：goal.kind=`page`，deliverables=[form, page]，脑区计划末两步是"把正文汇总填入表单/复制表单中的全部内容"。
- 后果：汇总路径（[browser.ts:5566-5572](file:///d:/download/sparo上架应用商店版/src/main/browser.ts#L5566-L5572)）只在 kind=research 或有 report 交付物时才写报告页——这单**结构上就不可能出报告**。
- 落点：分类/理解层（`applyTurnAsync` → [src/main/agent/brain/understand.ts](file:///d:/download/sparo上架应用商店版/src/main/agent/brain/understand.ts)）。

### P2 采集死循环：无限滚动页连按 End，无新内容也不换招

- 底账 act 步原文：`pressKey End` 连续多次、`page_text 3465 chars` 无增长，被 [deepseek.ts:500/586](file:///d:/download/sparo上架应用商店版/src/main/agent/deepseek.ts#L500) 的 repeatStop 掐断。
- 后果：采集停在第一屏（5 月微博），掐断后**没有备选策略**（换入口/换站/翻页/宣告材料不足），直接滑向收尾。
- 落点：滚动采集手的实现（act 执行层）+ 掐断后的回话协议。

### P3 静默收尾：close(done) 可以不在侧栏留任何交付消息

- 底账：20:57:08 close(done)，但 chat-memory 最后一条是「已打开 weibo.com。」——**收尾那句人话根本没写进侧栏**。
- 说明存在一条"关单但不回写 chatLog"的路径（正常汇总路径会在 [browser.ts:5619](file:///d:/download/sparo上架应用商店版/src/main/browser.ts#L5619) 推 reply；这单没走或被跳过）。
- 落点：需要找出这条静默关单路径并堵死。

### P4 白屏守卫没兜住：修 8 次就放弃，壳假死拉回后不补排

- [browser.ts:2243-2248](file:///d:/download/sparo上架应用商店版/src/main/browser.ts#L2243-L2248)：`chromeCoverFixes > 8` 直接 return，注释自承"直到用户缩放窗口"。
- [browser.ts:1535-1543](file:///d:/download/sparo上架应用商店版/src/main/browser.ts#L1535-L1543)：`onShellUnresponsive` 调 `ensureWindowVisible` 拉回窗口后**没有补 `armChromeGuard`**——而 restore/resize 正是触发整窗拉伸的时刻。
- 用户实证：最小化再弹出（尺寸变化 → 重排）白屏即消失，说明重排本身有效，是守卫触发时机不全。

---

## 3. 修复方案（四条，各自独立 commit）

### 修复 P1：采集类请求必须带 report 交付物

- 模型分类后加一道**回炉校验**：goal.raw 含采集规模语义（"N 天 / N 条 / 全部 / 上百条 / 逐条"）而 deliverables 无 `report` 时，把 goal 退回模型重判（提示：用户要的是可翻阅的产物，不是填表）。
- **红线**：本地只做"打回重判"，不得自行改写 kind/deliverables——分类是脑区决策，登记在案，禁止本地正则抢答。

### 修复 P2：滚动采集带增量检测，掐断后回话给脑区

- 滚动采集手每次滚动后对比页面文本长度/DOM 节点数：**连续 3 次无增长立即停手**，把"已采到 N 条、只覆盖到 M 月 M 日"作为 finding 回给脑区。
- 脑区收到"无增量"后必须二选一：换策略（换入口/换站/翻页），或转 `waiting_human` 报告材料边界；**禁止带着空采集进汇总**。
- repeatStop 掐断后同理：掐断消息要转成 finding 回流，而不是让任务空转收尾。

### 修复 P3：关单必须有声

- 任何 `close`（done/incomplete/error/dup 除外）都必须向 chatLog 写一句人话：交付了什么 / 缺哪步 / 卡在哪。
- 把这条加进关单校验：找到并堵住今晚这条"不回写 chatLog 的关单路径"（从 close 记录 20:57:08 反查调用栈）。
- 修复 72d0c44 的「未完成」提示已有雏形，本条要求**所有关单原因**都有收尾消息，不只是 incomplete。

### 修复 P4：白屏守卫补全触发时机

- `onShellUnresponsive` 拉回窗口后补 `armChromeGuard()`（restore 后 100/450/1200/2500ms 补排）。
- `chromeCoverFixes` 的 8 次上限：窗口 restore/resize 事件时重置计数；或干脆取消上限（守卫本身是幂等重排，无副作用）。
- 窗口 `restore`/`resize` 事件后统一补一轮重排——用户已实证这条路能救回来。

---

## 4. 红线

- 不许给 P1 加本地关键词分类表（"复制→research"这种映射）——只能打回模型重判。
- 不许让滚动采集无限重试——无增量必须停手回话，决定权交脑区。
- 不许静默关单——dup 关单除外（已在上单处理）。
- 四条修复各自独立 commit；P1/P2/P3 触及脑区，各自单独成 commit，不与 P4（布局层）合并。
- 不改 `package.json` 版本号；不动 `docs/listings/`；不同步到 `D:\download\Sparo`。
- 每笔提交前 `npm test` 全绿 + `npm run typecheck` 退出码 0。

---

## 5. 验收清单（QA 用，需重打包后真人复测）

- [ ] 「帮我把博主 XX 最近 3 天的微博逐条复制下来」→ kind 带 report 交付物，最终出报告页，报告注明实际采到的条数与时间范围。
- [ ] 无限滚动页采不到新内容时 → 3 次无增量停手，侧栏明说"只采到一屏/到某日期"，转 waiting_human 或换策略，不死循环。
- [ ] 任何任务结束（成功/失败/材料不足）→ 侧栏最后必有一句收尾人话；翻 chat-memory 无静默关单。
- [ ] 壳假死拉回窗口后 → 顶栏/侧栏不消失；白屏若出现，自动在 2.5 秒内重排恢复，不需用户缩放窗口。
- [ ] missions.jsonl 中同句只有一张有效单；采集步无成功观察时 close(incomplete) 且报告眉标「未完成」。
- [ ] `npm test` 全绿，`npm run typecheck` 退出码 0。

---

## 6. 与上一单的关系

| 上一单（已推送） | 本单（新） |
|---|---|
| 改写捷径吞新指令（2ab4c32） | P1 分类错：指令进了系统但进错了道 |
| 双胞胎单（0ed59c1） | ——（本单未复发，一张单） |
| 采集步没跑也能 close(done)（72d0c44） | P2 的孪生：采集步**跑了但空转**，也算"跑了"——P2 要求空转不算数；P3 要求空转后必须出声 |
| —— | P4 白屏：独立布局层问题 |

**验收顺序**：先 `npm run dist` 重打包验收上一单三笔，再做本单四条；本单改完后连上一单一起回归。
