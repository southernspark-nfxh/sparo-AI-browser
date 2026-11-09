# 0.3.2 收尾任务书（T-1 启动核验 · T-2 现场恢复 · T-3 文档对齐）

> 执行者：Cursor。审码 AI 已完成：0.3.2 版本提交（`dedba34`）、打包（`release\Sparo-Setup.exe`）、静默安装（`D:\Program Files\Sparo`，latest.yml 确认 0.3.2）。
> 本任务书**不含代码改动**。唯一可能牵出代码的分支是 T-1 启动失败——那也只取证回报，不盲改。

## 背景：为什么「启动即退」大概率不是 bug

审码 AI 之前从沙箱化终端启动安装版，出现进程消失。取证结论：

- 每次消失都发生在**启动命令结束之后**；命令运行期间进程存活（最后一次存活满 90 秒，行为正常）
- stdout 全程正常：`[push-frame] key=user sync=delta`——0.3.2 的增量推送在工作
- stderr 只有 libpng 警告，无异常栈
- `%APPDATA%\sparo-store\diag\` 无新 crash 记录（`crash-20261109-153605.log` 只有一行正常 push 日志）
- 结论：沙箱在命令结束时清理了子进程树。需要你在无沙箱终端做一次干净核验来定案

## 事实（已核，直接引用）

| 项 | 值 |
|---|---|
| git HEAD | `dedba34`（0.3.2 版本提交），前一提交 `a3b1c90`（补 850be5e 漏交的类型） |
| 安装包 | `release\Sparo-Setup.exe`，92,323,641 字节，2026-11-09 15:30:48 |
| SHA256 | `E8F5BF9E629C89213FF27E5CBD587A59BF2E1AD59C3C13C369037AC7DAC2E7F5` |
| 安装位置 | `D:\Program Files\Sparo`（latest.yml 已确认 0.3.2） |
| stash@{0} | 「店小秘R2-R9B+T63 半成品，打包期间暂存」，46 个文件——**要恢复的** |
| stash@{1} | 「wip: incomplete tabId threading in browser.ts」——更早的 wip，**不要动** |

## T-1 安装版启动核验（必做，先做）

前置检查（都应为空）：

```powershell
Get-Process -Name Sparo -ErrorAction SilentlyContinue
Get-NetTCPConnection -LocalPort 3921 -ErrorAction SilentlyContinue
```

启动：

```powershell
Start-Process -FilePath 'D:\Program Files\Sparo\Sparo.exe'
```

核验（启动后 1 分钟、5 分钟各查一次）：

```powershell
Get-Process -Name Sparo | Select-Object Id, StartTime
Invoke-WebRequest -Uri 'http://127.0.0.1:3921/health' -UseBasicParsing | Select-Object -ExpandProperty Content
```

**通过标准**：两次检查进程都存活 + health 正常返回；窗口可见、侧栏正常加载。

**失败分支**（进程再次消失）：不要改代码，先取证回报——

1. 退出码：`$p = Start-Process -FilePath 'D:\Program Files\Sparo\Sparo.exe' -PassThru; $p.WaitForExit(); $p.ExitCode`
2. `%APPDATA%\sparo-store\diag\` 最新日志全文
3. Windows 事件查看器 → Windows 日志 → Application 里来源为 Sparo.exe / Application Error 的记录
4. 复现步骤和时序（启动后多少秒消失、是否每次一致）

## T-2 git stash pop 恢复现场（必做）

只恢复 stash@{0}，**不要碰 stash@{1}**：

```powershell
git stash list                 # 确认两条 stash 的顺序没有变化
git stash pop stash@{0}        # 显式指定，避免误弹
git status                     # 46 个文件应回到工作区
```

注意：

- `src/main/workflows/dxm-smt-live.ts` 里 `DxmSmtLiveSurface` 的 3 个可选字段（`navigate` / `openTab` / `closeTab`）已由审码 AI 提前补交（`a3b1c90`），与 stash 里的版本逐字一致；pop 时该文件若报冲突，以任意一份为准（内容相同）
- pop 后跑 `npm run typecheck`。若你的半成品在 stash 前本来就没过 typecheck，不算本次回归，如实记录即可
- **不要提交这批半成品**，继续留在工作区

## T-3 文档对齐（必做，单独一个 commit）

只改下面两处版本引用：

1. `AGENTS.md` L23 速览表：「CHANGELOG.md | 对外变更（现 0.3.1）」→「（现 0.3.2）」
2. `docs/INSTALL.md` 校验表（L48-50）：`Sparo-Setup.exe` 的 SHA256 换成 `E8F5BF9E629C89213FF27E5CBD587A59BF2E1AD59C3C13C369037AC7DAC2E7F5`

**不要改**：

- `docs/listings/`（提审前另做一轮）
- `CHANGELOG.md` 的历史条目（`[0.3.1]` 一节是历史记录）
- `docs/FREE-SOUL-TASKBOOK.md` 里的 0.3.1 字样（历史上下文）
- `docs/QA-GOLDEN-SCENARIOS.md` 的实机记录表（G1/G2/G3 由审码 AI 复测后回填）

提交：文档改动单独一个 commit，写明 0.3.2 收尾，等审码 AI 审。

## 交接

- T-1 通过后**让 Sparo 保持运行**，回报时注明进程 PID 和 health 结果
- 审码 AI 将接手 G1/G2/G3 黄金场景复测（需要侧栏 UI 操作，用 computer-use 驱动），并回填 QA 实机记录表
- 回报格式：T-1 证据（命令输出）、T-2 `git status` + typecheck 结果、T-3 commit hash
