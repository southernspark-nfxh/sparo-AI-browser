# 社交发布流水线设计（接口填稿 + AI 回读 + 页面发布）

> 状态：v2，**基于 2026-11-11 真机实测**，取代 v1 的截图审阅方案。
> 范围：百家号、头条。其它平台暂不做。
> 一句话：**脚本用平台接口把稿子填进去，AI 回读逐项核对，页面自己点发布。**

---

## 0. 为什么不是截图，也不是纯脚本

v1 打算用截图让 AI 审阅。这是 RPA 工具的路子，不是 Sparo 的。

理由三条：

1. **回读比看图准**。`el.innerText === 标题` 是确定判断；截图让模型"看标题对不对"是推断。
2. **回读不需要布局**。非活动标签 `innerHeight = 0`，量不了像素，但读 DOM 照样可以。截图反而强制把标签拉到前台。
3. **回读便宜且可断言**。几 KB 文本 vs 几百 KB base64，而且能写成 `if (a !== b) return fail()`。

同样，也不做"纯脚本 fetch 发布"：两个平台的最终提交都带页面生成的风控签名（见 §2），脚本造不出来。**发布必须由页面发起。**

---

## 1. 实测接口清单

### 1.1 百家号

| 用途 | 请求 | 鉴权 | 实测状态 |
|---|---|---|---|
| 存草稿 | `POST /pcui/article/save?callback=bjhdraft` | `token`（JWT） | ✅ 真发成功 |
| 发布 | `POST /pcui/article/publish?type=news&callback=bjhpublish` | `token` + `Acs-Token` | ⚠️ 已抓到完整请求体，请求被拦未发出 |

- 格式：`application/x-www-form-urlencoded`
- 回执：`{"errno":0,"data":null,"ret":{"status":"draft","article_id":"..."}}`
- `token` 来源：`localStorage['edit-token']`（251 字符 JWT，页面会刷新）
- `Acs-Token` 来源：页面里的百度风控 SDK（`window.ACS_2083` / `ACS_2112`），**只能由页面生成**

发布请求体与草稿同构，多出的字段：

```
article_id=<草稿ID>
BJH_FE_NOUNCE=<前端 nonce>
image_edit_point=<图片编辑点>
```

所有开关都在请求体里，**不需要点任何 UI**：

```
activity_list[0][id]=ttv&activity_list[0][is_checked]=1
activity_list[1][id]=ai_tts&activity_list[1][is_checked]=1
activity_list[2][id]=reward&activity_list[2][is_checked]=1
activity_list[3][id]=aigc_bjh_status&activity_list[3][is_checked]=0   ← AI 声明未勾选
cover_layout=one&cover_images=[{src,cropData,...}]&cover_source=upload
first_exclusive_publish_v2=3&abstract_from=1&len=<正文字数>
```

### 1.2 头条

| 用途 | 请求 | 鉴权 | 实测状态 |
|---|---|---|---|
| 存草稿 | `POST /mp/agw/article/publish?source=mp&type=article&aid=1231`，`save=0` | `tt-anti-token` | ✅ 真发成功，回执「保存成功」 |
| 发布 | 同地址，`save=1` | `tt-anti-token` | 待真机确认一次 |

- 回执：`{"code":0,"data":{"pgc_id":"7706826356718092854"},"message":"保存成功"}`
- 第二次起请求体带 `pgc_id`，**这就是文章 ID**
- 头条比百家号简单：**存和发是同一个接口，只差 `save` 参数**

关键字段：

```
save=0                       # 0=存草稿 1=发布（待实测确认）
title=<标题>&content=<HTML>
draft_form_data={"coverType":2}         # 2=无封面 1=单图 3=三图
pgc_feed_covers=[...]                   # 封面数组
article_ad_type=3                       # 投放广告
timer_status=0&timer_time=              # 定时
claim_exclusive=0&praise=1              # 首发 / 赞赏
```

### 1.3 两个平台共同的硬约束

| 约束 | 含义 |
|---|---|
| 风控头由页面生成 | 百家号 `Acs-Token`、头条 `tt-anti-token`。**Node 侧直发不行**，必须在页面上下文里发 |
| 后台标签无布局 | `innerHeight = 0`。接口填稿不受影响；点发布、选封面、定时面板需要布局 |
| 发布有二次确认 | 百家号点「发布」直接提交；头条「预览并发布」→ 弹窗「确定」 |
| 平台侧调度定时 | 定时发布不需要保持标签开着，设好时间即可关 |

---

## 2. 架构：三段式

```
┌─────────────┐    ┌──────────────┐    ┌──────────────┐
│  stage 填稿  │ →  │  review 审阅  │ →  │  commit 发布  │
│  脚本 / 接口  │    │   AI / 回读   │    │  页面 / 风控   │
└─────────────┘    └──────────────┘    └──────────────┘
     快、准、后台          逐项比对             必须前台
```

### stage —— 接口填稿

1. 复用或新开对应平台的编辑页（后台即可，不要布局）
2. 从页面取鉴权（百家号 `localStorage['edit-token']`；头条由页面 SDK 自动带 `tt-anti-token`）
3. 在页面上下文 `fetch` 提交一次：
   - 百家号：`/pcui/article/save`，回执拿 `article_id`
   - 头条：`/mp/agw/article/publish` 带 `save=0`，回执拿 `pgc_id`
4. 回执 `errno/code === 0` 才算填稿成功；否则直接停，不往下走

**和现在适配器的区别**：现在是一步一步模拟 UI（等 UEditor 起来、模拟 paste、DOM 点上传、坐标拖封面、滚动定时列表）。接口版把这些全砍掉，**一次请求带全部字段**。

### review —— AI 回读

按 `article_id` / `pgc_id` 重新打开编辑页，逐项读 DOM 并与提交意图比对。**不回读通过，不发布。**

八项回读契约：

| # | 项目 | 判据 |
|---|---|---|
| 1 | 标题 | `input.value === 意图标题`（完全相等，不做模糊） |
| 2 | 正文开头 | 编辑器纯文本前 50 字 === 意图正文前 50 字 |
| 3 | 正文字数 | 偏差 ≤ 2%（编辑器的空白/换行归一化误差） |
| 4 | 正文图片 | 数量相等；每个 `img` 的 `src` 非空且 `naturalWidth > 0` |
| 5 | 封面 | `src` === 意图封面；意图是「无封面」时，页面上封面区必须为空 |
| 6 | AI 声明（百家号） | `aigc_bjh_status` 的勾选态必须是**未勾选** |
| 7 | 投放广告（头条） | `article_ad_type` 必须是**已选**（radio，不能点第二次取消） |
| 8 | 定时 | 日期、时、分三项与请求一致；状态是「定时」不是「立即」 |

任一项不符 → 返回差异清单，**不进入 commit**，侧栏说人话（例如「封面没上去」）。

### commit —— 页面发布

1. 确保目标标签是活动标签（`innerHeight > 0`），否则 `ensure_render`
2. 点发布：
   - 百家号：点「发布」
   - 头条：点「预览并发布」→ 弹窗「确定」
3. 读回执：
   - 优先读网络响应（`errno`/`code` + `article_id`/`pgc_id`）
   - 读不到就回列表页按标题搜，能找到才算成
4. 发布动作走 Sparo 自己的确认通道，**不用 `dispatchEvent` 硬点绕过闸门**

---

## 3. 代码落点

| 文件 | 改动 |
|---|---|
| `adapters/baijiahao.mjs` | 新增 `stage()`（fetch save）、`readback()`（八项回读）；`publishOrSchedule()` 拆成 `commit()` |
| `adapters/toutiao.mjs` | 同上，`stage()` 走 `save=0`，`commit()` 走 `save=1` |
| `engine.mjs` | `STEPS` 由八步直线改为 `stage → review → commit`；`--from` 续跑保留 |
| `page.mjs` | 新增 `readbackScript(spec)`，输出统一回读结构；`--from` 的 `canResume` 继续核对标题防串稿 |
| `sparo.mjs` | **不加** `screenshot()`。接口都走 `exec` 里的 `fetch` |

保留的旧能力：
- `openWriteTab` / `chooseEditorTab` 的 owner 隔离逻辑不动
- `runSchedule` 的定时面板逻辑保留，作为 commit 的 UI 兜底
- 现有 8 个方法不删，降级为 `stage` 失败时的备用路径

---

## 4. 失败降级

| 情况 | 动作 |
|---|---|
| `save` 接口 4xx/5xx | 记录回执，退回原来的 UI 填稿路径 |
| 接口成功但回读不符 | 停，列差异，不发布 |
| `Acs-Token` 缺失 / 发布被平台拒 | 退回 UI 点发布（同标签内） |
| commit 无回执 | 切列表页搜标题；5 分钟无进展，说人话关单 |
| 登录态过期 | 直接报「需要重新登录」，不重试 |

---

## 5. 批量与定时

| 场景 | 做法 |
|---|---|
| 5 篇立即发 | 串行：`stage(1) → review(1) → commit(1) → stage(2) …` |
| 10 篇分布 10 小时 | 全部只跑 `stage` 设定时间，**不跑 commit**；平台侧调度，填完关标签 |
| 跨平台一稿多发 | 百家号、头条各一个标签，**可以并行** stage；commit 排队 |
| 同平台多标签并行 | **不做**。单窗口只有活动标签有布局，同平台并发会互相抢前台 |

---

## 6. 验收判据

| 编号 | 场景 | 通过标准 |
|---|---|---|
| P1 | 百家号单篇立即发 | 接口回执 `errno:0`；回读八项全过；列表页能搜到 |
| P2 | 头条单篇立即发 | 接口回执 `code:0`；回读八项全过；列表页能搜到 |
| P3 | 两平台同稿 | 两个 `article_id`/`pgc_id` 都非空；两边回读都过 |
| P4 | 定时 10 篇 | 10 个回执都有 id；`timer_status=1` 且时间正确；标签关掉后仍在 |
| P5 | 回读拦截 | 故意传错封面，必须停在 review，不产生发布请求 |

---

## 7. 风险与禁区

- **不把风控 token 存盘**。每次通过页面取，不写日志、不落盘。
- **不在 Node 侧直发提交**。缺风控头，必被拒。
- **不并发同平台标签**。
- **不用 `dispatchEvent` 绕过 Sparo 的发布闸门**。现在的 `publishOrSchedule` 这么干，属于历史遗留，新链路不沿用。
- **接口改版是常态**。字段变化时按 §4 降级到 UI，不要硬试。

---

## 8. 待办

1. 头条 `save=1` 真机确认一次（当前是高置信推断）
2. 百家号 `Acs-Token` 是否有页面可调用的生成入口（有则 commit 也能接口化）
3. 探查产生的两篇草稿需清理：
   - 百家号《Sparo接口探查稿1111》`1881548137369140914`
   - 头条《Sparo头条接口探查1111》`pgc_id=7706826356718092854`
