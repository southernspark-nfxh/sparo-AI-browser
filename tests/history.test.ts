import { describe, expect, it } from "vitest";
import { normalizeHistoryUrl, pushHistory } from "../src/main/history.js";

describe("pushHistory", () => {
  it("drops about:blank and keeps latest of the same url", () => {
    const a = pushHistory([], { url: "about:blank", title: "", ts: "1" });
    expect(a).toEqual([]);
    const b = pushHistory(
      [{ url: "https://x.com/", title: "X", ts: "1" }],
      { url: "https://x.com/#foo", title: "X home", ts: "2" },
    );
    expect(b).toHaveLength(1);
    expect(b[0].title).toBe("X home");
    expect(normalizeHistoryUrl("https://x.com/#foo")).toBe("https://x.com/");
  });

  it("caps the buffer", () => {
    let items: { url: string; title: string; ts: string }[] = [];
    for (let i = 0; i < 12; i++) {
      items = pushHistory(items, { url: `https://e.example/${i}`, title: String(i), ts: String(i) }, 5);
    }
    expect(items).toHaveLength(5);
    expect(items[0].url).toContain("/7");
  });
});
