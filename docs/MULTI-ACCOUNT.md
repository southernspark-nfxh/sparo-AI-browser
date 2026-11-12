# 多账号环境（2026-11-12）

同一个 Sparo 里，同一个站点可以**同时**登录多个号。不是「切换登录态」，而是每个账号环境各有一套独立存储：Cookie、localStorage、IndexedDB、缓存、Service Worker 全部分开，互不可见。

## 人怎么用

1. 打开 **设置 → 账号**。
2. 填名字（可留空，默认「新环境」），可选首页地址，点「新建环境」。
3. 点某个环境的「打开」，在打开的标签里正常登录这个号（例如百家号 A）。
4. 再建 / 打开另一个环境，登录另一个号（百家号 B）。
5. 两个标签可以同时开着，来回切不串号。

删除环境会删掉配置（不可撤销），这个号在本机就不再可用；磁盘上 `Partitions/env_<id>/` 会留空壳，不含有效登录态。

## Agent 怎么用

```text
list_envs()                                    # 拿 id、name
navigate({ url, envId })                       # 在该账号环境里打开（会新开环境标签）
new_tab({ url, envId })                        # 同上
run_skill({ query: "发百家号", params: { envId } })   # 技能也支持
```

- 不传 `envId` = 用户默认登录态。
- 环境标签会认领给发起调用的 client；后续不带 `tabId` 的 `click` / `fill` / `execute` 仍停在这个号里。
- 环境里还没登录时，如实告诉用户「在这个环境里登录一次」，不要反复重试或换号硬试。
- 用户说「发到 A 号 / 第二个百家号」时，先 `list_envs`，按名字选 `envId`。

## 实现位置

| 层 | 文件 | 做什么 |
|---|---|---|
| 存储 | `src/main/envs/store.ts` | 每个环境一份 `<configDir>/envs/<envId>/env.json`；id 随机，不随名字变 |
| 会话 | `src/main/browser.ts` `makePageView` | `session.fromPartition("persist:env_<envId>")`，并写进 `new WebContentsView({ webPreferences: { partition } })` |
| 开标签 | `browser.ts` `createEnvTab` | 按环境建标签；`navigate` 发现目标标签不属于该环境时也会新开 |
| IPC | `shell-preload.ts` | `listEnvs` / `createEnv` / `saveEnv` / `cloneEnv` / `deleteEnv` / `openEnv` |
| 界面 | `shell.html` 设置抽屉 `data-panel="envs"` | 新建 / 打开 / 删除 |
| MCP | `mcp-server.ts` | `list_envs` / `create_env` / `delete_env`，`navigate` / `new_tab` 带 `envId` |
| 侧栏 | `agent/free-soul.ts` + `agent/agent-guide.ts` | `list_envs` 工具、`navigate.envId`、系统提示里的账号规则 |

磁盘上每个环境对应 `Partitions/env_<envId>/`。删除环境只删配置目录，这个 partition 目录会留下空壳（不含有效登录态，不影响隔离）。

## 2026-11-12 修掉的两个真 bug

1. **独立存储没挂上**：原来写成 `new WebContentsView({ session: envSession, ... })`。`WebContentsView` 构造参数顶层没有 `session`，会被静默忽略，所有环境退回共用默认 session——看起来建了环境，实际共用一套登录态。改为 `webPreferences: { partition }`。
2. **带 envId 的导航被吞**：MCP / 侧栏调用时前面已经绑定了一张标签，`navigate` 里 `if (envId && !tabId)` 直接跳过建环境标签，页面落进同一张普通标签。改为：目标标签不属于该环境就强制新开，并把新标签认领给调用方（`claimTabForClient`）。

## 验收记录（开发版，2026-11-12）

- 环境 A 写 `document.cookie` 与 `sessionStorage`，读到 `iso_probe=A`。
- 同一站点切到环境 B：`document.cookie` 为空、`sessionStorage` 为 `null`。
- 回到环境 A：`iso_probe=A` 仍在；两次导航落在不同标签 id。
- 真实使用：A账号 / b账号两个环境分别写入了 20 KB、28 KB 的 Cookies，时间不同，互不覆盖。
- `npm run typecheck` 0 错误；`npm run test` 126 个文件 / 950 条通过。

## 已知边界

- 环境登录必须人工完成一次（扫码 / 密码 / 短信），Agent 不代登录。
- 安装版需要重新打包才包含本功能；开发版数据在 `SPARO_CONFIG_DIR`（默认 `.devdata`），与安装版 `%APPDATA%\sparo-store` 互不影响。
- 同一个号不要在两个环境里同时登录（平台可能踢下线），这是平台行为，不是隔离失效。
