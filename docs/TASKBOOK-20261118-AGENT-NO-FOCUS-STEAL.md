# 任务书：Agent 不得抢活人焦点（人机共用工红线）

- 日期：2026-11-18
- 执行者：Cursor
- 仓库：d:\download\sparo上架应用商店版（商店版主线，先读根目录 AGENTS.md）
- 版本去向：并入尚未打包的 0.7.7，不另加号
- 一个 commit 交付，改完先自测，再交回由人复核

## 一、背景（30 秒）

Sparo 是人机共用浏览器。
活人正在打字时，Agent 的任何操作都不许把键盘焦点抢走。
用户实测：在输入框打几个字，光标就被抢，必须点一下输入框才能继续，循环往复。
昨天 0.7.3 只修了「壳层自愈摘挂」那一条抢焦点路径。
今天 QA 确认：Agent 操作抢焦点这条路一条都没堵，问题原样存在。

## 二、根因（已 QA 定位，含证据）

打字保护（typing 心跳 + shellIsTyping）目前只接在两条路上：自愈摘挂（browser.ts L3987）、壳层卡死恢复（L4364）。
下面四条抢焦点路径全部没有门禁：

1. 点击抢焦点：trustedClickAt（src/main/browser.ts L12125-L12215）用 sendInputEvent 注入鼠标，点到输入类元素时页面请求键盘焦点，活人光标即丢。
2. 填表兜底抢焦点：fill 兜底脚本在页面里执行 el.focus()（L14101、L14178），Electron 多视图下直接把窗口键盘焦点从活人输入框拉走。
3. 切标签抢焦点：focusActivePage（L4518-L4533）只在上游有 actor 且窗口不归属时才避让；内部调用无 actor 时裸调 wc.focus()。典型：releaseRender 恢复标签（L9386）不带 focus:false。
4. 保护罩有盲区：typing 心跳只认壳层（侧栏/地址栏）输入框；活人在「网页内输入框」打字时保护罩不启动，也不会启动。

日志证据：%APPDATA%\sparo-store\diag\click-1794982193581.json，14:09:53 Agent 点击时 isFocused=true（窗口正被活人握着焦点），同期活人打字连续被抢。

## 三、改什么（按文件，均在 src/main/）

### 1. browser.ts：新增统一人机门禁

- 新增字段：每窗口记 mainHumanTypingAt（时间戳）。
- 采集点：attachChromeShortcuts（L3160-L3164）已有的 before-input-event 管道里，input.type 为 keyDown/char 时，记该窗口 mainHumanTypingAt = now。
- 说明：Agent 打字走 CDP Input.insertText 与 execCommand，不触发 before-input-event，所以这条管道收到的键盘事件即真人输入；若实测发现有 agent 注入走 sendInputEvent 键盘事件，须在注入期间对该 wc 加排除标记，不许让 Agent 自触发门禁把自己锁死。
- 新增函数 humanTypingRecently(winId)：shellTypingAt（现有 L4447 壳层心跳）与 mainHumanTypingAt 任一在 1.5 秒内即 true。
- 原有 shellIsTyping 与心跳机制不动，只做加法。

### 2. browser.ts：四条路径全部接门禁

- focusActivePage（L4518-L4533）：函数最前面加 humanTypingRecently 门禁，人在打字就直接 return，不看有没有 actor。
- releaseRender（L9386）：恢复标签改为 switchTab(prev, { focus: false, userAction: true })，本来就不该抢。
- fill 兜底（L14101、L14178 两处 el.focus()）：外层查门禁。人在打字时不走 el.focus() 路径，改走已有的 value setter + input/change 事件兜底（L14111-L14117 已存在，等于把兜底顺序前移）。
- trustedClickAt（L12125）：入口查门禁。人在打字时延迟 1 秒重试，最多 5 次；仍撞门禁就返回明确报错（带「活人正在打字」说明），不许静默假死，也不许丢任务。

### 3. 门禁触发要留痕

- 门禁拦下动作时 noteHang 一条：[focus-guard] defer kind=click/fill/focus win=... 。
- 目的：后续 QA 直接看 %APPDATA%\sparo-store\diag\crash.log 就能数出拦了多少次。

### 4. 测试与文档

- 补单测：humanTypingRecently 判定、focusActivePage 门禁、fill 兜底跳过 el.focus()、trustedClickAt 延迟重试。
- 在 docs/specs/sidebar-focus-theft/spec.md 追加「2026-11-18 补丁：Agent 操作门禁」一节，写清四条路径与门禁规则。
- CHANGELOG.md 0.7.7 条目里加一行对外说明：Agent 后台操作不再打断正在打字的用户。
- 不许改 docs/listings/。

## 四、红线

- 主进程不热更，走正常发版流程。
- 云端 Key 不进客户端。
- 门禁只延迟 Agent 动作，不许吞任务：超时必须有降级或明确报错。
- 「人打字」判定只认真人键盘路径，Agent 自己的注入不许触发门禁。
- 原有 0.7.3 修复（摘挂/退避/焦点归还）逻辑不许动。
- 不做本次任务范围外的重构。

## 五、自测（交回前 Cursor 必做）

- npm run build 通过，单测全绿。
- npm run start 手测：侧栏输入框连续打字 60 秒，另一窗口用 MCP 循环 click+fill 同窗口后台标签，侧栏光标零丢失。
- 手测：网页内输入框打字，后台 Agent 并发操作，网页输入框光标零丢失。
- crash.log 里能看到 [focus-guard] defer 记录。
- 回归 G1、G2、G3（docs/QA-GOLDEN-SCENARIOS.md）。

## 六、提交

- 一个 commit，消息：fix(focus): Agent 后台操作不再抢打字用户的键盘焦点——click/fill/切标签四路接人机门禁。
- 交回内容：commit 号 + 自测结果清单，由人复核后再谈打包。

## 七、绝对路径速查

- 主改文件：d:\download\sparo上架应用商店版\src\main\browser.ts
- 壳层心跳（参考，不动）：d:\download\sparo上架应用商店版\src\renderer\shell.html、src\main\shell-preload.ts
- 上次修复 spec：d:\download\sparo上架应用商店版\docs\specs\sidebar-focus-theft\spec.md
- 焦点工具（参考现有避让机制）：d:\download\sparo上架应用商店版\src\main\shell-focus.ts
- 日志证据：C:\Users\60914\AppData\Roaming\sparo-store\diag\crash.log
