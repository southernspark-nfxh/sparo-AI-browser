# 任务书：0.5.0 多 Agent 对话记忆隔离修复 + 黄金场景复测

> 触发：2026-11-11 0.5.0 安装包首次 G1「打开微博」复测失败。模型 finalUrl 落在百家号作品管理页、closeReason=done（假 done）、侧栏无「已打开 weibo.com」句。根因：social-media-publish 客户端留在共享 chat-memory 里的百家号上下文污染了 sidebar 客户端的新任务规划。
>
> 版本：0.5.0 之后（下一个版本号待定）
> 责任：**本 Agent 自行完成**，无外部窗口

---

## 零、根因定位（已实测）

| # | 位置 | 现状 | 问题 |
|---|---|---|---|
| A | `src/main/profile/chat-memory.ts:30` `chatMemoryPath()` | 返回 `chat-memory.json`（单文件） | 文件名不含 clientId，所有 Agent 共用一个磁盘文件 |
| B | `src/main/browser.ts:1398` | `this.chatLog = loadChatMemory(...)` | 单个数组 `ChatTurn[]`，全局共享 |
| C | `src/main/browser.ts:7898` | `handleChat` 拼 history = `this.chatLog.slice(-12)` | 不按 clientId 过滤 |
| D | `src/main/mcp-server.ts:758` | `async ({ text, execMode }) => handlers.submit_task(text, { execMode })` | MCP 入口没把 `x-sparo-client` header 的 clientId 往下传 |

标签页隔离是好的（`owner: "agent:social-media-publish"`），但对话记忆这四条线全漏了。修完这四条线，每个客户端只看见自己轮次的历史。

---

## 一、修复步骤（按依赖顺序）

### Step 1：MCP 入口把 clientId 传下去（修 D）

**改 `src/main/mcp-server.ts`**：submit_task / get_task / list_tasks / stop_task 这些带 clientId 语义的 handler，从 HTTP header `x-sparo-client` 取 clientId 字段，传给 handler 的 opts。

对照：已有 `x-sparo-client` 协议（AGENTS.md 写了），但这些 handler 没解析。

**验收**：`list_agents` 仍能看到 sidebar + social-media-publish；新提交的 submit_task 在 get_task 里能带回 clientId 字段。

### Step 2：chat-memory 按 clientId 分文件（修 A）

**改 `src/main/profile/chat-memory.ts`**：

```
chatMemoryPath(configDir)  →  chatMemoryPath(configDir, clientId?)
                          →  clientId 为 null 时仍返回 chat-memory.json（兼容侧栏旧数据）
                          →  clientId 有值时返回 chat-memory.{clientId}.json
```

`loadChatMemory` / `saveChatMemory` / `clearChatMemory` 同步加 `clientId?` 参数。

**验收**：loadChatMemory("foo", "social-media-publish") 读写 `chat-memory.social-media-publish.json`；loadChatMemory("foo") 仍读写 `chat-memory.json`（侧栏默认）。

### Step 3：browser.ts 内存结构隔离（修 B + C）

**改 `src/main/browser.ts`**：

- `this.chatLog: ChatTurn[]` → `this.chatLogs: Map<string, ChatTurn[]>`
- 默认 key 为 `"sidebar"`（侧栏 / submit_task 无 clientId 的情况走这条路）
- `handleChat` 拼 history 时，从正确的 clientId 数组里 `slice(-12)`
- `saveChatMemory` 每个 clientId 单独落盘
- `loadChatMemory` 初始化时按已知 clientId 各 load 一份（未知的懒加载，第一次用时再 load）
- `saveTimer` 改成 `Map<string, NodeJS.Timeout>`，每个 clientId 自己的 debounce timer，互不清

**验收**：social-media-publish 客户端的对话轮次写进 `chat-memory.social-media-publish.json`，sidebar 的继续写 `chat-memory.json`，两文件互不干扰。

### Step 4：typecheck + 单测 + 真机复测

- `npx tsc --noEmit` → 0 error
- `npm test` 全绿
- **真机复测 G1–G3**（先确认 social-media-publish 窗口已断或不跑）：
  - G1「打开微博」期望 finalUrl=`https://weibo.com/`、close.reason=done、chat 有助手句「已打开 weibo.com。」
  - G2 / G3 按底账核对（需要手动前置：先停在 weibo.com/u/ 页、G2 产出阅读页后再发 G3 原句）

---

## 二、不改的东西

- 标签页隔离逻辑不动（已经好的）
- `ensure_render` / `release_render` 不动（本期无关）
- `dxm-crawl-prep` 技能包不动（本期无关）
- 任务书 / QA 底账结构不动（只是更新结果）
- 不碰 `tests/dxm-smt-r11b.test.ts` 那条线的单测（R11-B 真机四条还是我，但这是独立任务，隔离修好之后顺便跑）

---

## 三、打包与提交

修复 + 复测全部绿了之后：
1. CHANGELOG 加一条「多 Agent 对话记忆按 clientId 隔离，不再跨 Agent 污染历史」
2. commit
3. 重新打 `npm run dist`
4. 安装包名仍按 package.json 当前版本号（打之前再确认要不要升到 0.5.1）

---

## 四、执行顺序（我自己按这个走）

```
Step 1 (mcp-server.ts 传 clientId)
  ↓
Step 2 (chat-memory.ts 按 clientId 分文件)
  ↓
Step 3 (browser.ts Map + history 过滤)
  ↓
Step 4 (typecheck → npm test → G1–G3 真机 → R11-B 真机)
  ↓
CHANGELOG + commit + dist
```

## 五、红线

- `this.chatLogs.set(clientId, ...)` 时必须给默认 `"sidebar"`，不能 undefined/null → 否则侧栏自己的历史丢了
- 旧数据 `chat-memory.json` **不要迁移**，让侧栏自然继续用；新客户端各自开新文件
- 任何一步没绿就不退，修完再进下一步
- 不碰 `tests/dxm-*` 的断言，只加隔离相关的新单测
