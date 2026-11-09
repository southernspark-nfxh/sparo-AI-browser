# 多开 0.4.1 修复任务书（8 个回归红）

> 目标：把 `chrome-hole`（6 红）+ `keepalive`（2 红）修绿，**生产代码零改动**。
> 判据与证据在 `docs/REVIEW-MULTIWINDOW-0.4.1-2026-11-09.md`（复审窗口已实测：老代码 25/25 全绿，多开版 8 红）。
> 版本号、CHANGELOG、tag、打包**都不在本任务书范围**，由发版窗口统一处理。

## 0. 派给谁（这一节先说清楚）

| 工作项 | 谁来做 | 为什么是他 | 交付物 |
|---|---|---|---|
| **本任务书：修 8 个回归红** | **多开窗口**（当前 owner：`D:/download/sparo-multi-window`） | 代码是它写的，上下文最全；改测试不涉生产逻辑 | 两个测试文件绿 + 一个测试 helper 文件 |
| 同上，**若多开窗口已停**（会话结束/额度用完） | **Cursor**，照本任务书执行 | 任务书自带病根定位，不依赖上下文 | 同上 |
| 合并 `feat/multi-window` → master、真机双窗验收、封板 `v0.4.1`、**打包** | **总负责窗口（我）** | 打包权已收口，且我不能既改码又验码 | `Sparo-Setup-0.4.1.exe` + 发版记录 |
| 版本号 / CHANGELOG / tag | **总负责窗口（我）** | 四项权限收口（见 `RELEASE-PROTOCOL.md`） | — |
| R11 Part A（判重接口契约与纯函数） | **Cursor**（任务书另发：`ECOMMERCE-PHASE1-FIX-R11-CURSOR-TASKBOOK.md`） | 与多开无关，可并行 | `dxm-smt-api.ts` + 单测 |
| R11 附录 C 接口采样 | **总负责窗口（我）** | 依赖 `tabId` 线程化先落地 | `APPENDIX-C-BOX-API.md` |
| 主工作区 `tabId` 线程化收尾 | **原改动窗口**；若无人认领，我复审后决定是否交 Cursor | 改动是它做的 | 可提交的干净改动 |

**一条纪律**：改这份码的人不许自己宣布"通过"，绿不绿由我复核。

## 1. 现场与禁令

- 工作树：`D:/download/sparo-multi-window`，分支 `feat/multi-window`，HEAD `e9e8bb2`。
- 未提交：`CHANGELOG.md`、`package.json`（0.4.1）、`src/main/browser.ts`（61 行惰性初始化）。
- **禁令**：
  1. 不许再改 `src/main/browser.ts`、`src/main/index.ts` 的任何一行（本任务书唯一的例外见 §3.1，那是**撤回**已改的内容，不是新改）。
  2. 不许改任何断言、测试名、跳过（skip）任何用例。
  3. 不动 `package.json` / `CHANGELOG.md`（版本号已被冻结）。
  4. 不打包、不合并 master、不 push、不打 tag。
  5. 不许 `git stash` / `reset` / `clean`；`git checkout --` 只允许对 `src/main/browser.ts` 用一次（撤回 61 行，见 §3.1）。
  6. 只许动：`tests/chrome-hole.test.ts`、`tests/keepalive.test.ts`、新建 `tests/helpers/browser-fixture.ts`。

## 2. 病根（已定位到字段，不用再查）

8 个红是**同一个病根**：多开重构把"当前窗口"从隐式单窗变成了显式的 `activeWinId` + `wins` 表，而测试工装是 `Object.create(SparkBrowser.prototype)` 造的空壳实例，**不跑字段初始化器**，于是这些新状态全是空的/undefined。

| 现象 | 直接原因（代码位置） |
|---|---|
| `chrome-hole` 6 红：后台页没被挪走（`visible` 仍是 `true`，`x` 不是 `-20000`） | `assertChromeHole` → `chromeWatchOrder()` 用 `(tab.winId \|\| "main") === this.activeWinId` 过滤标签。空壳实例里 `activeWinId` 是 **`undefined`**，"main" ≠ undefined → **所有标签被过滤掉，一个都不巡检** |
| `keepalive` 红①：`throttle` 是空数组（节流没调） | `syncShellKeepalive()` → `liveWins()` **只遍历 `this.wins`**。工装只写 `browser.window = 假窗口`，`wins` 是空的 → 直接 return |
| `keepalive` 红②：`flashes` 是空数组（没闪任务栏） | `noteSidebarMessages()` 守卫：`!this.placedWins.has(this.activeWinId)` → `placedWins` 空 → 直接 return。另外工装还在设 `didPlaceWindow`，这个字段**生产代码里已经删了**，设了没用 |

**他那个 61 行「集合改成用到才建」为什么没用**：`??=` 只挡住了"调 `.get` 抛错"，挡不住 `activeWinId` 是 undefined、`wins` 空、`placedWins` 空这三件事。实测带着这 61 行跑，**仍然 8 红**。所以：撤回它，改工装。

## 3. 怎么修（只改测试，生产一行不动）

### 3.1 先撤回那 61 行（唯一允许的回退）

```bash
cd D:/download/sparo-multi-window
git diff src/main/browser.ts > "$TEMP/lazy-init-61lines.patch"   # 先备份
git checkout -- src/main/browser.ts                              # 再撤回
git status --short                                               # 应只剩 CHANGELOG/package.json
```

- patch 留着备查（在临时目录，不进库），撤回后确认 `browser.ts` 与 HEAD 一致（`git diff --stat` 里不再出现它）。
- 撤回后先跑一次那两个测试文件，预期**还是 8 红**（甚至更多抛错）——这是正常的，说明缺口在工装。

### 3.2 新建 `tests/helpers/browser-fixture.ts`

导出一个 `makeBrowser()`，统一把空壳实例补成"可用的单窗实例"：

1. `const browser = Object.create(SparkBrowser.prototype)`；
2. 补 8 个按窗口存的集合（每个都 `new Map()` / `new Set()`）：
   - `wins`（`Map`）、`activeTabs`（`Map`）、`shellReadyWins`（`Set`）、`placedWins`（`Set`）、`holeBoundsByWin`（`Map`）、`sidebarWByWin`（`Map`）、`lastGoodContentByWin`（`Map`）、`lastLayoutContentByWin`（`Map`）；
3. **`activeWinId = "main"`**（关键，6 个 chrome-hole 红就死在这）；
4. 把传进来的假窗口同时放进 `wins`（键 `"main"`）**和** `window`（保留老 fallback，`win` getter 走的是 `wins.get(activeWinId) || this.window`）；
5. `placedWins.add("main")`（让"已摆过窗口"这个判断成立）；
6. 返回 `{ browser, win }`。

> 若发现这些字段是 `private`，用现有的测试写法（`as unknown as` 断言类型）处理，**不要为了测试把生产字段改成 public**。

### 3.3 两个测试文件改成走 helper

- `tests/chrome-hole.test.ts`：`bare()` 改为 `makeBrowser().browser`；`armHole()` 里`browser.window = {...}` 改为通过 helper 的 `win` 注入（其它 setup 保留）。
- `tests/keepalive.test.ts`：`shell()` 里的 `browser.window = {...}` 同样改走 helper；删掉 `didPlaceWindow` 那行（死字段，删掉不影响任何断言）。
- 断言、测试名、用例数量**一个都不许变**。

### 3.4 如果修的过程中发现生产代码真有 bug

停下来，把现场（文件、行号、复现步骤、你的判断）写进汇报交给我判，**不许自己改生产代码**。本任务书的前提是"这 8 个红是可测性问题"，如果前提被推翻，我要重新评估。

## 4. 验收（我复核，硬指标）

1. `npx vitest run tests/chrome-hole.test.ts tests/keepalive.test.ts` → **25/25 绿**。
2. `npm test` → 884 项；除 `mission-journal`（既有慢测试，单独跑 14.3s 通过）外**零红**。出现别的红，逐条查清再报。
3. `npm run typecheck` / `npm run lint` / `npm run build` 通过。
4. **`git diff --stat` 里 `src/` 下零改动**（只出现 `tests/` 下文件）。这一条不满足，直接驳回。
5. 汇报里必须包含：动工前 `git status --short` 原文、收工时 `git diff --stat`、上面三条命令的输出尾巴。

## 5. 修绿之后归我（你不用做）

合并 `feat/multi-window` → master → 双窗真机（开窗 / 关窗 / 最小化续跑 / 标签互不干扰）→ 推送 → 封板 `v0.4.1` → 我打包 `Sparo-Setup-0.4.1.exe` → 安装包验收（G1–G3 + 双窗场景）。

## 6. 顺序提示（照这个顺序做，别跳）

1. 存 patch → 撤回 61 行 → 跑两文件（预期仍红）
2. 建 helper → 改 `chrome-hole` → 跑 → 改 `keepalive` → 跑
3. 全量 → typecheck/lint/build → 汇总 diff
4. 汇报，等我复核。**不许自己宣布通过。**
