# Sparo Agent Browser — Architecture

One-page overview of how **Sparo Agent Browser** boots and how agents reach the shared Chromium window.  
*The browser built for AI agents — humans stay in control.* / *AI 驾驭网页，你驾驭 AI*  
Aligned with `src/main/index.ts` (v0.1.0).

```
┌──────────────────────────────────────────┐
│               Electron App                │
│                                           │
│  ┌──────────┐    ┌───────────────────┐   │
│  │ Renderer │    │    Main Process    │   │
│  │ shell.html│◄──►│                    │   │
│  │ (chrome +│    │  ┌─────────────┐   │   │
│  │  sidebar)│    │  │ SparkBrowser │   │   │
│  └──────────┘    │  │ browser.ts   │   │   │
│                   │  └──────┬───────┘   │   │
│                   │         │            │   │
│                   │  ┌──────▼───────┐   │   │
│                   │  │ ToolHandlers │   │   │
│                   │  │ tools/index  │   │   │
│                   │  └──────┬───────┘   │   │
│                   │         │            │   │
│                   │  ┌──────▼───────┐   │   │
│                   │  │  MCP Server  │   │   │
│                   │  │ mcp-server.ts│   │   │
│                   │  └──────┬───────┘   │   │
│                   └─────────┼───────────┘   │
│                             │                │
└─────────────────────────────┼────────────────┘
                              │ HTTP :3920/mcp
                     ┌────────▼────────┐
                     │   AI Agent       │
                     │ Hermes / OpenClaw│
                     │ Cursor / Codex…  │
                     └─────────────────┘
```

## Boot sequence (`src/main/index.ts`)

1. `app.setName("Sparo")` (+ Windows AppUserModelId).
2. `whenAppReady()` → create **SparkBrowser** (`createBrowser()`), attach the shell (`attachShell()` → `shell.html`).
3. `createToolHandlers(browser)` maps MCP tool names → browser methods.
4. `startMcpServer(handlers)` listens on `127.0.0.1:3920` (`/mcp`, `/health`).
5. Write `%APPDATA%/sparo/mcp-auth.json` with `{ endpoint, token, pid }` for agents.

## Core modules

| Module | Role |
|--------|------|
| **Main entry** `index.ts` | Process lifecycle, MCP auth file, quit |
| **SparkBrowser** `browser.ts` | Real Chromium window + tabs; clicks/fills/nav; pause & approval |
| **ToolHandlers** `tools/index.ts` | Thin MCP → browser adapter |
| **MCP Server** `mcp-server.ts` | Streamable HTTP MCP + Bearer auth |
| **Renderer** `shell.html` | Human chrome (tabs, URL bar, bookmarks) + sidebar chat |
| **Features** `features.ts` | `SPARO_ENABLE_DXM=1` gates optional vertical workflows |

> Internal class name is still `SparkBrowser` (legacy); product name is **Sparo Agent Browser** (brand: Sparo).

## Extra surfaces

- **Skills**: `start_recording` / `stop_recording` / `list_skills` — teach a flow once, reuse.
- **Human protocol**: `pause` / `resume` / `request_approval` — agent stops or waits for sidebar decision.
- **Vertical pack**: Dianxiaomi workflows only when `SPARO_ENABLE_DXM=1`; see [MCP-API.md](./MCP-API.md).

## Related docs

- Agent onboarding: [`AGENTS.md`](../AGENTS.md), [`docs/AGENTS.md`](./AGENTS.md)
- Tool reference: [`docs/MCP-API.md`](./MCP-API.md)
