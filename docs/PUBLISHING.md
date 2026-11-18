# Publishing with Sparo — Agent playbook

**Read this when the user asks to publish / 发帖 / 发小红书 / post content.**

Product rule: **AI detects stage and clicks; scripts deliver pre-baked content.**  
Do **not** type title/body into fields character-by-character. Do **not** loop `fill`.

详细工作模式（意识+潜意识协作）、平台清单、调用方式见 [AGENTS.md](./AGENTS.md)。

## 发布权限（2026-10-27）

当句是否自动点发送，由模型在理解结果的 `autoSend` 里判定。本地不扫原话抢答。

- 用户当句说「自动发 / 直接发 / 帮我发出去」→ `autoSend: true`，可以点发送。发完就关单。
- 用户没说 → `autoSend: false`，只把内容填进发布框，侧栏告诉人自己点发送。
- 「发一下」「帮我写一条」都不算授权。
- 支付、登录、验证码永远不代点，跟 `autoSend` 无关。

---

## 多账号（2026-11-12）

同一个站点可以同时登录多个号。要发到指定账号：先 `list_envs` 拿 `envId`，再

```text
run_skill({ query: "发百家号", params: { envId, title, body } })
```

环境标签会认领给当前 client，后续填标题、插图、封面都停在这个号里。不传 `envId` 用默认登录态。一个号一个环境，不要把两个号挤在同一标签里换登录。细节见 [MULTI-ACCOUNT.md](./MULTI-ACCOUNT.md)。

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

## 4. 自媒体一稿多发 / 微信公众号 / 企鹅号（2026-11-17 补）

技能随安装包分发（`app.asar` 内 `strategies/skills/**`，首启按版本号播种到配置目录）；发布脚本另有可读副本 `resources/social-publish-scripts/` 与 `resources/platforms/`。

| 技能 | 平台 | 边界 |
|---|---|---|
| `social-media-publish`（种子 v3） | 头条 / 百家号 / 大鱼号 / 搜狐号图文 + 百家号视频 | 后台填稿 → 插图 → 封面 → 发布 → 回读核验；dry-run 不点提交；视频只发「图一乐研究所」环境，三次账号名硬门 |
| `weixin-publish`（种子 v1） | 微信公众号 | **只存草稿**；群发发表由人点；定时发布、正文插图未接入。默认 docx 导入正文 + 统一排版（正文 15px/1.75、H2 主色竖条、引用浅灰底、图片整宽圆角） |
| `qie-publish`（目录技能） | 企鹅号 om.qq.com | docx 导入 → 标题 → 分类 → 标签 ≥5 → 内容自主声明 → 存草稿 / 发布 → 双核验 |

```text
run_skill({ query: "一稿多发", params: { platform: "toutiao", articleDir: "D:\\articles\\x", envId? } })
run_skill({ query: "微信公众号发布", params: { articleDir: "D:\\articles\\x", theme?, images?, noDocx?, docxImport?, env? } })
```

- `articleDir` 里要有 `title.txt`、`body.md`，建议 `cover.jpg` 与 `images/`。
- 指定账号：`params.envId`（或 CLI `--env <envId>`）；不传 = 默认登录态。环境 / 账号名硬门见 [MULTI-ACCOUNT.md](./MULTI-ACCOUNT.md)。
- **侧栏发稿链路（0.7.4）**：说「帮我发稿子」缺平台或目录时先追问，不开发布页；槽齐自动拼 params，微信走 `weixin-publish`、其余四站走 `social-media-publish`。
- CLI 调试（Node ≥20，Sparo 开着）：`node publish.mjs --platform <id> --probe`（期望 `PROBE_OK`，未登录停在登录门并如实报告）、`node publish.mjs --self-check`、`node video.mjs --self-check`（均期望 `SELF_CHECK_OK`）。
- 未登录时脚本停在登录门、侧栏说人话交人扫码，不假装发出去；公众号存草稿成功报「已存草稿」，不报「已群发」。

## 5. Related docs

- `AGENTS.md` — boot + anti-patterns  
- `docs/MCP-API.md` — tool reference  
- `docs/AGENTS.md` — MCP connection  
- `llms.txt` — index for LLM crawlers  
