# Universal analyzer — Agent notes

Tools:

- `analyze_page` — stamp refs + classify fields/buttons + required (红星)
- `execute_primitives({ payload })` — fuzzy-match labels → fill/click/upload + mini-QA
- Strategy cache: `%APPDATA%/sparo/strategy-cache.json`

Example:

```json
{
  "name": "execute_primitives",
  "arguments": {
    "payload": {
      "标题": "Sparo浏览器——AI终于有了自己的手。",
      "正文": "先说一个你可能没意识到的问题…",
      "话题": ["AI工具", "浏览器"]
    }
  }
}
```

Prefer site-specific inject tools for Xiaohongshu long-form (`xhs_inject_*` / `xhs_layout_next`) when available; use analyzer for unknown sites.

**Agent shortcut:**

```text
run_skill({ query: "通用填表", params: { payload: { "标题": "…", "正文": "…" } } })
```

Hermes: see [`HERMES-PLAYBOOK.md`](./HERMES-PLAYBOOK.md).
