# 打包通知：多账号环境（2026-11-12）

**状态**：开发版已实现并人工验收通过；安装版未打包，需要本次一并发布。

**一句话**：同一个 Sparo 里，同一站点可同时登录多个号。每个账号环境一套独立 Chromium 存储（Cookie / localStorage / IndexedDB / 缓存），不是切换登录态。

## 本次改动

### 代码

| 文件 | 改动 |
|---|---|
| `src/main/browser.ts` | `makePageView` 用 `webPreferences.partition`（原顶层 `session` 被 Electron 忽略，导致所有环境共用默认登录态）；`navigate` 在目标标签不属于该环境时强制新开环境标签；`NavigateConfirm.data` 回传实际 `tabId`；新增 `listEnvsTool` / `createEnvTool` / `deleteEnvTool`，`runCoreTool` 支持 `list_envs`、`navigate.envId`、`run_skill params.envId` |
| `src/main/mcp-server.ts` | 注册 `list_envs` / `create_env` / `delete_env`；`navigate` / `new_tab` 支持 `envId`，并 `claimTabForClient`，保证后续 click / fill / execute 停在该账号 |
| `src/main/tools/index.ts`、`src/main/tools/navigate.ts` | `navigate` / `new_tab` 透传 `envId` |
| `src/main/agent/free-soul.ts` | 侧栏模型新增 `list_envs` 工具、`navigate.envId` 入参、系统提示「账号隔离」规则 |
| `src/main/agent/agent-guide.ts` | 外部 Agent 握手说明加入多账号用法 |
| `src/renderer/shell.html` | 设置抽屉新增「账号」面板：列表 / 新建 / 打开 / 删除 |
| `src/shared/types.ts` | `NavigateConfirm.data.tabId?` |
| `src/main/shell-preload.ts` | （已有）`listEnvs` / `createEnv` / `saveEnv` / `cloneEnv` / `deleteEnv` / `openEnv` |

无数据库迁移、无配置格式破坏；已有环境目录继续可用。

### 文档

- 新增 [MULTI-ACCOUNT.md](./MULTI-ACCOUNT.md)：用法、实现位置、验收记录、已知边界
- 新增本通知书
- 更新 `AGENTS.md`、`docs/AGENTS.md`、`docs/MCP-API.md`（多账号小节 + navigate/new_tab 的 envId）
- 更新 `CHANGELOG.md`、`docs/ARCHITECTURE.md`、`docs/PRODUCT-TASKBOOK.md`

## 打包前

- 建议版本号统一由你决定（当前 `package.json` 为 `0.5.3`，可升 `0.5.4` 或按你的发布节奏）。
- 不要改动 `docs/listings/`（提审前另做一轮）。
- 主进程不支持热更；确认打包机拉到的 `src/main` 与上表一致。
- 与其他窗口的改动合并时，重点检查 `browser.ts` 的 `makePageView` / `navigate` 与 `mcp-server.ts` 的 `navigate` / `new_tab` handler，这两处是本次核心。

## 打包后必须复测

1. 安装包安装后打开 **设置 → 账号**，新建两个环境，分别打开同一站点（如百家号），确认两边登录态互不影响；来回切标签不串号。
2. 黄金场景 G1、G2、G3（见 `docs/QA-GOLDEN-SCENARIOS.md`）。
3. Agent 侧：`list_envs` 能列出环境；`navigate({ url, envId })` 打开的是该环境的页；不传 `envId` 仍走默认登录态。
4. 安装版数据目录 `%APPDATA%\sparo-store` 与开发版 `.devdata` 互不影响。

## 已知边界（不是本次阻塞项）

- 环境登录需人工完成一次（扫码 / 密码 / 短信）。
- 删除环境只删配置，磁盘上 `Partitions/env_<id>/` 会留空壳，不含有效登录态。
- 同一个号不建议在两个环境同时登录（平台可能踢下线）。
