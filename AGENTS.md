# AGENTS.md — read this first (30 seconds)

You are controlling **Sparo Agent Browser** (*Sparo*): a local Electron Chromium browser with an MCP API.  
Tagline: *The browser built for AI agents — humans stay in control.*  
Do **not** explore the whole repo. Do **not** run long installs unless `node_modules` is missing.

## Fast path (do this)

```text
1. GET http://127.0.0.1:3920/health
   - If ok → Sparo is already running. Skip to step 3.
2. From repo root: npm run start
   - Wait until GET /health returns ok (usually < 15s after first build).
3. Read %APPDATA%/sparo/mcp-auth.json → endpoint + token
4. MCP call navigate { "url": "https://weibo.com" }
5. MCP call get_url → confirm host contains weibo
```

One-liner helpers:

```bash
npm run status          # is Sparo up?
npm run open -- https://weibo.com   # ensure running + navigate
```

## What Sparo is / is not

| Is | Is not |
|---|---|
| Shared browser window + MCP tools (人机同窗) | A cloud browser |
| Hands for your agent — humans stay in control | A vertical e-commerce bot (packs optional) |
| Needs local `npm run start` once | Something you reverse-engineer from source every time |

## MCP

- URL: `http://127.0.0.1:3920/mcp`
- Auth: `Authorization: Bearer <token from mcp-auth.json>`
- Core tools: `navigate`, `get_url`, `get_title`, `snapshot`, `click`, `fill`, `click_text`, `pause`, `resume`
- Call `sparo_info` once if unsure.
- Full reference: `docs/MCP-API.md`

## Anti-patterns (waste time)

- Reading the whole `src/` tree before calling `sparo_info` / `/health`
- Inventing Playwright scripts against a different Chrome
- Using Playwright/Puppeteer against Sparo instead of MCP
- Claiming success without `get_url` / `get_title` confirmation
