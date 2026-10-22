# Sparo AI伴读 · 任务书

> 版本：v0.1 · 2026-10-21
> 对应 PRD：[READING-ASSISTANT-PRD.md](./READING-ASSISTANT-PRD.md)（v0.2）
> 产物：**逐个 task 发给 Cursor 执行**，我负责验收
> 总体目标：v0.2.0 交付阅读模式 + AI伴读（toggle）+ 一键盘存 + 本地笔记库 + MCP notes_list

## 依赖链总览

```
T1 装依赖 + 主进程模块骨架
 │
 ▼
T2 阅读模式标签页渲染
 │
 ▼
T3 高亮 overlay preload
 │
 ▼
T4 按钮1 AI伴读 toggle ─┐
 ▼                        │
T5 按钮2 一键盘存    ───┼──▶ T6 笔记存储层
 │                        │
 ▼                        ▼
T7 侧栏笔记列表 UI        T8 intent-router + MCP
```

**每个 task 独立、可验收、不依赖后续 task。** 按编号顺序发。

---

## T1 · 依赖安装 + 主进程模块骨架

### 目标
装两个 npm 包（Mozilla Readability + Turndown），建好三个主进程模块文件（空骨架，导出类型和占位函数），跑通 `npm test` 和 `npm run typecheck`。

### 要做的

1. **装依赖**
   ```
   npm.cmd install @mozilla/readability@^0.5.0 turndown@^1.0.0 --save
   ```
   说明：用 `npm.cmd` 不是 `npm`（Windows PowerShell 执行策略）。

2. **新建三个文件**（全部 export 空 stub + 类型定义，暂不实现逻辑）

   `src/main/agent/reader.ts`：
   ```typescript
   /**
    * 阅读模式：从当前 DOM 提取正文 + 新开阅读标签。
    */
   import type { BrowserWindow } from "electron";

   export type ReaderResult = {
     title: string;
     contentHtml: string;     // Readability 输出的干净 HTML
     textContent: string;     // 纯文本，供 AI 总结用
     siteName?: string;
     url: string;
   };

   /** 用 Mozilla Readability 从当前 window.webContents 提取正文。 */
   export async function extractReadable(mainWin: BrowserWindow): Promise<ReaderResult> {
     // TODO T2 实现
     throw new Error("reader not implemented yet");
   }

   /** 新开一个阅读模式标签页，复用 reportHtml.readingReportHtml() 渲染。 */
   export async function openReaderModeTab(mainWin: BrowserWindow, result: ReaderResult): Promise<void> {
     // TODO T2 实现
     throw new Error("openReaderModeTab not implemented yet");
   }
   ```

   `src/main/agent/highlight.ts`：
   ```typescript
   /**
    * 高亮数据按 URL 持久化到 %APPDATA%\sparo-store\highlights.json。
    */

   export type Highlight = {
     chunkId: string;           // 唯一 id，供 <mark data-chunk-id="xxx"> 用
     color: "yellow" | "green" | "blue" | "red";
     text: string;              // 高亮的原文
     note?: string;             // 用户手动加的笔记
     aiSummary?: string;        // AI 自动生成的一句话总结
     createdAt: string;         // ISO 时间戳
   };

   /** highlights.json 整体结构：key = URL，value = 该 URL 的高亮数组 */
   export type HighlightsStore = Record<string, Highlight[]>;

   const HIGHLIGHTS_FILE = "highlights.json";

   function storePath(): string {
     // 用 app.getPath("userData") + highlights.json
     // TODO 实现：import { app } from "electron"; return join(app.getPath("userData"), HIGHLIGHTS_FILE);
     throw new Error("storePath not implemented");
   }

   /** 读 highlights.json，不存在返回空对象。 */
   export function loadHighlights(): HighlightsStore {
     // TODO T3 实现
     throw new Error("loadHighlights not implemented");
   }

   /** 写 highlights.json（覆盖式写入，整体 atomic）。 */
   export function saveHighlights(store: HighlightsStore): void {
     // TODO T3 实现
     throw new Error("saveHighlights not implemented");
   }

   /** 取某 URL 的高亮数组（没有返回 []）。 */
   export function getHighlightsForUrl(store: HighlightsStore, url: string): Highlight[] {
     return store[url] || [];
   }
   ```

   `src/main/agent/notes.ts`：
   ```typescript
   /**
    * 本地笔记库：%APPDATA%\sparo-store\notes\
    * 每篇笔记 = {id}.md + {id}.meta.json
    * 索引 = notes-index.json
    */

   export type NoteMeta = {
     id: string;
     kind: "note";
     title: string;
     source_url: string;
     site_name?: string;
     saved_at: string;          // ISO 时间戳
     word_count?: number;       // 正文字数
     summary?: string;          // AI 总结（一键盘存时写入）
     highlights_refs?: string[]; // 关联的高亮 chunkId 列表
     tags?: string[];
   };

   export type NoteIndexEntry = Pick<NoteMeta, "id" | "kind" | "title" | "source_url" | "saved_at" | "tags"> & {
     highlight_count?: number;
   };

   export type NotesIndex = NoteIndexEntry[];

   /** 生成笔记 id（简短唯一，用时间戳+4位随机）。 */
   export function genNoteId(): string {
     return `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
   }

   /** 读 notes-index.json，不存在返回 []。 */
   export function loadNotesIndex(): NotesIndex {
     // TODO T6 实现
     throw new Error("loadNotesIndex not implemented");
   }

   /** 写 notes-index.json。 */
   export function saveNotesIndex(index: NotesIndex): void {
     // TODO T6 实现
     throw new Error("saveNotesIndex not implemented");
   }

   /** 写入一篇完整笔记（.md + .meta.json + 更新 index）。返回 NoteMeta。 */
   export function writeNote(opts: {
     title: string;
     source_url: string;
     site_name?: string;
     markdown: string;
     summary?: string;
     tags?: string[];
   }): NoteMeta {
     // TODO T6 实现
     throw new Error("writeNote not implemented");
   }

   /** 列出笔记（按 saved_at 倒序）。 */
   export function listNotes(limit?: number, tag?: string, search?: string): NoteIndexEntry[] {
     // TODO T6 实现
     throw new Error("listNotes not implemented");
   }
   ```

3. **跑测试和类型检查**
   ```
   npm.cmd run typecheck
   npm.cmd test
   ```
   预期：typecheck 无错误；vitest 全部通过（新增空模块不影响现有测试）。

### 验收
- [ ] `package.json` dependencies 多了 `@mozilla/readability` 和 `turndown`
- [ ] `node_modules/@mozilla/readability/package.json` 存在
- [ ] `node_modules/turndown/package.json` 存在
- [ ] `src/main/agent/reader.ts`、`highlight.ts`、`notes.ts` 三个文件存在，类型正确导出
- [ ] `npm run typecheck` 通过
- [ ] `npm test` 全部通过

### 不回归
- [ ] 出行/比价/调研不受影响
- [ ] 飞书不受影响
- [ ] 云订阅不受影响

---

## T2 · 阅读模式标签页渲染

### 前置
T1 完成。

### 目标
实现 `reader.ts` 的两个函数：从当前页提取正文、新开阅读模式标签。

### 要做的

1. **实现 `extractReadable(mainWin)`**
   - 在 `mainWin.webContents` 上执行 preload 脚本，调用 Mozilla Readability
   - 脚本大致结构：
     ```javascript
     // 要注入到页面的 JS：
     import("@mozilla/readability").then(({ Readability }) => {
       const doc = document;
       const parsed = new Readability(doc.cloneNode(true)).parse();
       if (parsed) {
         return JSON.stringify({
           title: parsed.title,
           contentHtml: parsed.content,
           textContent: parsed.textContent,
           siteName: parsed.siteName || "",
           url: location.href,
         });
       }
       return null;
     });
     ```
   - **注意**：Readability 运行在浏览器页的 context 里，所以要从 `@mozilla/readability` 包里把 `Readability.js` 拷到 `src/main/page-scripts/` 目录，然后用 `webContents.executeJavaScript(fs.readFileSync("Readability.js", "utf8") + "\n" + ourInjectedScript)` 执行。Electron 不支持直接在渲染进程 import npm 包。
   - 如果 Readability 返回 null（提取失败），走**聚焦模式降级**：返回 ReaderResult 但 contentHtml 用 `<article>` 包裹当前 document.body 里的可见段落，textContent 直接 `document.body.innerText`。降级不报错，继续渲染。

2. **实现 `openReaderModeTab(mainWin, result)`**
   - 调用 `reportHtml.readingReportHtml({ title: result.title, body: result.contentHtml })`
   - 调用 `reportHtml.writeHtmlReport(configDir, "reader-" + timestamp, html, { title: result.title, kind: "read" })`
   - 新开标签页加载这个 HTML 文件（用 file:// URL 或 data:text/html,xxx）
   - **复用现有 browser.ts 的新标签打开逻辑**（看 `browser.ts` 里其他新开标签是怎么做的，对齐）

3. **在 browser.ts 里加 IPC handler**
   - `ipcMain.handle("reader:open", async (_evt) => { ...调用 extractReadable + openReaderModeTab... })`
   - preload 层（shell.html 对应的 preload）暴露 `window.SparoAPI.openReaderMode()`

4. **跑 typecheck 和 test**

### 验收
侧栏口令：
```
打开 https://www.gov.cn 换成阅读模式
打开 https://news.ycombinator.com 换成阅读模式
```
预期：
- [ ] 新开标签，内容干净（无侧边栏、无推荐、无广告）
- [ ] gov.cn 提取到"中华人民共和国中央人民政府门户网站"正文
- [ ] HN 提取到首页标题列表
- [ ] 原始标签保留，两个标签可切换
- [ ] 阅读模式页底部有 3 个空按钮（主题/字号/关闭），暂时没有 AI伴读和一键盘存

### 不回归
- [ ] 出行/比价/调研手册 HTML 渲染正常（report-html.ts 没被改坏）
- [ ] `npm run typecheck` 通过
- [ ] `npm test` 全部通过

---

## T3 · 高亮 overlay + 按 URL 持久化

### 前置
T1, T2 完成。

### 目标
阅读模式页选中文本能高亮，刷新/重开 Sparo 后同一 URL 的高亮回来。数据存 `%APPDATA%\sparo-store\highlights.json`。

### 要做的

1. **实现 `highlight.ts` 全部函数**
   - `storePath()` → `join(app.getPath("userData"), "highlights.json")`
   - `loadHighlights()` → 读 JSON 文件，不存在返回 `{}`，损坏也返回 `{}`（try/catch）
   - `saveHighlights(store)` → JSON.stringify + writeFileSync，atomic（先写 .tmp 再 rename）

2. **写 preload 脚本 `HIGHLIGHT_OVERLAY_SCRIPT`**
   - 作为字符串常量放在 `src/main/page-scripts.ts`（和现有 FIND_DEST_INPUT_SCRIPT 等并列）
   - 监听阅读模式页的 `mouseup` 事件
   - 判断是否有 Selection.rangeCount > 0 且文本非空
   - 选中后浮出浮层工具栏（inline style 注入，`.mark-toolbar { position: fixed; z-index: 9999; ... }`）
   - 工具栏有 5 个按钮：🟡 🟢 🔵 🔴 + 添加笔记
   - 点颜色 → 用 `document.execCommand("insertHTML", false, "<mark data-chunk-id='xxx' style='background:...'>selected</mark>")` 包裹
   - 生成 chunkId：`"h" + Date.now().toString(36) + Math.random().toString(36).slice(2, 4)`
   - 高亮后，把整个页面所有 `<mark>` 扫一遍，组装成 Highlight[]，通过 IPC 发给主进程保存
   - **页面加载时**：先读 highlights.json 当前 URL 的数组，恢复所有 `<mark>` 元素（用 textContent 匹配，按 chunkId 回填）

3. **主进程 IPC**
   - `ipcMain.handle("highlight:save", async (_evt, { url, highlights }) => { ...saveHighlights... })`
   - `ipcMain.handle("highlight:load", async (_evt, { url }) => { ...getHighlightsForUrl... })`
   - preload 暴露 `window.SparoAPI.saveHighlights(url, arr)` 和 `window.SparoAPI.loadHighlights(url)`

4. **跑 typecheck 和 test**

### 验收
```
打开 https://www.gov.cn 换成阅读模式
选一段正文 → 点黄色高亮
刷新这个阅读模式标签
```
预期：
- [ ] 刷新后高亮还在
- [ ] 关掉 Sparo 重开，再打开同一 URL 的阅读模式 → 高亮还在
- [ ] highlights.json 里该 URL 有数组，数组元素包含 chunkId + color + text
- [ ] 不同 URL 的高亮互不影响（key 是 URL）

### 不回归
- [ ] 出行/比价/调研不受影响
- [ ] 飞书不受影响

---

## T4 · 按钮1 AI伴读 toggle

### 前置
T1, T2, T3 完成。

### 目标
阅读模式页顶部工具栏出现「AI伴读 关」按钮，点开后变成「AI伴读 开」。之后每次划线 → AI 总结 → 预览区浮出。用户点「存入笔记」才落盘。

### 红线
- AI 总结结果先进**只读预览抽屉**，禁止自动写入
- AI 请求失败不阻塞阅读（toast 提示 + 高亮照常保存）
- 侧栏有 toast 反馈

### 要做的

1. **顶部工具栏注入**
   - 在 `readingReportHtml()` 输出的 HTML 里，body 开头加一个 `<div class="reader-toolbar">`
   - 工具栏包含：主题切换（豆沙绿/米白/夜间）+ 字号（14/16/18/20）+ **AI伴读 toggle** + **一键盘存**（T5 做）
   - 工具栏样式和阅读模式主题联动

2. **toggle 状态持久化**
   - 存 `settings/store.ts` 里：`reader.aiCompanionOn: boolean`
   - 阅读模式页加载时读这个偏好，初始状态从偏好来

3. **AI伴读 开 后的划线流程**
   - 在 T3 的 `mouseup` 监听里加判断：如果 toggle 是**开**的
     → 选中文本 → 除了上色 → 还触发 IPC 调 AI
   - 主进程收到 AI 请求
     → 取选中文本 + 所在段落上下文（前后各 200 字）
     → 调 Sparo 现有 LLM 能力（复用 `deepseek.ts` / `handleChatJob` 里的模型调用）
     → prompt 简单：`"用一句话总结这段文字的核心观点：\n\n{选中文本}"`
     → 返回结果发 IPC 到阅读模式页
   - 阅读模式页收到 AI 结果 → 右下角浮出 200px 高抽屉
     - 抽屉上半：选中文本（灰底）
     - 抽屉下半：AI 总结
     - 底部 3 按钮：「📝 存入笔记」「⏭ 跳过」「🔄 再试试」

4. **抽屉三个按钮行为**
   - 「存入笔记」→ 调 IPC `notes:saveHighlight`（T6 实现，这里先 stub 成 console.log + toast）
   - 「跳过」→ 关闭抽屉
   - 「再试试」→ 重新调 AI

5. **AI 失败处理**
   - 主进程 catch 到 error → 发送 IPC `ai:error`
   - 阅读模式页收到 → toast「AI 暂时不可用，但高亮已保存」
   - 用户划线本身不受影响，颜色照常加上

6. **侧栏 toast 反馈**
   - 每次 AI 总结成功 → IPC 通知侧栏 → 侧栏顶部冒 toast「已生成总结，点预览区决定是否存入」
   - toast 2.5 秒自动消失，可点「撤销」

### 验收
```
打开 https://www.gov.cn 换成阅读模式
点「AI伴读 关」→ 变成「AI伴读 开」
选一段正文
```
预期：
- [ ] 底部浮出预览抽屉，显示选中文本 + AI 一句话总结
- [ ] 点「跳过」→ 抽屉关闭，高亮保留
- [ ] 点「存入笔记」→ 侧栏 toast 成功（T6 才真正落盘，现在先 stub 成 toast）
- [ ] 关掉 Sparo 重开，AI伴读 默认状态恢复（settings 里持久化）
- [ ] 关掉 toggle 再划线 → 只高亮，不触发 AI

### 不回归
- [ ] 出行/比价/调研不受影响
- [ ] 飞书不受影响

---

## T5 · 按钮2 一键盘存

### 前置
T1, T2, T3 完成。**T4 可选**（按钮2 不依赖 toggle，独立实现）。

### 目标
阅读模式页顶部工具栏出现「📚 一键盘存」大按钮。点击 → AI 总结全页 + 预览抽屉 + 用户确认后存入（T6 实现）。

### 要做的

1. **「一键盘存」按钮**
   - 和 T4 的 AI伴读 toggle 同在顶部工具栏
   - 按钮样式：更大、带 📚 emoji、蓝色主色调
   - 点击触发 IPC → 主进程调 AI

2. **主进程一键盘存管线**
   ```
   用户点「一键盘存」
     → IPC "reader:summarizePage"
     → 主进程取当前阅读模式的 textContent（从 Readability 结果里来，或从页面 executeJavaScript document.body.innerText）
     → 调 AI，prompt：
        "阅读下面这篇文章，给我：
         1. 5 句话的核心摘要
         2. 3 个关键观点
         3. 一句推荐语（值不值得读）
         
         文章：
         {全文}"
     → 返回结构化 JSON（5 句话 + 3 观点 + 推荐语）
     → IPC 发回阅读模式页
   ```

3. **预览抽屉（复用 T4 的）**
   - 上半：AI 总结的 5 句话 + 3 观点 + 推荐语
   - 下半：灰色提示「将保存：全文 N 字 + 读书记录（来源 URL、保存时间）」
   - 底部按钮：「📚 确认键存」「⏭ 取消」

4. **读书记录 meta**
   - 存的 meta 里增加 `saved_at`、`word_count`、`summary` 字段
   - 来源 URL 从 Readability 结果里拿，site_name 也拿

5. **AI 失败处理**（同 T4）
   - AI 挂了 → toast「AI 总结失败，但可以手动存全文」
   - 抽屉下半部分改成「手动存全文 N 字」按钮

### 验收
```
打开 https://news.ycombinator.com 换成阅读模式
点「📚 一键盘存」
```
预期：
- [ ] 底部浮出预览抽屉，显示 AI 总结（5 句话 + 3 观点 + 推荐语）
- [ ] 点「确认键存」→ 侧栏 toast 成功（T6 落盘）
- [ ] 网络断开时 AI 失败 → toast + 抽屉降级成「手动存全文」

### 不回归
- [ ] 出行/比价/调研不受影响

---

## T6 · 笔记存储层（真正落盘）

### 前置
T1 完成。T4/T5 需要时调本模块。

### 目标
实现 `notes.ts` 的全部函数：writeNote、listNotes、读/写 index、按 URL 关联高亮。并实现 T4 和 T5 的存入笔记管线。

### 要做的

1. **实现 `notes.ts` 全部函数**
   - `notes/` 目录不存在时 `mkdirSync(dir, { recursive: true })`
   - `writeNote({ title, source_url, site_name?, markdown, summary?, tags? })`
     - 生成 id = genNoteId()
     - 写 `notes/{id}.md`（markdown 参数直接写入）
     - 写 `notes/{id}.meta.json`（完整 NoteMeta）
     - 读 notes-index.json → push 新条目 → saveNotesIndex
   - `listNotes(limit, tag, search)`
     - 读 notes-index.json → 按 saved_at 倒序
     - 如果 tag 参数 → 只保留 tags 里包含的
     - 如果 search → title 里包含
     - limit 有就 slice(0, limit)

2. **T4 「存入笔记」IPC**
   - `ipcMain.handle("notes:saveHighlight", async (_evt, { url, highlights }) => { ... })`
   - 取该 URL 的 Readability textContent（如果缓存里没有，就重新 extractReadable）
   - 用 Turndown 把高亮 HTML 转 Markdown
   - AI 总结作为 summary 字段写入
   - 调 writeNote()
   - 返回新笔记的 meta 给阅读模式页 → toast「已存入笔记库」

3. **T5 「确认键存」IPC**
   - `ipcMain.handle("notes:saveFullPage", async (_evt, { url, title, markdown, summary, wordCount }) => { ... })`
   - 直接调 writeNote()
   - meta 里加 `word_count`、`summary`

4. **Turndown 配置**
   - 新建 turndown 实例：`new Turndown({ headingStyle: "atx", bulletListMarker: "-" })`
   - 关键：让 `<mark data-chunk-id="xxx">` 保留原文本，不额外处理样式（Markdown 没有高亮概念）

5. **跑 typecheck 和 test**

### 验收
```
打开 https://www.gov.cn 换成阅读模式
打开 AI伴读 → 划线 → 存入笔记
关掉 Sparo 重开
看 notes-index.json
```
预期：
- [ ] `%APPDATA%\sparo-store\notes\notes-index.json` 新增一条
- [ ] 对应目录下有 `{id}.md` 和 `{id}.meta.json`
- [ ] `.meta.json` 包含 id、kind、title、source_url、saved_at
- [ ] `.md` 包含选中文本 + AI 总结
- [ ] 「一键盘存」后同样检查，word_count 和 summary 有值

### 不回归
- [ ] 出行/比价/调研不受影响
- [ ] 飞书不受影响

---

## T7 · 侧栏笔记列表 UI

### 前置
T1, T6 完成。

### 目标
侧栏增加「我的笔记」入口。点开弹层显示笔记卡片列表，卡片标题可点 → 新开笔记详情标签。

### 要做的

1. **侧栏按钮**
   - 在现有四件实事（总结/填表/回复/发布）下方，加一个分隔线 + 「📚 我的笔记」按钮
   - 位置和样式对齐侧栏现有按钮

2. **弹层 UI**
   - 点击按钮 → 侧栏对话区被笔记列表覆盖（或滑出一个弹层）
   - 列表是卡片式，每张卡片：
     - 标题（大号加粗）
     - 来源域名 + 保存时间（灰色小字）
     - tags chips（可选，有标签才显示）
     - 点卡片 → 新开标签页渲染笔记详情
     - 右键卡片 → 删除（删 .md + .meta.json + 更新 index）

3. **笔记详情渲染**
   - 点卡片 → 主进程读 meta.json + .md → 复用 `readingReportHtml()` 渲染
   - 新开标签加载 HTML

4. **搜索**
   - 弹层顶部有一个小搜索框
   - 输入 → 实时过滤（title + source_url 包含匹配）

5. **跑 typecheck 和 test**

### 验收
```
（先让 Cursor 做 T4+T6 存入几篇笔记）
点侧栏「📚 我的笔记」
```
预期：
- [ ] 弹层显示卡片列表
- [ ] 点某张卡片 → 新开标签显示笔记详情（Markdown 渲染正确）
- [ ] 搜索框输入标题关键词 → 实时过滤
- [ ] 右键删除 → 文件删除，列表刷新
- [ ] 空列表时显示「还没有笔记，去阅读模式里试试吧」

### 不回归
- [ ] 四件实事不受影响
- [ ] 出行/比价/调研手册正常打开

---

## T8 · intent-router 路由 + MCP notes_list

### 前置
T6, T7 完成。

### 目标
侧栏口令「把这页换成阅读模式」走正确路由（不被 page_text 截胡）；MCP 暴露 notes_list 让 Cursor/Claude 能读。

### 要做的

1. **intent-router.ts 新增三种 intent**
   - 新增正则匹配：`reader_mode_re = /阅读模式|护眼|reader/i`
   - 新增正则匹配：`notes_action_re = /保存.*笔记|存这页|加笔记|一键盘存/i`
   - 新增正则匹配：`notes_search_re = /笔记.*搜|我的笔记|列出.*笔记|笔记列表/i`
   - 路由顺序调整（在 page / read / llm 之前）：
     ```
     feishu → travel → mission → ★ reader_mode → ★ notes_action → ★ notes_search → leftover → page/read → llm
     ```
   - 新增类型导出：`ChatAction` 加 `kind: "reader_mode" | "notes_action" | "notes_search"`

2. **browser.ts 新增 handler**
   - case `reader_mode`: 调 reader.ts 的 extractReadable + openReaderModeTab
   - case `notes_action`: 触发一键盘存管线（T5）
   - case `notes_search`: 触发侧栏笔记列表 UI（T7）

3. **MCP tools/index.ts 加 notes_list**
   - 工具名：`notes_list`
   - 参数 schema：`{ limit?: number, tag?: string, search?: string }`
   - handler：调 notes.ts 的 listNotes()，返回 JSON
   - 加一条单测：调用 `notes_list` 空目录返回 `[]`

4. **跑 typecheck 和 test**

### 验收
侧栏口令：
```
把这页换成阅读模式
打开 AI伴读
保存这页到笔记
在我的笔记里搜 gov
列出最近保存的 10 篇
```
预期：
- [ ] 「把这页换成阅读模式」→ 正确开阅读标签（不是读页总结）
- [ ] 「保存这页到笔记」→ 正确触发一键盘存
- [ ] 「在我的笔记里搜」→ 打开笔记列表 + 过滤
- [ ] 「列出最近保存的 10 篇」→ 侧栏直接输出列表文本
- [ ] MCP `GET http://127.0.0.1:3921/health` 正常；`notes_list` 工具能在 MCP 客户端里被枚举

### 不回归
- [ ] 出行/比价/调研不受影响
- [ ] 飞书不受影响
- [ ] 四件实事不受影响
- [ ] `npm run typecheck` 通过
- [ ] `npm test` 全部通过（新增 intent-router 测试 + MCP notes_list 测试）

---

## 每次发给 Cursor 时的标准格式

每个 task 单独发，格式：

```
## [任务编号] · [任务名]

### 目标
（一句话）

### 前置依赖
T[x], T[y] 完成

### 要改的文件
- [路径1] · [改什么]
- [路径2] · [改什么]

### 技术约束（红线）
- 复用 report-html.ts 的 readingReportHtml / markdownToHtml
- 高亮数据按 URL 存 highlights.json（不是 sessionStorage）
- AI 总结先进预览区再落盘，禁止无声写入
- 新增 npm 依赖用 npm.cmd（Windows PowerShell）
- 跑完 npm run typecheck 和 npm test

### 验收口令
```
侧栏原句 1
侧栏原句 2
```
预期：[检查项列表]

### 不回归
- [ ] 出行/比价/调研不受影响
- [ ] 飞书不受影响
- [ ] npm run typecheck 通过
- [ ] npm test 全部通过
```

---

## 交付节奏

| 时间 | 做什么 |
|---|---|
| 现在 | 产品书（PRD）+ 任务书（本文）都写完 |
| 下一轮 | 发 T1 给 Cursor |
| Cursor 交回后 | 我验收 → 通过则发 T2，不通过则修 |
| 以此类推 | T1→T2→...→T8 |
| 全部完成 | v0.2.0 验收清单走一遍 → 写 CHANGELOG → 准备发布 |

---

## 参考文档

- 产品 PRD：[READING-ASSISTANT-PRD.md](./READING-ASSISTANT-PRD.md)
- 现有架构：[ARCHITECTURE.md](./ARCHITECTURE.md)
- 现有代码：`src/main/agent/report-html.ts` （复用 readingReportHtml / markdownToHtml）、`src/main/browser.ts` （IPC handler 模式参考）、`src/main/agent/intent-router.ts` （路由模式参考）、`src/main/mcp-server.ts` + `src/main/tools/index.ts` （MCP 暴露参考）
- 红线：根目录 `AGENTS.md`（数据在本机、不自动写回用户数据、先 QA 再验收）
