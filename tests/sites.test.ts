import { describe, expect, it } from "vitest";
import { applyTurn } from "../src/main/agent/runtime.js";
import { analyzeGoalHeuristic, type StepFinding } from "../src/main/agent/loop.js";
import { composeStep, reconsiderLocal, reconsiderMission } from "../src/main/agent/brain/reconsider.js";
import {
  isLegalSite,
  lockedSite,
  nextLegalSite,
  searchResultUrl,
  siteFromUrl,
} from "../src/main/agent/brain/sites.js";

const NOW = new Date(2026, 8, 15);

describe("合法站点表", () => {
  it("点名携程就锁死，失败也不换途牛", () => {
    expect(lockedSite("在携程查9月15日伊斯坦布尔的酒店", "hotel")).toBe("ctrip");
    expect(
      nextLegalSite({
        lane: "hotel",
        raw: "在携程查酒店",
        city: "北京",
        tried: ["ctrip"],
        want: "tuniu",
      }),
    ).toBeUndefined();
  });

  it("没点名时国内酒店失败换途牛，表外站丢掉", () => {
    expect(
      nextLegalSite({ lane: "hotel", raw: "北京住两晚", city: "北京", tried: ["ctrip"] }),
    ).toBe("tuniu");
    expect(isLegalSite("hotel", "yahoo")).toBe(false);
    expect(searchResultUrl("bing", "纽约 餐厅")).toContain("bing.com");
    expect(siteFromUrl("https://hotels.ctrip.com/hotels/list?city=1")).toBe("ctrip");
  });

  it("纽约酒店失败：从 Booking 换 Airbnb，不发明站", async () => {
    const q = "想去美国纽约住两晚 不知道住哪儿";
    const goal = analyzeGoalHeuristic(q, { now: NOW });
    const fail: StepFinding = {
      step: { id: "h1", cap: "hotel_search", label: "查住宿", covers: ["stay"], city: "纽约", site: "booking" },
      text: "空",
      url: "https://www.booking.com/searchresults.html",
      ok: false,
    };
    const local = reconsiderLocal(goal, [fail]);
    expect(local.retry?.site).toBe("airbnb");
    const step = composeStep(goal, [fail], { cap: "hotel_search", site: "yahoo", covers: ["stay"], city: "纽约" });
    expect(step?.site).not.toBe("yahoo");
  });

  it("检索失败换必应；模型点谷歌但原话没点名则仍只允许表内下一步", async () => {
    const t = applyTurn("帮我看看纽约值不值得去", { now: NOW });
    const fail: StepFinding = {
      step: { id: "s1", cap: "search_read", label: "检索", covers: ["report"], query: "纽约 值不值得" },
      text: "空",
      url: "https://www.baidu.com/s?wd=纽约",
      ok: false,
    };
    const after = await reconsiderMission({ ...t.mission!, findings: [fail] });
    expect(after.nudge?.site).toBe("bing");
    const forced = await reconsiderMission({ ...t.mission!, findings: [fail] }, async () =>
      JSON.stringify({
        same: true,
        add: [],
        drop: [],
        retry: { cap: "search_read", site: "yahoo", query: "纽约 值不值得去", covers: ["report"] },
      }),
    );
    expect(forced.nudge?.site).not.toBe("yahoo");
  });
});
