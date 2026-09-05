# Customer service · 一键回复（半自动）

任意打开的聊天页或评论/留言区。产品规则：AI 起草并填入，**不替你点发送**。见 [PRODUCT.md](./PRODUCT.md)。

## 人怎么用

1. 侧栏保存 Model Key（DeepSeek / OpenAI / 兼容接口）。没 Key 时用模板草稿。
2. 打开有输入框的页面（客服会话、帖子评论等）。
3. 点地址栏或侧栏 **一键回复**。
4. Sparo 扫描当前页 → 按上下文起草 → **填进输入框**。
5. **你自己点页面上的发送 / 发布。** Sparo 不会自动发出。

也可：侧栏「只扫描」先看它认没认出会话。

## Agent / MCP

```text
cs_one_click_reply()
# 等价：cs_scan → cs_draft_reply({ fill: true, preferLlm: true })
# human clicks 发送 on the page
```

或 `run_skill({ query: "一键回复" })`。

**Never** auto-click Send / 发布. Pause 拦住的是 Agent 循环；人点的一键回复仍可执行。

Hermes: [`HERMES-PLAYBOOK.md`](./HERMES-PLAYBOOK.md).
