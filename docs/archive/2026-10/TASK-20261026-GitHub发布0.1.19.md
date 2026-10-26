# TASK-20261026-GitHub 发布 0.1.19 任务书

> 目标：让 GitHub 能下载到最新版 **0.1.19**——把 Release 发到 **发布仓库**，使 README 直链和官网产品页的「最新版」指向 0.1.19。
> 交给 Cursor 执行。执行前把 §1 的事实逐条核实一遍，对不上就停下来报告，不要硬做。

状态：**已完成**（2026-10-26）。Release：https://github.com/southernspark-nfxh/sparo-AI-browser/releases/tag/v0.1.19 。tag `v0.1.19` 打在当时的 `master` `0e5219f`（本任务书的修正提交；底账里的 `68da4af` 是它的上一笔）。

---

## §1 事实底账（2026-10-26 18:15 前后核实）

| 项 | 状态 |
|---|---|
| 仓库 | `southernspark-nfxh/sparo-AI-browser`（**唯一仓库**；旧名 `sparo-agent-browser` 已永久改名，README 里的旧直链 301 到本仓库）。`master = 68da4af`（任务书提交），0.1.19 已提交、已打包 |
| 当前 latest | v0.1.15（2026-09-05，asset `Sparo-Setup.exe` 91,730,831 字节）；0.1.16–0.1.19 均无 Release、无 tag |
| 本地安装包 | `release\Sparo-Setup.exe`（2026-10-26 17:35 构建，92,234,371 字节，版本 0.1.19）；`release\Sparo-Setup.exe.blockmap` 可选上传 |
| gh CLI | 本机没有可用的 `gh`（曾有坏路径 `...\Temp\gh-cli\bin\gh.exe`）。先 `winget install GitHub.cli`，再 `gh auth login` |
| 代理 | git 与 gh 的网络访问走 `http://127.0.0.1:10792`（git 用 `-c http.proxy=`，gh 设 `HTTPS_PROXY` 环境变量） |

**执行前必须复核**（gh 或网页）：
1. 仓库 `sparo-AI-browser` 的 latest Release 确是 0.1.15，asset 名确为 `Sparo-Setup.exe`；
2. `release\Sparo-Setup.exe` 的时间戳是 2026-10-26 17:35、文件版本 0.1.19（不是就先停下确认测试全绿再继续）。

## §2 执行步骤

1. **gh 就绪**：`gh --version` → `gh auth status`（未登录先 `gh auth login`）。
2. **（可选，便于追溯）本地打 tag**（打在当前 `master`，不指定旧 hash）：
   ```powershell
   git tag v0.1.19
   git -c http.proxy=http://127.0.0.1:10792 push origin v0.1.19
   ```
3. **写 release notes** 到临时文件（文案见 §3；对照 `CHANGELOG.md` 校准 0.1.16–0.1.18 的概述措辞，别照抄本文的概括）。
4. **创建 Release**（发到本仓库 `sparo-AI-browser`）：
   ```powershell
   gh release create v0.1.19 "release\Sparo-Setup.exe" `
     --repo southernspark-nfxh/sparo-AI-browser `
     --title "Sparo 0.1.19" `
     --notes-file <notes 路径> `
     --latest
   ```
   - asset 文件名**必须恰好是 `Sparo-Setup.exe`**——README 直链（旧域名 301 到本仓库）按这个名字取文件，名字不对直链 404。
   - Release 的 tag 由创建动作自动生成，不依赖本地 tag；报错可加 `--target master`。

## §3 release notes 文案（起点稿，可校准）

```markdown
## 0.1.19 · 长采集与白屏

长采集任务卡住会说人话，窗口偶发空白能自愈，新任务更稳地出确认卡。

自 0.1.15 以来的主要变化：
- 0.1.16：任务池——前台任务和最多 3 个后台任务并行；最小化时后台继续跑；任务绑标签
- 0.1.17：侧栏 Agent 内核——一句话一张工作单，模型看见页上结果再改路；比价出报告页
- 0.1.18：并行收尾、笔记库、侧栏计划卡、断点续跑
- 0.1.19：新任务确认卡；长采集翻页带增量、卡住换打法；关单说明还缺什么；挂起任务回「继续」能接回；窗口偶发空白自愈

完整变更见 CHANGELOG：https://github.com/southernspark-nfxh/sparo-AI-browser/blob/master/CHANGELOG.md
```

## §4 验收清单

- [x] `https://github.com/southernspark-nfxh/sparo-agent-browser/releases/latest` 显示 0.1.19（301 到 `sparo-AI-browser`，再转到 tag `v0.1.19`）
- [x] 直链 `https://github.com/southernspark-nfxh/sparo-agent-browser/releases/latest/download/Sparo-Setup.exe` HTTP 200，Content-Length 92,234,371；asset 名 `Sparo-Setup.exe`
- [x] 下载到的安装包文件版本 0.1.19，SHA256 `3C3D0C5A7C27DABE43CDFDC57D2CCF6B24F6DE8CA8CE17C2D2938DC898D3AF0C`，与 17:35 产物一致。未在本机覆盖安装并启动窗口。
- [x] 官网产品页 `southernspark.dev/zh/products/sparo` 已显示 v0.1.19（页面写死该版本，不是向 GitHub latest 现拉）
- [x] 代码仓库存在 tag `v0.1.19`

## §5 红线

- 不改版本号、不重新打包（用 17:35 的现成产物；确需重打，先 `npm test` + `npm run typecheck` 全绿）。
- asset 只上传 `Sparo-Setup.exe`（最多加 `.blockmap`）。**绝不**把 QA 截图、settings、token、本地脚本传上 Release。
- 凭据只用 `gh auth` 或环境变量，不写进任何文件、不回显到输出。
- 发布仓库结构异常（不是自己的仓库、已有未知 Release 等）→ 停下报告，不硬发。
- 发布完成后把本任务书移入 `docs/archive/2026-10/` 并标「已完成」，随常规 docs 提交。
