# Hermes × Sparo Playbook

把本文件内容**整段或摘要**写入 Hermes 系统提示 / 工作区规则。Sparo 是「手」，Hermes 是「脑」。商店版定位见 [PRODUCT.md](./PRODUCT.md)。

## 连接

1. 商店版 Sparo 保持开着（安装包 / 便携版 / `npm run start`）
2. 优先：用户点侧栏 **复制给 Agent**，把剪贴板贴给你
3. 或读 `%APPDATA%/sparo-store/mcp-auth.json` → MCP `endpoint` + Bearer `token`（端口 **3921**）
4. 先调 `sparo_info` 看 fast_path 与 skills

## 决策树（必须遵守）

```text
用户目标
 ├─ 一句话出行 / 生活查询  → 侧栏原句即可（打开站点 + 后半句整句执行）
 │                            酒店/机票/火车/路线：解析城市+日期，打开结果页 URL
 │                            禁止在热门城市 / 日期弹层循环空点
 │                            用户点名哪个站就去哪个站（途牛/Booking/Airbnb 不要抢走携程）
 │                            读结果用 page_text，不要用 snapshot 当正文
 │                            多段行程（出发+回国+多城+机票酒店）：拆步骤查，禁止高德跨国驾车
 │                            机票禁止停在 /online/channel
 ├─ 日常多步（比价/调研/挂号/租房/选课/文献/物流）
 │                            → 结果页 + 手册；禁止直开京东/淘宝/点评（会卡窗）
 │                            付钱、投递、挂号提交由人点
 ├─ 打开站点 + 后半句      → leftoverAfterOpen：先打开，再把「搜… / 查…」整句当新目标
 ├─ 这是什么网站 / 读这一页 → page_text（用户中文问则中文答）
 ├─ 发小红书 / 长文发布     → run_skill({ query: "发小红书", params:{ title, body, topics? } })
 │                            禁止 fill 循环；禁止跳过 xhs_*
 ├─ 多字段 / 未知表单填报   → run_skill({ query: "通用填表", params:{ payload:{ 标签:值, … } } })
 │                            或 analyze_page → execute_primitives({ payload })
 │                            日历/End time → pick_calendar；禁止 fill 日期字符串，禁止 click_text 「3」
 ├─ 单点点击 / 导航         → navigate / click_text / wait_for
 ├─ 飞书网页（聊天/日志）   → feishu_work / run_skill query 飞书（一次注入草稿，禁止循环 fill）
 │                            打开 /next/messenger，不是官网；登录墙 pause；发送由人点
 ├─ 客服回复（半自动）      → cs_one_click_reply / run_skill 一键回复（填草稿，人点发送）
 └─ 读页摘要 / 情报分析     → page_text / snapshot → 你本地推理
```

现行任务、QA、待办：[PRODUCT-TASKBOOK.md](./PRODUCT-TASKBOOK.md) v0.3.5。结构：[ARCHITECTURE.md](./ARCHITECTURE.md)。云订阅：[CLOUD-SUBSCRIPTION.md](./CLOUD-SUBSCRIPTION.md)。网页必须铺满 `#pageHole`。飞书网页走 `feishu_work`，禁止循环 fill，禁止代点发送。云端模型只在商店版，不要按 HTTP 次数扣「任务」。

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

自定义日历（X Ads End time 显示 Run indefinitely）：`pick_calendar({ date:"2026-09-03", hours:"00", minutes:"59" })` 或 payload `"End time": "2026-09-03 00:59"`。点 **Next month** 的 aria-label，不要点 `<`。时、分两个格子分开填。弹层点外面才能提交。不要点页面上的 Next / Save draft / 付款。

## 客服（半自动 · 全站）

任意打开的客服/聊天页或评论区：

```text
cs_one_click_reply()      # 扫描 + 模型起草 + 填入；绝不自动点发送
# 或 run_skill({ query: "一键回复" })
```

1. 工具读最近对话或留言并分类动机  
2. 有 Model Key 时用 LLM 写草稿，否则用模板  
3. 草稿填入页面输入框  
4. **人在页面上点「发送 / 发布」**（Sparo / Hermes 不得代点发送）

地址栏和侧栏都有「一键回复」按钮。

## 红线

- Pause 后停止一切自动操作  
- 发帖 / 付款 / 客服发送：默认人确认  
- 验证码 / 登录墙：`pause` 并告知人

## 自检

```text
sparo_info → 是否提到 通用填表 / analyze_page？
match_skill({ query: "自动填表" }) → 应命中 universal-form-fill
```
