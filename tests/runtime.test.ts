import { describe, expect, it } from "vitest";
import { applyTurn, classifyIngest, type ActiveMission } from "../src/main/agent/runtime.js";
import {
  analyzeGoal,
  analyzeGoalHeuristic,
  compileHands,
  inferDeliverables,
  mergeAnalyze,
  planForGoal,
} from "../src/main/agent/loop.js";
import { SAMPLE_YUNNAN_ASK, looksLikeTripAsk } from "../src/main/agent/slots.js";
import { parseLocalIntent } from "../src/main/agent/stub.js";
import { shouldSealShopReport } from "../src/main/agent/research-report.js";

const NOW = new Date(2026, 8, 14);
const NY =
  "想去美国纽约 两天 不知道住哪儿 有推荐吗 还有餐厅之类的 包括有什么景点？给我设计一下";

function run(text: string, extra?: Parameters<typeof applyTurn>[1]) {
  return applyTurn(text, { now: NOW, ...extra });
}

describe("工作单：当地短途", () => {
  it("纽约原话直接开跑，交付住/餐厅/景点/日程，不问出发地", () => {
    const t = run(NY);
    expect(t.ingest).toBe("new");
    expect(t.effect).toBe("run");
    expect(t.mission?.state).toBe("running");
    expect(t.mission?.goal.unknown).toEqual([]);
    expect(t.mission?.goal.known.cities).toContain("纽约");
    const ids = inferDeliverables(NY).map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(["stay", "food", "sights", "itinerary"]));
    expect(ids).not.toContain("flights");
    const caps = (t.mission?.plan || []).map((s) => s.cap);
    expect(caps).toContain("hotel_search");
    expect(caps.filter((c) => c === "search_read").length).toBeGreaterThanOrEqual(2);
    expect(caps).not.toContain("trip_plan");
  });

  it("模型写 decision=ask 且 unknown 为空：不能把单子打成 blocked", async () => {
    const goal = await analyzeGoal(
      NY,
      { now: NOW },
      async () =>
        JSON.stringify({
          intent: "纽约两天当地行程",
          decision: "ask",
          ask: "",
          unknown: ["预算"],
          deliverables: [{ id: "stay" }],
          known: { cities: ["纽约"] },
          approach: "先问一句",
        }),
    );
    expect(goal.decision).toBe("act");
    expect(goal.ask).toBeUndefined();
    expect(goal.deliverables.map((d) => d.id)).toEqual(
      expect.arrayContaining(["stay", "food", "sights", "itinerary"]),
    );
    const merged = mergeAnalyze(analyzeGoalHeuristic(NY, { now: NOW }), {
      decision: "ask",
      ask: "还缺一项才能动手。",
      unknown: ["出发地"],
      deliverables: [{ id: "stay", label: "住宿", required: true }],
    });
    expect(merged.decision).toBe("act");
  });

  it("错误堵住之后回「？？？」「你有啥困惑」：续跑，不重开分析", () => {
    const first = run(NY);
    const fakeBlock: ActiveMission = {
      ...first.mission!,
      state: "blocked",
      blockedSlot: "origin",
      ask: "还缺一项才能动手。",
    };
    expect(classifyIngest("？？？", fakeBlock).kind).toBe("continue");
    expect(classifyIngest("你有啥困惑", fakeBlock).kind).toBe("continue");
    const again = run("？？？", { active: fakeBlock });
    expect(again.effect).toBe("run");
    expect(again.mission?.state).toBe("running");
    expect(again.mission?.goal.known.cities).toContain("纽约");
    const ids = again.mission?.goal.deliverables.map((d) => d.id) || [];
    expect(ids).toEqual(expect.arrayContaining(["stay", "food", "sights"]));
  });
});

describe("工作单：往返行程槽位", () => {
  it("我打算去云南：不出手，不问我打算当出发地", () => {
    const t = run(SAMPLE_YUNNAN_ASK);
    expect(t.effect).toBe("ask");
    expect(t.say).toMatch(/出发/);
    expect(t.mission?.goal.known.origin).toBeUndefined();
    expect(t.mission?.goal.known.end).toBe("2026-09-28");
  });

  it("补上成都后可以出手", () => {
    const first = run(SAMPLE_YUNNAN_ASK);
    const second = run("成都", { active: first.mission });
    expect(second.effect === "propose" || second.effect === "run").toBe(true);
    expect(second.mission?.goal.known.origin).toBe("成都");
    expect(second.mission?.goal.known.end).toBe("2026-09-28");
    if (second.effect === "run") {
      expect(second.mission?.plan[0]?.cap).toBe("trip_plan");
      expect(second.mission?.plan[0]?.trip?.origin).toBe("成都");
    }
  });

  it("从昆明出发的云南 7 日游先出思路，按这个做再动手", () => {
    const q = "帮我规划一个云南7日游，从昆明出发，9月20日出发，9月28日回到昆明";
    const t = run(q);
    expect(t.effect).toBe("propose");
    expect(t.mission?.goal.known.origin).toBe("昆明");
    expect(t.mission?.goal.known.end).toBe("2026-09-28");
    const go = run("按这个做", { active: t.mission });
    expect(go.effect).toBe("run");
    expect(go.mission?.plan[0]?.cap).toBe("trip_plan");
    expect((go.mission?.plan[0]?.trip?.cities || []).length).toBeGreaterThanOrEqual(3);
  });

  it("常住地成都时先确认，可以之后按成都出发", () => {
    const t = run(SAMPLE_YUNNAN_ASK, { homeCity: "成都" });
    expect(t.effect).toBe("ask");
    expect(t.say).toMatch(/成都/);
    const ok = run("可以", { active: t.mission, homeCity: "成都" });
    expect(ok.effect === "propose" || ok.effect === "run").toBe(true);
    expect(ok.mission?.goal.known.origin).toBe("成都");
  });

  it("土耳其多城句槽位齐了就出手，缺出发地仍停", () => {
    const turkey =
      "帮我规划一个9月18号从北京出发，然后9月27号回到北京，要去土耳其和格鲁吉亚两个城市的旅行路线，包含机票酒店。从北京出发，落地伊斯坦布尔，从第比利斯回到北京";
    const t = run(turkey);
    expect(t.effect).toBe("run");
    expect(t.mission?.plan[0]?.cap).toBe("trip_plan");
    expect(t.mission?.plan[0]?.trip?.origin).toBe("北京");
    expect(t.mission?.plan[0]?.trip?.cities).toContain("伊斯坦布尔");
    expect(t.mission?.goal.known.end).toBe("2026-09-27");
    expect(run(SAMPLE_YUNNAN_ASK).effect).toBe("ask");
  });

  it("从北京出发去山西玩十天：不再问想去哪", () => {
    const q = "明天早上从北京出发去山西玩十天帮我规划全程";
    expect(looksLikeTripAsk(q)).toBe(true);
    const t = run(q);
    expect(t.effect).toBe("propose");
    expect(t.mission?.goal.known.origin).toBe("北京");
    expect(t.mission?.goal.known.region).toBe("山西");
    expect(t.mission?.goal.known.start).toBe("2026-09-15");
    expect(t.mission?.goal.known.end).toBe("2026-09-24");
    expect(t.mission?.goal.approach).toMatch(/太原/);
  });

  it("云南至少5城：本月18日出发28日回", () => {
    const q =
      "帮我安排一个云南旅游行程 本月18日从北京出发 28日回来 要把云南都玩一遍 至少去5个城市 著名景点都要安排 以及酒店 还有飞机火车票之类";
    const t = run(q);
    expect(t.effect).toBe("propose");
    expect(t.mission?.goal.known.origin).toBe("北京");
    expect(t.mission?.goal.known.region).toBe("云南");
    expect(t.mission?.goal.known.start).toBe("2026-09-18");
    expect(t.mission?.goal.known.end).toBe("2026-09-28");
    expect((t.mission?.goal.known.cities || []).length).toBeGreaterThanOrEqual(5);
    const go = run("按这个做", { active: t.mission });
    expect(go.effect).toBe("run");
    expect(go.mission?.plan[0]?.trip?.cities.length).toBeGreaterThanOrEqual(5);
  });

  it("模型给贵州长句出的提案：确认后按模型 goal 跑 trip_plan，不被本地规则改判成直接回答", () => {
    const raw = "我今年10月10日到10月20日想去贵州旅游，从北京出发，10月20日回到北京。";
    // 模拟模型（async understand）存下的 propose：goal 判成 trip、城市是模型推荐的、goal.plan 缺省。
    // 本地 heuristic 对这句长原话的重判并不可靠（会误成「直接回答」），确认时不能重判。
    const base = analyzeGoalHeuristic(
      "帮我规划贵州旅游，从北京出发，10月10日出发，10月20日回到北京，要行程酒店",
      { now: NOW },
    );
    const modelCities = ["贵阳", "安顺", "凯里", "黔南"];
    const proposed: ActiveMission = {
      id: "m-guizhou",
      raw,
      goal: {
        ...base,
        raw,
        decision: "propose",
        needsConfirm: true,
        plan: undefined,
        known: {
          ...base.known,
          origin: "北京",
          region: "贵州",
          cities: modelCities,
          start: "2026-10-10",
          end: "2026-10-20",
        },
      },
      plan: compileHands({ ...base, decision: "propose" as const, needsConfirm: true }),
      findings: [],
      state: "propose",
    };
    const go = run("按这个做", { active: proposed });
    expect(go.effect).toBe("run");
    expect(go.mission?.state).toBe("running");
    expect(go.mission?.goal.kind).toBe("trip");
    expect(go.mission?.plan[0]?.cap).toBe("trip_plan");
    // 模型推荐的城市原样保留，出发地/日期不丢
    expect(go.mission?.plan[0]?.trip?.cities).toEqual(modelCities);
    expect(go.mission?.plan[0]?.trip?.origin).toBe("北京");
    expect(go.mission?.plan[0]?.trip?.startDate).toBe("2026-10-10");
    expect(go.mission?.plan[0]?.trip?.endDate).toBe("2026-10-20");
  });

  it("去四川玩一周含机票酒店：问出发地，不继承上一趟北京", () => {
    const q = "我想去四川玩一周，含机票酒店";
    const t = run(q);
    expect(t.effect).toBe("ask");
    expect(t.say).toMatch(/出发/);
    const first = run(
      "帮我安排一个云南旅游行程 本月18日从北京出发 28日回来 至少去5个城市 含机票酒店",
    );
    const next = run(q, { last: first.mission, active: undefined });
    expect(next.effect).toBe("ask");
    expect(next.mission?.goal.known.origin).toBeUndefined();
  });
});

describe("工作单：跟进与旁路", () => {
  it("停问期间说总结当前页：旁路读页，不关上一张单", () => {
    const first = run(SAMPLE_YUNNAN_ASK);
    expect(first.effect).toBe("ask");
    expect(classifyIngest("总结当前页", first.mission).kind).toBe("side");
    const side = run("总结当前页", { active: first.mission });
    expect(side.side?.goal.kind).toBe("page");
    expect(side.mission?.state).toBe("blocked");
    expect(parseLocalIntent("总结当前页").type).toBe("summarize");
  });

  it("山西行程之后问吃的玩的：接上一趟", () => {
    const trip = run("明天早上从北京出发去山西玩十天帮我规划全程");
    const follow = run("都有什么吃的玩的推荐？", { last: trip.mission });
    expect(follow.effect).toBe("run");
    expect(follow.mission?.goal.kind).toBe("eatplay");
    expect(follow.mission?.goal.known.cities).toEqual(["太原", "大同", "平遥"]);
    expect(follow.mission?.plan[0]?.cap).toBe("mission");
    expect(follow.mission?.plan[0]?.mission?.title).toMatch(/吃喝玩/);
    expect(shouldSealShopReport("都有什么吃的玩的推荐？", "snapshot: 1")).toBe(false);
  });

  it("没有上一趟时，吃的玩的要问哪座城", () => {
    const t = run("都有什么吃的玩的推荐？");
    expect(t.effect).toBe("ask");
    expect(t.say).toMatch(/哪座城/);
  });

  it("打开百度搜天气、携程酒店、比价：编译到手", () => {
    const weather = run("打开百度，搜今天杭州天气");
    expect(weather.effect).toBe("run");
    expect(weather.mission?.plan[0]?.cap).toBe("act");

    const hotel = run("在携程查10月2日杭州的酒店");
    expect(hotel.effect).toBe("run");
    expect(hotel.mission?.goal.kind).toBe("travel");
    expect(hotel.mission?.plan[0]?.cap).toBe("hotel_search");
    expect(hotel.mission?.plan[0]?.city).toMatch(/杭州/);

    const shop = run("戴森 淘宝京东比价");
    expect(shop.effect).toBe("run");
    expect(shop.mission?.plan[0]?.cap).toBe("mission");
    expect(shop.mission?.plan[0]?.mission?.title).toMatch(/比价/);
  });

  it("跟进修改上一趟：筛选300内4.5分以上酒店，不重问出发地", () => {
    const first = run(
      "帮我安排一个云南旅游行程 本月18日从北京出发 28日回来 要把云南都玩一遍 至少去5个城市 著名景点都要安排 以及酒店 还有飞机火车票之类",
    );
    const follow = run(
      "嗯，请帮我筛选300块钱以内的酒店吧，好吗？评分要4.5分以上的，然后你重新再帮我设计一个行程",
      { last: first.mission },
    );
    expect(follow.effect).toBe("run");
    expect(follow.mission?.goal.kind).toBe("trip");
    expect(follow.mission?.goal.known.origin).toBe("北京");
    expect(follow.mission?.goal.known.start).toBe("2026-09-18");
    expect(follow.mission?.goal.known.cities).toEqual(["昆明", "大理", "丽江", "香格里拉", "西双版纳"]);
    expect(follow.mission?.goal.known.hotelPriceMax).toBe(300);
    expect(follow.mission?.goal.known.hotelMinRating).toBe(4.5);
    expect(follow.mission?.plan[0]?.trip?.hotelPriceMax).toBe(300);
  });

  it("找视频走 video_search，不靠模型选百度", () => {
    const t = run("最近想要减肥 学习瑜伽 帮我找相关视频");
    expect(t.effect).toBe("run");
    expect(t.mission?.plan.some((s) => s.cap === "video_search")).toBe(true);
  });
});

describe("compileHands / 只查酒店", () => {
  it("单次查酒店不要变成行程设计", () => {
    const goal = analyzeGoalHeuristic("在携程查9月15日伊斯坦布尔的酒店", { now: NOW });
    expect(goal.deliverables.map((d) => d.id)).toEqual(["stay"]);
    const plan = planForGoal(goal);
    expect(plan.some((s) => s.covers.includes("food"))).toBe(false);
    expect(compileHands(goal)[0]?.cap).toBe("hotel_search");
  });
});
