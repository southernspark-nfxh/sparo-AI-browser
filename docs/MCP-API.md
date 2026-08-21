# Sparo Agent Browser — MCP API Reference

**Sparo Agent Browser** · *The browser built for AI agents — humans stay in control.*  
**Sparo 人机同窗浏览器** · *AI 驾驭网页，你驾驭 AI*

Source of truth: `src/main/tools/index.ts` + `src/main/mcp-server.ts` (v0.1.0).  
Default endpoint: `http://127.0.0.1:3920/mcp` (override with `SPARO_MCP_PORT`).  
Auth: Bearer token from `%APPDATA%/sparo/mcp-auth.json` (written on Sparo start).

**Publishing playbook (Xiaohongshu + other sites):** [`PUBLISHING.md`](./PUBLISHING.md) — read before inventing fill loops.

Unless noted, tools return a JSON `ToolResult`-shaped payload inside MCP text content:

```json
{ "ok": true, "message": "...", "data": { } }
```

Refs from `snapshot` expire after navigation or major DOM changes — **re-snapshot** before the next click/fill.

---

## Discovery

- `sparo_info()` → what Sparo is, fast path, health URL, core tool names. **Call once** when an agent first connects.

---

## Navigation

- `navigate(url)` → open URL; returns confirmed `{ requestedUrl, url, title, confirmed, … }`. Always check `data.url` / `confirmed` before continuing.
- `reload()` → reload active tab
- `go_back()` → browser back
- `go_forward()` → browser forward
- `get_url()` → `{ data: { url } }`
- `get_title()` → `{ data: { title } }`

---

## Tabs

- `new_tab(url?)` → open a tab (optional URL); tools act on the **active** tab
- `close_tab(id)` → close by id (cannot close the last tab)
- `switch_tab(id)` → set active tab
- `list_tabs()` → `{ data: tabs… }` including active id/url

---

## Page perception

- `snapshot(selector?)` → interactive elements with **refs** (e.g. `e3`, `f0.e1` same-origin iframe, `x0.e1` cross-origin CDP frame); optional filter substring
- `page_text()` → slice of visible text (main frame + CDP iframe text when available)
- `contains_text(text)` → whether visible body text contains the needle
- `wait_for({ selector?, text?, ref?, timeoutMs? })` → wait until DOM condition (page readiness, **not** human approval)

> Cross-origin editors (Xiaohongshu / Feishu / Notion): run `snapshot` first, then `click`/`fill`/`execute` using `x{i}.*` refs (or `execute` with `frame`).

---

## Actions

- `click({ ref?, selector?, caret? })` → trusted mouse click; `caret=true` hits split-button right edge; may return portal info when a menu opens
- `fill({ ref?, selector? }, value)` → fill input/textarea/contenteditable; verify `data.matched` when present
- `select({ ref?, selector? }, value)` → native `<select>` or combobox option by label/value
- `upload({ ref?, selector? }, files[])` → set `input[type=file]` via CDP; **absolute** local paths
- `click_text(text, { exact?, withinPortal?, caret? })` → trusted click by visible text (NFKC; portals + same-origin iframes + CDP frames)
- `menu_click(trigger, item)` → open dropdown by trigger text, then click menu item text
- `execute(script, { frame? })` → run JS in page; `frame: 0` / `"x0"` for cross-origin CDP iframe from snapshot

---

## Overlays & portals

- `dismiss_overlays()` → close tip/confirm modals and hide leftover dropdowns
- `list_portals()` → visible Portal menus and item texts

---

## Human-in-the-loop

- `pause()` → freeze agent control (human takeover)
- `resume()` → resume agent control
- `request_approval(action, reason, risk?)` → sidebar approve/reject; **blocks** until resolved

---

## QA (vertical / Dianxiaomi-oriented)

Still registered on the MCP surface; most useful when DXM pages / flag are in play.

- `qa_check()` → SMT product-edit QA checklist on the active tab
- `qa_gate()` → run QA and block on FAIL (also auto-gates risky submit clicks)

---

## Skills（妙招）

- `list_skills()` → list saved skills
- `match_skill(query)` → rank skills for a natural-language goal (e.g. `发小红书`)
- `get_skill(id|query)` → full skill steps + params
- `run_skill({ id?, query?, params?, dryRun? })` → **execute** the skill in the shared window  
  - Prefer this over hand-rolled click/fill sequences when a skill exists  
  - Xiaohongshu: `run_skill({ query: "发小红书" })` — **call immediately**, do not explore first  
  - Title control is `textarea.d-text` (also accept `input.d-text`); topics use overlay `#d-overlay-root`  
  - Optional `params`: `{ title, body, topics, mdPath, autoPublish }`  
  - Default pauses before publish; `autoPublish: true` clicks content-area 发布 (not sidebar)  
- `start_recording({ platform?, task? })` → start recording human click/fill/change  
- `stop_recording(title?)` → stop, save trace, create a named skill  

- `xhs_page_stage()` → detect chooser | compose | publish (AI routing only)  
- `xhs_inject_compose({ title, body, force? })` → **atomic** clear+write title/body once — prefer over `fill`  
- `xhs_inject_publish({ summary?, topics? })` → **atomic** summary + topics on publish page  
- `xhs_ensure_editor` → 写长文 → 新的创作 → **空白创作**  
- `xhs_scroll_bottom` / `xhs_pick_cover` / `xhs_click_publish`  
- `screenshot` / `diagnose`  

**Product rule:** AI detects stage and clicks; scripts deliver pre-baked content. Do not loop `fill` on title/body.  
`run_skill({ query: "发小红书", params: { title, body, summary, topics } })` is the preferred path.

---

## Workflows (optional vertical pack)

Require `SPARO_ENABLE_DXM=1`. Otherwise treat as disabled / empty in public Sparo.

- `list_workflows()` → workflow summaries
- `run_workflow(id)` → run workflow by id

---

## Typical call flow

```
1. sparo_info()                          → confirm Sparo is up
2. navigate("https://example.com/login") → wait for confirmed url/title
3. snapshot()                            → get refs (e.g. e3, e5, e7)
4. fill({ ref: "e3" }, "username")
5. fill({ ref: "e5" }, "password")
6. click({ ref: "e7" })
7. get_url()                             → confirm landed on /dashboard
```

For Ant Design dropdowns: prefer `menu_click(trigger, item)` or `click` once + `list_portals` — do not double-click the trigger.

## Unicode / Chinese agents

MCP HTTP expects **UTF-8 JSON**. Prefer Node clients:

```bash
node scripts/call-mcp.mjs tools/call click_text "{\"text\":\"写长文\"}"
```

Avoid PowerShell string literals for Chinese args (console code page corrupts them). Connect agents directly to `http://127.0.0.1:3920/mcp` with UTF-8 bodies.
