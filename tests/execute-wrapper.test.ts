import { describe, expect, it } from "vitest";
import { buildExecuteExpression, clampExecuteTimeout } from "../src/main/execute-wrapper.js";

describe("execute wrapper", () => {
  it("默认不写 await，打开后才等待 thenable", () => {
    const off = buildExecuteExpression("1+1", false);
    const on = buildExecuteExpression("(async()=>42)()", true);
    expect(off.startsWith("(() =>")).toBe(true);
    expect(off.includes("await __r")).toBe(false);
    expect(on.startsWith("(async () =>")).toBe(true);
    expect(on.includes('if (__r && typeof __r.then === "function") __r = await __r;')).toBe(true);
  });

  it("超时默认 30 秒，并夹在 1 秒到 120 秒", () => {
    expect(clampExecuteTimeout(undefined)).toBe(30_000);
    expect(clampExecuteTimeout(0)).toBe(30_000);
    expect(clampExecuteTimeout(50)).toBe(1_000);
    expect(clampExecuteTimeout(5000)).toBe(5_000);
    expect(clampExecuteTimeout(999_999)).toBe(120_000);
  });
});
