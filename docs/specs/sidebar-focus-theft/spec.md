# Spec：侧栏对话框打字时被抢焦点

> 用户原话（2026-11-17）：「我在对话框输入的时候 打字经常失败 就像是 浏览器在争夺对话框的鼠标控制权 它点击了其他地点 以至于让我没法完整的在对话框输入文字 不停的点击对话框 才能继续输入」

## 1. 现象

侧栏 `#chatInput` 输入到一半，焦点被切走（像点了别处），后续按键进了网页；反复点回输入框才能继续。频率「经常」。

## 2. 取证（用户机器 `%APPDATA%\sparo-store\diag\crash.log`）

- 2026-11-16 10:00–10:17、12:51–13:02、13:20 每分钟 **80–138 条** `[chrome-hole-heal]` / `[chrome-hole-action]`；
  2026-11-17 04:23–04:57 仍在按分钟成批出现。
- 同一条标签反复报同一个差异：`old={x:0,y:0,w:1400,h:900}`（整窗）→ `new={x:0,y:76,w:680,h:829}`（页面洞），
  间隔恒为 2 秒；`remount` 之后 `after` 仍等于 `before`（例如 2026-11-07 的 `before=966×829 after=966×829`）。
- 同期还有 `[shell-paint-recover] ... repaint`，对应 `remountShell()` 的 `win.hide()/win.show()`。

## 3. 根因

1. **覆盖自愈不收敛**，每 2 秒做一次视图摘挂。
   - [browser.ts](../../../src/main/browser.ts) `assertChromeHole` 每 2 秒一拍；
   - `healCoveredChrome()`：活动页（`showActive`）**完全绕过 10 秒冷却**；
   - 重排后 `readPageViewBounds` 仍不等于洞时执行 `stalls.delete(tabId)` 并 `return`，下一拍计数从 0 重来 →
     `remountCoveredActiveView()` 的 `removeChildView + addChildView` 每 2 秒一次，永不停止。
2. **摘挂视图会抢焦点**：Windows 上重新 `addChildView` 的 `WebContentsView` 会拿到键盘焦点，壳层 `textarea` 随之失焦；
   `remountShell()` 的 `hide()/show()` 也会打断输入与 IME 组合。
3. 两条自愈路径都不看「人正在输入」。

## 4. 修复（最小集）

### 4.1 壳层上报「正在输入」

- `src/main/shell-preload.ts`：`shellHeartbeat(frames, documentVisible, longTasks?, typing?)`，payload 增加 `typing`。
- `src/renderer/shell.html`（约 4193 行的 1 秒上报）：计算
  `typing = document.hasFocus() && (activeElement 是 TEXTAREA / INPUT / contentEditable)`，随心跳发送。
- `src/main/browser.ts`：新增 `private shellTypingAt = new Map<string, number>()`，`onShellHeartbeat` 收到 `typing` 时写当前时间；
  `resetShellPaintState()` 不清它（重载后仍要挡住 1.5 秒内的摘挂）。
  新增 `private shellIsTyping(winId: string): boolean` = `Date.now() - shellTypingAt < 1500`。

### 4.2 自愈不再每 2 秒摘挂

`src/main/page-bounds.ts` 新增纯函数并在 `src/main/browser.ts` 使用：

```ts
/** 摘挂视图会抢焦点，人正在打字时一律不摘挂。 */
export function remountBlockedByTyping(typing: boolean): boolean
/** 重排没收敛：活动页也要退避，不许每 2 秒重做一次摘挂。 */
export function coverHealBackoff(input: { remounted: boolean; count: number; now: number }):
  | { giveUp: true; retryAt: number }
  | { giveUp: false }
```

- `healCoveredChrome()`：`after` 仍不等于洞且 `remounted` 已为真时，不再 `stalls.delete`，改为
  `stalls.set(tabId, { count: CHROME_HEAL_STALL_LIMIT, reason, retryAt: now + CHROME_HEAL_COOLDOWN_MS, remounted: true })`；
  `showActive` 只在 `!prev?.remounted` 时绕过冷却。
- `shellIsTyping(winId)` 为真时：只 `applyViewBounds(false)`（改尺寸不夺焦点），跳过 `remountCoveredActiveView`。

### 4.3 摘挂后把焦点还给壳层

- `remountCoveredActiveView()` 与 `remountShell()` 前记录 `win.webContents.isFocused()`；
  操作完成后若之前为真，调用 `win.webContents.focus()`（DOM 未重建，caret 自动回到原 textarea）。
- `remountShell()`：`shellIsTyping(winId)` 为真时不 `hide()/show()`，只 `invalidateShell()`，让 1 秒看门狗下一拍再判。

## 5. 不改的东西

- 不动 `WebContentsView` 架构、不动白屏恢复阶梯（`invalidate → remountShell → 重启渲染进程`）、不动侧栏 DOM 结构。
- 不新增「提前结束任务」类本地判断。

## 6. 验证

1. `npm run typecheck`、`npm test` 全绿；新增 `tests/shell-focus-typing.test.ts` 覆盖 `remountBlockedByTyping` / `coverHealBackoff`。
2. 开发窗实机：侧栏连续输入 60 秒，期间拖侧栏宽度、切标签，字符不丢；`[chrome-hole-*]` 每分钟条数从几十降到个位数。
3. 安装包 0.7.3：停帧恢复仍在 10 秒内；G1 复测。
4. 版本 0.7.3 + `CHANGELOG.md` + `docs/DECISION-POINTS.md`（新条目：人打字时不许摘挂视图 / 自愈必须退避）+ `docs/QA-GOLDEN-SCENARIOS.md` 记录 + `AGENTS.md` 安装包行。
