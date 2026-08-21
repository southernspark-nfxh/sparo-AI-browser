# Gap fix notes — Xiaohongshu / cross-origin iframe (2026-08)

Internal engineering notes for Fang Mo’s creator-platform blockage.

## Fixed in product

1. **P0 Cross-origin iframe** — CDP `Page.createIsolatedWorld` + `Runtime.evaluate`  
   - `snapshot` merges `x{i}.e*` refs  
   - `click` / `fill` / `execute({ frame })` / `page_text` / `click_text` route into frames  
2. **P1 Unicode** — MCP HTTP UTF-8 only; `scripts/call-mcp.mjs` rewritten (no hardcoded token); avoid PowerShell string args for Chinese  
3. **P1 click_text** — NFKC normalize, wider CJK match window, same-origin iframe walk + CDP fallback  

## Agent tip

`The model returned no response after processing tool results` is usually the **outer agent host** dropping a large/empty tool payload — retry with `sparo_info` / smaller `snapshot`, not a Sparo crash.
