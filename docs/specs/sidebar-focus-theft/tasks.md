# Tasks：侧栏打字被抢焦点（0.7.3）

- [x] T1 `page-bounds.ts`：新增 `remountBlockedByTyping` / `coverHealBackoff` 纯函数
- [x] T2 `shell-preload.ts` + `shell.html`：心跳带 `typing`
- [x] T3 `browser.ts`：`shellTypingAt`、`shellIsTyping()`、`onShellHeartbeat` 写入
- [x] T4 `browser.ts`：`healCoveredChrome` 退避（`remounted` 后不再清账、活动页也受冷却）
- [x] T5 `browser.ts`：打字时跳过 `remountCoveredActiveView`
- [x] T6 `browser.ts`：`remountCoveredActiveView` / `remountShell` 摘挂后恢复壳层焦点；打字时 `remountShell` 只 invalidate
- [x] T7 新增 `tests/shell-focus-typing.test.ts`
- [x] T8 版本 0.7.3 + CHANGELOG + DECISION-POINTS + QA 底账 + AGENTS.md
- [x] T9 typecheck + 单测 + 开发窗实机 60 秒输入 + 打包 + 安装包停帧复测
- [x] T10 提交并推送
