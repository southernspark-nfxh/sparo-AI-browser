# Connect an AI agent to Sparo Agent Browser · 连接 AI Agent

**Sparo Agent Browser** — *The browser built for AI agents — humans stay in control.*  
**Sparo 人机同窗浏览器** — *AI 驾驭网页，你驾驭 AI*

Sparo is the **hands**. Your agent is the **brain**.  
Sparo 是「手」。你的 Agent 是「脑」。

## Setup · 配置

1. Start Sparo: `npm run start` (or `npm run dev`)  
2. Open `%APPDATA%\sparo\mcp-auth.json`  
3. Use `endpoint` + Bearer `token` in your agent’s MCP client  

```powershell
$auth = Get-Content "$env:APPDATA\sparo\mcp-auth.json" | ConvertFrom-Json
# MCP URL: $auth.endpoint
# Header: Authorization: Bearer <token>
```

## Compatible agents · 可用 Agent

| Agent | Notes · 说明 |
|---|---|
| OpenClaw | MCP browser backend |
| Hermes | Tool actuator over MCP |
| Workbuddy | MCP host |
| Codex / Cursor / Claude Code | Add Sparo as MCP server |
| Custom | Any client that can call navigate / snapshot / click / fill |

## Typical loop · 典型闭环

1. User states a goal · 用户提出目标  
2. Agent plans and calls Sparo tools · Agent 规划并调用工具  
3. Human watches the shared window; Pause / Approval when needed · 人围观同窗；必要时暂停/审批  

### Publishing · 发帖 / 发小红书

**AI detects stage; scripts inject content once.** Do not loop `fill`.

```text
run_skill({ query: "发小红书", params: { title, body, topics } })
# or: xhs_ensure_editor → xhs_inject_compose → … → xhs_inject_publish → pause
```

Full playbook: [`PUBLISHING.md`](./PUBLISHING.md)  
Universal forms: [`UNIVERSAL-ANALYZER.md`](./UNIVERSAL-ANALYZER.md) · Hermes: [`HERMES-PLAYBOOK.md`](./HERMES-PLAYBOOK.md)  
Full tool list: [`MCP-API.md`](./MCP-API.md)  
Skills: [`../strategies/skills/README.md`](../strategies/skills/README.md)

### Forms · 通用填表

```text
run_skill({ query: "通用填表", params: { payload: { 标题, 正文, … } } })
# or: analyze_page → execute_primitives({ payload })
```

Do **not** loop `fill` on multi-field pages.

### Customer service · 客服半自动

```text
cs_draft_reply()   # or run_skill query 客服回复 — fills draft only
```

See [`CUSTOMER-SERVICE.md`](./CUSTOMER-SERVICE.md).
