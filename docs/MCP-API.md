# Sparo Agent Browser — MCP API Reference

**Sparo Agent Browser** · *The browser built for AI agents — humans stay in control.*  
**Sparo 人机同窗浏览器** · *AI 驾驭网页，你驾驭 AI*

Source of truth: `src/main/tools/index.ts` + `src/main/mcp-server.ts` (v0.1.0).  
Default endpoint: `http://127.0.0.1:3920/mcp` (override with `SPARO_MCP_PORT`).  
Auth: Bearer token from `%APPDATA%/sparo/mcp-auth.json` (written on Sparo start).

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

- `snapshot(selector?)` → interactive elements with **refs** (e.g. `e3`); optional filter substring
- `page_text()` → slice of visible `document.body.innerText`
- `contains_text(text)` → whether visible body text contains the needle
- `wait_for({ selector?, text?, ref?, timeoutMs? })` → wait until DOM condition (page readiness, **not** human approval)

---

## Actions

- `click({ ref?, selector?, caret? })` → trusted mouse click; `caret=true` hits split-button right edge; may return portal info when a menu opens
- `fill({ ref?, selector? }, value)` → fill input/textarea/contenteditable; verify `data.matched` when present
- `select({ ref?, selector? }, value)` → native `<select>` or combobox option by label/value
- `upload({ ref?, selector? }, files[])` → set `input[type=file]` via CDP; **absolute** local paths
- `click_text(text, { exact?, withinPortal?, caret? })` → trusted click by visible text; use `withinPortal` for Ant Design / Element menus
- `menu_click(trigger, item)` → open dropdown by trigger text, then click menu item text
- `execute(script)` → run JS in the page; JSON-serializable return value

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

- `start_recording({ platform?, task? })` → start recording human click/fill/change
- `stop_recording(title?)` → stop, save trace, create a named skill
- `list_skills()` → list saved skills

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
