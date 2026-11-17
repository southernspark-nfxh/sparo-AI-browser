import { describe, expect, it } from "vitest";
import { CHROME_HEAL_COOLDOWN_MS, coverHealBackoff, remountBlockedByTyping } from "../src/main/page-bounds.js";

/**
 * 侧栏打字被抢焦点（2026-11-17）。
 * 摘挂 WebContentsView 会把键盘焦点交给网页；覆盖自愈不许在人打字时摘挂，
 * 也不许摘挂过一次没收敛还每 2 秒重来一次。
 */

describe("remountBlockedByTyping", () => {
  it("blocks remount while the human is typing in the shell", () => {
    expect(remountBlockedByTyping(true)).toBe(true);
    expect(remountBlockedByTyping(false)).toBe(false);
  });
});

describe("coverHealBackoff", () => {
  it("keeps trying when the view has never been remounted", () => {
    expect(coverHealBackoff({ remounted: false, now: 1_000 })).toEqual({ giveUp: false });
  });

  it("backs off for the cooldown once a remount did not converge", () => {
    expect(coverHealBackoff({ remounted: true, now: 1_000 })).toEqual({
      giveUp: true,
      retryAt: 1_000 + CHROME_HEAL_COOLDOWN_MS,
    });
  });
});
