# M0-05B 下一轮补格与成本门任务书（32/40 起）

> 2026-10-30。当前执行入口的续作，不重跑 WP0–WP5，不回头改旧结果。
> 目标不是「想办法让模型过」，而是补足合法输入、冻结新 case、按真实结果记格，并把成本证据补齐。

## 1. 当前停点

- 矩阵：**32/40**。
- 已覆盖 G8 通过；本轮还缺 8 格：**G2 误拒、G4 通过、G6 误拒、G8 误拒、T1 通过、T1 误拒、R1 通过、R1 误拒**。
- 调用总数：**39 = 原 33 + 上一组 5 + G8 追加 1**。调用数不等于冻结 case 数。
- O-01：`[TBD]`。M0-05B 成本门和 M1 都关闭。
- 当前设施：`m0-05b-facility-3`。
- 模型：商店版 byok / deepseek / `deepseek-flash`。
- prompt：`verifier-prompt-1`，sha256 `f997b6ebbd024053075f84ef9aa3cb01aa160be7ac6721cfea2043c60d24f110`。
- rubric：`verifier-rubric-1`。
- Artifact 清单：`m0-05a-2026-10-29`；新增样本只追加，旧样本不覆盖。
- 生产工作单 `%APPDATA%\sparo-store\missions.jsonl` 基线：1596213 字节，mtime `2026-10-27T13:46:15.994Z`。

### 本轮实际排程

| 优先级 | 工作 | 原因 |
|---|---|---|
| P0 | T1 完整输入包 A，预审后单条回放 | 酒店、去程、返程都有明确缺口，能靠真实只读材料补齐 |
| P1 | R1 完整输入包 A，预审后单条回放 | 只缺另外两款手机的同等公开来源及完整报告，能靠真实只读材料补齐 |
| P2 | 只有仍有空格且出现实质不同的新输入时，才准备 T1/R1 输入包 B | 一个 case 只记一种实际结果，不能用同一份输入刷另一格 |
| 并行 | 找价格版本、价格日期和独立账单导出 | 矩阵补齐本身仍不足以提出 O-01 |
| 不排 | G2、G4、G6、G8 新模型调用 | 当前没有足够不同的新输入；G6 换新诗也没有合法的第二轮新信息 |

## 2. 开始前只读这些

| 文件 | 必须核对的内容 |
|---|---|
| 根目录 `AGENTS.md` | 工作区、禁区、发送与付款边界 |
| `M0-05B-CLOSEOUT-TASKBOOK.md` | 当前 WP6→WP7→WP8→WP9 收尾顺序 |
| `M0-03-CONTRACT.md` | 原句、观察、证据、Artifact、Verifier、Guard、trace |
| `M0-01-TASK-SET.md` | R1/T1 的真实原句和日期关系 |
| `m0-05b/WP6-REJECT-ATTRIBUTION.md` | 已发生的拒绝归因，尤其 G8 最新追加节 |
| `m0-05b/WP7-PREJUDGMENT.md` | 哪些旧 case 作废，以及新 case 预审格式 |
| `m0-05b/WP8-RESULTS.md` | 32/40 的实际记格 |
| `M0-05B-COST-FINAL.md` | 39 次调用的分组、Token 和 `[TBD]` |
| `M0-05B-COST.md` | 只读历史；33 次数字和 29.515074 美元测算不改、不回填 |
| `m0-05a/manifest.json` | 旧 Artifact id、哈希、locator 和追加位置 |
| `tools/eval/m0-05b/case-runner.mjs` | 单 case 行为、第二轮、实际记格条件 |
| `tools/eval/m0-05b/verifier-input.mjs` | 默认输入、候选正文和指定区间补读边界 |

发现本文与上述冻结契约冲突时，停手登记，不现场改规则。

## 3. 禁改项与安全边界

1. 不改原版仓库 `D:\download\Sparo`，不向原版搬 `src/main/cloud/`。
2. 不改 `verifier-prompt-1`、`verifier-rubric-1`、`tools/eval/m0-05b/prompt.mjs` 或 rubric 版本。
3. 不运行 `tools/eval/m0-05b/freeze-cases.mjs`，不运行全量 `run-wp4.mjs` / `run-wp8.mjs`。
4. 不修改、重命名或删除任何旧 case、旧 trace、旧候选；不把旧设施版本改成 facility-3。
5. 不改 `runs/wp4/index.json`。新 trace 只写 `runs/wp4/<new-case-id>.json`。
6. 不改 `M0-05B-COST.md`。本轮结果只追加到 `WP8-RESULTS.md` 和 `M0-05B-COST-FINAL.md`。
7. 不写生产 Mission，不发送、不付款、不订票、不购物、不绕过登录或验证码。
8. 遇到登录、验证码、付款或权限墙，停止该入口并记录；换一个公开只读入口，不伪装成已观察。
9. 全文网页不进入默认 Verifier 输入。候选交付正文可按 facility-3 的 `candidateDeliverable` 通道提供；来源正文只走点名区间。
10. 不把候选文档、报告或诗放进自己的证据索引自证。候选是交付，不是来源证据。
11. 不改 `docs/listings/`，不改产品运行时代码，不打安装包。

## 4. 角色与产物

### 执行方

负责只读采集、候选撰写、哈希与区间整理、无模型自检、单条回放和成本记录。执行方不能在看到模型结果后回头改预审或旧 case。

### 独立预审方

使用未参与候选撰写的新上下文，只读契约、原句、候选、证据索引和 Artifact。预审方不是待测 Verifier，不调用模型替候选判过。

### 每个输入包的产物

- 新 `artifactId` 的冻结正文及 manifest 追加记录。
- `M0-05A-SAMPLE.md` 的追加修订记录，旧结论保留。
- 新候选文件，建议命名：
  - `candidates/t1-complete-a.txt`
  - `candidates/r1-complete-a.html` 或 `.txt`；R1 必须另有真实报告打开观察。
- 新 case：`T1-complete-a`、`R1-complete-a`。B 包只在满足第 10 节时启用。
- `WP7-PREJUDGMENT.md` 追加独立预审。
- `runs/wp4/<case-id>.json` 新 trace。
- `WP8-RESULTS.md`、`M0-05B-COST-FINAL.md` 追加实际结果和用量。

上述名字是保留 id，不代表已经预审通过；材料不齐时不要先造「有效」case 壳。

## 5. N0：冻结基线，无模型

- [ ] 记录当前 git 状态，区分本轮文件和既有工作区改动。
- [ ] 对现有 `m0-05b/cases/` 与 `runs/wp4/` 做汇总哈希，后续排除新 id 复算必须一致。
- [ ] 记录候选、`prompt.mjs`、rubric 所在版本文件的哈希。
- [ ] 记录生产工作单字节数和 mtime，不读入或复制其中的隐私内容。
- [ ] 确认拟用 case id、候选文件名和 trace 文件名均不存在。
- [ ] 确认模型配置只返回预期的 facility、provider、llmMode、modelVersion，不打印 Key。
- [ ] 本轮尚未设置 `SPARO_EVAL_ALLOW_MODEL=1`，尚未发生模型调用。

任何旧文件在采集前已出现无法解释的漂移，先停点，不拿新输入覆盖问题。

## 6. N1：T1 完整输入包 A

### 6.1 先冻结实际原句

使用 `M0-01-TASK-SET.md` 的词序：

```text
帮我搜一下 {入住日}和{离店日}南京的酒店 {去程日}北京到南京高铁时间和价格 {返程日}晚返回北京
```

日期必须满足：

- 执行当天重新选择可查询的未来日期，不能复用旧 probe 的 11 月 11–13 日历史输入。
- 去程日 = 入住日前一天。
- 离店日 = 返程日，返程为当天晚上。
- 在 case 和 WP7 记录完整实际原句，不只写模板。
- 不额外添加评分、地区、路线、人数等用户没说过的硬条件；页面已有的入住人数或币种信息可如实记录。

### 6.2 只读采集三组必需 Artifact

| 分段 | 必须看到的页面事实 | 不能替代它的材料 |
|---|---|---|
| 去程 | 实际去程日、北京→南京、车次、发到时间、席别及价格 | 其他日期页面、只有车次没有价格、酒店入住日页面 |
| 酒店 | 南京、实际入住／离店日、具体酒店、具体房型及页面标价；税费、币种、入住人数若页面展示则照录 | 多酒店搜索壳、无房型的概括、无关日期、酒店图片、候选自述 |
| 返程 | 实际返程日晚、南京→北京、车次、发到时间、席别及价格 | 去程证据复用、其他日期、只写「有票」而无时刻和价格 |

采集规则：

- 使用商店版只读能力，优先结果页 URL 和 `page_text`；记录来源 URL、工具、`observationId`、`capturedAt`。
- 酒店必须落到单店房型价格证据；发现页可以保留，但不能单独充当酒店价格证据。
- 每个 Artifact 使用新 id，登记长度及单位、内容哈希、本地相对 locator、脱敏情况。
- 每个用于补读的代表性区间独立复读两次，文本和哈希一致才可用。
- 页面没有价格就写缺失，不估算，不拿缓存知识补。
- 三组证据各自独立；一条发现不能同时抵去程、返程和酒店。

### 6.3 写完整候选答案

候选必须是可直接验收的 `answer`，至少包含：

1. 实际日期和完整三段行程。
2. 去程车次、时刻、席别价格及对应 `evidenceId`。
3. 单店酒店、房型、入住／离店日、标价及对应 `evidenceId`。
4. 返程日晚车次、时刻、席别价格及对应 `evidenceId`。
5. 页面未展示的字段明确写「未展示」，不补猜。
6. 明确只查询，不订票、不付款。

候选文件落盘后记录 UTF-8 字符数和 sha256。候选中的推断必须有来源证据；观察事实不得只写在 `candidateSummary`。

### 6.4 组装 case 的最低结构

- `raw`：第 6.1 节的完整实际原句。
- `planSummary`：写明已执行的 `trip_plan`，以及去程、酒店、返程三个实际观察，不写「应该查询」。
- `deliverables`：一个 required `answer`。
- `candidateDeliverable`：完整候选正文、哈希、字符区间、`notEvidence=true`。
- `evidenceIndex`：去程、酒店、返程至少各有独立证据记录，带 Artifact 引用和合法 `contentRange`。
- `artifactPins`：覆盖全部来源 Artifact 的当前哈希。
- `followUpSummary`：说明第二轮只补读哪些来源区间，不引入新候选或新任务。
- `followUpRanges`：优先每段 `[200,500)` 的精确区间；正文更短时可读完整正文。区间必须覆盖查询日期、地点、时刻／房型与价格，而不是只截页面标题。
- `evalBudget.verifierTurns`：完整包可冻结为 2；没有针对性补读区间时只能为 1，且该 case 不可能记误拒后通过。
- `guardFacts.reportRequired=false`。其余 Guard 事实只能按真实观察填写。
- `allowedTools=[]`、`sendTool=false`、`payTool=false`、独立成本桶。

### 6.5 T1 预审前否决项

任一成立就不送模型：

- 日期关系错误或沿用旧 probe 原句。
- 去程页日期不是实际去程日。
- 只有酒店列表，没有单店房型和标价。
- 返程证据缺失，或拿去程证据抵返程。
- 计划没有 `trip_plan` 或没有真实观察。
- 候选答案缺任一必交付段。
- 补读区间为空、错位、超出正文或复读不一致。

## 7. N2：R1 完整输入包 A

### 7.1 冻结原句与交付

原句保持：

```text
帮我对比三款 小米15、iPhone 16、华为Mate 70 哪个值得买
```

必交付是窗口实际打开的对照报告，不是侧栏对照表，也不是只有搜索笔记。

### 7.2 三款手机要有同等地位的来源

| 对象 | 最低来源要求 | 必须摘录的可比字段 |
|---|---|---|
| 小米 15 | 新采集的官网或同等公开产品／购买页 | 精确型号与配置、页面标价、用于对比的核心规格、来源时间 |
| iPhone 16 | 可复核复用已冻结苹果官网 Artifact；若身份或内容对不上则新采 | 精确型号与配置、页面标价、用于对比的核心规格、来源时间 |
| 华为 Mate 70 | 新采集的官网或同等公开产品／购买页 | 精确型号与配置、页面标价、用于对比的核心规格、来源时间 |

「同等地位」指来源都能直接支撑对应产品的价格与规格，不要求三款标价相同。尽量对齐存储等配置；不能对齐时在报告中明示，不能暗中拿不同配置做等价结论。

- 百度搜索入口可以留作发现证据，不能单独支撑价格或规格。
- 不直开京东、淘宝、点评。
- 不因某官网难读就拿商品图片、搜索摘要或候选报告自证替代。
- 每个新来源按第 6.2 节同一 Artifact 规则追加、哈希和复读。

### 7.3 写并实际打开报告

报告至少包含：

1. 三款精确型号与配置；配置不一致的说明。
2. 同维度对照表，每项关键价格／规格都能回到对应 `evidenceId`。
3. 页面标价及采集时间；不把标价写成成交价或历史最低价。
4. 优缺点与适用人群；推断有依据，不伪装成页面原话。
5. 明确的「哪个值得买」结论，以及结论成立的条件。
6. 实际样本量、缺口和未展示字段。

R1 的 Guard 不能只靠 `requiredArtifactsExist`：

- `reportRequired=true`。
- `reportOpened=true` 只能来自真实报告打开观察，记录对应 `observationId` 或稳定定位。
- 文件存在不等于报告已经打开；没有打开观察就不预审为有效，不运行通过 case。

### 7.4 组装 case 的最低结构

- `planSummary`：写明真实 `research_mission`、三款来源观察和报告打开，不写「打算对比」。
- `deliverables`：一个 required `report`。
- `candidateDeliverable`：完整报告正文、哈希、字符区间、`notEvidence=true`。
- `evidenceIndex`：三款产品各有独立来源记录；搜索入口与产品证据分开。
- `artifactPins`：三款实际使用的正文版本全部钉住。
- `followUpRanges`：按首轮可能缺失的价格／规格／配置位置冻结精确区间，不默认读整页。
- `guardFacts`：报告存在和打开都必须为真，其余权限、计划、预算、状态检查按事实填写。
- 禁止自动购买，独立成本桶。

### 7.5 R1 预审前否决项

- 任一款只有搜索摘要或图片，没有可读来源正文。
- 型号或配置混用，报告未披露。
- 报告缺对照、推荐结论或证据绑定。
- 报告没有真实打开观察，却写 `reportOpened=true`。
- 计划缺 `research_mission` 或计划步无观察。
- 使用京东、淘宝、点评作为直开入口。
- 来源区间无法复读，或候选报告被放进自己的证据索引。

## 8. N3：Artifact 追加与无模型自检

### 8.1 Manifest 追加

- 只向 `m0-05a/manifest.json` 的 `samples` 追加新对象，不修改旧对象字段和顺序。
- 新对象至少含：稳定 `artifactId`、`missionId`、来源 URL、工具与 `observationId`、`capturedAt`、内容类型、长度及单位、`contentHash`、`frozenVersion`、相对 `locator`、脱敏说明。
- `M0-05A-SAMPLE.md` 追加本次修订日期、输入包、缺口是否关闭；旧缺口历史不删除。
- 沿用当前 `manifestSampleSetId=m0-05a-2026-10-29` 时，必须保留上述追加历史；不得用同一 id 偷偷替换旧正文。
- 新 case 的 `manifestSampleSetId` 必须等于设施实际加载的清单 id。

### 8.2 每个 case 调用前的确定性检查

- [ ] JSON 可解析，`frozen=true`，新 id，`prejudgedBeforeModelCall=true`。
- [ ] WP7 已在模型调用前写明 `preJudgedValid=true` 及理由。
- [ ] facility、prompt 哈希、rubric、manifest id 与当前设施完全一致。
- [ ] 实际原句逐字等于任务书／任务集，T1 日期关系正确。
- [ ] 候选文件 sha256、字符数和 `candidateDeliverable.range` 一致。
- [ ] 候选不在 `evidenceIndex`；来源 Artifact 的哈希全部与 manifest 一致。
- [ ] 证据 id、交付 id、计划段无重复抵充；T1 三段、R1 三款逐一齐全。
- [ ] 首轮 `rangeReads=[]`，没有来源全文偷渡进默认输入。
- [ ] 第二轮每个区间起点、终点、长度、正文复读都一致。
- [ ] `followUpRanges` 非空且确实提供新信息；否则 `verifierTurns=1`。
- [ ] R1 报告打开观察可定位；T1 不错误要求报告。
- [ ] `allowedTools=[]`，没有发送、付款、订票或购买路径。
- [ ] 目标 trace 尚不存在，`runs/wp4/index.json` 未改。
- [ ] 生产工作单仍等于 N0 基线。

任何一项失败都回到输入修复，不调用模型。

## 9. N4：独立预审与冻结

在 `WP7-PREJUDGMENT.md` 追加，每个 case 单独一张表：

| 字段 | 必写内容 |
|---|---|
| case / 输入版本 | 新 id、facility、prompt 哈希、rubric、manifest id |
| 原句与交付 | 完整原句、required 交付及报告打开要求 |
| 候选 | 文件名、字符数、完整 sha256、交付通道、`notEvidence=true` |
| 证据与计划 | 每个 Artifact、证据 id、区间、必跑步及真实观察 |
| 结构断言 | 为什么候选在调用前已经完整有效，不是把拒绝当作误拒的手段 |
| 第二轮 | 具体补读区间及其能提供的新信息；没有则冻结一轮 |
| 允许工具 / 终止 | 无工具；Verifier 与 Guard 同时通过才 `done` |
| 通过或失败 | 预先判定有效的理由；实际结果不由预审指定 |
| 成本归属 | 独立桶；Mission 只计一次 |
| preJudgedValid | 只有独立审查全部通过才写 true |

预审完成前不得创建「有效」trace，不得让待测 Verifier 预审自己。预审通过后才手工冻结新 case JSON；不改任何旧 case。

## 10. N5：单条回放

### 10.1 顺序

1. 先只跑 `T1-complete-a`，读完 trace 并记完结果，再决定是否继续。
2. 再只跑 `R1-complete-a`，同样先记账再决定下一步。
3. 一个 case 只记一个实际结果格：
   - 首轮通过且 Guard 通过：只补该场景「通过」。
   - 首轮原始拒绝、第二轮针对缺口补读后通过且 Guard 通过：只补该场景「误拒后通过」。
   - 连续拒绝、Guard 失败、解析失败：不补通过或误拒格。
4. A 包通过后，如果还缺误拒格，只有出现实质不同的新输入才能准备 B 包。以下不算新输入：
   - 同一候选换摘要或换措辞。
   - 同一来源、同一区间重新排列。
   - 同一份输入改 case id 再送。
   - 为了等一次拒绝而重复抽样。
5. B 包也不能预先保证出现误拒；没有出现就保留空格。

### 10.2 单 case 调用模板

先人工确认第 8、9 节全部完成，再在 PowerShell 中把环境变量改成当前新 id。模板只运行一个 case，禁止改成扫描目录：

```powershell
$env:M005B_CASE_ID='T1-complete-a'
$env:SPARO_EVAL_ALLOW_MODEL='1'
node --input-type=module -e "import fs from 'node:fs'; import path from 'node:path'; import { casesDir, loadVersions, runFrozenCase, writeRun } from './tools/eval/m0-05b/case-runner.mjs'; import { evalOutDir } from './tools/eval/m0-05b/paths.mjs'; const id = process.env.M005B_CASE_ID; if (!/^(T1|R1)-complete-[a-z0-9-]+$/.test(id || '')) throw new Error('unexpected case id'); const journal = path.join(process.env.APPDATA || '', 'sparo-store', 'missions.jsonl'); const before = fs.statSync(journal); const dest = path.join(evalOutDir('runs', 'wp4'), id + '.json'); if (fs.existsSync(dest)) throw new Error('trace exists ' + id); const caseDoc = JSON.parse(fs.readFileSync(path.join(casesDir(), id + '.json'), 'utf8')); if (caseDoc.caseId !== id || caseDoc.preJudgedValid !== true || caseDoc.prejudgedBeforeModelCall !== true) throw new Error('case not approved'); const versions = loadVersions(); const outcome = await runFrozenCase(caseDoc, versions); writeRun(id, { caseId: id, scene: caseDoc.scene, resultClass: caseDoc.resultClass, costBucket: caseDoc.costBucket, hostScene: caseDoc.hostScene, doubleCountWithHost: caseDoc.doubleCountWithHost, preJudgedValid: true, covered: outcome.covered, observedClass: outcome.observedClass, reason: outcome.reason || '', modelCalls: outcome.modelCalls || 0, versions, trace: outcome.trace || [] }); const after = fs.statSync(journal); if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('missions.jsonl changed'); console.log(JSON.stringify({ id, observedClass: outcome.observedClass, covered: outcome.covered, calls: outcome.modelCalls || 0, reason: outcome.reason || '', journalSize: after.size }));"
$code=$LASTEXITCODE
Remove-Item Env:SPARO_EVAL_ALLOW_MODEL
Remove-Item Env:M005B_CASE_ID
exit $code
```

执行后立刻读 trace，不凭终端一行结果记格。模型异常、解析失败或工作单变化都立即停止，不自动重试。

## 11. N6：实际记格与 WP8 记录

`resultClass` 是冻结元数据，不是实际覆盖依据。以原始 `goalSatisfied`、后续 Verifier、Close Guard、`covered`、`observedClass` 和 `mission.closed` 共同判断。只有 `covered=true`，且 `observedClass=pass` 或 `false_reject_then_pass`，才补对应格；`observedClass` 写成目标值但 `covered=false` 不计。

| 实际情况 | WP8 记法 | 矩阵动作 |
|---|---|---|
| 首轮原始通过，Guard 通过并 `done` | 通过 | 补对应场景通过格 |
| 首轮原始拒绝，第二轮有合法新区间并通过，Guard 通过并 `done` | 误拒后通过 | 只补对应场景误拒格 |
| 首轮拒绝，第二轮仍拒绝 | 连续拒绝／复验未过 | 不补格，不写 `done` |
| Verifier 通过但 Guard 失败 | 未覆盖 | 不补格，不写 `done` |
| 模型未调用、输出无法解析 | 设施／调用失败 | 不补格；有用量记用量，没有记 `[TBD]` |
| 候选预审不完整 | 输入无效 | 不送入；已经发生则不得记误拒 |

每个 case 在 `WP8-RESULTS.md` 至少登记：

- case id、调用轮数、原始结果、置信度、逐项交付、未执行步、无效证据。
- Guard 各项、是否写 `mission.closed`、close.reason。
- 补读了哪些 Artifact 区间、各读多少字。
- 实际覆盖哪一格、哪一格仍缺及原因。
- 当前矩阵分子和剩余格；旧 32 格不得因新失败被抹掉。

## 12. N7：成本与价格证据

### 12.1 每次调用都记

在 `M0-05B-COST-FINAL.md` 追加新分组，不改旧 33、5、1 三组数字：

- case、场景、实际结果、轮次、模型和设施版本。
- `uncachedInputTokens`、`cachedInputTokens`、`outputTokens`、`reportedPromptTokens`。
- 校验：未缓存 + 缓存 = 上报 prompt；不一致时保留原始值并登记，不擅自修平。
- 每个补读区间的字符数及总补读字数。
- 墙钟：`model.completed.time - model.requested.time`。
- 每组 n、墙钟 P50／P95／最大值；金额没有依据就保持 `[TBD]`。
- 失败调用有供应商用量就记，没有就记 `[TBD]`，不记 0。

### 12.2 价格与账单分开

- 调用当时能核对官方价格时，在报告登记价格来源、版本和日期；没有就写 `[TBD]`。
- 不用 2026-10-29 的闲时牌价倒填后续调用。
- 不用牌价测算冒充账单，不把不同价格组或 Token 组合并成一笔无来源金额。
- 独立账单导出应能定位相关时间窗和模型用量；账单与 trace 并列保存，不回填旧 trace 的 `cost`。
- 新 trace 的 `priceVersion` / `cost` 没有测量时仍为 `[TBD]`。

### 12.3 O-01 仍保持关闭

只有同时满足才可提出 O-01 供独立评审：

1. 40/40 每格都有真实 trace 和正确 Guard 依据。
2. 所有计入 case 都在调用前冻结并独立预审，旧预期未改。
3. Token、Artifact 补读、墙钟和成本分子可定位。
4. 价格版本与账单证据齐全，不用估算冒充满成本门。
5. 分子包含规则要求的成功、未完成、取消、回滚及预算／验收耗尽等评估 Mission；同一 Mission 只计一次。
6. G8 等嵌入维度不与宿主 Mission 双算。
7. 样本量和不确定性写明，成功数为 0 时不做除法。

满足后才按冻结口径计算「纳入分子的 Mission 总成本 ÷ 成功 Mission 数」。40/40 之前不拿牌价除以成功数，O-01 始终 `[TBD]`。

## 13. 本轮暂不执行的场景

| 场景 | 为什么暂不排 | 何时才可重开 |
|---|---|---|
| G2 误拒 | 现有候选和证据没有实质不同的新输入 | 有新的合法公开微博 Artifact、完整新候选和针对性第二轮区间，并先过 WP6/WP7 |
| G4 通过 | 已有报告与移动页组合已跑过，换措辞不算新输入 | 出现可独立判定有效的新报告或新来源，而非重复抽样 |
| G6 误拒 | 同一首诗已送两次；换新诗也只可能重复已覆盖的通过格，且没有天然的第二轮新信息 | WP6 先指出真正不同的输入和合法新增复验信息；否则不送 |
| G8 误拒 | 最新 case 已首轮通过；同宿主不能再送 | 新宿主任务有真实 +0、换策略、完整交付及合法第二轮新证据 |

这些场景保持空格比制造覆盖更符合契约。

## 14. 总体验收清单

### T1/R1 A 包完成

- [ ] 新 Artifact 只追加，哈希与区间复读通过。
- [ ] 候选完整，独立预审在模型调用前完成。
- [ ] 每个 case 只回放一次，trace 可定位。
- [ ] 原始 Verifier、Guard、关单和实际记格一致。
- [ ] Token、补读、墙钟、价格／账单状态已追加到正式成本报告。
- [ ] 旧 case、旧 trace、旧候选、prompt、rubric 和 `runs/wp4/index.json` 未变。
- [ ] 生产工作单字节数与 mtime 未变。
- [ ] 没有登录绕过、发送、付款、订票或购买。

### M0-05B 全部完成

必须另行满足：40/40、成本分子无漏算／双算、价格与账单齐全、O-01 经独立评审。执行方不得自行宣布成本门通过；M1 仍不得提前开始真实浏览器扩展。

## 15. 立即停止并保留 `[TBD]` 的情况

- 需要改 prompt、rubric、旧 case、旧 trace 或旧预期才能得到目标结果。
- 需要把不完整候选标成有效，或把正确拒绝写成误拒。
- 需要重复同一输入来等另一种模型结果。
- 新 Artifact 需要登录、验证码、付款或其他未授权动作。
- T1 日期／三段证据对不上，或 R1 任一款缺同等来源、报告未真实打开。
- 模型、设施、prompt 哈希或 manifest 版本与冻结值不一致。
- 生产工作单发生变化，或发现任何发送、付款、订票、购买副作用。
- 价格或账单不可核对，却准备填写金额或 O-01。

停点时在 `WP8-RESULTS.md` 或对应预审节写清「缺什么、哪个入口停止、下一份合法输入是什么」，不留一句笼统的「继续优化」。
