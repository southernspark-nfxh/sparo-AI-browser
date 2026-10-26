import { describe, expect, it } from "vitest";
import { pageViewCoversChrome, resetChromeCoverBudget, takeChromeCoverFix } from "../src/main/page-bounds.js";

const hole = { x: 0, y: 76, width: 1020, height: 780 };

describe("pageViewCoversChrome", () => {
  it("leaves a view that sits in the page hole", () => {
    expect(pageViewCoversChrome(hole, hole)).toBe(false);
    expect(pageViewCoversChrome({ ...hole, height: hole.height + 4 }, hole)).toBe(false);
  });

  it("flags a view stretched over the tab bar and sidebar", () => {
    expect(pageViewCoversChrome({ x: 0, y: 0, width: 1360, height: 860 }, hole)).toBe(true);
    expect(pageViewCoversChrome({ x: 0, y: 76, width: 1360, height: 780 }, hole)).toBe(true);
    expect(pageViewCoversChrome({ x: 0, y: 0, width: 1020, height: 780 }, hole)).toBe(true);
  });

  it("3 秒内第 9 次停下，restore 重置后又能排", () => {
    let state = resetChromeCoverBudget(1_000);
    for (let i = 0; i < 8; i += 1) {
      const taken = takeChromeCoverFix(state, 1_000 + i);
      state = taken.state;
      expect(taken.allow).toBe(true);
    }
    const blocked = takeChromeCoverFix(state, 1_100);
    expect(blocked.allow).toBe(false);
    const afterRestore = takeChromeCoverFix(resetChromeCoverBudget(2_000), 2_000);
    expect(afterRestore.allow).toBe(true);
    expect(afterRestore.state.fixes).toBe(1);
  });

  it("ignores a background tab parked offscreen", () => {
    expect(pageViewCoversChrome({ x: -20000, y: 0, width: 1020, height: 780 }, hole)).toBe(false);
  });
});
