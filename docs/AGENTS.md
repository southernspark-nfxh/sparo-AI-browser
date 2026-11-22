# Sparo · 独立 Agent 浏览器 + Agent 可操纵的浏览器

Sparo 有两个定位，缺一不可：

1. **自己就是能独立完成任务的 Agent**：接单、规划、动手、验收、关单，人不用围观，不用逐步点头。可以最小化后台跑，不抢屏幕、不抢键盘。
2. **为 Agent 设计的浏览器**：任何 Agent（Cursor、Trae、Codex、Hermes、OpenClaw、Workbuddy、自定义）通过 MCP 操纵它，用它的窗口完成自己的任务。

---

## 工作模式：意识 + 潜意识协作

Sparo 的核心设计：**AI 做意识，脚本做潜意识。**

| 角色 | 职责 | 具体做什么 |
|---|---|---|
| **意识（AI）** | 判断、决策、认阶段 | 识别页面处于哪个阶段（选择器 / 编辑器 / 发布页），点击"下一步"或"发布"，卡住时判断该换什么策略，发布前暂停等人确认 |
| **潜意识（脚本）** | 执行、投递 | 一次性注入标题、正文、话题，设置封面，读取页面状态 |

**核心原则：**
- 脚本投递预烘焙内容，AI 只认阶段，**不逐字填、不循环 fill**
- AI 不碰内容本身（标题正文太长，AI 逐字打又慢又容易丢字）
- 脚本不碰决策（点不点发布、走哪条路，AI 判断）
- 脚本跑不动时，意识介入判断（页面变了、表单找不到、需要换策略）

**反模式（绝对不要）：**
- ❌ 循环 `fill` 逐字打标题正文
- ❌ AI 自己拼一段段往输入框塞
- ❌ 脚本替 AI 做决策（点不点发布脚本不碰）

**未知表单（没有现成技能时）：**
走 `analyze_page → execute_primitives`：AI 分析页面结构，生成预烘焙内容，脚本一次性注入。

**这就是为什么 skill 里都有 `productModel.ai` 和 `productModel.script` 两个字段：**
```json
"productModel": {
  "ai": ["detect stage", "click next/publish", "pause"],
  "script": ["ensure editor", "inject content once"],
  "forbid": ["loop fill", "character-by-character typing"]
}
```

---

## 核心能力一：自媒体发稿运营

**这是 Sparo 最成熟的能力。** 从草稿到发布，一条命令完成，不需要人逐步指导。

### 已成型渠道（7 个平台，有专门技能）

| 平台 | 技能 id | 内容形式 | 一句话说明 |
|---|---|---|---|
| 头条号 | `social-media-publish` | 图文 | 后台填稿→插图→封面→发布→回读核验 |
| 百家号 | `social-media-publish` | **图文 + 视频** | 图文走 `publish.mjs`，视频走 `video.mjs`，视频只发「图一乐研究所」 |
| 大鱼号 | `social-media-publish` | 图文 | |
| 搜狐号 | `social-media-publish` | 图文 | |
| 微信公众号 | `weixin-publish` | 图文 | **只存草稿**，群发由人点；Word 导入 + 统一排版 |
| 企鹅号 | `qie-publish` | 图文 | docx 导入→标题→分类→标签→存草稿/发布→双核验 |
| 小红书 | `xhs-longform-publish` | 长文 | 注入标题正文→排版→话题→暂停 |

### 调用方式（照抄即可）

```text
# 发头条 / 百家号 / 大鱼号 / 搜狐号（同一技能，platform 参数区分）
run_skill({ query: "发稿子", params: { platform: "toutiao", articleDir: "D:\\articles\\x" } })
run_skill({ query: "发稿子", params: { platform: "baijiahao", articleDir: "D:\\articles\\x" } })

# 微信公众号（只存草稿）
run_skill({ query: "微信公众号", params: { articleDir: "D:\\articles\\x" } })

# 小红书
run_skill({ query: "发小红书", params: { title: "标题", body: "正文", topics: ["#ai"] } })

# 企鹅号
run_skill({ query: "发企鹅号", params: { articleDir: "D:\\articles\\x" } })

# 百家号视频（走 video.mjs，不是 publish.mjs）
run_skill({ query: "发百家号视频", params: { video: "D:\\videos\\x.mp4", title: "标题", topics: "搞笑,沙雕,名场面" } })
```

**articleDir 目录结构（图文）**：
```
D:\articles\x\
  title.txt      # 纯文本标题
  body.md        # Markdown 正文
  cover.jpg      # 封面图（建议有）
  images\        # 插图目录（建议有）
```

**视频发布参数**：
- `video`：mp4 文件路径（必须）
- `title`：视频标题（必须）
- `topics`：话题，逗号分隔，5-10 个，标题+话题 ≤50 字
- `cover`：封面策略，`auto`（默认，有自动封面就保留）/ `always`（强制重传）/ `never`（不碰封面）
- `schedule`：定时发布时间，格式 `"YYYY-MM-DD HH:mm"`
- `account`：指定账号昵称，默认「图一乐研究所」

### 工作流（Agent 拿到"发头条"后该干什么）

```
1. 用户说"发头条" / "帮我发稿子"
   ↓
2. match_skill("发头条") → 命中 social-media-publish
   ↓
3. 检查参数：platform 和 articleDir 齐不齐？
   - 缺 platform → 问"发哪个平台？"
   - 缺 articleDir → 问"稿件目录在哪？"（用户可以直接把标题正文贴进对话，不一定有目录）
   - 用户已贴正文 → 走通用填稿，不再要目录
   ↓
4. run_skill({ query: "发稿子", params: { platform, articleDir } })
   ↓
5. 等回执。回执里会告诉你：
   - 成功：已发布 / 已存草稿，列表页状态 / 公开链接 / 图片数
   - 失败：卡在哪一步（未登录 / 验证码 / 表单没找到）
   ↓
6. 核验：不认"点击成功"，要看到列表页状态或公开链接
   ↓
7. 汇报：告诉用户"已发布到头条，链接是 xxx" 或 "已存草稿，群发需你点"
```

### 工作流（Agent 拿到"发百家号视频"后该干什么）

```
1. 用户说"发百家号视频" / "帮我发个视频"
   ↓
2. match_skill("发百家号视频") → 命中 social-media-publish（视频走 video.mjs）
   ↓
3. 检查参数：video 和 title 齐不齐？
   - 缺 video → 问"视频文件在哪？"
   - 缺 title → 问"视频标题是什么？"
   - topics 没给 → 问"加什么话题？"（5-10 个，标题+话题 ≤50 字）
   ↓
4. run_skill({ query: "发百家号视频", params: { video, title, topics } })
   ↓
5. 视频流程自动执行：
   - 上传视频（等进度完成）
   - 核对账号（传前、传后、发布前各一次，不是「图一乐研究所」就停）
   - 填标题（Lexical 编辑器，整段替换）
   - 加话题（打 # → 等联想 → 点选，5-10 个）
   - 设封面（有自动封面就保留，没有才上传）
   - 创作声明选「无需声明」
   - 发布或定时发布
   ↓
6. 核验：去列表页读回标题和状态（已发布 / 定时发布 / 审核中）
   ↓
7. 汇报：告诉用户"已发布到百家号，链接是 xxx" 或 "已定时，预计 xx 发布"
```

### 未成型渠道（也能发）

微博、知乎、豆瓣、CSDN、掘金、简书、B 站专栏、贴吧、网易号、快手、抖音、视频号、Twitter/X、Facebook、LinkedIn、Reddit、Medium、Notion、飞书文档、语雀、GitHub Pages、WordPress、Typecho、Ghost、Substack……

**任何有发布框的网页都能发。** 两种方式：

1. **快速扩展**：复制 `strategies/skills/_template-site-publish.json`，填上站点 URL 和字段选择器，存成新技能。下次 `match_skill("发微博")` 直接命中。
2. **现场通用**：没有现成技能时，走 `analyze_page → execute_primitives` 现场分析页面结构，一次性注入标题/正文/话题，点发布。不需要预先写技能。

### 多账号发布

同一平台多个号同时登，独立 partition，不是切登录态。

```text
list_envs() → 拿到 envId
run_skill({ query: "发稿子", params: { platform: "toutiao", articleDir: "...", envId: "xxx" } })
```

不传 `envId` 用默认登录态。

---

## 核心能力二：电商页面编辑

**这是 Sparo 第二个核心能力。** 从 1688 采集来的商品，自动编辑到合格标准，保存后回读核验。

### 店小秘采集箱上品前编辑

技能 id：`dxm-crawl-prep`

**自动完成的事**：
- 标题中文→英文（直译，不用付费一键翻译）
- 价格按公式 `(成本+5)×1.02÷0.413` 计算，币种 CNY
- 包装重量按千克换算（g→kg，50g→0.05）
- 库存封顶 2000
- 主图批量改尺寸（短边 800）
- 图片翻译成英文（**要扣秘豆，先报费用等人授权**）
- 保存后 reload 回读 6 项核验

### 调用方式

```text
# 方式一：技能调用
match_skill("店小秘上品") → 命中 dxm-crawl-prep
run_skill({ query: "店小秘上品" })

# 方式二：直接说需求
"帮我把店小秘采集箱里这条商品编辑一下"
→ Agent 会自动 match_skill("店小秘上品")，拿到路线后执行
```

### 工作流（Agent 拿到"店小秘上品"后该干什么）

```
1. 用户说"店小秘上品" / "编辑采集箱商品"
   ↓
2. match_skill("店小秘上品") → 拿到 dxm-crawl-prep 路线
   ↓
3. 打开店小秘采集箱（https://www.dianxiaomi.com/web/productCrawl）
   ↓
4. 找一条中文商品，点编辑
   ↓
5. 按路线执行：
   - 读原标题（中文）→ 直译成英文填入
   - 读 1688 来源页，拿成本价 → 按公式算零售价填入
   - 读重量（50g）→ 换算成 0.05kg 填入
   - 读库存 → 封顶 2000 填入
   - 主图：编辑图片 → 批量改尺寸 → 短边 800 → 生成 JPG
   - 图片翻译：报费用（如"16 张预计 80 秘豆"）→ 等人授权 → 提交 → 等完成
   ↓
6. 保存（只点"保存"，不点"保存并认领"）
   ↓
7. reload 回读 6 项：标题、重量、库存、变种行数、主图尺寸、分类
   ↓
8. 对照交付标准核验：
   - 标题无中文残留（/[\u4e00-\u9fa5]/ 不命中）
   - 分类非"未分类"
   - 主图恰好 6 张且全部 800×800
   - 图片翻译已完成（不是"已提交"）
   - 价格公式正确
   - SKU 两行一致
   ↓
9. 汇报：告诉用户"已编辑完成，保存成功，6 项回读全过" 或 "卡在哪一步"
```

### 交付标准（必须全过才算完成）

见 [`ECOMMERCE-LISTING-NORTH-STAR.md`](./ECOMMERCE-LISTING-NORTH-STAR.md) §3。核心判据：

| 项 | 判据 |
|---|---|
| 标题 | 纯英文，无中文残留（`/[\u4e00-\u9fa5]/` 不命中），≤128 字符 |
| 分类 | 已选，非「未分类」 |
| 主图 | 恰好 6 张，全部 800×800 |
| 图片翻译 | 6 张主图 + 全部 SKU 颜色图都译成英文，**保存前必须读到完成状态** |
| 价格 | `(成本+5)×1.02÷0.413`，币种 CNY，保留 2 位 |
| 库存 | ≥1 且 ≤2000 |
| 重量 | 先读基线单位，g→kg 换算 |
| SKU 两行一致 | 零售价/货值/库存/重量/编码完全一致 |
| 属性 | 无汉字残留 |

### 速卖通编辑页

技能 id：`dxm-smt-editor-ops` / `dxm-smt-listing`。编辑、上架、保存前核对。

---

## 通用浏览器能力（地基）

这些是底层能力，支撑上面两大核心，也支撑任何其他任务：

| 能力 | 工具 | 说明 |
|---|---|---|
| 读页 | `page_text()` | 读可见正文，不要用 snapshot 当正文 |
| 截图 | `screenshot()` | 回 base64，支持视觉模型 |
| 点击 | `click()` / `click_text()` / `menu_click()` | trusted mouse click |
| 填表 | `fill()` / `select()` / `upload()` | 一次性注入，不逐字循环 |
| 通用填表 | `analyze_page()` → `execute_primitives()` | 任意站点任意表单 |
| 执行 JS | `execute()` | 在页面里跑脚本 |
| 多标签 | `new_tab` / `switch_tab` / `close_tab` / `list_tabs` / `discard_inactive_tabs()` | |
| 多账号 | `list_envs` / `create_env` / `delete_env` | 独立 partition |
| 多 Agent 并行 | `initialize` 拿 `clientId` | 各 client 操作落在自己的标签上 |
| 后台任务池 | `submit_task()` / `get_task()` | 全局最多 3 个同时跑，满了排队 |
| 页面感知 | `snapshot()` / `contains_text()` / `wait_for()` | |
| 覆盖层处理 | `dismiss_overlays()` / `list_portals()` | 关弹窗、列菜单 |
| 人机回路 | `pause()` / `resume()` / `request_approval()` | 暂停/恢复/请求批准 |
| 素材库 | 内置 | 网页图片/截图存本机并记来源 |
| 报告页 | 内置 | 多步调研最终形成 HTML 报告页并在窗口打开 |
| 诊断 | `diagnose()` | 页面诊断，截图存素材库 |
| 其他 | `press()` / `pick_calendar()` / `fill_suggest()` / `ensure_render()` / `sparo_info()` | 按键/日历/建议填充/渲染/信息 |

---

## 更多能力

### 客服半自动

扫会话起草回复，填进输入框，**不代点发送**。

```text
cs_one_click_reply()
# 或 run_skill({ query: "一键回复" })
```

### 生活与调研（30+ 技能）

出差、比价、选品、研报、求职、租房、天气、翻译网页、查快递、电影票、本周展览、在线课程、日本自由行、泰国自由行、家电清单、打卡地、官方下载、宠物智能硬件、宠物经济、远程办公工具、SaaS 竞品、技术选型、自媒体运营、学术论文、重疾险、供应链 BOM、微博热搜、跨境选品、AI 浏览器竞品、AI 写作竞品。

```text
run_skill({ query: "比价", params: { query: "索尼WH-1000XM5" } })
run_skill({ query: "出差", params: { date, checkin, checkout, area } })
```

### 飞书网页

`feishu-web-work`：打开消息页，注入聊天或日志草稿，不点发送。

```text
run_skill({ query: "飞书", params: { to: "张三", body: "消息内容" } })
# 或 feishu_work({ to, body })
```

### 视觉识别

侧栏粘贴/拖图，`screenshot` 回 base64。纯文本模型自动降级省略附图。

### 平台特性

| 特性 | 说明 |
|---|---|
| **焦点门禁** | 人在打字时，Agent 的点击会让开（1 秒 × 5 次后报"活人正在打字"取消），填表不拉走光标 |
| **壳层自愈** | 白屏自动恢复：先重绘，不行就重启渲染进程 |
| **后台运行** | 可最小化后台跑，不抢屏幕、不抢键盘 |
| **云订阅** | 可选云端模型（DeepSeek / 通义 / 智谱等），Key 不下发本机 |
| **多窗口** | 一个 client 一个标签，多 Agent 并行不互相干扰 |
| **QA 工具** | `qa_check()` / `qa_gate()`，店小秘专用 QA 检查 |
| **工作流** | `list_workflows()` / `run_workflow(id)`，需要 `SPARO_ENABLE_DXM=1` |

---

## 连接方式

**给使用者**：Sparo 开着 → 侧栏点「复制给 Agent」→ 把剪贴板发给 Agent。

**给 Agent / 开发**：

```powershell
$auth = Get-Content "$env:APPDATA\sparo-store\mcp-auth.json" | ConvertFrom-Json
# endpoint + Authorization: Bearer <token>
# 先 initialize 拿 clientId，之后所有请求头带 x-sparo-client: <clientId>
```

端口 **3921**（商店版），不是原版 3920。

---

## 安全边界

| 操作 | 处理 |
|---|---|
| 支付 / 付款 | **恒拦**，必须用户亲自完成 |
| 登录 / 验证码 | 不硬拦。扫码和验证码由人完成，不要代填，也不要假装已经登录 |
| 删除 | 放行 + 7 天恢复提示 |
| 保存 | 两种模式都直接做 |
| 发送 / 发布 | 逐步模式确认一次；自动模式直接做 |
| 保存并认领 / 保存并发布 | 两种模式都确认一次 |
| 付费项（店小秘图片翻译、图片白底） | 先报费用，等人授权 |
| 下载 / 跑 exe / 子进程 | 禁止（技能本身需要的除外，如发布脚本） |
| 别的账号 Cookie | 禁止跨环境读取 |

---

## 审核标准

### 发布类任务

- 后台填稿 → 插图 → 封面 → 发布/存草稿 → **回读核验**（列表页状态 / 公开链接 / 图片数），不认"点击成功"
- 头条必勾「投放广告赚收益」；百家绝不勾「AI 生成」
- 微信公众号返回 `DRAFT_SAVED_ONLY` 时报「已存草稿」，不报「已群发」
- 未登录停在登录门，交人扫码，不假装发出去

### 店小秘上品

见上方「核心能力二 → 交付标准」。

### 调研类任务

多种信息调研（比价、选品、研报、对比）最终必须形成**报告页并在窗口打开**，不只在侧栏堆文字。同一组多页任务全部结束后，也要交一份 HTML：指挥室该组出现「看结果」，侧栏给出路径。点开才能看到各页结果。不要只留一句「有页面异常」。

---

## 1.00 指挥室（2026-11-22 测试窗，未进安装包）

人打开的是指挥室加每页工作间，不是只有一条侧栏。

- 指挥室标签固定在最左，不跟着别的标签拖走。中间是各页总览，对话只在右侧。侧栏上方不再挂任务状态条。
- 一页同时只有一个任务。这一页还在进行时，新的一句不叠上去，先停掉或等它做完。
- 从指挥室派出去的一组任务，全部结束之后写成 HTML。组上点「看结果」打开。各页没读到的内容要写明，不把失败说成全部完成。
- 没在执行任务时可以打招呼、讲笑话、闲聊，不必为了闲聊去开网页。任务还在跑时，闲聊会被挡住。
- 对自己只称 Sparo。不要说 Pi、Pi Agent。

这些规则已在测试窗代码里。窗口复测仍未过的：写诗先出思路、逐条另存第二份文件、百家号标题一次写对、店小秘标题直译。见 [WORKLOG-2026-11-22-COMMAND-ROOM-QA.md](./WORKLOG-2026-11-22-COMMAND-ROOM-QA.md)。

---

## 必读索引

| 文档 | 内容 |
|---|---|
| [PRODUCT.md](./PRODUCT.md) | 产品定位 |
| [MCP-API.md](./MCP-API.md) | 81 个工具完整列表 |
| [PUBLISHING.md](./PUBLISHING.md) | 多平台发布完整手册 |
| [ECOMMERCE-LISTING-NORTH-STAR.md](./ECOMMERCE-LISTING-NORTH-STAR.md) | 店小秘上品交付标准 |
| [MULTI-ACCOUNT.md](./MULTI-ACCOUNT.md) | 多账号环境机制 |
| [CUSTOMER-SERVICE.md](./CUSTOMER-SERVICE.md) | 客服半自动 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 壳层、自愈、焦点门禁 |
| [PRODUCT-TASKBOOK.md](./PRODUCT-TASKBOOK.md) | 现行任务与版本 |
| [CHANGELOG.md](../CHANGELOG.md) | 版本变更 |
| [SKILL-FORMAT.md](./SKILL-FORMAT.md) | 技能包格式 |

---

## 版本分工

- 商店版（本目录）：人机协同工作台，端口 **3921**
- 原版 `D:\download\Sparo`：电商 / 指纹多开，端口 3920，只同步能力，不要把云订阅搬过去
- 对人说「技能」，不说「妙招」
