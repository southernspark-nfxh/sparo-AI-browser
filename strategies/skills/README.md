# Sparo skills（妙招）

Agent-facing catalog. Full publish playbook: [`docs/PUBLISHING.md`](../../docs/PUBLISHING.md).  
Hermes: [`docs/HERMES-PLAYBOOK.md`](../../docs/HERMES-PLAYBOOK.md).

## Rule

**AI = stage + clicks. Script = inject pre-baked content once.**  
**Unknown forms = analyze_page → execute_primitives (skill `universal-form-fill`).**

## Active

| id | Say | What it does |
|----|-----|----------------|
| `universal-form-fill` | 通用填表 / 自动填表 | **analyze_page → execute_primitives**（任意站点） |
| `cs-semi-auto-reply` | 客服回复 / 帮我回客户 | **cs_scan → cs_draft_reply**（填草稿，不自动发送） |
| `xhs-longform-publish` | 发小红书 / 小红书发布 | ensure editor → **inject** title/body → layout → next → inject topics → pause |
| `xhs-longform-compose` | 小红书草稿 | shorter compose path; prefer `xhs-longform-publish` |

## How agents should call

```text
# Unknown form
run_skill({ query: "通用填表", params: { payload: { 标题, 正文, … } } })

# Xiaohongshu
run_skill({
  query: "发小红书",
  params: { title, body, summary?, topics?, mdPath? }
})
```

Do **not** invent a multi-step `fill` plan when a matching skill exists (`match_skill` first).

## Add another site

1. Copy `_template-site-publish.json`
2. Implement one-shot inject (or new MCP helper)
3. Bundled skills auto-seed to `%APPDATA%/sparo/skills/` on Sparo boot
4. Add aliases + a section in `docs/PUBLISHING.md`
