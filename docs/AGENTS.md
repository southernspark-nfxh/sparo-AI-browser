# Connect an AI agent to Sparo · 连接 AI Agent（商店版）

**Sparo** — *会动手的 AI 浏览器。发送前你确认。*  
Sparo 是「手」。你的 Agent 是「脑」。操纵的是用户正在看的那一扇窗。

卖点与痛点：[PRODUCT.md](./PRODUCT.md) · 密钥：[API-KEYS.md](./API-KEYS.md) · 云订阅：[CLOUD-SUBSCRIPTION.md](./CLOUD-SUBSCRIPTION.md)

## Setup · 配置

**给使用者：** Sparo 开着 → 点侧栏 **复制给 Agent** → 把剪贴板发给 Agent。不要让用户去翻端口和 Token 文件。安装包和便携版复制的都是真实程序位置。

**给开发 / 已会配 MCP 的 Agent：**

1. 打开商店版 Sparo（安装包、便携版，或本目录 `npm run start`）  
2. 连接信息在 `%APPDATA%\sparo-store\mcp-auth.json`（端口 **3921**，不是原版 3920）  
3. 用 `endpoint` + Bearer `token`

```powershell
$auth = Get-Content "$env:APPDATA\sparo-store\mcp-auth.json" | ConvertFrom-Json
# MCP URL: $auth.endpoint
# Header: Authorization: Bearer <token>
```

## Compatible agents · 可用 Agent

| Agent | Notes · 说明 |
|---|---|
| OpenClaw | MCP browser backend |
| Hermes | Tool actuator over MCP |
| Workbuddy | MCP host |
| Codex / Cursor / Claude Code | Add Sparo as MCP server |
| Custom | Any client that can call navigate / snapshot / click / fill |

## Typical loop · 典型闭环

1. User states a goal · 用户提出目标  
2. Agent plans and calls Sparo tools · Agent 规划并调用工具  
3. Human watches the shared window; Pause / Approval when needed · 人围观同窗；必要时暂停/审批  

### Publishing · 发帖 / 发小红书

**AI detects stage; scripts inject content once.** Do not loop `fill`.

```text
run_skill({ query: "发小红书", params: { title, body, topics } })
# or: xhs_ensure_editor → xhs_inject_compose → … → xhs_inject_publish → pause
```

Full playbook: [`PUBLISHING.md`](./PUBLISHING.md)  
Universal forms: [`UNIVERSAL-ANALYZER.md`](./UNIVERSAL-ANALYZER.md) · Hermes: [`HERMES-PLAYBOOK.md`](./HERMES-PLAYBOOK.md)  
Living taskbook: [`PRODUCT-TASKBOOK.md`](./PRODUCT-TASKBOOK.md)  
Full tool list: [`MCP-API.md`](./MCP-API.md)  
Skills: [`../strategies/skills/README.md`](../strategies/skills/README.md)

### Life query · 一句话出行 / 打开站点 + 后半句

侧栏原句即可。不要只打开首页、不要在城市弹层空点。读页用 `page_text`。

```text
打开百度，搜今天北京天气
在携程查9月15日伊斯坦布尔的酒店
打开 https://www.gov.cn 用中文告诉我这是什么网站
```

### Forms · 通用填表

```text
run_skill({ query: "通用填表", params: { payload: { 标题, 正文, … } } })
# or: analyze_page → execute_primitives({ payload })
```

Do **not** loop `fill` on multi-field pages.

### Life query · 一句话出行 / 读页

```text
打开百度，搜今天北京天气          # 打开 + 后半句整句执行，不要只 navigate 首页
在携程查9月15日伊斯坦布尔的酒店   # 解析城市+日期，打开结果页 URL
这是什么网站 / 读这一页           # page_text，不要用 snapshot 当正文
```

用户点名途牛 / Booking / Airbnb 就去该站。不要在热门城市弹层空点。  
比价 / 周末安排：不要直开京东、淘宝、点评。出差和调研会出手册。  
左上角只剩半截导航：网页没铺满页面洞，见 [ARCHITECTURE.md](./ARCHITECTURE.md)。  
现行任务与 QA：[PRODUCT-TASKBOOK.md](./PRODUCT-TASKBOOK.md) v0.3.5。  
云端模型：侧栏设置「自己的 Key / 云端模型」；一句对话一个任务。见 [CLOUD-SUBSCRIPTION.md](./CLOUD-SUBSCRIPTION.md)。不要把云端 Key 写进客户端。

### Customer service · 客服半自动

```text
cs_draft_reply()   # or run_skill query 客服回复 — fills draft only
```

See [`CUSTOMER-SERVICE.md`](./CUSTOMER-SERVICE.md).
