# 打包通知书 — 侧栏发稿链路接通（2026-11-17 下午）

给打包 / 同步 / 推送窗口执行。

---

## 一、改动推送了吗？

**没有。** 全部 12 个文件（10 已跟踪修改 + 2 新增）都在工作区，未暂存、未提交、未推送。

上一个提交是 `116aea7 docs: 勾掉 0.7.3 侧栏焦点任务清单`，当前仓库状态是 v0.7.2 / 0.7.3 之间。

---

## 二、这次改了什么（一句话）

侧栏对话窗口里，用户说"发稿子"时，终于**先问平台和稿件目录，再跑技能**，不再只打开发布页原地不动。微信公众号发布技能也补进了技能种子数据，侧栏能 match 到了。

上一份通知 [NOTICE-20261116-SKILL-WEIXIN-FORMAT-SYNC.md](./NOTICE-20261116-SKILL-WEIXIN-FORMAT-SYNC.md) 讲的是"微信技能打包"；本份讲的是"侧栏对话 → 调技能"这条链。两份都要看。

---

## 三、文件清单（12 个，10 修改 + 2 新增）

### A. 主进程（侧栏对话链路）

| # | 文件 | 变更 | 说明 |
|---|---|---|---|
| 1 | `src/main/agent/slots.ts` | +32/−0 | 新增 `publishSlots()`：从原句认平台词（头条/百家/大鱼/搜狐/微信）与绝对路径；缺哪个记成缺槽；`classifyKind` 把发布意图从 `form` 分支踢出来走专用逻辑 |
| 2 | `src/main/agent/types.ts` | +8/−2 | `GoalFacts` 增 `platform` / `articleDir`；`SlotId` 增 `platform` / `articleDir`；`slotAsk()` 补对应提问 |
| 3 | `src/main/agent/loop.ts` | +22/−3 | `legalSlots()` 发布分支：两个槽都齐才走技能；`compileHeuristicHands()` 发布分支：按 `platform` 挑 skill id + 拼 params（weixin → weixin-publish / 其余四站 → social-media-publish）；`sealWorkOrder()` 把 `goal.known.platform/articleDir` 写入 facts |
| 4 | `src/main/agent/stub.ts` | +1/−1 | `ChatAction.run_skill` 增 `params?: Record<string, unknown>` 字段（之前参数在 skill JSON 里有、但 ChatAction 类型丢了，run_skill 调用时传不下去） |
| 5 | `src/main/agent/browser.ts` | +1/−1 | `executeHand()` 里把 `action.params` 透传给 `runSkillTool()`（之前这行就是丢的） |
| 6 | `src/main/agent/intent-router.ts` | +22/−4 | `SITE_CAPS` 增微信公众号条目（`weixin-publish`）；五站统一加 `needsArticle: true`；`wantsPublish()` 正则扩到微信/公众号/企鹅号；路由层遇到 `needsArticle` 返回 null 交给模型问槽 |
| 7 | `src/main/agent/free-soul.ts` | +2/−0 | 系统提示词：加一条"发稿前必须问齐平台和目录"的规则，让模型窗口同样生效 |

### B. 技能运行时（参数透传 + 微信识别）

| # | 文件 | 变更 | 说明 |
|---|---|---|---|
| 8 | `src/main/skills/runner.ts` | +20/−3 | `social-media-publish` 分支：`PLATFORM_IDS` 加 `weixin`；透传 `theme / images / noDocx / docxImport / env`；公众号返回 `DRAFT_SAVED_ONLY` 时报"已存草稿"而非"发布完成" |

### C. 技能种子数据（侧栏 match_skill 的来源）

| # | 文件 | 变更 | 说明 |
|---|---|---|---|
| 9 | `strategies/skills/social-media-publish.json` | **M** | 升版 v2→v3；`enum` 加 `weixin`；`params` 补 `theme / images / noDocx / docxImport / env`；`agentPlaybook` 补缺槽先问规则 |
| 10 | `strategies/skills/weixin-publish.json` | **新增** | 独立技能条目：id `weixin-publish`，只收 `articleDir`，固定 `--platform weixin` |

### D. 测试 + 决策点

| # | 文件 | 变更 | 说明 |
|---|---|---|---|
| 11 | `tests/brain.test.ts` | +23/−0 | 两条新用例：缺槽时先问不跑技能；槽齐后一步 run_skill、params 正确 |
| 12 | `docs/DECISION-POINTS.md` | +1/−0 | 登记 #61 "发稿缺槽先问，不打开发布页" |

---

## 四、哪些是我的、哪些是别的窗口的

**以上 12 个文件全部是我改的。**

git status 里还显示这两个文件有 M：
- `docs/AGENTS.md` — git diff 无实质性输出，疑似换行符差异
- `strategies/skills/social-media-publish/scripts/engine.mjs` — 同上，diff 为空

这两个**不需要额外处理**，打包时按正常流程走就行。

---

## 五、不要打的 / 不属于本次

```
?? .uploads/                — 临时上传目录
?? _probe_wechat.mjs        — 探针脚本
?? src/renderer/public/favicon.ico  — 来路不明
?? wx_login_qr.png / wx_qr.png / wxpub.png / wxpub_qr.png  — 登录二维码截图
```

**不要提交、不要打包。**

---

## 六、建议提交信息（只 add 上面 12 个，别 `git add -A`）

```powershell
git add src/main/agent/free-soul.ts `
        src/main/agent/intent-router.ts `
        src/main/agent/loop.ts `
        src/main/agent/slots.ts `
        src/main/agent/stub.ts `
        src/main/agent/types.ts `
        src/main/browser.ts `
        src/main/skills/runner.ts `
        strategies/skills/social-media-publish.json `
        strategies/skills/weixin-publish.json `
        tests/brain.test.ts `
        docs/DECISION-POINTS.md
git commit -m "fix(agent): 侧栏发稿链路接通——缺平台/稿件目录先问、run_skill 透传 params、微信技能入种子"
git push origin master
```

---

## 七、打包

### 版本号

当前 `package.json` 是 **0.7.2**。上一个打包是 0.7.0（`f04221c`），中间隔了 `6ce4dfe` / `807673a`（chore(release): 0.7.0 其实是补 0.6.9 的包体信息）、`a7d588a` / `e7a9401` / `116aea7` 三个 0.7.2/0.7.3 的修复提交。

**建议升 0.7.3**（侧栏发稿属于功能修复，不是大版本），由打包窗口按既有流程改 `package.json` / `package-lock.json` / `CHANGELOG.md`。

### 打包本身

```powershell
npm run dist
```

### 打包后核对（5 条）

1. `app.asar` 内能找到 `strategies/skills/weixin-publish.json` 和升版后的 `social-media-publish.json`
2. 安装后首次启动，`%APPDATA%\sparo-store\skills\weixin-publish.json` 会被自动 seed（版本号 1 / 2026-11-17），不需要手工拷
3. 安装后首次启动，`%APPDATA%\sparo-store\skills\social-media-publish.json` 版本升到 3（旧版版本号 ≤ 2 会被覆盖）
4. 装完后 Sparo 侧栏说"帮我发稿子"→ 应回复"发哪个平台？……稿件目录在哪？……"，而不是直接打开页面
5. 装完后 Sparo 侧栏说"发微信公众号，稿子在 D:\xxx\yyy"→ 应真跑 run_skill（公众号存草稿），而不是只打开页面

---

## 八、验收命令

```powershell
# 源码自检（不走浏览器）
npx vitest run tests/brain.test.ts    # 22/22 通过
npm run typecheck                      # 无输出

# 安装包侧栏手测（需先停旧 Sparo、装新包、启动）
# 1. 侧栏说 "帮我发稿子" → 期望：追问平台 + 目录，不打开页面
# 2. 侧栏说 "发微信公众号，稿子在 D:\稿子\20261117_测试" → 期望：存草稿成功
```

---

## 九、已知局限（如实说）

1. **"稿子在 D:\xxx"路径必须是 Windows 绝对路径，且不带引号**——slots.ts 里的正则 `([A-Za-z]:[\\/][^\s，。；;、]+)` 匹配。带引号也能匹配（`"([A-Za-z]:[\\/][^"”]+)`），但只支持中文引号 `"` `"` 和英文 `"`，不支持 `「」`。
2. **多平台一次性发布**还没做——目前侧栏 `run_skill` 只能单平台。说"发头条和百家"会被当成一件事，plan 层不拆分。
3. **发稿时如果平台说是"微信"但没说"公众号"**，正则能识别；但只说"发微博"会走 intent-router 里的"微博"分支，不会触发 publishSlots（微博不在 5 平台列表里）。
4. **还没在真实侧栏里点过这条新链路**——单测全过、类型过，但我现在不敢关正在跑的 Sparo 实例去真机测，怕把 0.7.0 的 userData 踩掉。打包窗口如果方便，装完可以手点一下那两条对话。

---

## 十、红灯

1. **不要在 Sparo 运行时 seed 新技能 JSON**——`store.ts` 只在应用启动时 seed，运行中改 `strategies/skills/*.json` 必须重启 Sparo 才生效。
2. **不要手动覆盖 `%APPDATA%\sparo-store\skills\*.json`**——新包的 seed 逻辑会按版本号覆盖旧版，但不会覆盖 `source=taught` 的用户教入技能。如果用户之前手动改了某个技能，**不要替用户恢复**。
3. **不要说"这次改了微信技能"**——微信技能在上一轮 [NOTICE-20261116-SKILL-WEIXIN-FORMAT-SYNC.md](./NOTICE-20261116-SKILL-WEIXIN-FORMAT-SYNC.md) 里已经进包，这一轮改的是侧栏调技能的能力。
4. **不要把 `docs/DECISION-POINTS.md` 当必须文件**——主进程运行时不读它，只是登记决策，漏了也不影响功能。
