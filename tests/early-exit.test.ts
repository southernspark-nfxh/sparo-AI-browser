import { describe, expect, it } from "vitest";
import { earlyExitMayCloseDone } from "../src/main/agent/kernel/verify.js";
import { openSiteIsTheJob, userDidNotAskToRead } from "../src/main/agent/kernel/reasoner.js";
import type { AgentGoal, DeliverableId, StepFinding } from "../src/main/agent/loop.js";
import type { Plan } from "../src/main/agent/kernel/plan.js";

const WANG = "帮我把微博博主“王海林”3天内的所有微博内容都复制一下";

function goal(ids: DeliverableId[]): AgentGoal {
  return {
    raw: WANG,
    intent: "抓取微博正文并复制",
    kind: "page",
    deliverables: ids.map((id) => ({ id, label: id, required: true })),
    known: {},
    unknown: [],
    decision: "act",
    approach: "打开该博主主页",
    site: "weibo.com",
    siteUrl: "https://weibo.com/u/1497714867",
  };
}

function plan(status: Plan["steps"][number]["status"]): Plan {
  return {
    createdAt: 1,
    steps: [
      { id: "p2", label: "逐条提取微博正文", cap: "read_page", covers: ["page"], status },
      { id: "p3", label: "把正文汇总填入表单", cap: "fill_form", covers: ["form"], status: "pending" },
    ],
  };
}

describe("早退旁路不许在未交付时 close(done)", () => {
  it("王海林原话开单时 site 已在，但不是「只打开站点」", () => {
    expect(openSiteIsTheJob({ raw: WANG, site: "weibo.com" })).toBe(false);
    expect(userDidNotAskToRead({ raw: WANG, intent: "抓取微博正文并复制" })).toBe(true);
  });

  it("required 填表未交付，即使站点已打开也不许 close(done)", () => {
    const donePlan: Plan = {
      createdAt: 1,
      steps: [{ id: "p0", label: "打开", cap: "navigate", covers: ["page"], status: "done" }],
    };
    expect(earlyExitMayCloseDone(goal(["form", "page"]), [], donePlan)).toBe(false);
  });

  it("brainPlan 还有 running 步时不许 close(done)", () => {
    expect(earlyExitMayCloseDone(goal(["page"]), [], plan("running"))).toBe(false);
  });

  it("没有报告/填表且计划已做完，早退可以关完成", () => {
    const donePlan: Plan = {
      createdAt: 1,
      steps: [{ id: "p0", label: "打开", cap: "navigate", covers: ["answer"], status: "done" }],
    };
    const finding: StepFinding = {
      step: { id: "p0", cap: "navigate", label: "打开", covers: ["answer"] },
      text: "已打开 weibo.com",
      ok: true,
    };
    expect(earlyExitMayCloseDone(goal(["page"]), [finding], donePlan)).toBe(true);
  });
});
