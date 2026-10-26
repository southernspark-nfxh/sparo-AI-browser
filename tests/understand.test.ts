import { describe, expect, it, vi } from "vitest";
import { understand, wantsCollectScale } from "../src/main/agent/brain/understand.js";
import { analyzeGoal } from "../src/main/agent/loop.js";

const NOW = new Date(2026, 9, 26);
const COLLECT = "帮我把微博博主王海林最近 3 天的微博逐条复制下来";

function modelJson(deliverables: string[], coverage: "covered" | "new" = "covered"): string {
  return JSON.stringify({
    heard: "采集微博",
    ingest: "new",
    coverage,
    deliverables,
    clauses: [{ text: "逐条复制", purpose: "采集", deliverables }],
    known: {},
    plan: [{ cap: "read_page", covers: deliverables.slice(0, 1), label: "读微博" }],
  });
}

describe("采集规模回炉", () => {
  it("认出 N 天加采集对象 / N 条 / 全部 / 逐条 / 上百条，行程天数不认", () => {
    expect(wantsCollectScale("最近 3 天的微博")).toBe(true);
    expect(wantsCollectScale("最近三天的内容")).toBe(true);
    expect(wantsCollectScale("3天内的所有微博内容都复制一下")).toBe(true);
    expect(wantsCollectScale("复制 20 条")).toBe(true);
    expect(wantsCollectScale("全部微博")).toBe(true);
    expect(wantsCollectScale("逐条复制")).toBe(true);
    expect(wantsCollectScale("上百条")).toBe(true);
    expect(wantsCollectScale("最近 3 天")).toBe(false);
    expect(wantsCollectScale("想去美国纽约 两天 不知道住哪儿")).toBe(false);
    expect(wantsCollectScale("这周北京有什么展，顺便订附近酒店")).toBe(false);
    expect(wantsCollectScale("帮我设计一个密室逃脱的三道谜题")).toBe(false);
  });

  it("规模语义且无 report：第一次打回，第二次带原提示重问", async () => {
    const prompts: string[] = [];
    const heard = await understand(COLLECT, { now: NOW }, async (prompt) => {
      prompts.push(prompt);
      if (prompts.length === 1) return modelJson(["form", "page"]);
      return modelJson(["report", "page"], "new");
    });
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).not.toContain("用户要的是可翻阅的产物，不是填表");
    expect(prompts[1]).toContain("用户要的是可翻阅的产物，不是填表");
    expect(prompts[1]).toContain('coverage');
    expect(prompts[1].startsWith(prompts[0])).toBe(true);
    expect(heard.deliverables).toContain("report");
    expect(heard.coverage).toBe("new");
    expect(heard.rejudgeFailed).toBeUndefined();
  });

  it("第二次仍无 report：原样放行并标记 rejudgeFailed", async () => {
    let calls = 0;
    const heard = await understand(COLLECT, { now: NOW }, async () => {
      calls += 1;
      return modelJson(["form", "page"]);
    });
    expect(calls).toBe(2);
    expect(heard.deliverables).not.toContain("report");
    expect(heard.rejudgeFailed).toBe(true);
  });

  it("正常句不重问", async () => {
    let calls = 0;
    const heard = await understand("这周北京有什么展，顺便订附近酒店", { now: NOW }, async () => {
      calls += 1;
      return JSON.stringify({
        heard: "北京看展并订附近酒店",
        coverage: "covered",
        deliverables: ["sights", "stay"],
        known: { cities: ["北京"] },
      });
    });
    expect(calls).toBe(1);
    expect(heard.deliverables).toEqual(expect.arrayContaining(["sights", "stay"]));
    expect(heard.rejudgeFailed).toBeUndefined();
  });

  it("规模句第一次就有 report 时不重问", async () => {
    let calls = 0;
    const heard = await understand(COLLECT, { now: NOW }, async () => {
      calls += 1;
      return modelJson(["report"]);
    });
    expect(calls).toBe(1);
    expect(heard.deliverables).toContain("report");
    expect(heard.rejudgeFailed).toBeUndefined();
  });

  it("回炉仍失败时 analyzeGoal 记日志，且不本地补 report", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const goal = await analyzeGoal(COLLECT, { now: NOW }, async () => modelJson(["page", "form"]));
      expect(goal.deliverables.map((d) => d.id)).not.toContain("report");
      expect(warn).toHaveBeenCalledWith("[understand] 采集规模句回炉后仍无 report", COLLECT.slice(0, 80));
    } finally {
      warn.mockRestore();
    }
  });
});
