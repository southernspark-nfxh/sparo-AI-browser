import { describe, expect, it } from "vitest";
import { applyTurn, classifyIngest } from "../src/main/agent/runtime.js";
import { analyzeGoal, analyzeGoalHeuristic, type StepFinding } from "../src/main/agent/loop.js";
import {
  kernelTick,
  observe,
  thoughtFor,
  verifyContracts,
  observationCovers,
} from "../src/main/agent/kernel/index.js";
import { SAMPLE_YUNNAN_ASK } from "../src/main/agent/slots.js";

const NOW = new Date(2026, 8, 14);
const NY =
  "想去美国纽约 两天 不知道住哪儿 有推荐吗 还有餐厅之类的 包括有什么景点？给我设计一下";
const LA =
  "想去美国洛杉矶 两天 不知道住哪儿 有推荐吗 还有餐厅之类的 包括有什么景点？给我设计一下";
const HOTEL = "在携程查9月15日伊斯坦布尔的酒店";

function finding(mission: ReturnType<typeof applyTurn>["mission"], text: string, url: string, covers = ["stay"]): StepFinding {
  const step = mission!.plan.find((s) => s.covers.some((c) => covers.includes(c))) || mission!.plan[0];
  return { step, text, url, ok: true };
}

describe("kernel：纽约必须 next 不是 ask", () => {
  it("开单后第一步是查住宿", () => {
    const t = applyTurn(NY, { now: NOW });
    expect(t.effect).toBe("run");
    const thought = thoughtFor(t.mission!);
    expect(thought.ask).toBeUndefined();
    expect(thought.next?.cap).toBe("hotel_search");
    expect(thought.deliverables).toEqual(expect.arrayContaining(["stay", "food", "sights", "itinerary"]));
    expect(thought.deliverables).not.toContain("flights");
  });

  it("模型写 ask 也不能把纽约打成问句", async () => {
    const goal = await analyzeGoal(NY, { now: NOW }, async () =>
      JSON.stringify({
        intent: "纽约两天",
        decision: "ask",
        ask: "",
        unknown: ["预算"],
        deliverables: [{ id: "stay" }],
      }),
    );
    expect(goal.decision).toBe("act");
    const t = applyTurn(NY, { now: NOW });
    expect(thoughtFor(t.mission!).next?.cap).toBe("hotel_search");
  });

  it("住查完后下一步是餐厅，不是收工", () => {
    const t = applyTurn(NY, { now: NOW });
    const stay = finding(
      t.mission,
      "希尔顿酒店 每晚984 含早\n万豪酒店 4.4分 客房",
      "https://hotels.ctrip.com/hotels/list?city=633",
      ["stay"],
    );
    const after = observe(t.mission!, stay);
    const thought = thoughtFor(after);
    expect(thought.synthesize).not.toBe(true);
    expect(thought.next?.covers).toContain("food");
    expect(thought.next?.cap).toBe("search_read");
  });

  it("observationCovers 只做结构判断：covers 含 id 且 ok 就算覆盖", () => {
    const goal = analyzeGoalHeuristic(NY, { now: NOW });
    const hotelStep = {
      id: "hotel",
      cap: "hotel_search" as const,
      label: "查酒店",
      covers: ["stay" as const],
    };
    const hotelFinding: StepFinding = {
      step: hotelStep,
      text: "希尔顿酒店 餐厅推荐 每晚984 住宿",
      url: "https://hotels.ctrip.com/hotels/list?city=633",
      ok: true,
    };
    // 结构判断：step.covers 含 stay && ok → 覆盖 stay
    expect(observationCovers(hotelFinding, "stay")).toBe(true);
    // 结构判断：step.covers 不含 food → 不覆盖 food（语义判断留给模型）
    expect(observationCovers(hotelFinding, "food")).toBe(false);
    // 改 covers 为 food：结构上覆盖 food。酒店页上的「餐厅」二字算不算真餐厅交付，由模型判，本地不拦
    expect(observationCovers({ ...hotelFinding, step: { ...hotelStep, covers: ["food"] } }, "food")).toBe(
      true,
    );
    const v = verifyContracts(goal, [hotelFinding]);
    expect(v.covered).toContain("stay");
    expect(v.missing).toEqual(expect.arrayContaining(["food", "sights"]));
  });

  it("洛杉矶同一句式同样直接动手", () => {
    const t = applyTurn(LA, { now: NOW });
    expect(thoughtFor(t.mission!).next?.cap).toBe("hotel_search");
    expect(t.mission?.goal.unknown).toEqual([]);
  });
});

describe("kernel：只查酒店 / 比价 / 跟进", () => {
  it("只查酒店只有住宿，查完就汇总", () => {
    const t = applyTurn(HOTEL, { now: NOW });
    const thought = thoughtFor(t.mission!);
    expect(thought.next?.cap).toBe("hotel_search");
    expect(thought.deliverables).toEqual(["stay"]);
    const after = observe(
      t.mission!,
      finding(
        t.mission,
        "佩拉宫酒店 每晚1200\n四季酒店 4.6分",
        "https://hotels.ctrip.com/hotels/list?city=istanbul",
      ),
    );
    const done = thoughtFor(after);
    expect(done.next).toBeUndefined();
    expect(done.synthesize).toBe(true);
  });

  it("比价走对照报告能力", () => {
    const t = applyTurn("戴森 淘宝京东比价", { now: NOW });
    expect(t.effect).toBe("run");
    const thought = thoughtFor(t.mission!);
    expect(thought.next?.cap).toBe("mission");
    expect(thought.deliverables).toContain("report");
  });

  it("？？？续跑同一张纽约单", () => {
    const first = applyTurn(NY, { now: NOW });
    const blocked = { ...first.mission!, state: "blocked" as const, ask: "还缺一项才能动手。" };
    expect(classifyIngest("？？？", blocked).kind).toBe("continue");
    const again = applyTurn("你有啥困惑", { active: blocked, now: NOW });
    expect(again.effect).toBe("run");
    expect(thoughtFor(again.mission!).next?.cap).toBe("hotel_search");
  });

  it("已订酒店：排除住宿，先排行程", () => {
    const t = applyTurn("纽约两天怎么玩，酒店我已经订好了，别再查住宿", { now: NOW });
    expect(t.effect).toBe("run");
    expect(t.mission?.goal.known.cities).toContain("纽约");
    expect(t.mission?.goal.known.exclude).toContain("stay");
    expect(t.mission?.goal.deliverables.map((d) => d.id)).not.toContain("stay");
    const thought = thoughtFor(t.mission!);
    expect(thought.next?.cap).not.toBe("hotel_search");
    expect(thought.next?.covers).toContain("itinerary");
  });

  it("只要景点：不查酒店，城已在原话里", () => {
    const t = applyTurn("酒店订好了，只要纽约景点", { now: NOW });
    expect(t.effect).toBe("run");
    expect(t.mission?.goal.known.cities).toContain("纽约");
    expect(t.mission?.goal.deliverables.map((d) => d.id)).toEqual(["sights"]);
    expect(thoughtFor(t.mission!).next?.covers).toContain("sights");
  });

  it("带小孩餐厅：不追问哪座城", () => {
    const t = applyTurn("推荐纽约适合带小孩的餐厅", { now: NOW });
    expect(t.effect).toBe("run");
    expect(t.mission?.goal.known.cities).toContain("纽约");
    expect(t.mission?.goal.known.audience).toBe("亲子");
    expect(thoughtFor(t.mission!).ask).toBeUndefined();
    expect(thoughtFor(t.mission!).next?.covers).toContain("food");
  });

  it("每晚预算能抽到，不追问城", () => {
    const t = applyTurn("预算每晚500，纽约住哪儿", { now: NOW });
    expect(t.effect).toBe("run");
    expect(t.mission?.goal.known.cities).toContain("纽约");
    expect(t.mission?.goal.known.hotelPriceMax).toBe(500);
    expect(thoughtFor(t.mission!).next?.cap).toBe("hotel_search");
  });

  it("先别查酒店：先排路线", () => {
    const t = applyTurn("先别查酒店，先告诉我纽约两天路线怎么排", { now: NOW });
    expect(t.effect).toBe("run");
    expect(t.mission?.goal.known.exclude).toContain("stay");
    expect(thoughtFor(t.mission!).next?.covers).toContain("itinerary");
  });

  it("值不值得去：当调研，不空汇总", () => {
    const t = applyTurn("帮我看看纽约值不值得去", { now: NOW });
    expect(t.effect).toBe("run");
    expect(t.mission?.goal.deliverables.map((d) => d.id)).toContain("report");
    expect(thoughtFor(t.mission!).synthesize).not.toBe(true);
    expect(thoughtFor(t.mission!).next).toBeTruthy();
  });

  it("英文 NYC 能抽城并动手", () => {
    const t = applyTurn("plan 2 days in NYC hotels restaurants attractions", { now: NOW });
    expect(t.effect).toBe("run");
    expect(t.mission?.goal.known.cities).toContain("纽约");
    expect(t.mission?.goal.deliverables.map((d) => d.id)).toEqual(
      expect.arrayContaining(["stay", "food", "sights", "itinerary"]),
    );
    expect(thoughtFor(t.mission!).next?.cap).toBe("hotel_search");
  });

  it("进行中说便宜点：amend 预算，不丢掉交付物", () => {
    const first = applyTurn(NY, { now: NOW });
    expect(classifyIngest("便宜点的", first.mission).kind).toBe("amend");
    const again = applyTurn("便宜点的", { active: first.mission, now: NOW });
    expect(again.effect).toBe("run");
    expect(again.mission?.goal.deliverables.map((d) => d.id)).toEqual(
      expect.arrayContaining(["stay", "food", "sights", "itinerary"]),
    );
    expect(again.mission?.goal.known.cheaper).toBe(true);
    expect(again.mission?.id).toBe(first.mission?.id);
  });

  it("缺目的地的短途会问城，不空汇总", () => {
    const t = applyTurn("我打算去玩两天", { now: NOW });
    expect(t.effect).toBe("ask");
    expect(thoughtFor(t.mission!).ask).toMatch(/城/);
  });

  it("不要酒店只要路线和餐厅：先排行程，不查住", () => {
    const t = applyTurn("带老人去杭州玩三天，不要酒店，只要路线和餐厅", { now: NOW });
    expect(t.effect).toBe("run");
    expect(t.mission?.goal.known.exclude).toContain("stay");
    expect(t.mission?.goal.known.audience).toBe("老人");
    expect(t.mission?.goal.deliverables.map((d) => d.id)).toEqual(["itinerary", "food"]);
    expect(thoughtFor(t.mission!).next?.covers).toContain("itinerary");
    expect(thoughtFor(t.mission!).next?.cap).not.toBe("hotel_search");
  });

  it("不要超过800、不要机场：预算和避开进槽，仍查住宿；observationCovers 不看 avoid", () => {
    const t = applyTurn("纽约住哪儿，不要超过800，不要机场附近", { now: NOW });
    expect(t.effect).toBe("run");
    expect(t.mission?.goal.known.hotelPriceMax).toBe(800);
    expect(t.mission?.goal.known.hotelAvoid).toContain("机场");
    expect(thoughtFor(t.mission!).next?.cap).toBe("hotel_search");
    const stay = {
      step: { id: "h", cap: "hotel_search" as const, label: "住", covers: ["stay" as const] },
      text: "纽约机场希尔顿酒店 每晚600 住宿",
      url: "https://hotels.ctrip.com/hotels/list?city=633",
      ok: true,
    };
    // observationCovers 只看结构（covers 含 stay && ok），avoid 的语义判断留给模型
    expect(observationCovers(stay, "stay", { avoid: ["机场"] })).toBe(true);
    expect(
      observationCovers(
        { ...stay, text: "曼哈顿希尔顿酒店 每晚700 客房" },
        "stay",
        { avoid: ["机场"] },
      ),
    ).toBe(true);
  });

  it("改成波士顿：换城，交付物不丢", () => {
    const first = applyTurn(NY, { now: NOW });
    expect(classifyIngest("改成波士顿吧", first.mission).kind).toBe("amend");
    const again = applyTurn("改成波士顿吧", { active: first.mission, now: NOW });
    expect(again.effect).toBe("run");
    expect(again.mission?.goal.known.cities).toEqual(["波士顿"]);
    expect(again.mission?.goal.deliverables.map((d) => d.id)).toEqual(
      expect.arrayContaining(["stay", "food", "sights", "itinerary"]),
    );
    expect(thoughtFor(again.mission!).next?.label).toMatch(/波士顿/);
  });

  it("云南缺出发地：thought 是 ask，不是 next", () => {
    const t = applyTurn(SAMPLE_YUNNAN_ASK, { now: NOW });
    const thought = thoughtFor(t.mission!);
    expect(thought.ask).toMatch(/出发/);
    expect(thought.next).toBeUndefined();
    const { verdict } = kernelTick(t.mission!);
    expect(verdict.complete).toBe(false);
  });
});
