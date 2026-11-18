# 打包通知书 — 0.7.7（2026-11-18，以本份为准）

给打包窗口执行。本份取代 `NOTICE-20261117-AGENT-PUBLISH-HOOK.md`（那份的改动已提交，一并进包）。

## 一、要打什么（一句话）

打 **0.7.7**：发稿追问只问一次 + 任务卡住不自问自答 + **Agent 后台操作不再抢打字用户的键盘焦点**。

版本号已在 package.json（0.7.7），`npm run dist` 产物应为 `release\Sparo-Setup-0.7.7.exe`。当前对外安装包仍是 0.7.6。

## 二、推送状态（先处理这个再打包）

- 焦点门禁提交 `f6855b8` 已 commit、**尚未 push**。第一步：`git push origin master`。
- 工作区还压着**另一批未提交改动**（agent-integrity 修复批次：`src/main/agent/*`、`src/renderer/studio.ts`、几十个 `strategies/skills/*.json`、配套 tests、`src/main/agent/task-summary.ts` 等，另有 `docs/QA-AGENT-INTEGRITY-*` / `docs/TASKBOOK-*-INTEGRITY-*` 一批文档）。
- **拍板规则**：那批不属于焦点门禁，归属另一个窗口。打包前二选一：
  1. 该批次负责窗口已确认要进 0.7.7 → 让他们先提交推送，再打包；
  2. 不进 0.7.7 → 打包窗口 `git stash push -u -m "agent-integrity-暂存"` 后按干净 master 打包，打完 `git stash pop` 还回去。
- 不许 `git add -A`。`发布包/`、`.uploads/`、`_probe_wechat.mjs`、`wx*.png`、`摩点待发货订单-*.csv`、`src/renderer/public/favicon.ico` 一律不进提交。

## 三、0.7.7 包含的两轮改动

| 轮 | 提交 | 内容 |
|---|---|---|
| 1 | `9bbd24e` | 发稿追问只问一次、给贴正文走法；任务运行中帮助问句不再自答（决策点 #64） |
| 2 | `f6855b8` | 人机焦点门禁：活人打字（壳层心跳或网页按键，1.5 秒内）时，click 让开最多 5 次后报「活人正在打字」并取消，fill 改走 value setter，切标签不再 `wc.focus()`；Agent 自身键盘注入不计为真人（决策点 #67） |

`7b0661b` 是纯文档同步，随包无影响。`app.asar` 无需新增技能文件。

## 四、装完新包核对 5 条

1. **发稿**：侧栏说「头条号」→ 只问一次，回复同时给「稿件目录 / 直接贴标题正文 / 先开编辑器」三种走法，不复读。
2. **贴正文**：把标题正文贴进对话 → 直接开编辑器填稿，不再回头要目录。
3. **卡住**：制造一次点不动的按钮 → 只出现一条提问，不跟着「好，先继续。」。
4. **侧栏打字不被抢**（新）：侧栏输入框连续打字约 30 秒，另一窗口用 MCP 对同窗后台标签循环 click+fill → 侧栏光标全程不丢；click 返回「活人正在打字…本次点击取消」；`%APPDATA%\sparo-store\diag\crash.log` 出现 `[focus-guard] defer kind=click/fill win=...`。
5. **网页输入框打字不被抢**（新）：任一网页输入框打字，后台 agent 并发操作 → 输入框光标不丢、字符连续进框。

第 4、5 条已在 dev 进程（3921）活体复测通过：26 键真人模拟打字全程零丢焦，click 5 次让开日志（08:06:31–35 五条 `kind=click`）、fill 走 `native-value-setter` 且 fill 后焦点仍在原输入框。装包后按上面步骤再对一遍。

## 五、打包与回归

```powershell
npm run dist
```

- 重打包必复测 **G1、G2、G3**（`docs/QA-GOLDEN-SCENARIOS.md`），按底账核对，不看侧栏感觉。
- 打完后把包名、字节数、SHA-256、G1–G3 结果补进 `docs/PRODUCT-TASKBOOK.md`，`CHANGELOG.md` 0.7.7 段去掉「待打包」口径。

## 六、红灯

1. **主进程不热更**：装新包前侧栏行为不会变；当前 3921 上跑的是 dev 进程，打完包装新包前先关它（撞单实例锁会静默退出）。
2. **不要在 Sparo 运行时改 `%APPDATA%\sparo-store\skills\*.json` 期待生效**：只在启动时 seed。
3. **「待打包」不许写成已发布**：装完并核对完 5 条之前，对外口径保持 0.7.6。
4. 不碰 `docs/listings/`；云端 Key 不进客户端；本份通知书随本轮一起提交（连同 `docs/TASKBOOK-20261118-AGENT-NO-FOCUS-STEAL.md` 一并入库）。

## 七、提交建议（文档入库）

```powershell
git add docs/NOTICE-20261118-RELEASE-0.7.7.md docs/TASKBOOK-20261118-AGENT-NO-FOCUS-STEAL.md
git commit -m "docs: 0.7.7 打包通知书——焦点门禁复测通过并并入本轮发版"
git push origin master
```
