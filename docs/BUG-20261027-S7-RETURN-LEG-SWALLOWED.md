# 一条去程发现抵掉整个车票交付，返程没跑也 close=done

> 2026-10-27 第三轮重跑 S7 审计时登记。只登记，不在第三轮里修。
> 严重度：中高。多段同交付（去程+返程车票）只交一段就 done，卡片还把没跑完的步涂成完成。

## 现象

S7 `m-mvqp0yds-sh0u5`（close=done）底账最后一条 turn：`p1-train_search`（去程）done、有 12306 URL；`p2-train_search`（返程）**仍是 running**，没有任何返程 finding，下一行就是 close=done。返程信息只在阅读页里以「8日晚返程未提供查询结果」交代。

## 根因链（verify.ts / plan.ts）

1. `observationCovers`：一条 `ok` 且 `covers` 含 `trains` 的发现就把 `trains` 交付整个抵掉——去程一条 finding 抵掉「去程+返程」两段。
2. `unmetPlanSteps` 只对 `COLLECTION_CAPS`（read_page/search_read/navigate/act）做计划步对账，`train_search`/`flight_search`/`hotel_search` 不在集合里，返程步不进「没执行」清单。
3. 两条叠加 → `verify.complete=true` → close=done；`closePlan(plan, true)` 把 running 的 `p2` 涂成 done，卡片显示三段全完成。

阅读页本身如实（房价未知、返程未提供），缺陷在 close reason 和卡片状态，不在阅读页。

## 修向

- 同 cap 多段计划步逐段对账：cap 为 train_search/flight_search/hotel_search 且计划里同 cap 有多步时，一步只能抵一段，按段各要一条成功发现；缺哪段，「还缺」里说哪段。
- `closePlan(complete=true)` 不许把 running/pending 步涂 done——对账修好后 complete 为真时本就不该有没跑完的同 cap 步；真有就如实标 skipped/skipped-note，不粉饰。
- 这是关单走向类本地判断，动手前先登记 `docs/DECISION-POINTS.md`。

## 重跑时盯

S7 原句重跑：返程要么真有 12306 URL（日期 11-08），要么 close reason 和「还缺」里单列返程段；卡片不许把返程步显示为 done。
