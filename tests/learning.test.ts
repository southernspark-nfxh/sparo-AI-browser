import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { detectFailure, isCaptchaWall, isLoginWall, pageFinger } from "../src/main/learning/detector.js";
import { parseAnswer, questionFor } from "../src/main/learning/help.js";
import { hostOf, loadLessons, sanitizeNote, upsertLesson } from "../src/main/learning/store.js";
import { planFromLessons } from "../src/main/learning/apply.js";
import type { ObservedAction } from "../src/main/learning/types.js";

const dirs: string[] = [];
function tmp() {
  const d = mkdtempSync(join(tmpdir(), "sparo-learn-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function act(tool: string, target: string, before: string, after: string): ObservedAction {
  return {
    key: { tool, target },
    before: pageFinger(before, "页"),
    after: pageFinger(after, "页"),
  };
}

describe("learning store", () => {
  it("keeps host and strips secrets from notes", () => {
    expect(hostOf("https://www.ctrip.com/hotels")).toBe("ctrip.com");
    expect(sanitizeNote("密码是 abc12345 邮箱 a@b.com")).toBe("需要人处理");
    const dir = tmp();
    const a = upsertLesson(dir, { host: "https://www.ctrip.com/x", trigger: "login", advice: "pause", note: "要先登录" });
    const b = upsertLesson(dir, { host: "ctrip.com", trigger: "login", advice: "pause", note: "还是要登录" });
    expect(a.id).toBe(b.id);
    expect(loadLessons(dir)).toHaveLength(1);
    expect(loadLessons(dir)[0].note).toBe("还是要登录");
  });
});

describe("failure detector", () => {
  it("treats login URL not homepage 登录 button", () => {
    expect(isLoginWall(pageFinger("https://passport.ctrip.com/login", "登录"))).toBe(true);
    expect(isLoginWall(pageFinger("https://www.ctrip.com/", "携程旅行网 登录优惠"))).toBe(false);
    expect(isCaptchaWall(pageFinger("https://x.com/challenge", "人机验证"))).toBe(true);
  });

  it("flags the same click three times", () => {
    const u = "https://www.ctrip.com/hotels";
    const recent = [act("click_text", "北京", u, u), act("click_text", "北京", u, u), act("click_text", "北京", u, u)];
    const hit = detectFailure(recent);
    expect(hit?.kind).toBe("repeated_action");
    expect(hit?.count).toBe(3);
  });

  it("flags two dead clicks when url and title stay put", () => {
    const u = "https://example.com/form";
    const hit = detectFailure([act("click_text", "下一步", u, u), act("click_text", "下一步", u, u)]);
    expect(hit?.kind).toBe("dead_click");
  });

  it("flags jump onto a login URL", () => {
    const hit = detectFailure([
      act("click_text", "提交", "https://shop.example.com/cart", "https://shop.example.com/login"),
    ]);
    expect(hit?.kind).toBe("login_wall");
  });
});

describe("help answers", () => {
  it("turns concrete answers into rules", () => {
    const ask = questionFor({ kind: "dead_click", host: "x.com", target: "下一步", count: 2 }, true);
    expect(ask.kind).toBe("choice");
    expect(parseAnswer(ask, "有弹窗")).toMatchObject({ trigger: "overlay", advice: "dismiss_overlay" });
    expect(parseAnswer(ask, "先登录")).toMatchObject({ trigger: "login", advice: "pause" });
    expect(parseAnswer(ask, "先不管").skip).toBe(true);
    const loginAsk = questionFor({ kind: "login_wall", host: "x.com", target: "", count: 1 }, true);
    expect(parseAnswer(loginAsk, "是")).toMatchObject({ trigger: "login" });
    expect(parseAnswer(loginAsk, "否").skip).toBe(true);
  });

  it("plans overlay before pause", () => {
    const dir = tmp();
    upsertLesson(dir, { host: "a.com", trigger: "overlay", advice: "dismiss_overlay", note: "关弹窗" });
    upsertLesson(dir, { host: "a.com", trigger: "login", advice: "pause", note: "要登录" });
    const plan = planFromLessons(loadLessons(dir));
    expect(plan.dismiss).toBe(true);
    expect(plan.pause).toBe(true);
  });
});
