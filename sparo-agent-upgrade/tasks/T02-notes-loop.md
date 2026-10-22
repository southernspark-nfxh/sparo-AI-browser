# T02 · 阅读器·笔记双向打通（补课版）

> 线：A（阅读器） · 依赖：T01 已合并（e570143）；**进场前 browser.ts 必须无未提交改动，`git log` 须含 b1cf18d（大脑热修）与 fix(t07) 提交** · 风险：低
> 代码根：`d:\download\sparo上架应用商店版`
> 进场闸门：读根目录 `AGENTS.md`、`sparo-agent-upgrade/PLAN.md` 红线；跑 `git log --oneline -8` + `git status --short` 贴在回复里。工作区若有别人的未提交改动，停下报告。

## 目标

把笔记库接进侧栏对话，形成闭环：

1. 输入框打 `@` 弹笔记搜索下拉，选中成 kind=note 引用块随指令发出
2. agent 回复卡加「存为笔记」一键入库
3. 阅读模式页加「存为笔记」「问 Sparo」两按钮
4. 侧栏设置区加「笔记」页：列表/搜索/只读打开/删除（不做编辑器）

## 现状锚点（照实读，不要凭旧印象）

- 笔记库已完整：`src/main/agent/notes.ts`（writeNote/listNotes/readNote/deleteNote），数据在 `%APPDATA%\sparo-store\notes\`
- T01 已落：shell.html quoteStrip 引用块、`sendChat(text, images, quotes)`、quote kind 已有 `"page" | "note"` 两种——**复用引用块机制，不另造 UI**
- 大脑热修 b1cf18d 改过 `runtime.ts`（looksAnswer 收窄、goal.site）——**本任务不碰 runtime.ts 与 kernel/**
- browser.ts 已有任务池（task-class/task-pool）、收摊守门、保活代码——**只准动 quotes 拼装的 note 分支和新增笔记 IPC，不碰任务池/收摊/保活**

## 改动清单

1. **@ 下拉**（shell.html）：输入 `@` 后连续字符作搜索词 → 新 IPC `spark:notes-search` → `listNotes(20, undefined, 词)`；下拉项=标题+来源域名+日期，键盘上下/Enter/Esc；选中后删掉 `@词`，quoteStrip 加一条 kind=note 引用块（带 noteId，摘录取 summary 或正文前 400 字）。沿用 T01 的 quoteStrip，不加新容器。
2. **prompt 拼装**（browser.ts T01 的 quotes 分支）：`kind === "note"` 且带 noteId → `readNote(noteId)` 取全文截 4000 字，标注 `[笔记：标题]`；引用在前指令在后，原格式不变。
3. **存为笔记**：回复卡（renderChat 的 assistant 操作区）加按钮 → `writeNote`：title=用户原句前 30 字、source_url=当前激活标签 URL、markdown=回复正文；成功 toast。阅读模式页（reader-overlay / reader HTML）加「存为笔记」（htmlToMarkdown 已有）和「问 Sparo」（正文前 4000 字作 kind=page 引用块送输入区聚焦等指令）。
4. **笔记页**：侧栏设置区加「笔记」页：列表、搜索、点标题新标签只读打开、删除。
5. **单测** `tests/notes-loop.test.ts`：note 引用 prompt 拼装（有/无 noteId、截断）、writeNote 入库字段映射。

## 禁区

不碰 runtime.ts、kernel/、任务池、planStrip/taskStrip、主题样式；不新增正则意图判断；不做笔记云同步、不改 notes.ts 存储格式；不碰 `docs/listings/`、cloud/、envs/、cs/。

## 验收口令

1. 发「RAG是什么 打开百度百科和知乎做成笔记」→ 回复卡点「存为笔记」→ toast 成功
2. 新文章划选一段右键问 Sparo → 输入「@」选中刚存的笔记 → 补「对照这篇笔记，有什么新东西」→ 回答同时基于两处内容
3. 设置→笔记：搜到、打开、删除
4. 阅读页两按钮各点一次，行为正确
5. 全量 `npx vitest run` 全绿

## Commit

`feat(t02): 笔记库与侧栏对话双向打通`
