import { describe, expect, it } from "vitest";
import {
  clickPointUsable,
  offscreenAgentBounds,
  viewportTooSmall,
} from "./agent-viewport.js";

describe("agent viewport", () => {
  it("treats a minimized window as too small even if the last size was large", () => {
    expect(viewportTooSmall(true, 1400, 900)).toBe(true);
    expect(viewportTooSmall(false, 0, 0)).toBe(true);
    expect(viewportTooSmall(false, 1400, 900)).toBe(false);
  });

  it("keeps a real size off the visible desktop", () => {
    expect(offscreenAgentBounds(1306, 974)).toEqual({
      x: -30000,
      y: 0,
      width: 1306,
      height: 974,
    });
    expect(offscreenAgentBounds(0, 0).width).toBeGreaterThanOrEqual(1100);
    expect(offscreenAgentBounds(0, 0).height).toBeGreaterThanOrEqual(760);
  });

  it("rejects the negative points a collapsed page produces", () => {
    expect(clickPointUsable(-506, -722)).toBe(false);
    expect(clickPointUsable(875, 481)).toBe(true);
  });
});
