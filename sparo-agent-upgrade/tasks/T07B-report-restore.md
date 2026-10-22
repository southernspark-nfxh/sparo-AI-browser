# T07B · 报告打开不再拉回最小化窗口

> **状态：已派给大脑热修窗口执行中。** 新窗口接手前先 `git log --oneline` 查是否已有 `fix(t07): 报告打开不再拉回最小化窗口`——已存在则本任务书作废跳过。
> 线：体验收尾 · 依赖：140a5f8（T07 主体）已在库 · 风险：低
> 代码根：`d:\download\sparo上架应用商店版`；进场闸门：`git status` 确认 browser.ts 无未提交改动，有则停下报告，不许收编。

## bug

T07 主体已定稿，但报告/手册打开链路会把最小化窗口拉回前台。实测两起：①手册写好后报告页现身窗口；②再最小化约 50 秒后窗口自己弹回，对不上单条 `restore()`。T06 允许后台任务出报告时 switchTab 到报告标签（唯一例外），**restore 一个最小化的窗口不在例外里**。

## 修复

1. 排查 browser.ts 里 `writeHtmlReport → openReport/openFile → switchTab` 整条链路的 `restore()/show()/presentWindow()/focus()` 调用点。最小化状态下出报告：只允许 switchTab + flashFrame，窗口保持最小化；用户点任务栏回来应看到报告标签已切好。
2. 顺带排查 synthesize 完成、侧栏推卡片等其它疑似 restore 源，确认没有第二个弹回路径。
3. 顺手还原 `tests/report-html.test.ts`（内容 diff 为空的行尾痕迹，已挂多轮）：先 `git diff tests/report-html.test.ts` 确认为空，再 `git checkout -- tests/report-html.test.ts`。
4. 验收（开发窗 9333）：最小化状态下后台调研出报告 → 窗口全程不弹、任务栏闪 → 点回来报告已切好；再连跑多个后台任务保持最小化 2 分钟，零弹回。

## Commit

`fix(t07): 报告打开不再拉回最小化窗口`（只提交自己的改动和那一处测试文件还原，给我 test 输出和带时间戳截图）
