# 黄金场景（活账本）

> 黄金 = 用户真实说过、真实失败过的原句。工单是 [QA-20261026-GOLDEN-SCENARIOS.md](./QA-20261026-GOLDEN-SCENARIOS.md)。
> 通过只看 `%APPDATA%\sparo-store\` 底账。侧栏看起来像成了，不算。
> 2026-10-27 这一轮没有打开 Sparo 窗口重跑 G1–G8，也没有重打包。单测覆盖写在每条下面。实机栏留空，跑完把结果写进本文件，不要只改聊天记录。

底账：

| 文件 | 是什么 |
|---|---|
| `%APPDATA%\sparo-store\missions.jsonl` | 一行一个 JSON。`op` 为 `open` / `turn` / `close` |
| `%APPDATA%\sparo-store\chat-memory.json` | 侧栏最近 40 句，数组，元素有 `role` 和 `text` |
| `%APPDATA%\sparo-store\reports\` | 报告页文件 |

共用核对（先跑这段，再看每条的期望）：

```powershell
$root = Join-Path $env:APPDATA "sparo-store"
$want = "这里换成原句"
$lines = Get-Content (Join-Path $root "missions.jsonl") | ForEach-Object { $_ | ConvertFrom-Json }
$open = $lines | Where-Object {
  $_.op -eq "open" -and (($_.mission.raw -replace "\s+"," ") -eq ($want -replace "\s+"," "))
} | Select-Object -Last 1
$id = $open.mission.id
$turns = @($lines | Where-Object { $_.op -eq "turn" -and $_.id -eq $id })
$close = $lines | Where-Object { $_.op -eq "close" -and $_.id -eq $id } | Select-Object -Last 1
$real = @($turns | Where-Object { @($_.findings).Count -ge 1 })
"id=$id turns=$($turns.Count) realSteps=$($real.Count) close=$($close.reason)"
$chat = Get-Content (Join-Path $root "chat-memory.json") -Raw | ConvertFrom-Json
$chat | Where-Object { $_.text -like "*$($want.Substring(0, [Math]::Min(12, $want.Length)))*" -or $_.text -like "*正在做*" -or $_.text -like "*已打开*" } |
  Select-Object -Last 6 role, text
```

**真实步骤**只算 `findings` 至少 1 条的 turn。进循环前那条 turn 的 `findings` 是空的，计划第 0 步创建时就是 `running`，不算执行。这是 10-26 晚那次零执行关单里已经出现过的假信号。

## G1 打开微博

- 原句：`打开微博`
- 前置：任意页
- 单测：`tests/site-open-job.test.ts`「单步 navigate 且必交付只有 answer」。不断言窗口真的打开了微博。
- 底账期望：
  - `close.reason` 是 `done`
  - `chat-memory.json` 里有助手句，文本为 `已打开 weibo.com。`
  - 这张单的 `brainPlan.steps` 只有 1 步，且 `cap` 是 `navigate`；没有助手句「正在做 2」
- 人已经在微博上时，这一步会被标成 `skipped`（笔记「当前页已在该站」），然后才允许 done。不要为了看到 done 去放宽未完成步清点。

## G2 当前页博主近三天微博复制成文档

- 原句：`当前我打开的这个博主 最近三天的微博 帮我复制下来 做成一个文档`
- 前置：已经停在某个博主 `weibo.com/u/` 页
- 单测：`tests/site-open-job.test.ts` 事故原句 + 4 步计划时期望 `siteOpenEndsTheJob === false`；「打开」紧跟「的」时期望 `openSiteIsTheJob === false`。不断言文档真的写出来了。
- 底账期望：
  - `realSteps >= 1`
  - 第一条有 findings 的步骤，`findings[0].step.cap` 是 `read_page`
  - `chat-memory.json` 有助手句，文本含 `正在做 1/`
  - 关单前必交付齐，`close.reason` 为 `done`；缺了则为 `incomplete`，助手句同时含「还缺」和没执行的计划步。禁止 `done` 且 `realSteps = 0`

## G3 阅读页刚产出之后说采集

- 原句：`把最近 3 天微博逐条复制下来`
- 前置：上一条助手消息带阅读页（`doc.kind` 为 `read`）
- 单测：`tests/read-rewrite.test.ts`。模型不答 `rewrite` 就开新单。
- 底账期望：
  - 这句话新出现一条 `op=open`
  - 不走改写：`chat-memory` 里不是只改上一份阅读页标题，而是有新的 `mission.id`

## G4 博主画像，最好上百条

- 原句：`研究博主 XXX 画像，最好上百条`（XXX 换成当时的博主名）
- 前置：任意
- 单测：`tests/understand.test.ts`「认出 N 天加采集对象」。不断言报告内容。
- 底账期望：
  - 这句原文只有一个没被 `close.reason = dup` 掉的有效单
  - `realSteps` 里能看到滚动或翻页（`act` 或带增量的 `page_text`）
  - `%APPDATA%\sparo-store\reports\` 在开单时间之后有新文件，正文里写了实际样本量

## G5 挂起后回「打开 / 好 / 继续」

- 原句：`打开` 或 `好` 或 `继续`（单独一句）
- 前置：有一张 `waiting_human` 的单，侧栏问过要不要打开或换入口
- 单测：`tests/intent-router.test.ts` 里短肯定不认「打开微博」。
- 底账期望：
  - 不新开 `op=open`
  - 原单 id 上继续出现 `turn`
  - 原单没有在这句之后立刻 `close`

## G6 纯创作

- 原句：`帮我写一首诗`
- 前置：任意
- 单测：`tests/loop.test.ts`「coverage new with a pure synthesize plan still proposes」。
- 底账期望：
  - `chat-memory` 出现提议/思路卡（助手句带确认，而不是直接把诗贴进侧栏就算完成）
  - 没有被静默吃掉：用户这句话之后有助手回复

## G7 打开后再搜索

- 原句：`打开百度，搜今天北京天气`
- 前置：任意
- 单测：`tests/site-open-job.test.ts` 无计划与多步计划都不早退。
- 底账期望：
  - `realSteps >= 1`，其中有检索（`search_read` 或等价的搜索发现）
  - 助手句不是只有 `已打开 baidu.com。`

## G8 长采集滚动

- 原句：一条会在无限滚动页上连续 `page_text` 的采集句（G2 或 G4 跑起来时一起看）
- 前置：无限滚动页
- 单测：`tests/page-text-delta.test.ts`。
- 底账期望：
  - 第二次及以后的 `page_text` 发现文本含 `较上次 +` 或 `较上次 -`
  - 出现 `较上次 +0 字` 之后，下一次工具指纹不是上一次的原样再来一遍

## 实机记录

| 场景 | npm run start | 安装包 | 底账摘录 |
|---|---|---|---|
| G1 | 未跑 | 未跑 | |
| G2 | 未跑 | 未跑 | |
| G3 | 未跑 | 未跑 | |
| G4 | 未跑 | 未跑 | |
| G5 | 未跑 | 未跑 | |
| G6 | 未跑 | 未跑 | |
| G7 | 未跑 | 未跑 | |
| G8 | 未跑 | 未跑 | |

安装包复测至少 G1、G2、G3。记下 `git rev-parse --short HEAD` 和 `release\Sparo-Setup.exe` 的修改时间。开发窗绿了，不能代替安装包。

## 店小秘到速卖通第一阶段（E1–E12）

单测在 `tests/dxm-smt-listing.test.ts` 和 `tests/dxm-smt-publish.test.ts`。下面每条真实场景都还没在已登录页面跑过。单测通过不能写成真机通过。保存、提交、待审都不算上线。

## E1 无变种、资料齐全商品

- 场景：正确店铺，草稿读回，确认后提交，最终要有在线链接。
- 单测：状态机禁止无在线证据进入上线。
- 真机：未跑。没有脱敏基线，也没有当场发布授权。

## E2 多变种商品

- 场景：SKU 不串行，价格库存逐一读回，规格变量未丢失。
- 单测：`alignSkus` 按规格对齐。
- 真机：未跑。

## E3 分类后新增星号属性

- 场景：发现新必填项；缺资料进入人工待办。
- 单测：`rescanRequired`。
- 真机：未跑。

## E4 无品牌或类目资质

- 场景：不虚构、不发布，指出处理入口。
- 单测：业务值拒绝无来源猜测；QA 不通过。
- 真机：未跑。

## E5 无运费模板

- 场景：不随机选择、不自动创建，给出处理说明。
- 单测：准备消息包含运费模板处理说明，QA 不通过。
- 真机：未跑。

## E6 拒绝付费图片翻译

- 场景：不扣费、不重复请求，图片项保持未完成。
- 单测：拒绝原文不会调用收费动作。
- 真机：未跑。

## E7 登录失效或验证码

- 场景：停等，用户处理后从原工作单续跑。
- 单测：页面分类把登录、验证码和无权限分开。
- 真机：未跑。

## E8 保存成功、发布被拒

- 场景：草稿和发布失败分开，保留平台错误原文。
- 单测：拒绝回执进入 failed，旧指纹不能直接重发。
- 真机：未跑。

## E9 发布点击后超时

- 场景：先查重查回执，不二次发布。
- 单测：无回执进入结果未知，再次 publish 不点击。
- 真机：未跑。

## E10 入口或弹层变化

- 场景：不能安全重定位就暂停，不死点不误提交。
- 单测：未知店小秘路径返回入口变化。
- 真机：未跑。

## E11 中断后说继续

- 场景：同商品同店铺从断点续跑，不重新认领。
- 单测：取消后不再保存；同一来源和店铺复用原单。
- 真机：未跑。

## E12 安装包完整回归

- 场景：安装包里的电商链路拿到真实回执，且 G1、G2、G3 无回归。
- 单测：无。本次不运行 `npm run dist`。
- 真机：未跑。安装包由规划方在复审后制作。
