# Customer service · 半自动客服（任意站点）

Tools:

- `cs_scan` — detect chat-like UI, extract messages, find composer（不发送）
- `cs_draft_reply` — intent → draft（LLM 或模板）→ **fill composer only**

```text
cs_scan
cs_draft_reply({ fill: true })
# human clicks 发送 on the page
```

Or:

```text
run_skill({ query: "客服回复" })
```

**Never** auto-click Send. Pause stops CS actions.

Sidebar: 「扫描会话」「生成并填入」.

Hermes: [`HERMES-PLAYBOOK.md`](./HERMES-PLAYBOOK.md).
