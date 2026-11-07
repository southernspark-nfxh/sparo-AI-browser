/** 图片分组和收费确认。文字翻译不能抵图片翻译。决策点 #40。 */
import type { ImageGroupName, ImageSlot } from "./dxm-smt-fields.js";

const PAID_FEATURES = new Set(["图片翻译", "图片白底"]);

export type PaidFeature = "图片翻译" | "图片白底";

export type PaidTicket = {
  confirmId: string;
  workOrderId: string;
  feature: PaidFeature;
  scope: string;
  fee: string;
};

type StoredTicket = PaidTicket & { used: boolean };

const issued = new Map<string, StoredTicket>();

export function resetPaidConfirms(): void {
  issued.clear();
}

/** 只在本次 request_confirm 带了收费绑定时发出。文本不能发句柄。 */
export function issuePaidConfirm(ticket: PaidTicket): void {
  if (!ticket.confirmId || !ticket.workOrderId || !ticket.scope || !ticket.fee) return;
  if (!PAID_FEATURES.has(ticket.feature)) return;
  for (const item of issued.values()) {
    if (item.workOrderId === ticket.workOrderId) item.used = true;
  }
  issued.set(ticket.confirmId, { ...ticket, used: false });
}

export function registerPaidConfirmFromArgs(args: Record<string, unknown>): void {
  const paid = args.paid;
  if (!paid || typeof paid !== "object") return;
  const row = paid as Record<string, unknown>;
  const feature = row.feature === "图片翻译" || row.feature === "图片白底" ? row.feature : "";
  const workOrderId = String(row.workOrderId || "").trim();
  const scope = String(row.scope || "").trim();
  const fee = String(row.fee || "").trim();
  if (!feature || !workOrderId || !scope || !fee) return;
  const confirmId = `paid-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
  issuePaidConfirm({ confirmId, workOrderId, feature, scope, fee });
}

export function consumePaidConfirm(confirmId: string): void {
  const ticket = issued.get(confirmId);
  if (ticket) ticket.used = true;
}

export function imagesPass(images: Record<ImageGroupName, ImageSlot[]>): boolean {
  for (const group of ["main", "variant", "description"] as const) {
    const items = images[group] || [];
    if (!items.length) continue;
    if (items.some((item) => item.status !== "verified")) return false;
  }
  return true;
}

export function imageEvidenceStatus(verified: boolean): "started" | "verified" {
  return verified ? "verified" : "started";
}

/**
 * 收费动作只接受未使用、且工作单、功能、范围、费用都一致的句柄。
 * 不根据同意或拒绝词判断。text 留在参数里是为了旧调用点，不参与决定。
 */
export function decidePaidAction(input: {
  feature?: string;
  text?: string;
  workOrderId?: string;
  scope?: string;
  fee?: string;
  confirmId?: string;
  quotedFee?: string;
}): { execute: boolean; refused: boolean; reason: string; confirmId?: string } {
  const feature = input.feature || "";
  if (!PAID_FEATURES.has(feature)) {
    return { execute: false, refused: false, reason: "不是需要单独确认的收费图片功能" };
  }
  if (input.confirmId && !issued.has(input.confirmId)) {
    return { execute: false, refused: false, reason: "确认句柄无效，不执行收费动作" };
  }
  if (!input.workOrderId || !input.scope || !input.fee || !input.quotedFee || input.fee !== input.quotedFee) {
    return { execute: false, refused: false, reason: "没有本次确认句柄，或费用信息已变化，不执行收费动作" };
  }
  const confirmId = matchTicket({
    workOrderId: input.workOrderId,
    feature,
    scope: input.scope,
    fee: input.quotedFee,
    confirmId: input.confirmId,
  });
  if (!confirmId) {
    return { execute: false, refused: false, reason: "没有与本次工作单、功能和范围一致的确认，不执行收费动作" };
  }
  return { execute: true, refused: false, reason: "本次确认句柄匹配", confirmId };
}

function matchTicket(input: {
  workOrderId: string;
  feature: string;
  scope: string;
  fee: string;
  confirmId?: string;
}): string | null {
  if (input.confirmId) {
    const ticket = issued.get(input.confirmId);
    if (!ticket || ticket.used) return null;
    if (!sameBinding(ticket, input)) return null;
    return ticket.confirmId;
  }
  const matches = [...issued.values()].filter((ticket) => !ticket.used && sameBinding(ticket, input));
  return matches.length === 1 ? matches[0]?.confirmId || null : null;
}

function sameBinding(
  ticket: StoredTicket,
  input: { workOrderId: string; feature: string; scope: string; fee: string },
): boolean {
  return (
    ticket.workOrderId === input.workOrderId &&
    ticket.feature === input.feature &&
    ticket.scope === input.scope &&
    ticket.fee === input.fee
  );
}

/** 图片任务进行中时，弹窗清理不能点取消。 */
export function dismissMayCancel(imageBusy: boolean): boolean {
  return !imageBusy;
}
