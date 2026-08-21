# AGENTS.md — read this first (30 seconds)



You are controlling **Sparo Agent Browser** (*Sparo*): a local Electron Chromium browser with an MCP API.  

Tagline: *The browser built for AI agents — humans stay in control.*  

Do **not** explore the whole repo. Do **not** run long installs unless `node_modules` is missing.



## Fast path (do this)



```text

1. GET http://127.0.0.1:3920/health

   - If ok → Sparo is already running. Skip to step 3.

   - Confirm tools include xhs_inject_compose (else restart Sparo).

2. From repo root: npm run start

   - Wait until GET /health returns ok (usually < 15s after first build).

3. Read %APPDATA%/sparo/mcp-auth.json → endpoint + token

4. If user wants to publish content → read docs/PUBLISHING.md and jump to Publish below

5. Unknown site / generic form → analyze_page then execute_primitives (docs/UNIVERSAL-ANALYZER.md)

6. Else: MCP navigate { "url": "…" } then get_url to confirm

```



One-liner helpers:



```bash

npm run status          # is Sparo up?

npm run open -- https://weibo.com   # ensure running + navigate

```



## Publish / 发帖 / 发小红书 (important)



**AI detects stage and clicks. Scripts inject pre-baked title/body/tags once.**  

Never loop `fill` on title/body. Never type character-by-character into the page.



```text

# Preferred — one shot

run_skill({

  query: "发小红书",

  params: { title, body, summary?, topics?, mdPath? }

})



# Or atomic tools

xhs_ensure_editor → xhs_inject_compose({title,body}) → click 下一步

→ xhs_inject_publish({summary,topics}) → pause

```



Other sites: same pattern — `match_skill` / `run_skill`, or copy `strategies/skills/_template-site-publish.json`.  

Full playbook: **`docs/PUBLISHING.md`**.



## What Sparo is / is not



| Is | Is not |

|---|---|

| Shared browser window + MCP tools (人机同窗) | A cloud browser |

| Hands for your agent — humans stay in control | A vertical e-commerce bot (packs optional) |

| Needs local `npm run start` once | Something you reverse-engineer from source every time |



## MCP



- URL: `http://127.0.0.1:3920/mcp`

- Auth: `Authorization: Bearer <token from mcp-auth.json>`

- Discovery: `sparo_info`, `GET /health`, `GET /tools`

- Publish tools: `run_skill`, `xhs_page_stage`, `xhs_inject_compose`, `xhs_inject_publish`, `xhs_ensure_editor`

- Core: `navigate`, `get_url`, `snapshot`, `click_text`, `pause`, `diagnose`

- Full reference: `docs/MCP-API.md`



## Anti-patterns (waste time)



- Reading the whole `src/` tree before calling `sparo_info` / `/health`

- Inventing Playwright scripts against a different Chrome

- Using Playwright/Puppeteer against Sparo instead of MCP

- Claiming success without `get_url` / `get_title` confirmation

- **Filling XHS title/body with repeated `fill` instead of `xhs_inject_compose` / `run_skill`**

- Exploring creator homepage for minutes instead of `target=article` URL


