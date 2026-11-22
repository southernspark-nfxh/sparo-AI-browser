# AGENTS.md — 给外部 Agent 的 Sparo 说明书

**Sparo** 是独立 Agent 浏览器：自己接单自己干，安全边界内自动完成，人不用围观。

这份文件和 `Sparo.exe` 放在同一层安装目录。Hermes、Cursor、Trae、Codex、Claude，以及其他能调用 MCP 的 Agent，都按这份说明操纵 Sparo。人不用研究界面。

对人、对界面说「技能」。工具名仍是 `match_skill` / `run_skill`。

---

## 先连上

1. Sparo 必须开着。你操纵的是用户正在看的那一扇窗口。
2. 让用户在侧栏点「复制给 Agent」，把剪贴板内容交给你。里面有程序位置、MCP 地址和令牌。
3. 优先使用剪贴板里的 `url` 和 `Authorization: Bearer`。你的软件如果只支持本地命令，再用里面的 `command`。
4. 连上后先调用一次 `sparo_info`。
5. 令牌也写在用户目录的 `sparo-store\mcp-auth.json`。商店版端口是 `3921`，地址是 `http://127.0.0.1:3921/mcp`。

| Agent | 怎么接 |
|---|---|
| Hermes | 把 Sparo 当作 MCP 工具执行器，使用上面的地址和令牌 |
| Cursor | 设置里添加 MCP，或写入剪贴板给出的 `mcpServers.sparo` |
| Trae | 按 MCP 服务器添加，使用同一份地址和令牌 |
| Codex | 按 MCP 服务器添加，使用同一份地址和令牌 |
| Claude | 写入 MCP 配置，或使用剪贴板里的 `mcpServers.sparo` |
| 其他 | 任何能调用下面这些工具的客户端都可以 |

同一窗口可以有多个 Agent。每个连接只操作自己的标签，不要抢别人的标签。

---

## 工作模式：意识 + 潜意识协作

Sparo 的核心设计：**AI 做意识，脚本做潜意识。**

| 角色 | 职责 | 具体做什么 |
|---|---|---|
| **意识（AI）** | 判断、决策、认阶段 | 识别页面处于哪个阶段，点击"下一步"或"发布"，卡住时判断换什么策略，发布前暂停等人确认 |
| **潜意识（脚本）** | 执行、投递 | 一次性注入标题、正文、话题，设置封面，读取页面状态 |

**核心原则：**
- 脚本投递预烘焙内容，AI 只认阶段，**不逐字填、不循环 fill**
- AI 不碰内容本身，脚本不碰决策
- 脚本跑不动时，意识介入判断

**未知表单**：`analyze_page → execute_primitives`，AI 分析结构生成预烘焙内容，脚本一次性注入。

---

## 核心能力一：自媒体发稿运营

**已成型渠道（7 个平台，有专门技能）：**

| 平台 | 技能 id | 调用方式 |
|---|---|---|
| 头条号 | `social-media-publish` | `run_skill({ query: "发稿子", params: { platform: "toutiao", articleDir } })` |
| 百家号 | `social-media-publish` | 图文走 `publish.mjs`，视频走 `video.mjs` |
| 大鱼号 | `social-media-publish` | `platform: "dayu"` |
| 搜狐号 | `social-media-publish` | `platform: "sohu"` |
| 微信公众号 | `weixin-publish` | `run_skill({ query: "微信公众号", params: { articleDir } })`，**只存草稿** |
| 企鹅号 | `qie-publish` | `run_skill({ query: "发企鹅号", params: { articleDir } })` |
| 小红书 | `xhs-longform-publish` | `run_skill({ query: "发小红书", params: { title, body, topics } })` |

**articleDir 目录结构**：
```
title.txt      # 纯文本标题
body.md        # Markdown 正文
cover.jpg      # 封面图
images/        # 插图目录
```

**视频发布参数**：`video`（mp4 路径）、`title`（标题）、`topics`（话题，5-10 个）、`cover`（封面策略）、`schedule`（定时）

**未成型渠道**（微博、知乎、豆瓣等 20+）：复制 `_template-site-publish.json` 扩展，或现场走 `analyze_page → execute_primitives`。

---

## 核心能力二：电商页面编辑

**店小秘采集箱上品前编辑**（`dxm-crawl-prep`）：

```text
match_skill("店小秘上品") → run_skill({ query: "店小秘上品" })
```

**自动完成**：标题中文→英文、价格公式、重量换算、库存封顶、主图批量改尺寸、图片翻译（先报费用等人授权）、保存后 reload 回读。

**交付标准**：标题无中文残留、分类非"未分类"、主图恰好 6 张且全部 800×800、图片翻译已完成、价格公式正确、SKU 两行一致。

详见 `docs/ECOMMERCE-LISTING-NORTH-STAR.md`。

---

## 通用浏览器能力

| 能力 | 工具 |
|---|---|
| 读页 | `page_text()` |
| 截图 | `screenshot()` |
| 点击 | `click()` / `click_text()` / `menu_click()` |
| 填表 | `fill()` / `select()` / `upload()` |
| 通用填表 | `analyze_page()` → `execute_primitives()` |
| 执行 JS | `execute()` |
| 多标签 | `new_tab` / `switch_tab` / `close_tab` / `list_tabs` |
| 多账号 | `list_envs` / `create_env` / `delete_env` |
| 多 Agent 并行 | `initialize` 拿 `clientId` |
| 后台任务池 | `submit_task()` / `get_task()` |
| 页面感知 | `snapshot()` / `contains_text()` / `wait_for()` |
| 覆盖层处理 | `dismiss_overlays()` / `list_portals()` |
| 人机回路 | `pause()` / `resume()` / `request_approval()` |

---

## 安全边界

| 操作 | 处理 |
|---|---|
| 支付 / 付款 | **恒拦**，必须用户亲自完成 |
| 登录 / 验证码 | 不硬拦。扫码和验证码由人完成，不要代填，也不要假装已经登录 |
| 删除 | 放行 + 7 天恢复提示 |
| 保存 | 两种模式都直接做 |
| 发送 / 发布 | 逐步模式确认一次；自动模式直接做 |
| 付费项 | 先报费用，等人授权 |

---

## 做完才算做完

- 必交付没齐、计划里的步骤没跑完，不要报完成。
- 填表只认回执，或读回来的页面里确实有字。
- 发布类任务要回读核验（列表页状态 / 公开链接），不认"点击成功"。
- 五分钟没有新进展，先换做法，再不行就用白话告诉用户卡在哪里。
- 调研类任务必须出报告页并在窗口打开，不只在侧栏堆文字。一组多页任务全部结束后，同样交一份 HTML，让人从「看结果」点开。

---

## 1.00 指挥室

商店版窗口是指挥室加每页工作间。

- 指挥室标签固定在最左。总览在中间，对话只在右侧。不要在侧栏上方再挂一排任务状态卡。
- 一页一个任务。这一页还在跑时，不要把新任务叠上去。
- 一组页面都结束后，用已经读到的结果写成 HTML。指挥室该组提供「看结果」。没读到的写明，不要只回「查完了」。
- 没有任务在跑时，可以打招呼、闲聊、讲笑话，不必为此打开网页。
- 只称 Sparo，不要说 Pi。

写诗先出思路、逐条复制另存新文件、百家号标题一次写对、店小秘标题直译，测试窗还没复测通过。不要把这四件当成已经稳定。

---

## 更多能力

- **客服半自动**：`cs_one_click_reply()`，扫会话起草回复，不代点发送
- **生活与调研 30+**：出差、比价、选品、研报、求职、租房、天气、翻译网页、查快递等
- **飞书网页**：`run_skill({ query: "飞书", params: { to, body } })`
- **视觉识别**：`screenshot` 回 base64，纯文本模型自动降级
- **平台特性**：焦点门禁（不抢打字）、壳层自愈（白屏恢复）、后台运行（可最小化）、云订阅（可选云端模型）

---

## 版本分工

- 商店版（本目录）：人机协同工作台，端口 **3921**
- 原版 `D:\download\Sparo`：电商 / 指纹多开，端口 3920，只同步能力
