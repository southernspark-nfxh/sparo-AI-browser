# 打包通知书 — 待打包 0.7.7（2026-11-17 晚）

给打包 / 同步窗口执行。本文件已按当前仓库状态重写，**以本份为准**。

---

## 一、要打什么（一句话）

打 **0.7.7**：侧栏发稿不再复读索要稿件目录；任务卡住时不再「自问自答」。

版本号已由本轮改成 0.7.7，直接 `npm run dist` 即可，产物应为 `release\Sparo-Setup-0.7.7.exe`。当前对外安装包仍是 0.7.6。

---

## 二、推送状态

- 上一轮的「侧栏发稿链路」已在 `8b866be feat(agent): 侧栏发稿链路接入 run_skill 参数透传与微信识别`，**已提交并已推送**（`master` 与 `origin/master` 同步，0 个未推送提交）。不要再重复处理那份 12 文件清单。
- 本轮 0.7.7 的改动随本通知书一起提交推送；如果打包窗口看到本文件但 `git status` 里仍有下列文件未提交，说明推送还没走完，先提交再打包。

---

## 三、本轮文件清单（8 个）

### A. 主进程（侧栏对话）

| # | 文件 | 变更 | 说明 |
|---|---|---|---|
| 1 | `src/main/agent/intent-router.ts` | 1 行 | `agentCapabilityBrief` 的发布段：改成「只问一次 + 三条走法 + 不确定先 `match_skill`，不得声称技能库没有」 |
| 2 | `src/main/agent/free-soul.ts` | 1 行 | 系统提示词发布规则同上口径 |
| 3 | `src/main/agent/types.ts` | 1 行 | `slotAsk("articleDir")`：「稿件目录在哪？也可以直接把标题和正文贴给我，或先打开编辑器再贴。」 |
| 4 | `src/main/agent/loop.ts` | 1 行 | 缺平台又缺目录时的合并提问，补上「贴正文 / 先开编辑器」两条走法 |
| 5 | `src/main/browser.ts` | +7/−7 | `watchPageTool` 不再在任务运行中自动把帮助问句答成「先不管」；`answerLearning` 增 `silent`；`skipLearning(silent)` |

### B. 文档 / 版本

| # | 文件 | 变更 | 说明 |
|---|---|---|---|
| 6 | `docs/DECISION-POINTS.md` | +2/−1 | 新增 #64「运行中的帮助问句不自己答」；#61 补「只问一次 + 三条走法」 |
| 7 | `CHANGELOG.md` | 新增 0.7.7 段 | 标明 **待打包**，安装包未构建 |
| 8 | `package.json` + `package-lock.json` | 版本 0.7.6 → 0.7.7 | 只改版本字段，其余不动 |

---

## 四、不要动的

工作区还有这些**不属于本轮**，不要混进 0.7.7 的提交：

```
 M strategies/skills/social-media-publish/scripts/adapters/baijiahao.mjs   （非本轮改动，改动者待确认）
 M strategies/skills/social-media-publish/scripts/adapters/toutiao.mjs     （同上）
 M strategies/skills/social-media-publish/scripts/page.mjs                 （同上）
?? .uploads/                    — 临时上传目录
?? _probe_wechat.mjs            — 探针脚本
?? src/renderer/public/favicon.ico  — 来路不明
?? wx_login_qr.png / wx_qr.png / wxpub.png / wxpub_qr.png — 登录二维码截图
?? 发布包/                       — 稿件素材目录
```

3 个 adapter 脚本是别的工作流留下的，打包前请找改动者确认；**不要 `git add -A`**。

---

## 五、建议提交（只 add 本轮文件）

```powershell
git add src/main/agent/intent-router.ts `
        src/main/agent/free-soul.ts `
        src/main/agent/types.ts `
        src/main/agent/loop.ts `
        src/main/browser.ts `
        docs/DECISION-POINTS.md `
        CHANGELOG.md `
        package.json `
        package-lock.json `
        docs/NOTICE-20261117-AGENT-PUBLISH-HOOK.md
git commit -m "fix(agent): 发稿追问只问一次并给贴正文走法；任务运行中帮助问句不再自答"
git push origin master
```

---

## 六、打包与核对

```powershell
npm run dist
```

装完核对 3 条：

1. **发稿**：侧栏说「头条号」→ 只问一次，回复里应同时出现「稿件目录」「直接把标题和正文贴给我」「先打开编辑器」三种走法，不重复复读同一段。
2. **贴正文**：接着把标题和正文贴进对话 → 应直接开编辑器填稿，不再回头要目录。
3. **卡住**：任意页面里制造一次点不动的按钮 → 只能看到**一条**提问，不应再出现紧跟着的「好，先继续。」。

`app.asar` 里不需要新增技能文件——0.7.4 的 `social-media-publish.json`（v3）与 `weixin-publish.json` 已经在包里。

---

## 七、红灯

1. **主进程不热更**：不重打包，侧栏行为不会变。现在跑着的 0.7.6 是 17:47 打的，不含本轮提示词。
2. **不要在 Sparo 运行时改 `%APPDATA%\sparo-store\skills\*.json` 期待生效**：只在启动时 seed，要重启。
3. **不要替用户恢复被改过的技能 JSON**：`source=taught` 的用户技能不会被覆盖。
4. **不要把「待打包」写成已发布**：0.7.7 的安装包、字节数、SHA-256、G1–G3 复测结果都还没有，打完后按惯例补进 `docs/PRODUCT-TASKBOOK.md`。

---

## 八、如实说明

本轮只过了类型检查和单测（139 文件 / 1062 条全绿），**没有在真机侧栏手测**——按用户要求先只留代码、暂不打包。上面第三节的 3 条核对，请在装完新包后实测一遍再对外说好。
