import { describe, expect, it } from "vitest";
import { applyTurn } from "../src/main/agent/runtime.js";
import { thoughtFor } from "../src/main/agent/kernel/index.js";
import { analyzeGoalHeuristic, type StepFinding } from "../src/main/agent/loop.js";
import {
  applyReconsider,
  composeStep,
  reconsiderLocal,
  reconsiderMission,
  parseReconsiderJson,
} from "../src/main/agent/brain/reconsider.js";

const NOW = new Date(2026, 8, 15);
const NY =
  "想去美国纽约 两天 不知道住哪儿 有推荐吗 还有餐厅之类的 包括有什么景点？给我设计一下";

const COMPARE_BODY = `对比评测\n${Array.from({ length: 8 }, (_, i) => `| 方案${i + 1} | 价格 | 评分 | 推荐 |`).join("\n")}`;

function finding(goalRaw: string, text: string, url: string, covers: string[], ok = true): StepFinding {
  return {
    step: {
      id: "t",
      cap: "search_read",
      label: "检索",
      covers: covers as StepFinding["step"]["covers"],
    },
    text,
    url,
    ok,
  };
}

describe("观察后重分类", () => {
  it("对照长文可以补 report，酒店页不能改成餐厅题", () => {
    const soft = analyzeGoalHeuristic("帮我看看纽约怎么样", { now: NOW });
    const added = reconsiderLocal(
      soft,
      [finding(soft.raw, COMPARE_BODY, "https://www.baidu.com/s?wd=纽约", ["answer"])],
    );
    expect(added.add).toContain("report");

    const ny = analyzeGoalHeuristic(NY, { now: NOW });
    const hotel = reconsiderLocal(ny, [
      finding(
        NY,
        "希尔顿酒店 餐厅推荐 每晚984 住宿\n万豪酒店 4.4分",
        "https://hotels.ctrip.com/hotels/list?city=633",
        ["stay"],
      ),
    ]);
    expect(hotel.add).toEqual([]);
    expect(hotel.same).toBe(true);
  });

  it("模型想丢掉纽约住宿、改成 ask、偷加机票：都不许", async () => {
    const t = applyTurn(NY, { now: NOW });
    const after = await reconsiderMission(t.mission!, async () =>
      JSON.stringify({
        same: false,
        heard: "只问预算",
        add: ["flights"],
        drop: ["stay", "food"],
        why: "先问人",
        nextCap: "ask",
      }),
    );
    const ids = after.goal.deliverables.map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(["stay", "food", "sights"]));
    expect(ids).not.toContain("flights");
    expect(after.goal.decision).toBe("act");
    expect(after.goal.ask).toBeUndefined();
  });

  it("模型补 report 会改题，原话吃住玩还在", async () => {
    const t = applyTurn(NY, { now: NOW });
    const after = await reconsiderMission(t.mission!, async () =>
      JSON.stringify({
        same: false,
        heard: "纽约两天还要对照几家店",
        add: ["report"],
        drop: [],
        why: "页上全是对照表",
      }),
    );
    const ids = after.goal.deliverables.map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(["stay", "food", "sights", "report"]));
    expect(after.goal.intent).toMatch(/对照/);
  });

  it("parse 到 ask 当没看见", () => {
    const p = parseReconsiderJson(JSON.stringify({ same: false, nextCap: "ask", add: ["food"] }));
    expect(p?.add).toEqual([]);
    expect(p?.same).toBe(true);
  });

  it("检索失败会组合新查询，不发明 cap", async () => {
    const t = applyTurn(NY, { now: NOW });
    const fail: StepFinding = {
      step: {
        id: "search_read-food",
        cap: "search_read",
        label: "查纽约餐厅",
        covers: ["food"],
        city: "纽约",
        query: "纽约 餐厅",
      },
      text: "空",
      url: "https://www.baidu.com/s?wd=x",
      ok: false,
    };
    const local = reconsiderLocal(t.mission!.goal, [fail]);
    expect(local.retry?.cap).toBe("search_read");
    expect(local.retry?.query).toMatch(/纽约/);
    const after = await reconsiderMission({ ...t.mission!, findings: [fail] });
    expect(after.nudge?.cap).toBe("search_read");
    expect(after.nudge?.id).not.toBe(fail.step.id);
    expect(after.nudge?.query).toBeTruthy();
    expect(thoughtFor(after).next?.id).toBe(after.nudge?.id);
    expect(composeStep(t.mission!.goal, [fail], { cap: "explode", covers: ["food"] })).toBeUndefined();
  });

  it("同一块失败两次就不再自动换查询", () => {
    const ny = analyzeGoalHeuristic(NY, { now: NOW });
    const fail = (n: number): StepFinding => ({
      step: { id: `f${n}`, cap: "search_read", label: "查", covers: ["food"], city: "纽约" },
      text: "",
      url: "https://www.baidu.com/s",
      ok: false,
    });
    const again = reconsiderLocal(ny, [fail(1), fail(2)]);
    expect(again.retry).toBeUndefined();
  });

  it("模型指定换查询词时用它的词", async () => {
    const t = applyTurn(NY, { now: NOW });
    const fail: StepFinding = {
      step: { id: "food1", cap: "search_read", label: "查餐厅", covers: ["food"], city: "纽约" },
      text: "空",
      url: "https://www.baidu.com/s",
      ok: false,
    };
    const after = await reconsiderMission({ ...t.mission!, findings: [fail] }, async () =>
      JSON.stringify({
        same: true,
        add: [],
        drop: [],
        retry: { cap: "search_read", query: "纽约 老人 安静 餐厅", covers: ["food"] },
      }),
    );
    expect(after.nudge?.query).toContain("安静");
  });

  it("酒店页上模型要补餐厅：模型加就加，本地不硬拦", () => {
    const ny = analyzeGoalHeuristic("在携程查9月15日伊斯坦布尔的酒店", { now: NOW });
    const next = applyReconsider(
      ny,
      [
        finding(
          ny.raw,
          "希尔顿 餐厅推荐",
          "https://hotels.ctrip.com/hotels/list?city=301",
          ["stay"],
        ),
      ],
      { same: false, add: ["food"], drop: [], why: "页上有餐厅" },
    );
    expect(next.deliverables.map((d) => d.id)).toContain("food");
  });
});
