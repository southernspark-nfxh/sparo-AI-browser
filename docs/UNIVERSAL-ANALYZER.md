# Universal analyzer — Agent notes

Tools:

- `analyze_page` — stamp refs + classify fields/buttons/date pickers + required (红星)
- `execute_primitives({ payload })` — fuzzy-match labels → fill/click/upload/pick_calendar + mini-QA
- `pick_calendar({ date, hours, minutes })` — custom calendar + hour:minute popover (X Ads End time). Not a text `fill`.
- Strategy cache: `%APPDATA%/sparo/strategy-cache.json`

Date pickers that show **Run indefinitely** or a formatted date are `date_picker_button`. Do not type `"Sep 3, 2026"` into them. After open: click **Next month** (aria-label), then the in-month gridcell, then hours and minutes as two spinboxes (`00` and `59`), then click outside so the trigger commits.

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

**不是填表时别走本闭环：**

- 读这一页 / 这是什么网站 → `page_text`
- 一句话订酒店 / 机票 / 火车 / 路线 → 侧栏原句（结果页 URL），不要 `analyze_page` 去点城市弹层

详见 [`PRODUCT-TASKBOOK.md`](./PRODUCT-TASKBOOK.md)。

**不是填表时别走本闭环：**

- 读这一页 / 这是什么网站 → `page_text`
- 一句话订酒店 / 机票 / 火车 / 路线 → 侧栏原句（结果页 URL），不要 `analyze_page` 去点城市弹层

详见 [`PRODUCT-TASKBOOK.md`](./PRODUCT-TASKBOOK.md)。
