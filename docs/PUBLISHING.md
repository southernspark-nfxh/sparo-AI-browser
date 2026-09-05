# Publishing with Sparo — Agent playbook

**Read this when the user asks to publish / 发帖 / 发小红书 / post content.**

Product rule: **AI detects stage and clicks; scripts deliver pre-baked content.**  
Do **not** type title/body into fields character-by-character. Do **not** loop `fill`.

---

## 0. Connect (once)

商店版：用户点 **复制给 Agent**，或：

```text
GET http://127.0.0.1:3921/health   → ok + xhs_inject_* listed
Auth: %APPDATA%/sparo-store/mcp-auth.json
Optional: GET /tools  (tool name list if tools/list looks empty)
```

Call `sparo_info` once if unsure. Then prefer skills.

---

## 1. Xiaohongshu 长文（首选）

### Fastest (one call)

```json
{
  "name": "run_skill",
  "arguments": {
    "query": "发小红书",
    "params": {
      "title": "你的标题（≤64字）",
      "body": "完整正文……",
      "summary": "可选：发布页简介",
      "topics": ["#ai", "#ai浏览器"],
      "mdPath": "C:\\\\Users\\\\…\\\\草稿.md",
      "autoPublish": false
    }
  }
}
```

Skill id: `xhs-longform-publish`（alias: 发小红书 / 小红书发布）.  
Login is assumed (human already logged in). Skill **pauses before 发布**.

### Manual atomic path (if not using run_skill)

```text
1. navigate → https://creator.xiaohongshu.com/publish/publish?target=article
2. xhs_page_stage          → expect chooser|compose|layout|publish
3. xhs_ensure_editor       → 写长文 → 新的创作 → 空白创作
4. xhs_inject_compose({ title, body, force: true })   ← 一次写完，禁止再 fill
5. xhs_layout_next({ template: "简约基础" })          ← 等模板面板 10–20s，再下一步
6. xhs_inject_publish({ summary, topics })
7. xhs_pick_cover (optional)
8. pause                  ← human clicks content-area 发布 (not sidebar 发布笔记)
```

**Do not** `click_text("一键排版")` then immediately `click_text("下一步")` — layout panel often takes 10–20s; use `xhs_layout_next`.

### Forbidden on XHS

| Don't | Do instead |
|-------|------------|
| `fill` title/body in a loop | `xhs_inject_compose` once |
| Paste into chat then type into the page | Pass `params.title` / `params.body` |
| Click 一键排版 then instantly 下一步 | `xhs_layout_next` |
| `click_text("发布")` without care | `xhs_click_publish` or human; avoid sidebar 「发布笔记」 |
| Explore homepage for minutes | Direct `target=article` URL |

### Editors (facts)

- Title: `textarea.d-text` or `input.d-text` (placeholder 输入标题; skip `.d-textarea-shadow`)  
- Body (compose): `.tiptap.ProseMirror` inside rich editor  
- Caption (publish): TipTap near 「话题」 (`0/1000`)  
- Topics: `button.topic-btn` → overlay suggestions  
- Stages: `chooser` → `compose` → `layout` (模板) → `publish`  
- On failure: `diagnose` → `%APPDATA%/sparo/diag/*.png`  
- QA: `node scripts/qa-xhs-publish.mjs`

---

## 2. Generic site publish pattern（其他网站）

Same mental model for Weibo / Notion / Feishu / any CMS:

```text
A. Bake content into params (or a skill JSON) BEFORE acting
B. navigate to the compose URL
C. stage check (page_text / snapshot / site-specific stage tool)
D. ONE inject or ONE fill per field (prefer site skill / execute helper)
E. click next / publish with exact text or bounded click
F. pause for human on irreversible submit
```

### How to add a new site skill

1. Copy `strategies/skills/_template-site-publish.json`
2. Fill `id`, `aliases`, `navigate` URL, field selectors, `params`
3. Prefer one `execute`/helper that writes all fields over multi-step `fill`
4. Save to `%APPDATA%/sparo/skills/<id>.json` (and repo `strategies/skills/`)
5. Agent discovers via `match_skill("发微博")` / `list_skills` / `sparo_info`

### Agent decision tree

```text
User: 「发小红书 / 发微博 / 发某某」
  → match_skill(query) or known id
  → if skill exists: run_skill({ query, params })  STOP inventing clicks
  → else: navigate compose URL → snapshot → ONE fill per field → pause
```

---

## 3. Skills on disk

| Path | Purpose |
|------|---------|
| `strategies/skills/xhs-longform-publish.json` | XHS long-form (inject model) |
| `strategies/skills/xhs-longform-compose.json` | Shorter compose-only (legacy; prefer publish skill) |
| `strategies/skills/_template-site-publish.json` | Template for other sites |
| `%APPDATA%/sparo/skills/*.json` | Runtime catalog for `list_skills` / `run_skill` |

---

## 4. Related docs

- `AGENTS.md` — boot + anti-patterns  
- `docs/MCP-API.md` — tool reference  
- `docs/AGENTS.md` — MCP connection  
- `llms.txt` — index for LLM crawlers  
