import { describe, expect, it } from "vitest";
import {
  actionNotice,
  allowClick,
  classifyClick,
  gateClickText,
  noteConfirmRequest,
  noteUserReply,
  PAY_HOLD,
  resetClickConfirm,
} from "../src/main/agent/publish-gate.js";

describe("点击分类", () => {
  it("支付、删除、保存、发布和保存并认领分开", () => {
    expect(classifyClick("支付密码")).toBe("pay");
    expect(classifyClick("支付验证码")).toBe("pay");
    expect(classifyClick("删除")).toBe("delete");
    expect(classifyClick("保存")).toBe("save");
    expect(classifyClick("发布")).toBe("publish");
    expect(classifyClick("发送")).toBe("send");
    expect(classifyClick("保存并认领")).toBe("commit");
    expect(classifyClick("保存并发布")).toBe("commit");
    expect(classifyClick("登录")).toBe("login");
    expect(classifyClick("人机验证")).toBe("captcha");
  });

  it("只硬拦支付", () => {
    expect(allowClick(classifyClick("确认支付"), true)).toEqual({ ok: false, message: PAY_HOLD });
    expect(allowClick(classifyClick("登录"), true).ok).toBe(true);
    expect(allowClick(classifyClick("人机验证"), true).ok).toBe(true);
    expect(allowClick(classifyClick("保存"), false).ok).toBe(true);
  });
});

describe("逐步确认和自动执行", () => {
  it("逐步确认：发送和发布没确认就拦，保存放行，登录放行，支付硬拦", () => {
    resetClickConfirm();
    expect(gateClickText(true, "发布", "step").ok).toBe(false);
    expect(gateClickText(true, "发送", "step").ok).toBe(false);
    expect(gateClickText(true, "保存", "step")).toMatchObject({ ok: true, notify: "已保存到当前页面" });
    expect(gateClickText(true, "登录", "step").ok).toBe(true);
    expect(gateClickText(true, "人机验证", "step").ok).toBe(true);
    expect(gateClickText(true, "付款", "step")).toEqual({ ok: false, message: PAY_HOLD });
  });

  it("逐步确认：确认发布之后放行并通知", () => {
    resetClickConfirm();
    noteConfirmRequest("发布");
    expect(noteUserReply("确认")).toBe(true);
    expect(gateClickText(true, "发布", "step")).toMatchObject({ ok: true, notify: "已发布到当前页面" });
    expect(gateClickText(true, "发布", "step").ok).toBe(false);
  });

  it("自动执行：保存、发送、发布直接放行；保存并认领仍要确认", () => {
    resetClickConfirm();
    expect(gateClickText(true, "保存", "auto").ok).toBe(true);
    expect(gateClickText(true, "发送", "auto")).toMatchObject({ ok: true, notify: "已发送" });
    expect(gateClickText(true, "发布", "auto")).toMatchObject({ ok: true, notify: "已发布到当前页面" });
    expect(gateClickText(true, "保存并认领", "auto").ok).toBe(false);
    expect(gateClickText(true, "保存并发布", "auto").ok).toBe(false);
    expect(gateClickText(true, "登录", "auto").ok).toBe(true);
    expect(gateClickText(true, "滑块", "auto").ok).toBe(true);
    expect(gateClickText(true, "支付", "auto")).toEqual({ ok: false, message: PAY_HOLD });
  });

  it("删除两种模式都放行，并带上目标和恢复建议", () => {
    resetClickConfirm();
    for (const mode of ["step", "auto"] as const) {
      const gate = gateClickText(true, "删除这条笔记", mode);
      expect(gate.ok).toBe(true);
      expect(gate.notify).toContain("已删除 删除这条笔记");
      expect(gate.notify).toContain("7 天内恢复");
    }
    expect(actionNotice("delete", "草稿甲")).toContain("草稿甲");
  });
});
