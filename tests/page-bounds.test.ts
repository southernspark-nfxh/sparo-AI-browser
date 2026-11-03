import { describe, expect, it } from "vitest";
import { boundsWithinOnePixel, pageViewCoversChrome, resetChromeCoverBudget, takeChromeCoverFix } from "../src/main/page-bounds.js";

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

  it("连续拉 20 次也不放弃，去抖只挡同一瞬间", () => {
    let state = resetChromeCoverBudget(1_000);
    for (let i = 0; i < 20; i += 1) {
      const taken = takeChromeCoverFix(state, 1_000 + i * 200);
      state = taken.state;
      expect(taken.allow).toBe(true);
    }
    const burst = takeChromeCoverFix(state, state.lastFix + 50);
    expect(burst.allow).toBe(false);
    const again = takeChromeCoverFix(burst.state, burst.state.lastFix + 200);
    expect(again.allow).toBe(true);
    const afterRestore = takeChromeCoverFix(resetChromeCoverBudget(20_000), 20_000);
    expect(afterRestore.allow).toBe(true);
    expect(afterRestore.state.fixes).toBe(1);
  });

  it("把 961 和 962 当成同一矩形，整窗盖住仍然要修", () => {
    const view = { x: 0, y: 76, width: 962, height: 700 };
    expect(boundsWithinOnePixel(view, { ...view, width: 961 })).toBe(true);
    expect(boundsWithinOnePixel(view, { ...view, width: 970 })).toBe(false);
    expect(boundsWithinOnePixel(view, { x: 0, y: 0, width: 1400, height: 900 })).toBe(false);
  });

  it("ignores a background tab parked offscreen", () => {
    expect(pageViewCoversChrome({ x: -20000, y: 0, width: 1020, height: 780 }, hole)).toBe(false);
  });
});
