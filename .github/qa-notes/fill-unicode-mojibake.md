# fill Chinese encoding (Mojibake) — fix notes

## Bug
`fill` / CDP `Runtime.evaluate` embedded raw CJK in the expression string → UTF-8 bytes read as Latin-1 → DOM showed `ä½ å¥½…`.

## Fix
1. **`cdpCall`** — `Runtime.callFunctionOn` with JSON `arguments` (scheme B)
2. **`cdpUtf8Expr`** — base64 + `TextDecoder` ASCII-only expression (scheme C fallback)
3. Main-frame `fill` / `execute` also inject values via `cdpUtf8Expr` (no raw CJK in source)

## Verify
```
fill value "你好世界测试" → snapshot value must be exact Chinese, not mojibake
```
