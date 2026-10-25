import { describe, expect, it } from "vitest";
import { analyzeGoalHeuristic, type AgentGoal, type AgentStep } from "../src/main/agent/loop.js";
import { observe, reconsiderMission } from "../src/main/agent/kernel/index.js";
import {
  applyParsedRevision,
  parsePlanJson,
  parsePlanRevision,
  planFromHeuristic,
  type Plan,
} from "../src/main/agent/kernel/plan.js";
import { applyTurn, applyTurnAsync, type ActiveMission } from "../src/main/agent/runtime.js";

const NOW = new Date(2026, 8, 14);
const NY =
  "想去美国纽约 两天 不知道住哪儿 有推荐吗 还有餐厅之类的 包括有什么景点？给我设计一下";
const TRIP =
  "帮我规划一个9月18号从北京出发，然后9月27号回到北京，要去土耳其和格鲁吉亚两个城市的旅行路线，包含机票酒店。从北京出发，落地伊斯坦布尔，从第比利斯回到北京";

function run(text: string, extra?: Parameters<typeof applyTurn>[1]) {
  return applyTurn(text, { now: NOW, ...extra });
}

describe("parsePlanJson", () => {
  it("收下合法步骤，第一步标成进行中", () => {
    const plan = parsePlanJson(
      '好的 {"steps":[{"label":"查去程机票","cap":"flight_search","covers":["flights"]},{"label":"查酒店","cap":"hotel_search","covers":["stay"]}]} 就这样',
    );
    expect(plan?.steps.map((s) => s.cap)).toEqual(["flight_search", "hotel_search"]);
    expect(plan?.steps[0].status).toBe("running");
    expect(plan?.steps[1].status).toBe("pending");
    expect(plan?.steps[0].label).toBe("查去程机票");
  });

  it("非法 cap 丢掉，剩下的还在", () => {
    const plan = parsePlanJson(
      JSON.stringify({
        steps: [
          { label: "乱来", cap: "explode", covers: ["flights"] },
          { label: "查酒店", cap: "hotel_search", covers: ["stay", "nope"] },
        ],
      }),
    );
    expect(plan?.steps).toHaveLength(1);
    expect(plan?.steps[0].cap).toBe("hotel_search");
    expect(plan?.steps[0].covers).toEqual(["stay"]);
  });

  it("空步骤、全非法、脏 JSON 都返回 null", () => {
    expect(parsePlanJson('{"steps":[]}')).toBeNull();
    expect(parsePlanJson('{"steps":[{"cap":"explode","covers":["nope"]}]}')).toBeNull();
    expect(parsePlanJson("不是 json")).toBeNull();
    expect(parsePlanJson('{"steps":')).toBeNull();
    expect(parsePlanJson("")).toBeNull();
  });
});

describe("planFromHeuristic", () => {
  it("兜底至少一步", () => {
    const goal: AgentGoal = {
      raw: "x",
      intent: "控制",
      kind: "control",
      deliverables: [],
      known: {},
      unknown: [],
      decision: "act",
      approach: "",
    };
    const plan = planFromHeuristic(goal);
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.steps[0].status).toBe("running");
    expect(plan.steps[0].cap).toBeTruthy();
  });

  it("总结当前页只有一两步", () => {
    const goal = analyzeGoalHeuristic("总结当前页", { now: NOW });
    const plan = planFromHeuristic(goal);
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.steps.length).toBeLessThanOrEqual(2);
  });
});

describe("applyTurn 挂上计划", () => {
  it("进入 running 时有计划，执行后步骤打勾", () => {
    const t = run(NY);
    expect(t.effect).toBe("run");
    expect(t.mission?.state).toBe("running");
    const plan = t.mission?.brainPlan;
    expect(plan?.steps.length).toBeGreaterThan(0);
    expect(plan?.steps[0].status).toBe("running");
    const hand = t.mission!.plan[0];
    const after = observe(t.mission!, {
      step: hand,
      text: "查到了可点的结果，足够写成一段。",
      url: "https://example.com",
      ok: true,
    });
    const hit = after.brainPlan?.steps.find((s) => s.cap === hand.cap && s.covers.some((c) => hand.covers.includes(c)));
    expect(hit?.status).toBe("done");
  });

  it("失败后 reconsider 把该步标失败并追加替代步骤", async () => {
    const t = run(NY);
    const before = t.mission!.brainPlan!.steps.length;
    const fail = {
      step: {
        id: "search_read-food",
        cap: "search_read" as const,
        label: "查纽约餐厅",
        covers: ["food" as const],
        city: "纽约",
        query: "纽约 餐厅",
      },
      text: "空",
      url: "https://www.baidu.com/s?wd=x",
      ok: false,
    };
    const after = await reconsiderMission({ ...t.mission!, findings: [fail] });
    expect(after.brainPlan?.steps.some((s) => s.status === "failed")).toBe(true);
    expect(after.brainPlan!.steps.length).toBeGreaterThan(before);
    expect(after.nudge?.cap).toBe("search_read");
  });

  it("简单单步不强制多步计划", () => {
    const t = run("总结当前页");
    const plan = (t.side?.brainPlan || t.mission?.brainPlan) as Plan | undefined;
    expect(plan?.steps.length).toBeGreaterThan(0);
    expect(plan!.steps.length).toBeLessThanOrEqual(2);
  });
});

describe("计划修订", () => {
  it("去掉最后一步只改计划，不重问已经填好的槽", async () => {
    const first = run(TRIP);
    expect(first.effect).toBe("run");
    expect(first.mission?.goal.known.origin).toBe("北京");
    const origin = first.mission!.goal.known.origin;
    const cities = first.mission!.goal.known.cities;
    const steps = first.mission!.brainPlan!.steps;
    const kept = steps.slice(0, -1).map((s) => ({ label: s.label, cap: s.cap, covers: s.covers }));
    const again = await applyTurnAsync(
      "去掉最后一步",
      { active: first.mission, now: NOW },
      async () =>
        JSON.stringify({
          revise: true,
          why: "去掉最后一步",
          steps: kept.length ? kept : [{ label: "查去程机票", cap: "flight_search", covers: ["flights"] }],
        }),
    );
    expect(again.ingest).toBe("amend");
    expect(again.mission?.goal.known.origin).toBe(origin);
    expect(again.mission?.goal.known.cities).toEqual(cities);
    expect(again.mission?.id).toBe(first.mission?.id);
    expect(again.mission?.brainPlan?.revisedFrom).toMatch(/去掉最后一步/);
    expect(again.mission?.brainPlan?.steps.some((s) => s.status === "skipped")).toBe(true);
    expect(again.say).not.toMatch(/还缺|哪座|问/);
    expect(again.mission?.state).toBe("running");
  });

  it("模型说这不是改计划时，沿用原计划", async () => {
    const first = run(NY);
    const again = await applyTurnAsync("继续", { active: first.mission, now: NOW }, async () => {
      throw new Error("不该为纯继续去问模型");
    });
    expect(again.effect).toBe("run");
    expect(again.mission?.brainPlan?.steps.length).toBe(first.mission?.brainPlan?.steps.length);
    expect(again.mission?.brainPlan?.revisedFrom).toBeUndefined();
  });

  it("模型超时仍给出兜底计划", async () => {
    const again = await applyTurnAsync("戴森吹风机 在淘宝和京东比价", { now: NOW }, async () => {
      throw new Error("timeout");
    });
    expect(again.mission?.state).toBe("running");
    expect(again.mission?.brainPlan?.steps.length).toBeGreaterThan(0);
  });

  it("parsePlanRevision 拒绝空改和脏 JSON", () => {
    expect(parsePlanRevision('{"revise":false}')).toEqual({ revise: false });
    expect(parsePlanRevision("废话")).toBeNull();
    expect(parsePlanRevision('{"revise":true,"steps":[{"cap":"nope","covers":["x"]}]}')).toEqual({
      revise: false,
    });
  });

  it("提议卡上的「改」换一版做法，不问出发地", async () => {
    const hands: AgentStep[] = [
      { id: "a", cap: "read_page", label: "读取当前页", covers: ["page"] },
      { id: "b", cap: "act", label: "写成报告页", covers: ["report"] },
    ];
    const propose: ActiveMission = {
      id: "m-propose",
      raw: "读这一页，把标题归纳成一行备忘",
      findings: [],
      state: "propose",
      plan: hands,
      goal: {
        raw: "读这一页，把标题归纳成一行备忘",
        intent: "读当前页并写成备忘",
        kind: "page",
        deliverables: [{ id: "page", label: "读懂当前页", required: true }],
        known: {},
        unknown: [],
        needsConfirm: true,
        decision: "propose",
        approach: "1. 读取当前页；2. 写成报告页",
        coverage: "new",
        handbook: hands,
      },
    };
    const kept = applyTurn("改", { active: propose, now: NOW });
    expect(kept.effect).toBe("propose");
    expect(kept.mission?.state).toBe("propose");
    expect(kept.mission?.blockedSlot).toBeUndefined();
    expect(kept.say).not.toMatch(/出发地|城市|日期/);

    const again = await applyTurnAsync("改", { active: propose, now: NOW }, async () =>
      JSON.stringify({
        revise: true,
        why: "改成先抄标题",
        steps: [
          { label: "只读标题", cap: "read_page", covers: ["page"] },
          { label: "写一行备忘", cap: "act", covers: ["report"] },
        ],
      }),
    );
    expect(again.effect).toBe("propose");
    expect(again.mission?.state).toBe("propose");
    expect(again.mission?.blockedSlot).toBeUndefined();
    expect(again.mission?.goal.approach).toBe("1. 只读标题；2. 写一行备忘");
    expect(again.mission?.goal.needsConfirm).toBe(true);
    expect(again.say).not.toMatch(/出发地|城市|日期/);
    expect(again.mission?.id).toBe(propose.id);
  });

  it("已经卡住的行程说「改」，仍问出发地、城市或日期", () => {
    const first = run(NY);
    const blocked: ActiveMission = {
      ...first.mission!,
      state: "blocked",
      blockedSlot: "destination",
      ask: "想去哪座城市？",
    };
    const again = applyTurn("改", { active: blocked, now: NOW });
    expect(again.effect).toBe("ask");
    expect(again.mission?.state).toBe("blocked");
    expect(again.say).toMatch(/出发地、城市还是日期/);
  });

  it("applyParsedRevision 保留已完成步骤", () => {
    const plan: Plan = {
      createdAt: 1,
      steps: [
        { id: "a", label: "查机票", cap: "flight_search", covers: ["flights"], status: "done" },
        { id: "b", label: "查酒店", cap: "hotel_search", covers: ["stay"], status: "running" },
        { id: "c", label: "写手册", cap: "search_read", covers: ["report"], status: "pending" },
      ],
    };
    const next = applyParsedRevision(plan, {
      revise: true,
      why: "去掉最后一步",
      steps: [{ label: "查酒店", cap: "hotel_search", covers: ["stay"] }],
    });
    expect(next.steps.find((s) => s.id === "a")?.status).toBe("done");
    expect(next.steps.some((s) => s.label === "写手册" && s.status === "skipped")).toBe(true);
    expect(next.steps.some((s) => s.cap === "hotel_search" && s.status === "running")).toBe(true);
  });
});

describe("修订不把工作单类型弄丢", () => {
  it("可执行 plan 仍然是 AgentStep", () => {
    const t = run(TRIP);
    const mission: ActiveMission = t.mission!;
    expect(mission.plan[0]?.cap).toBe("trip_plan");
    expect(mission.brainPlan?.steps.length).toBeGreaterThan(0);
  });
});
