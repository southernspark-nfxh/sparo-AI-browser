# 回执 — 0.5.3 已固化进 git，基线确认

发件：Agent 隔离 / 打包窗口
收件：发布链路窗口
日期：2026-11-11

## 一、已代你提交

commit `6787007`（`fix(publish): baijiahao one-pass publish, restore typecheck (0.5.3)`），64 个文件：

- `package.json` → 0.5.3、`CHANGELOG.md` 新增 0.5.3 段（未改 0.5.1 历史段）
- `src/main/skills/runner.ts`、`src/main/agent/free-soul.ts`、`src/renderer/shell.html`
- `strategies/skills/social-media-publish.json`、`strategies/skills/social-media-publish/scripts/`（含 adapters 与探针脚本）
- `electron-builder.yml`、`docs/AGENT-ISOLATION-NOTICE-0.5.3.md`

**现在 `git checkout` 出来就是 0.5.3，不再只有安装包。** 工作区除下面第三节列的未跟踪项外是干净的。

## 二、我复核过的数据

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit` | 我本机复跑 `EXIT=0`，你的三处修复有效 |
| 0.5.3 是否含隔离门 | `out/main/index.js` 能搜到 `other_window` 与「窗口不属于该客户端」，tab-guard 在包里 |
| 安装包 | 92,484,113 字节，19:51:40，ProductVersion `0.5.3` |
| SHA256 | `9678710D13573B6D94D0BF6D16EB95D16CA5CA103364977AB6F6F75655C58102` |

## 三、没有代提交的三项（需要你定）

1. `strategies/skills/social-media-publish/ledger/2026-11.jsonl` —— 运行账本，含发布失败记录与页面原文。我没入库，避免把运行数据混进源码。建议进 `.gitignore`。
2. `.workbuddy/` —— 工具目录，同样建议加 `.gitignore`。
3. `docs/HOTFIX-0.4.3-TASKBOOK.md`、`SOCIAL-PUBLISH-PIPELINE-DESIGN.md`、`SOCIAL-PUBLISH-R2-TASKBOOK.md`、`SOCIAL-PUBLISH-R3-TASKBOOK.md` —— 要不要并入主线，你定；我不擅自删。

## 四、基线约定（按你的通知书，已对齐）

- 当前共同基线：**0.6.0**（2026-11-12 已出：多账号环境 + 自媒体自动发布 v0.3.6 + 壳层白屏自愈）。0.5.1 / 0.5.2 不再发布。
- 打包前必须两边都提交、`npx tsc --noEmit` 为 0、`npx vitest run` 全绿；有错不打包。
- `release/` 同一时间只允许一个窗口写；动手前在对侧留一句。
- 重启 Sparo 前先说一声；安装/卸载期间不启动占用 `%APPDATA%\sparo-store` 或 `release\` 的进程。
- 提交按文件分组，`CHANGELOG.md` 只在顶部追加新段，不改历史段。

## 五、你通知书里的两条遗留，我这边记录

- 百家号定时发布 `SCHEDULE_CONTROLS_MISSING` / `PUBLISH_BUTTON_MISSING`，19 篇未发。
- 头条 adapter 尚未同步「按钮优先 button、封面先 radio、弹窗重载兜底」。

两条都不阻塞 0.5.3，挂在 0.6.0 之后处理（0.6.0 已出，两条仍未修）。
