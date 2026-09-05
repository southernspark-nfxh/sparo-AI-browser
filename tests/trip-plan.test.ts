import { describe, expect, it } from "vitest";
import { parseLocalIntent } from "../src/main/agent/stub.js";
import { parseTravelQuery } from "../src/main/agent/travel.js";
import {
  expandTripPlan,
  isTripPlanQuery,
  parseTripPlan,
} from "../src/main/agent/trip-plan.js";

const USER_TRIP =
  "帮我查询地图，查询航班，查询酒店，帮我规划一个9月18号从北京出发，然后9月27号回到北京，要去土耳其和格鲁吉亚两个城市的旅行路线 以及航班、酒店等等的入住和路线，怎么规划最科学，以及价格，你得帮我规划一下，然后计算一下.从北京出发，落地伊斯坦布尔，回国的时候是从第比利斯回到北京";

describe("trip plan", () => {
  const now = new Date(2026, 8, 1);

  it("recognizes the long Turkey-Georgia itinerary", () => {
    expect(isTripPlanQuery(USER_TRIP)).toBe(true);
    expect(parseTravelQuery(USER_TRIP, now)).toBeNull();
    const plan = parseTripPlan(USER_TRIP, now);
    expect(plan).toMatchObject({
      origin: "北京",
      cities: ["伊斯坦布尔", "第比利斯"],
      startDate: "2026-09-18",
      endDate: "2026-09-27",
    });
  });

  it("does not treat a single Amap query as a trip", () => {
    expect(
      isTripPlanQuery("打开高德地图，查从北京南站到天安门怎么走"),
    ).toBe(false);
    expect(parseTripPlan("打开高德地图，查从北京南站到天安门怎么走", now)).toBeNull();
  });

  it("does not treat a single hotel query as a trip", () => {
    expect(isTripPlanQuery("在携程查9月15日伊斯坦布尔的酒店")).toBe(false);
  });

  it("expands to outbound, two hotels, intercity, return", () => {
    const plan = parseTripPlan(USER_TRIP, now);
    expect(plan).not.toBeNull();
    const steps = expandTripPlan(plan!);
    expect(steps.map((s) => s.query.kind)).toEqual([
      "flight",
      "hotel",
      "flight",
      "hotel",
      "flight",
    ]);
    expect(steps[0].query).toMatchObject({
      kind: "flight",
      from: "北京",
      to: "伊斯坦布尔",
      date: "2026-09-18",
    });
    expect(steps[4].query).toMatchObject({
      kind: "flight",
      from: "第比利斯",
      to: "北京",
      date: "2026-09-27",
    });
    expect(steps.some((s) => s.query.kind === "maps")).toBe(false);
  });

  it("sidebar routes the long itinerary to trip_plan", () => {
    const a = parseLocalIntent(USER_TRIP);
    expect(a.type).toBe("trip_plan");
    if (a.type === "trip_plan") {
      expect(a.plan.cities).toEqual(["伊斯坦布尔", "第比利斯"]);
    }
  });

  const CHINA_HOPS =
    "搜北京9月18日去三亚玩三天 再去上海玩一天 再去昆明玩三天 最后到大理玩一天 之后回北京的全路线 酒店";

  it("parses 玩N天 hops and hotel nights", () => {
    expect(isTripPlanQuery(CHINA_HOPS)).toBe(true);
    const plan = parseTripPlan(CHINA_HOPS, now);
    expect(plan).toMatchObject({
      origin: "北京",
      cities: ["三亚", "上海", "昆明", "大理"],
      startDate: "2026-09-18",
      endDate: "2026-09-26",
      nights: [3, 1, 3, 1],
    });
    const steps = expandTripPlan(plan!);
    expect(steps.map((s) => s.label)).toEqual([
      "去程机票 北京 → 三亚 2026-09-18",
      "三亚 住宿 2026-09-18 至 2026-09-21",
      "城际机票 三亚 → 上海 2026-09-21",
      "上海 住宿 2026-09-21 至 2026-09-22",
      "城际机票 上海 → 昆明 2026-09-22",
      "昆明 住宿 2026-09-22 至 2026-09-25",
      "城际机票 昆明 → 大理 2026-09-25",
      "大理 住宿 2026-09-25 至 2026-09-26",
      "回程机票 大理 → 北京 2026-09-26",
    ]);
    const a = parseLocalIntent(CHINA_HOPS);
    expect(a.type).toBe("trip_plan");
  });

  const BKK =
    "帮我做一个北京到曼谷的旅游攻略 9月16日出发 22日回来 包含酒店和机票";

  it("treats 旅游攻略 + 回来 + 酒店机票 as a trip, not a channel page", () => {
    expect(isTripPlanQuery(BKK)).toBe(true);
    expect(parseTravelQuery(BKK, now)).toBeNull();
    const plan = parseTripPlan(BKK, now);
    expect(plan).toMatchObject({
      origin: "北京",
      cities: ["曼谷"],
      startDate: "2026-09-16",
      endDate: "2026-09-22",
    });
    const steps = expandTripPlan(plan!);
    expect(steps.map((s) => s.query.kind)).toEqual(["flight", "hotel", "flight"]);
    expect(steps[0].query).toMatchObject({
      kind: "flight",
      from: "北京",
      to: "曼谷",
      date: "2026-09-16",
    });
    expect(steps[2].query).toMatchObject({
      kind: "flight",
      from: "曼谷",
      to: "北京",
      date: "2026-09-22",
    });
    const a = parseLocalIntent(BKK);
    expect(a.type).toBe("trip_plan");
  });
});
