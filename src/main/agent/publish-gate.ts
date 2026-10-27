/**
 * 发布点击。当句是否允许自动发，只看模型写下的 autoSend。
 * 本地不从原话里抢答。支付、登录、验证码永远不代点。
 */

export type ClickKind = "send" | "pay" | "login" | "captcha" | "other";

export function classifyClick(text: string): ClickKind {
  const t = String(text || "").trim();
  if (/支付|付款|收银台/.test(t)) return "pay";
  if (/验证码|人机验证|滑块/.test(t)) return "captcha";
  if (/登录|登陆|sign\s*in|log\s*in/i.test(t)) return "login";
  if (/^(发送|发表|发布|立即发布|确认发布)$/.test(t)) return "send";
  return "other";
}

export function allowClick(kind: ClickKind, autoSend: boolean): { ok: boolean; message?: string } {
  if (kind === "pay" || kind === "login" || kind === "captcha") {
    return { ok: false, message: "支付、登录和验证码要你自己来，我不会代点。" };
  }
  if (kind === "send" && !autoSend) {
    return { ok: false, message: "草稿已填好。发送留给你，我没有代点。" };
  }
  return { ok: true };
}
