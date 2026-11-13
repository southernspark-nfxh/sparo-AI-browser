# 0.6.6 任务清单

对应 [spec.md](./spec.md)。按顺序做，每步做完立刻验证。

## 一、对话栏看不到对话

- [x] **A. 坏帧不清空**（`src/renderer/shell.html` `applyChatFrame`，并同步 `sidebar-sync.ts`）
  - 全量帧但 `chat` 非数组 → 不清空，请求全量。空数组仍清空。
  - 包上没有 `chatSync` → 视为非对话包，原样返回。
  - 壳层继续保存完整对话对象（role / text / 图片 / 引用 / 文档卡）。

- [x] **B1. approvals 守卫**（`src/main/browser.ts` `pruneStaleApprovals`）
  - `approvals` 不是 `Map` 时返回 0，不抛 `map is not iterable`。`[...approvals.values()]` 同样兜住。

- [x] **B2. 推送兜底**（`flushSidebarState`）
  - catch 内调 `pushSidebarFallback()`，只推对话帧 + 会话/运行态，标 `degraded`。

- [x] **B3. 字段级降级**（`getSidebarPayload`）
  - `skills / lessons / triggers / plan / tasks` 走 `safeList` / `safeValue`。

- [x] **C. 乐观回显**（`shell.html`）
  - 新增 `chatEcho`、`pushEcho`、`dropEcho`、`paintEcho`、`consumeChatEcho`。
  - `sendChat` 发出后立即回显；失败则撤掉。`renderChat` 末尾重绘回显；正式对话里新出现的用户句一对一去掉回显。
  - 样式 `.bubble-row.echo { opacity: .6 }`。

- [x] **D. 视图宽度钳制**（`page-bounds.ts` + `browser.ts`）
  - 硬上限 = 客户区宽 − 当前侧栏宽。56 只在侧栏宽度未知时兜底。
  - `pageBounds()` / `mountPageView()` / `parkPageView()` 在 `setBounds` 前夹进页面洞。
  - 活动页盖住壳层时不进 10 秒冷却。

- [x] **E. 查询不推进游标**（`browser.ts`）
  - `spark:get-status` 和 `sidebarPayloadDiag()` 走只读对话帧。只读不补序号、不推进游标、不清 `chatResync`。

## 二、关掉所有今日头条网页不动

- [x] **F. 工具声明**（`src/main/agent/free-soul.ts`）
  - 类型联合 + `list_tabs / switch_tab / close_tab / close_tabs` 四条声明 + 系统提示。批量必须带 match，命中含当前页。

- [x] **G. 工具实现**（`src/main/browser.ts`）
  - `runCoreTool` 分发；`listTabsTool / switchTabTool / closeTabsTool`。
  - `closeTabsTool`：批量必须带 match；命中的页包括当前页一起关；`keepActive: true` 才留当前页；跳过工作台/阅读页。
  - `switchTabTool` 走 `switchTab()`。

- [x] **H. 关完当前页后的落点**
  - `closeTab` 在只剩一页时开 `about:blank`，否则唤醒相邻页。

## 三、测试

- [x] `clampPageView`：超窗宽 / 超洞宽 / y 进顶栏；侧栏未知时才退到 56。
- [x] `applyChatFrame`：壳层那份 `chat` 非数组时 `texts` 不变；无 `chatSync` 时完全不动；对象字段保留。
- [x] `pickTabsToClose`：match 命中多页且含当前页、`keepActive` 留当前页、跳过工作台/阅读页、无 match 失败。
- [x] `npm run typecheck`、`npm test` 全绿。

## 四、自测（人测前必须自己点通）

- [ ] 发「帮我打开今日头条」→ 右侧立即出现自己的消息。
- [ ] 连发 3 条，回显不重复。
- [ ] 打开 2 个头条页 + 1 个其他页，发「关掉所有今日头条相关网页」→ 头条页全关、回执数量正确。
- [ ] 最大化 / 还原 / 切标签各 3 次，侧栏始终可见。
- [ ] `crash.log` 无新增 `map is not iterable`、无新增 `reason=width dw=`。

## 五、版本、文档、打包

- [ ] `package.json` / `package-lock.json` → `0.6.6`
- [ ] `CHANGELOG.md` 新增 0.6.6 段
- [ ] `AGENTS.md`：版本口径改 0.6.6；补「关标签先 `list_tabs`，批量用 `close_tabs`」
- [ ] `docs/PRODUCT-TASKBOOK.md`：记录本轮两项修复
- [ ] `npm run dist` → `release\Sparo-Setup-0.6.6.exe`，记录大小与 SHA-256
- [ ] 复测 G1 / G2 / G3
- [ ] 提交并推送 GitHub
