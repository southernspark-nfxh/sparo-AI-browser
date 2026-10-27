import { describe, expect, it } from "vitest";
import { openSiteIsTheJob, siteOpenEndsTheJob } from "../src/main/agent/kernel/reasoner.js";
import { skipLoneNavigate, type Plan } from "../src/main/agent/kernel/plan.js";
import { earlyExitMayCloseDone } from "../src/main/agent/kernel/verify.js";
import type { AgentGoal, DeliverableId } from "../src/main/agent/loop.js";

const INCIDENT = "当前我打开的这个博主 最近三天的微博 帮我复制下来 做成一个文档";
const COPY_TAIL = "打开微博，把前十条复制下来";

function goal(raw: string, ids: DeliverableId[], site = "weibo.com"): AgentGoal {
  return {
    raw,
    intent: raw.slice(0, 24),
    kind: "page",
    deliverables: ids.map((id) => ({ id, label: id, required: true })),
    known: {},
    unknown: [],
    decision: "act",
    approach: "",
    site,
  };
}

function steps(caps: string[], status: Plan["steps"][number]["status"] = "running"): Plan {
  return {
    createdAt: 1,
    steps: caps.map((cap, i) => ({
      id: `p${i}-${cap}`,
      label: cap,
      cap,
      covers: [cap === "navigate" ? "answer" : "page"],
      status: i === 0 ? status : "pending",
    })),
  };
}

describe("只是开站必须看计划，不能单靠原话正则", () => {
  it("事故原句有 4 步计划时，不准当成只是开站", () => {
    const plan = steps(["read_page", "act", "read_page", "act"]);
    expect(siteOpenEndsTheJob(goal(INCIDENT, ["answer", "page"]), plan)).toBe(false);
  });

  it("后半句是复制、正则仍会判开站时，多步计划拦住早退", () => {
    expect(openSiteIsTheJob({ raw: COPY_TAIL, site: "weibo.com" })).toBe(true);
    expect(siteOpenEndsTheJob(goal(COPY_TAIL, ["answer"]), steps(["navigate", "read_page"]))).toBe(false);
  });

  it("单步 navigate 且必交付只有 answer，才允许结束", () => {
    const plan = steps(["navigate"]);
    const open = goal("打开微博", ["answer"]);
    expect(siteOpenEndsTheJob(open, plan)).toBe(true);
    expect(earlyExitMayCloseDone(open, [], plan)).toBe(false);
    const skipped = skipLoneNavigate(plan);
    expect(skipped.steps[0].status).toBe("skipped");
    expect(earlyExitMayCloseDone(open, [], skipped)).toBe(true);
  });

  it("要读页时，即使计划只剩一步 navigate 也不结束", () => {
    expect(siteOpenEndsTheJob(goal("打开微博", ["answer", "page"]), steps(["navigate"]))).toBe(false);
  });

  it("打开后再搜索：没有计划时走正则，多步计划也不早退", () => {
    const raw = "打开百度，搜今天北京天气";
    expect(siteOpenEndsTheJob(goal(raw, ["answer"], "baidu.com"))).toBe(false);
    expect(
      siteOpenEndsTheJob(goal(raw, ["answer"], "baidu.com"), steps(["navigate", "search_read"])),
    ).toBe(false);
  });

  it("没有脑区计划时看可执行手册，两份都没有才退回正则", () => {
    const open = goal("打开微博", ["answer"]);
    expect(siteOpenEndsTheJob(open, null, [{ cap: "navigate" }])).toBe(true);
    expect(siteOpenEndsTheJob(open, null, [{ cap: "read_page" }])).toBe(false);
    expect(siteOpenEndsTheJob(open)).toBe(openSiteIsTheJob(open));
    expect(siteOpenEndsTheJob(goal("打开微信读书看看热搜", ["answer"], "weread.qq.com"))).toBe(false);
  });

  it("没有计划但交付物里已有读页，也不退回正则", () => {
    expect(siteOpenEndsTheJob(goal("打开微博", ["page"]))).toBe(false);
  });

  it("脑区多步计划优先于单步手册", () => {
    expect(
      siteOpenEndsTheJob(goal(COPY_TAIL, ["answer"]), steps(["navigate", "read_page"]), [{ cap: "navigate" }]),
    ).toBe(false);
  });

  it("多步计划不会被 skipLoneNavigate 改掉", () => {
    const plan = steps(["navigate", "read_page"]);
    expect(skipLoneNavigate(plan)).toBe(plan);
  });
});
