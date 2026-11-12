import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildViews, completenessText, listMetrics, upsertMetric, yuan } from "../strategies/skills/social-media-publish/scripts/metrics-db.mjs";

describe("指标快照", () => {
  it("缺失不写成 0，unsupported 和 missing 文案不同", async () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-metrics-"));
    const file = join(dir, "metrics.sqlite");
    await upsertMetric({
      platform: "sohu",
      accountId: "",
      date: "2026-11-11",
      articleId: "",
      completeness: "missing",
      reason: "数据接口未实测",
    }, file);
    await upsertMetric({
      platform: "dayu",
      accountId: "",
      date: "2026-11-11",
      articleId: "",
      completeness: "unsupported",
      revenue: null,
      reason: "平台没有收益字段",
    }, file);
    const rows = await listMetrics(file);
    const sohu = rows.find((row) => row.platform === "sohu");
    expect(sohu.reads).toBe(null);
    expect(sohu.revenue).toBe(null);
    const view = buildViews(rows);
    expect(completenessText("missing")).toBe("数据缺失");
    expect(completenessText("unsupported")).toBe("平台未提供");
    expect(view.revenueSplit.find((row) => row.platform === "sohu").text).toBe("数据缺失");
    expect(view.revenueSplit.find((row) => row.platform === "dayu").text).toBe("平台未提供");
    expect(view.overview.revenue).not.toContain("0.00");
    expect(view.hideDelta).toBe(true);
    expect(yuan(28640)).toBe("286.40");
    rmSync(dir, { recursive: true, force: true });
  });

  it("有符号净增，部分数据不给涨跌", () => {
    const view = buildViews([
      { platform: "toutiao", articleId: "", date: "2026-11-11", completeness: "full", reads: 10, follows: -5, revenue: 100 },
      { platform: "baijiahao", articleId: "", date: "2026-11-11", completeness: "partial", reads: 3, follows: 2, revenue: null },
    ]);
    expect(view.overview.follows).toBe("-5");
    expect(view.hideDelta).toBe(true);
    expect(view.overview.delta).toBe("");
  });
});
