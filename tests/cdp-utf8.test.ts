import { describe, expect, it } from "vitest";
import { cdpUtf8Expr } from "../src/main/cdp-frames.js";

describe("cdpUtf8Expr", () => {
  it("returns ASCII-only expression that decodes UTF-8", () => {
    const expr = cdpUtf8Expr("小红书标题");
    expect(expr).toMatch(/^new TextDecoder/);
    expect(/[\u4e00-\u9fff]/.test(expr)).toBe(false);
    // Evaluate the expression shape in Node via Function
    const decoded = Function(`"use strict"; return (${expr});`)();
    expect(decoded).toBe("小红书标题");
  });

  it("handles empty string", () => {
    const decoded = Function(`"use strict"; return (${cdpUtf8Expr("")});`)();
    expect(decoded).toBe("");
  });
});
