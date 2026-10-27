# 没要求读页的早退仍不认识「复制 / 文档」

> 走查发现，不在 [BUG-20261026-OPEN-SITE-HIJACK-ZERO-STEP.md](./BUG-20261026-OPEN-SITE-HIJACK-ZERO-STEP.md) 里修。
> 2026-10-27 只登记。

`userDidNotAskToRead`（`reasoner.ts`）用一份总结/阅读词表判断原话有没有要求读页。「复制下来做成文档」不在词表里，函数返回 true。

循环后的关单（`browser.ts` 里 `userDidNotAskToRead` 那一支）再交给 `earlyExitMayCloseDone`。清点只把未完成的计划步，以及必交付里的 `report` / `form`，当成不能 done 的理由。必交付 `page` 挡不住。

因此：计划步都已 done 或 skipped，句子是采集，交付物里有「读懂当前页」时，仍可能 `close(done)` 并回「已打开 weibo.com。」。10-26 晚那次没爆，是因为 4 步计划还停在 `running`，清点先返回了 false。

不要往这份词表补「复制|文档」。修的时候要么让必交付 `page` 走同一套清点，要么这句「要不要读」改由已经产出的交付物决定。另开实现单再动代码。
