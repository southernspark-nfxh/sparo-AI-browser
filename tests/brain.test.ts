import { describe, expect, it } from "vitest";
import { understandLocal, parseUnderstandJson, mergeUnderstanding } from "../src/main/agent/brain/understand.js";
import { analyzeGoal, analyzeGoalHeuristic, compileHands, inferDeliverables, mergePlan } from "../src/main/agent/loop.js";
import { leftoverAfterOpen } from "../src/main/agent/intent-router.js";

const NOW = new Date(2026, 8, 15);

describe("大脑：听整句，不丢掉顺便", () => {
  it("云南七天 + 旅行社比价：行程和对照都在", () => {
    const q = "去云南玩七天顺便对比三家旅行社报价";
    const u = understandLocal(q, { now: NOW });
    expect(u.deliverables).toEqual(expect.arrayContaining(["itinerary", "report"]));
    expect(u.known.region).toBe("云南");
    expect(u.known.cities?.length).toBeGreaterThanOrEqual(3);
    const goal = analyzeGoalHeuristic(q, { now: NOW });
    expect(goal.kind).toBe("trip");
    expect(goal.deliverables.map((d) => d.id)).toEqual(expect.arrayContaining(["itinerary", "report"]));
  });

  it("展览 + 附近酒店：两件事都留下", () => {
    const q = "这周北京有什么展，顺便订附近酒店";
    const ids = inferDeliverables(q).map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(["sights", "stay"]));
    const goal = analyzeGoalHeuristic(q, { now: NOW });
    expect(goal.known.cities).toContain("北京");
    const caps = compileHands(goal).map((s) => s.cap);
    expect(caps).toContain("hotel_search");
    expect(caps.some((c) => c === "search_read" || c === "mission")).toBe(true);
  });

  it("生日餐厅 + 能住的：吃和住都要，听得出老人", () => {
    const q = "我妈下周过生日，北京有什么适合带老人的安静餐厅和附近能住的";
    const u = understandLocal(q, { now: NOW });
    expect(u.deliverables).toEqual(expect.arrayContaining(["food", "stay"]));
    expect(u.known.audience).toBe("老人");
    expect(u.known.cities).toContain("北京");
  });

  it("值不值得去：是判断调研，不是闲聊", () => {
    const q = "帮我看看纽约值不值得去";
    const u = understandLocal(q, { now: NOW });
    expect(u.deliverables).toContain("report");
    expect(u.known.cities).toContain("纽约");
    const goal = analyzeGoalHeuristic(q, { now: NOW });
    expect(goal.kind).toBe("research");
    expect(goal.decision).toBe("act");
  });

  it("打开百度再搜天气：听得出后半句", () => {
    const q = "打开百度，搜今天北京天气";
    expect(leftoverAfterOpen(q)).toMatch(/天气/);
    const u = understandLocal(q, { now: NOW });
    expect(u.leftover).toMatch(/天气/);
    const goal = analyzeGoalHeuristic(q, { now: NOW });
    const hands = compileHands(goal);
    expect(hands[0]?.action?.type === "act" || hands[0]?.cap === "act" || hands[0]?.cap === "navigate").toBe(true);
  });

  it("模型只报第一件事时，本地已听见的块不能被删", () => {
    const q = "去云南玩七天顺便对比三家旅行社报价";
    const local = understandLocal(q, { now: NOW });
    const merged = mergeUnderstanding(local, {
      heard: "对比旅行社",
      deliverables: ["report"],
    });
    expect(merged.deliverables).toEqual(expect.arrayContaining(["itinerary", "report"]));
  });

  it("模型 JSON 能被听懂，假城会被尺子丢掉", () => {
    const parsed = parseUnderstandJson(
      JSON.stringify({
        heard: "纽约两天",
        deliverables: ["stay", "food"],
        known: { cities: ["纽约", "我打算"] },
      }),
    );
    expect(parsed?.known?.cities).toEqual(["纽约"]);
    expect(parsed?.deliverables).toEqual(["stay", "food"]);
  });

  it("有模型时也走理解器，不能把混合句收成一块", async () => {
    const q = "这周北京有什么展，顺便订附近酒店";
    const goal = await analyzeGoal(q, { now: NOW }, async () =>
      JSON.stringify({
        heard: "北京看展并订附近酒店",
        clauses: [
          { text: "有什么展", purpose: "展览", deliverables: ["sights"] },
          { text: "订附近酒店", purpose: "住宿", deliverables: ["stay"] },
        ],
        deliverables: ["sights", "stay"],
        known: { cities: ["北京"] },
      }),
    );
    expect(goal.deliverables.map((d) => d.id)).toEqual(expect.arrayContaining(["sights", "stay"]));
    expect(goal.known.cities).toContain("北京");
  });

  it("parseUnderstandJson 解析 plan/ingest：模型编的手草稿留下", () => {
    const parsed = parseUnderstandJson(
      JSON.stringify({
        heard: "北京订酒店",
        ingest: "new",
        deliverables: ["stay"],
        known: { cities: ["北京"] },
        plan: [
          {
            cap: "hotel_search",
            covers: ["stay"],
            query: "北京酒店",
            city: "北京",
            site: "ctrip",
            label: "携程查酒店",
          },
        ],
      }),
    );
    expect(parsed?.ingest).toBe("new");
    expect(parsed?.plan?.length).toBe(1);
    expect(parsed?.plan?.[0].cap).toBe("hotel_search");
    expect(parsed?.plan?.[0].covers).toEqual(["stay"]);
    expect(parsed?.plan?.[0].site).toBe("ctrip");
  });

  it("parseUnderstandJson 非法 ingest 被丢回 undefined", () => {
    const parsed = parseUnderstandJson(
      JSON.stringify({
        heard: "x",
        ingest: "瞎编",
        deliverables: ["stay"],
      }),
    );
    expect(parsed?.ingest).toBeUndefined();
  });

  it("parseUnderstandJson 非法 plan（空 cap 或空 covers）被过滤", () => {
    const parsed = parseUnderstandJson(
      JSON.stringify({
        heard: "x",
        deliverables: ["stay"],
        plan: [
          { cap: "", covers: ["stay"] },
          { cap: "hotel_search", covers: [] },
          { cap: "hotel_search", covers: ["stay"] },
        ],
      }),
    );
    expect(parsed?.plan?.length).toBe(1);
    expect(parsed?.plan?.[0].cap).toBe("hotel_search");
  });

  it("mergeUnderstanding 合并 plan/ingest：模型胜出，本地无时不被覆盖", () => {
    const local = understandLocal("北京订酒店", { now: NOW });
    expect(local.plan).toBeUndefined();
    expect(local.ingest).toBeUndefined();
    const merged = mergeUnderstanding(local, {
      heard: "北京订酒店",
      ingest: "new",
      plan: [{ cap: "hotel_search", covers: ["stay"], city: "北京" }],
    });
    expect(merged.ingest).toBe("new");
    expect(merged.plan?.length).toBe(1);
    expect(merged.plan?.[0].cap).toBe("hotel_search");
  });

  it("mergeUnderstanding 本地已有 plan 时模型不编不覆盖", () => {
    const local: ReturnType<typeof understandLocal> = {
      ...understandLocal("北京订酒店", { now: NOW }),
      plan: [{ cap: "hotel_search", covers: ["stay"], city: "北京" }],
      ingest: "amend",
    };
    const merged = mergeUnderstanding(local, {
      heard: "北京订酒店",
    });
    expect(merged.ingest).toBe("amend");
    expect(merged.plan?.length).toBe(1);
  });

  it("analyzeGoal 用模型编的 plan 走 handbook，compileHands 返回 handbook", async () => {
    const q = "北京订酒店";
    const goal = await analyzeGoal(q, { now: NOW }, async () =>
      JSON.stringify({
        heard: "北京订酒店",
        ingest: "new",
        deliverables: ["stay"],
        known: { cities: ["北京"] },
        plan: [{ cap: "hotel_search", covers: ["stay"], city: "北京", site: "ctrip" }],
      }),
    );
    expect(goal.handbook?.length).toBe(1);
    expect(goal.handbook?.[0].cap).toBe("hotel_search");
    const hands = compileHands(goal);
    expect(hands.length).toBe(1);
    expect(hands[0].cap).toBe("hotel_search");
    expect(hands[0].site).toBe("ctrip");
    expect(hands[0].covers).toContain("stay");
  });

  it("多城行程模型只编散手时，整合 trip_plan 必须补回首步", () => {
    const goal = analyzeGoalHeuristic(
      "10月26日到30日去湖南5天，从广州出发30日回，长沙、张家界、凤凰古城都想去，高铁和酒店行程帮我安排",
      { now: new Date(2026, 8, 17) },
    );
    // 模拟模型只给散手（实测 Q2 场景：flight/hotel/search 各一步，漏掉 trip_plan）
    goal.handbook = mergePlan(goal, [
      { cap: "flight_search", label: "查广州往返长沙机票", covers: ["flights"], query: "广州→长沙 10月26日机票" },
      { cap: "hotel_search", label: "搜长沙酒店", covers: ["stay"], city: "长沙" },
      { cap: "search_read", label: "长沙美食", covers: ["food"], query: "长沙美食推荐" },
    ]);
    const hands = compileHands(goal);
    expect(hands[0].cap).toBe("trip_plan");
    expect(hands[0].trip?.cities).toEqual(["长沙", "张家界", "凤凰"]);
    expect(hands[0].trip?.endDate).toBe("2026-10-30");
    // 必需的住宿被整合手册覆盖，散手酒店不再重复执行
    expect(hands[0].covers).toEqual(expect.arrayContaining(["itinerary", "trains", "stay"]));
    expect(hands.filter((h) => h.cap === "hotel_search")).toHaveLength(0);
  });

  it("调研比价模型只编散手 search_read 时，mission 整手必须补回首步", () => {
    const goal = analyzeGoalHeuristic(
      "戴森HD15和徕芬LF03吹风机哪个值得买，从价格、风速、噪音、重量、售后对比，出个对比报告",
      { now: new Date(2026, 8, 17) },
    );
    expect(goal.deliverables.some((d) => d.id === "report" && d.required)).toBe(true);
    goal.handbook = mergePlan(goal, [
      { cap: "search_read", label: "检索戴森徕芬对比", covers: ["report"], query: "戴森HD15 徕芬LF03 对比" },
      { cap: "search_read", label: "检索参数", covers: ["report"], query: "吹风机 参数" },
    ]);
    const hands = compileHands(goal);
    expect(hands[0].cap).toBe("mission");
    expect(hands[0].covers).toContain("report");
    expect(hands[0].mission).toBeTruthy();
  });

  it("模型把同一调研编成多个重复 mission 时，只保留第一个 report mission", () => {
    const goal = analyzeGoalHeuristic(
      "预算5000左右买轻薄本，联想小新Pro14、华为MateBook 14、MacBook Air M3三款对比，出一个对比报告",
      { now: new Date(2026, 8, 17) },
    );
    goal.handbook = mergePlan(
      goal,
      Array.from({ length: 4 }, () => ({
        cap: "mission",
        label: "生成三款轻薄本对比报告",
        covers: ["report"] as string[],
      })),
    );
    const hands = compileHands(goal);
    expect(hands.filter((h) => h.cap === "mission")).toHaveLength(1);
  });

  it("mergePlan 校验：非法 cap / 非法 covers / synthesize 被丢掉", () => {
    const goal = analyzeGoalHeuristic("北京订酒店", { now: NOW });
    const handbook = mergePlan(goal, [
      { cap: "bad_cap", covers: ["stay"] },
      { cap: "hotel_search", covers: ["bad_id"] },
      { cap: "synthesize", covers: ["answer"] },
      { cap: "hotel_search", covers: ["stay", "bad_id"] },
    ]);
    expect(handbook.length).toBe(1);
    expect(handbook[0].cap).toBe("hotel_search");
    expect(handbook[0].covers).toEqual(["stay"]);
  });

  it("mergePlan 上限 8 步：超出截断", () => {
    const goal = analyzeGoalHeuristic("北京订酒店", { now: NOW });
    const plan = Array.from({ length: 12 }, () => ({
      cap: "hotel_search",
      covers: ["stay"] as string[],
    }));
    const handbook = mergePlan(goal, plan);
    expect(handbook.length).toBe(8);
  });
});
