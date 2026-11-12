import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mapSnapshot } from "../strategies/skills/social-media-publish/scripts/collector.mjs";
import { buildViews, completenessText, listMetrics, upsertMetric, yuan } from "../strategies/skills/social-media-publish/scripts/metrics-db.mjs";
import { loadProfile } from "../strategies/skills/social-media-publish/scripts/profile.mjs";

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

  it("按实测字段落数，元换成分，没有的指标保持空", () => {
    const clock = new Date("2026-11-12T08:00:00+08:00");
    const toutiao = mapSnapshot(loadProfile("toutiao"), {
      ready: { impression_latest_ready_date: "2026-11-11" },
      sources: [
        { status: 200, json: { author_stat: { consume_data: { impression_count: 5210, go_detail_count: 338 }, interaction_data: { digg_count: 6, comment_count: 2 } } } },
        { status: 200, json: { date: "2026-11-11", fans_stat: { change_count: 0 } } },
        { status: 200, json: { data: { detail: [{ day: "2026-11-11", total: "0.29" }] } } },
      ],
    }, clock);
    expect(toutiao.date).toBe("2026-11-11");
    expect(toutiao.impressions).toBe(5210);
    expect(toutiao.reads).toBe(338);
    expect(toutiao.follows).toBe(0);
    expect(toutiao.revenue).toBe(29);
    expect(toutiao.shares).toBe(null);
    expect(toutiao.completeness).toBe("partial");

    const baijia = mapSnapshot(loadProfile("baijiahao"), {
      ready: null,
      sources: [
        { status: 200, json: { data: { latest_event_day: 20261111, total_info: { view_count: "2284", likes_count: "19", comment_count: "9", share_count: "2", collect_count: "4", fans_increase: "0" } } } },
        { status: 200, json: { data: { yesterday_income: 3.4 } } },
      ],
    }, clock);
    expect(baijia.reads).toBe(2284);
    expect(baijia.revenue).toBe(340);
    expect(baijia.impressions).toBe(null);
    expect(baijia.completeness).toBe("partial");
  });
});
