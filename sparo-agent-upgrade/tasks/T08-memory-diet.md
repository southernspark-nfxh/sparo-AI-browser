# T08 · 体验·内存强化

> 线：E（体验） · 依赖：T05 已合并 · 风险：低 · 与 T06/T07 并行开工（函数域不重叠）
> 代码根：`d:\download\sparo上架应用商店版`
> 先读：根目录 `AGENTS.md`、`docs/ARCHITECTURE.md`、`sparo-agent-upgrade/PLAN.md`（红线在其中）

## 目标

Electron 的内存下限降不了，但**闲置标签可以无限接近零**。三件事：

1. 后台任务完成 → 报告写盘 → 该 agent 标签立即休眠（释放渲染进程），标签栏记录保留。
2. 报告/阅读页打开时复用同一个「阅读器标签」，不再每次新开 WebContentsView。
3. `memorySaver` 默认开启（老用户配置不动）。

## 现状（证据）

- 休眠机制已有：[browser.ts](file:///d:/download/sparo上架应用商店版/src/main/browser.ts) `discardTab`（约 872 行）、`autoDiscardIdleTabs`（约 945 行，30 秒扫一次，空闲超时休眠非活动标签）。
- T05 已建：`releaseAgentTab(tabId)` 接口（当时留空，本任务接休眠）。
- 报告打开：`report-html.ts` `writeHtmlReport` 写盘 + `openFile` 开标签；每次报告一个新标签。
- 设置：`settings/store.ts` `ReaderPrefs` / `memorySaver` / `memorySaverIdleMinutes`。

## 改动清单

### 1. 任务完成即休眠

- `releaseAgentTab(tabId)` 实现：报告文件写盘完成后 `discardTab(tabId)`；标签栏显示灰点+「已完成」状态，用户点它再 `wakeTab`。
- 前提检查：该标签没有 waiting_human（有的话不休眠，等人）。

### 2. 阅读器标签复用

- browser.ts 加 `private readerTabId: string | null`。
- 打开报告/阅读模式时：`readerTabId` 存在且未关闭 → 复用该标签 `loadURL(file://…)` 并 switchTab 过去；否则新建并记录 id。
- 报告标签允许用户手动关闭（置空 readerTabId）；复用不适用于「用户手动新开的研究页」。

### 3. memorySaver 默认开

- `settings/store.ts` 默认值改 `memorySaver: true`、`memorySaverIdleMinutes: 5`；已存在的 settings.json 不迁移（用户关过的保持关）。
- 侧栏设置区文案确认已有开关即可，不加新 UI。

### 4. 内存看板（轻量）

- 侧栏「内存」按钮现有行为是手动休眠全部空闲标签——保持不变；按钮 title 里补显示当前标签进程占用（`webContents` 无直接 API，用 `process.getProcessMemoryInfo()` 或 app.getAppMetrics() 汇总渲染进程数与内存，显示「N 个标签进程 · 约 X MB」）。

### 5. 单测 `tests/memory-diet.test.ts`

- releaseAgentTab 触发 discard；waiting_human 不 discard；readerTabId 复用/失效重建；memorySaver 默认值。
- 现有全部测试绿。

## 禁区

- 不改 `autoDiscardIdleTabs` 的扫描节奏（30s）和算法，只改默认值。
- 不做「标签压缩到磁盘」之类的 Chromium 级hack。
- 不碰 `docs/listings/`、`cloud/`、`envs/`、`cs/`。

## 验收

1. 连续跑 3 个后台任务 → 每个完成后对应标签 30 秒内被 discard → 任务管理器渲染进程数回落。
2. 连续出两份报告 → 只有一个阅读器标签被复用。
3. 全新安装（删掉 `%APPDATA%\sparo-store\settings.json` 模拟）→ memorySaver 默认开。
4. 侧栏内存按钮显示进程数与占用估算。
5. `npx vitest run` 全绿。

交付物：commit + typecheck/test 输出 + 2 张截图（内存按钮看板、任务管理器前后对比）。

## Commit

`feat(t08): 任务完成即休眠、报告标签复用、内存看板`
