import { describe, expect, it } from "vitest";
import {
  canonCity,
  findCities,
  findRegion,
  isCity,
  isChinaCity,
  isNotPlace,
  isRegion,
  regionCities,
} from "../src/main/agent/place.js";

describe("地点表", () => {
  it("打算不是城，云南是省，成都是城", () => {
    expect(isNotPlace("打算")).toBe(true);
    expect(isNotPlace("我打算")).toBe(true);
    expect(canonCity("我打算")).toBeNull();
    expect(isCity("我打算")).toBe(false);
    expect(isRegion("云南")).toBe(true);
    expect(findRegion("我打算去云南旅游")).toBe("云南");
    expect(isCity("成都")).toBe(true);
    expect(isChinaCity("成都")).toBe(true);
    expect(isChinaCity("东京")).toBe(false);
  });

  it("云南假设城是昆明大理丽江香格里拉西双版纳，不自动当成出发地", () => {
    expect(regionCities("云南")).toEqual(["昆明", "大理", "丽江", "香格里拉", "西双版纳"]);
    expect(isCity("云南")).toBe(false);
    expect(isCity("香格里拉")).toBe(true);
  });

  it("英文别名能找到纽约洛杉矶", () => {
    expect(findCities("plan 2 days in NYC")).toContain("纽约");
    expect(findCities("los angeles hotels")).toContain("洛杉矶");
    expect(findCities("改成波士顿吧")).toContain("波士顿");
    expect(canonCity("boston")).toBe("波士顿");
  });

  it("山西是省不是城", () => {
    expect(isRegion("山西")).toBe(true);
    expect(isCity("山西")).toBe(false);
    expect(findRegion("明天早上从北京出发去山西玩十天")).toBe("山西");
    expect(regionCities("山西")).toEqual(["太原", "大同", "平遥"]);
  });
});
