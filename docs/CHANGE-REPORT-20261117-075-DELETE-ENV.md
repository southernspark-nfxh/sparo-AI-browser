# 改动报告 — 0.7.5 delete_env 修复（供 Cursor 复核）

> **作者窗口**：Trae（本窗口自行实现，非 Cursor 交付）  
> **日期**：2026-11-17  
> **改动前基线**：HEAD `942fe18`  
> **本报告对应提交**：`bfbaaa8`（代码修复）→ `7a21ad8`（chore(release): 0.7.5）→ `beb7333`（包体元数据回写）  
> **复核对象**：`bfbaaa8` 的全部代码改动；`7a21ad8`/`beb7333` 为版本号与文档，无代码  
> **关联**：[QA-REPORT-20261117-074.md](./QA-REPORT-20261117-074.md) §5（N2 发现）· [DECISION-POINTS.md](./DECISION-POINTS.md) #63 · [QA-GOLDEN-SCENARIOS.md](./QA-GOLDEN-SCENARIOS.md) 0.7.5 段 · [MULTI-ACCOUNT.md](./MULTI-ACCOUNT.md)

---

## 0. 授权链（为什么是我改）

1. Cursor 0.7.4 全量 QA 发现 N2：`delete_env` 只删配置，已打开的环境标签不关、分区 Cookie 仍可读，与 MULTI-ACCOUNT「留空壳，不含有效登录态」承诺相反。Cursor 该轮**未改产品代码**。
2. Trae 复核确认后向用户提问收口路径，用户选择 **「改代码兑现文档（推荐）」**（选项描述含：登记决策点、补单测、真机验证、随下一个包发出）。
3. 按 AGENTS.md「新增会改走向的本地判断先登记再合码」，先写 DECISION-POINTS #63，再改代码。
4. 用户事后要求本报告，交 Cursor 独立复核。**复核不通过即回滚，见 §6。**

## 1. 改动清单（bfbaaa8，5 文件 +151/−6）

### 1.1 `src/main/browser.ts`（+31/−6，唯一的产品代码改动）

新增 `deleteEnvFully`（现 L6081–6108），`deleteEnvTool` 改为委托（L6110–6112），壳层 IPC `spark:delete-env` 改走同一方法（L5105–5108）。diff 原文：

```diff
-import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, unlinkSync } from "node:fs";
+import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, unlinkSync, rmSync } from "node:fs";
@@ handle("spark:delete-env")
-      stopEnvProxy(String(envId || ""));
-      return { ok: deleteEnvConfig(this.configDir(), String(envId || "")) };
+      const r = await this.deleteEnvFully(String(envId || ""));
+      return { ok: r.ok, message: r.message };
@@ deleteEnvTool
-  deleteEnvTool(envId: string): ToolResult {
+  async deleteEnvFully(envId: string): Promise<ToolResult> {
     if (!envId) return { ok: false, message: "envId required" };
     const env = getEnv(this.configDir(), envId);
     if (!env) return { ok: false, message: `env ${envId} not found` };
     stopEnvProxy(envId);
+    const envTabs = [...this.tabs.values()].filter((t) => t.envId === envId).map((t) => t.id);
+    for (const id of envTabs) this.closeTab(id);
     const ok = deleteEnvConfig(this.configDir(), envId);
+    if (ok) {
+      try {
+        const ses = session.fromPartition(`persist:env_${envId}`);
+        await ses.clearStorageData();
+        await ses.clearCache();
+      } catch { /* 清存储失败不挡删除；下面尽力删分区目录 */ }
+      try {
+        rmSync(join(this.configDir(), "Partitions", `env_${envId}`), { recursive: true, force: true });
+      } catch { /* Windows 网络进程可能锁文件；存储已清，留空壳可接受 */ }
+    }
     return {
       ok,
-      message: ok ? `env ${envId} deleted` : `env ${envId} delete failed`,
+      message: ok ? `env ${envId} deleted, closed ${envTabs.length} env tabs` : `env ${envId} delete failed`,
     };
   }
+  deleteEnvTool(envId: string): Promise<ToolResult> {
+    return this.deleteEnvFully(envId);
+  }
```

执行顺序：**停代理 → 关该环境全部标签 → 删配置 → 清分区存储 → 尽力删分区目录**。MCP `delete_env`（tools/index.ts L100 → mcp-server.ts L519 `await`）与设置页删除共用，无第二条删除路径。

### 1.2 `electron-builder.yml`（+2）

```diff
   - strategies/skills/**/*
+  # 运行台账是机器本地数据，不进安装包（QA 0.7.4 N1）
+  - "!strategies/skills/**/ledger/**"
   - package.json
```

只排除台账**数据目录**；写台账的代码 `scripts/ledger.mjs` 保留（0.7.5 asar 实测仅剩它）。

### 1.3 `tests/env-delete.test.ts`（新增 121 行，3 条）

沿用 `tests/env-follow.test.ts` 的 `Object.create(SparkBrowser.prototype)` + `vi.mock("electron")` harness；`session.fromPartition` mock 记录被清的 partition。三条：① 关环境标签/留其他标签/删配置/清存储/删目录；② 无打开标签时也清存储删目录；③ 环境不存在失败关闭不动标签。真实 `closeTab` 参与（stub 仅 layout/pushChromeState/listTabs/wakeTab）。

### 1.4 文档（2 文件）

- DECISION-POINTS.md +#63（先登记后合码）
- MULTI-ACCOUNT.md 删除口径改为：「删配置、**关掉仍开着的该环境标签并清空其分区存储**（0.7.5 起，#63）……若因 Windows 文件锁删不干净会留空壳，不含有效登录态」

### 1.5 版本与元数据（7a21ad8 / beb7333，无代码）

package.json / package-lock.json 0.7.4→0.7.5；CHANGELOG 0.7.5 条；AGENTS.md / docs/AGENTS.md / PRODUCT-TASKBOOK 版本行与 0.7.5 段；QA-GOLDEN-SCENARIOS 0.7.5 真机段；QA-MASTER-PLAN §10 N1/N2 状态更新。

## 2. 没改什么

壳层（shell.html / shell-preload / page-bounds / chrome-hole / shell-focus）、侧栏发稿链路（slots/loop/stub/intent-router/free-soul）、发布脚本（strategies/skills/**/*.mjs）、技能种子 JSON、MCP 工具表、envs/store.ts、singbox-runner.ts —— **全部零改动**。`git show bfbaaa8 --stat` 可核。

## 3. 已知边界与风险（复核重点，不隐瞒）

| # | 风险/边界 | 现状 | 建议复核动作 |
|---|---|---|---|
| R1 | 运行中 `rmSync` 必失败：Chromium 网络进程独占锁 Cookies 文件（实测 EBUSY）。目录留空壳 | 文档已按「留空壳」改写；存储清除靠 clearStorageData，不靠删目录 | 确认接受空壳；若要求目录必删，需下次启动重试清理（未做） |
| R2 | **双失败窗口**：clearStorageData 抛错且 rmSync 也失败时，有效登录态可能残留，但回执仍报 deleted | 两个 catch 都静默；真机/单测未覆盖此组合 | 评估是否给回执加 `storageCleared:false` 标记或日志；当前属已知缺口 |
| R3 | `closeTab` 副作用：关的是活动标签时切下一张并 wakeTab；只剩一张时补 about:blank；`lastClosed` 记下被关环境标签 | 「恢复刚关闭的标签」路径（browser.ts L3493 附近）对已删环境会 `createEnvTab` 抛「环境不存在」 | 核对该恢复路径的 catch 是否兜住；真机未测「删环境后恢复关闭标签」 |
| R4 | clearStorageData 作用域仅 `persist:env_<id>` | 真机验证默认标签存活、默认登录态不受影响 | 复核 session 缓存语义：fromPartition 返回存活 session，清的是该 partition 全存储 |
| R5 | IPC 回执从 `{ok}` 变 `{ok,message}` | shell.html L3805–3809 只 `.catch()`+`renderEnvs()`，兼容；确认框文案本就写「登录状态会一起清掉」，与新行为一致 | 目视确认设置页删除按钮流程 |
| R6 | `deleteEnvTool` 同步→Promise | 唯一调用点 tools/index.ts → mcp-server `await`，兼容 | grep 确认无其他同步调用点 |
| R7 | stopEnvProxy 在关标签之前 | 环境标签短暂断网后即被关闭，可接受 | 确认代理停止不影响其他环境 |

## 4. 验证证据（全部本窗口实跑）

### 4.1 静态与单测

- `npm run typecheck`：0 错误
- `npx vitest run`：**139 文件 / 1060 条全绿**（1057 旧 + 3 新），19.60s
- `npx vitest run tests/env-delete.test.ts`：3 passed

### 4.2 隔离真机（0.7.5 win-unpacked，MCP 3926）

环境：`SPARO_CONFIG_DIR=%TEMP%\sparo-qa-075`、`SPARO_MCP_PORT=3926`；用户 0.7.0（`D:\Program Files\Sparo`，3921）全程未动。脚本：`%TEMP%\sparo-qa-075-delete-env.mjs`（仓库外临时件，步骤见下）。

步骤与回执（节选原文）：

1. `create_env` → `{"ok":true,"message":"env created 5d6066dd","data":{"id":"5d6066dd",...}}`
2. `navigate({url:"https://example.com",envId})` → tabId `954b2085`
3. `execute` 写探针 → `{"result":"{\"cookie\":\"iso_del=A\",\"ls\":\"A\"}"}`
4. `delete_env` → `{"ok":true,"message":"env 5d6066dd deleted, closed 1 env tabs"}`
5. `list_tabs` → 2→1，环境标签不在，只剩默认标签 `e6822773`
6. `list_envs` → 名册不含 5d6066dd
7. 分区目录运行中仍在（R1）；**停掉隔离实例后**用 sql.js 读 `Partitions/env_5d6066dd/Network/Cookies`：`iso_del_rows= 0 total_rows= 0`（另一残留环境 91582b0b 同样 0/0）

判定口径说明：原脚本「目录必须消失」一步改为「停进程后 cookie 行清零」，**不伪称目录已删**；空壳与文档新口径一致。

复现注意：本环境 Shell 工具的命令退出时会回收子进程，隔离实例须用**前台进程挂在长驻后台 shell** 的方式启动（`& Sparo.exe` + run_in_background），Start-Process / WMI / explorer 转手均会在命令结束后死掉或落 session 0。复核时若遇「health 通但下一条命令连不上」，是这个原因，不是产品 bug。

### 4.3 安装包产物

- `release\Sparo-Setup-0.7.5.exe`：105,006,100 字节，2026-11-17 16:25:41，SHA-256 `960B3F17DB235ED8F3EF3BCD139370AFA56B7F14D50BAE313556095C43535FFC`，FileVersion 0.7.5
- 打包时间早于提交时间（16:25 构建、16:42 提交），**构建工作树与 bfbaaa8+7a21ad8 的代码内容一致**（构建后未再改 src）
- asar：`ledger/2026-11.jsonl` 已不在，仅 `scripts/ledger.mjs`；weixin 种子/脚本/platforms 均在
- 包内 `resources/social-publish-scripts/publish.mjs --self-check` = `SELF_CHECK_OK`

### 4.4 未验证（沿用旧记录，不冒充）

G1–G9 沿用 0.7.4 真机记录（0.7.5 未碰那些链路）；登录态项（G5 微信存草稿、五站 PROBE_OK、四站 dry-run、真实输入法 60 秒）仍欠；R2/R3 两个边界未真机覆盖。

## 5. 给 Cursor 的复核清单

1. `git show bfbaaa8` 逐行审 §1.1 diff；重点 R2（双失败静默）、R3（恢复关闭标签路径对已删环境的容忍）。
2. `npm run typecheck`；`npx vitest run tests/env-delete.test.ts`；`npx vitest run` 全量。
3. 真机复跑 §4.2 七步（隔离配置+端口自选，勿碰 3921）；停实例后 sql.js 核 cookie 行。
4. 设置页删除按钮走一遍（R5），确认框→删除→列表刷新→环境标签消失。
5. 删环境后试「恢复刚关闭的标签」（R3），记录是否抛错/兜住。
6. 核 asar 无 ledger 数据、有 ledger.mjs；包内 self-check。
7. 文档一致性：MULTI-ACCOUNT 删除口径、DECISION-POINTS #63、CHANGELOG 0.7.5、QA-GOLDEN-SCENARIOS 0.7.5 段四处口径是否互洽。
8. 结论写回本报告末尾或另开复核记录；**不通过项列明 reproduction**。

## 6. 回滚预案（复核不通过时）

- 代码回滚：`git revert bfbaaa8`（单提交即可恢复 deleteEnvTool 原状与 yml）；版本提交 `7a21ad8`/`beb7333` 另行 revert 或在下个版本吸收。
- 0.7.5 安装包作废声明写回 AGENTS.md / PRODUCT-TASKBOOK；用户桌面仍 0.7.0，不受影响。
- 若仅 R2/R3 需加固：在 bfbaaa8 之上追加修复提交，不必整体回滚。

## 附录：本会话 Trae 全部提交

| 提交 | 性质 | 内容 |
|---|---|---|
| `f565a99` | 代提交 | Cursor 的 QA 报告 + 黄金场景底账修订（Cursor  authored，Trae 仅 commit） |
| `942fe18` | 文档 | 七份滞后文档补齐 + QA-MASTER-PLAN §10 核对修订 |
| `bfbaaa8` | **代码** | 本报告主体 |
| `7a21ad8` | 版本 | 0.7.5 版本号 + CHANGELOG + 版本行 |
| `beb7333` | 文档 | 包体字节数/SHA/真机结果回写 |
