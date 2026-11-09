/** 图片分组和收费确认。文字翻译不能抵图片翻译。决策点 #40。 */
import type { ImageGroupName, ImageSlot } from "./dxm-smt-fields.js";

const PAID_FEATURES = new Set(["图片翻译", "图片白底"]);
const PAID_CONFIRM_TTL_MS = 10 * 60 * 1000;

export type PaidFeature = "图片翻译" | "图片白底";

export type PaidTicket = {
  confirmId: string;
  workOrderId: string;
  feature: PaidFeature;
  group: ImageGroupName;
  /** 该组图片 src 的摘要，不是「主图 / 变种图」这几个字。 */
  scope: string;
  fee: string;
  expiresAt?: number;
};

type TicketStatus = "pending" | "consumed" | "expired";

type StoredTicket = PaidTicket & {
  status: TicketStatus;
  issuedRunId: string;
  consumeRunId?: string;
};

const issued = new Map<string, StoredTicket>();
let runSerial = 0;
let activeRunId = "";
let handoffConfirmId = "";

export function resetPaidConfirms(): void {
  issued.clear();
  runSerial = 0;
  activeRunId = "";
  handoffConfirmId = "";
}

export function imageScopeSummary(srcs: string[]): string {
  return [...srcs].map((src) => src.trim()).filter(Boolean).sort().join("|");
}

/** 请求轮只登记 pending。处理下一条用户消息的 run 开始时才进入可消费轮次。 */
export function beginPaidConfirmRun(runId?: string): string {
  const id = runId || `paid-run-${++runSerial}`;
  activeRunId = id;
  const now = Date.now();
  for (const ticket of issued.values()) {
    if (ticket.status !== "pending") continue;
    if (ticket.expiresAt && ticket.expiresAt <= now) {
      ticket.status = "expired";
      continue;
    }
    if (!ticket.consumeRunId) ticket.consumeRunId = id;
    else if (ticket.consumeRunId !== id) ticket.status = "expired";
  }
  return id;
}

/** 这一轮结束时，仍未消费的当前轮次 pending 才失效。刚发出的下一轮句柄留着。 */
export function endPaidConfirmRun(runId?: string): void {
  const id = runId || activeRunId;
  for (const ticket of issued.values()) {
    if (ticket.status === "pending" && ticket.consumeRunId === id) ticket.status = "expired";
  }
  if (activeRunId === id) activeRunId = "";
}

export function peekPaidConfirmHandoff(): string {
  return handoffConfirmId;
}

/** 只在本次 request_confirm 带了收费绑定时发出 pending。文本不能发句柄，发出后也不能当轮执行。 */
export function issuePaidConfirm(ticket: PaidTicket): void {
  if (!ticket.confirmId || !ticket.workOrderId || !ticket.group || !ticket.scope || !ticket.fee) return;
  if (!PAID_FEATURES.has(ticket.feature)) return;
  for (const item of issued.values()) {
    if (item.workOrderId === ticket.workOrderId && item.status === "pending") item.status = "expired";
  }
  issued.set(ticket.confirmId, {
    ...ticket,
    expiresAt: ticket.expiresAt ?? Date.now() + PAID_CONFIRM_TTL_MS,
    status: "pending",
    issuedRunId: activeRunId,
  });
  handoffConfirmId = ticket.confirmId;
}

export function registerPaidConfirmFromArgs(args: Record<string, unknown>): string | null {
  const paid = args.paid;
  if (!paid || typeof paid !== "object") return null;
  const row = paid as Record<string, unknown>;
  const feature = row.feature === "图片翻译" || row.feature === "图片白底" ? row.feature : "";
  const group = row.group === "main" || row.group === "variant" || row.group === "description" ? row.group : "";
  const workOrderId = String(row.workOrderId || "").trim();
  const scope = String(row.srcDigest || row.scope || "").trim();
  const fee = String(row.fee || "").trim();
  if (!feature || !group || !workOrderId || !scope || !fee) return null;
  const confirmId = `paid-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
  issuePaidConfirm({ confirmId, workOrderId, feature, group, scope, fee });
  return confirmId;
}

export function consumePaidConfirm(confirmId: string): void {
  const ticket = issued.get(confirmId);
  if (!ticket) return;
  ticket.status = "consumed";
  if (handoffConfirmId === confirmId) handoffConfirmId = "";
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
 * 只接受显式 confirmId。句柄必须仍是 pending，并且属于当前这一轮确认。
 * 省略句柄不会自动匹配。不看同意或拒绝词。
 */
export function decidePaidAction(input: {
  feature?: string;
  text?: string;
  workOrderId?: string;
  group?: ImageGroupName;
  scope?: string;
  fee?: string;
  confirmId?: string;
  quotedFee?: string;
  liveScope?: string;
}): { execute: boolean; refused: boolean; reason: string; confirmId?: string } {
  const feature = input.feature || "";
  if (!PAID_FEATURES.has(feature)) {
    return { execute: false, refused: false, reason: "不是需要单独确认的收费图片功能" };
  }
  if (!input.confirmId || !input.group) {
    return { execute: false, refused: false, reason: "没有显式确认句柄或图片组，不执行收费动作" };
  }
  const ticket = issued.get(input.confirmId);
  if (!ticket || ticket.status !== "pending") {
    return { execute: false, refused: false, reason: "确认句柄无效或已失效，不执行收费动作" };
  }
  if (ticket.expiresAt && ticket.expiresAt <= Date.now()) {
    ticket.status = "expired";
    return { execute: false, refused: false, reason: "确认句柄已过期，不执行收费动作" };
  }
  if (!ticket.consumeRunId || ticket.consumeRunId !== activeRunId) {
    return { execute: false, refused: false, reason: "确认还在等待用户下一条明确同意，不执行收费动作" };
  }
  if (!input.workOrderId || !input.scope || !input.fee || !input.quotedFee || input.fee !== input.quotedFee) {
    return { execute: false, refused: false, reason: "没有本次确认句柄，或费用信息已变化，不执行收费动作" };
  }
  if (input.liveScope !== undefined && input.liveScope !== ticket.scope) {
    return { execute: false, refused: false, reason: "图片范围已变化，不执行收费动作" };
  }
  if (
    ticket.workOrderId !== input.workOrderId ||
    ticket.feature !== feature ||
    ticket.group !== input.group ||
    ticket.scope !== input.scope ||
    ticket.fee !== input.quotedFee
  ) {
    return { execute: false, refused: false, reason: "没有与本次工作单、功能和范围一致的确认，不执行收费动作" };
  }
  return { execute: true, refused: false, reason: "本次确认句柄匹配", confirmId: ticket.confirmId };
}

/** 图片任务进行中时，弹窗清理不能点取消。 */
export function dismissMayCancel(imageBusy: boolean): boolean {
  return !imageBusy;
}
