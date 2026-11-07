import { describe, expect, it, vi } from "vitest";
import {
  applyDisplayClamp,
  centeredBounds,
  formatDisplayClamp,
  formatDisplayLine,
  planDisplayClamp,
  windowOnScreen,
  type Rect,
} from "../src/main/window-visible.js";

const home: Rect = { x: 0, y: 0, width: 1646, height: 1049 };
const second: Rect = { x: 1646, y: 0, width: 1920, height: 1080 };

function fakeWin(bounds: Rect, minimized = false) {
  const focus = vi.fn();
  const show = vi.fn();
  const setBounds = vi.fn();
  return {
    focus,
    show,
    setBounds,
    isMinimized: () => minimized,
    getBounds: () => bounds,
  };
}

describe("T79 显示器变化时的窗口钳制", () => {
  it("屏幕外拉回工作区，屏幕内不动", () => {
    const off = fakeWin({ x: -2200, y: -400, width: 1200, height: 800 });
    const pulled = applyDisplayClamp(off, [home], home);
    expect(pulled.moved).toBe(true);
    expect(windowOnScreen(pulled.bounds, home)).toBe(true);
    expect(off.setBounds).toHaveBeenCalledWith(centeredBounds(home));
    expect(off.focus).not.toHaveBeenCalled();
    expect(off.show).not.toHaveBeenCalled();

    const inside = fakeWin({ x: 80, y: 40, width: 1200, height: 800 });
    const stayed = applyDisplayClamp(inside, [home], home);
    expect(stayed.moved).toBe(false);
    expect(stayed.bounds).toEqual({ x: 80, y: 40, width: 1200, height: 800 });
    expect(inside.setBounds).not.toHaveBeenCalled();
    expect(inside.focus).not.toHaveBeenCalled();
  });

  it("第二块屏上的窗口不拉回主屏，最小化也不弹", () => {
    const onSecond = { x: 1800, y: 80, width: 1200, height: 800 };
    const plan = planDisplayClamp({
      minimized: false,
      bounds: onSecond,
      workAreas: [home, second],
      home,
    });
    expect(plan.move).toBe(false);
    expect(plan.bounds).toEqual(onSecond);

    const parked = { x: -32000, y: -32000, width: 1200, height: 800 };
    const minimized = planDisplayClamp({
      minimized: true,
      bounds: parked,
      workAreas: [home],
      home,
    });
    expect(minimized.move).toBe(false);
    expect(minimized.bounds).toEqual(parked);
  });

  it("事件日志带上每个屏和窗口 bounds", () => {
    const line = formatDisplayLine(
      "display-metrics-changed",
      [{ bounds: { x: 0, y: 0, width: 1646, height: 1097 }, workArea: home, scaleFactor: 1.25 }],
      { x: 40, y: 20, width: 1400, height: 900 },
      { minimized: false, hole: { x: 0, y: 76, width: 1000, height: 800 } },
    );
    expect(line).toContain("[display] display-metrics-changed");
    expect(line).toContain("bounds=0,0,1646x1097");
    expect(line).toContain("work=0,0,1646x1049");
    expect(line).toContain("scale=1.25");
    expect(line).toContain("win=40,20,1400x900");
    expect(line).toContain("hole=0,76,1000x800");
    expect(formatDisplayClamp({ x: -2200, y: 0, width: 800, height: 600 }, centeredBounds(home))).toContain(
      "[display] clamp from=",
    );
  });
});
