import { describe, expect, it } from "vitest";
import { coPresenceMayRestore, mustNotStealFocus } from "../src/main/shell-focus.js";

describe("最小化不抢前台", () => {
  it("最小化时填表也不拉回", () => {
    expect(coPresenceMayRestore(true)).toBe(false);
  });

  it("窗口已在前台时同窗路径不再额外聚焦", () => {
    expect(coPresenceMayRestore(false)).toBe(false);
  });

  it("别人的标签不许抢前台", () => {
    expect(mustNotStealFocus({ clientId: "jia", owner: "user", windowFocused: true })).toBe(true);
    expect(mustNotStealFocus({ clientId: "jia", owner: "agent:yi", windowFocused: true })).toBe(true);
  });

  it("自己的标签只有窗口已在前台时才允许补焦点", () => {
    expect(mustNotStealFocus({ clientId: "jia", owner: "agent:jia", windowFocused: false })).toBe(true);
    expect(mustNotStealFocus({ clientId: "jia", owner: "agent:jia", windowFocused: true })).toBe(false);
  });

  it("没有 agent 在操作时不改原有前台行为", () => {
    expect(mustNotStealFocus({ clientId: "", owner: "user", windowFocused: false })).toBe(false);
  });
});
