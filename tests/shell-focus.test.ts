import { describe, expect, it } from "vitest";
import { coPresenceMayRestore } from "../src/main/shell-focus.js";

describe("最小化不抢前台", () => {
  it("最小化时填表也不拉回", () => {
    expect(coPresenceMayRestore(true)).toBe(false);
  });

  it("窗口已在前台时同窗路径不再额外聚焦", () => {
    expect(coPresenceMayRestore(false)).toBe(false);
  });
});
