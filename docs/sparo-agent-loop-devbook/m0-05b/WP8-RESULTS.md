# WP8 追加回放

> 2026-10-30。只跑了预审通过的三份：`G4-portrait-read`、`G2-posts-ids`、`G8-host-read`。  
> 模型是商店版已配置的 byok `deepseek-flash`。`SPARO_EVAL_ALLOW_MODEL=1` 只用于这次回放。  
> 旧 case、旧 trace、`runs/wp4/index.json`、rubric、prompt 都没改。工作单仍是 1596213 字节。  
> 费用在 trace 里仍是 `[TBD]`。这次不进入 WP9，也不提出 O-01。

## 记格

| case | 调用 | 记法 | 格子 |
|---|---|---|---|
| `G4-portrait-read` | 2 | 误拒后通过 | G4 误拒。通过格仍未覆盖 |
| `G2-posts-ids` | 1 | 通过 | G2 通过。误拒格仍未覆盖 |
| `G8-host-read` | 2 | 不补格 | G8 通过和误拒都仍未覆盖 |

矩阵由 29/40 变为 **31/40**。还缺 9 格：G2 误拒、G4 通过、G6 误拒、G8 通过、G8 误拒、T1 通过、T1 误拒、R1 通过、R1 误拒。

## 依据

`G4-portrait-read`：首轮原始 `goalSatisfied=false`，置信度 low，因为来源区间是空的。补读带上移动页全文 1830 字后，原始 `goalSatisfied=true`，置信度 medium。Close Guard 通过，trace 写了 `mission.closed` / `done`。模型同时写明 uid `2803301701` 不在给定正文里，但仍判核心画像成立。这一格按误拒后通过记下。

`G2-posts-ids`：首轮原始 `goalSatisfied=true`，置信度 medium，Guard 通过，没有第二轮。模型写明没有展开三份来源正文，所以不能逐字复核截断和数字 id，置信度因此是中等。按首轮通过记下。误拒格没有发生拒绝，不补。

`G8-host-read`：首轮原始拒绝，置信度 low。补读带上 settled-0、settled-1、移动页和三份时间线页全文后，原始 `goalSatisfied` 仍是 false，置信度 high。没有 `mission.closed`。补读仍拒绝，两格都不补，也不再送一次。

G8 的费用在 `g8-embedded`，`doubleCountWithHost=false`，不并入 G2。

## 这次调用的用量

Trace 里的 `cost` 和 `priceVersion` 都是 `[TBD]`。五次调用的供应商用量：

| 调用 | 未缓存 | 缓存 | 输出 | 上报 prompt |
|---|---:|---:|---:|---:|
| G4 首轮 | 1131 | 0 | 5296 | 1131 |
| G4 补读 | 2204 | 128 | 1509 | 2332 |
| G2 首轮 | 4914 | 0 | 4674 | 4914 |
| G8 首轮 | 5023 | 0 | 1834 | 5023 |
| G8 补读 | 138064 | 384 | 6312 | 138448 |

合计未缓存 151336、缓存 512、输出 19625。这五次不改写原先 33 次调用的阶段数字。没有账单，不算进 O-01。

## 停点

O-01 继续 `[TBD]`。M0-05B 成本门和 M1 保持关闭。G6、T1、R1 没有跑。

---

## 2026-10-30 WP9 后追加：`G8-host-observations`

先完成 `G8-host-read` 的无模型归因，再冻结新 id 并独立预审。只跑了 `G8-host-observations`；旧 case、旧 trace、`runs/wp4/index.json`、rubric、prompt 和候选字节都没改。

| case | 调用 | 记法 | 格子 |
|---|---:|---|---|
| `G8-host-observations` | 1 | 通过 | G8 通过。误拒格仍未覆盖 |

首轮原始 `goalSatisfied=true`，置信度 high，`unexecutedStepIds=[]`，Close Guard 通过，trace 写了 `mission.closed` / `done`。没有第二轮。模型按证据索引核对了 8／21／1 共 30 条、settled 同哈希对应的离线差 0，以及 +0 后改看移动页。

矩阵由 31/40 变为 **32/40**。还缺 8 格：G2 误拒、G4 通过、G6 误拒、G8 误拒、T1 通过、T1 误拒、R1 通过、R1 误拒。

### 这次调用的用量

| 调用 | 未缓存 | 缓存 | 输出 | 上报 prompt | 补读字数 | 墙钟 ms | 费用 |
|---|---:|---:|---:|---:|---:|---:|---|
| G8 首轮 | 5231 | 128 | 2020 | 5359 | 0 | 12058 | `[TBD]` |

模型仍是 byok `deepseek-flash`，设施仍是 `m0-05b-facility-3`。没有价格版本和账单，trace 的 `priceVersion` / `cost` 都是 `[TBD]`。不改写原 33 次或上一轮 5 次的数字，也不用旧牌价填这次金额。费用留在 `g8-embedded`，不并入 G2。

本次停点：G8 通过格已补齐，误拒格没有发生，不能补。O-01 继续 `[TBD]`，M0-05B 成本门和 M1 保持关闭。工作单仍是 1596213 字节。

---

## 2026-10-30 N5 后追加：`R1-complete-a`

生产基线漂移经用户确认为本人侧栏真实使用（WP7 N5 节），新基线 **1609971 字节／`2026-10-30T15:57:19.946Z`** 冻结后，8.2 无模型检查 22 项全过，再按 10.2 单条回放。只跑了 `R1-complete-a`；旧 case、旧 trace、`runs/wp4/index.json`、rubric、prompt 和候选字节都没改。回放前后生产工作单 stat 一致。

| case | 调用 | 记法 | 格子 |
|---|---:|---|---|
| `R1-complete-a` | 2 | 误拒后通过 | R1 误拒。通过格仍未覆盖 |

依据：首轮原始 `goalSatisfied=false`，置信度 high——拒绝点是 `reportOpened` 观察只出现在候选与计划摘要（自述），未进证据索引可核验，且华为「天猫¥4199」细节未在证据摘要确认；`r1-report` 交付本身首轮已 satisfied。第二轮补读小米 `[0,866)`、苹果价格 `[0,320)`、苹果规格 `[0,2197)`、华为 `[0,889)` 共 4272 字后，原始 `goalSatisfied=true`，置信度 medium，`unexecutedStepIds=[]`、`invalidEvidenceIds=[]`。Close Guard 五项通过，trace 写了 `mission.closed` / `done`。模型在第二轮仍注明 reportOpened 观察本身不在证据索引中，该核验由 Close Guard `report_opened`（依据 `obs-m005a-r1-report-open-20261030`）承担。

矩阵由 32/40 变为 **33/40**。还缺 7 格：G2 误拒、G4 通过、G6 误拒、G8 误拒、T1 通过、T1 误拒、R1 通过。R1 通过格需要实质不同的 B 包新输入才可继续；T1 仍缺单店目标日期房型标价；G2／G4／G6／G8 无实质不同新输入，不送。

### 这次调用的用量

| 调用 | 未缓存 | 缓存 | 输出 | 上报 prompt | 补读字数 | 墙钟 ms | 费用 |
|---|---:|---:|---:|---:|---:|---:|---|
| R1 首轮 | 4242 | 0 | 7058 | 4242 | 0 | 40671 | `[TBD]` |
| R1 补读 | 6806 | 640 | 5546 | 7446 | 4272 | 31736 | `[TBD]` |

校验：4242=4242+0；7446=6806+640。模型仍是 byok `deepseek-flash`，设施仍是 `m0-05b-facility-3`。没有价格版本和账单，trace 的 `priceVersion` / `cost` 都是 `[TBD]`。不改写原 33 次、上一轮 5 次与 G8 追加 1 次的数字。费用留在 `independent` 桶。

本次停点：调用总数由 39 变为 **41**。O-01 继续 `[TBD]`，M0-05B 成本门和 M1 保持关闭。回放前后生产工作单未变（新基线 1609971 字节）。
