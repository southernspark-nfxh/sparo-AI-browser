# T01 · 阅读器·引用块与划词问 Sparo

> 线：A（阅读器） · 依赖：无 · 风险：低 · 可立即开工
> 代码根：`d:\download\sparo上架应用商店版`
> 先读：根目录 `AGENTS.md`、`docs/ARCHITECTURE.md`、总计划 `sparo-agent-upgrade/PLAN.md`（红线在其中，全部遵守）

## 目标

用户在任意网页划选一段文字，能右键「问 Sparo」或直接拖进侧栏；侧栏输入框上方出现**引用块**（带来源标题/域名、可删除），用户再补一句指令（「用三句话解释」「和昨天的新闻对照」「翻译成中文」），一起发给 agent。Agent 的回答必须基于引用内容，侧栏消息里引用块可折叠、可点回源网页。

对标体验：Cursor 的 `@` 引用 + 浏览器划词助手。

## 现状（证据，不要凭想象改）

- 拖放进侧栏已有雏形但只认文件：[shell.html](file:///d:/download/sparo上架应用商店版/src/renderer/shell.html) 约 3505-3532 行，composer 的 drop 只处理 `e.dataTransfer.files`，纯文本拖进来什么都不发生。
- 页面右键菜单在 [page-context-menu.ts](file:///d:/download/sparo上架应用商店版/src/main/page-context-menu.ts)（现在只有图片保存/复制、基础编辑）。
- 壳层桥接：`src/main/shell-preload.ts` 暴露 `window.sparkShell`；页面 preload：`src/main/preload.ts`。
- 消息渲染入口：shell.html 内 `function renderChat(log)`（约 2336 行）。
- 聊天入口：`browser.ts` `handleChat(text, images?)`（约 4712 行）→ `handleChatJob`。`chatLog` 项结构 `{role, text, images?, doc?}`。
- 阅读器正文提取已有：`src/main/agent/reader.ts`（`extractReadable`）；笔记库已有：`src/main/agent/notes.ts`。**本任务不动这两个文件。**

## 改动清单

### 1. 划词右键「问 Sparo」（页面侧）

- `page-context-menu.ts`：`params.selectionText` 非空时，在菜单顶部加一项「问 Sparo」（i18n：英 "Ask Sparo"）。点击后通过 IPC 发 `{ text, url, title, siteName }` 到主进程 → 转发给 shell 渲染进程。
- 不需要页面 preload 注入脚本；`context-menu` 事件的 `params.selectionText` 已经够用。
- IPC 通道命名：`spark:quote-from-page`。shell 侧监听后往输入区加引用块。

### 2. 拖拽纯文本进侧栏（壳层侧）

- shell.html composer 的 drop 处理：现有分支处理 `files`；新增分支——`e.dataTransfer.getData("text/plain")` 非空且 `files` 为空时，把文本做成引用块（来源 URL/标题取当前激活标签，通过 `window.sparkShell` 现有的标签状态拿到；拿不到就标「手动摘录」）。
- `dragover` 时已有 `dragon` 高亮样式，复用。

### 3. 引用块 UI（shell.html 输入区）

- 输入框上方新增 `#quoteStrip` 容器（横向滚动 chip 列表）。每个引用块：来源 favicon 或首字、标题/域名、摘录前 40 字、右上角 ×删除。
- 引用块数据存内存数组 `pendingQuotes`；发送成功后随消息进入 `chatLog` 项的 `quotes` 字段并清空。
- 消息渲染：`renderChat` 里对带 `quotes` 的消息在正文上方渲染折叠引用块（默认折叠一行，点击展开全文；点来源链接在窗口内新标签打开）。
- **冲突域纪律**：T01 允许改 composer 区域、`renderChat`、新增样式。不许动设置面板、欢迎卡、账号浮层。

### 4. 发送链路带 quotes

- `shell-preload.ts`：`sendChat` 桥接加 `quotes` 参数（数组，每项 `{text, url?, title?, kind: "page" | "note"}`，单条 text 上限 4000 字符，最多 5 条；超限前端截断）。
- `browser.ts` `handleChat(text, images?, quotes?)`：**只加参数透传**，在 `handleChatJob` 拼 prompt 时把引用内容放前面、用户指令放后面，格式：

```text
[引用 1]（来源：标题 URL）
……
[用户指令] 原句
```

- `chatLog.push` 的用户消息项加 `quotes` 字段，`pushSidebarState` 一并推给侧栏。
- 模型无 Key/云端用尽等现有拦截逻辑不变。

### 5. 单测

- 新增 `tests/quotes.test.ts`：prompt 拼装（引用在前指令在后、截断、无引用时原样）、quotes 进 chatLog。
- 现有 362 条全绿。

## 禁区

- 不动 `reader.ts` / `notes.ts` / `reader-overlay.ts`（那是 T02 的）。
- 不动 `handleChat` 的队列逻辑、`chatRunning` 锁（T06 的）。
- 不新增任何正则意图判断；引用内容一律原样进 prompt，让模型自己理解。
- 不碰 `docs/listings/`、`cloud/`、`envs/`、`cs/`。

## 验收

口令（开发窗侧栏实测）：

1. 打开任意中文新闻页 → 划选一段 → 右键「问 Sparo」→ 侧栏出现引用块，输入「用三句话解释给小学生听」→ 发送 → 回答明确基于引用段落，消息里引用块默认折叠、可展开、点来源开新标签。
2. 同一页面划选另一段 → **直接拖进侧栏输入区** → 出现引用块 → 输入「翻译成英文」→ 结果正确。
3. 连发：引用块+指令发出后，再发一条无引用消息 → 不受污染，无引用块残留。
4. 引用块点 × 可删除；最多 5 条、单条超 4000 字截断有提示。

交付物：commit + typecheck/test 输出 + 3 张截图（右键菜单、引用块 chip、折叠引用消息）。

## Commit

`feat(t01): 网页划词问 Sparo 与侧栏引用块`
