# Sparo 电商一期交接单（2026-11-09）

> **本交接对应版本 0.4.0——Trae 负责开发的最后一个版本，之后的版本由 Workbuddy 来指挥开发。**
> 交接原因：规划方工具（Trae）额度耗尽，开发交接给下一个 AI 工具（Workbuddy）继续。
> 交接范围：电商一期主线（店小秘采集 → 速卖通认领）R2–R9B 全部工作。
> 协作模式（沿用它）：**规划方写任务书 → Cursor（执行方）改代码 → 规划方复审 + 真机验收**。任务书都在 `docs/`，执行方拿任务书就能开工。

---

## 0. 一句话现状

判重链路（R9-6 激活时序方案 A）真机已通：ambiguous / absent 两态都验收通过；**live 认领（R9-4）停在最后一步**——工作单已停在授权门「认领需要你当场确认」，等用户授权后跑真实认领即完成闭环。另发现判重有约 50% 概率的时序抖动（pollBox 10 秒预算 vs 渲染 6-15 秒），修复挂 R10。

## 1. 项目背景

- 仓库：`d:\download\sparo上架应用商店版`（商店版主线；原版 `D:\download\Sparo` 只同步侧栏能力，不搬云订阅）
- 数据目录：`%APPDATA%\sparo-store`；MCP：`http://127.0.0.1:3921`
- 功能入口：`dxm_smt_*` 工作流（probe/prepare/status/publish/shops），**只走 Free Soul 侧栏白名单**，不进 `WORKFLOWS`
- 预览开关：`dxmEnabled()` 在 `src/main/features.ts` 硬编码 `return false`（商店版硬关，**禁区：不许改**）；开发验证用 `SPARO_DXM_SMT_PREVIEW=1` 环境变量（见 `src/main/workflows/dxm-smt-preview.ts` 的 `gateFreeSoulWorkflow`）

## 2. 已完成并验收（按时间序）

| 轮次 | 内容 | 状态 |
|---|---|---|
| R7 | 判重第一版（ant 选择器） | **不通过**，事故记录见 `docs/ECOMMERCE-PHASE1-R7-ACCEPTANCE-RECORD.md`（假 absent 放行，根因见 §4.1） |
| R8 | 认领纯函数、claimConsent 授权门、防重复认领 | 代码已合，live 停等 |
| R9-0 | 附录 B 采集箱 vxe 结构采样（只读，100 行实测） | 已回填 R9 任务书 |
| R9-1 | 判重返工：vxe 选择器 + 三态判定（ambiguous/absent/unknown） | **真机通过**：六轮全部安全停等，不再假 absent |
| R9-2 | 侧栏禁绕话术（停等后禁手动代点写按钮） | **真机通过**：六轮零写入 |
| R9-3 | 工作单标签改绑（tab_rebound，解死绑） | **真机通过**：三次 verified |
| 附录 A | 认领弹窗 DOM 采样（用户当场授权，点保存并认领→只读采样→点关闭） | 已回填 R9 任务书 |
| R9-6 | 判重读取解堵：port 加 `activateTab`/`getActiveTabId`，lookupOrder 激活-恢复时序 | **真机通过**：ambiguous「标题精确匹配 1 条」+ absent「认领需要你当场确认」两轮都过 |
| R9B-代码 | Cursor 交付：activateTab 实现、claim 常量回填（取消=「关闭」）、可见性过滤 | **代码复审通过**（stash 只读核对三项） |
| 测试 | 定向 51 项 + 全量 884 项全过、typecheck/lint(0 error)/build 通过 | 完成（Cursor R9B 完成记录） |

### 附录 A 关键采样结论（认领弹窗）

- 容器 `.ant-modal-wrap > .ant-modal`，标题 `.ant-modal-title` =「选择店铺-认领到采集箱」
- 确认按钮文字 =「**确定**」（`button.ant-btn-primary`）；取消按钮文字 =「**关闭**」（R8 夹具假设的「取消」是错的）
- 店铺复选：`label.ant-checkbox-wrapper`，默认全未勾选，「已选(N)」计数
- **shopId 不在弹窗 DOM**（checkbox value 恒 "on"）→ 店铺匹配只能走店名文本精确匹配
- **隐藏陷阱**：`display:none` 的「eBay产品默认认领到原站点」默认勾选——读勾选态必须过滤不可见项（R9B 已实现三重过滤）

## 3. 中断点（接手第一件事看这里）

### 3.1 R9-4 live 认领真机验收 —— 差最后一步

已完成：用户删除挂腰风扇草稿 → prepare 判重正确判 **absent** → 工作单（`dxm-mw7zvfpy-107cf8`）停在授权门「认领需要你当场确认，已停等，没有点保存并认领」。

**待做**（需用户坐在电脑前当场授权）：

1. 带 `SPARO_DXM_SMT_PREVIEW=1` 重启开发版
2. 侧栏发授权消息（如「我授权认领」）→ 侧栏带 claimConsent 续跑工作单
3. 期望流程：点「保存并认领」→ 弹窗勾 PetLifeGlobal → 点「确定」→ 读回三证（draftId/shopId/recordId）→ 工作单落 `claimedDraftId` → 停在写字段/翻译入口
4. **顺路采附录 A 剩余待采项**：成功落点结果文案节点（已知文案「认领到采集箱 状态：已完成！…成功 1 条」）、成功后 URL 形态、三证读回位置
5. 完成后再跑一次同记录 prepare → 验证不二次认领（应停 ambiguous）

硬边界（R8/R9 任务书已写，全部沿用）：无 claimConsent 零点击；弹窗里目标外有可见勾选停等不代取消；只允许「勾目标店铺（若未勾）」和「点确定」两个动作；授权不落盘不跨次复用。

### 3.2 插桩未还原（3 行 console.info）

`src/main/workflows/dxm-smt-live.ts` `pollBox` 里有 `[dxm-poll]` 日志插桩（约 L365-372）。**建议保留到 R10 时序修复完成后一起还原**，还原后 git diff 应只剩 R2–R9B 正式改动。

### 3.3 Git 状态

- R2–R9B 全部**未提交**（无 commit）
- 工作区已恢复全部内容；另有 stash 副本 `stash@{0}`（留言「店小秘R2-R9B+T63 半成品，打包期间暂存」，内容与工作区一致，验收确认后可 `git stash drop`）
- 打包期间产出的 `docs/RELEASE-032-CLOSURE-TASKBOOK.md` 是打包相关任务书（0.3.2 发布收尾），与电商一期无关但同在工作区
- **何时提交、怎么分 commit，等用户决定**（接手方不要擅自 commit）

## 4. 已知缺陷与待修

### 4.1 历史根因（已闭环，写给接手方理解架构）

parkPageView（browser.ts ~L3179）把后台标签 `setVisible(false)` + x=-20000 移出窗口；**vxe 表体渲染当且仅当标签为活动标签**（三角插桩验证：可见+窗外不行、窗口内被盖住不行、激活秒渲染）。这是 R7 假 absent 的完整根因：parked 标签只能读到初始 HTML「暂无数据」占位 → 当 0 行放行。R9 三态判定安全转 unknown，R9-6 activateTab 方案解堵。

### 4.2 判重时序抖动（R10 第一优先级）

- 现象：同一场景约 50% 成功率。16:50 轮插桩日志：`t=9586 loaded=false rows=0 → t=11610 loaded=true rows=8 → t=12528 又 false → t=14037 true`（渲染在抖，10 秒预算内刚好赶上或赶不上）
- 修复方向（任选或组合）：
  1. pollBox 预算 10s → 20-30s（最简单）
  2. 等「渲染稳定」：连续 2 次读取行数相同才判 loaded（防抖）
  3. 等 `requestIdleCallback` / vxe 渲染完成标记
- 备选方案 B（R9-6 任务书已写）：判重数据源从 DOM 改为页面列表 XHR 接口重放，彻底摆脱渲染依赖——若拉长预算仍不稳再上

### 4.3 开发版崩溃（挂观察，不算电商一期范围）

今天崩了 ~5 次，exit code -1。已知诱因：
- 会话恢复带回的百度首页标签 `render-process-gone` 带崩整个 app（关掉该标签后不再复现，但会话恢复会再带回——治本要改会话恢复过滤或查 GPU）
- 16:49 一次崩溃发生在判重 box 标签激活期间（active=23df542b），16:52+ 用户锁屏/解锁前后——疑似与休眠/锁屏相关，未定位
- 开发版与安装版共享 userData（`sparo-store`）：单实例锁 + 3921 端口冲突，**装版不退出开发版起不来**（起不来时表现为 npm run start 秒退 + health 响应来自装版）

### 4.4 侧栏自主探索行为（观察项）

16:47 用户在侧栏发「????」，侧栏自行开始探索：填了采集箱搜索框 32 字、点了无效坐标被拒（-588,-624）、按了 Enter。未造成损害但说明停等期间侧栏收到模糊消息时可能自行操作页面。禁绕话术（R9-2）只约束「代点写按钮」，不约束搜索框。要不要收紧挂用户决定。

## 5. 未来开发计划（统一记录，按优先级）

### P0 — 立即（接手后第一周）

1. **R10 判重时序修复**（§4.2 方案，Cursor 任务书可直接从 R9B 任务书 R9-6 备选段扩写）
2. **R9-4 live 认领真机验收收尾**（§3.1，需用户当场授权）
3. 完成后：还原插桩、跑全量回归、整理 commit（等用户点头）

### P1 — 电商一期剩余主线

4. 写字段 / 文字翻译 / 保存草稿 / 选分类 / 发布——目前**全部停等**（设计如此），按里程碑逐个放开；写之前先采样对应 DOM（照附录 A/B 的模式：任务书附录 → 回填 → 再实现）
5. E1–E12 端到端场景验收（一直挂账未跑）
6. 安装包验收：至少复测 G1/G2/G3 黄金场景（`docs/QA-GOLDEN-SCENARIOS.md`）
7. 僵尸态专项：休眠唤醒后判重是否正常

### P2 — 稳定性与体验

8. 开发版崩溃排查（§4.3：会话恢复过滤 / GPU / 锁屏）
9. 侧栏停等期间的自主探索收紧（§4.4，先问用户）
10. 判重激活标签的用户可见性优化（现在会看到标签短暂切换，已接受；若上方案 B 则彻底消失）

### P3 — 远期（有设计稿未开工）

11. **方案 B**：判重/认领数据源 XHR 化（摆脱 DOM 渲染依赖，同时服务判重和将来列表操作）
12. 技能社区 M2（`docs/SKILL-COMMUNITY-M2.md`，M1 人测过完再开）
13. 三通道架构（`docs/THREE-CHANNEL-DESIGN.md`，设计稿，评审后分期落地）
14. 商店上架：`docs/listings/` 提审前另做一轮（**禁区：现在不要动**）

## 6. 接手必读 — 技术知识（全部实测踩坑）

### MCP 调用（PowerShell）

```powershell
# 端点 http://127.0.0.1:3921/mcp；Bearer token 读 %APPDATA%\sparo-store\mcp-auth.json 顶层 .token
# 必须带头：Accept: application/json, text/event-stream
# 流程：initialize → 从响应头 x-sparo-client 取值，后续请求都带上 → notifications/initialized → tools/call
# 请求体必须 UTF8 字节（中文消息）
# PS5 下写 .ps1 跑：Invoke-Expression ([System.IO.File]::ReadAllText("脚本路径"))
```

### 驱动侧栏跑工作流

- `run_workflow` 直调 `dxm_smt_*` 会被 `dxmEnabled()` 拒（商店版设计如此）
- **唯一通路**：MCP `sidebar_chat { text }`，消息模板（六次验证有效）：
  「打开采集记录编辑页 https://www.dianxiaomi.com/web/productCrawl/edit?id=167842582613033710 然后跑 dxm_smt_prepare，目标店铺 PetLifeGlobal，来源记录 167842582613033710。我没有授权认领。」
- sidebar_chat 同步阻塞到整个侧栏任务完成；fire-and-forget 用短 Timeout + try-catch 实现
- 结果落账：`%APPDATA%\sparo-store\dxm-smt-journal.jsonl`（判重结论/停等原因/evidence 都在这，轮询这个文件判断结果，注意匹配中文文案）

### 关键机制

- **MCP `execute` 无 tabId 参数、永远跟活动标签**；workflow 内部 `surface.execute(script, tabId)` 可对指定标签执行（port 定义在 browser.ts `createLiveDxmSmtPort` ~L5510）
- **electron-vite dev 不热重载主进程**：改 src/main 后必须杀进程重启，用 `Select-String -Path out\main\index.js -Pattern '标记串'` 验证进了 bundle
- 判重流程（`dxm-smt-live.ts` `lookupDraft`/`searchBox`）：openTab → activateTab(box) → pollBox(10s/400ms) → 第一页 decideBoxLookup（标题精确匹配 N 条→ambiguous；0 行+真空→absent）→ 没结论则 URL 搜索 `?title=` → 再 pollBox → decide
- 店小秘编辑页有未保存改动时，同标签导航到列表路由会被页面保护弹回（新标签不受影响）
- 全量测试 `npm test`：884 项；**`chrome-hole.test.ts:493` 是 park 停放位时序抖动（期望 x=-20000），与判重缺陷同源，不许改断言**

### 关键代码位置

| 模块 | 文件 | 要点 |
|---|---|---|
| 判重读取+纯函数 | `src/main/workflows/dxm-smt-box.ts` | READ_BOX_SCRIPT（vxe）、decideBoxLookup |
| live 流程 | `src/main/workflows/dxm-smt-live.ts` | lookupDraft ~L120、searchBox ~L316、pollBox ~L358（**有插桩**）、claim ~L200 |
| 认领 | `src/main/workflows/dxm-smt-claim.ts` | 常量已回填、「关闭」、可见性过滤 |
| 工作单/入口 | `src/main/workflows/dxm-smt-listing.ts` | prepareParams、授权门 |
| 工作单契约 | `src/main/workflows/dxm-smt-contract.ts` | bindTabs 旧值优先（改绑由 listing 层显式做） |
| port/activateTab | `src/main/browser.ts` | createLiveDxmSmtPort ~L5510、activateTab ~L5598、parkPageView ~L3179 |
| 测试 | `tests/dxm-smt-r9b.test.ts` 等 + `tests/fixtures/dxm-smt-*.html` | 夹具全是编造数据 |

### 文档索引

- 现行任务书：`docs/ECOMMERCE-PHASE1-FIX-R9-CURSOR-TASKBOOK.md`（附录 A/B 已回填 + §6 验收记录）、`docs/ECOMMERCE-PHASE1-FIX-R9B-CURSOR-TASKBOOK.md`（R9-6 + R9-4 + §6 验收记录）
- 总任务书 + 各轮完成记录：`docs/ECOMMERCE-PHASE1-CURSOR-TASKBOOK.md`
- 决策点登记：`docs/DECISION-POINTS.md`（现 #35–#48；**新增会改走向的本地判断必须先登记再合码**）
- R7 事故记录：`docs/ECOMMERCE-PHASE1-R7-ACCEPTANCE-RECORD.md`

## 7. 禁区与死规则（违反 = 返工）

- 不改 `dxmEnabled()`；`dxm_smt_*` 只走 Free Soul 侧栏白名单
- 不把云端 Key 写进客户端；不提交 Git（等用户决定）；不打安装包
- `docs/listings/` 不要动（提审前另做一轮）
- 写字段、翻译、保存、发布、选分类继续停等；无 claimConsent 零点击；不代用户取消弹窗里别人店铺的勾选
- 判重选择器只认已核对值，采不到就停等不猜
- 死规则：后台任务不把窗口拉回前台（activateTab 不 window.focus 不闪任务栏）；多种信息调研必须出报告页；关单必有声
- **改完先自己 QA 再让人验收**；单测绿 ≠ 黄金场景过

## 8. 环境快照（2026-11-09 交接时）

- 开发版进程已停止（最后一批崩溃 exit -1，见 §4.3）；重启命令：`$env:SPARO_DXM_SMT_PREVIEW='1'; $env:SPARO_ENABLE_DXM='1'; npm run start`（先确认安装版 Sparo 已退出，否则起不来）
- HEAD `5f2b12a` + 未提交改动（R2–R9B + 插桩 3 行）+ stash@{0} 副本
- 挂腰风扇草稿：**已删除**（验 absent 用）；认领验收会重新保存+认领回来
- journal 现行工作单：`dxm-mw7zvfpy-107cf8`，waiting_human 停在授权门
- 真机账号：店小秘已登录（登录态在 sparo-store userData），目标店铺 PetLifeGlobal，来源记录 167842582613033710，采集箱共 137 条草稿（挂腰删除后 136 条）

---

*交接单由规划方（Trae）于 2026-11-09 整理。接手方从 §3 中断点继续。*
