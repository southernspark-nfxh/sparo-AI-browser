import { describe, expect, it } from "vitest";
import {
  SHELL_PAINT_DIAG_BEATS,
  SHELL_PAINT_REPAINT_COOLDOWN_MS,
  SHELL_PAINT_STALL_BEATS,
  boundsWithinOnePixel,
  pageViewCoversChrome,
  resetChromeCoverBudget,
  shellPaintStalled,
  takeChromeCoverFix,
  type ShellPaintState,
} from "../src/main/page-bounds.js";

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

const awake = { focused: true, minimized: false, visible: true };

function feed(frames: number[], start = { zeroStreak: 0, repaints: 0, lastRepaintAt: 0 }, step = 1_000) {
  let state: ShellPaintState = start;
  const repaints: boolean[] = [];
  frames.forEach((frame, i) => {
    const next = shellPaintStalled(state, frame, { ...awake, now: (i + 1) * step });
    state = next.state;
    repaints.push(next.repaint);
  });
  return { state, repaints };
}

describe("壳层停帧", () => {
  it("有帧就一直不重绘", () => {
    const { state, repaints } = feed([1, 5, 2, 9, 3]);
    expect(repaints.some(Boolean)).toBe(false);
    expect(state.zeroStreak).toBe(0);
  });

  it("连续三拍 0 帧才重绘，第四拍在冷却里不再打", () => {
    const { state, repaints } = feed([0, 0, 0, 0]);
    expect(repaints).toEqual([false, false, true, false]);
    expect(state.repaints).toBe(1);
    expect(SHELL_PAINT_STALL_BEATS).toBe(3);
  });

  it("冷却过后还停帧会再重绘一次，不永久撒手", () => {
    let state: ShellPaintState = { zeroStreak: 0, repaints: 0, lastRepaintAt: 0 };
    const beats = 12;
    const hits: number[] = [];
    for (let i = 0; i < beats; i += 1) {
      const now = (i + 1) * 1_000;
      const next = shellPaintStalled(state, 0, { ...awake, now });
      state = next.state;
      if (next.repaint) hits.push(now);
    }
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits[1] - hits[0]).toBeGreaterThanOrEqual(SHELL_PAINT_REPAINT_COOLDOWN_MS - 1_000);
  });

  it("最小化 / 不可见 / 失焦的窗口本来就不出帧，不判白屏", () => {
    const asleep = [
      { focused: true, minimized: true, visible: true },
      { focused: true, minimized: false, visible: false },
      { focused: false, minimized: false, visible: true },
    ];
    for (const ctx of asleep) {
      let state: ShellPaintState = { zeroStreak: 0, repaints: 0, lastRepaintAt: 0 };
      for (let i = 0; i < 10; i += 1) {
        const next = shellPaintStalled(state, 0, { ...ctx, now: (i + 1) * 1_000 });
        expect(next.repaint).toBe(false);
        state = next.state;
      }
    }
  });

  it("帧恢复后计数归零，下一次停帧重新从第一拍算", () => {
    const stalled = feed([0, 0]);
    const recovered = shellPaintStalled(stalled.state, 4, { ...awake, now: 3_000 });
    expect(recovered.state.zeroStreak).toBe(0);
    expect(recovered.state.repaints).toBe(0);
    const again = shellPaintStalled(recovered.state, 0, { ...awake, now: 4_000 });
    expect(again.repaint).toBe(false);
  });

  it("长时间停帧的落盘阈值在重绘之后", () => {
    expect(SHELL_PAINT_DIAG_BEATS).toBeGreaterThan(SHELL_PAINT_STALL_BEATS);
  });
});
