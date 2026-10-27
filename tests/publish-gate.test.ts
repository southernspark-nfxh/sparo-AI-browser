import { describe, expect, it } from "vitest";
import { allowClick, classifyClick } from "../src/main/agent/publish-gate.js";

describe("发布权限", () => {
  it("没授权时不点发送，授权了才点", () => {
    expect(allowClick(classifyClick("发送"), false).ok).toBe(false);
    expect(allowClick(classifyClick("发送"), true).ok).toBe(true);
    expect(allowClick("other", false).ok).toBe(true);
  });

  it("支付、登录、验证码即使授权也不点", () => {
    expect(allowClick(classifyClick("确认支付"), true).ok).toBe(false);
    expect(allowClick(classifyClick("登录"), true).ok).toBe(false);
    expect(allowClick(classifyClick("人机验证"), true).ok).toBe(false);
  });
});
