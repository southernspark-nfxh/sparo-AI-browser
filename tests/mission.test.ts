import { describe, expect, it } from "vitest";
import { parseLocalIntent } from "../src/main/agent/stub.js";
import { parseMission } from "../src/main/agent/mission.js";
import { parseTripPlan } from "../src/main/agent/trip-plan.js";

describe("mission pack", () => {
  const now = new Date(2026, 8, 2);

  it("周末本地：餐厅结果页 + 电影 + 地图，不去首页", () => {
    const a = parseLocalIntent("周六在北京吃川菜看场电影 再告诉我地铁怎么走");
    expect(a.type).toBe("mission");
    if (a.type !== "mission") return;
    expect(a.mission.kind).toBe("local_outing");
    expect(a.mission.steps.map((s) => s.url).join("\n")).toMatch(/baidu\.com\/s\?wd=/);
    expect(a.mission.steps.some((s) => /电影/.test(s.url) || /%E7%94%B5%E5%BD%B1/.test(s.url))).toBe(true);
    expect(a.mission.steps.some((s) => /amap\.com\/search/.test(s.url))).toBe(true);
    expect(a.mission.steps.every((s) => !/\/$/.test(s.url.replace(/https?:\/\/[^/]+/, "")))).toBe(
      true,
    );
  });

  it("比价：淘宝和京东搜索页", () => {
    const a = parseLocalIntent("戴森吹风机 在淘宝和京东比价");
    expect(a.type).toBe("mission");
    if (a.type !== "mission") return;
    expect(a.mission.kind).toBe("compare_shop");
    expect(a.mission.slots.product).toMatch(/戴森/);
    expect(a.mission.steps[0].url).toContain("baidu.com/s");
    expect(a.mission.steps[0].url).toMatch(/淘宝|%E6%B7%98%E5%AE%9D/);
  });

  it("出差两天走行程不是频道首页", () => {
    const q = "下周一从北京去上海出差两天 要机票和酒店 大概多少钱";
    const plan = parseTripPlan(q, now);
    expect(plan).toMatchObject({
      origin: "北京",
      cities: ["上海"],
      nights: [2],
    });
    expect(plan?.startDate).toBe("2026-09-07");
    expect(plan?.endDate).toBe("2026-09-09");
    const a = parseLocalIntent(q);
    expect(a.type).toBe("trip_plan");
  });

  it("调研打开检索页而不是只聊天", () => {
    const a = parseLocalIntent("RAG是什么 打开百度百科和知乎做成笔记");
    expect(a.type).toBe("mission");
    if (a.type !== "mission") return;
    expect(a.mission.kind).toBe("research");
    expect(a.mission.steps.some((s) => /baidu\.com\/s\?wd=/.test(s.url))).toBe(true);
    expect(a.mission.steps.some((s) => /wikipedia/.test(s.url))).toBe(true);
  });

  it("后面几项也能拆出结果页", () => {
    const job = parseMission("在Boss上看产品经理岗位 先读JD不要投");
    expect(job?.kind).toBe("job_apply");
    expect(job?.slots.role).toBe("产品经理");
    expect(job?.steps[0].url).toContain("query=%E4%BA%A7%E5%93%81%E7%BB%8F%E7%90%86");
    expect(parseMission("望京附近5000内两居 通勤国贸")?.kind).toBe("rent");
    expect(parseMission("北京看皮肤科 怎么挂号")?.kind).toBe("hospital");
    expect(parseMission("上海居住证要准备哪些材料")?.kind).toBe("gov_errand");
    expect(parseMission("对比两门数据分析课")?.kind).toBe("course");
    expect(parseMission("检索RAG综述 列3篇出处")?.kind).toBe("papers");
    expect(parseMission("怎么用快递100查申通")?.kind).toBe("logistics");
  });
});
