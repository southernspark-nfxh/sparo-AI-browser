# Sparo 现行产品任务书

> 持续更新。与原版 **同一份正文**，便于两边对照。上一版见 [PRODUCT-TASKBOOK-20260811.md](./PRODUCT-TASKBOOK-20260811.md)。  
> 版本：**v0.3.5 · 2026-09-05**  
> 状态：**进行中**（云订阅 M1 代码已落地，人测/上架未完；飞书网页已做）  
> 产品文案仍以 [PRODUCT.md](./PRODUCT.md) 为准，不要把任务书当商店上架稿。  
> 先读：[ARCHITECTURE.md](./ARCHITECTURE.md) · [CLOUD-SUBSCRIPTION.md](./CLOUD-SUBSCRIPTION.md) · [CHANGELOG.md](../CHANGELOG.md) 0.1.15 · 根目录 [AGENTS.md](../AGENTS.md)

两条产品线不要混评：

| | 内部开发线（店小蜜 / 电商） | 本仓库公开产品 |
|---|---|---|
| 定位 | Agent / 店小蜜 / 电商，继续开发 | 职场「会动手的 AI 浏览器」；免费自备 Key + 可选云端模型 |
| 数据 | `%APPDATA%\sparo`，MCP **3920** | `%APPDATA%\sparo-store`，MCP **3921** |
| 本轮代码 | 出行/飞书已对齐；**不要移植云订阅** | **已改** 侧栏 + 出行 + 飞书 + **云订阅 M1** |

---

## 1. 一句话定位（本轮）

顾客在浏览器里反复点的事（订酒店、买机票、查新闻、查路线），改成：**一句话说清目标，Sparo 打开结果页并读回来。**

付钱、登录、验证码仍由人在同窗里点。不要在城市弹层 / 热门城市格子上循环空点。

原则：

- 先本地解析（站点 + 地点 + 日期），再走结果页 URL  
- 用户点名哪个站就去哪个站，不要默认抢走携程  
- 读页用 `page_text`，不要用 `snapshot` 当正文  
- 新任务自动解除暂停；验证码流程不存妙招  

---

## 2. 上一版任务对照（2026-08-11，已改状态）

| # | 当时需求 | 2026-09-01 状态 |
|---|---|---|
| A | 右键下载图片 / 另存为 | **已完成** |
| B | 填表基建被 Hermes 用上 | **已完成**：`universal-form-fill` + Playbook |
| C | 客服半自动草稿 | **已完成**：侧栏「回复」填草稿，不代点发送 |
| D | 网页情报 / 1688 | **未做成垂直情报模块**；本轮用「读页 + 一句话查询」覆盖通读，1688 仍待做 |

下一迭代不要再按「等确认后开工」读 8 月 11 日那份，以**本文**为准。

---

## 3. 顾客需求清单（生活 + 工作）

核心都是：人以前要点城市、日期、联想框；现在应一句话出结果。

### 出行

1. 订酒店  
2. 买机票  
3. 高铁 / 火车票  
4. 航班动态  
5. 查路线  
6. 景点 / 演出票  
7. 出差组合（机票 + 酒店）

### 每天先看一眼

8. 天气  
9. 新闻 / 热搜  
10. 股票 / 基金  
11. 汇率  
12. 日历（网页）

### 购物与售后

13. 搜商品 / 比价  
14. 查物流（说明怎么查；有单号再查）  
15. 订单 / 退换货（多要登录）

### 生活办事

16. 挂号 / 预约说明  
17. 电影 / 餐厅  
18. 政务读页  

### 工作重复操作

19. 读这一页 / 这是什么网站 / 这段英文啥意思  
20. 填表（提交等人）  
21. 回评论（发出去等人）  
22. 发内容（发布等人）  
23. 打印 / 存 PDF  
24. 翻译整页  

---

## 4. 国内外对标站

每项：**国内 2 + 国外 2**。验证码 / 登录算「人过即可」，不算产品失败。

| 需求 | 国内 | 国外 |
|---|---|---|
| 订酒店 | 携程、途牛 | Booking、Airbnb |
| 买机票 | 携程、去哪儿 | Google Flights、Kayak |
| 火车 | 12306、携程火车 | Trainline、Omio |
| 航班动态 | 飞常准、携程动态 | FlightAware、Flightradar24 |
| 路线 | 高德、百度地图 | Google Maps、Bing Maps |
| 门票 | 携程、美团 | GetYourGuide、Viator |
| 天气 | 中国天气网、天气网 | Weather.com、AccuWeather |
| 新闻 | 腾讯新闻、澎湃 | BBC、Reuters |
| 股票 | 东方财富、雪球 | Yahoo Finance、Google Finance |
| 汇率 | 中国银行、新浪财经 | XE、Google |
| 购物 | 淘宝、京东 | Amazon、eBay |
| 物流 | 快递100、菜鸟 | 17TRACK、Parcels |
| 餐厅 | 大众点评、美团 | Yelp、TripAdvisor |
| 挂号 | 微医、好大夫 | Zocdoc、NHS |
| 政务 | 中国政府网、上海政府网 | USA.gov、GOV.UK |

---

## 5. 本轮修改日志（2026-09-01）

实现落点：**本目录商店版**。原版对照移植见 §7。

### 5.1 侧栏变聪明（P0）

| 问题 | 改动 |
|---|---|
| 「打开百度，搜天气」只打开首页 | `leftoverAfterOpen`：打开 + 后半句整句走 `act` |
| URL 后面粘中文变成 punycode | `extractFirstHttpUrl` + `normalizeUrl` 只吃纯 `https://…` |
| 「这是什么网站」走产品自我介绍 | `这是什么` 移出 who；「这是什么网站」走读页 |
| 暂停后下一句全失败 | 新任务（非明确暂停）自动 `resume` |
| 验证码流程存成妙招 | `shouldSkipRemember` |
| 打印只会闲聊 | 「把当前页打印出来」调 `webContents.print()` |
| 读页跟界面英文走 | `readPageInstruction` / `userReplyLang`：用户中文就中文答 |

主要文件：

- `src/main/agent/intent-router.ts`
- `src/main/agent/stub.ts`
- `src/main/agent/remember.ts`
- `src/main/agent/deepseek.ts`
- `src/main/browser.ts`
- `tests/intent-router.test.ts`

### 5.2 一句话出行（P0）

| 问题 | 改动 |
|---|---|
| 携程城市弹层循环 | 解析城市+日期，酒店走列表 URL |
| 途牛 / Booking 也被拉去携程 | `detectHotelSite`：点名哪个站去哪个站 |
| 机票飞成京沪、日期错 | `extractRoutePair` + `oneway-bjs-ist?depdate=` |
| 火车 / 路线乱点 | 火车、地图同样走结果页 URL |
| 侧栏没有日历 / 联想 | 工具增加 `fill_suggest`、`press`、`pick_calendar`；工具轮次上限 16 |

主要文件：

- `src/main/agent/travel.ts`（新建）
- `src/main/page-scripts.ts`（`FIND_DEST_INPUT_SCRIPT` / `PICK_SUGGEST_SCRIPT`）
- `tests/travel.test.ts`

识别站点补齐：途牛、去哪儿、京东、12306、百度地图、大众点评、Booking、Airbnb。

### 5.3 验收口令（侧栏原句）

```text
打开百度，搜今天北京天气
打开淘宝，搜无线耳机
打开 https://www.gov.cn 用中文告诉我这是什么网站
打开 https://news.ycombinator.com 用中文告诉我首页在聊什么
在携程查9月15日伊斯坦布尔的酒店
打开 https://www.booking.com 查9月15日伊斯坦布尔的酒店
在携程查9月15日北京到伊斯坦布尔的机票
打开高德地图，查从北京南站到天安门怎么走
```

本目录开发启动：

```text
npx electron-vite dev -- --remote-debugging-port=9333
```

MCP：`127.0.0.1:3921`。测功能用开发窗，不要用旧的安装包 `Sparo.exe`。

### 5.4 多段行程拆解（2026-09-02）

长指令同时出现规划 + 航班 + 酒店 + 出发/回国时，拆成去程 / 各城酒店 / 城际 / 回程，再汇总。不走高德跨国驾车。文件：`src/main/agent/trip-plan.ts`。

### 5.5 规划层 + 日常多步任务（2026-09-02 晚）

正则不再抢在模型前截胡脏句子。统一五步：填槽 → 结果页 → 可点实体 → 手册 → 人确认。

| 问题 | 改动 |
|---|---|
| 「做一个北京到曼谷的旅游攻略 9月16日出发 22日回来」掉进 `/online/channel` | `isTripPlanQuery` 认攻略/回来；地名去掉「做一个」；无城市码走 Google Flights；机票 URL 必须像 `/online/list/` |
| 「22日回来」没有月份 | 回程跟出发月 |
| 出差/调研连发，后一句手册被前一句污染 | `chatQueue`：上一句写完手册再做下一句 |
| 点评/猫眼/京东/淘宝卡死整窗 | 周末和比价只开百度检索；落到重站则 `webContents.stop()`，仍写手册 |
| 每段机票都调一次模型，行程很慢 | `runTravelSearch({ raw: true })`，最后一次汇总 |

新文件：`planner.ts`、`mission.ts`、`report-html.ts`。  
任务种类：`local_outing` / `compare_shop` / `research` / `job_apply` / `rent` / `hospital` / `gov_errand` / `course` / `papers` / `logistics`，外加已有 `trip_plan` / `travel_search` / 读页 / 一键回复。

验收口令（侧栏原句，不要连着发比价和酒店）：

```text
周六在北京吃川菜看场电影 再告诉我地铁怎么走
戴森吹风机 在淘宝和京东比价
下周一从北京去上海出差两天 要机票和酒店 大概多少钱
RAG是什么 打开百度百科和知乎做成笔记
在Boss上看产品经理岗位 先读JD不要投
望京附近5000内两居 通勤国贸
北京看皮肤科 怎么挂号
上海居住证要准备哪些材料
对比两门数据分析课
检索RAG综述 列3篇出处
怎么用快递100查申通
```

脚本：`scripts/_qa-mission-pack.py`（CDP 9333）。单测：`tests/mission.test.ts`。

### 5.6 原版移植 + 页面洞（2026-09-02 夜 / 09-03）

- 原版已对入 `travel` / `trip-plan` / `planner` / `mission` / `report-html` 及 `browser.ts` 执行器。端口仍是 **3920**。单测 116 条通过。指纹 / 店小蜜 / `envs/` 未冲掉。
- 网页左上角只剩汉堡菜单：`WebContentsView` 未铺满 `#pageHole`。壳层上报洞的位置，先 `layout()` 再加载。两边都改了。测布局用开发窗，不要用旧安装包。

### 5.7 飞书网页（2026-09-04）

「打开飞书」以前只开营销首页，「给张三发」会变成对官网的泛 `act`。

| 问题 | 改动 |
|---|---|
| 打开飞书进官网 | 改开 `https://www.feishu.cn/next/messenger` |
| 「打开飞书，给张三发」被 leftover 截胡 | `parseFeishuTask` 在 leftover / act **之前** |
| 循环 fill | 脚本一次注入；`feishu_work` |
| 代点发送 | 写入后 pause，人点发送/提交 |
| 未登录空点 | 认登录墙，暂停让人扫码，说「继续」 |

侧栏口令：`打开飞书网页版` / `打开飞书，给张三发：下午三点开会` / `在飞书写今日日报：……`

### 5.8 云订阅 M1（2026-09-04 / 09-05，仅本目录）

商业模式从「只卖软件、不设云账号」改为：**免费永远 BYOK；订阅是可选云端模型，Key 不进电脑。** 云订阅只改本仓库客户端 + 独立 `sparo-pay` 服务。不要在其它产品线弹登录。

| 问题 | 改动 |
|---|---|
| 「约 150 次」对不齐一次订酒店 | 1 次任务 = 一次 `handleChatJob`；多轮 HTTP 同一 `task_id`，按加权 token 扣点 |
| 大众没 Key 用不了 | 登录后每设备 3 次云端体验（按任务，不是积分礼包） |
| 云端 Key 进本机有上架风险 | 服务端代理；JWT 进 `safeStorage`；设置目录无真 Key |
| 商店包不能出现支付 | 应用内只「登录 / 去官网管理订阅」；`STORE_CHANNEL=msft` 更严 |
| 代理挂了整窗废掉 | 未登录或 5xx → 退回已保存的 BYOK |

砍出 M1：加购、Gumroad、Skill 社区、`declared_domains`。文案已改 PRODUCT / PRIVACY / 侧栏；**`listings/` 未改**。

交接全文：[CLOUD-SUBSCRIPTION.md](./CLOUD-SUBSCRIPTION.md)。安装：[INSTALL.md](./INSTALL.md)。

---

## 6. QA 记录（侧栏实测，2026-09-01）

付钱 / 验证码 / 登录：**人过即可**，不记产品失败。

### 6.1 路由与读页

8/8 通过：百度搜天气、淘宝搜耳机、gov.cn 介绍、HN 读首页、暂停后新任务、单独「这是什么网站」、打印。

### 6.2 出行直达（改完后再测）

| 原句 | 结果 |
|---|---|
| 携程伊斯坦布尔酒店 | 能出列表 |
| Booking 同一句 | 能出店名和价格 |
| Airbnb 房源 | 能出房源和价格 |
| 途牛同一句 | 去对的站，要登录 |
| 携程北京→伊斯坦布尔机票 | `oneway-bjs-ist`，有航班和价格 |
| 高德 南站→天安门 | 路线页打开，正文有时很瘦 |
| 携程京沪火车票 | 查询 URL 对，列表常要登录 |
| 京东搜耳机 | 到京东，登录墙 |

### 6.3 国外主流站（2026-09-01 晚）

**顺利：** Booking、Airbnb、Google Maps、BBC、Yelp、XE、Wikipedia；以及 Viator、NHS、USA.gov、GOV.UK、17TRACK。

**半程：** Amazon（搜索 URL 对，有时不读商品）、Google Flights（链接对，列表未稳定读出）、YouTube（常 `ERR_ABORTED`）。

**验证码（人过）：** Reuters、TripAdvisor、Zocdoc。

### 6.4 日常多步（2026-09-02 晚，商店版侧栏）

| 口令 | 结果 |
|---|---|
| 周六北京川菜+电影+地铁 | 出手册（百度+高德，不进点评） |
| 京沪出差两天 机票酒店 | 出行程手册，停在列表 URL |
| RAG 做成笔记 | 出调研笔记 |
| Boss 产品经理 先读不投 | 出岗位手册（验证码算人过） |
| gov.cn 这是什么网站 | 中文说明 |
| 帮我回一下评论 | 填草稿，不代发 |
| 总结当前页列 5 件要对齐 | 给出 5 条 |
| 望京 5000 两居 通勤国贸 | 出手册 |
| 北京皮肤科怎么挂号 | 出手册 |
| 上海居住证材料 | 出手册 |
| 对比两门数据分析课 | 出手册 |
| RAG 综述 3 篇出处 | 出手册 |
| 快递 100 查申通 | 出手册 |
| 戴森 淘宝京东比价 | **通过**（23:37）：百度检索，出「买前比价」手册，未进京东/淘宝 |
| 携程伊斯坦布尔酒店（比价之后单独再测） | **通过**（23:40）：列表页 + 店名详情链接，未被比价污染 |

### 6.5 云订阅 M1（2026-09-05，代码验收）

| 项 | 结果 |
|---|---|
| 商店版 `npx vitest run` | **164** 通过（含 `llmMode` 持久化、need-key 文案） |
| sparo-pay `node --test test` | **7** 通过（3 次体验、同 task 多轮只扣一次、七象验签、计价） |
| Electron 侧栏登录 / 余量 / 订酒店计 1 次 | **未在本机点完**，后续 Agent 用开发窗补 |
| `listings/` 与商店页「不设云端账号」 | **未改**，提审前单独一轮 |

---

## 7. 原版移植清单（2026-09-02 已完成）

把本目录下列文件对进内部原版（店小蜜线），并跑 vitest：

- [x] `src/main/agent/travel.ts`
- [x] `src/main/agent/trip-plan.ts`
- [x] `src/main/agent/planner.ts`
- [x] `src/main/agent/mission.ts`
- [x] `src/main/agent/report-html.ts`
- [x] `src/main/agent/intent-router.ts`（leftover / URL / 站点表 / travel / mission 路由）
- [x] `src/main/agent/stub.ts` / `remember.ts` / `deepseek.ts` 对应改动
- [x] `src/main/browser.ts`：`normalizeUrl`、新任务 resume、`runTravelSearch`、`runMission`、聊天队列、打印
- [x] `src/main/page-scripts.ts`：目的地 / 联想脚本
- [x] `tests/travel.test.ts`、`tests/intent-router.test.ts`、`tests/mission.test.ts`、`tests/trip-plan.test.ts`

原版端口仍是 **3920** / `%APPDATA%\sparo`，不要写成商店版 3921。

---

## 8. 后续待办（按这个表继续改）

### P0

- [x] 原版移植 §7（2026-09-02）  
- [ ] Google Flights / Kayak：打开结果页后稳定读出航班  
- [x] 携程机票列表：等待+滚动后再读；空列表改 Trip.com，禁止写成「当天没航班」（2026-09-02）
- [x] 长行程输出 HTML 手册：侧栏卡片点开后在窗口内阅读（2026-09-02）
- [ ] 高德 / Google Maps：读出耗时和换乘，不只打开 dir URL  
- [ ] YouTube 搜索不要 `ERR_ABORTED`  
- [ ] Amazon：搜索后读商品，不要反问「你想干什么」

### P1

- [ ] 去哪儿机票、12306 余票读列表  
- [ ] 东方财富 / 雪球 / Yahoo 股价做成和酒店一样的直达（可选）  
- [ ] 天气 / 新闻已能读页，保持；Reuters 等人过验证即可  
- [x] 侧栏连发多条时不要黏住上一句回复（`chatQueue`，2026-09-02）
- [ ] 比价手册里尽量带淘宝/京东商品链接（不打开商城页）
- [x] 网页视图铺满页面洞，左上角不再露半截导航（2026-09-03）
- [x] 飞书网页：打开消息、写聊天/日志草稿，不代点发送（2026-09-04）
- [x] 云订阅 M1 代码：sparo-pay + 商店版双模式 / 配额 / 文案（2026-09-05）
- [ ] 云订阅 M1 人测：侧栏登录、3 次体验、订酒店只计 1 任务、断网退回 BYOK
- [ ] `listings/` 按新叙事改一轮再提审（本次故意未动）

### P2

- [x] 出差组合：机票 + 酒店一次报（两城往返会拆步骤；三城以上未测）
- [ ] 美团网页门票（站点本身常封网页入口）  
- [ ] 1688 情报（旧任务 D）  
- [ ] Skill 社区 / 分成（**M1 人测过完再开**）

### 不做

- 破解验证码、代填密码、代点支付 / 客服发送 / 发帖确认  
- M1 阶段：Gumroad、加购点包、Skill 社区 / 分成、`declared_domains` 硬闸  
- 把云订阅移植到原版或在原版弹登录  

---

## 9. 怎么继续改（给后续 Agent）

1. 先读根目录 `AGENTS.md`（30 秒）和 [ARCHITECTURE.md](./ARCHITECTURE.md)，再看本文 §8。云订阅先读 [CLOUD-SUBSCRIPTION.md](./CLOUD-SUBSCRIPTION.md)。不要扫整个 `src/`。  
2. 本仓库是公开产品：3921 / `%APPDATA%\sparo-store`。不要把云订阅移植到其它产品线，也不要弹登录。  
3. 出行/任务可与内部原版对齐。**云订阅只改本仓库 + 独立 sparo-pay。** 不要改 `listings/`。  
4. 侧栏路径：`#chatInput` + 发送。出行改 `travel.ts` URL，不要让模型点热门城市。  
5. 页面空白/左上角残导航：先查 `setPageHoleBounds` / `#pageHole`，不要当站点 404 就结束。  
6. 改完：`npx vitest run`。代理服务另跑它自己的测试。重启开发窗。测功能不要用旧安装包。  
7. **每次做完：改日期、§5 日志、§6 QA、§8 勾选，并同步 CHANGELOG / ARCHITECTURE。**

---

## 10. 文档索引

| 文档 | 用途 |
|---|---|
| 根目录 [AGENTS.md](../AGENTS.md) | 30 秒上手、两条线、禁区 |
| [INSTALL.md](./INSTALL.md) | 官网直装 / 复制 GitHub 链接给 AI |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 模块、侧栏闭环、页面洞 |
| 本文 `PRODUCT-TASKBOOK.md` | 现行任务、日志、QA、待办 |
| [CHANGELOG.md](../CHANGELOG.md) | 对外变更（现 0.1.15） |
| [CLOUD-SUBSCRIPTION.md](./CLOUD-SUBSCRIPTION.md) | 云订阅 M1 交接（计量、目录、验收） |
| [PRODUCT.md](./PRODUCT.md) | 商店定位（不是任务书） |
| [HERMES-PLAYBOOK.md](./HERMES-PLAYBOOK.md) | Agent 决策树 |
| [UNIVERSAL-ANALYZER.md](./UNIVERSAL-ANALYZER.md) | 填表 / 日历 |
| [CUSTOMER-SERVICE.md](./CUSTOMER-SERVICE.md) | 客服半自动 |
| [MCP-API.md](./MCP-API.md) | 工具表 |
| [PRODUCT-TASKBOOK-20260811.md](./PRODUCT-TASKBOOK-20260811.md) | 8 月归档 |
