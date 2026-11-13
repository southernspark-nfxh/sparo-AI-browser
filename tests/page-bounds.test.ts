import { describe, expect, it } from "vitest";
import {
  SHELL_HEARTBEAT_GAP_MS,
  SHELL_PAINT_DIAG_BEATS,
  SHELL_PAINT_RELOAD_AFTER_REPAINTS,
  SHELL_PAINT_REPAINT_COOLDOWN_MS,
  SHELL_PAINT_STALL_BEATS,
  boundsWithinOnePixel,
  pageViewCoversChrome,
  resetChromeCoverBudget,
  shellPaintStalled,
  shellRecoveryStep,
  shellSilentTooLong,
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

const awake = { minimized: false, visible: true };

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

  it("最小化 / 不可见的窗口本来就不出帧，不判白屏；失焦仍要判", () => {
    const asleep = [
      { minimized: true, visible: true },
      { minimized: false, visible: false },
    ];
    for (const ctx of asleep) {
      let state: ShellPaintState = { zeroStreak: 0, repaints: 0, lastRepaintAt: 0 };
      for (let i = 0; i < 10; i += 1) {
        const next = shellPaintStalled(state, 0, { ...ctx, now: (i + 1) * 1_000 });
        expect(next.repaint).toBe(false);
        state = next.state;
      }
    }
    // 人切到别的程序时壳层照样会白，回来还得手动最大最小化，所以失焦也要救。
    let state: ShellPaintState = { zeroStreak: 0, repaints: 0, lastRepaintAt: 0 };
    for (let i = 0; i < 3; i += 1) {
      state = shellPaintStalled(state, 0, { minimized: false, visible: true, now: (i + 1) * 1_000 }).state;
    }
    expect(state.repaints).toBe(1);
  });

  it("Chromium 文档隐藏时零帧是正常节流，不触发恢复", () => {
    let state: ShellPaintState = { zeroStreak: 0, repaints: 0, lastRepaintAt: 0 };
    for (let i = 0; i < 6; i += 1) {
      state = shellPaintStalled(state, 0, {
        ...awake,
        documentVisible: false,
        now: (i + 1) * 1_000,
      }).state;
    }
    expect(state.repaints).toBe(0);
    expect(state.zeroStreak).toBe(0);
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

const front = { minimized: false, visible: true, focused: true };

describe("壳层静默看门狗", () => {
  it("前台窗口超过 5 秒没心跳就判死", () => {
    const last = 10_000;
    expect(shellSilentTooLong(last, { ...front, now: last + SHELL_HEARTBEAT_GAP_MS })).toBe(false);
    expect(shellSilentTooLong(last, { ...front, now: last + SHELL_HEARTBEAT_GAP_MS + 1 })).toBe(true);
    expect(SHELL_HEARTBEAT_GAP_MS).toBe(5_000);
  });

  it("最小化 / 看不见 / 没聚焦 / 还没开始跳，都不判死", () => {
    const last = 10_000;
    const now = last + 60_000;
    expect(shellSilentTooLong(last, { ...front, minimized: true, now })).toBe(false);
    expect(shellSilentTooLong(last, { ...front, visible: false, now })).toBe(false);
    expect(shellSilentTooLong(last, { ...front, focused: false, now })).toBe(false);
    expect(shellSilentTooLong(0, { ...front, now })).toBe(false);
  });
});

describe("壳层恢复阶梯", () => {
  const state = (repaints: number): ShellPaintState => ({ zeroStreak: 9, repaints, lastRepaintAt: 1_000 });

  it("前两次只重绘", () => {
    expect(shellRecoveryStep(state(0))).toBe("repaint");
    expect(shellRecoveryStep(state(1))).toBe("repaint");
    expect(shellRecoveryStep(state(2))).toBe("repaint");
  });

  it("第三次起重启渲染进程", () => {
    expect(shellRecoveryStep(state(SHELL_PAINT_RELOAD_AFTER_REPAINTS))).toBe("reload");
    expect(shellRecoveryStep(state(9))).toBe("reload");
  });

  it("unresponsive 说明重绘推不动，重绘过一次就重启", () => {
    expect(shellRecoveryStep(state(0), true)).toBe("repaint");
    expect(shellRecoveryStep(state(1), true)).toBe("reload");
  });
});
