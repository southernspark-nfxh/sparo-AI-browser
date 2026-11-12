# Spec：壳层白屏（顶栏 + 右侧栏整块发白）根治

版本目标：0.6.4
状态：待批准
影响范围：只动「壳层（顶栏 / 地址栏 / 标签栏 / 侧栏）自愈」，不动页面视图、标签切换、发布链路。

## 1. 现象（人报）

- 打开 Sparo 后，网页区正常显示，但**顶部（标签栏 + 地址栏）和右侧侧栏整块变成纯白**。
- 必须手动「最小化 → 还原 / 最大化」才恢复。
- 2026-11-12 23:56 在已安装的 0.6.3（`D:\Program Files\Sparo`）上再次复现，用户截图可证。

## 2. 已有证据（`%APPDATA%\sparo-store\diag\crash.log`）

同一次故障（UTC 2026-11-12T15:46、15:56–15:58，即本地 23:46 / 23:56）：

```
[shell-unresponsive] sidebar bytes=-1
[shell-paint] repaint win=main streak=3 count=1 ... maximized=true
[shell-paint] repaint win=main streak=7 count=2
[shell-paint] stalled win=main beats=9 repaints=2
[shell-paint] repaint win=main streak=136 count=39
[shell-paint] repaint win=main streak=137 count=40
```

对整个 `crash.log` 检索 `reload`：**0 条**。

可确认的三件事：

1. 故障时壳层渲染进程被 Chromium 判为 **unresponsive**，帧心跳连续几十拍 0 帧——不是「某一层没画」，是壳层整条绘制链停住，窗口背景色 `#fbfbfd` 透出来就是白。
2. 现有自愈只有两条腿：`webContents.invalidate()` + 缩放轻推；以及 `escalateShellStuck()` 里的 `reload()`。前者推不动已经卡死的渲染进程（日志里连打 40 次全部无效）；后者**一次都没执行到**，即使执行，对不响应 IPC 的渲染进程也只会排队，永远等不到。
3. 人手动「最小化 → 还原」能恢复，说明重建的是**窗口合成表面**，不是网页内容；现有自愈没有做这一步。

## 3. 根因结论

- 白屏的直接原因：壳层渲染进程 / 其合成表面进入不可恢复状态（日志：`unresponsive` + 0 帧）。
- 自愈失败的原因：恢复手段停留在「请求重绘」，没有「重建渲染进程 / 重建表面」；且检测完全依赖渲染进程自己发心跳——一旦它连心跳都不发，主进程这边的状态就冻结，永远不会升级。
- 次要缺陷：`onShellUnresponsive()` 用 `JSON.stringify(getSidebarPayload())` 量体积，序列化抛错后只记 `bytes=-1`，丢掉了真正的错误信息。

## 4. 方案（恢复阶梯，主进程独立看门狗）

### 4.1 检测（两条独立信号，互为兜底）

1. **心跳（现有）**：渲染进程每秒报一次帧数，连续 3 拍 0 帧判停帧。
2. **静默（新增）**：主进程记录每扇窗口「最后一次收到心跳的时间」。窗口 `visible && !minimized && isFocused()` 且 `now - lastBeatAt > 5000ms` → 判壳层已死。这条不依赖渲染进程主动上报，渲染进程彻底卡死也能发现。
3. **unresponsive（新增接线）**：Electron 的 `webContents.on("unresponsive")` 直接标记为已停滞，立即进入恢复阶梯（当前只做 `ensureWindowVisible + armChromeGuard`，等于没治）。

### 4.2 恢复阶梯（同一窗口 120 秒内最多重启一次渲染进程）

- 第 1–2 次：`invalidateShell()`（现有：`invalidate()` + 缩放轻推），无感。
- 第 3 次起，或 `unresponsive` 且已重绘过 1 次：**`win.webContents.forcefullyCrashRenderer()`**。
  渲染进程被杀 → 命中现有 `render-process-gone` 处理器 → 自动 `reload()` 壳层 → `did-finish-load` 里已有 `pushChromeState / pushSidebarState / layout`，界面按主进程状态重建。
  这是唯一对「不响应 IPC 的渲染进程」有效的动作；网页视图是另一个 WebContents，不受影响。

### 4.3 状态复位

- 壳层 `did-finish-load` 时清掉该窗口的 `shellPaint` 状态与 `lastBeatAt`，避免重启后立刻被判死。
- 窗口 `closed` 时清定时器。

### 4.4 诊断修正

- `onShellUnresponsive()` 体积探测改为逐个字段安全序列化，失败时把**错误消息**写进 `noteHang`，不再只留 `bytes=-1`。

## 5. 代码落点

| 文件 | 改动 |
|---|---|
| `src/main/page-bounds.ts` | 新增 `SHELL_HEARTBEAT_GAP_MS = 5000`；新增纯函数 `shellSilentTooLong(lastBeatAt, ctx)`、`shellRecoveryStep(state, unresponsive)`（`"repaint" \| "reload"`）、常量 `SHELL_PAINT_RELOAD_AFTER_REPAINTS = 3` |
| `src/main/browser.ts` | 新增 `shellBeatAt: Map<string, number>`、`startShellWatch()`（1s 定时器，遍历 `liveWins()`）、`forceShellRecovery()`、`restartShellRenderer()`；改 `onShellHeartbeat` 记录 `lastBeatAt`；改 `onShellUnresponsive` 接线恢复阶梯 + 安全体积探测；`did-finish-load` 复位状态；`closed` 清定时器 |
| `src/main/page-bounds.test.ts` | 为两个新纯函数补边界用例（静默判定、阶梯升级、冷却） |

不改：`view.setVisible` / `mountPageView` / `parkPageView` / 标签切换 / 侧栏业务逻辑。

## 6. 验收（必须自己跑过）

1. `npm run typecheck` → 0 错误；`npm test` → 全绿（含新用例）。
2. `npm run start` 启动后，控制台执行模拟：把壳层 `webContents` 打崩（`win.webContents.forcefullyCrashRenderer()` 走同一路径）→ 观察 3 秒内顶栏 + 侧栏重新出现，网页视图不闪退、标签与对话仍在。
3. 观察 `crash.log` 出现 `[shell-paint] restart win=...` 与随后的 `[shell-paint] heartbeat online`，说明重启链路真的跑通（上一版 `reload` 一条都没有，这次必须有账）。
4. 打包 `npm run dist` 产出 `release\Sparo-Setup-0.6.4.exe`；再复测 G1、G2、G3（`docs/QA-GOLDEN-SCENARIOS.md`）。

## 7. 版本与文档

- `package.json` → `0.6.4`
- `CHANGELOG.md` 追加 0.6.4：壳层白屏自愈改为「静默看门狗 + 重启渲染进程」，并写明上一版 `reload` 从未生效的证据
- `docs/DECISION-POINTS.md` 登记一条：壳层连续 5 秒无心跳且窗口在前台 → 允许重启壳层渲染进程
- `AGENTS.md` 版本号口径同步（现 0.6.4）
