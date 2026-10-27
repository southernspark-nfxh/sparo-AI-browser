import { describe, expect, it } from "vitest";
import { parseUnderstandJson } from "../src/main/agent/brain/understand.js";
import {
  adaptPlan,
  analyzeGoal,
  analyzeGoalHeuristic,
  ensurePlanCovers,
  inferDeliverables,
  mergeAnalyze,
  navigateTarget,
  planForGoal,
  stepCanRun,
  travelSearchLeg,
  verifyProgress,
  type AgentGoal,
  type AgentStep,
  type StepFinding,
} from "../src/main/agent/loop.js";

const LA =
  "想去美国洛杉矶 两天 不知道住哪儿 有推荐吗 还有餐厅之类的 包括有什么景点？给我设计一下";
const HOTEL_ONLY = "在携程查9月15日伊斯坦布尔的酒店";
const NOW = new Date(2026, 8, 15);

function finding(step: AgentStep, text: string, ok = true): StepFinding {
  return { step, text, url: "https://example.com", ok };
}

describe("inferDeliverables", () => {
  it("洛杉矶原话拆出住、餐厅、景点、日程，不是只认酒店", () => {
    const ids = inferDeliverables(LA).map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(["stay", "food", "sights", "itinerary"]));
    expect(ids).not.toContain("flights");
  });

  it("只查酒店就只有住宿", () => {
    expect(inferDeliverables(HOTEL_ONLY).map((d) => d.id)).toEqual(["stay"]);
  });
});

describe("analyze + plan", () => {
  it("洛杉矶目标可执行：有城、有计划盖住吃住玩", () => {
    const goal = analyzeGoalHeuristic(LA, { now: NOW });
    expect(goal.decision).toBe("act");
    expect(goal.unknown).toEqual([]);
    expect(goal.known.cities).toContain("洛杉矶");
    const plan = planForGoal(goal);
    const covered = new Set(plan.flatMap((s) => s.covers));
    expect(covered.has("stay")).toBe(true);
    expect(covered.has("food")).toBe(true);
    expect(covered.has("sights")).toBe(true);
    expect(plan.some((s) => s.cap === "hotel_search")).toBe(true);
    expect(plan.filter((s) => s.cap === "search_read").length).toBeGreaterThanOrEqual(2);
  });

  it("模型若只报酒店，合并时不能丢掉原话里的餐厅和景点", () => {
    const h = analyzeGoalHeuristic(LA, { now: NOW });
    const merged = mergeAnalyze(h, {
      intent: "查洛杉矶酒店",
      deliverables: [{ id: "stay", label: "住宿", required: true }],
    });
    const ids = merged.deliverables.map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(["stay", "food", "sights", "itinerary"]));
  });

  it("计划漏了餐厅时 ensurePlanCovers 会补上", () => {
    const goal = analyzeGoalHeuristic(LA, { now: NOW });
    const thin: AgentStep[] = [
      {
        id: "hotel",
        cap: "hotel_search",
        label: "查酒店",
        covers: ["stay"],
        city: "洛杉矶",
      },
    ];
    const full = ensurePlanCovers(goal, thin);
    expect(full.some((s) => s.covers.includes("food"))).toBe(true);
    expect(full.some((s) => s.covers.includes("sights"))).toBe(true);
  });
});

describe("verify", () => {
  it("只有酒店正文时验收失败，点名还缺餐厅和景点", () => {
    const goal = analyzeGoalHeuristic(LA, { now: NOW });
    const plan = planForGoal(goal);
    const hotel = plan.find((s) => s.cap === "hotel_search")!;
    const v = verifyProgress(goal, [
      finding(hotel, "洛杉矶机场希尔顿酒店 ¥984 4.4分 住宿推荐 每晚含早"),
    ]);
    expect(v.complete).toBe(false);
    expect(v.missing).toEqual(expect.arrayContaining(["food", "sights"]));
    expect(v.covered).toContain("stay");
    const extra = adaptPlan(goal, v.missing);
    expect(extra.some((s) => s.covers.includes("food"))).toBe(true);
  });

  it("三步正文 + 带日程的汇总才算齐", () => {
    const goal = analyzeGoalHeuristic(LA, { now: NOW });
    const plan = planForGoal(goal);
    const stay = plan.find((s) => s.covers.includes("stay"))!;
    const food = plan.find((s) => s.covers.includes("food"))!;
    const sights = plan.find((s) => s.covers.includes("sights"))!;
    const v = verifyProgress(
      goal,
      [
        finding(stay, "希尔顿酒店 住宿 每晚984 含早"),
        finding(food, "必吃餐厅 烤肉 推荐 人均"),
        finding(sights, "必去景点 好莱坞 海滩 步行"),
      ],
      {
        synthesized:
          "第一天上午好莱坞，中午烤肉餐厅，晚上住希尔顿。第二天海滩。",
      },
    );
    expect(v.complete).toBe(true);
    expect(v.missing).toEqual([]);
  });
});

describe("coverage", () => {
  it("drops a coverage value outside covered/new", () => {
    const parsed = parseUnderstandJson(
      JSON.stringify({ heard: "x", coverage: "weekly", deliverables: ["answer"] }),
    );
    expect(parsed?.coverage).toBeUndefined();
  });

  it("coverage new with a plan proposes a numbered approach", async () => {
    const goal = await analyzeGoal("帮我核对电费通知单上的户号", { now: NOW }, async () =>
      JSON.stringify({
        heard: "核对电费户号",
        ingest: "new",
        coverage: "new",
        deliverables: ["answer"],
        plan: [
          { cap: "search_read", covers: ["answer"], label: "抄户号", query: "电费户号" },
          { cap: "read_page", covers: ["answer"], label: "对账单", query: "通知单" },
        ],
      }),
    );
    expect(goal.decision).toBe("propose");
    expect(goal.coverage).toBe("new");
    expect(goal.approach).toContain("1. 抄户号");
    expect(goal.approach).toContain("2. 对账单");
  });

  it("coverage covered does not propose", async () => {
    const goal = await analyzeGoal("北京订酒店", { now: NOW }, async () =>
      JSON.stringify({
        heard: "北京订酒店",
        coverage: "covered",
        deliverables: ["stay"],
        known: { cities: ["北京"] },
        plan: [{ cap: "hotel_search", covers: ["stay"], city: "北京", label: "查酒店" }],
      }),
    );
    expect(goal.decision).not.toBe("propose");
    expect(goal.coverage).toBe("covered");
  });

  it("coverage new without a plan does not propose", async () => {
    const goal = await analyzeGoal("帮我核对电费通知单上的户号", { now: NOW }, async () =>
      JSON.stringify({
        heard: "核对电费户号",
        coverage: "new",
        deliverables: ["answer"],
      }),
    );
    expect(goal.decision).not.toBe("propose");
  });

  it("coverage new with a pure synthesize plan still proposes, handbook falls back", async () => {
    const goal = await analyzeGoal("帮我设计一个密室逃脱的三道谜题，要环环相扣", { now: NOW }, async () =>
      JSON.stringify({
        heard: "设计三道密室谜题",
        ingest: "new",
        coverage: "new",
        deliverables: ["answer"],
        plan: [
          { cap: "synthesize", covers: ["answer"], label: "设计谜题一" },
          { cap: "synthesize", covers: ["answer"], label: "设计谜题二" },
        ],
      }),
    );
    expect(goal.decision).toBe("propose");
    expect(goal.needsConfirm).toBe(true);
    expect(goal.coverage).toBe("new");
    expect(goal.approach).toContain("1. 设计谜题一");
    expect(goal.approach).toContain("2. 设计谜题二");
    expect(goal.handbook?.length).toBeGreaterThan(0);
  });

  it("coverage new with a mixed plan proposes, handbook keeps only the legal steps", async () => {
    const goal = await analyzeGoal("打开网易云音乐，帮我建一个适合跑步听的歌单", { now: NOW }, async () =>
      JSON.stringify({
        heard: "建跑步歌单",
        ingest: "new",
        coverage: "new",
        deliverables: ["answer"],
        plan: [
          { cap: "navigate", covers: ["answer"], label: "打开网易云", query: "https://music.163.com" },
          { cap: "synthesize", covers: ["answer"], label: "编歌单" },
        ],
      }),
    );
    expect(goal.decision).toBe("propose");
    expect(goal.coverage).toBe("new");
    expect(goal.handbook?.some((s) => s.cap === "navigate")).toBe(true);
    expect(goal.handbook?.some((s) => s.cap === "synthesize")).toBe(false);
  });

  it("coverage covered with an all-synthesize plan stays silent", async () => {
    const goal = await analyzeGoal("帮我核对电费通知单上的户号", { now: NOW }, async () =>
      JSON.stringify({
        heard: "核对电费户号",
        coverage: "covered",
        deliverables: ["answer"],
        plan: [{ cap: "synthesize", covers: ["answer"], label: "直接答" }],
      }),
    );
    expect(goal.decision).not.toBe("propose");
    expect(goal.coverage).toBeUndefined();
    expect(goal.handbook).toBeUndefined();
  });
});

describe("travel leg matches the execution hand", () => {
  const s7Goal = {
    known: { cities: ["北京", "南京"], start: "2026-11-07", end: "2026-11-08" },
  };
  const s7Step = {
    cap: "train_search",
    label: "搜11月6日北京到南京高铁",
    query: "11月6日北京到南京高铁时刻与价格",
    city: "南京",
  };

  it("S7 去程：日期粘在城市上时组不出腿，计划层也不放行", () => {
    expect(travelSearchLeg(s7Step, s7Goal)).toBeNull();
    expect(stepCanRun(s7Step, s7Goal)).toBe(false);
  });

  it("查询能拆出城市、日期在 step.date 上时，腿和计划层一致", () => {
    const step = { cap: "train_search", query: "北京到南京", date: "2026-11-06" };
    expect(travelSearchLeg(step, { known: {} })).toEqual({
      from: "北京",
      to: "南京",
      date: "2026-11-06",
    });
    expect(stepCanRun(step, { known: {} })).toBe(true);
  });

  it("起讫在字段上、日期只在 known.start 时也能组腿", () => {
    const step = { cap: "flight_search", from: "北京", to: "南京" };
    expect(travelSearchLeg(step, { known: { start: "2026-11-06" } })).toEqual({
      from: "北京",
      to: "南京",
      date: "2026-11-06",
    });
  });

  it("navigate 没有 query、标签是网址时有手；普通中文标签没有", () => {
    expect(navigateTarget({ label: "https://weibo.com/login.php" })).toBe(
      "https://weibo.com/login.php",
    );
    expect(stepCanRun({ cap: "navigate", label: "https://weibo.com/login.php" })).toBe(true);
    expect(stepCanRun({ cap: "navigate", label: "打开微博登录页" })).toBe(false);
    expect(stepCanRun({ cap: "search_read", label: "查今天北京天气" })).toBe(false);
  });
});

describe("hotel-only", () => {
  it("单次查酒店不要变成行程设计", () => {
    const goal: AgentGoal = analyzeGoalHeuristic(HOTEL_ONLY, { now: NOW });
    expect(goal.deliverables.map((d) => d.id)).toEqual(["stay"]);
    const plan = planForGoal(goal);
    expect(plan.every((s) => s.covers.includes("stay") || s.cap === "hotel_search")).toBe(true);
    expect(plan.some((s) => s.covers.includes("food"))).toBe(false);
  });
});
