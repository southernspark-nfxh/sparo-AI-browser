# QA Fix Status — 2026-08-10 (batch)

All items from `QA-COMPLETE-REPORT-20260810.md` addressed in code (no git commit unless asked).

## P0
| ID | Fix |
|----|-----|
| P0-01 | Chat/`rebuildDeepSeek` uses `apiKey`/`baseUrl`/`model` (+ legacy fallback) |
| P0-02 | `npm run accept:p0` → `scripts/accept-p0.mjs`; `accept:weibo` → `scripts/accept-weibo.mjs` |
| P0-03 | `mcp-security.ts`: CORS, rate limit, JSON errors, request logging; token TTL via `SPARO_MCP_TOKEN_TTL` + `createdAt` in `mcp-auth.json` |
| P0-04 | Removed dead `chrome.html`/`sidebar.html`; `shell.html` documents embedded sidebar |
| P0-05 | `requestApproval` timeout + reject clears overlays/snapshot; returns `approval: granted\|rejected\|timeout` |

## P1
| Item | Fix |
|------|-----|
| ESLint/Prettier/Vitest | `eslint.config.js`, `.prettierrc.json`, `vitest.config.ts`, `tests/*.test.ts` |
| `wait_for` iframes | CDP child-frame probe (`xN.*` + selector/text) |
| IsolatedWorld cache | `cdp-frames.ts` stable worlds + `clearIsolatedWorldCache` |
| Recording SPA replay | Record `cssPath`/`innerText`/`ariaLabel`; runner click/fill cascade |
| Partial God-class split | `browser-helpers.ts` (`softFillMatch`, `sleep`, …) |

## P2 quick wins
| Item | Fix |
|------|-----|
| Click down delay | `trustedClickAt` default `downDelayMs: 30` |
| Approvals TTL | `pruneStaleApprovals` (`SPARO_APPROVAL_MAX_AGE_MS`, default 10m) |
| Theme | Reverted — shell stays dark-only (light media query mixed badly with hardcoded colors) |
| `contains_text`/`page_text` | Already merges iframe text via CDP |
| Bookmarks overflow | Already has `» N` overflow chip |
| Token TTL write | `index.ts` `resolveMcpToken` + `createdAt` |
| CDP keep-attached | `withDebugger(..., { keepAttached })` / `SPARO_CDP_KEEP_ATTACHED=1` |

## Verify
```bash
npm install
npm run typecheck
npm test
npm run build
npm run ensure   # restart Sparo
```
