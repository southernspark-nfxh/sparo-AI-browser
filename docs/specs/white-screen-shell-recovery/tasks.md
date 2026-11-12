# Tasks：壳层白屏根治（0.6.4）

- [x] T1 `src/main/page-bounds.ts` 增加 `SHELL_HEARTBEAT_GAP_MS`、`SHELL_PAINT_RELOAD_AFTER_REPAINTS`、`shellSilentTooLong()`、`shellRecoveryStep()`
- [x] T2 `tests/page-bounds.test.ts` 补用例：静默超时、最小化/隐藏不判死、阶梯 1–2 次重绘、第 3 次升级、unresponsive 提前升级（16 条全绿）
- [x] T3 `src/main/browser.ts`：`shellBeatAt` 记录最后一次心跳；`onShellHeartbeat` 写入
- [x] T4 `src/main/browser.ts`：`startShellWatch()` 1 秒定时器（遍历 `liveWins()`，跳过最小化/不可见；90 秒内聚焦过仍算人在用），发现静默 → `actOnShellStall()`
- [x] T5 `src/main/browser.ts`：`actOnShellStall()` 按阶梯执行 invalidate / `restartShellRenderer()`；后者 `forcefullyCrashRenderer()` + 120 秒冷却 + 落盘 `[shell-paint] restart`
- [x] T6 `src/main/browser.ts`：`onShellUnresponsive()` 接恢复阶梯；体积探测改为按字段安全序列化并记录错误消息
- [x] T7 `src/main/browser.ts`：壳层 `did-finish-load` 复位心跳账（心跳未知 ≠ 超时）；窗口 `closed` 清看门狗定时器与各 Map
- [x] T8 自测：`npm run typecheck` 0 错误；`npm test` 132 文件 / 986 条全绿
- [x] T9 手动验证（CDP 卡死壳层主线程，复现线上白屏）：5 秒判静默 → 重绘 3 次 → `restart win=main count=4` → `render-process-gone reason=crashed` → `shell-reload forced=true` → 1.2 秒后 `heartbeat online`，页面重建（`vite connected` 第二次），网页视图与标签未受影响
- [x] T10 版本与文档：`package.json` 0.6.4、`CHANGELOG.md`、`docs/DECISION-POINTS.md` #53、`AGENTS.md` 版本口径
- [x] T11 `npm run dist` 产出 `release\Sparo-Setup-0.6.4.exe`（103688818 字节，2026-11-13 00:32:43；退出码 1 只因缺 `GH_TOKEN`）。安装包级实测：卡死壳层 19 秒自动恢复（3 次重绘 → `restart` → `shell-reload forced=true` → 1.2 秒 `heartbeat online`）；自发崩溃 1.5 秒恢复；`navigate` + `page_text` + `/health` 正常。G2/G3 需要已登录微博 + 模型 Key，隔离配置里跑不了，已在 `docs/QA-GOLDEN-SCENARIOS.md` 如实记录
- [ ] T12 提交并推送 GitHub（含本轮白屏修复与本轮之前未提交的工作区改动说明）
