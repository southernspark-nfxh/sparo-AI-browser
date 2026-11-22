# Sparo 全量代码 QA 书

这份书只查代码和测试，不操作窗口。窗口体验另见 `D:\download\sparo上架应用商店版\docs\QA-TASKBOOK-PROMPT.md`。

仓库：`D:\download\sparo上架应用商店版`。

判定只用四个字：

- 过：契约在代码里，并且有测试钉住。
- 不过：代码和文档或任务书不一致。
- 未锁：代码接上了，没有测试钉住这条契约。
- 未接：文档有，代码没有入口。

重跑本轮用过的测试：

```text
npx vitest run tests/command-actions.test.ts tests/command-batch.test.ts tests/command-center-review.test.ts tests/command-room.test.ts tests/command-room-multiwindow.test.ts tests/command-room-shell.test.ts tests/sidebar-tab.test.ts tests/workbench-shell.test.ts tests/task-projection.test.ts tests/task-state.test.ts tests/task-lifecycle.test.ts tests/task-attention.test.ts tests/task-recovery.test.ts tests/page-lease.test.ts tests/page-session-routing.test.ts tests/agent-tab-busy.test.ts tests/publish-gate.test.ts tests/agent-integrity-p0.test.ts tests/agent-integrity-p1.test.ts tests/agent-integrity-s01.test.ts tests/agent-integrity-s02.test.ts tests/focus-guard.test.ts tests/shell-focus-typing.test.ts tests/site-open-job.test.ts tests/page-text-delta.test.ts tests/read-rewrite.test.ts tests/loop.test.ts tests/intent-router.test.ts tests/brain.test.ts tests/dxm-smt-publish.test.ts tests/dxm-smt-listing.test.ts tests/dxm-crawl-readback.test.ts tests/env-delete.test.ts tests/envs.test.ts tests/cs-intent.test.ts tests/skills-format.test.ts tests/stop-task.test.ts tests/sidebar-stop.test.ts
```

## A. 壳层

| 编号 | 契约 | 代码 | 测试 |
|---|---|---|---|
| A1 | 指挥室中间只有总览，对话只在右侧 | `src\renderer\shell.html` 的 `renderCommandRoom` 不再画第二栏 | `tests\workbench-shell.test.ts` |
| A2 | 回复不自称 Pi | `src\main\agent\free-soul.ts` 系统提示第一句只称 Sparo | 未锁。提示词没有快照测试 |
| A3 | 没配模型时直接说明 | `src\main\browser.ts` `handleChat` 在 `freeSoul` 为空时写「请先在设置里配置模型」 | `tests\command-center-review.test.ts` 没配模型的批量句 |
| A4 A8 | 指挥室或最小化时，新建工位不成为当前页 | `src\main\browser.ts` `shouldShowWorkTab` | `tests\sidebar-tab.test.ts`「人在指挥室时」 |
| A5 | 切页后的 `page_text` 读那一页 | `pinToolTab` / `resolveToolTab` | 同上，以及「切到头条和百家号」 |
| A6 A7 | 点卡片进原页；页面聊天和总指挥分开 | `sessionKeyForTab`；`chatTurnsToPersist` 只写当前会话 | `tests\page-session-routing.test.ts` |

## B. 指挥室

| 编号 | 契约 | 代码 | 测试 |
|---|---|---|---|
| B1 | 点名两站就拆成两页 | `src\main\agent\command-room.ts` `parseListedBatch` | `tests\command-batch.test.ts`、`tests\command-center-review.test.ts` |
| B2 | 「停掉某页」停止任务，不关标签。已失败的页也要留成已停止 | `stopTarget`、`matchPages` 标题包含；`stopAgentTask` 对已经失败的卡调用 `acceptManualStop`，标签不关 | `tests\stop-task.test.ts`、`tests\command-actions.test.ts` |
| B3 | 忙页不能再接一件新任务 | 指挥室 `dispatch` 对非 idle 返回 `tab_busy`。侧栏或眼前这一页还在进行时，新的一句不打断、不续跑 | `tests\command-actions.test.ts`、`tests\free-soul-guard.test.ts`、`tests\mcp-task.test.ts` |
| B4 | 待验收可点知悉，不解除绑定 | 无任务池编号时用租约编号，并写出未确认的提醒；`ackTask` 认租约 | 知悉有 `tests\task-attention.test.ts`。侧栏租约这条未锁 |
| B5–B8 | 开站、检索、写诗、短句「继续」不早退、不另开单 | `src\main\agent\site-open`、`loop.ts`、`intent-router.ts` | `tests\site-open-job.test.ts`、`tests\loop.test.ts`、`tests\intent-router.test.ts` |
| B9 | 重启后进行中变成失败，不自动接着跑 | `src\main\browser.ts` 恢复路径 | `tests\task-recovery.test.ts` |

## C. 0.x 老功能

| 编号 | 契约 | 代码 | 测试 |
|---|---|---|---|
| C1 C2 | 读页成文档；上一份阅读页之后的采集另开新单 | `read-rewrite`、报告落盘 | `tests\read-rewrite.test.ts`。落盘路径未在本轮打开窗口核对 |
| C3 | 读页带「较上次 +N 字」，+0 换策略 | `src\main\agent\free-soul.ts` | `tests\page-text-delta.test.ts` |
| C4 | 总结必须先读当前页；对照表进报告页 | 提示词要求 `page_text`；`research-report` | 未锁到「指挥室里说总结这一页」 |
| C5–C8 | 发头条、百家号、公众号只存草稿、视频不走图文页 | `slots.ts` `publishSlots`；`free-soul.ts` 发稿段；`strategies\skills\social-media-publish` | `tests\brain.test.ts`、`tests\skills-format.test.ts`。没有从指挥室原句打到技能脚本的测试 |
| C9 C10 | 店小秘编辑；没说认领就不认领；收费先确认 | `dxm-smt-listing`、`free-soul.ts` 的 `claimConsent` / `request_confirm` | `tests\dxm-smt-listing.test.ts`、`tests\dxm-smt-publish.test.ts`、`tests\dxm-crawl-readback.test.ts` |
| C11 | 客服只填草稿 | `cs-intent`、提示词 | `tests\cs-intent.test.ts` |
| C12 | 建环境、删环境清存储，清失败则保留环境 | `deleteEnvFully` | `tests\env-delete.test.ts`、`tests\envs.test.ts` |

## S. 安全

| 编号 | 契约 | 代码 | 测试 |
|---|---|---|---|
| S1 | 支付必须用户自己点 | `publish-gate.ts` `PAY_HOLD` | `tests\publish-gate.test.ts`、`tests\agent-integrity-p0.test.ts` |
| S2 | 逐步确认下，发布和发送先确认 | `gateClickText`、`needsLandedConfirm` | `tests\agent-integrity-s01.test.ts` |
| S3 | 人打字时点击让开 | `focus-guard` | `tests\focus-guard.test.ts`、`tests\shell-focus-typing.test.ts` |
| S4 | 删除可执行，做完要说明 | `publish-gate.ts` 删除软边界 | `tests\agent-integrity-s02.test.ts` |

## 不在这本书里冒充通过的

窗口里的真实登录、真实发布、真实店小秘页面、窄屏观感。那些仍走 `D:\download\sparo上架应用商店版\docs\QA-TASKBOOK-PROMPT.md`。
