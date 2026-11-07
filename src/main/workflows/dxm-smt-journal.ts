/** 本机追加日志。只写 sparo-store 下的独立文件，不写 missions.jsonl。决策点 #39。 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DxmListingWorkOrder } from "./dxm-smt-contract.js";

export const DXM_SMT_JOURNAL_FILE = "dxm-smt-journal.jsonl";

const SECRET_KEY = /password|cookie|token|authorization|set-cookie/i;

export function journalFile(dir: string): string {
  return join(dir, DXM_SMT_JOURNAL_FILE);
}

export function saveOrder(dir: string, order: DxmListingWorkOrder): void {
  const line = JSON.stringify({ op: "order", at: Date.now(), order: scrub(order) });
  appendFileSync(journalFile(dir), `${line}\n`, "utf8");
}

export function appendJournalLine(dir: string, line: string): void {
  appendFileSync(journalFile(dir), line.endsWith("\n") ? line : `${line}\n`, "utf8");
}

export function replayOrders(dir: string): DxmListingWorkOrder[] {
  const path = journalFile(dir);
  if (!existsSync(path)) return [];
  const latest = new Map<string, DxmListingWorkOrder>();
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as { order?: DxmListingWorkOrder };
      if (!parsed?.order?.id) continue;
      latest.set(parsed.order.id, parsed.order);
    } catch {
      /* 单行损坏不影响其余恢复 */
    }
  }
  return [...latest.values()];
}

export function loadOrder(dir: string, id: string): DxmListingWorkOrder | null {
  return replayOrders(dir).find((order) => order.id === id) || null;
}

/** 只有读到的 revision 仍是 baseRevision 才追加。否则返回盘上的新版本，不写旧快照。 */
export function commitOrder(
  dir: string,
  order: DxmListingWorkOrder,
  baseRevision: number,
): { ok: true; order: DxmListingWorkOrder } | { ok: false; order: DxmListingWorkOrder | null } {
  const latest = loadOrder(dir, order.id);
  const current = latest?.revision ?? 0;
  if (latest && current !== baseRevision) return { ok: false, order: latest };
  if (!latest && baseRevision !== 0) return { ok: false, order: null };
  const next: DxmListingWorkOrder = { ...order, revision: current + 1 };
  saveOrder(dir, next);
  return { ok: true, order: next };
}

export function scrub<T>(value: T): T {
  return scrubValue(value) as T;
}

function scrubValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => scrubValue(item));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(key)) continue;
    out[key] = scrubValue(item);
  }
  return out;
}
