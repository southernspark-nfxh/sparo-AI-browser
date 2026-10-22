# T10 · 总验收·回归与文档收口（更新版）

> 线：收口 · 依赖：T02、T07B（fix(t07)）、T09 全部合并 · 主窗口执行 · **不写新功能，只验收、修小疵、写文档**
> 代码根：`d:\download\sparo上架应用商店版`；进场闸门：`git log` 含全部前序 commit、工作区除既定遗留外干净。

## A. 五项能力逐条过

| 能力 | 验收动作 | 通过标准 |
|---|---|---|
| ① 并行 | 连发比价+出差两后台，再发前台回评论 | 两后台并行不抢页，前台不受阻 |
| ① 多 Agent | T09 双 client 脚本 | 各自标签各自操作 |
| ② 不抢屏 | 最小化跑后台调研；**含报告打开场景** | 全程不弹、完成 flashFrame；出报告只切标签不弹窗 |
| ③ 内存 | 连跑 3 后台任务看进程 | 完成即 discard 进程回落；报告标签复用；memorySaver 默认开 |
| ④ 阅读 | 划词/拖拽引用（T01）+ **T02 四条**：@笔记下拉、存为笔记、阅读页两按钮、笔记页管理 | 六条链路全通 |
| ⑤ 大脑 | 计划卡/修订/断点续跑 + **补两条**：登出场景登录墙链路（清登录态后发「登陆微博」→ 真停登录页 →「你登录后说继续」→ 续跑走通）；「算了」实机（恢复卡场景说「算了」→ 单 close 不再现） | 全过 |

## B. 全量回归

`npx vitest run` 全绿；基础 10 场景抽 5（天气 / 比价 / 出差 / 读页 / gov.cn）；云订阅冒烟（登录送点、一句一个 task_id、用尽跳官网，不真付款）。

## C. 顺手小修（每条单独小 commit，每修跑测试）

1. `tests/mission-journal.test.ts` 压缩用例加 `test.setTimeout(15000)`（实测 6.6s 贴 5s 默认线）
2. **已登录场景收尾**：goal.site 登录页被站点跳回首页时，模型判「已登录」→ 一句话告知并完成任务，不挂「等你处理」
3. `tests/report-html.test.ts` 若仍未还原（内容 diff 为空）→ `git checkout --` 还原
4. **工作区大扫除**：untracked 归类——`qa-screenshots/`、`scripts/qa-*`、`data/`、`.trae/`、`.novel-assistant/` 等本地/QA 目录，该删删、该进 `.gitignore` 进 `.gitignore`；一次 `chore(t10)` commit

## D. 文档收口

- `CHANGELOG.md` 新增 0.2.0：五项能力各一句 + 双主题/标签栏/发送按钮一句
- `docs/ARCHITECTURE.md`：架构图加「任务↔标签绑定、TaskRunner 池」层；模块表加 plan、mission-journal、task-class、task-pool、site-goal
- `docs/PRODUCT-TASKBOOK.md`：§5 记 v0.4.0 修改日志（含本升级线全部 commit），§8 勾掉相关待办
- `docs/MCP-API.md`：确认 T09 的 tabId / 多 Agent 章节已合入
- 根 `AGENTS.md`：死规则后补一句后台任务规则（调研类后台跑，完成闪任务栏）

## E. 打包前置（与 UIUX 线汇合）

UIUX 全包复审完成（T16/T17/T18 三张未点清单点完、4.43:1 对比度定夺、`.tab.done` 灰阶核对）后才打包。`npm run dist` 等用户明确发话，默认只到文档收口。

## 交付

验收报告 A/B/C 逐项打勾（失败附复现步骤）；`docs(t10): 五项能力总验收与文档收口`。
