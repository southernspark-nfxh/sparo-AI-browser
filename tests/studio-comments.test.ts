import { describe, expect, it } from "vitest";
import { allowReply, canReply, HOUR_CAP, MIN_GAP_MS, replyLabel } from "../strategies/skills/social-media-publish/scripts/comments.mjs";

describe("评论回复边界", () => {
  it("只有头条和百家能回复", () => {
    expect(canReply("toutiao")).toBe(true);
    expect(canReply("baijiahao")).toBe(true);
    expect(replyLabel("dayu")).toBe("只读，回复未开");
    expect(replyLabel("sohu")).toBe("只读，回复未开");
  });

  it("间隔 20 秒，每小时不超过 30 条", () => {
    const now = 1_000_000;
    expect(allowReply([now - MIN_GAP_MS + 1000], now).ok).toBe(false);
    expect(allowReply([now - MIN_GAP_MS], now).ok).toBe(true);
    const burst = Array.from({ length: HOUR_CAP }, (_, index) => now - 60_000 - index * 1000);
    expect(allowReply(burst, now).reason).toContain("30");
  });
});
