# Sparo skills（妙招）

Agent-facing catalog. Full publish playbook: [`docs/PUBLISHING.md`](../../docs/PUBLISHING.md).  
Hermes: [`docs/HERMES-PLAYBOOK.md`](../../docs/HERMES-PLAYBOOK.md).

## Rule

**AI = stage + clicks. Script = inject pre-baked content once.**  
**Unknown forms = analyze_page → execute_primitives (skill `universal-form-fill`).**

打包格式：[docs/SKILL-FORMAT.md](../../docs/SKILL-FORMAT.md)。社区分享仍是 M2，未开工。

## Active

| id | Say | What it does |
|----|-----|----------------|
| `universal-form-fill` | 通用填表 / 自动填表 | **analyze_page → execute_primitives**（任意站点） |
| `cs-semi-auto-reply` | 客服回复 / 帮我回客户 | **cs_scan → cs_draft_reply**（填草稿，不自动发送） |
| `xhs-longform-publish` | 发小红书 / 小红书发布 | ensure editor → **inject** title/body → layout → next → inject topics → pause |
| `xhs-longform-compose` | 小红书草稿 | shorter compose path; prefer `xhs-longform-publish` |
| `feishu-web-work` | 飞书 / 打开飞书 / 飞书写日志 | 打开消息页，注入聊天或日志草稿，**不点发送** |
| `life-compare-shop` | 比价 | 京东/淘宝/拼多多**结果页**读价 |
| `life-cn-business-trip` | 出差 | 12306 + 携程酒店列表 + 点评检索 |
| `life-news-digest` | 新闻汇总 | 百度检索，再点进少量正文 |
| `research-ai-browser` | AI浏览器竞品 | 检索名单，官网打不开就停 |
| `life-job-search` | 求职 | 打开 Boss 结果页，不代投 |
| `research-remote-tools` | 远程办公 | 检索工具与公开价 |
| `life-home-appliance` | 家电清单 | 一次打开冰箱/洗衣机/空调/电视四个京东结果页 |
| `research-pet-hardware` | 宠物智能硬件 | 规模检索 + 京东类目 |
| `life-japan-trip` | 日本自由行 | Kayak 机票 + 携程酒店（不先开携程机票空壳） |
| `research-ai-writing` | AI写作 | 检索竞品评测 |
| `life-express-track` | 查快递 | 快递 100 查单号 |
| `life-translate-page` | 翻译网页 | 打开原文，`page_text` 后译+5 条要点 |
| `life-movie-tickets` | 电影票 | 猫眼/淘票票，不走周末聚餐 |
| `life-weather-wear` | 天气 | 中国天气网 + 穿衣 |
| `life-software-download` | 官方下载 | 先官网，不点镜像 |
| `life-city-spots` | 打卡地 | 点评/携程景点 |
| `research-pdd-sourcing` | 选品 | 1688 + 拼多多，不去京东 |
| `research-papers` | 学术论文 | 百度学术 / Scholar |
| `life-rent-compare` | 租房对比 | 链家 / 贝壳 / 自如 |
| `research-insurance` | 重疾险 | 公开介绍页对比 |
| `life-week-events` | 本周展览 | 豆瓣 / 活动行 |
| `life-online-courses` | 在线课程 | Coursera / Udemy / 网易云课堂 |
| `research-weibo-hot` | 微博热搜 | 热搜榜 |
| `research-cross-border` | 跨境选品 | 亚马逊 + 1688 |
| `life-thailand-trip` | 泰国自由行 | 曼谷+清迈，含签证检索 |
| `research-saas-gtm` | SaaS竞品 | 项目管理工具 + GTM |
| `research-bom-lamp` | 供应链 | 台灯零部件 1688 |
| `research-tech-stack` | 技术选型 | 前后端+数据库对比 |
| `research-media-ops` | 自媒体运营 | 平台与选题 |
| `research-pet-economy` | 宠物经济 | 行业研报，不是喂食器 |

## How agents should call

```text
# Unknown form
run_skill({ query: "通用填表", params: { payload: { 标题, 正文, … } } })

# Xiaohongshu
run_skill({
  query: "发小红书",
  params: { title, body, summary?, topics?, mdPath? }
})

# 10 个基础生活/调研
run_skill({ query: "比价", params: { query: "索尼WH-1000XM5" } })
run_skill({ query: "出差", params: { date, checkin, checkout, area } })
```

Do **not** invent a multi-step `fill` plan when a matching skill exists (`match_skill` first).

## Add another site

1. Copy `_template-site-publish.json`
2. Implement one-shot inject (or new MCP helper)
3. Bundled skills auto-seed to `%APPDATA%/sparo/skills/` on Sparo boot
4. Add aliases + a section in `docs/PUBLISHING.md`
