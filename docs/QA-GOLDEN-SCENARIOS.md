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
| G1 | 未跑 | 过（2026-11-10） | 活动标签在百度。原句「打开微博」后侧栏确认已到 `https://weibo.com/`、登录正常、首页信息流读回（含账号名与草稿未发送）。`beforeUrl` 为百度，`navigated: true`。 |
| G2 | 未跑 | 过（2026-11-10） | 前置：活动标签停在 `weibo.com/u/1497714867`（@汪海林）。原句后产出 `%APPDATA%\sparo-store\docs\2026-11-10T12-35-46-汪海林微博最近三天内容整理（11-9至11-11）.md`（9877 字节，20:35:46）。11-9 无发布记录已如实写明，未假完成。 |
| G3 | 未跑 | 过（2026-11-10） | G2 关单后紧接原句「把最近 3 天微博逐条复制下来」：新开一份逐条稿，未改写上一份。产出 `2026-11-10T12-37-49-汪海林微博逐条摘录（11-9至11-11）.md`（14990 字节，20:37:49）。回复写明 11-11 三条、11-10 十七条，11-9 为空，并指向 G2 那份整理稿仍在。 |
| G4 | 未跑 | 未跑 | |
| G5 | 未跑 | 未跑 | |
| G6 | 未跑 | 未跑 | |
| G7 | 未跑 | 未跑 | |
| G8 | 未跑 | 未跑 | |

安装包复测至少 G1、G2、G3。记下 `git rev-parse --short HEAD` 和 `release\Sparo-Setup.exe` 的修改时间。开发窗绿了，不能代替安装包。

### 2026-11-17 0.7.6 安装包（删除环境 R2/R3 加固真机复测）

- 包：`release\Sparo-Setup-0.7.6.exe`（105,007,212 字节，2026-11-17 17:47:36，SHA-256 `9C10066742AC169BF8A3CCA3835374E9E87F9D02E9DE4D2B5A45A1C7878FF58B`），构建时 HEAD `3231342`（chore(release): 0.7.6）。
- 环境隔离：`SPARO_CONFIG_DIR=%TEMP%\sparo-qa-076`、`SPARO_MCP_PORT=3928`；用户 0.7.0（3921）全程未动。静态：typecheck 0 错误；vitest **139 文件 / 1062 条全绿**（`tests/env-delete.test.ts` 增至 5 条：R2 清存储失败保环境可重试、R3 恢复指向已删环境改开普通标签）。
- **删除链路七步过**：`create_env`（10567960）→ `navigate({url, envId})` 开环境标签（91c996e7）→ `execute` 写 `iso_del=A` Cookie + localStorage 并读回 → `delete_env` 回执 `env 10567960 deleted, closed 1 env tabs` → 环境标签已关（只剩默认标签）→ 名册不含该环境。`/health` 81 个工具在线。
- **R2 真机实证**：删除时主进程日志出现新加的 `[env] partition dir left behind: EBUSY … DIPS`——目录因 Windows 文件锁留空壳不再静默，且 clearStorageData 已先行成功（下一条核验）。0.7.5 同场景这条是静默的。
- **停进程后存储核验**：sql.js 读 `Partitions/env_10567960/Network/Cookies`：`iso_del_rows=0 total_rows=0`。
- **包内核对**：asar 主包含 R2 字符串 `clear storage failed, env kept` 与 R3 字符串 `环境已删除，已改开普通标签`；`ledger/2026-11.jsonl` 仍排除（仅 `scripts/ledger.mjs`）；`publish.mjs --self-check` = `SELF_CHECK_OK`；social-media-publish 的 `baijiahao/toutiao/page/engine` 四文件哈希与提交版一致——**未审适配器改动（插图弹窗续跑、owner="user"）经 stash 隔离未进包**。
- **复现坑（新增）**：Sparo.exe 是 GUI 子系统，PowerShell `&` 立即返回，`run_in_background` shell 一退出就按 job object 回收子进程——实例秒退。须带输出管道挂住：`& Sparo.exe 2>&1 | ForEach-Object { "$_" }`。
- **未重测**：G1–G3 沿用 0.7.4 记录（0.7.6 只改 deleteEnv/reopen 链路、测试与文档，任务循环与发布链路零改动，未审适配器改动未进包）；登录态相关（G5/五站 probe/四站 dry-run/真实输入法 60 秒）仍待补；R3 的 Ctrl+Shift+T 真机按键待下版人测（单测已覆盖）。


### 2026-11-17 0.7.5 安装包（删除环境即失效真机复测，决策点 #63）

- 包：`release\Sparo-Setup-0.7.5.exe`（105,006,100 字节，2026-11-17 16:25:41，SHA-256 `960B3F17DB235ED8F3EF3BCD139370AFA56B7F14D50BAE313556095C43535FFC`），文件版本 0.7.5。真机跑同一轮产出的 `release\win-unpacked\Sparo.exe`。
- 环境隔离：`SPARO_CONFIG_DIR=%TEMP%\sparo-qa-075`、`SPARO_MCP_PORT=3926`；用户 0.7.0（3921）全程未动。静态：typecheck 0 错误；vitest **139 文件 / 1060 条全绿**（含新增 `tests/env-delete.test.ts` 3 条）。
- **N2 修复真机过**：`create_env`（QA删除验证）→ `navigate({url, envId})` 开环境标签 → `execute` 写 `iso_del=A` Cookie + localStorage 并读回 → `delete_env` 回执 `env … deleted, closed 1 env tabs` → `list_tabs` 环境标签已关（2→1，只剩默认标签）→ 名册不含该环境。
- **分区存储清除核验**：运行中 Cookies 文件被网络进程独占锁（EBUSY），停掉隔离实例后用 sql.js 读 `Partitions/env_<id>/Network/Cookies`：`iso_del` 行 0、总行数 0。目录因 Windows 文件锁留空壳——与 MULTI-ACCOUNT 新口径「留空壳，不含有效登录态」一致。原 QA 脚本的「目录必须消失」判定改为「停进程后 cookie 行清零」，不伪称目录已删。
- **N1 修复核验**：0.7.5 asar 内 `ledger/2026-11.jsonl` 已排除，仅保留写台账的代码 `scripts/ledger.mjs`。
- **未重测**：G1–G9 沿用 0.7.4 记录（0.7.5 只改 deleteEnv 链路、打包过滤与文档）；登录态相关（G5/五站 probe/四站 dry-run/真实输入法 60 秒）仍待补。

### 2026-11-17 0.7.4 安装包（侧栏发稿链路真机全过，G1/G2 复测过）

- 包：`release\Sparo-Setup-0.7.4.exe`（105,008,446 字节，2026-11-17 14:43:18，SHA-256 `C4205C3D18BE2AA68F5EBCC25FD7CDD1419FB609145E337A3DDC94F8241A2C57`），HEAD `695f1c9`（其上 905bb07/de33c30 均为纯 docs 提交）。
- 环境隔离：`SPARO_CONFIG_DIR=%TEMP%\sparo-qa-074`、`SPARO_MCP_PORT=3925`，跑 `release\win-unpacked\Sparo.exe`；模型 Key 从用户配置复制（BYOK deepseek），用户 0.7.0 实例（`D:\Program Files\Sparo`，3921）全程未动。
- 静态：typecheck 0 错误；`vitest run` 138 文件 / 1057 条全绿；78 个 .mjs 全过 `node --check`。
- 产物核对：`resources/social-publish-scripts/` 25 文件 + `platforms/` 5 JSON（含 weixin）均在；`app.asar` 内 social-media-publish.json（v3）、weixin-publish.json（v1）均在，asar 解出的 `adapters/weixin.mjs` 第 42 行 `export const weixin` 完好；包内 `publish.mjs --self-check` = `SELF_CHECK_OK`。全新配置首开机播种 41 个技能，social-media-publish 为 v3（enum 含 weixin）、weixin-publish.json 在列。
- **G9a 缺槽先问 过**：侧栏「帮我发稿子」→ 回复追问平台+目录两项（列五平台、注明公众号只存草稿、说明目录结构），`navigated:false`，未打开任何发布页。
- **G9b 槽齐拼 params（微信）过**：「帮我发稿子，平台微信，稿件目录 D:\articles\wx-001」→ 直接调 weixin-publish 技能，目录参数透传，publish.mjs 真实执行至登录门（退出码 2），AI 如实报「公众号后台没有登录」并停手交人（扫码），明确「群发那一下仍需你自己点」；顺带验证 C5（runner spawn ELECTRON_RUN_AS_NODE 安装包内跑通并回传退出码）与 C8（profile.mjs 读 platforms/weixin.json 路径正确）。
- **G9c 分站走 social-media-publish 过**：同句换「平台头条」→ 走「一稿多发」social-media-publish，`platform=toutiao`、`articleDir=D:\articles\wx-001` 透传（AI 原话引用），第 1 步 social_publish 至登录门（退出码 2）停手；头条登录页标签 owner=`agent:sidebar`。
- **G9d match_skill 过**：`match_skill("微信公众号发布")` → best `weixin-publish`（93 分，reason: title, alias:公众号发布），JSON 种子安装包内加载正常（C7 过）。
- **G1 开站归属复测（口径窄于黄金原句）**：MCP `navigate https://weibo.com`（不是侧栏原句「打开微博」）→ 落 passport 登录页（隔离无登录态，预期），标签 owner=`agent:05f1dd`、agentName=`qa-074`；`list_tabs` 的 activeId 仍是用户百度首页，不抢焦点。侧栏原句 + 已登录信息流这一档没跑。
- **G2 读页写报告复测 过（降级：百度百科代替需登录的微博）**：侧栏「打开百度百科，搜索 人工智能，把词条内容整理成一份 Markdown 报告」→ 产出 `docs\2026-11-17T07-44-57-百度百科词条「人工智能」整理报告.md`（14,663 字节，SHA-256 `5318983590923B79…`），九节带来源标注；且明确「单次抓取上限约 8 万字，词条后半段没有逐段读到，没有凭印象补写」——「关单必有声、不假装完整」硬规则真机体现（B3/B4 真机证据）。
- **G3 未复测**：需已登录微博的真实博主页 + 「继续」续跑，隔离配置无登录态；`tests/mission-journal.test.ts` 9 条（含续写不覆盖）全绿。
- **G4 五站 probe 抽到（2/5）**：安装包级 `--probe` 微信 → formatPlan/ok（theme=editorial）、imagePlan/ok（docx 0/0）、openBlank 止 NO_TOKEN（结构化 JSON 报告，提示先扫码）；头条 → imagePlan/ok、openBlank 止 LOGIN（「登录态失效，只把这个平台交给用户」）。两站机制一致，登录门不硬闯；baijiahao/dayu/sohu 同 engine 未逐站跑，五站全 PROBE_OK 需登录态环境。
- **G5/G6 未全链路跑**：微信存草稿与四站 dry-run 都要各站登录态。另一次 MCP `run_skill`（social-media-publish，platform=toutiao，dryRun=true）第 1 步退出码 2，diagnose 停在调用方自己的 `https://example.com/`（截图落 `%TEMP%\sparo-qa-074\diag\`），**不能**据此说 dry-run 已经走到头条登录门。头条登录门的证据是侧栏 G9c 和 CLI `--probe toutiao`。
- **G7/G8 未重测**：0.7.4 核心提交 8b866be 未碰壳层任何文件（shell.html/shell-preload/page-bounds/chrome-hole 均无改动，browser.ts 仅 run_skill params 2 行），沿用 0.7.3 CDP 基线（打字 461 拍 lost=0、卡死 1.1 秒自愈）；未在真实低速输入法打满 60 秒（测试窗口期用户机器前台被占用，不抢）。
- **多账号真机（A1/A2/A3）**：create_env「QA环境A」→ navigate(envId) 开 example.com（标签带 envId）→ 环境内写 `iso_probe=A`+localStorage，同站默认环境标签读出 cookie 为空、localStorage null，回环境标签探针仍在（A1/A2 过）。**A3 发现文档与实际不符**：delete_env 后 list_envs 为 0、但已打开的环境标签不关闭且仍挂已删 envId，`Partitions\env_5816e76e\Network\Cookies`（20,480 B）保留、标签内 cookie 仍可读——MULTI-ACCOUNT.md 写「留空壳，不含有效登录态」在标签存活时不成立（P1，建议 delete_env 关环境标签并清 partition，或文档改口径）。
- **未做**：多平台一次发拆分；五站登录态下 PROBE_OK；微信真实存草稿（G5）；G7/G8 实机重测。

### 2026-11-17 0.7.3 安装包级复测（侧栏打字被抢焦点：自愈退避 + 打字时不摘挂）

- 包：`release\Sparo-Setup-0.7.3.exe`（105,008,480 字节，2026-11-17 13:03:42，SHA-256 `88AD3790A0E71D13D5167A5746D12445B308BB55FA232AD2E2C34E7A4C70029E`），基于 HEAD `e7a9401` + 本轮改动；测试跑在同一份 `release\win-unpacked\Sparo.exe`。
- 环境隔离：`SPARO_CONFIG_DIR=%TEMP%\sparo-qa-073`、`SPARO_MCP_PORT=3949`、CDP 9361、`--user-data-dir=%TEMP%\sparo-qa-073-userdata`（用户桌面上的 0.7.0 全程未动）。隔离实例的 `settings.json` 写 dummy `apiKey` 解锁输入框。
- **用户机器底账（病根）**：`%APPDATA%\sparo-store\diag\crash.log` 2026-11-16 10:00–13:20 每分钟 80–138 条 `chrome-hole-heal` / `chrome-hole-action`，同一条标签每 2 秒重复「整窗 1400×900 → 洞 680×829」；同期 `shell-paint-recover` 约每 10 秒一次。摘挂 `WebContentsView` 与 `hide()/show()` 都会把键盘焦点交给网页。
- **焦点采样（有网页视图）**：CDP 聚焦 `#chatInput` → `Input.insertText` 20 字 → 100 ms 采样 `document.activeElement`，期间 `SetWindowPos` 改窗 6 次（1180×820 → 1420×940 等）。第一次 533 拍 / `lost=0`，第二次开 `https://example.com` 后 461 拍 / `lost=0`；`chrome-hole` 日志 0 条，输入框文本保持 30 字。
- **壳层卡死自愈仍有效**：CDP `while(true){}` 卡死后把窗口置前，逐行为 `restart win=main reason=silent streak=3 count=1` → `shell-render-gone reason=crashed` → `shell-reload forced=true` → `heartbeat online`，置前后 **1.1 秒**恢复（卡死期间窗口不在前台，看门狗按设计不救后台窗口）。
- **未验证**：没有在真实低速输入法里逐字打满 60 秒；「摘挂一次仍不收敛 → 退避」只有单测覆盖（`tests/chrome-hole.test.ts`、`tests/shell-focus-typing.test.ts`），没在实机人为制造「重挂后仍盖住壳层」。
- **G1–G3 未重测**：本轮只改壳层焦点与覆盖自愈节奏，不碰开站/读页/发布，沿用 0.6.9 结论。这是偏离，不冒充已复测。

### 2026-11-17 0.7.2 安装包级复测（壳层白屏：后台节流被重新打开）

- 包：`release\Sparo-Setup-0.7.2.exe`（105,005,947 字节，2026-11-17 12:37:57，SHA-256 `301A4AEB9B2EEC8F1C083BA3282180F94B59125E3061BFF92A0F4797DED24CAC`），基于 HEAD `6ce4dfe`；测试跑在同一份 `release\win-unpacked\Sparo.exe`。
- 环境隔离：`SPARO_CONFIG_DIR=%TEMP%\sparo-qa-072c`、`SPARO_MCP_PORT=3947`、CDP 9358；不动 `%APPDATA%\sparo-store` 与已装版本。
- **用户机器底账**：`%APPDATA%\sparo-store\diag\crash.log` 2026-11-17 12:17 连续 14 拍 0 帧，`repaint ×3` 全部无效，直到 `restart` 才回来，白屏 13 秒；12:23–12:28 又反复 `reason=unresponsive` / `reason=silent`。代码里 `restore` 回调会重新下发 `setBackgroundThrottling(true)`，把窗口创建时的 `backgroundThrottling: false` 关回去——0.7.1 只压短了恢复时间，没动这条线。
- **最小化/还原 A/B（假设未证实）**：同一脚本对已装 0.7.0（整目录复制到 `%TEMP%\sparo-070-copy`）与 0.7.2 各测一次 1 秒 rAF：两者最小化前都是 **61** 帧，`ShowWindow(SW_MINIMIZE)` 4 秒再还原后仍是 **61** 帧。也就是说，单靠「`restore` 重新打开后台节流」这一步不会立刻白屏，要等 Chromium 真把窗口判成遮挡/隐藏才触发。0.7.2 因此同时关掉 `CalculateNativeWinOcclusion`、壳层永不节流，并把恢复压到 6.7 秒；**遮挡触发场景本身仍未复现**。
- **壳层卡死自愈仍有效**：CDP `Runtime.evaluate while(true){}` 卡死后逐行为 `restart win=main reason=silent streak=3 count=1` → `shell-render-gone reason=crashed` → `shell-reload forced=true` → `heartbeat online`，**6.7 秒**（0.7.1 首轮 9.8 秒、终版 6.7 秒；0.6.4 时期 19 秒）。
- **G1–G3 未重测**：本轮只改壳层出帧与恢复链路，不碰开站/读页/发布，沿用 0.6.9 安装包结论。这是偏离，不冒充已复测。
- **未验证**：`CalculateNativeWinOcclusion` 的真实遮挡场景（此前遮挡实验 `SetForegroundWindow` 不生效，结论不成立）。开关已写进启动参数，但无法从外部观察它是否生效；这一条仍要靠下次真复现的 `crash.log` 对账。

### 2026-11-16 0.7.0 安装包（G1–G3 未重测，只做发布链路自检）

- 包：`release\Sparo-Setup-0.7.0.exe`（105,004,670 字节，2026-11-16 20:00:02，SHA-256 `905FAA4E58719DB8D8E8B538A72C6D34DD8DE5EA24BAAAE3FE0AE333179B20DD`），HEAD `807673a`。
- **G1–G3 本轮未重测**：0.7.0 只改 `strategies/skills/**` 与 `electron-builder.yml` 的资源复制，主进程未改，沿用 0.6.9 包结论。这是偏离，不冒充已复测。
- 产物核对：`resources\social-publish-scripts\adapters\weixin.mjs` 存在且含 `export const weixin`；`resources\platforms\weixin.json` 存在；`app.asar` 内 `weixin-publish/SKILL.md`、`qie-publish/` 均在；包内 `publish.mjs --self-check` = `SELF_CHECK_OK`。
- 微信 `--probe`：`PROBE_OK`（`innerHeight=974`，默认登录态）。探针新开的公众号编辑空页已关闭，其原活动标签属于用户、客户端归属校验拒绝切回。
- 未做：真实存草稿、群发发表、定时发布、正文插图。

### 2026-11-16 0.6.9 安装包 G1–G3 复测

- HEAD `b4a6fa3`。最终包 `release\Sparo-Setup-0.6.9.exe`（104,950,266 字节，2026-11-16 16:48:23，SHA-256 `38E2E2C3283B94A2C3D04F282058F7260EDFA166AD8AC63F76AA89D4BF62324D`），已静默安装到 `D:\Program Files\Sparo`。
- 运行配置隔离在 `%TEMP%\sparo-069-qa-profile`，MCP 3922；登录态从原配置复制，原 `%APPDATA%\sparo-store` 不作为本轮底账。`/health` 正常、81 个工具。发送通道均为 MCP `sidebar_chat`（`hands:true`），底账按 Free Soul 的 `chat-memory.json` + 实际标签 + docs 产物核对。
- **G1 过**：起点百度，原句「打开微博」回执 `navigated:true`、`beforeUrl:https://www.baidu.com/`、`url:https://weibo.com/`。侧栏确认已登录、首页正常；侧栏标签 `7780f9ea` 为微博首页并成为活动标签。
- **G2 过（首轮带明示采集边界）**：前置活动标签 `7780f9ea` 为 `https://weibo.com/u/1497714867`（@汪海林）。原句后产出 `docs\2026-11-16T08-53-11-汪海林微博最近三天内容汇总_2026-11-16.md`（21,160 字节，16:53:11，SHA-256 `B318776A22428FBF6FC81ACC26FE6EC8BAF38BEF3A5BE8C2074F81EC746031CE`）。正文真实包含 11-16、11-15、11-14 三部分；首轮只滚动到 11-14 15:48，文末和回复都明确更早内容未纳入，没有把空段伪称完整。
- **G3 续跑后过**：G2 后紧接原句「把最近 3 天微博逐条复制下来」，另产出 `docs\2026-11-16T08-59-16-汪海林微博逐条记录_2026-11-16.md`（18,891 字节，16:59:16，SHA-256 `34ADFF422B01F9AB5D096F2D11DB8949C1C8748EDD58ADE33BFD20AC00B6DD52`），G2 文件保持不变，不是只改上一份标题。首稿有 45 个编号，其中第 37 是缺口说明占位，且文末明确 11-15 至 11-14 有缺口，所以**首轮不记完整通过**。
- 随后发「继续」，另产出补篇 `docs\2026-11-16T09-01-52-汪海林微博逐条记录_续补_11-15至11-14.md.md`（18,792 字节，17:01:52，SHA-256 `44E5A4BD5A14F5B632125F58907C744005B36634311698ADD0BC6A32F504439C`）。实际读回 40 条：11-15 八条（16:32–00:41），11-14 三十二条（22:28–00:53）；前两份文档哈希不变。
- **已知瑕疵**：续篇回执写的路径末尾只有一个 `.md`，真实文件是 `.md.md`；本记录以真实文件为准，未改名掩盖。折叠为「…展开」的正文只保留页面可见部分，视频未转写，这些边界均已在文档中说明。

### 2026-11-13 0.6.4 安装包级复测（壳层白屏自愈）

- 对象：`release\Sparo-Setup-0.6.4.exe`（103688818 字节，2026-11-13 00:32:43）解出的 `release\win-unpacked\Sparo.exe`。
- 环境隔离：`SPARO_CONFIG_DIR=%TEMP%\sparo-qa-064*`、`SPARO_MCP_PORT=393x`，不动用户 `%APPDATA%\sparo-store` 与已装的 0.6.3。
- **G1 口径（开站 + 读页）过**：MCP `initialize` 拿 `clientId` → `navigate https://weibo.com` → 落到 `passport.weibo.com` 登录页（隔离配置无登录态，属预期）→ `get_url`、`page_text` 读回 77 字登录页正文；`/health` 200。
- **壳层卡死自愈过**：CDP `Runtime.evaluate while(true){}` 卡死壳层主线程后，日志逐拍为
  `repaint streak=3 count=1` → `count=2` → `count=3` → `restart win=main count=4` → `shell-render-gone reason=crashed exitCode=2` → `shell-reload forced=true` → 1.2 秒后 `heartbeat online`，全程 19 秒；主进程存活、`/health` 一直 200、CDP 里 `shell.html` 目标仍在。
- **壳层自发崩溃自愈过**：CDP `Page.crash` 打崩渲染进程 → `render-process-gone` → 1.5 秒后 `heartbeat online`。
- **G2 / G3 未跑**：两条都要已登录微博 + 模型 Key + 真实博主页，隔离配置里没有；本轮壳层改动不碰发布/采集链路，留到用户自己那份登录态上首次使用时验。
- 截图备注：用「整屏截图」取证时抓到的是前台那扇（用户 0.6.3）窗口，不作为本条的视觉证据；本条以 `%TEMP%\sparo-qa-064*\diag\crash.log` 为准。


### 2026-11-13 0.6.5 汇总构建安装包级复测（含 0.6.4 自愈）

- 对象：`release\Sparo-Setup-0.6.5.exe`（103700477 字节，2026-11-13 09:35:31，SHA-256 `4F0055A4E1318A42D9806F966CBABEF459C98F773A2F6FC3EDCEB85537F3B134`）同一份 `release\win-unpacked\Sparo.exe`。
- 环境隔离：`SPARO_CONFIG_DIR=%TEMP%\sparo-qa-065-*`、`SPARO_MCP_PORT=3941`，不动用户 `%APPDATA%\sparo-store` 与已装版本。
- **G1 口径（开站 + 读页）过**：MCP `initialize` 200 → `navigate https://www.baidu.com` 回执 `ok:true`、标题「百度一下，你就知道」、`loadMs=15184` → `page_text` 有正文响应；`/health` 200、工具 81 个。
- 打开产物核对：回执里 `agent.docs` 指向 `release\win-unpacked\resources\docs`；`app.asar` 中能查到本轮三处代码标记 `documentVisible`、`sidebarTabShownForTurn`、`persistTabsNow`。
- **未在安装包上重跑壳层卡死/崩溃自愈**：这两条 0.6.4 已做过安装包级实测（上一条），0.6.5 的差异是「文档隐藏零帧不判停帧」与标签落盘/恢复，由 `tests/page-bounds.test.ts`、`tests/tabs-session.test.ts` 覆盖。
- **G2 / G3 未跑**：需要已登录微博 + 模型 Key + 真实博主页；隔离配置里没有，留到用户自己登录态上首次使用时验。

### 2026-11-09 安装包 G1–G3 复测环境备注

- 测试对象：安装版 **0.3.2**（`D:\Program Files\Sparo`，app.asar 2026-11-09 15:30:44，即交接单 15:30:48 打包批次），3921 属主 `Sparo.exe`（17:21:53 启动），`/health` 200、toolCount 76。发送通道：MCP `sidebar_chat`（hands:true，UTF-8）。
- **底账口径变更**：0.3.0 起侧栏换成 Free Soul 内核（`src/main/browser.ts` handleChat → `freeSoul.run`），侧栏句子**不再写 `missions.jsonl`**；旧验收（新 op=open、brainPlan、realSteps）对侧栏句已不可得。本表 G1–G3 按「chat-memory 助手句 + docs 落盘产物」取证，二者均在本文档底账清单内。G4–G8 及「共用核对」脚本的 missions 期望需按新内核修订后再跑。
- 版本漂移：仓库 HEAD 已由交接单的 `dcbe9d3`（0.3.2 文档收尾）推进到 `dcf7d19`（**0.4.0**，Trae 收官版，47 条脏文件已随该提交入库，工作区现已干净）；`release\Sparo-Setup.exe` 已被重打包为 0.4.0（2026-11-09 17:23:09）。**本次复测的安装版仍是 0.3.2 批次**；0.4.0 安装包的 G1–G3 需另跑一轮。
- missions.jsonl 遗留：底账现存约 190 张未关单（含交接单所列 4 张僵尸单，均从未执行：无 turn、无 findings）。0.3.2 的 `pickInterruptedMission` 只挑「实际执行过」的单，且 `sidebarOffersRecovery()` 恒为 false——僵尸单不会弹恢复提示，侧栏也无正规关单路径（isCancelText 需 ctx.active）。本次未手改底账以免污染证据，G1–G3 验证不受其影响（G 测试前经 `list_agents` 确认侧栏空闲）。

### 2026-11-10 安装包 G1–G3 复测

- HEAD `a31e852`。安装包 `release\Sparo-Setup-0.4.1.exe`（92344030 字节，2026-11-10 19:50:13）。`electron-builder.yml` 的产物名带版本号，没有 `release\Sparo-Setup.exe`。
- 运行的是这份包解出的 `Sparo.exe`：`%LOCALAPPDATA%\Programs\Sparo\Sparo.exe`。`/health` 的 docs 指向 `...\Programs\Sparo\resources\docs`，`app.asar` 19098136 字节，与该安装包一致。开发窗 `electron .` 已停掉后再测。
- 发送通道：MCP `sidebar_chat`（hands:true）。G2 前置用 `navigate` 打开 `https://weibo.com/u/1497714867`。G1 从百度首页发出。

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
