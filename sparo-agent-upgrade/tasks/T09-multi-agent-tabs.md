# T09 · 开放·多 Agent 标签寻址（更新版）

> 线：C（架构） · 依赖：T06 已合并（181028f）· 风险：中
> 代码根：`d:\download\sparo上架应用商店版`
> 进场闸门：读 `AGENTS.md`、`PLAN.md` 红线；`git log --oneline -8` 须含 181028f 与 b1cf18d；`git status` 确认 browser.ts、shell.html、runtime.ts 无未提交改动，有则停下报告。**本任务不碰 browser.ts、shell.html、runtime.ts/kernel**（前面任务在途）。

## 目标

多个外部 Agent（Cursor / 脚本 / 自研客户端）同时连 `127.0.0.1:3921`，各自操作各自标签，互不干扰。

## 现状锚点（照实读）

- T05 已落：`viewForTab / createAgentTab / releaseAgentTab`；navigate/click/fill/snapshot 已带可选 `tabId`
- T06 已落：`task-class.ts`、`task-pool.ts`，池上限 3、排队提示
- mcp-server.ts：Streamable HTTP + Bearer；mcp-security.ts 已有校验

## 改动清单

1. **tools/index.ts tabId 收口**：所有操作页面的工具（navigate/click/fill/snapshot/page_text/execute_primitives/press/pick_calendar/fill_suggest 等）接可选 `tabId`，缺省=当前激活标签（对外行为不变）；`list_tabs` 返回项加 `owner: "user" | "agent:<clientId>"`。
2. **mcp-server.ts 会话命名空间**：每个连接发 `clientId`（随机 6 位，随 initialize 响应返回）；连接内不带 tabId 的页面操作落「此 client 最近使用的标签」，没有则 `createAgentTab()` 新建——**绝不默认抢 activeTabId**；显式 tabId 照传（discarded 先唤醒）；每个 client 的后台任务计入全局池上限 3，超限返回明确错误 `pool_full`。
3. mcp-security.ts 校验不动；MCP 任务与侧栏共用 task 计量（一句一个 task_id）。
4. **文档**：`docs/MCP-API.md` 工具表加 tabId 列、新增「多 Agent 并行」小节（clientId、命名空间、pool_full）；`docs/AGENTS.md` 加 5 行以内说明。
5. **单测** `tests/multi-agent.test.ts`：双 client 各自建标签互不干扰、隐式操作落自己标签、显式 tabId 生效、pool_full、owner 字段。

## 禁区

不做 ACL 权限墙；不改 mcp-auth.json 的生成与位置；MCP 任务照走 waiting_human（登录墙等人）；不碰 `docs/listings/`、cloud/、envs/、cs/。

## 验收

脚本模拟双 MCP client：A 开站点甲、B 开站点乙 → 两个不同标签，用户当前页不动；A 连续隐式操作始终落自己标签；同时发 4 个后台任务第 4 个收 `pool_full`；`list_tabs` owner 可见；全量测试绿。

## Commit

`feat(t09): MCP 多 Agent 会话命名空间与标签寻址`
