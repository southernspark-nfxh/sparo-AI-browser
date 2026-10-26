# TASK-20261026-隐私扫描打包与 GitHub 同步任务书

> 目标：打包最新版本、同步 GitHub，同步前确保零私人信息（key、账号、本机路径）外泄。
> 本文所有「已扫结论」基于 2026-10-26 17:20 前后的现场扫描，执行时按 §1.2 复扫一遍为准。

---

## §0 底账（已核实的现状）

| 项 | 状态 |
|---|---|
| 工作区 | 干净，本地与 `origin/master` 同步（最新 `339e7df`） |
| 远端 | `origin = github.com/southernspark-nfxh/sparo-AI-browser`（公开仓库），另有本地 `history` remote |
| git 历史 | 干净：真实 DeepSeek key、`settings.json`、`mcp-auth.json` 从未进过任何提交（`git log -S` 三查零命中） |
| 已跟踪源码/测试 | 干净：无 `sk-` 真实 key、无账号、无用户名 |
| `.env.example` | 模板，占位空值，可保留 |
| `.gitignore` | 已覆盖：`settings.json`、`**/mcp-auth.json`、`*.key`、`*.pem`、`credentials*`、`secrets*`、`tmp-*`、`scripts/qa-*`、`qa-screenshots/`、`.env*` |
| 版本号 | `package.json = 0.1.18`；CHANGELOG 顶部挂两个「未发布」节（长采集与白屏 / 新任务确认卡） |
| untracked | 23 项，全部是文档与 QA 资产，分三级处置见 §1.3 |

**敏感内容分布（重点）**：

- 含账号 `[已抹除]`：`QA-PRODUCT-UX-20260913.md`（untracked，**未被 ignore**）
- 含本机路径 `C:\Users\<用户名数字>\...`：`QA-REPORT-0.1.17.md`（untracked，**未被 ignore**）
- 含 `C:/Users/<用户名数字>` 的 `scripts/qa-b2-*.json`、`tmp-*.json`：**已被 ignore**，不会进库
- `qa-screenshots/`（含截图与 QA 脚本，脚本里有 token 读取逻辑）：**已被 ignore**
- `sparo-uiux-qa/screens/` 的截图：文本扫描干净，但截图画面可能含桌面/账号信息，**未见内容审查**
- 其余 untracked（`docs/BUG-*`、`docs/TASK-*`、`docs/THREE-CHANNEL-DESIGN.md`、`sparo-three-channel/tasks/*`、`sparo-agent-upgrade/tasks/*`、`NOTICE_SKILLS_SYSTEM_FIX_20260913.md`）：文本扫描干净

## §1 隐私扫描（同步的硬门槛，不过不许推）

### §1.1 扫描范围与判定

「私人信息」指：真实 API key（`sk-` 长串）、Bearer token、登录账号（`[已抹除]`）、本机用户名与路径（`<用户名数字>`、`C:\Users\...`）、邮箱（`walter.x@qq.com` 除外——它是 git 提交身份，历史里全有，属用户自愿公开）、证书私钥、密码。

### §1.2 复扫命令（PS5 可用，逐条跑，输出为空才过关）

```powershell
# 1. 已跟踪文件（当前 HEAD）
git grep -n -E 'sk-[a-zA-Z0-9]{20,}'
git grep -n '[已抹除]'
git grep -n '<用户名数字>'

# 2. git 全历史（任意提交里出现过都算）
git log --all --oneline -S 'sk-db95102'
git log --all --oneline -S '[已抹除]'

# 3. 待提交的 untracked 文档（提交前对每个候选文件跑）
#    （docs/ 与 sparo-three-channel/ 与 sparo-agent-upgrade/ 本轮已扫干净，复扫用）
git grep -n -E 'sk-[a-zA-Z0-9]{20,}' --no-index -- docs sparo-three-channel sparo-agent-upgrade

# 4. GitHub 侧终验（推送后）：仓库 code search 搜 <用户名数字> / sk- 无结果
gh api "search/code?q=repo:southernspark-nfxh/sparo-AI-browser+<用户名数字>"
```

### §1.3 untracked 处置分级

| 级 | 文件 | 处置 |
|---|---|---|
| A 可提交 | `docs/BUG-20261024-*.md`、`docs/TASK-20261026-*.md`、`docs/TASK-官网安装包同步.md`、`docs/THREE-CHANNEL-DESIGN.md`、`sparo-three-channel/tasks/P0/P1/P2-*.md`、`sparo-agent-upgrade/tasks/T10R-*.md` | 文本干净，提交进 `docs` 类 commit |
| B 不提交、补 ignore | 根目录 `QA-PRODUCT-UX-20260913.md`、`QA-REPORT-0.1.17.md`、`QA-SKILLS-SYSTEM-20260913.md`、`sparo-uiux-qa/`（全部，含截图） | 含账号/本机路径/未审截图。**先补 .gitignore 再做别的**，防止后续 `git add .` 误提交 |
| C 用户定 | `NOTICE_SKILLS_SYSTEM_FIX_20260913.md` | 文本干净，但属内部修复通告，提交与否用户拍板 |

### §1.4 .gitignore 补丁（B 级处置的落地）

在「Local QA scratch — never publish」节追加：

```gitignore
# Root QA reports with local account/paths — never publish
/QA-*.md
/sparo-uiux-qa/
```

补完后 `git status` 里 B 级文件必须消失。若 `NOTICE_*` 也选不提交，一并加 `/NOTICE_*.md`。

### §1.5 用户侧提醒（不在本仓库范围，但要告知）

- DeepSeek key（`sk-db9510...`）存在 `%APPDATA%\sparo-store\settings.json`，仓库从未收到，**但在本地 QA 会话输出中出现过**。若这些会话记录会被分享/同步到任何云端，建议轮换该 key。
- git 提交邮箱 `walter.x@qq.com` 与 GitHub 账号绑定属公开信息，无需处理。

### §1.6 历史重写清除 QQ 号（用户已拍板）

`be06dec`（10-09，已在 origin/master）的 CHANGELOG.md 与 docs/PRODUCT-TASKBOOK.md 含 QQ 号 `[已抹除]`（bug 描述语境），`507e69a` 后 HEAD 已干净，但历史 blob 仍公开。处置：

1. **先做完 §1.4 / §2 / §4.1 的三笔提交**（历史重写一次覆盖，只 force push 一次）。
2. **备份硬前提**：`git bundle create ..\sparo-pre-rewrite.bundle --all` + 复制工作区文档；重写失败可从 bundle 恢复。
3. `pip install git-filter-repo`（Python 3.14 已在）。
4. 替换规则文件（如 `replace.txt`）：
   ```
   [已抹除]==>[已抹除]
   ```
5. `git filter-repo --replace-text replace.txt --force`（会移除 remotes，属预期）。
6. 重加 remote：`git remote add origin https://github.com/southernspark-nfxh/sparo-AI-browser.git`。
7. **force push（用户已授权）**：走代理 `git -c http.proxy=... push --force origin master`。
8. 复扫：`git log --all --oneline -S '[已抹除]'` 必须为空。
9. 残留告知：GitHub 服务端旧对象短期内仍可能通过 commit hash 直链访问（无引用后会被 GC）；若仓库存在 fork，旧历史仍在 fork——推送后查一次 fork 情况。彻底清除可联系 GitHub Support。
10. 本地 `history` remote（`D:/download/Sparo`）需重新对齐（fetch + reset --hard 或重新绑定）。

## §2 版本与 CHANGELOG

1. CHANGELOG 顶部两个「未发布」节合并为一节，标题跟版本号走；对外一句合并为：
   > 长采集任务卡住会说人话，窗口偶发空白能自愈，新任务更稳地出确认卡。
2. 版本号（**已定：`0.1.19`**，把 P1-P4 + 执行深度 + 恢复通道当补丁线）。执行前核对 `electron-builder.yml` 与 package.json 版本一致。
3. 版本号改动 = 一笔独立 `chore(release)` commit。

## §3 打包

1. 前置门槛：`npm test`（512+ 全绿）+ `npm run typecheck`（退出码 0）。
2. 杀运行中的 Sparo（旧实例锁 `release\win-unpacked`）：`Get-Process Sparo -ErrorAction SilentlyContinue | Stop-Process -Force`。
3. `npm run dist`。结尾 `GH_TOKEN is not set` 属 publish 步骤报错，**本地构建可忽略**，以产物时间为准。
4. 产物验证：`release\win-unpacked\Sparo.exe` 与 `release\Sparo-Setup.exe` 的时间戳为当次构建时间，尺寸与上版同量级（~192MB / ~88MB）。
5. 冒烟：`explorer.exe` 拉起（**不要用 Start-Process——终端回收会连带杀掉 GUI 进程树**），MCP `/health` 返回 `ok:true`。

## §4 GitHub 同步

1. 提交拆分（沿用现有粒度，禁止一笔大杂烩）：
   - `docs: 隐私扫描与任务书归档`——§1.3 的 A 级文件 + 本任务书。
   - `chore: 补 .gitignore 挡住本地 QA 账本`——§1.4 的 ignore 补丁。
   - `chore(release): 0.1.19（或 0.2.1）`——版本号 + CHANGELOG 合节。
2. 提交身份沿用环境变量方式（**不改 git config**）：
   ```powershell
   $env:GIT_AUTHOR_NAME="southernSpark | 南方星火"; $env:GIT_AUTHOR_EMAIL="walter.x@qq.com"
   $env:GIT_COMMITTER_NAME="southernSpark | 南方星火"; $env:GIT_COMMITTER_EMAIL="walter.x@qq.com"
   ```
3. 逐个 `git add <明确文件名>`（**红线：禁止 `git add .` / `git add -A`**）。
4. 推送走系统代理（不写 git 配置）：
   ```powershell
   git -c http.proxy=http://127.0.0.1:10792 -c https.proxy=http://127.0.0.1:10792 push origin master
   ```
5. 推送后终验：GitHub code search 搜 `<用户名数字>`、`sk-`、`[已抹除]` 均无结果（§1.2 第 4 条命令）。

## §5 红线

- 任何时刻不得把 `settings.json`、`mcp-auth.json`、`*.key`、`.env`、截图、`tmp-*`、`scripts/qa-*` 加进暂存区。
- 禁止 `git add .` / `git add -A` / `git commit -a`。
- 不改 git config（身份、代理均用一次性参数或环境变量）。
- 版本号未定案前不打包、不打 tag。
- §1.2 复扫有任何一条非空输出：**停，先处置再继续**，处置方式记进当次 commit message。

## §6 验收清单

- [ ] §1.2 四组复扫全零命中
- [ ] `.gitignore` 补丁生效：`git status` 中不再出现 B 级文件
- [ ] `npm test` 全绿 + `tsc` 0
- [ ] dist 产物时间戳为当次，冒烟 `/health` ok
- [ ] 三笔 commit（docs / gitignore / release）推送成功
- [ ] GitHub 仓库 code search 三词零命中
- [ ] CHANGELOG 只剩一个未发布合并节（或已随版本发出）

## §7 附：本轮扫描原始记录

- `git log --all -S 'sk-db95102'` → 空；`--diff-filter=A -- settings.json` → 空；`-S 'mcp-auth' -- '*.json'` → 空
- `git grep`（src/ 与 tests/，模式 `sk-…20+`/`<用户名数字>`/Bearer）→ 零命中
- docs/、sparo-three-channel/、sparo-agent-upgrade/、NOTICE_* 文本扫描 → 零命中
- QA-PRODUCT-UX-20260913.md:45 含 `[已抹除]`；QA-REPORT-0.1.17.md:259,295-296 含 `C:\Users\<用户名数字>` 路径
- scripts/qa-*.json、tmp-*.json 含 `C:/Users/<用户名数字>`，但均在 ignore 内
