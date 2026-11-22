/**
 * 页面独占租约。主进程里同步登记，检查和占用之间不让出执行权。
 * owners / 工位只是身份索引，不在这里另记一份占用。
 */
import { randomBytes } from "node:crypto";

export type PageLease = {
  leaseId: string;
  tabId: string;
  taskId: string;
  clientId: string;
  boundAt: number;
  releasedAt?: number;
  releaseReason?: string;
  envId?: string;
};

export type LeaseError = "tab_busy" | "lease_missing";

type AcquireInput = {
  tabId: string;
  taskId: string;
  clientId: string;
  envId?: string;
  boundAt?: number;
};

const activeByTab = new Map<string, PageLease>();
const activeByTask = new Map<string, PageLease>();
const history: PageLease[] = [];

export function resetPageLeases(): void {
  activeByTab.clear();
  activeByTask.clear();
  history.length = 0;
}

export function listActiveLeases(): PageLease[] {
  return [...activeByTab.values()];
}

export function activeLeaseForTab(tabId: string): PageLease | undefined {
  return activeByTab.get(String(tabId || "").trim());
}

export function activeLeaseForTask(taskId: string): PageLease | undefined {
  return activeByTask.get(String(taskId || "").trim());
}

export function activeLeasesForClient(clientId: string): PageLease[] {
  const id = String(clientId || "").trim();
  return [...activeByTab.values()].filter((lease) => lease.clientId === id);
}

/** 同一页已有有效租约时，只有完全相同的任务可以再拿到它。 */
export function acquireLease(input: AcquireInput): { ok: true; lease: PageLease } | { ok: false; error: "tab_busy" } {
  const tabId = String(input.tabId || "").trim();
  const taskId = String(input.taskId || "").trim();
  const clientId = String(input.clientId || "").trim();
  if (!tabId || !taskId || !clientId) return { ok: false, error: "tab_busy" };
  const onTab = activeByTab.get(tabId);
  if (onTab) {
    if (onTab.clientId === clientId && onTab.taskId === taskId) return { ok: true, lease: onTab };
    return { ok: false, error: "tab_busy" };
  }
  const onTask = activeByTask.get(taskId);
  if (onTask) return { ok: false, error: "tab_busy" };
  const lease: PageLease = {
    leaseId: randomBytes(8).toString("hex"),
    tabId,
    taskId,
    clientId,
    boundAt: input.boundAt ?? Date.now(),
    envId: input.envId ? String(input.envId) : undefined,
  };
  activeByTab.set(tabId, lease);
  activeByTask.set(taskId, lease);
  history.push(lease);
  return { ok: true, lease };
}

export function assertOwnership(input: {
  tabId: string;
  clientId: string;
  taskId?: string;
}): { ok: true; lease: PageLease } | { ok: false; error: "tab_busy" | "lease_missing" } {
  const tabId = String(input.tabId || "").trim();
  const clientId = String(input.clientId || "").trim();
  const lease = activeByTab.get(tabId);
  if (!lease || lease.releasedAt != null) return { ok: false, error: "lease_missing" };
  if (lease.clientId !== clientId) return { ok: false, error: "tab_busy" };
  const taskId = String(input.taskId || "").trim();
  if (taskId && lease.taskId !== taskId) return { ok: false, error: "tab_busy" };
  return { ok: true, lease };
}

export function releaseLease(
  ref: { leaseId?: string; tabId?: string; taskId?: string },
  reason: string,
): { ok: true; already: boolean; lease: PageLease } | { ok: false; error: "lease_missing" } {
  const leaseId = String(ref.leaseId || "").trim();
  const tabId = String(ref.tabId || "").trim();
  const taskId = String(ref.taskId || "").trim();
  const lease = leaseId
    ? history.find((item) => item.leaseId === leaseId)
    : taskId
      ? activeByTask.get(taskId) || history.find((item) => item.taskId === taskId)
      : tabId
        ? activeByTab.get(tabId) || history.find((item) => item.tabId === tabId && item.releasedAt == null)
        : undefined;
  if (!lease) return { ok: false, error: "lease_missing" };
  if (lease.releasedAt != null) return { ok: true, already: true, lease };
  lease.releasedAt = Date.now();
  lease.releaseReason = reason || "released";
  if (activeByTab.get(lease.tabId) === lease) activeByTab.delete(lease.tabId);
  if (activeByTask.get(lease.taskId) === lease) activeByTask.delete(lease.taskId);
  return { ok: true, already: false, lease };
}
