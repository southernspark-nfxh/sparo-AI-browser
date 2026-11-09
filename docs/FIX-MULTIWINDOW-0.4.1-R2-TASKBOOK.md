# 多开 0.4.1 修红任务书 R2（惰性初始化 + 全量基线）

> 上一份 [FIX-MULTIWINDOW-0.4.1-TASKBOOK.md](./FIX-MULTIWINDOW-0.4.1-TASKBOOK.md) 的硬验收漏了「全量零红」，本轮修正，**验收以此文为准**。
> 执行位置：`D:/download/sparo-multi-window`（分支 `feat/multi-window`）。**不许在主仓执行**。

---

## 0. 现场快照（2026-11-09 夜）

| 项 | 值 |
|---|---|
| HEAD | `e9e8bb2` |
| 工作区 | 4 改 1 新：`CHANGELOG.md`、`package.json`(0.4.1)、`tests/chrome-hole.test.ts`、`tests/keepalive.test.ts`、`tests/helpers/browser-fixture.ts`（新） |
| 目标两文件 | `chrome-hole` 15/15 + `keepalive` 10/10 = **25/25 绿** |
| 全量 | **67 failed / 817 passed（884 项，22 文件）**，报错清一色 `Cannot read properties of undefined (reading 'set')` |
| 根因 | `SparkBrowser` 的 8 个按窗口集合是**类字段初始化器**；24 个测试文件用 `Object.create(SparkBrowser.prototype)` 造空壳，拿不到这些字段 |

8 个集合：`wins`、`activeTabs`、`shellReadyWins`、`placedWins`、`holeBoundsByWin`、`sidebarWByWin`、`lastGoodContentByWin`、`lastLayoutContentByWin`。

---

## 1. 目标

1. 用**惰性初始化**替代类字段初始化器，让空壳实例首次访问时也能拿到集合。
2. 全量测试恢复到 **884 绿**（仅 `mission-journal` 偶发超时豁免）。
3. 改动单独提交，**不打包、不打 tag、不合并 master、不自己宣布通过**。

---

## 2. 允许与禁止

**允许**（只改初始化时机，行为等价，主进程单线程）：

- 8 个字段改为 `private get x() { return (this._x ??= new Map()) }` 形式。

**禁止**（任一违反即返工）：

- 改业务行为、放宽校验、伪造返回值让测试通过。
- 在生产代码里加测试专用分支。
- `git stash` / `reset` / `checkout --` / 整文件格式化。
- 动 `browser.ts` 以外的主进程文件。
- 越权改版本号 / CHANGELOG / 打 tag / 打包（这四项权限归发版窗口）。

---

## 3. 执行步骤

### S1 记录基线

```powershell
npm test 2>&1 | Tee-Object baseline-r2.log
```

要求：基线日志里能查到 `67 failed / 817 passed`。**先存证，再改码。**

### S2 惰性初始化

`src/main/browser.ts` 里 8 个集合改成惰性 getter。硬要求：

- getter **零副作用**：不读页面状态、不发 IPC、不打日志、不触发窗口创建。
- 对外类型不变（`Map<string, X>`），调用方一行不改。
- 新增的私有字段用 `?` 可选，首次访问才 `new Map()`。

### S3 全量验证

```powershell
npm test
npm run typecheck
npm run lint
npm run build
```

达标线：

- 全量 **884 绿**（`mission-journal` 偶发超时允许重跑一次单独确认）。
- 目标两文件 **25/25** 连跑 3 次稳定。
- typecheck / lint（0 error）/ build 全过。

### S4 基线对照

把 `browser.ts` 的改动存成 patch 后临时回退，用未改代码跑同一批失败文件，确认红的现象与基线一致；对照完恢复改动。**不做对照不算完成。**

### S5 提交（两个，分开）

```text
提交 1  test(helpers): 测试工装补齐按窗口集合 + 两文件适配
        含：tests/helpers/browser-fixture.ts（新）、tests/chrome-hole.test.ts、tests/keepalive.test.ts
        CHANGELOG.md / package.json(0.4.1) 内容按现状保留，随本提交入库

提交 2  refactor(browser): 8 个按窗口集合改为惰性初始化
        仅 src/main/browser.ts
```

### S6 交付证据（缺一不可）

- `git log --oneline -2` 与 `git status --short`
- 全量测试输出（含 passed/failed 计数）
- typecheck / lint / build 输出
- 8 个 getter 的逐条说明：改了哪个字段、getter 里做了什么（应为「只建空集合」）

---

## 4. 验收（发版窗口复核）

| # | 硬条件 |
|---|---|
| 1 | 全量 884 绿（除 `mission-journal` 偶发） |
| 2 | `src/` 只动 `browser.ts` 的 8 个字段 |
| 3 | 8 个 getter 零副作用，逐条说明通过 |
| 4 | 两个提交分开，提交信息与内容一致 |
| 5 | 未打包、未打 tag、未合并 master |

**不通过就退回重做，不进下一关。**

---

## 5. 通过之后（发版窗口执行，不是本任务）

1. 复核 S6 证据（重点看 getter 有无副作用）。
2. 双窗真机六项：开第二窗 / 关主窗副窗存活 / 最小化继续收消息不降频 / 两窗各跑 agent 不串台 / 标签归属与地址栏各自正确 / 不抢用户焦点。
3. 合并 `feat/multi-window` → master，推送。
4. 按 [RELEASE-PROTOCOL.md](./RELEASE-PROTOCOL.md) 封板 `v0.4.1`，打包 `Sparo-Setup-0.4.1.exe`（不覆盖 0.4.0）。
5. 安装包跑 G1–G3 并回填 QA 表。

---

## 6. 已知风险

- 惰性 getter 与 `tests/helpers/browser-fixture.ts` 里的「先读后写」逻辑叠加时，整体赋值会覆盖 getter —— helper 已按先读后写实现，无需再改；如遇异常先查这一处。
- `mission-journal` 是既有慢测试（并发超 20s），不是本轮引入；判红必须做基线对照。
