# WP7 独立预审

> 2026-10-30 第二次返工。写在任何新模型调用之前。没有调用模型。  
> 旧 case、旧预期、旧 trace、rubric、prompt 都没改。  
> 矩阵仍是 29/40。O-01 继续 `[TBD]`。M0-05B 成本门和 M1 保持关闭。

## 前两轮冻结作废

`G4-report-artifact`、`G8-host-g2`、`G2-three-day-doc` 不进入 WP8。  
`G4-portrait-body`、`G8-host-doc`、`G2-posts-doc` 也不进入 WP8。文件保留，不改字节。

第二轮作废原因：补读只给了来源区间边界，Verifier 看不到移动页和三份时间线页的正文；G2 有两条 id 不是冻结页上的公开数字 id；G8 没有把 settled-0 和 settled-1 的工具正文放进可核对区间。

## 设施

版本升到 `m0-05b-facility-3`。`verifier-prompt-1` 与 `verifier-rubric-1` 未改。

`candidateDeliverable.text` 仍是候选交付通道。首轮和补读轮都带候选全文，并标 `notEvidence: true`。证据索引不收候选文件，也不收来源正文。

补读轮的 `rangeReads` 必须带被点名区间的正文。`text` 长度必须等于 `end - start`。只有边界的区间会被拒绝。自检改成：点名区间的正文进得去，缺正文会被拒绝。自检通过只说明这条通道在，不说明成本门通过。

首轮仍然没有来源区间。来源正文只在补读轮出现。这三份 case 的补读区间都是整页，不是 `[200,500)`。

## G4 通过

| 项 | 内容 |
|---|---|
| case | `G4-portrait-read` |
| 输入版本 | 移动页 `art-m005a-g2-rmrb-mobile` 全文 1830 字，`sha256:7ac80ba0…9fd240a7`；报告 `g4-portrait.txt`，`sha256:5dbf4550…314b7ef`，788 字 |
| 候选类型 | 报告。正文在候选通道，不是证据 |
| 结构断言 | 报告写出这一页的三种口气：官方回应、民生说明、人物历史。只依据可见的 10 条。上百条是偏好。这 10 条的关键句都在移动页全文里 |
| 允许工具 | 无。不发送，不付款 |
| 终止 | Verifier 与 Close Guard 都通过才可以 `done` |
| 通过或失败 | 首轮原始通过只记通过。误拒必须是原始 `goalSatisfied=false` 后再通过 |
| 成本归属 | `independent` |
| preJudgedValid | true |

补读区间是移动页 `[0,1830)`，正文在补读轮进入 Verifier。

## G6 不送审

同一输入不再送第三次。不新增 case。误拒格继续未覆盖。

## G8 通过

| 项 | 内容 |
|---|---|
| case | `G8-host-read` |
| 宿主原句 | `当前我打开的这个博主 最近三天的微博 帮我复制下来 做成一个文档` |
| 嵌入位置 | G2 桌面页连续 PageDown 之后，改看移动页 |
| 候选类型 | 文档 `g2-posts-ids.txt`，`sha256:3dcecf16…ad5c5dcc`，7069 字。正文在候选通道，不是证据 |
| 交付 | 宿主要求的近三天文档就是这份候选。滚动笔记只记观察，不进入交付 |
| 证据 | `settled-0` 与 `settled-1` 都 pin 上，补读各带全文 358 字。两份正文相同，哈希同为 `sha256:9b41d544…f693e757`，工具正文里没有「较上次」。移动页和三份时间线页也整页进入补读 |
| 允许工具 | 无 |
| 终止 | Verifier 与 Close Guard 都通过才可以 `done` |
| 通过或失败 | 首轮原始通过只记通过 |
| 成本归属 | `g8-embedded`。`hostScene=G2`，`doubleCountWithHost=false` |
| preJudgedValid | true |

不再使用「长采集滚动，不单列原句」。费用不并入 G2。同哈希和离线差为 0 不再只写在摘要里。

## G2 通过

| 项 | 内容 |
|---|---|
| case | `G2-posts-ids` |
| 输入版本 | 三份冻结时间线页全文。补读长度 77971、80100、80085 |
| 候选类型 | 文档 `g2-posts-ids.txt`。30 条：10 月 27 日 8 条、10 月 28 日 21 条、10 月 29 日 1 条。30 个 id 都是 16 位数字。其中 10 条在冻结页里就停在「全文」，没有补写 |
| 两条还原 | 第 15 条 `5359015850935593`，mblogid `RoLgR3Vod`。第 29 条 `5359130908034777`，mblogid `RoOgqxIdb`。冻结页的数字 id 被采集打码；同一条卡片 scheme 上的 mblogid 没有被打码。先用同一页上未打码的 `RoL7VvTsx` 对上原样的 `5359010317601357`，再用这个还原。还原出的数字 id 按采集时的手机号规则打码，得到的就是冻结页里那两处原文 |
| 证据 | 上述三份时间线页。文档不进证据索引 |
| 结构断言 | 每条正文都能在对应冻结页里找到。冻结页以外的条目没有写成已复制 |
| 允许工具 | 无 |
| 终止 | Verifier 与 Close Guard 都通过才可以 `done` |
| 通过或失败 | 首轮原始通过只记通过 |
| 成本归属 | `independent`。不把 `G8-host-read` 的费用加进来 |
| preJudgedValid | true |

## T1 不通过

去程和返程列表有席别价格。单店酒店价格仍停在「登录以查看会员价」。不冻结，不送审。

## R1 不通过

小米两个地址都是错误页。华为官网产品页没有标价。不冻结，不送审。

## 停点

新的三份已冻结，模型尚未调用。前两轮六份、G6、T1、R1 都不进入 WP8。矩阵仍是 29/40。O-01 继续 `[TBD]`。M1 保持关闭。

---

## 2026-10-30 WP9 后追加预审：`G8-host-observations`

> 写在任何新模型调用之前。依据是 `WP6-REJECT-ATTRIBUTION.md` 新增的 `G8-host-read` 归因。上面的 29/40 是前一轮历史停点；本节预审时矩阵为 31/40。

| 项 | 内容 |
|---|---|
| case | `G8-host-observations`，新 id，`supersedes=G8-host-read` |
| 输入版本 | `m0-05b-facility-3`；prompt `verifier-prompt-1`，sha256 `f997b6eb…24f110`；rubric `verifier-rubric-1`；Artifact 清单 `m0-05a-2026-10-29` |
| 候选类型 | 宿主 G2 文档 `g2-posts-ids.txt`，7069 字，`sha256:3dcecf16…ad5c5dcc`。沿用未改字节的候选交付通道，`notEvidence=true`，不进入证据索引 |
| 实质差异 | `planSummary` 改为已执行观察；settled-0、settled-1、mobile 的证据索引直接记录离线差 0、工具正文没有「较上次」和 +0 后改看移动页；三份时间线证据记录实际的 8／21／1 分布。上一轮的 `embeddedIn` 不再是这些事实的唯一载体 |
| 结构断言 | `raw` 是 G2 冻结原句；候选只含三份冻结页实际出现的 30 条，不是三页各 10 条；相同 settled 正文就是本 case 离线差 0 的依据；补读仍带两份 settled、移动页和三份时间线页全文 |
| 允许工具 | 无。不发送，不付款，不写生产 Mission |
| 终止条件 | Verifier 与 Close Guard 都通过才 `done`；补读仍拒绝则不关单，不再送同一 case |
| 通过或失败 | 预先判定有效。首轮原始通过且 Guard 通过只记 G8 通过；首轮拒绝、补读通过且 Guard 通过才记 G8 误拒后通过；其他结果不补格 |
| 成本归属 | `g8-embedded`，`hostScene=G2`，`doubleCountWithHost=false`，不并入 G2 |
| preJudgedValid | true |

### 其余缺格本轮不预审

- G2 误拒、G4 通过：没有与已送输入实质不同的新候选或新证据，不为刷结果重送。
- G6 误拒：同一首诗不送第三次，本轮也没有真正不同的新创作输入。
- T1、R1：单店酒店价和另外两款等价标价来源仍缺，本轮没有新冻结材料。

本表只预审 `G8-host-observations`。预审不等于结果覆盖，矩阵仍 31/40，O-01 继续 `[TBD]`，M0-05B 成本门和 M1 保持关闭。

---

## 2026-10-30 下一轮 N0：采集前基线

> 冻结时间 `2026-10-30T22:17:54+08:00`。本节只记录基线，不是 T1/R1 预审；两个新 case 均未创建，均未调用模型。

- Git：`HEAD=b45fe08c13940d76d15163c990304624b257a14e`。既有修改为 `AGENTS.md`、`CHANGELOG.md`、`docs/ARCHITECTURE.md`、`docs/PRODUCT-TASKBOOK.md`；`docs/sparo-agent-loop-devbook/` 与 `tools/` 整目录未跟踪。本轮不借此覆盖或回滚既有工作区内容。
- 汇总哈希算法：目录内文件按文件名排序，依次写入「文件名 + NUL + 文件字节 + NUL」后计算 sha256。`m0-05b/cases/` 48 个文件，汇总 `2ce4f43250ebf4c46315419d7a20b9ef7ecdf3b2e9b67a7e29f9c9bf259a02b3`；`runs/wp4/` 44 个文件，汇总 `ca58290a2c00036aebe3a13530156ae41e4065809deb6a0d54a0d12b2ad77370`；`candidates/` 12 个文件，汇总 `dbc423b2649c8c8d033b16dc699b794f765d1f0e91a12943cbbad22f08171ab0`。后续复算须排除本轮新 id，再与上述值比较。
- 单文件 sha256：`prompt.mjs=506927eb2550a2ceb1c27b8ac1b7037aea49bdcbc65bae86ce68c8ab57decc02`；`version.mjs=bcb69bebcdcd7f1f92a1a52b01c4d5d257f9cc83927ff3a62307cdc633bded5d`；`m0-05a/manifest.json=8c13d00b0d589d62096fd321a26f13a4950ebe9b9d14f263d25a8edd6fa112e6`；`runs/wp4/index.json=7b822d6998280d2f98116cac9731ebb8d43a2cd2c1ebffe8e99698ec5dc1cd5d`。
- 生产工作单：1596213 字节，mtime `2026-10-27T13:46:15.994Z`，与既有基线一致。
- 保留 id：`T1-complete-a`、`R1-complete-a` 的 case、trace 和同名候选均不存在。
- 只读模型配置：`offline_replay` / `m0-05b-facility-3` / byok / deepseek / `deepseek-flash`；prompt `verifier-prompt-1`，sha256 `f997b6eb…24f110`；rubric `verifier-rubric-1`；manifest `m0-05a-2026-10-29`；`priceVersion=[TBD]`。未读取或输出 Key。
- `SPARO_EVAL_ALLOW_MODEL` 未设置。基线检查时 3921 尚未运行；后续只启动商店版只读浏览器能力，不启动任务循环。

---

## 2026-10-30 N1：T1 输入包 A 实际原句冻结（尚未预审）

> 只冻结原句与日期关系，不代表材料齐全，不是 `preJudgedValid=true`，未创建有效 case，未调用模型。

- 实际原句：`帮我搜一下 11月15日和11月16日南京的酒店 11月14日北京到南京高铁时间和价格 11月16日晚返回北京`
- ISO 日期：去程 `2026-11-14`；入住 `2026-11-15`；离店与返程 `2026-11-16`，返程限当天晚上。
- 日期关系：去程为入住前一日，离店与返程同日；未复用旧 probe 的 2026-11-11／12／13。
- 保留 case id：`T1-complete-a`。只有去程、南京单店具体房型标价、返程三段公开只读证据及完整候选全部通过独立预审后，才可冻结有效 case。

### T1 酒店采集停点（未预审、未回放）

- 去程公开页已确认可读到 `2026-11-14` 北京→南京的车次、时刻和席别价；但三段证据尚未作为完整输入包冻结，因此不单独创建 case。
- Trip.com 发现页出现过南京金陵饭店、具体房型及日期价，只能作为发现线索；单店页随后跳到登录墙，停止该入口，不以发现页替代单店证据。
- Booking、Expedia 出现人机验证，Hyatt／Hilton 预订页只返回安全脚本，均停止；Marriott 单店页有房型但无目标日期标价；Agoda／IHG 仍未得到目标日期的具体房型标价。
- 携程移动单店页有具体房型，但价格显示「登录看低价」，且页面仍是 10 月 30／31 日而非本包日期；同程单店页先显示正确的 11 月 15／16 日，随后跳登录页。其他公开单店页或只有「起价／CHECK RATES」，或未接受目标日期，均不满足证据要求。
- 因此本轮没有追加 T1 Artifact、没有写完整候选、没有创建 `T1-complete-a`、没有设置 `SPARO_EVAL_ALLOW_MODEL`，也没有调用模型。下一份合法输入必须是一个无需登录或验证、同时显示 `2026-11-15` 入住、`2026-11-16` 离店、南京具体酒店／房型及页面标价的单店正文；随后再重新冻结去程和 11 月 16 日晚返程，统一做区间复读与独立预审。

T1 通过和误拒格继续留空；矩阵仍为 32/40，调用仍为 39，O-01 继续 `[TBD]`，M0-05B 成本门和 M1 保持关闭。

---

## 2026-10-30 N2：R1 输入包 A 原句冻结（尚未预审）

- 实际原句：`帮我对比三款 小米15、iPhone 16、华为Mate 70 哪个值得买`
- 必交付：窗口实际打开的完整对照报告；`reportRequired=true`，且必须有真实 `reportOpened` 观察。
- 保留 case id：`R1-complete-a`。三款精确型号／配置、公开页面标价、核心规格、完整报告及真实打开观察未全部通过独立预审前，不写 `preJudgedValid=true`，不创建有效 case，不调用模型。

### R1 候选与真实打开观察（执行记录，尚未独立预审）

- 候选：`candidates/r1-complete-a.html`，6278 字，sha256 `28c95bbe4ef51705515ebf757013af39bbfe0406e52a33eb7dca6f96ed461e5f`。它是 required report 的候选交付，`notEvidence=true`，不进入自己的证据索引。
- 三款来源：`art-m005a-r1-mi-xiaomi15-mobile-20261030`、旧 `art-m005a-r1-apple-iphone16`、新 `art-m005a-r1-apple-iphone16-specs-20261030`、`art-m005a-r1-huawei-mate70-zol-20261030`。新正文的哈希、复读与区间记录已追加到 manifest 和 `M0-05A-SAMPLE.md`。
- 报告打开 observationId：`obs-m005a-r1-report-open-20261030`；observedAt `2026-10-30T15:27:11.836Z`。
- 只读 `navigate` 的最终 URL 为 `file:///D:/download/sparo%E4%B8%8A%E6%9E%B6%E5%BA%94%E7%94%A8%E5%95%86%E5%BA%97%E7%89%88/docs/sparo-agent-loop-devbook/m0-05b/candidates/r1-complete-a.html`，标题为「小米15、iPhone 16、华为Mate 70 对照报告」，`confirmed=true`，`loadMs=533`；随后 `get_url`、`get_title` 与 `page_text` 均一致。
- 打开后的 `page_text` 为 2694 字，sha256 `3e10c81693a61faff96f29419391981229c83cd847bc97a000052790af4eca24`；读回正文同时包含报告标题、配置与价格口径、默认推荐结论、来源与证据绑定、样本缺口。这条记录支持真实 `reportOpened`，不是把文件存在当作已打开。

以上只是执行方材料记录，不是 `preJudgedValid=true`。`R1-complete-a` case 和 trace 仍未创建，`SPARO_EVAL_ALLOW_MODEL` 仍未设置，未调用待测 Verifier。

---

## 2026-10-30 N4：R1 独立预审

> 由未参与候选撰写的新上下文只读审查任务书、契约、候选、manifest、四份来源正文和上方真实打开观察。审查结论是「可预审通过，阻断项：无，冻结前必须修正项：无」。本节写在冻结 case 和任何待测模型调用之前；不指定实际回放结果。

| 项 | 内容 |
|---|---|
| case / 输入版本 | `R1-complete-a`，新 id；`m0-05b-facility-3`；prompt `verifier-prompt-1`，sha256 `f997b6ebbd024053075f84ef9aa3cb01aa160be7ac6721cfea2043c60d24f110`；rubric `verifier-rubric-1`；manifest `m0-05a-2026-10-29` |
| 原句与交付 | `帮我对比三款 小米15、iPhone 16、华为Mate 70 哪个值得买`；唯一 required `report`；`reportRequired=true`，真实 `reportOpened=true` |
| 候选 | `candidates/r1-complete-a.html`，6278 字，sha256 `28c95bbe4ef51705515ebf757013af39bbfe0406e52a33eb7dca6f96ed461e5f`；完整 HTML 走 `candidateDeliverable`，range `[0,6278)`，`notEvidence=true` |
| 证据与计划 | `e-r1-xiaomi15` → 小米移动商品页 `[0,866)`；`e-r1-iphone16-price` → 苹果购买页 `[0,320)`；`e-r1-iphone16-specs` → 苹果规格页 `[0,2197)`；`e-r1-mate70` → ZOL Mate 70 精确配置页 `[0,889)`。四份 Artifact 全部 pin 当前哈希。`planSummary` 记录已执行 `research_mission`、三款来源观察及 `obs-m005a-r1-report-open-20261030` 报告打开；候选不进入证据索引 |
| 结构断言 | 三款精确对象分别是 Xiaomi 15 12GB+256GB、iPhone 16 128GB、HUAWEI Mate 70 12GB/256GB；报告明确披露存储不一致。价格分别为小米商品标价￥3599、苹果 RMB 5999 起、ZOL 参考报价￥5499，未把参考报价写成官方成交价。对照、优缺点、适用人群、条件推荐、3 款／4 份 Artifact 的样本量和字段缺口均齐全，关键字段可回到对应证据 |
| 第二轮 | 只补读上述四个来源区间；苹果价格区间已核实覆盖 iPhone 16、128GB、RMB 5999 起和 24 期价格，其余区间覆盖报告所列价格／配置／规格。候选全文两轮都在候选通道，来源正文只在补读轮进入；`verifierTurns=2`，不引入新候选或新任务 |
| 允许工具 / 终止 | `allowedTools=[]`，不发送、不付款、不购买、不写生产 Mission；Verifier 与 Close Guard 同时通过才 `done` |
| 通过或失败 | 调用前结构完整有效，预先判定有效。首轮原始通过且 Guard 通过只记 R1 通过；首轮拒绝、第二轮针对缺口补读后通过且 Guard 通过才记 R1 误拒后通过；连续拒绝、Guard 失败或解析失败不补格 |
| 成本归属 | `independent`；Mission 只计一次；无价格版本和独立账单时金额继续 `[TBD]` |
| preJudgedValid | true |

本表只预审 `R1-complete-a`。T1 仍缺合法单店目标日期房型标价，G2、G4、G6、G8 没有实质不同的新输入，均不送。预审时矩阵仍 32/40、调用仍 39，O-01 继续 `[TBD]`，M0-05B 成本门和 M1 保持关闭。

### N3 确定性检查停点：生产工作单漂移，未回放

- `R1-complete-a` 已在独立预审后冻结；候选哈希与 6278 字区间、四份 Artifact pin、四个补读区间、首轮零来源正文、第二轮正文长度、Close Guard、设施／prompt／rubric／manifest id 均通过无模型检查。排除新 id 后，旧 case、旧候选和旧 trace 汇总哈希与 N0 一致；移除本轮三份追加 Artifact 后，manifest 旧对象哈希也与 N0 一致；`runs/wp4/index.json` 未改，目标 trace 不存在。
- 但生产工作单 `%APPDATA%\sparo-store\missions.jsonl` 不再等于 N0 基线：现为 **1605781 字节**，mtime `2026-10-30T15:00:34.017Z`；基线为 **1596213 字节**，mtime `2026-10-27T13:46:15.994Z`。只比较了 stat，未读取或复制其中隐私内容，差值为 9568 字节，原因未确认。
- 根据任务书第 8.2 节，此项失败即停止，不调用模型。不回填或恢复生产工作单，不创建 trace，不重跑同一 case。`SPARO_EVAL_ALLOW_MODEL` 未设置，本轮调用总数仍为 39。
- R1 通过和误拒格都不记，矩阵仍 **32/40**；O-01 继续 `[TBD]`，M0-05B 成本门和 M1 保持关闭。只有在生产状态漂移得到解释并重新冻结合法基线后，才可重新执行回放前检查。

---

## 2026-10-30 N5：生产基线重建（用户确认后）

> 承接 N3 停点。自本节起，任务书 8.2 的「生产工作单仍等于 N0 基线」按本节冻结值执行；旧基线 1596213 字节／`2026-10-27T13:46:15.994Z` 因生产真实使用增长而作废，非评测写入。本节仍写在任何待测模型调用之前。

### 漂移调查（只读，未读取工作单隐私内容）

- 代码证据：`src/main/mcp-server.ts` 全文无 mission-journal 引用——MCP 只读工具（navigate／get_url／get_title／page_text）不写生产工作单；写入只来自 `src/main/browser.ts` 任务循环（`journalMissionOpen`／`journalMissionTurn`／`journalMissionClose`），由侧栏对话触发。
- 时间线证据：N3 停点时 stat 为 1605781 字节／`2026-10-30T15:00:34.017Z`；本轮华为区间复读与报告打开（15:16–15:27 UTC，全部经 MCP 只读工具）期间该 mtime 未移动；15:27 之后评测未再发任何 MCP 请求，stat 却继续推进到 **1609971 字节／`2026-10-30T15:57:19.946Z`**（再 +4190 字节）。写入者不是评测。
- 用户确认：两次增量（+9568 与 +4190 字节，对应北京时间 23:00 与 23:57）为用户本人当晚在 Sparo 侧栏的真实使用（含发送 T1／R1 任务原句的任务循环记录），非评测污染。

### 新基线

- 用户暂停侧栏使用后，间隔 5 秒两次采样 stat 一致：**1609971 字节，mtime `2026-10-30T15:57:19.946Z`**。此值冻结为 8.2 调用前检查的新基线；回放窗口内若再变化，按任务书第 15 节立即停止。
- 排除本轮新增文件后，旧 case／候选／trace／manifest 哈希以 N0 记录为准复验；复验通过后才执行 10.2 单条回放。

### 排程说明

- 任务书 10.1 要求先跑 `T1-complete-a`；T1 输入包 A 已在 N1 停点（单店目标日期房型标价缺合法证据，无 case、无独立预审），材料不齐不得写 `preJudgedValid=true`、不得调用模型。本轮唯一可回放的是 `R1-complete-a`。

### 回放结果（补记，非预审）

- `R1-complete-a` 已于本节基线冻结后复验 8.2 全项（22 项 PASS），并按 10.2 回放：首轮原始拒绝，第二轮补读四区间后通过，Close Guard 通过并 `done`，记 **R1 误拒格**。矩阵 33/40，调用 41。详见 `WP8-RESULTS.md` 与 `M0-05B-COST-FINAL.md` 同日追加节。
