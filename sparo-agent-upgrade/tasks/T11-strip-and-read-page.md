# T11 · 任务条退场，阅读页纠正落回原页

> 线：单独一窗 · 依赖：无，在当前代码上开工 · 风险：**高**（`browser.ts` 收摊）
> 代码根：`d:\download\sparo上架应用商店版`
> 事故：2026-10-22 侧栏实机。先读根目录 `AGENTS.md`、`docs/ARCHITECTURE.md`、`sparo-agent-upgrade/PLAN.md` 第 4 节红线。
> 不要并进 T01–T10 的依赖图。本本独占 `task-pool.ts`、`browser.ts` 的任务收摊、`shell.html` 的 `#taskStrip`、`report-html.ts` 的标题去重。

## 目标

侧栏任务条只留还没交完的事。交完的记录在聊天和阅读页里，不钉在条上。人已经说了下一句，上一张「等你处理」就关掉。

嫌弃眼前那份阅读页时，重写那一页并在窗口里换上，侧栏只留一句加卡片。不另挂一张「完成」，也不把「重新生成一版」写在聊天里当已经做完。

## 事故（按这个对，不要再猜）

当时侧栏顶上钉着六张卡，`#taskStrip` 是 `position: sticky`，往下翻也挡着聊天：

| 卡 | 条上的字 | 记录里已经发生的事 |
|---|---|---|
| 登陆微博 | 前台 · 等你处理 | 站点已打开。人已登录，页面被跳回首页。模型仍问「要我先打开 weibo.com 登录页吗？」，卡挂起 |
| 这是啥意思 | 前台 · 等你处理 | 土耳其那条已在侧栏答完，没有问题在等 |
| 这个博主到底是谁 | 前台 · 等你处理 | 主页阅读页已打开 |
| 北京小汽车哪里摇号 帮我找到网站 | 前台 · 完成 | 阅读页已交，卡还留着 |
| 这是什么意思 | 后台 · 完成 | 眼前那份错的股市阅读页就是它交的 |
| 你这不是胡说八道吗 人家是炒股的 啥时候成了律师 | 前台 · 完成 | 只在侧栏改了口，文件没重写 |

阅读页文件仍是 `%APPDATA%\sparo-store\reports\read-2026-10-22T08-30-09.html`。末段还是「他自称律师」。侧栏更正的最后一句是模型自己写的「阅读页里自称律师那句一并删掉，重新生成一版。」

内容串台：上一帖是 @专业戳轮胎熊律师 的「国中土耳其」。这一帖引用的是 wu2198 的收盘帖。页上把两个人写成一个，还写「跟前面那条国中土耳其一样」。主页那份 `read-2026-10-22T08-29-24.html` 标题把域名拆成 `wei bo.com`，标题和第一段同一句，没有可点的原帖链接。

聊天记录在 `%APPDATA%\sparo-store\chat-memory.json` 末尾这一串。

## 现状（证据）

- 条子显示规则：[task-pool.ts](../../src/main/agent/task-pool.ts) `visible()`。进行中、排队、`waiting_human` 全留；另外 `slice(-3)` 再留最近 3 张完成/失败。完成没有退场，等人没有退场。
- 新句子另开卡：[browser.ts](../../src/main/browser.ts) `enqueueForeground`。旧的前台 `waiting_human` 不会被收掉。
- 只有「继续」能续上：`matchWaitingResume` 先看 `isContinueHint`。再打一句「登陆微博」对不上，就新开一张。
- 挂起后前台锁放开：`runJob` 里即使 `suspended`，前台仍 `releaseForeground()`。所以新卡能跑，旧卡还钉在条上。条上可以同时三张「前台 · 等你处理」。
- 误挂起：`shouldSuspend` 除了看本轮 `data.loop === "waiting_human"`，还看 `this.activeMission?.state === "waiting_human"`。上一张登陆单没关，后面已经答完的前台句子也被涂成等你处理。
- 人已在站上仍提问：[browser.ts](../../src/main/browser.ts) 约 5190 行。当前页不是登录墙、也不是验证码，只要落地结果不是 `{done:true}`，就 `waiting_human`，问「要我先打开登录页吗？」。`loginRedirectNote`（[reasoner.ts](../../src/main/agent/kernel/reasoner.ts)）已经说明「没有停在登录墙」，调用处仍把它当成等人，原文还要求说「继续」。
- 真登录墙、验证码墙必须继续 `waiting_human`。这条不要改松。见 `executeMission` 里 `onWall` 分支，以及 PLAN 红线第 3 条。
- 车道字：[shell.html](../../src/renderer/shell.html) `renderTaskStrip`。`lane !== "background"` 一律写「前台」。拿不准的 kind 默认前台，所以闲聊、解释、纠正都带这个字。
- 成篇才落阅读页：`shouldSealLongRead`（[report-html.ts](../../src/main/agent/report-html.ts)）。短于 180 字不落页；不到 600 字且只有一个标题、没有足够列表，也不落页。律师那次更正因此整段留在侧栏。
- 标题重复：`readingTitleOf` 没有 `#` 时截第一句当标题。`stripReadingTitle` 只删 `#` 标题，不删这句。正文第一段就再抄一遍。
- 引用拼装已有：[quotes.ts](../../src/main/agent/quotes.ts) `composeQuotedPrompt`，本条引用在前。串台是因为模型还看得到更早的聊天，把上一帖昵称写进这一页。来源 URL 没有由代码写进页头，模型自己写时把 `weibo.com` 拆开。

## 改动清单

### 1. 条子只留未完成（`task-pool.ts`）

- `visible()` 只返回 `running`、`queued`、`waiting_human`。去掉完成/失败的 `slice(-3)`。
- `finish` 之后从 `tasks` 里摘掉完成和失败，避免数组只增不减。测试里对 `finish()` 返回值的断言保持：返回的那张是 `done` / `失败`。
- 新增 `dismiss(id)`：把指定卡从池里拿走，供下一节收掉被扔下的等待。不要把 dismissed 再画回条子。

### 2. 新句子收掉被扔下的前台等待（`browser.ts`）

- `handleChat` 在 `matchWaitingResume` 没命中、且这一句要新开前台或后台任务时：把池里所有前台 `waiting_human` 都 `dismiss`。对应的 `waitingMissions` 删掉。若 `activeMission` 就是这些单，清掉，避免下一轮继承 `waiting_human`。
- 后台任务自己的登录墙 / 验证码墙不在这里收。人还可能去那张后台标签上登录，然后说「继续」。
- `matchWaitingResume` 的续跑条件不变。对得上的「继续」仍走原来的卡，不要先 dismiss 再开新卡。
- 点卡片仍只 `switchTab`。本本不加侧栏上的关闭按钮。

### 3. 拆掉误挂起（`browser.ts`）

- `shouldSuspend` 只认本轮结果的 `data.loop === "waiting_human"`。
- 删掉 `this.activeMission?.state === "waiting_human"` 这一支。上一张单还在等人，不能把这一轮已经写出的答案涂成等你处理。
- 抽成纯函数放到 `task-pool.ts` 或 `task-class.ts`，单测可直接打。不要为了测它去起 Electron。

### 4. 人已经在目标站上就收工（`browser.ts` + `reasoner.ts`）

- 约 5190 行这段：当前页不是登录墙、也不是验证码时，不再 `waiting_human`，不再问「要我先打开登录页吗？」。
- `loginRedirectNote` 有文案时，把这句当作本轮回答交出去，工作单状态改为完成。去掉「退出后再说继续」。人要换账号，是下一句新任务。
- 更新 [tests/site-goal.test.ts](../../tests/site-goal.test.ts)：跳回首页的说明仍在，不再要求文案里有「继续」。
- 下面这些分支保持原样，不许改成直接完成：`isLoginWall`、`isCaptchaWall`、`applyHostLessons` 的登录/验证提示、「你在窗口里登录后说继续」。

### 5. 纠正落回阅读页（`browser.ts`）

本地不新写正则去判断用户这句是不是在纠正。红线第 1 条。

本地只认已经有的结构：

- 上一则助手消息带 `doc.kind === "read"`，这一轮用户消息没有新的 `quotes`：这一轮的回答是在改那一页。无论长短，都 `sealLongRead` 写成新的阅读页并 `openReport` 换到窗口里。侧栏只留「《标题》已写成阅读页，在窗口里打开了。」
- 这一轮带了新 `quotes`：这是新的一条解释，按第 6 节落页，不要改上一份文件的内容。
- 模型回复里出现「重新生成一版」这类还没做的下一步，不能单独当成交付。有上一份阅读页时，必须以新的 HTML 文件打开为准。没有新文件，这张任务按失败收，不要 `finish(..., "done")`。

`shouldSealLongRead` 的原阈值继续用于没有阅读页上下文的普通长回答。不要为了这一条把所有短回复都落成页。

### 6. 一帖一页（`quotes.ts`、`report-html.ts`、阅读页调用处）

- `composeQuotedPrompt` 在有引用时加一段固定契约，放在引用块之前，不解析用户原句：这一问只解释本条引用。作者、身份、风格只能源自本条引用的正文和来源标题。聊天里更早的帖子、昵称、职业不得写进回答。
- `readingReportHtml` 增加可选来源 `{ title?, url?, siteName? }`。有 `url` 时，页头标题下渲染一行可点链接，href 用引用里的原始 URL。域名由代码写入，不让模型拼。
- 带引用的阅读页把**这一轮** `quotes[0]` 的 url / title / siteName 传进去。不要拿上一轮的引用。
- `stripReadingTitle`：标题来自第一句而不是 `#` 时，正文里删掉与标题相同的那一句（用 `readingTitleOf` 的同一套清理）。现有「有 `#` 就删 `#`」的测试保持通过。补一条：无标题稿「这段话是说明，后面是正文」进页后，`<h1>` 与第一段不再是同一句。

### 7. 条子文案（`shell.html`）

- `renderTaskStrip`：`lane === "background"` 才显示「后台」。前台不写「前台」。
- 只改这个函数和它注入的样式。不动 `renderChat`、`quoteStrip`、`planStrip`、设置面板。
- sticky 保留。条子空了本来就会 `hide`。

### 8. 单测

- `tests/task-pool.test.ts`：`visible()` 不含完成/失败；`waiting_human` 仍在；`dismiss` 之后条子里没有这张卡；现有「不占名额」「完成释放名额」仍然成立。
- 纯函数：`shouldSuspend` 只在本轮 `loop === "waiting_human"` 时为真。上一张单是 `waiting_human`、本轮没有这个 loop，结果为假。
- `tests/report-html.test.ts`：第一句升成标题后从正文去掉；带来源 URL 的页头有 `<a href="https://weibo.com/u/1216826604">`，HTML 里不出现 `wei bo.com`。
- `tests/site-goal.test.ts`：按第 4 节改断言。
- `npx vitest run` 全绿。基线数以跑出来的为准，不要为了凑旧的 362 去删测试。

## 禁区

- 不新写正则截胡用户句子（「胡说八道」「删掉」「重新生成」都不要拿来做 if）。
- 登录墙、验证码墙继续等人。不代点登录、验证码、发送、支付。
- 多种信息调研仍出报告页，侧栏一句加卡片。不要把这次的短纠正阈值扩大成「所有回答都落页」。
- 不改任务池上限 3，不做用户设置项。
- 不碰 `docs/listings/`、`cloud/`、`envs/`、`cs/`。
- 不动 `makePageView` 节流、不动标签休眠。

## 验收

开发窗：`npx electron-vite dev -- --remote-debugging-port=9333`。不要用旧安装包。

口令，按顺序在侧栏发：

1. 「登陆微博」。微博已登录、停在首页时：侧栏一句说明已经进站、没有停在登录墙。任务条上**没有**这张卡，也没有「等你处理」。不要出现「要我先打开登录页吗？」。
2. 在微博上划一条帖子，问「这是啥意思」。答完后这条卡不留在任务条上。
3. 再划**另一个博主**的另一条帖子，问「这是什么意思」。新阅读页只解释这一条：不出现上一帖的昵称、职业、梗。页头有这一条的原帖链接，域名中间没有空格。标题和第一段不是同一句。任务条空。
4. 接着发「你这不是胡说八道吗，阅读页里那句没有依据的话删掉，重新生成一版。」窗口换成一份新的阅读页，被否定的那句不在文件里。侧栏只有一句加卡片，不出现一整段更正，也不出现「重新生成一版」当作结尾。任务条空。
5. 后台调研（「戴森吹风机 在淘宝和京东比价」）跑的时候，任务条可以有一张「后台」卡。它完成后从条上消失。这条后台卡在跑时，再发一句前台「总结当前页」，前台不等后台。
6. 单独造一个真登录墙（未登录站点，或单测里的 `isLoginWall` 路径）：卡显示「等你处理」，不写「前台」。说「继续」能续上这张卡。此时期间如果改口去问别的事，这张前台等待卡从条上消失。

交付物：一个 commit、`npx vitest run` 输出、3 张截图（任务条为空、新阅读页页头带来源、纠正后再打开的页里没有被否定的句子）。

## Commit

`fix(t11): 任务条只留未完成的事，纠正阅读页写回新页`
