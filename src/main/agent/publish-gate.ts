/**
 * 点击门。支付恒拦。删除放行并通知。
 * 保存两种模式都直接做。逐步确认时，发送、发布、保存并认领/发布要有一次已落地的确认。
 * 自动模式下发送和发布直接做；保存并认领、保存并发布仍要确认。
 * 登录和验证码不拦。确认槽只在内存里。
 */

export type ClickKind = "send" | "publish" | "save" | "commit" | "delete" | "pay" | "login" | "captcha" | "other";

export type ExecMode = "step" | "auto";

export const PAY_HOLD = "必须用户亲自完成支付";

export const COMMIT_KIND = "commit" as const;

type ConfirmSlot = {
  action: string;
  detail: string;
  kind: ClickKind;
};

export type GateResult = {
  ok: boolean;
  message?: string;
  notify?: string;
};

let pending: ConfirmSlot | null = null;
let landed: ConfirmSlot | null = null;

export function resetClickConfirm(): void {
  pending = null;
  landed = null;
}

export function classifyClick(text: string): ClickKind {
  const t = String(text || "").trim();
  if (/支付密码|支付验证码|支付|付款|收银台/.test(t)) return "pay";
  if (/(?<![不未])删除|\bdelete\b/i.test(t)) return "delete";
  if (/验证码|人机验证|滑块/.test(t)) return "captcha";
  if (/登录|登陆|sign\s*in|log\s*in/i.test(t)) return "login";
  if (/保存并认领|保存并发布/.test(t)) return "commit";
  if (/存草稿|保存草稿/.test(t) || (/保存/.test(t) && !/未保存|不保存/.test(t))) return "save";
  if (/^(发表|发布|立即发布|确认发布)$/.test(t)) return "publish";
  if (/^发送$/.test(t)) return "send";
  return "other";
}

/** 确认对象常常是一句说明，不是按钮全文。 */
export function confirmTargetKind(action: string): ClickKind {
  const exact = classifyClick(action);
  if (exact !== "other") return exact;
  const t = String(action || "").trim();
  if (/保存并认领|保存并发布/.test(t)) return "commit";
  if (/(?<![不未])删除/.test(t)) return "delete";
  if (/发布|发表/.test(t)) return "publish";
  if (/发送/.test(t)) return "send";
  if (/存草稿|保存草稿/.test(t) || (/保存/.test(t) && !/保存并/.test(t) && !/未保存|不保存/.test(t))) return "save";
  return "other";
}

function sameTarget(action: string, clickText: string): boolean {
  const clickKind = classifyClick(clickText);
  const actionKind = confirmTargetKind(action);
  if (clickKind !== actionKind) return false;
  if (clickKind !== "send" && clickKind !== "publish" && clickKind !== "commit") return false;
  const button = clickText.trim();
  const act = action.trim();
  if (!button || !act) return false;
  if (clickKind === "commit") {
    if (/保存并认领/.test(button)) return /保存并认领/.test(act);
    if (/保存并发布/.test(button)) return /保存并发布/.test(act);
    return false;
  }
  return act.includes(button);
}

const AFFIRMATIVE =
  /^(确认|同意|可以|好的?|行|yes|ok|okay|confirm)(发布|发送|发表|保存|吧)?[。！!？?，,\s]*$/i;

export function isConfirmReply(text: string): boolean {
  return AFFIRMATIVE.test(String(text || "").trim());
}

export function noteConfirmRequest(action: string, detail = ""): void {
  const clean = String(action || "").trim();
  pending = {
    action: clean || "这个动作",
    detail: String(detail || "").trim(),
    kind: confirmTargetKind(clean),
  };
  landed = null;
}

export function noteUserReply(text: string): boolean {
  const reply = String(text || "").trim();
  if (pending && isConfirmReply(reply)) {
    landed = pending;
    pending = null;
    return true;
  }
  if (!isConfirmReply(reply)) {
    pending = null;
    landed = null;
  }
  return false;
}

export function landedMatches(clickText: string): boolean {
  if (!landed) return false;
  return sameTarget(landed.action, clickText);
}

export function consumeLandedConfirm(): void {
  landed = null;
}

export function actionNotice(kind: ClickKind, text: string): string | undefined {
  const target = String(text || "").trim() || "这项内容";
  if (kind === "save") return `已保存到当前页面`;
  if (kind === "send") return "已发送";
  if (kind === "publish") return `已发布到当前页面`;
  if (kind === "commit") return `已执行${target}。没有连带做别的账号动作。`;
  if (kind === "delete") {
    return `已删除 ${target}。若该平台有垃圾箱/撤销 API 可 7 天内恢复；否则请确认删除内容。`;
  }
  return undefined;
}

function holdMessage(kind: ClickKind): string {
  if (kind === "commit") return "保存并认领或保存并发布要先确认一次。";
  if (kind === "publish") return "发布前要先确认一次。";
  return "发送前要先确认一次。";
}

/** 只拦支付。登录和验证码不拦。 */
export function allowClick(kind: ClickKind, _autoSend?: boolean): GateResult {
  if (kind === "pay") return { ok: false, message: PAY_HOLD };
  return { ok: true };
}

function needsLandedConfirm(kind: ClickKind, mode: ExecMode): boolean {
  if (kind === "commit") return true;
  if (mode === "step" && (kind === "send" || kind === "publish")) return true;
  return false;
}

/**
 * 新核心按执行模式放行。
 * 不在新核心里时只拦支付。
 */
export function gateClickText(
  freeSoulRunning: boolean,
  text: string,
  execMode?: ExecMode,
): GateResult {
  const kind = classifyClick(text);
  if (kind === "pay") return { ok: false, message: PAY_HOLD };
  const notify = actionNotice(kind, text);
  if (!freeSoulRunning) return notify ? { ok: true, notify } : { ok: true };
  const mode: ExecMode = execMode === "auto" ? "auto" : "step";
  if (needsLandedConfirm(kind, mode)) {
    if (!landedMatches(text)) return { ok: false, message: holdMessage(kind) };
    consumeLandedConfirm();
  }
  return notify ? { ok: true, notify } : { ok: true };
}
