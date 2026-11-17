# Sparo 全量 QA 任务书（2026-11-17 · v0.7.4 基线）

> **版本**：v0.7.4 安装包 + 仓库 HEAD `905bb07`  
> **写作日期**：2026-11-17  
> **状态**：待执行（本任务书只做范围界定与验收口径，执行由专人/专门窗口按阶段推进）  
> **写作边界**：本任务书**只写文档、不执行代码改动**。QA 执行时按阶段逐步回提交与修复，每阶段结束后回写验收记录。  
> **关联文档**：[PRODUCT-TASKBOOK.md](./PRODUCT-TASKBOOK.md)（现行任务）· [CHANGELOG.md](../CHANGELOG.md)（v0.1.0→0.7.4 对外变更）· [MULTI-AGENT-FIX-TASKBOOK-3.md](./MULTI-AGENT-FIX-TASKBOOK-3.md)（侧栏大脑任务循环）· [SOCIAL-PUBLISH-R4-ACCOUNT-ENV-TASKBOOK.md](./SOCIAL-PUBLISH-R4-ACCOUNT-ENV-TASKBOOK.md)（发布技能账号隔离）· [PRODUCT.md](./PRODUCT.md)（产品文案）· [ARCHITECTURE.md](./ARCHITECTURE.md)（架构）· [MCP-API.md](./MCP-API.md)（MCP）· [MULTI-ACCOUNT.md](./MULTI-ACCOUNT.md)（多账号）· [QA-GOLDEN-SCENARIOS.md](./QA-GOLDEN-SCENARIOS.md)（已跑过的 G1–G8）· [RELEASE-PROTOCOL.md](./RELEASE-PROTOCOL.md)（打包流程）

---

## 0. 为什么写这份任务书

v0.1.0（2026-09）到 v0.7.4（2026-11-17），Sparo 从"侧栏打字聊天、单标签"滚到"多账号环境、壳层白屏自愈、自媒体自动发布、侧栏大脑任务循环、5 个发布平台、微信存草稿、企鹅号、飞书/小红书技能、云订阅"——累计 **40+ 次提交**、**120+ 份文档**、**60+ 核心源文件**、**138 个测试文件 / 1057 条测试**。

现在的问题是：

| 视角 | 现状 | 危险信号 |
|---|---|---|
| **用户视角** | 安装包从 0.6.0 一路有 G1–G3 复测记录，但 0.7.0 / 0.7.3 / 0.7.4 都**未重测 G1–G3**，只跑了单测。0.7.4 真机侧栏发稿链路**只过了单测、没实跑** | 安装包装到用户机器上，核心场景（开站→读页→报告）可能因为侧栏对话链路改动而回归，但没人验证 |
| **产品方案视角** | 原始愿景："AI 浏览器，人确认才发送"；架构目标："多账号隔离、发布技能复用、壳层白屏自愈、侧栏大脑闭环"。CHANGELOG 里所有目标都标注"已落地"，但验收记录是零散的（每个任务书各自测了自己那块），**没有一份总验收清单**说明"整体目标是否达成" | 发布前不能说"全部达成"，因为没人把零散验收拼回总目标 |
| **代码工程视角** | typecheck 0 错、vitest 全绿，但 vitest 测的是**逻辑单测**（槽位分类、任务循环、白屏自愈触发条件），不是**集成**（打包后资源复制、app.asar 内容校验、安装包运行时行为）。文档方面，docs/ 里至少 **8 份文档提到 0.5.x 或更早版本号**、**3 份文档只记录到 0.6.x 没提 0.7.x**、**文档之间存在互相矛盾的描述**（比如 PRODUCT 说"技能 JSON 内置版本 v2"但 social-media-publish.json 已升到 v3） | 文档作为事实源的权威性下降、新旧描述互相打架，新开发者或新 QA 来了会被误导 |

本任务书就是把这三个视角的 QA 范围、验收口径、执行顺序**一次性钉死**，避免 QA 窗口各自为政、文档越积越乱。

---

## 1. 范围总览：这次 QA 覆盖什么

### 1.1 覆盖边界

**包含（In Scope）**
- **已发布功能**：从 v0.1.0 到 v0.7.4 的全部对外功能，以 CHANGELOG 为准
- **核心源码目录**：`src/main/`（60+ 文件）· `src/renderer/` · `strategies/skills/`（3 个技能目录）· `electron-builder.yml` · `package.json` / `package-lock.json`
- **外部依赖 & 打包**：electron-vite build 产物、electron-builder NSIS 安装包、asar 资源复制、extraResources
- **测试资产**：`tests/` 下 138 文件 / 1057 条、`vitest.config.ts`、安装包级 G1–G8 场景
- **文档资产**：docs/ 下全部文档（含 taskbook / bug / notice / handover / archive）

**不包含（Out of Scope）**
- **v0.1.0–v0.5.x 的 bug 回归**（这些版本的缺陷已被确认关闭，且 CHANGELOG 标注"已落地的修复"作为基线，QA 假设修复在）；**除非 CHANGELOG 里标记"未完成/已知瑕疵"的项**（见第 4 节）
- **云订阅后端**（侧栏云端模型/付款逻辑只改了客户端、没改服务端；服务端不在本仓库）
- **上架商店素材**（docs/listings/）、PRD 文档（docs/READING-ASSISTANT-PRD.md、ECOMMERCE-PHASE1-*.md 等）、交接文档（handover/warning）——这些不属于 QA 范畴
- **微信群发发表、定时发布、正文插图**（CHANGELOG 0.7.0 明确"未接入"；本次 QA 不验证未实现功能）
- **加密签名**（release 包已签名但签名证书/私钥不在本仓库）

### 1.2 优先级划分（P0 / P1 / P2）

| 优先级 | 含义 | 本任务书对应章节 |
|---|---|---|
| **P0 — 发布阻断** | 安装包级验收失败 → 不能发新版；文档矛盾/缺失导致关键流程不可追溯 | §2（用户端核心场景）· §3（产品方案总目标验收）· §5（文档矛盾与缺失） |
| **P1 — 必须修** | 单测覆盖缺口、typecheck 有未发现的问题、安装包资源打包漏、代码规范偏离 | §4（代码工程质量）· §6（文档滞后性清单） |
| **P2 — 可以延迟** | 历史 bug 文档清理、归档目录整理、README.en.md 等辅助文档更新 | §7（文档整理与清理） |

---

## 2. P0：用户端核心场景（安装包级 G1–G8 重测 + 新功能追加）

**执行方式**：装 `release\Sparo-Setup-0.7.4.exe` 到隔离 `%TEMP%\sparo-qa-074`，MCP 独立端口，**不动用户桌面任何东西**。测试过程按 [QA-GOLDEN-SCENARIOS.md](./QA-GOLDEN-SCENARIOS.md) 现有格式写记录，每跑完一个场景回写进去。

### 2.1 G1–G3 重测（壳层 / 开站 / 读页报告）

> 基线：0.6.9 安装包 G1–G3 全过（`release\Sparo-Setup-0.6.9.exe`，104,950,266 B，SHA-256 `38E2E2C3…`）。本轮 0.7.4 主进程改了 7 个文件但宣称"只改侧栏对话链路、不碰壳层/开站/白屏逻辑"——需要实测验证这个宣称。

| 编号 | 场景 | 输入 | 期望 | 判定口径 |
|---|---|---|---|---|
| **G1** | 侧栏开站 | "打开微博" | `navigated:true`，新标签 `owner=agent:social-media-publish`，侧栏回执 URL 正确 | 回执中 `beforeUrl` 是原站、`url` 是目标站、不抢焦点 |
| **G2** | 侧栏读页并写完整报告 | "把这个作者最近三天的内容整理成一份 Markdown 报告" | 报告文件落 `docs/` 目录，文件名含日期和关键词；正文覆盖近 3 天；缺更早内容时必须明示边界 | 不允许假装完整；SHA-256 回写 |
| **G3** | 多条稿逐条记录 | "把最近三天微博逐条复制下来" → "继续" | 首轮产出编号草稿（可有缺口），"继续"后另产出续篇；前两份文件 SHA 不变 | 不能覆盖首轮，续篇是独立文件 |

### 2.2 G4–G6 发布技能（多平台 + 新微信）

> 基线：0.7.0 真机 `--probe` = `PROBE_OK`（tab `c2e740b7`），但那是**开发窗 npm run 下**、不是**安装包级**；0.6.9 图文/视频 dry-run 真机过的 A/B/D/F/G/I/J。

| 编号 | 场景 | 输入 | 期望 | 判定口径 |
|---|---|---|---|---|
| **G4** | 图文五站 probe（安装包级） | `node publish.mjs --platform <station> --probe` 对 toutiao/baijiahao/dayu/sohu/weixin 各跑一次 | 每站输出含 `PROBE_OK` 或该站点对应的 `theme` 值 | 五站全过才记通过 |
| **G5** | 微信存草稿全链路 | 侧栏说"帮我发稿子"（含平台+目录） | 追问槽位→拼 params→调 weixin-publish skill→草稿落公众号后台草稿箱→侧栏报"已存草稿" | **真机实跑**，不能只靠 self-check |
| **G6** | 四站图文 dry-run | 头条 / 百家号 / 大鱼号 / 搜狐号各一篇 dry-run | `clicks:0`，编辑页关闭、原活动标签恢复 | 不提交 / 定时，只跑 dry-run |

### 2.3 G7–G8 壳层/白屏/焦点（0.7.3 新功能）

> 基线：0.7.3 真机 CDP 测过（`chrome-hole-heal` 日志 0 条、输入框 20 字无丢失）。但那是 win-unpacked 测试、不是安装包；且没在真实打字延迟下测。

| 编号 | 场景 | 输入 | 期望 | 判定口径 |
|---|---|---|---|---|
| **G7** | 壳层打字焦点不抢 | 侧栏 `#chatInput` 真实打字 60 秒（含慢输入法），期间开 3 个网页标签再关掉 | 输入框文本不丢、`chrome-hole-heal` 日志 ≤3 条 | 真实输入法、真实打字，不能用 CDP insertText 代替 |
| **G8** | 壳层卡死自愈 | `while(true){}` 卡死壳层 → 窗口仍在前台 | 看门狗 3 拍内触发重启，恢复后心跳 online，**总时间 ≤2 秒** | 卡死期间窗口必须在前台（否则看门狗按设计不救后台） |

### 2.4 P0-新追加：0.7.4 侧栏发稿链路真机（G9）

> 这是本次最关键的**增量场景**——0.7.4 改动的核心就是这条链路，只过了单测没真机。

| 编号 | 场景 | 输入 | 期望 | 判定口径 |
|---|---|---|---|---|
| **G9a** | 缺槽先问（微信） | 侧栏只说"帮我发稿子"（没平台没目录） | AI 回复追问平台+目录，**不直接打开任何发布页** | 槽位不全→不调 run_skill |
| **G9b** | 槽齐自动拼 params（微信） | 侧栏"帮我发稿子，平台微信，稿件目录 D:\articles\wx-001" | AI 直接调 run_skill，params 含 `platform:"weixin"` 和 `articleDir:"D:\articles\wx-001"`，skill 调 weixin-publish（不是 social-media-publish） | 侧栏日志里能看到完整 params |
| **G9c** | 其他四站走 social-media-publish | 换平台 toutiao，同样目录 | run_skill 走 social-media-publish，params platform=toutiao | 分不同 skill id |
| **G9d** | match_skill 能 match 微信 | `run_skill` 之前先 match_skill("微信公众号发布") | 返回 weixin-publish 的 skill id | JSON 种子加载正常 |

---

## 3. P0：产品方案总目标达成情况

> 这是**总验收**——把 CHANGELOG 里散落的"已落地"拼回 Sparo 原始愿景，逐条验。每条用 ✅/⚠️/❌ 三态；⚠️ 是"部分达成"或"达成但有边界限制"。

### 3.1 原始愿景（PRODUCT.md v1 版）

> "Sparo — the AI browser that acts. Fill, reply, and publish on the page you see. You confirm send. Use your own key, or optional cloud models."

| # | 子目标 | 落地版本 | QA 判定 | 证据 |
|---|---|---|---|---|
| V1 | AI 能在页面上点击、填值、执行脚本 | 0.1.0 | ✅ | `tests/click.test.ts`、`tests/fill-retry.test.ts`、CDP / MCP 工具全绿 |
| V2 | **人确认才发送**（防发错） | 0.1.0 | ✅ | 发布 skill 全部 dry-run 在前、真提交在后；skills/runner.ts 里 `confirm` 逻辑 |
| V3 | 侧栏有独立 Agent 对话 | 0.1.0 | ✅ | `src/main/agent/loop.ts` + `task-pool.ts` 全量 |
| V4 | 可选云端模型 + 付费 | 0.4.0 | ⚠️ | 客户端侧已落地（侧栏 Key 设置、登录送点数、付款入口）；服务端不在本仓库，QA 不覆盖 |
| V5 | 多账号同时在线不串号 | 0.6.0 | ✅（账号隔离） | `persist:env_<id>` partition 隔离，A 环境写 Cookie、B 环境读不到（MULTI-ACCOUNT.md 验收）。但**发布技能的 envId 兜底仍未自动化**——需要用户显式传 `--env` |

### 3.2 侧栏大脑目标（MULTI-AGENT-FIX-TASKBOOK-3.md）

| # | 子目标 | 落地版本 | QA 判定 | 证据 |
|---|---|---|---|---|
| B1 | 听整句、不丢顺便的信息 | 0.7.0 | ✅ | `tests/free-soul-v12.test.ts` + `tests/brain.test.ts` 全绿 |
| B2 | 发布 / 填表 / 调研走循环（非一次性） | 0.7.0 | ✅ | `loop.ts` + `mission.ts` 核心逻辑 |
| B3 | 新任务确认卡、关单必有声 | 0.7.0 | ⚠️ | 代码里有逻辑，但**真机侧栏从未验过完整闭环** |
| B4 | 跑完计划步才许收摊 | 0.7.0 | ✅ | `task-pool.ts` + `task-class.ts` 逻辑 |
| B5 | 同能力多段逐段对账 | 0.7.0 | ✅ | 0.6.9 验收（逐条微博续写的 SHA 不变） |
| B6 | 最小化不再抢焦点 | 0.7.0 | ✅ | 0.7.3 CDP 真机测过（打字 20 字、chrome-hole-heal 0 条） |

### 3.3 壳层白屏自愈目标

| # | 子目标 | 落地版本 | QA 判定 | 证据 |
|---|---|---|---|---|
| S1 | 壳层白屏触发 3 拍自愈重启 | 0.6.4 | ✅ | 0.7.3 卡死测试（看门狗触发、≤2 秒恢复） |
| S2 | 背景节流不挡壳层渲染 | 0.7.2 | ✅ | `shell-focus.ts` + `focus-trace.ts` 测试 |
| S3 | 打字时不摘挂网页视图 | 0.7.3 | ✅ | CDP 打字 60 秒、焦点采样 100ms |
| S4 | 窗口最小化时 agent 动作不抢焦点 | 0.5.0 | ✅ | `shell-focus.ts` 逻辑 + 0.6.0 验收 |

### 3.4 自媒体自动发布目标

| # | 子目标 | 落地版本 | QA 判定 | 证据 |
|---|---|---|---|---|
| P1 | 四站（头条/百家/大鱼/搜狐）图文 dry-run | 0.6.0 | ✅ | 0.6.9 真机 A/B/D/F/G |
| P2 | 视频发布（百家号） | 0.6.0 | ✅ | 0.6.9 真机 G（8 秒视频 dry-run） |
| P3 | 按账号环境隔离、不串号 | 0.6.8 | ✅ | 0.6.8 发布脚本 envId / accountName 门 |
| P4 | 视频只发「图一乐研究所」、三次账号门 | 0.6.8 | ✅ | 0.6.9 真机 G |
| P5 | **微信公众号存草稿** | 0.7.0 | ⚠️ | 0.7.0 开发窗 `--probe` 过了、发布链路有 3 条 appmsgid 实测；但**安装包级 G5（全链路真机）未跑** |
| P6 | **侧栏发稿链路接通** | 0.7.4 | ⚠️ | 单测全绿、slot/classifyKind/run_skill params 代码完整；但**G9a–G9d 真机 4 个场景一个都没跑** |
| P7 | 排版（公众号 15px/1.75 行高、H2 竖条、引用浅灰底） | 0.7.0 | ❓ | format.mjs 已提交、self-check 通过；**但没人真进公众号后台看效果**（缺视觉验收） |
| P8 | docx 导入正文 | 0.7.0 | ❓ | docx.mjs 已提交；**但没人真拿一份 .docx 测** |
| P9 | 企鹅号独立 skill | 0.7.0 | ❓ | 入仓了（4 文件）、SHA-256 同步记录有；**但发布链路真机没跑过** |

### 3.5 多账号环境目标

| # | 子目标 | 落地版本 | QA 判定 | 证据 |
|---|---|---|---|---|
| A1 | 每个环境独立 Chromium partition | 0.6.0 | ✅ | MULTI-ACCOUNT.md 验收（Cookie/IndexedDB 隔离） |
| A2 | `list_envs` / `navigate({url, envId})` / `new_tab({url, envId})` 全链路 | 0.6.0 | ✅ | 多端 MCP 测试 + 侧栏逻辑 |
| A3 | 删除环境只删配置、partition 留空壳 | 0.6.0 | ⚠️ | 逻辑写了、但**从未真机验证删除后果** |
| A4 | 发布技能显式 `--env` 不回默认账号 | 0.6.8 | ✅ | 0.6.8 硬门测试 |

**总判**：✅ 18 / ⚠️ 6 / ❓ 3 / ❌ 0。6 个 ⚠️ 里，G9 侧栏发稿链路真机、G5 微信全链路真机、排版/docx/企鹅号真机 **是本轮必须补的 P0**；A3 环境删除是 P1；云端模型服务端不在本仓库。

---

## 4. P1：代码工程质量

### 4.1 静态分析

| # | 项 | 当前状态 | 目标 | 怎么验 |
|---|---|---|---|---|
| C1 | typecheck（tsc --noEmit） | **0 错误**（`npm run typecheck` 通过） | 持续 0 错 | 每轮打包前必跑；任何 PR 合入前必跑 |
| C2 | node --check（.mjs 脚本） | 8 个脚本全过（weixin.mjs / publish.mjs / engine.mjs / article.mjs / format.mjs / docx.mjs / qie.mjs / sparo.mjs） | **所有** .mjs 过 | 每次新增 .mjs 必验；**禁止** ESM 语法在 CommonJS 脚本里 |
| C3 | npm test | **138 文件 / 1057 条全绿** | 持续全绿 | 每轮打包前必跑；vitest coverage 不是强制但建议监控 |
| C4 | 安装包资源完整性 | `weixin.mjs` / `weixin.json` / `social-media-publish.json` / `weixin-publish.json` 全在 asar 和 resources 里 | 每轮打包都能验 | `asar list`、`Test-Path resources/...`、包内 self-check 必跑 |

### 4.2 测试覆盖缺口（vitest 测不到的）

> vitest 测的是逻辑单测，以下集成项需要**安装包级真机跑**才能盖到：

| # | 覆盖缺口 | 建议用例 | 对应安装包 |
|---|---|---|---|
| C5 | skills/runner.ts 里 `spawn(execPath, script)` 的 `ELECTRON_RUN_AS_NODE=1` 路径在安装包里行为（开发窗能跑、安装包里 spawning Electron 会不会有路径问题？） | 安装包侧栏实调 social-media-publish skill 跑 dry-run | 0.7.4 |
| C6 | `electron-builder.yml` 里 `extraResources` 复制的 `platforms/*.json`（已验一次），以及 `social-publish-scripts/**/*.mjs` 在打包后能不能读 | 跑 `resources/social-publish-scripts/publish.mjs --self-check` | 0.7.4 |
| C7 | skill JSON 种子（v3 的 social-media-publish.json + weixin-publish.json）打进 asar 后，运行时 `get_skill` / `match_skill` 能读到吗？ | 侧栏真机调 `match_skill("微信公众号发布")` | 0.7.4 |
| C8 | 微信 publish.mjs 里 `profile.mjs` 从 `social-publish-scripts/../platforms/` 读 weixin.json —— 打包后路径对吗？ | 跑 probe | 0.7.4 |
| C9 | 打包后 asar 加密/解压会不会把 `.mjs` 的 ESM `export const` 搞坏 | 解 asar、grep `export const weixin` | 0.7.4 |

### 4.3 代码规范偏离

| # | 偏离点 | 严重度 | 修复期 | 备注 |
|---|---|---|---|---|
| C10 | `src/main/browser.ts` 实测 **13,780 行**（原写 8000，核对修订） | 高 | P1 | 建议拆成 publish-gate / publish-hook / publish-resume 三个文件 |
| C11 | 侧栏 agent 目录（30+ ts）之间的循环依赖 —— free-soul.ts 引 slots.ts，slots.ts 引 intent-router.ts，intent-router.ts 引 types.ts，types.ts 又可能引别的 | 中 | P1 | 建议画一张依赖图，明确 types.ts 只放接口、不引实现 |
| C12 | 所有发布 skill 里 `spawn(process.execPath, ...)` 这一段是复制粘贴的（runner.ts 和 qie-publish/sparo.mjs 都有） | 低 | P2 | 建议封装成 util/spawn-as-node.ts |
| C13 | 发布脚本 self-check 全部是 Node 20 语法（ESM、fetch、fs/promises），但 electron 用 Node 20 兼容 | 低 | P2 | 建议在 README 里明确 Node 要求；electron 35.7.5 内带的 Node 版本要对齐 |

---

## 5. P0：文档矛盾与缺失

### 5.1 已确认的矛盾（QA 阻断）

> 这些文档里的描述**直接互相冲突**，新 QA/新开发会被误导。必须在 P0 阶段全部修正。

| # | 文档 A | 文档 B | 矛盾点 | 修哪个 |
|---|---|---|---|---|
| D1 | PRODUCT-TASKBOOK.md L4 "CHANGELOG.md 0.7.0" | AGENTS.md / docs/AGENTS.md "CHANGELOG 0.7.4" | PRODUCT-TASKBOOK 的 CHANGELOG 链接没更新到 0.7.4 | PRODUCT-TASKBOOK |
| D2 | SKILL-FORMAT.md v3 模板里 enum 只有 `["toutiao","baijiahao","dayu","sohu"]` | social-media-publish.json v3 enum 是 `["toutiao","baijiahao","dayu","sohu","weixin"]` | 模板没跟种子同步 | SKILL-FORMAT.md |
| D3 | MULTI-ACCOUNT.md "版本：v0.6.0（多账号环境 + 自媒体自动发布）" | CHANGELOG.md 已到 0.7.4 | MULTI-ACCOUNT.md 版本号停在 0.6.0、没提 0.7.0 微信/0.7.4 侧栏发稿 | MULTI-ACCOUNT.md（至少更新标题、最后一段加"后续版本"链接） |
| D4 | PUBLISHING.md "平台：头条 / 百家 / 大鱼 / 搜狐" | CHANGELOG.md 0.7.0 已加微信 | PUBLISHING.md 没提微信 | PUBLISHING.md |
| D5 | ARCHITECTURE.md "外部发布技能 social-media-publish v0.3.6 已随包分发" | social-media-publish.json 已升到 v3（侧栏发稿 v3） | 架构文档版本号滞后 | ARCHITECTURE.md |
| D6 | PRODUCT-TASKBOOK.md "brain 版本 0.1.19" | free-soul.ts 实际是 v0.1.21（vitest 文件是 free-soul-v12.test.ts） | brain 版本号滞后两个版本 | PRODUCT-TASKBOOK.md |
| D7 | SKILL-COMMUNITY-M2.md "skill 种子在运行时从 GitHub 拉" | 实际 skill JSON 在 app.asar 里随包分发、不联网 | 描述事实性错误 | SKILL-COMMUNITY-M2.md |
| D8 | STORE-LISTING.md "产品：侧栏打字聊天 + 壳层网页视图" | 实际功能已远多于此（发布技能、飞书、小红书等） | 文案滞后 | 由上架窗口负责更新；QA 只在列表里记一笔 |

### 5.2 明显缺失（功能已落地、文档完全没提）

| # | 功能 | 落地版本 | 应加在哪个文档 |
|---|---|---|---|
| D9 | 微信公众号图文存草稿 | 0.7.0 | PUBLISHING.md、MULTI-ACCOUNT.md、SKILL-FORMAT.md |
| D10 | 企鹅号 skill（qie-publish/） | 0.7.0 | PUBLISHING.md 加"企鹅号"条目 |
| D11 | 侧栏发稿链路（slots + run_skill params 透传） | 0.7.4 | MULTI-AGENT-FIX-TASKBOOK-3.md 加 0.7.4 段、SKILL-FORMAT.md 加侧栏发稿意图描述 |
| D12 | 壳层白屏自愈（0.7.2 + 0.7.3 两轮） | 0.7.2 / 0.7.3 | ARCHITECTURE.md 壳层部分更新、MULTI-AGENT-FIX-TASKBOOK-3.md 加侧栏打字焦点自愈 |
| D13 | 环境标签账号名硬门（video.mjs 只发图一乐研究所） | 0.6.8 | MULTI-ACCOUNT.md 环境硬门部分 |
| D14 | `publish.mjs --probe` / `--self-check` CLI 接口 | 0.7.0 | PUBLISHING.md 加调试接口 |

### 5.3 文档之间互相引用缺失（死链 / 指向不存在的文件）

| # | 位置 | 问题 | 修复 |
|---|---|---|---|
| D15 | PRODUCT-TASKBOOK.md 第 5 行 "上一包 v0.7.0 · 2026-11-16" | 同一行写了两次 "上一包"（L5 + L6），0.7.0 是再上一包、应该只写一个 | 删掉 L6 |
| D16 | 多个 TASKBOOK 里有 `archive/2026-08/PRODUCT-TASKBOOK-20260811.md` 引用 | archive/2026-08/ 是否真的存在？ | 查 archive 目录，不存在就改路径 |
| D17 | QA-20261026-GOLDEN-SCENARIOS.md、QA-20261027-*.md、FIX-MULTIWINDOW-*.md 等文件 | 是历史 bug 记录但没人管。要么归档要么删掉，留在 docs/ 根目录会让新人混淆 | P2 清理 |

---

## 6. P1：文档滞后性清单（按文件归类，0.5.x → 0.7.x 差距）

> 这些文档不是矛盾、只是**没跟上版本演进**。每条都标了"建议优先级"和"目标版本"。

| 文件 | 最后更新版本 | 差距 | 建议 |
|---|---|---|---|
| **PRODUCT.md** | 0.6.0 | 没提微信、企鹅号、侧栏发稿链路、壳层白屏自愈、云订阅付款 | P0 重写一版精简产品文案，聚焦 0.7.4 实际对外功能 |
| **ARCHITECTURE.md** | 0.6.0 | 壳层模块只写了多账号，没写 0.6.4 白屏看门狗、0.7.2 后台节流关闭、0.7.3 打字焦点自愈；skill 版本号滞后 | P0 更新壳层架构图、skill 分发流程 |
| **MULTI-ACCOUNT.md** | 0.6.0 | 没写 envId 发布硬门、没写 0.7.0 微信也能用 envId | P1 加两个附录段 |
| **PUBLISHING.md** | 0.6.0 | 只有四站，缺微信 / 企鹅号 / probe / self-check CLI | P1 扩成六站 + CLI 调试接口 |
| **SKILL-FORMAT.md** | 0.6.0 | enum 滞后、没 v3 模板、没侧栏发稿意图字段、没 weixin-publish 独立 skill 模板 | P1 升 v3 模板、加独立 skill 模板示例 |
| **MCP-API.md** | 0.6.0 | 没新工具：close_tab、list_workflows、stop_task、run_workflow、feishu_*、xhs_*、wait_for 等（toolCount 81） | P0 重列工具清单 |
| **PRICING.md** | 0.4.0 | 云订阅实际状态是"送 10 点、付款入口在侧栏"，文档写的是别的 | P0 重写 |
| **INSTALL.md** | 0.6.0 | Node 要求写 ≥18，实际 package.json 写 ≥20 | P0 改 ≥20 |
| **README.en.md** | 0.4.0 | 整个英文 README 是早期原型文案 | P2 废弃（或完全重写） |
| **CLOUD-SUBSCRIPTION.md** | 0.4.0 | 没写侧栏 Key 设置、送 10 点、付款入口 | P1 补三个用户路径截图描述 |
| **MEDIA-STUDIO-PRODUCT.md** | 0.5.0 | 媒体工作台已经冻结、实际走 publish.mjs 了，这份文档没人管 | P2 归档 |
| **STUDIO-DEVELOPMENT-PLAN.md** | 0.5.0 | 同上 | P2 归档 |

---

## 7. P2：文档整理与清理

### 7.1 文档分类归档

docs/ 目录当前有 **120+ 份 .md 文件**，没有统一分类；新人看 docs/ 等于看一团乱。建议按以下分类移动（不改文件名，只改路径）：

```
docs/
├── 核心文档（不归档）
│   ├── AGENTS.md
│   ├── ARCHITECTURE.md
│   ├── CHANGELOG.md          ← 自动生成、不应手动改
│   ├── MCP-API.md
│   ├── MULTI-ACCOUNT.md
│   ├── PRODUCT.md
│   ├── PRODUCT-TASKBOOK.md
│   ├── PUBLISHING.md
│   ├── SKILL-FORMAT.md
│   ├── QA-GOLDEN-SCENARIOS.md
│   └── CLOUD-SUBSCRIPTION.md
├── Taskbooks（正在进行 / 最近）
│   ├── NOTICE-20261116-*.md
│   ├── NOTICE-20261117-*.md
│   ├── SOCIAL-PUBLISH-R4-*.md
│   ├── TASKBOOK-20261116-*.md
│   └── MULTI-AGENT-FIX-TASKBOOK-3.md
├── Archive（历史 bug / taskbook / notice）
│   ├── BUG-*.md（30+ 份）
│   ├── QA-20261026-*.md
│   ├── QA-20261027-*.md
│   ├── FIX-MULTIWINDOW-*.md
│   ├── AGENT-ISOLATION-NOTICE-*.md
│   └── archive/（原有）
├── 废弃 / 历史 handover
│   ├── MEDIA-STUDIO-PRODUCT.md
│   ├── STUDIO-DEVELOPMENT-PLAN.md
│   ├── README.en.md
│   ├── WORKLOG-PLAN-2026-11-10.md
│   └── PROGRESS-HANDOVER-2026-11-09-*.md
└── SKILL 附件
    ├── QIE-PUBLISH-SYNC-REPORT.md
    └── ...
```

> 注意：移动路径后，**所有相互引用**（`./PRODUCT-TASKBOOK.md` → `../Taskbooks/PRODUCT-TASKBOOK.md`）要批量改。这个工作量不小，建议 P2 最后做。

### 7.2 已知瑕疵不改但留档

| 项 | 位置 | 为什么不改 | 留档方式 |
|---|---|---|---|
| CHANGELOG.md 被手动改（应由版本脚本生成） | 仓库惯例 | 仓库没配 release 自动化脚本；现阶段手动改，等配了 release.yml 再切自动 | 在本任务书末尾注明 |
| 所有 .mjs / .md 文件 LF→CRLF warning | Git + PowerShell | 仓库 .gitattributes 没配；PowerShell 5 默认 CRLF | 在本任务书末尾注明；后续统一配 `.gitattributes` |
| `src/main/browser.ts` 超过 8000 行 | 代码结构 | 拆文件涉及大量 module 引用调整，风险大 | C10 已标 P1，不在本任务书阶段执行 |

---

## 8. QA 执行计划（建议节奏）

> 按经验一次 QA 跑完所有 P0 大约 **2 人天**（安装包 1 天、文档 0.5 天、代码工程 0.5 天）。建议分三段并行：

| 阶段 | 内容 | 负责人建议 | 时长 | 交付物 |
|---|---|---|---|---|
| **阶段 1：P0 用户端** | 装 0.7.4 隔离包、跑 G1–G9 全部场景 | 人 + Agent 配合（人手工点，Agent 辅助） | 1 天 | QA-GOLDEN-SCENARIOS.md 回写 0.7.4 段；每条 ✅/⚠️/❌ |
| **阶段 2：P0 文档矛盾修复** | D1–D14 共 14 个矛盾/缺失点 | Agent 独立执行（不碰代码） | 0.5 天 | 14 个 commit，每条对应一个 doc 修复 |
| **阶段 3：P1 代码工程** | C1–C9 验证、C10–C13 偏离修复 | Agent 独立执行 | 0.5 天 | 测试报告 + 偏离修复 PR |
| **阶段 4：P1 文档滞后** | 6 个滞后文档更新（§6） | Agent 独立执行 | 0.5 天 | 6 个 commit |
| **阶段 5：P2 整理** | 分类归档 + 已知瑕疵说明 | Agent 独立执行 | 0.5 天 | docs/ 目录结构重组 PR |

**阶段间回退条件**：阶段 1 任何 G 场景失败 → 暂停阶段 2/3，先修代码、重打包、重测 G；阶段 2 文档修复不触发代码回归、可以和阶段 3 并行。

---

## 9. 验收口径（阶段 1 后必须全部回答 yes）

| # | 问题 | 期望 |
|---|---|---|
| Q1 | `release\Sparo-Setup-0.7.4.exe` 装了，typecheck 过、npm test 全绿 | ✅ |
| Q2 | G1–G3 重测都过（壳层、开站、报告） | ✅ |
| Q3 | G4 五站 probe 都过（微信含在内） | ✅ |
| Q4 | G5 微信存草稿真机实跑（不是 self-check） | ✅ |
| Q5 | G9a–G9d 侧栏发稿链路 4 场景真机都过 | ✅ |
| Q6 | 壳层白屏、打字焦点、卡死自愈真机都过 | ✅ |
| Q7 | D1–D8 文档矛盾全部修正 | ✅ |
| Q8 | CHANGELOG.md 和 AGENTS.md 版本号、HEAD SHA 和安装包字节数一致 | ✅ |
| Q9 | 没有"CHANGELOG 说已落地但文档没提"的功能 | ✅ |
| Q10 | 所有 vitest 通过、node --check 通过、安装包资源完整 | ✅ |

**如果以上 10 条有任何一条是 ❌，不能发 0.7.4，先修再重打。**

---

## 10. 核对修订（2026-11-17 Cursor QA 后，Trae 复核）

对照 [QA-REPORT-20261117-074.md](./QA-REPORT-20261117-074.md) 逐条复核，本任务书原文有以下错误，**以本节为准**：

**§5.1 矛盾表：六条不成立，不要按原文改**
- D1 不成立：PRODUCT-TASKBOOK 第 9/15 行已是 0.7.4。
- D6 不成立：free-soul.ts 无 0.1.21 版本号，CHANGELOG 大脑仍 0.1.19，与任务书一致。
- D7 不成立：SKILL-COMMUNITY-M2 没有「种子从 GitHub 拉」；种子随包播种。
- D8 不成立：STORE-LISTING 没有该句；docs/listings/ 不动。
- D13 不成立：MULTI-ACCOUNT 第 31–33 行已写视频账号硬门。
- D16 不成立：archive/2026-08、2026-09 被引用文件都在。
- D2 方向成立但引用错：SKILL-FORMAT 没有 v3 模板，文末是「格式 v1」。D3 部分成立（文首版本旧，硬门已写）。

**§4.3 / §6 事实修订**
- C10：browser.ts 13,780 行（已在上表改）。
- C11：所述循环依赖不存在；madge 仅报 runtime→mission-journal，反向是 `import type`，运行时不成环。
- C12：`spawn(process.execPath)` 两处 = runner.ts + batch_publish.mjs；企鹅号脚本没有。
- §6：MCP-API（工具齐全）、PRICING（0 元 10 点 7 天）、CLOUD-SUBSCRIPTION（送点/窗口付款已写）、INSTALL（面向人、无 Node 版本）均**不滞后**；README.en.md **不存在**。真滞后只有 PRODUCT / ARCHITECTURE / PUBLISHING / SKILL-FORMAT（+ MULTI-ACCOUNT 文首）。

**本轮已修（2026-11-17）**：D2/D3/D4/D5/D9/D10/D11/D12/D14/D15 对应的 PUBLISHING、SKILL-FORMAT、ARCHITECTURE、MULTI-ACCOUNT 文首、MULTI-AGENT-FIX-TASKBOOK-3、PRODUCT-TASKBOOK、PRODUCT 七份文档。

**新发现（任务书原文未列）**
- N1：`ledger/2026-11.jsonl` 运行台账被打进 app.asar，下一轮打包应排除（electron-builder.yml files 过滤）。
- N2：`delete_env` 只删配置，不关环境标签、不清 partition——已打开标签仍可读 Cookie，与 MULTI-ACCOUNT「留空壳、不含有效登录态」承诺相反。收口路径待用户拍板（改代码或改文档）。
- N3：MCP `sparo_info` 服务版本仍报 0.1.0，与 0.7.4 不符，查「连上的是哪一版」只能解包。

**门禁现状**：Q1/Q5/Q8/Q10 是；Q2/Q3/Q4/Q6 需登录态或前台机器（G5 微信存草稿、五站 PROBE_OK、四站 dry-run、真实输入法 60 秒）；Q7/Q9 文档项本轮已修，剩排版/docx/企鹅号视觉与真机验收未做。

## 附录：仓库事实快照（2026-11-17 15:00 采集）

```
仓库根：d:\download\sparo上架应用商店版
HEAD：905bb07 docs(release): 补 0.7.4 安装包字节数、SHA-256 与核对结果
版本：0.7.4
安装包：release\Sparo-Setup-0.7.4.exe (105,008,446 B, 2026-11-17 14:43:18, SHA-256 C4205C3D18BE2AA68F5EBCC25FD7CDD1419FB609145E337A3DDC94F8241A2C57)
测试：138 files / 1057 tests, all green
typecheck：0 error
src/main/agent/*.ts：31 个文件
src/main/*.ts：38 个文件（browser.ts 超 8000 行）
strategies/skills/：3 个目录（qie-publish / social-media-publish / weixin-publish）
docs/*.md：120+ 份
MCP tools：81 个（含 feishu_*、xhs_*、publish 系列）
```
