# Hermes × Sparo Playbook

把本文件内容**整段或摘要**写入 Hermes 系统提示 / 工作区规则。Sparo 是「手」，Hermes 是「脑」。

## 连接

1. 启动 Sparo（`npm run ensure`）
2. 读 `%APPDATA%/sparo/mcp-auth.json` → MCP `endpoint` + Bearer `token`
3. 先调 `sparo_info` 看 fast_path 与 skills

## 决策树（必须遵守）

```text
用户目标
 ├─ 发小红书 / 长文发布     → run_skill({ query: "发小红书", params:{ title, body, topics? } })
 │                            禁止 fill 循环；禁止跳过 xhs_*
 ├─ 多字段 / 未知表单填报   → run_skill({ query: "通用填表", params:{ payload:{ 标签:值, … } } })
 │                            或 analyze_page → execute_primitives({ payload })
 ├─ 单点点击 / 导航         → navigate / click_text / wait_for
 ├─ 客服回复（半自动）      → cs_draft_reply / run_skill 客服回复（填草稿，人点发送）
 └─ 读页摘要 / 情报分析     → page_text / snapshot → 你本地推理（后续 research_*）
```

## 通用填表（重点）

**错误**：`snapshot` → 多次 `fill` / `click` 试错。  
**正确**：

```json
{
  "name": "run_skill",
  "arguments": {
    "query": "通用填表",
    "params": {
      "payload": {
        "标题": "……",
        "正文": "……",
        "搜索": "关键词"
      }
    }
  }
}
```

或：

```text
analyze_page
execute_primitives({ payload: { … } })
```

标签用页面上的中文名（或 placeholder）。必填字段看 `analyze_page` 的 `required_fields`。

## 客服（半自动 · 全站）

任意打开的客服/聊天页：

```text
cs_scan
cs_draft_reply()          # 填入输入框；绝不自动点发送
# 或 run_skill({ query: "客服回复" })
```

1. 工具读最近对话并分类动机（询价/砍价/售后…）  
2. 有 Model Key 时用 LLM 写草稿，否则用模板  
3. 草稿填入页面输入框  
4. **人在页面上点「发送」**（Sparo / Hermes 不得代点发送）

侧栏也有「扫描会话 / 生成并填入」按钮。

## 红线

- Pause 后停止一切自动操作  
- 发帖 / 付款 / 客服发送：默认人确认  
- 验证码 / 登录墙：`pause` 并告知人

## 自检

```text
sparo_info → 是否提到 通用填表 / analyze_page？
match_skill({ query: "自动填表" }) → 应命中 universal-form-fill
```
