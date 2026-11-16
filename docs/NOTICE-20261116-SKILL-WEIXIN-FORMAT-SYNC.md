# 交接通知书 — 微信发布技能「Word 导入 + 统一排版」改造（2026-11-16 下午）

给打包 / 同步 / 推送窗口执行。本通知只覆盖 `strategies/skills/` 下的发布技能改动，不含 `src/`、`docs/` 等其它窗口的改动。

---

## 一、这次改了什么（一句话）

微信公众号发布从「直填正文、无排版」改成 **默认 Word(docx) 导入 → 统一排版 → 写标题 → 封面 → 存草稿**，0 图 / 1 图 / 多图走同一条链路；排版参数集中到一个新文件 `format.mjs`，改字号/主色只改这一处。三条流程已端到端实测通过并存稿。

上一份通知 [NOTICE-20261116-WEIXIN-PACKAGING.md](./NOTICE-20261116-WEIXIN-PACKAGING.md) 讲的是「微信 adapter 首次接入」；本份讲的是之后的**排版 + 默认 docx**这一层，两份都要看。

---

## 二、文件清单（9 个，全部在 `strategies/skills/` 下）

| # | 文件 | 状态 | 说明 |
|---|---|---|---|
| 1 | `social-media-publish/scripts/format.mjs` | **新增** | 排版主题表 `THEMES`（editorial / ink / green），导出 `resolveTheme` / `themeNames` |
| 2 | `social-media-publish/scripts/docx.mjs` | **新增** | 零依赖生成 .docx（上一轮建，本轮一起提交） |
| 3 | `social-media-publish/scripts/adapters/weixin.mjs` | 修改（+344 行） | 新增 `formatBody`；`importDocx` 图片计数改 `img[data-src]`；`setCover` 加重试；`verify` 增强 |
| 4 | `social-media-publish/scripts/engine.mjs` | 修改 | `routeSteps` 支持 docx 模式；`ctx.theme`；`planImages` 传 `forceDocx` |
| 5 | `social-media-publish/scripts/article.mjs` | 修改 | `planImages` 支持 `forceDocx`（微信默认全走 docx） |
| 6 | `social-media-publish/scripts/publish.mjs` | 修改 | 新增 `--no-docx` / `--theme`；自检断言扩充 |
| 7 | `social-media-publish/SKILL.md` | 修改 | 命令示例与「配图与 Word 导入」四条重写 |
| 8 | `social-media-publish/scripts/ONBOARDING_NEW_PLATFORM.md` | 修改 | 新增「导入之后还要排版」小节 |
| 9 | `weixin-publish/SKILL.md` | 修改（+129 行） | 补排版规范、主题、三个坑、10 步封面链路、实测记录 |

合计：7 文件改动 +743 / −33，另 2 个新增文件（`format.mjs` 1.5 KB、`docx.mjs` 13 KB）。

**建议提交信息（只 add 这 9 个路径，别用 `git add -A`）：**

```powershell
git add strategies/skills/social-media-publish/scripts/format.mjs `
        strategies/skills/social-media-publish/scripts/docx.mjs `
        strategies/skills/social-media-publish/scripts/adapters/weixin.mjs `
        strategies/skills/social-media-publish/scripts/engine.mjs `
        strategies/skills/social-media-publish/scripts/article.mjs `
        strategies/skills/social-media-publish/scripts/publish.mjs `
        strategies/skills/social-media-publish/SKILL.md `
        strategies/skills/social-media-publish/scripts/ONBOARDING_NEW_PLATFORM.md `
        strategies/skills/weixin-publish/SKILL.md
git commit -m "feat(发布): 微信默认 Word 导入并统一排版，排版主题集中到 format.mjs"
```

---

## 三、同步（安装副本）

运行中的技能从 `C:\Users\<用户名>\.trae-cn\skills\` 读，**必须逐文件覆盖，禁止整目录覆盖**（该目录还有别的技能）。

| 源（本仓库） | 目标（安装副本） |
|---|---|
| `strategies\skills\social-media-publish\scripts\format.mjs` | `C:\Users\<用户名>\.trae-cn\skills\social-media-publish\scripts\format.mjs` |
| `...\scripts\docx.mjs` | `C:\Users\<用户名>\.trae-cn\skills\social-media-publish\scripts\docx.mjs` |
| `...\scripts\adapters\weixin.mjs` | `...\skills\social-media-publish\scripts\adapters\weixin.mjs` |
| `...\scripts\engine.mjs` | `...\social-media-publish\scripts\engine.mjs` |
| `...\scripts\article.mjs` | `...\social-media-publish\scripts\article.mjs` |
| `...\scripts\publish.mjs` | `...\social-media-publish\scripts\publish.mjs` |
| `...\scripts\ONBOARDING_NEW_PLATFORM.md` | `...\social-media-publish\scripts\ONBOARDING_NEW_PLATFORM.md` |
| `...\social-media-publish\SKILL.md` | `...\social-media-publish\SKILL.md` |
| `...\weixin-publish\SKILL.md` | `...\weixin-publish\SKILL.md` |

**当前状态：** 本机这 9 个文件已同步，MD5 全部一致（SAME）。若打包机是另一台机器，按上表复制后请复跑下面第四节的自检。

---

## 四、打包

**`electron-builder.yml` 不需要改。** 现有配置已覆盖：

- `files: strategies/skills/**/*` → 技能包整体进 asar（`weixin-publish/SKILL.md` 在包里）
- `extraResources: scripts → social-publish-scripts`，filter `**/*.mjs`、`**/*.json` → **新 `format.mjs` 会被 `**/*.mjs` 自动收录**
- `extraResources: platforms → platforms`（`--plan` 依赖）

```powershell
npm run dist
```

产物：`release\Sparo-Setup.exe`

**打包后必须逐条核对（缺一条就算没打进去）：**

1. `resources\social-publish-scripts\format.mjs` 存在，且含 `export const THEMES`
2. `resources\social-publish-scripts\adapters\weixin.mjs` 存在，且含 `async formatBody(ctx)` 与 `resolveTheme`
3. `resources\social-publish-scripts\docx.mjs` 存在，且含 `export function writeDocx`
4. `resources\platforms\weixin.json` 存在
5. asar 内能找到 `weixin-publish/SKILL.md`，且正文含「Word 导入」与「formatBody」

---

## 五、验收（三条命令，缺一不可）

在 `resources\social-publish-scripts`（或仓库 `strategies\skills\social-media-publish\scripts`）下跑，需 Sparo 已启动、已登录 mp.weixin.qq.com：

```powershell
# 1. 静态自检（不开浏览器）：期望只输出 SELF_CHECK_OK
node publish.mjs --self-check

# 2. 探测编辑器：期望 detail 为 PROBE_OK
node publish.mjs --platform weixin --probe

# 3. 真实全链路（任一图片数目录）：期望 FORMATTED → VERIFY_OK，落稿后 URL 带 appmsgid=
node publish.mjs --platform weixin --article "<含 title.txt/body.md/images 的目录>"
#   可选：--theme ink|green  --images 1  --no-docx
```

**已实测存档（本机公众号后台草稿箱可查）：**

| 场景 | appmsgid | 结果 |
|---|---|---|
| 多图 3 张 | 100001881 | 383 字 / 3 图 / mso 残留 0 / 封面在 / VERIFY_OK |
| 单图 1 张 | 100001886 | 401 字 / 1 图 / 样式存后仍在 / VERIFY_OK |
| 零图纯文字 | 100001874 | 401 字 / 0 图 / VERIFY_OK |

---

## 六、不要打的 / 不属于本次

工作区还有其它未提交改动，**不要算进这次技能包**：

- `CHANGELOG.md`、`docs/PRODUCT-TASKBOOK.md`、`docs/QA-GOLDEN-SCENARIOS.md`、`docs/SOCIAL-PUBLISH-R4-ACCOUNT-ENV-TASKBOOK.md`、`electron-builder.yml`、`package.json`、`package-lock.json`、`src/main/browser.ts`、`src/main/skills/runner.ts`、`tests/skills-format.test.ts` —— 其它窗口的改动，按你们既有流程单独处理
- `strategies/skills/qie-publish/` —— 企鹅号技能，另一个窗口的活，不属本次
- 临时文件，**不要提交、不要打包**：`_probe_wechat.mjs`、`wx_login_qr.png`、`wx_qr.png`、`wxpub.png`、`wxpub_qr.png`、`.uploads/`、`src/renderer/public/favicon.ico`（未跟踪，来路不明）
- `ledger/` 不入库

---

## 七、红线（不要对外宣称 / 不要动）

1. **群发发表仍是人工**：adapter 只做到存草稿，发表由人点。宣传口径别提「自动群发」。
2. **定时发布未接入**，正文视频/音频未接入，直填路径的正文插图仍未打通（微信默认走 docx，不受影响）。
3. 版本号目前 `0.6.9`；是否升版、是否补 `CHANGELOG.md`，由打包窗口按既有流程决定。本通知不改版本号。
4. **不要改 `docs/listings/`**（提审前另做一轮）。
5. 主进程不热更；安装包不自动更新；发布技能脚本必须放在 asar 外（`social-publish-scripts`），不要挪进 `files`。
