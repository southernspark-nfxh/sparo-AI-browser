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

Full tool list: [`MCP-API.md`](./MCP-API.md)
