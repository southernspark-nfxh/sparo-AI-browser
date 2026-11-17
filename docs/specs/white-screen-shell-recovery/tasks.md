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
- [x] T12 提交并推送 GitHub：`d70515a`（`30fccc3..d70515a master -> master`）。同一提交带入工作区在飞的媒体工作台/标签持久化改动（`studio-*`、`tabs-session`、`execute-wrapper` 及其测试），`browser.ts` 两边交织无法拆分，已在提交说明里写明
- [x] T13 0.6.5 补丁：壳层心跳带 `document.visibilityState`，文档隐藏零帧不判停帧（新增用例）；与工作区媒体工作台/标签会话/发布适配器改动一起汇总打包 0.6.5
- [x] T14 0.7.1：重绘只留一次（`SHELL_PAINT_RELOAD_AFTER_REPAINTS` 3→1、冷却 1.5 秒）；心跳断 4 秒判死直接重启；心跳在、0 帧先 `remountShell()`（hide/show，不重载、不抢焦点）；`backgroundThrottling:false` + `disable-backgrounding-occluded-windows` / `disable-renderer-backgrounding`；`PerformanceObserver` 长任务随心跳上报。安装包级卡死恢复 9.8 秒 → 6.7 秒
- [x] T15 0.7.2：查出 `restore` 回调与最小化回调都会重新下发 `setBackgroundThrottling(true)`，把创建时的 `backgroundThrottling: false` 关回去——节流一开就不会自己关，窗口被判遮挡后 rAF 整条停掉。改为壳层永不节流；`disable-features` 增加 `CalculateNativeWinOcclusion`；`invalidateShell` 去掉 `getZoomFactor / setZoomFactor` 同步 IPC；长任务字段 `{d}`→number 修正；首屏 15 秒内无心跳的 `unresponsive` 不重挂窗口；`settings` 未加载时诊断不再抛 `apiKey`
- [x] T16 0.7.2 验证：`tsc --noEmit` 0 错误；`vitest run` 137 文件 / 1052 条全绿（节流用例改为「壳层永远不节流」）；安装包级卡死恢复 6.7 秒；最小化/还原 A/B 未复现（已装 0.7.0 与新包还原后都 61 帧/秒，遮挡场景仍未知）；`release\Sparo-Setup-0.7.2.exe`（105,005,947 字节，2026-11-17 12:37:57）
- [x] T17 0.7.1 / 0.7.2 文档与提交：`CHANGELOG.md`、`docs/QA-GOLDEN-SCENARIOS.md`、`docs/DECISION-POINTS.md` #60、`AGENTS.md` 版本口径
