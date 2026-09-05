import { describe, expect, it } from "vitest";
import {
  looksLikeTravelGoal,
  parsePlannerJson,
  plannerPrompt,
  shouldAskPlanner,
  travelParseLooksDirty,
} from "../src/main/agent/planner.js";

const BKK = "帮我做一个北京到曼谷的旅游攻略 9月16日出发 22日回来 包含酒店和机票";

describe("planner", () => {
  const now = new Date(2026, 8, 2);

  it("treats 攻略 / 行程 as a travel goal", () => {
    expect(looksLikeTravelGoal(BKK)).toBe(true);
    expect(looksLikeTravelGoal("这页英文啥意思")).toBe(false);
  });

  it("flags leftover 做一个 in a flight parse", () => {
    expect(
      travelParseLooksDirty({
        kind: "flight",
        site: "ctrip",
        from: "做一个北京",
        to: "曼谷",
        date: "2026-09-16",
      }),
    ).toBe(true);
    expect(
      shouldAskPlanner(
        {
          type: "travel_search",
          kind: "flight",
          site: "ctrip",
          from: "做一个北京",
          to: "曼谷",
          date: "2026-09-16",
        },
        BKK,
      ),
    ).toBe(true);
    expect(shouldAskPlanner({ type: "llm" }, BKK)).toBe(true);
    expect(shouldAskPlanner({ type: "trip_plan" }, BKK)).toBe(false);
  });

  it("maps model JSON to a trip, stripping 做一个", () => {
    const planned = parsePlannerJson(
      '```json\n{"type":"trip_plan","origin":"做一个北京","cities":["曼谷"],"startDate":"2026-09-16","endDate":"2026-09-22"}\n```',
      BKK,
      now,
    );
    expect(planned).toMatchObject({
      type: "trip_plan",
      plan: {
        origin: "北京",
        cities: ["曼谷"],
        startDate: "2026-09-16",
        endDate: "2026-09-22",
      },
    });
  });

  it("planner prompt lists capabilities instead of telling the model to click", () => {
    const p = plannerPrompt(BKK, now);
    expect(p).toMatch(/规划器/);
    expect(p).toMatch(/trip_plan/);
    expect(p).toMatch(BKK);
    expect(p).not.toMatch(/snapshot|click_text/);
  });
});
