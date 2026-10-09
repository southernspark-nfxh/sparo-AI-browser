import { describe, expect, it } from "vitest";
import { extractCityChange, extractEndDate, extractFacts, isConstraintTurn } from "../src/main/agent/extract.js";
import { analyzeGoalHeuristic } from "../src/main/agent/loop.js";

describe("事实层：极性与城不跟 kind 绑", () => {
  it("已经订了 / 别查 → 排除住宿", () => {
    const f = extractFacts("纽约两天怎么玩，酒店我已经订好了，别再查住宿");
    expect(f.cities).toContain("纽约");
    expect(f.exclude).toContain("stay");
  });

  it("只要景点 → only sights", () => {
    const f = extractFacts("酒店订好了，只要纽约景点");
    expect(f.only).toBe(true);
    expect(f.prefer).toContain("sights");
    expect(f.exclude).toContain("stay");
    expect(f.cities).toContain("纽约");
  });

  it("每晚500 和 以内 都能抽到上限", () => {
    expect(extractFacts("预算每晚500，纽约住哪儿").hotelPriceMax).toBe(500);
    expect(extractFacts("纽约酒店500元以内").hotelPriceMax).toBe(500);
  });

  it("先别查酒店先排路线", () => {
    const f = extractFacts("先别查酒店，先告诉我纽约两天路线怎么排");
    expect(f.exclude).toContain("stay");
    expect(f.prefer).toContain("itinerary");
    expect(f.cities).toContain("纽约");
  });

  it("不要酒店是排除，不要超过/机场是软约束", () => {
    const noStay = extractFacts("带老人去杭州玩三天，不要酒店，只要路线和餐厅");
    expect(noStay.exclude).toContain("stay");
    expect(noStay.prefer).toEqual(["itinerary", "food"]);
    expect(noStay.only).toBe(true);
    expect(noStay.audience).toBe("老人");
    const cap = extractFacts("纽约住哪儿，不要超过800，不要机场附近");
    expect(cap.exclude).not.toContain("stay");
    expect(cap.hotelPriceMax).toBe(800);
    expect(cap.hotelAvoid).toContain("机场");
    expect(cap.cities).toContain("纽约");
  });

  it("改成波士顿是换城，不是新闲聊", () => {
    expect(extractCityChange("改成波士顿吧")).toBe("波士顿");
    const last = analyzeGoalHeuristic(
      "想去美国纽约 两天 不知道住哪儿 有推荐吗 还有餐厅之类的 包括有什么景点？给我设计一下",
      { now: new Date(2026, 8, 14) },
    );
    const brief = {
      need: last.intent,
      kind: last.kind,
      known: last.known,
      unknown: last.unknown,
      approach: last.approach,
      ready: true,
      needsConfirm: false,
      wants: last.deliverables.map((d) => d.id),
    };
    expect(isConstraintTurn("改成波士顿吧", brief)).toBe(true);
    const f = extractFacts("改成波士顿吧", { last: brief });
    expect(f.cities).toEqual(["波士顿"]);
    expect(f.inherited).toBe(true);
  });

  it("便宜点相对上一张单是约束回合", () => {
    const last = analyzeGoalHeuristic(
      "想去美国纽约 两天 不知道住哪儿 有推荐吗 还有餐厅之类的 包括有什么景点？给我设计一下",
      { now: new Date(2026, 8, 14) },
    );
    const brief = {
      need: last.intent,
      kind: last.kind,
      known: last.known,
      unknown: last.unknown,
      approach: last.approach,
      ready: true,
      needsConfirm: false,
      wants: last.deliverables.map((d) => d.id),
    };
    expect(isConstraintTurn("便宜点的", brief)).toBe(true);
    const f = extractFacts("便宜点的", { last: brief });
    expect(f.inherited).toBe(true);
    expect(f.cities).toContain("纽约");
    expect(f.cheaper).toBe(true);
  });
});

describe("回程末日：end 含当天，不能少一天", () => {
  const now = new Date("2026-09-17T00:00:00");
  it("M月D日到D日 区间（结尾裸日沿用上一个月）", () => {
    expect(extractEndDate("10月26日到30日去玩", "2026-10-26", now)).toBe("2026-10-30");
  });
  it("区间结尾带月份：跨月/跨年", () => {
    expect(extractEndDate("10月30日到11月2日", "2026-10-30", now)).toBe("2026-11-02");
    expect(extractEndDate("12月30日到1月3日", "2026-12-30", now)).toBe("2027-01-03");
  });
  it("D日回 / D日回广州", () => {
    expect(extractEndDate("从广州出发30日回", "2026-10-26", now)).toBe("2026-10-30");
    expect(extractEndDate("30日回广州", "2026-10-26", now)).toBe("2026-10-30");
    expect(extractEndDate("9月20日出发 9月28日回到", "2026-09-20", now)).toBe("2026-09-28");
  });
  it("只说玩 N 天：end = start + N-1（含首尾）", () => {
    const f = extractFacts("11月5日去三亚玩5天，帮我排", { now });
    expect(f.start).toBe("2026-11-05");
    expect(f.end).toBe("2026-11-09");
  });
  it("Q6 湖南：26到30共5天 → end=30，不是 29", () => {
    const f = extractFacts(
      "10月26日到30日去湖南5天，从广州出发30日回，长沙、张家界、凤凰古城都想去，高铁和酒店行程帮我安排",
      { now },
    );
    expect(f.start).toBe("2026-10-26");
    expect(f.end).toBe("2026-10-30");
    expect(f.origin).toBe("广州");
    expect(f.cities).toEqual(["长沙", "张家界", "凤凰"]);
  });
  it("Q7 出差：订北京往返机票 → origin=北京", () => {
    const f = extractFacts("下周三去上海出差3天，帮我订北京往返机票和浦东酒店", { now });
    expect(f.origin).toBe("北京");
    expect(f.cities).toContain("上海");
  });
});

describe("相对周末：这周末从周六起，周日回是末日", () => {
  const now = new Date("2026-09-17T00:00:00"); // 周四
  it("这周末两天，周日回 → start=周六 9/19，end=周日 9/20（不把周日回当出发日）", () => {
    const f = extractFacts("这周末两天想去广州，从深圳出发周日回", { now });
    expect(f.start).toBe("2026-09-19");
    expect(f.end).toBe("2026-09-20");
  });
  it("下周末 → 9/26 周六", () => {
    const f = extractFacts("下周末去广州两天", { now });
    expect(f.start).toBe("2026-09-26");
  });
  it("周日回独立断言", () => {
    expect(extractEndDate("周日回", "2026-09-19", now)).toBe("2026-09-20");
  });
});

describe("Q1 全程安排 cue：吃什么/玩什么/安排全程 推出 food/sights/itinerary", () => {
  const now = new Date("2026-09-17T00:00:00");
  it("含机票酒店和每天吃什么玩什么 → 五项 deliverables 全齐", () => {
    const g = analyzeGoalHeuristic(
      "10月8日去四川7天，从北京出发，帮我安排全程，含机票酒店和每天吃什么玩什么，成都、九寨沟、峨眉山",
      { now },
    );
    const ids = g.deliverables.filter((d) => d.required).map((d) => d.id);
    for (const id of ["itinerary", "flights", "stay", "food", "sights"]) {
      expect(ids).toContain(id);
    }
  });
});

describe("多城行程：known 齐全就直接带出 TripPlan，不退化成散手", () => {
  const now = new Date("2026-09-17T00:00:00");
  it("Q6 湖南 heuristic 直接 act 且 plan 含三城与正确末日", () => {
    const g = analyzeGoalHeuristic(
      "10月26日到30日去湖南5天，从广州出发30日回，长沙、张家界、凤凰古城都想去，高铁和酒店行程帮我安排",
      { now },
    );
    expect(g.decision).toBe("act");
    expect(g.plan?.cities).toEqual(["长沙", "张家界", "凤凰"]);
    expect(g.plan?.origin).toBe("广州");
    expect(g.plan?.endDate).toBe("2026-10-30");
  });
});

