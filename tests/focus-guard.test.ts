import { describe, expect, it } from "vitest";
import { FILL_SCRIPT } from "../src/main/page-scripts.js";
import {
  clickDeferPlan,
  fillCeRetryInner,
  fillDomPlan,
  fillExecFallbackInner,
  focusActivePagePlan,
  focusGuardClickError,
  focusGuardDetail,
  humanTypingRecentlyAt,
  shouldStampHumanTyping,
} from "../src/main/focus-guard.js";

describe("humanTypingRecently", () => {
  const now = 10_000;

  it("壳层心跳或网页按键，任一在 1.5 秒内都算正在打字", () => {
    expect(humanTypingRecentlyAt({ shellAt: now - 1_000, mainAt: 0, now })).toBe(true);
    expect(humanTypingRecentlyAt({ shellAt: 0, mainAt: now - 1_000, now })).toBe(true);
    expect(humanTypingRecentlyAt({ shellAt: now - 2_000, mainAt: now - 100, now })).toBe(true);
  });

  it("两边都过期，或从来没记过，就不挡", () => {
    expect(humanTypingRecentlyAt({ shellAt: 0, mainAt: 0, now })).toBe(false);
    expect(humanTypingRecentlyAt({ shellAt: now - 1_500, mainAt: now - 1_500, now })).toBe(false);
    expect(humanTypingRecentlyAt({ shellAt: now - 1_499, mainAt: 0, now })).toBe(true);
  });

  it("只把真人的 keyDown/char 记成打字，Agent 注入和鼠标不算", () => {
    expect(shouldStampHumanTyping({ type: "keyDown" })).toBe(true);
    expect(shouldStampHumanTyping({ type: "char" })).toBe(true);
    expect(shouldStampHumanTyping({ type: "keyUp" })).toBe(false);
    expect(shouldStampHumanTyping({ type: "mouseDown" })).toBe(false);
    expect(shouldStampHumanTyping({ type: "keyDown", agentInjecting: true })).toBe(false);
    expect(shouldStampHumanTyping({ type: "char", agentInjecting: true })).toBe(false);
  });
});

describe("focusActivePage 门禁", () => {
  it("人在打字就直接让开，不再继续聚焦", () => {
    expect(focusActivePagePlan(true)).toBe("defer");
    expect(focusActivePagePlan(false)).toBe("continue");
  });

  it("让开时留下 crash.log 能数的一行", () => {
    expect(focusGuardDetail("focus", "main")).toBe("defer kind=focus win=main");
    expect(focusGuardDetail("click", "main")).toBe("defer kind=click win=main");
    expect(focusGuardDetail("fill", "win-2")).toBe("defer kind=fill win=win-2");
  });
});

describe("fill 兜底跳过 el.focus()", () => {
  it("人在打字时先走 value setter，脚本里没有 el.focus()", () => {
    expect(fillDomPlan(true)).toEqual({ allowFocus: false, firstStep: "value-setter" });
    const exec = fillExecFallbackInner(true);
    const retry = fillCeRetryInner(true);
    expect(exec).not.toContain("el.focus(");
    expect(retry).not.toContain("el.focus(");
    expect(exec).toContain("setter.call(el, __v)");
    expect(exec).toContain("new Event('input'");
    expect(exec).toContain("new Event('change'");
    expect(retry).toContain("new Event('input'");
    expect(retry).toContain("new Event('change'");
    expect(() => new Function("el", "__v", "document", "window", exec)).not.toThrow();
    expect(() => new Function("el", "__v", "document", "window", retry)).not.toThrow();
  });

  it("没人打字时仍先 focus 再 execCommand，value setter 留在失败之后", () => {
    expect(fillDomPlan(false)).toEqual({ allowFocus: true, firstStep: "focus" });
    const exec = fillExecFallbackInner(false);
    expect(exec.indexOf("el.focus()")).toBeGreaterThanOrEqual(0);
    expect(exec.indexOf("el.focus()")).toBeLessThan(exec.indexOf("execCommand('insertText'"));
    expect(exec.indexOf("execCommand('insertText'")).toBeLessThan(exec.indexOf("setter.call"));
    const retry = fillCeRetryInner(false);
    expect(retry).toContain("el.focus()");
    expect(retry).toContain("execCommand('insertText'");
    expect(() => new Function("el", "__v", "document", "window", exec)).not.toThrow();
    expect(() => new Function("el", "__v", "document", "window", retry)).not.toThrow();
  });

  it("主填表脚本在 quiet 时不调用 el.focus", () => {
    expect(FILL_SCRIPT.startsWith("(ref, selector, value, quiet)")).toBe(true);
    expect(FILL_SCRIPT).toContain("if (!quiet) el.focus({ preventScroll: true })");
    expect(FILL_SCRIPT).toContain("if (!quiet) el.focus()");
  });
});

describe("trustedClickAt 延迟重试", () => {
  it("没人打字立刻点", () => {
    expect(clickDeferPlan({ typing: false, deferrals: 0 })).toEqual({ action: "click" });
    expect(clickDeferPlan({ typing: false, deferrals: 5 })).toEqual({ action: "click" });
  });

  it("人一直打字就每秒让开一次，第 5 次之后明确报错", () => {
    const steps: string[] = [];
    let deferrals = 0;
    let message = "";
    for (let i = 0; i < 8; i += 1) {
      const plan = clickDeferPlan({ typing: true, deferrals });
      if (plan.action === "click") {
        steps.push("click");
        break;
      }
      steps.push(plan.action);
      if (plan.action === "error") {
        message = plan.message;
        break;
      }
      expect(plan.waitMs).toBe(1_000);
      deferrals = plan.deferrals;
    }
    expect(steps).toEqual(["wait", "wait", "wait", "wait", "wait", "error"]);
    expect(deferrals).toBe(5);
    expect(message).toBe(focusGuardClickError());
    expect(message).toContain("活人正在打字");
  });

  it("让开期间人停手了，下一次就点，不再空等满 5 次", () => {
    const typing = [true, true, false];
    const steps: string[] = [];
    let deferrals = 0;
    for (const flag of typing) {
      const plan = clickDeferPlan({ typing: flag, deferrals });
      if (plan.action === "click") {
        steps.push("click");
        break;
      }
      steps.push(plan.action);
      if (plan.action === "error") break;
      deferrals = plan.deferrals;
    }
    expect(steps).toEqual(["wait", "wait", "click"]);
  });
});
