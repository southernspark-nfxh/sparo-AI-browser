import { describe, expect, it } from "vitest";
import { alternateSite, decideStall, NO_PROGRESS_MS } from "../src/main/agent/kernel/stall.js";

describe("5 分钟无进展", () => {
  it("未到点、或在等人，继续等", () => {
    expect(
      decideStall({ elapsedMs: NO_PROGRESS_MS - 1, waitingHuman: false, switched: false, tried: [] }).action,
    ).toBe("continue");
    expect(
      decideStall({ elapsedMs: NO_PROGRESS_MS + 1, waitingHuman: true, switched: false, tried: [] }).action,
    ).toBe("continue");
  });

  it("到点先换策略，再无进展就说人话关单", () => {
    const first = decideStall({
      elapsedMs: NO_PROGRESS_MS,
      waitingHuman: false,
      switched: false,
      tried: ["12306"],
      lastNote: "查询超时，请稍后再试！",
    });
    expect(first.action).toBe("switch");
    const second = decideStall({
      elapsedMs: NO_PROGRESS_MS,
      waitingHuman: false,
      switched: true,
      tried: ["12306", "ctrip"],
      lastNote: "查询超时，请稍后再试！",
    });
    expect(second.action).toBe("close");
    if (second.action === "close") {
      expect(second.say).toContain("查询超时");
      expect(second.say).toContain("已试过的入口：12306、ctrip");
    }
  });

  it("火车查询可以换到另一个已登记的站", () => {
    expect(alternateSite("train_search", "12306")).toBe("ctrip");
    expect(alternateSite("read_page")).toBeUndefined();
  });
});
