# Sparo 0.6.6 问题与方案（送审）

> 对应反馈：「打包之前提出的很多问题根本没有解决，新包也没有解决。比如我输入命令，在右侧的对话栏看不到对话；还有我让 sparo 关掉打开的所有今日头条相关的网页，它根本不动。」

本文只写两件事：**问题是什么、证据在哪、怎么改、改完怎么验**。不含代码细节的取舍已写在第四节。

---

## 一、问题 1：右侧对话栏看不到对话

### 1.1 现象

在侧栏输入命令、按发送后，输入框清空了，但右侧对话区没有出现自己这条消息；有时连回复也没有。窗口最大化时，右侧整块侧栏会消失，网页铺满整窗。

### 1.2 根因（四条链路，全部有证据）

**根因 A：对话帧不带 `chat` 字段时，壳层把对话清空。**
`src/renderer/shell.html` 的 `applyChatFrame()`（约 3426 行）在「全量帧」分支写的是：

```js
const all = frame && Array.isArray(frame.chat) ? frame.chat : [];
```

只要收到的包没有 `chat` 字段（状态查询、其他推送、异常包），`all` 就是空数组，紧接着 `texts: all.slice()` 把整段对话清空。用户看到的就是「对话忽然没了」。

**根因 B：侧栏整包构建失败时，这一拍推送被直接丢弃。**
`src/main/browser.ts` 的 `flushSidebarState()` 里，`getSidebarPayload(true)` 一旦抛错，catch 只打一行日志，**不发送任何东西**。
诊断日志 `%APPDATA%\sparo-store\diag\crash.log` 在 `2026-11-13T02:00:13`（本地 10:00:13）记录到：

```
[shell-unresponsive] win=main sidebar read failed: map is not iterable
```

紧接着同一秒出现 `[shell-paint-recover] repaint ... reason=unresponsive`。也就是说：payload 构建失败 → 不推送 → 壳层收不到 → 用户看到「发了没反应」。

**根因 C：发送后没有本地回显，全靠主进程回推。**
`sendChat()`（约 4683 行）把输入框清空后只等主进程回推。链路 A/B 任何一环断掉，用户就看不到自己刚发的内容。这是「输入命令看不到对话」最直接的体感来源。

**根因 D：网页视图被 Chromium 拉成整窗，盖住侧栏。**
`crash.log` 反复出现：

```
[chrome-hole] heal tab=... old={width:1346} new={width:1061} reason=width dw=285
```

截屏 `sparo-max.png` / `sparo-right.png` 也确认：最大化后网页铺满整窗，右侧没有侧栏。这是「右侧对话栏看不到」的视觉成因：不是没有对话，是对话区被网页盖住了。

**根因 E（附带发现）：状态查询与对话推送共用同一个游标。**
`spark:get-status` 直接把 `getSidebarPayload()` 的结果返回给壳层，而 `getSidebarPayload` 内部会调用 `chatFrame()` 并**推进** `chatCursor`。查询一次、游标就走一次，壳层下一拍的增量基线随之对不上，于是反复「请求全量 → 再走偏」，对话刷新抖动甚至长时间停在旧内容。

### 1.3 改法

| 编号 | 改哪个文件 | 怎么改 |
|---|---|---|
| A | `src/renderer/shell.html` `applyChatFrame` | 全量帧但 `chat` 不是数组时，**不清空**，改为向主进程请求全量；包上没有 `chatSync` 字段时视为「非对话包」，原样返回、不动对话。 |
| B1 | `src/main/browser.ts` `pruneStaleApprovals` | `approvals` 不是 `Map` 时直接返回 0，不再抛 `map is not iterable`。 |
| B2 | `src/main/browser.ts` `flushSidebarState` | 构建失败时调用新增的 `pushSidebarFallback()`：只推对话帧 + 会话/运行态，标 `degraded: true`。至少让对话能显示。 |
| B3 | `src/main/browser.ts` `getSidebarPayload` | `skills / lessons / triggers / plan / tasks` 逐个字段走 `safeList` / `safeValue`，单个本地库坏掉降级为空，不拖垮整包。 |
| C | `src/renderer/shell.html` `sendChat` + 新增 `chatEcho` | 发送成功后**立刻**在对话区插入自己这条气泡（60% 透明度），主进程回推后自动去重消失。发送失败则撤掉回显并提示。 |
| D | `src/main/page-bounds.ts` + `src/main/browser.ts` | 新增纯函数 `clampPageView()`。硬上限是客户区宽减去**当前侧栏宽**（展开 300–480）。56px 只在侧栏宽度还没报到时兜底，不能拿它把洞放宽。`pageBounds()` / `mountPageView()` / `parkPageView()` 在 `setBounds` 前都过一遍。活动页仍盖住壳层时不进 10 秒冷却，2 秒巡检继续用「先差 1px 再写回」把它拉回。 |
| E | `src/main/browser.ts` | 只读对话帧不补序号、不推进 `chatCursor`、不清 `chatResync`。`spark:get-status` 和 `sidebarPayloadDiag()` 都走只读；只有真正推送时才推进。 |

### 1.4 改完怎么验

1. 启动开发实例，在侧栏发「帮我打开今日头条」→ 右侧**立即**出现自己这条消息，随后出现回复。
2. 连续发 3 条，回显不重复、不残留。
3. 最大化 / 还原 / 切标签各 3 次，右侧侧栏始终完整可见，网页不越界。停稳后视图宽度等于页面洞。`heal` 可以打出一行 `dw=`，只要随后宽度回到洞里就算通过。
4. 查看 `crash.log`：不再新增 `map is not iterable`。

---

## 二、问题 2：「关掉所有今日头条相关的网页」它根本不动

### 2.1 现象

用户明确要求关闭所有今日头条相关网页，Sparo 没有关闭任何标签页，也没有给出「关掉了几个」的回执。

### 2.2 根因（已坐实）

侧栏 agent 的工具表 `src/main/agent/free-soul.ts` 的 `TOOLS` 里**完全没有标签页管理能力**：没有 `list_tabs`、没有 `close_tab`、没有 `close_tabs`。模型拿不到工具，只能回复「我没有关闭标签的能力」。

证据：
- `src/main` 全目录搜索 `close_tab`，**零命中**。
- `%APPDATA%\sparo-store\chat-memory.json` 中 seq166 / seq167，模型实际回复：「我没有关闭标签的能力」。

这不是模型不听话，是**根本没给工具**。

### 2.3 改法

1. `src/main/agent/free-soul.ts`
   - `FreeSoulToolName` 增加 `list_tabs / switch_tab / close_tab / close_tabs`。
   - `TOOLS` 增加四项声明，说明参数与用途。
   - 系统提示增加一条：用户要求关闭 / 整理 / 切换标签页时，先 `list_tabs` 看清有哪些页，再用 `close_tabs` 按站点关键字批量关闭（「关掉所有今日头条的网页」= `match: "toutiao"`），不许回答做不到。
2. `src/main/browser.ts`
   - `runCoreTool` 分发这四个工具。
   - 新增 `listTabsTool()`：返回全部标签的 id / 标题 / 地址 / 是否当前页。
   - 新增 `switchTabTool()`：`id` 优先，其次按地址或标题关键字匹配。
   - 新增 `closeTabsTool()`：
     - 单个关闭：`id` 优先，其次 `match` 只关第一个；
     - 批量关闭必须带 `match`（地址 + 标题，不区分大小写）。不传 `match` 直接失败，不关任何页；
     - `match` 命中的页全部关闭，包括当前正在看的；
     - `keepActive: true` 只在用户明确说留着当前页时使用；
     - 批量时跳过整页工作台 / 阅读页；
     - 返回实际关闭数量与前几个标签标题。
   - `switch_tab` 走现成的 `switchTab()`，带标签守卫和页面洞重报。
3. 这四个工具不需要专属页面（`sidebar-tab.ts` 的 `PAGE_TOOL_RE` 不含它们），不会额外开标签。

### 2.4 改完怎么验

1. 先打开 2 个今日头条页面 + 1 个其他站点页面。
2. 输入「把打开的所有今日头条相关的网页都关掉」。
3. 预期：日志出现 `close_tabs` 调用；标签栏里头条页全部消失；侧栏回复「已关闭 N 个标签页：…」；其他站点页面保留。
4. 再试「关掉当前这个页面」→ 只关当前页，落到相邻标签。

---

## 三、验收方式（我会先自己点，再交给你）

| 步骤 | 命令 / 动作 | 通过标准 |
|---|---|---|
| 类型检查 | `npm run typecheck` | 零错误 |
| 单测 | `npm test` | 全绿，含本次新增用例 |
| 自测 | `npm run start` | 上面 1.4 与 2.4 全部手工点通 |
| 黄金场景 | 复测 `docs/QA-GOLDEN-SCENARIOS.md` 的 G1 / G2 / G3 | 通过 |
| 打包 | `npm run dist` | 产出 `release\Sparo-Setup-0.6.6.exe`，记录大小与 SHA-256 |
| 文档 | `CHANGELOG.md` / `AGENTS.md` / `docs/PRODUCT-TASKBOOK.md` | 版本与口径同步为 0.6.6 |

## 四、边界与不做的事

- 不重写侧栏对话协议（全量 / 增量帧保留）。
- 不新增「提前结束任务」的本地判断，因此无需登记 `docs/DECISION-POINTS.md`。
- 不删用户数据，不动 `docs/listings/`。
- 版本号按你的规则递增到 **0.6.6**，只修这两个问题，不夹带其他改动。
