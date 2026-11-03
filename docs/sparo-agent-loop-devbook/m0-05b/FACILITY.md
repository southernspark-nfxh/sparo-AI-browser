# M0-05B 离线回放设施

> 版本：`m0-05b-facility-3`。2026-10-30。
> 已经跑完的 trace 仍钉着 `m0-05b-facility-1`。facility-2 的未送审 case 也不改。那些文件不改。
> 这是评估设施，不是生产 v2，也不是成本报告。O-01 仍是 `[TBD]`。

代码在 `tools/eval/m0-05b/`，不进入 `src/main`。输出只写本目录。不写 `missions.jsonl`，不打开浏览器。

## 边界

- 验收输入有原句、约束、计划摘要、交付契约、证据索引、候选摘要，以及明确点名的来源区间。补读轮的来源区间必须带正文：`text` 的长度要等于 `end - start`。只有边界、没有正文的区间会被拒绝，不能当成已经读过。
- 候选交付另走 `candidateDeliverable.text`。这条通道带全文、哈希和区间，并标 `notEvidence`。它不进入证据索引，也不把来源正文抄进证据索引。
- `verifier-prompt-1` 和 `verifier-rubric-1` 不因这条通道改写。prompt 仍规定：区间没给出的正文不要当成已经读过。补读给出正文之后，这段才算读过。
- 带 Actor 自由叙述的输入直接拒绝。
- Close Guard 与 Verifier 分开。Guard 失败不写 `mission.closed`。失败项挂在 `verification.completed`，挂起时由 `mission.suspended` 引用。
- `close.reason=done` 必须带 Guard 通过结果。取消、按现状结束、运行时回滚可以在 Guard 未通过时关单。
- 未设置 `SPARO_EVAL_ALLOW_MODEL=1` 时不调用模型。用量记 `[TBD]`，不记 0。
- 允许调用时只读商店版本机 `settings.json` 里已经配置的兼容接口。云端会话不从这里调用，密钥不写入 trace、Artifact 或本目录。
- rubric 仍是 `verifier-rubric-1`。本设施不改条款。

## 自检

`node tools/eval/m0-05b/self-check.mjs`

自检使用冻结的苹果官网正文做一次 `[200,500)` 复读。点名区间的正文必须进入验收输入，只有边界的区间会被拒绝。桩结果不是模型用量，不能进入 O-01。

价格版本见 `M0-05B-COST.md`：2026-10-29 的官方闲时牌价可以核对，但 Trace 里的金额字段仍是 `[TBD]`，结果矩阵仍缺 11 格。O-01 继续 `[TBD]`。本设施的自检用量不能进入 O-01。M1 门不在这一步打开。
