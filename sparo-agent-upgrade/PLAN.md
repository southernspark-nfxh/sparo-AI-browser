# Sparo 五项能力升级 · 总计划

> 版本：v1.0 · 2026-10-22
> 代码根：`d:\download\sparo上架应用商店版`（商店版，3921 / `%APPDATA%\sparo-store`）
> 执行方式：每本任务书复制给一个独立 Cursor 窗口；一本一个 commit；逐本验收，不通过退回重做，不进入下一本。
> 任务书目录：`d:\download\sparo上架应用商店版\sparo-agent-upgrade\tasks\`

---

## 1. 五项能力 → 十本任务书

| 能力 | 现状 | 对应任务书 |
|---|---|---|
| ① 多开/多任务并行/多 Agent 分管页面 | 单实例锁 + 全局串行队列 + 所有操作绑在「当前激活标签」 | T05、T06、T09 |
| ② 不抢屏幕、最小化照跑 | 任务中窗口被强制弹回；后台标签定时器被节流 | T07（依赖 T05） |
| ③ 内存小 | 已有空闲标签自动休眠，未形成体系 | T08（依赖 T05） |
| ④ 智能阅读器 | 正文提取/笔记库/高亮/文件拖拽已有，缺引用块与笔记打通 | T01、T02 |
| ⑤ 大脑对标 Cursor | 模型为脑已立住；缺计划对象、断点续跑、自评闭环 | T03、T04 |

## 2. 依赖图与窗口分配

```text
窗口A（阅读器线）   T01 ──→ T02
窗口 B（大脑线）     T03 ──→ T04
窗口 C（架构线）     T05 ──→ T06 ──→ T09
                     │
窗口 D（体验线）     └──→ T07        （T05 合并后即可开工）
窗口 E（体验线）     └──→ T08        （与 T07 并行，函数域不重叠）

最后：T10 总验收（全部合并后，主窗口执行）
```

**三波开工节奏：**

- **第一波（现在就能并行开 3 个窗口）：T01、T03、T05**
  - T01 动 `shell.html` 输入区与消息渲染、`page-context-menu.ts`、`shell-preload.ts`
  - T03 动 `src/main/agent/kernel/`、runtime.ts；`shell.html` 只准加一个独立容器 + 一行调用（见任务书冲突域规定）
  - T05 动 `browser.ts`、`tools/`，不碰 `shell.html`
- **第二波（各自线内接棒）：T02（A）、T04（B）**；T05 验收合并后：**T06（C）、T07（D）、T08（E）三窗并行**
- **第三波：T09（C，T06 合并后）→ T10（总验收）**

**验收顺序即合并顺序：T01 → T02 → T03 → T04 → T05 → T07/T08 → T06 → T09 → T10。**
后面任务若标注依赖，必须从「依赖任务已合并」的代码开工（先 `git pull` / 确认 commit 在）。

## 3. 文件冲突域（谁碰哪里，写死）

| 文件 | T01 | T02 | T03 | T04 | T05 | T06 | T07 | T08 | T09 |
|---|---|---|---|---|---|---|---|---|---|
| `shell.html` | 输入区+渲染 | 输入区@下拉 | 仅新增 planStrip 容器 | — | — | 任务状态条（新容器） | — | — | — |
| `browser.ts` | handleChat 加 quotes 参数（只加不改逻辑） | 存笔记 IPC | — | 启动恢复钩子 | pageView 链路 | chatQueue/TaskRunner | makePageView/restore | discardTab/休眠 | — |
| `tools/index.ts` | — | — | — | — | 工具加 tabId | — | — | — | tabId 全表 |
| `page-context-menu.ts` | 加菜单项 | — | — | — | — | — | — | — | — |
| `agent/kernel/`、`runtime.ts` | — | — | 主战场 | 主战场 | — | — | — | — | — |
| `agent/reader*`、`notes.ts`、`reader-overlay.ts`、`highlight.ts` | — | 主战场 | — | — | — | — | — | — | — |
| `mcp-server.ts` | — | — | — | — | — | — | — | — | 会话命名空间 |

`shell.html` 是 148KB 单文件，**只有 A、B 两线允许碰，且 T03 必须等 T01/T02 合并后开工**。

## 4. 全局红线（每本任务书都引用，不重复抄）

1. **模型为脑**：分析、判断、规划全部交给模型；本地代码只做合法性校验和兜底。禁止新增硬编码正则去截胡用户句子。
2. **不碰 `docs/listings/`**；商店版禁止出现价格/支付文案；云端 Key 不进客户端。
3. **不代点**支付、发送、登录、验证码；遇登录墙/验证码一律 `waiting_human`。
4. 「发送前你确认」「人机同窗」产品哲学不变：前台任务（填表/支付确认/客服草稿）仍然同人同窗；后台任务（调研/比价/监控）才允许不抢屏。
5. 多种信息调研必须出报告页并在窗口打开，侧栏只留一句+卡片（现行死规则，保持不变）。
6. 改完必须 `npx vitest run` 全绿（现基线 362 条），新增逻辑必须补单测。
7. 主进程不热更：测功能用 `npx electron-vite dev -- --remote-debugging-port=9333` 开发窗，不要用旧安装包。
8. 一本一个 commit；commit message 格式：`feat(t0x): 一句话说明` 或 `refactor(t05): …`；附 typecheck/test 结果。
9. 不改 `src/main/envs/`、`src/main/cs/`、`src/main/cloud/`（除非任务书明说）。
10. 每本任务书开头先读：`AGENTS.md`（根目录）+ `docs/ARCHITECTURE.md`，再动代码。

## 5. 统一验收口径

每本任务书自带「验收口令」。通用三件套：

1. **单测**：`npx vitest run` 全绿，新增逻辑有新测试。
2. **实测口令**：在开发窗侧栏按任务书口令逐条过，结果符合预期。
3. **截图**：关键 UI 变化 3 张截图（变化前/后、异常态）。

任何一本验收不过：退回该窗口重做，其它线不受影响（这就是为什么按文件冲突域分窗）。

## 6. 任务书索引（绝对路径，直接复制给 Cursor）

| 编号 | 标题 | 路径 |
|---|---|---|
| T01 | 阅读器·引用块与划词问 Sparo | `d:\download\sparo上架应用商店版\sparo-agent-upgrade\tasks\T01-quote-and-ask.md` |
| T02 | 阅读器·笔记双向打通 | `d:\download\sparo上架应用商店版\sparo-agent-upgrade\tasks\T02-notes-loop.md` |
| T03 | 大脑·Plan 计划对象 | `d:\download\sparo上架应用商店版\sparo-agent-upgrade\tasks\T03-plan-object.md` |
| T04 | 大脑·工作单持久化断点续跑 | `d:\download\sparo上架应用商店版\sparo-agent-upgrade\tasks\T04-mission-persist.md` |
| T05 | 架构·任务绑标签 | `d:\download\sparo上架应用商店版\sparo-agent-upgrade\tasks\T05-task-tab-binding.md` |
| T06 | 架构·并行任务池 | `d:\download\sparo上架应用商店版\sparo-agent-upgrade\tasks\T06-parallel-pool.md` |
| T07 | 体验·后台保活不抢屏 | `d:\download\sparo上架应用商店版\sparo-agent-upgrade\tasks\T07-background-keepalive.md` |
| T08 | 体验·内存强化 | `d:\download\sparo上架应用商店版\sparo-agent-upgrade\tasks\T08-memory-diet.md` |
| T09 | 开放·多 Agent 标签寻址 | `d:\download\sparo上架应用商店版\sparo-agent-upgrade\tasks\T09-multi-agent-tabs.md` |
| T10 | 总验收·回归与文档 | `d:\download\sparo上架应用商店版\sparo-agent-upgrade\tasks\T10-final-qa.md` |

---

## 7. 收官阶段状态（2026-10-22 更新）

**已验收**：T01、T03、T04、T05、T06、T07 主体、T08；热修 fix(chrome) `505f177`、fix(brain) `b1cf18d`；UIUX 线 T16/T17/T18（代码级通过，交互项挂其全包复审）。

**收官队列（串行，一本一 commit，同一时间只有一个窗口动 browser.ts）：**

1. **T07B** 报告弹回漏补丁（大脑热修窗口执行中）→ `tasks/T07B-report-restore.md`
2. **T02** 笔记双向打通（补课，能力④另一半）→ `tasks/T02-notes-loop.md`
3. **T09** MCP 多 Agent 标签寻址 → `tasks/T09-multi-agent-tabs.md`
4. **T10** 总验收与文档收口（含全部尾巴账：T04「算了」实机、登出场景登录墙链路、已登录收尾、mission-journal 超时放宽、工作区大扫除）→ `tasks/T10-final-qa.md`

**纪律不变**：每本进场先 `git log --oneline -8` + `git status --short` 闸门；工作区有别人的未提交改动就停下报告；全量 `npx vitest run` 全绿才 commit。
