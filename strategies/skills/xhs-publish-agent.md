# Skill: Sparo 小红书长文发布（给其他 AI Agent）

## When to use

User wants to publish a Xiaohongshu long-form note via Sparo MCP.

## Prefer

1. `node scripts/qa-xhs-publish.mjs` for regression
2. Atomic MCP tools (below) — more reliable than `run_skill` if skill runner stalls
3. `run_skill({ query: "发小红书", params: {...} })` when starting from chooser/compose

If `run_skill` hangs >90s: `resume` then run atomic path only.

```text
xhs_ensure_editor
xhs_inject_compose({ title, body, force: true })
xhs_layout_next({ template: "简约基础" })   # waits 10–20s for template panel
xhs_inject_publish({ summary, topics })
pause   # human clicks 发布
```

## Never do

- Loop `fill` on title/body
- Type character-by-character into editors
- `click_text("一键排版")` then immediately `click_text("下一步")` (panel not ready)
- Click sidebar「发布笔记」

## QA

```bash
node scripts/qa-xhs-publish.mjs
```

Report: `%APPDATA%/sparo/diag/qa-xhs-publish-*.json`

## Why xhs_layout_next

After inject, footer only shows「暂存离开 / 一键排版」. Clicking layout opens a **template panel** (选择模板) after ~10–20s; then「下一步」appears. Skipping the wait is the #1 agent failure mode.
