import { describe, expect, it } from "vitest";
import { pageViewCoversChrome } from "../src/main/page-bounds.js";

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

  it("ignores a background tab parked offscreen", () => {
    expect(pageViewCoversChrome({ x: -20000, y: 0, width: 1020, height: 780 }, hole)).toBe(false);
  });
});
