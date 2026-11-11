# 通知书 — 0.5.3 已打包，基线切换

发件：发布链路窗口
收件：打包 / Agent 隔离窗口
日期：2026-11-11

## 一、0.5.3 已生成

- 文件：`release\Sparo-Setup-0.5.3.exe`
- 大小：88.2 MB
- 生成时间：2026-11-11 19:51:40
- 内置校验：`social-publish-scripts\adapters\baijiahao.mjs` 含封面按钮计数后缀匹配；`article.mjs` 含 `inlineHtml`

`npm run dist` 的 electron-builder 阶段全部成功，仅最后 GitHub 上传因未设 `GH_TOKEN` 报错退 1——与本地产物无关，安装包完整。

## 二、0.5.3 是什么

**0.5.3 = 你的 0.5.1（多 Agent 窗口隔离）+ 我这边的发布链路修复**，两者合成后的超集。

0.5.2 不用发了，直接以 0.5.3 为共同开发基线。之后的版本从 0.5.3 往上走，下个包用 **0.5.4**。

我这边改了什么：

1. `src/main/skills/runner.ts` — 修掉你通知里点名的三处类型错误
   - `extraArgs` 显式 `string[]`
   - `findLast` → `[...lines].reverse().find(...)`，不再依赖 ES2023 lib
   - `stderr` 不是 `ToolResult` 字段 → 并进 `data`，排障信息保留
2. `strategies/skills/social-media-publish/scripts/` — 百家号发布链路
   - Markdown 在上传前转真 HTML，`##` / `**` 不再漏到正文
   - 插图：真实点击入口、只认图片 input、等「确认」可用再点、点完断言正文多一张图
   - 封面：点刚上传的缩略图、断言「确定 (1)」可用再点、点完断言弹窗关闭
   - 去掉发布前的「存草稿」（会清空封面）
3. `package.json` 版本 → 0.5.3；`CHANGELOG.md` 新开 0.5.3 段，0.5.1 原文未动

## 三、门禁结果

- `npx tsc --noEmit`：全仓 **0 错误**（EXIT=0）
- `npx vitest run`：**122 个文件 / 932 条全部通过**
- 真机：百家号一篇稿子 31.4 秒一次跑通（开标签→标题→正文→插图→封面→发布→核验），线上预览零 `#`、零 `**`

## 四、约定（四条，与我这边一致）

1. **类型门禁必须绿**，`tsc --noEmit` 有错不打包。
2. **提交按文件分组**：`runner.ts` / `free-soul.ts` / `shell.html` / `strategies/skills/social-media-publish*` / `electron-builder.yml` 各成一组；CHANGELOG 只加新段，不改历史段。
3. **打包权单窗口**：当前基线 0.5.3，下个包 0.5.4，动手前在对侧留一句。
4. **重启 Sparo 前先说一声**。这次由用户手动卸载重装，安装期间不要启动任何会占用 `release\` 或 `%APPDATA%\sparo-store` 的进程。

## 五、提醒（沿用你的那条）

裸 HTTP 不带 `x-sparo-client` 的写操作现在会被拒。老脚本先 `initialize` 拿 client id，再发动作；不要指望默认落到用户当前页。

## 六、已知遗留

- 百家号定时发布：19 篇长征稿卡在 `SCHEDULE_CONTROLS_MISSING` / `PUBLISH_BUTTON_MISSING`，未修
- 头条 adapter 尚未同步「按钮优先 button、封面先 radio、弹窗重载兜底」三类修复
- 安装包不含自动更新，重装即覆盖
