# 工作日志与明日计划（2026-11-09 收工稿）

> 本文只做两件事：记今天干完什么、列明天按什么顺序干。
> 全景背景看 [PROGRESS-HANDOVER-2026-11-09-NIGHT.md](./PROGRESS-HANDOVER-2026-11-09-NIGHT.md)，卡点依据看该文 §3。

---

## 一、今日工作日志（2026-11-09）

### 1. 主仓已收口，可出货

| 项 | 结果 |
|---|---|
| 版本 | `package.json` = 0.4.0 |
| 提交 | `3971076`（R10 代码+测试+决策点）、`094444d`（tabId 定位）、`27bee8c`（发版规程/多开复审/总交接）、`36a3580`（补记清账与认领核对） |
| 远端 | master 与 origin 同步 |
| 封板 | tag `v0.4.0` → `dcf7d19`，已推送 |
| 安装包 | [Sparo-Setup-0.4.0.exe](../release/Sparo-Setup-0.4.0.exe)，92,333,128 B，留档副本已建 |
| 工作区 | 干净，仅 `.workbuddy/` 未追踪（工具产物，不入库） |

### 2. 电商判重线

- **R10 代码交付并复审通过**：三次一致 + 800ms 确认 + 30 秒预算；定向 31 项绿，typecheck / lint / build 全过。代码不退。
- **R10 真机 6 轮验收全败（0/6）**，插桩查实真因：窗口最小化或完全遮挡时，Chromium 不绘制、页面不发取数请求，`execute` 执行成功但 vxe 表体 0 行；加 `setBackgroundThrottling(false)` 无效。结论：「读画面」方案在「后台跑」的产品定位下走不通。
- **R11 任务书已成文**（方案 B：直接读数据接口），Part A 可即刻开工，Part B 等附录 C 采样 + 书面放行。
- **认领收尾只读核对完成，未点写操作**：采集箱 136 条（100 + 36）全表匹配 `7107102 / 挂腰风扇 / F19` 零命中，结论 `absent`。工作单 `dxm-mw7zvfpy-107cf8` 仍挂起，页面停在编辑页。

### 3. 多开 0.4.1 线

- 独立副本 `D:/download/sparo-multi-window`，分支 `feat/multi-window`，HEAD `e9e8bb2`。
- 8 个红（页面洞 6 + 节流/闪烁 2）已修绿：`chrome-hole` 15/15、`keepalive` 10/10，`src/` 零改动。
- **但全量炸了：67 failed / 817 passed（884 项）**，报错统一为 `Cannot read properties of undefined (reading 'set')`。
- 根因：`SparkBrowser` 8 个按窗口集合是类字段初始化器，24 个测试文件用 `Object.create(SparkBrowser.prototype)` 造空壳，拿不到这些字段。
- 裁决已定（交接单 §4.1）：采用惰性初始化（行为等价），单独提交；测试工装统一列为技术债，不阻塞。

### 4. 今天新产出的文档（均已入 git）

- `ECOMMERCE-PHASE1-FIX-R10-CURSOR-TASKBOOK.md`（含 §7 真机插桩证据）
- `ECOMMERCE-PHASE1-FIX-R11-CURSOR-TASKBOOK.md`
- `RELEASE-PROTOCOL.md`（提交 / 推送 / 打包三段上锁）
- `REVIEW-MULTIWINDOW-0.4.1-2026-11-09.md`
- `FIX-MULTIWINDOW-0.4.1-TASKBOOK.md`
- `PROGRESS-HANDOVER-2026-11-09-NIGHT.md`

### 5. 今天的教训（写进流程，不重复踩）

1. 任务书硬验收必须带**全量基线**，不能只写「目标文件绿 + src 零改动」。
2. 判「是不是我改坏的」必须做**基线对照**，不做基线不下结论。
3. 产品定位是后台跑，任何验收都**不许要求用户切窗口**来过关。
4. 改代码的人不许自己宣布「通过」，绿不绿由发版窗口复核。

---

## 二、明日工作计划（2026-11-10，按顺序，上一关不过不发下一关）

### 开工前置（五分钟，别省）

- [ ] 完全退出安装版 Sparo（含托盘），否则单实例锁 + 3921 端口会把开发版挡住
- [ ] 起开发版前 `unset ELECTRON_RUN_AS_NODE NODE_OPTIONS`（设了它 Electron 起不来）
- [ ] 确认当前所在的仓：主仓 `D:/download/sparo上架应用商店版`，多开副本 `D:/download/sparo-multi-window`，**别串仓**

### 第一关：多开修红（不依赖任何人，先做这个）

- [ ] `browser.ts` 8 个按窗口集合（`wins` / `activeTabs` / `shellReadyWins` / `placedWins` / `holeBoundsByWin` / `sidebarWByWin` / `lastGoodContentByWin` / `lastLayoutContentByWin`）改为惰性初始化 getter
- [ ] 8 个 getter **零副作用**，只建集合不读页面状态
- [ ] `npm test` 恢复到 884 绿（仅 `mission-journal` 偶发超时豁免），`npm run typecheck` 通过
- [ ] 单独提交，提交信息写明动机「按窗口状态集合改为惰性初始化，避免依赖构造顺序」
- **判据**：全量零红 + `src/` 只动 `browser.ts` 这 8 个字段 + diff 白名单内

### 第二关：多开复审 + 双窗真机

- [ ] 逐条复核 8 个 getter 有无副作用、有无行为差异
- [ ] 真机四项：开窗 / 关窗 / 最小化续跑 / 两窗标签互不干扰
- **判据**：复审意见落文 + 真机四项记录在案

### 第三关：多开出货

- [ ] 合并 `feat/multi-window` → master
- [ ] 封板 tag `v0.4.1` → 打包 `Sparo-Setup-0.4.1.exe`（**不许覆盖 0.4.0**）
- [ ] 安装包真机跑 G1–G3 黄金场景并回填 QA 表
- **判据**：包名带版本号 + tag 存在 + G1–G3 记录回填

### 第四关：电商 R11 前置（可与第一关并行派活）

- [ ] 把 R11 **Part A** 派给 Cursor：`dxm-smt-api.ts` + 纯函数 + 单测，不接真接口、不动 `lookupDraft`
- [ ] 复审 Part A 交付（编译 / 单测 / 类型）
- [ ] 验收 `tabId` 改动（已在主仓 `094444d`）：`execute` 带 `tabId` 能定位到指定标签

### 第五关：附录 C 采样（需要窗口可见，且需临时开 dmx）

- [ ] 临时把 `src/main/features.ts` 的 `dxmEnabled()` 改为读 `SPARO_ENABLE_DXM`（**跑完改回，不提交**）
- [ ] 以 `SPARO_ENABLE_DXM=1 SPARO_DXM_SMT_PREVIEW=1` 起开发版
- [ ] 按 R11 任务书附录 C 采六件事，产物落 `docs/ECOMMERCE-PHASE1-APPENDIX-C-BOX-API.md`
- [ ] 双向验证：现存草稿标题查得到、肯定不存在的标题 `total: 0`；只成立一条就记「参数语义不明」
- **判据**：七段格式齐全，末句明写「是否足以支撑 Part B」

### 第六关：R11 Part B + 认领收尾（需老板在场）

- [ ] 采样通过 + 书面放行后，派 Cursor 做 Part B（接真接口、填字段映射并注释采样日期）
- [ ] 真机验收：**窗口保持最小化**，ambiguous ≥6 轮、absent ≥3 轮
- [ ] 认领闭环（R9-4）：老板坐电脑前，写操作当场授权，跑完 `保存并认领`

### 第七关（技术债，不阻塞出货）

- [ ] `tests/helpers/browser-fixture.ts` 推广到其余 22 个测试文件
- [ ] 推广完成后可评估是否撤掉惰性初始化

---

## 三、三窗口并行分工（两份任务书已就绪）

另外两条线今晚已核查完，问题都记下了，各有一份任务书：

| 窗口 | 干什么 | 任务书 | 只许动 |
|---|---|---|---|
| **A 发版窗口（本窗口）** | 复核多开修红 → 双窗真机 → 合并 → tag `v0.4.1` → 打包 → G1–G3；穿插验收 tabId、做附录 C 采样 | [FIX-MULTIWINDOW-0.4.1-R2-TASKBOOK.md](./FIX-MULTIWINDOW-0.4.1-R2-TASKBOOK.md) | 主仓 + 打包权 |
| **B 多开窗口（或 Cursor）** | 8 个集合改惰性初始化，全量修回 884 绿，两个提交交证据；不打包、不合并 | 同上 | `D:/download/sparo-multi-window` |
| **C 发布窗口** | 多平台发布可复用化：客户端带 tabId、统一入口、四平台各留一套、回执与铁律断言 | [SOCIAL-PUBLISH-R1-TASKBOOK.md](./SOCIAL-PUBLISH-R1-TASKBOOK.md) | `C:\Users\60914\.trae-cn\skills\social-media-publish` |

两条线的核查结论：

- **多开**：代码方向对（两文件 25/25 绿），但全量 67 红，卡在惰性初始化没做；上一份任务书漏写全量基线，本轮已修正。
- **多平台发布**：文档写好了（四平台锚点 + 铁律 + 定时表），但执行层不可复用——77 个一次性脚本、硬编码 tabId/标题/路径、客户端不传 tabId、token 写死。已列 P0/P1/P2 问题清单与 Part A–E 改造。

冲突规则：三窗口文件不重叠；主仓禁 `stash`/`reset`；发布线不碰仓库 `src/`；0.4.1 进安装包，发布线是 skill，不进包。

## 四、明天需要老板拍板的两件事

| # | 事情 | 为什么需要你 |
|---|---|---|
| 1 | 多开 0.4.1 是否按第二、三关走完并打 `0.4.1` 包 | 涉及封板 tag 与打包，权限在发版窗口 |
| 2 | 认领收尾几点开始 | 写操作（保存并认领）必须当场授权，不能代点 |

## 五、明天明确不做的事

- 不改 `docs/listings/`（提审前另做一轮）
- 不动版本号（除第三关封板 `0.4.1`）
- 不在多开副本用 `git stash` / `reset` / `checkout --` / 整文件格式化
- 不为让测试过而改业务行为、放宽校验、伪造返回值
- 不因为验收失败去要求用户切窗口 / 把窗口拉前台
