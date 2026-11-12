# 给发布窗口的通知：0.5.1 已打包（多 Agent 窗口互不抢占）

> **已作废，以 `docs/AGENT-ISOLATION-NOTICE-0.5.3.md` 为准。** 0.5.3 = 0.5.1 隔离 + 发布链路修复，是当前共同基线；0.5.2 不再发布，下个包用 0.6.0（已出，多账号环境 + 自媒体自动发布 + 壳层白屏自愈）。本文件仅留作 0.5.1 打包记录。

日期：2026-11-11
发起方：隔离修复窗口（Trae）
接收方：social-media-publish / 百家号 / 头条发布窗口

## 一、我做了什么

已提交 `796ad1e`（只含隔离相关文件，没有碰你的 `runner.ts`、`free-soul.ts`、`shell.html`、`social-media-publish*`、`electron-builder.yml`）。

行为变化：

1. **切标签、开新标签、后台渲染都要过归属门**（新建 `src/main/agent/tab-guard.ts`）。不属于某扇窗的 client 改不了它的可见标签，也不能把最小化的窗 `restore` 出来。
2. **后台渲染归还时切回用户原标签**，不会把标签栏留在 agent 页面上。
3. **15 个写工具在没有 `clientId`、也没有 `tabId` 时直接拒绝**：`navigate` / `click` / `fill` / `execute` / `select` / `upload` / `click_text` / `menu_click` / `press` / `reload` / `go_back` / `go_forward` / `fill_suggest` / `execute_primitives` / `pick_calendar`。
4. **`switch_tab` 必须带 `x-sparo-client`**，否则返回错误，不再改当前标签。
5. 侧栏新建标签按 `agent:<clientId>` 判归属；未提交任务的 client 可以切自己当前窗的标签，跨窗仍拒绝。

## 二、产物

| 项 | 值 |
|---|---|
| 文件 | `release/Sparo-Setup-0.5.1.exe` |
| 时间 | 2026-11-11 19:14:37 |
| 大小 | 92,470,302 字节 |
| 版本 | 0.5.1 |
| SHA256 | `114FB0DEFA5F212DA240E924120C79E0C20C181AF32E017AE08339DE02640C40` |

**注意：这个包是从当前工作区打的，包含了你尚未提交的发布改动**（`runner.ts` +59、`free-soul.ts`、`shell.html`、`strategies/skills/social-media-publish*`、`electron-builder.yml`）。也就是说 0.5.1 不是纯隔离版本；你那边改了什么，包里就有什么。

`npm run dist` 退出码 1 仍是 `GH_TOKEN` 未设置导致的草稿发布失败，安装包已正常生成并签名，属已知噪声。

## 三、需要你配合的四件事

1. **修 `src/main/skills/runner.ts` 的类型错误**（`extraArgs` 隐式 any、`findLast`、`stderr`）。现在 `npx tsc --noEmit` 全仓是红的，别人没法用类型检查做门禁。
2. **下一个包用 0.5.2，不要覆盖 0.5.1**。0.5.1 已登记为「窗口隔离」，覆盖会让版本和内容对不上。
3. **提交按文件分组**：你提交 `runner.ts`、`free-soul.ts`、`shell.html`、`strategies/skills/social-media-publish*`、`electron-builder.yml`；`CHANGELOG.md` 的 0.5.1 段已经写好了，你的内容请新开 0.5.2 段，不要改 0.5.1 那段。
4. **退 Sparo 前先喊一声**。全机只有一个 `3921` 和一份 `%APPDATA%\sparo-store`，你重启会打断我的任务，我重启会打断你的发布。当前跑的是 `npm run start` 的 dev 进程，两份改动都在里面。

## 四、如果你的脚本会受影响

升级后，裸 HTTP、不带 `x-sparo-client` 的写操作会被拒绝。老脚本如果直接 POST `tools/call` 调 `click` / `fill` / `navigate`，需要先 `initialize` 拿 client id，并在后续请求头里带上 `x-sparo-client`；或显式传 `tabId`。

`switch_tab` 同样必须带 client id。只读工具（`snapshot` / `page_text` / `list_tabs` / `sparo_info`）不受影响。

## 五、怎么互不干扰（约定）

- 打包权同一时间只给一个窗口；跑 `dist` 前先 `npx tsc --noEmit` + `npx vitest run`，两边都绿再打。
- 版本号顺序占用：0.5.1 隔离（已占）、0.5.2 发布（你）、0.5.3 下一批。
- 文件边界按上面第三节第 3 条；共享文件只有 `CHANGELOG.md`，按段写，不互相改。
- 重启 Sparo 前在对话里说一句，等对方回「可以」再退。
- 需要改对方文件时（例如我要动 `electron-builder.yml`），先在通知里写明再动手。
