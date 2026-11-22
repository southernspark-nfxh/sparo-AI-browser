import { randomBytes } from "node:crypto";
import {
  acquireLease,
  activeLeaseForTab,
  activeLeasesForClient,
  releaseLease,
  resetPageLeases,
  type PageLease,
} from "./page-lease.js";
import { canReusePage, type PageReuseSnapshot } from "./task-state.js";
import { SIDEBAR_CLIENT_ID } from "./sidebar-tab.js";

export const AGENT_COLORS = [
  "#2f6feb",
  "#0e9f6e",
  "#c2410c",
  "#7c3aed",
  "#0891b2",
  "#be123c",
  "#4d7c0f",
  "#a16207",
];

const SEAT_STEMS = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];

export type ClientSession = {
  clientId: string;
  tabId?: string;
  name: string;
  color: string;
  seat: number;
};

const sessions = new Map<string, ClientSession>();
const owners = new Map<string, string>();
const tabSeats = new Map<string, number>();
let nextSeat = 1;

export function resetMcpSessions(): void {
  sessions.clear();
  owners.clear();
  tabSeats.clear();
  nextSeat = 1;
  resetPageLeases();
}

/** 接入顺序，从 1 起。没登记过返回 undefined。 */
export function seatForClient(clientId: string): number | undefined {
  const id = String(clientId || "").trim();
  if (!id) return undefined;
  return sessions.get(id)?.seat;
}

function seatLabel(seat: number): string {
  const stem = SEAT_STEMS[seat - 1];
  return stem ? `Agent ${stem}` : `Agent ${seat}`;
}

export function colorForClient(clientId: string): string {
  let hash = 0;
  for (let i = 0; i < clientId.length; i += 1) {
    hash = (Math.imul(hash, 31) + clientId.charCodeAt(i)) >>> 0;
  }
  return AGENT_COLORS[hash % AGENT_COLORS.length];
}

/** 侧栏任务的固定工位。不占用甲、乙、丙的序号。 */
export function ensureSidebarClient(): ClientSession {
  const current = sessions.get(SIDEBAR_CLIENT_ID);
  if (current) {
    current.name = "侧栏";
    current.seat = 0;
    return current;
  }
  const session: ClientSession = {
    clientId: SIDEBAR_CLIENT_ID,
    name: "侧栏",
    color: colorForClient(SIDEBAR_CLIENT_ID),
    seat: 0,
  };
  sessions.set(SIDEBAR_CLIENT_ID, session);
  return session;
}

/** 有名字就用（最多 24 字）；没有就按接入顺序叫 Agent 甲、乙、丙。颜色按 clientId 固定。 */
export function registerClientName(clientId: string, rawName?: string): ClientSession {
  const id = String(clientId || "").trim();
  const trimmed = String(rawName || "").replace(/\s+/g, " ").trim().slice(0, 24);
  const current = sessions.get(id);
  if (current) {
    if (trimmed) current.name = trimmed;
    if (!current.color) current.color = colorForClient(id);
    return current;
  }
  const seat = nextSeat;
  nextSeat += 1;
  const session: ClientSession = {
    clientId: id,
    name: trimmed || seatLabel(seat),
    color: colorForClient(id),
    seat,
  };
  sessions.set(id, session);
  return session;
}

function rememberClientTab(clientId: string, tabId: string): void {
  const session = sessions.get(clientId) || registerClientName(clientId, "");
  session.tabId = tabId;
  if (!session.color) session.color = colorForClient(clientId);
  owners.set(tabId, clientId);
  assignTabSeat(clientId, tabId);
}

/** 第一张用 client 自己的工位。同一 client 再开一张才另给号，侧栏工位 0 不占序号。 */
function assignTabSeat(clientId: string, tabId: string): void {
  if (tabSeats.has(tabId)) return;
  const session = sessions.get(clientId);
  if (!session || session.seat === 0) {
    tabSeats.set(tabId, session?.seat ?? 0);
    return;
  }
  const hasOther = [...owners.entries()].some(
    ([id, owner]) => owner === clientId && id !== tabId && tabSeats.has(id),
  );
  if (!hasOther) {
    tabSeats.set(tabId, session.seat);
    return;
  }
  const seat = nextSeat;
  nextSeat += 1;
  tabSeats.set(tabId, seat);
}

export function seatForTab(tabId: string): number | undefined {
  return tabSeats.has(tabId) ? tabSeats.get(tabId) : undefined;
}

export function clientTabId(clientId: string): string | undefined {
  return sessions.get(String(clientId || "").trim())?.tabId;
}

const BLOCKING_TAB_STATES = new Set(["running", "queued", "waiting_human", "failed", "done", "stopped"]);

/** 任一 client 的未释放任务或有效租约都算忙。不再把「别人占着」排除在外。 */
export function candidateTabBusy(input: {
  clientId: string;
  candidateTabId: string;
  live: Array<{ clientId?: string; tabId?: string; state?: string }>;
}): boolean {
  const tabId = String(input.candidateTabId || "").trim();
  if (!tabId) return false;
  if (activeLeaseForTab(tabId)) return true;
  return input.live.some(
    (task) => task.tabId === tabId && BLOCKING_TAB_STATES.has(String(task.state || "")),
  );
}

/** 一个 client 可以拥有多张标签。最近一次登记的是主标签。 */
export function claimTabForClient(clientId: string, tabId: string): void {
  const id = String(clientId || "").trim();
  const tab = String(tabId || "").trim();
  if (!id || !tab) return;
  rememberClientTab(id, tab);
}

/** `agent:<clientId>` 或任务卷 `agent:<clientId>/<taskId>`，都只取出 clientId。 */
function clientIdFromAgentKey(value?: string): string {
  if (!value?.startsWith("agent:")) return "";
  const rest = value.slice("agent:".length);
  const slash = rest.indexOf("/");
  return (slash >= 0 ? rest.slice(0, slash) : rest).trim();
}

/** 任务作用域优先；没有作用域时，从打开它的那张 agent 页继承。用户自己开的页两边都空。 */
export function agentClientFromScope(chatKey?: string, openerOwner?: string): string {
  return clientIdFromAgentKey(chatKey) || clientIdFromAgentKey(openerOwner);
}

/** initialize 响应里带回的 6 位 clientId。 */
export function issueClientId(): string {
  return randomBytes(4).toString("hex").slice(0, 6);
}

export type PageOccupancy = {
  openTask?: boolean;
  agentOwned?: boolean;
};

export type AllocateRequest = {
  /** task：新任务默认新开页。address：已有页只核对所有权，不重复占用。 */
  intent?: "task" | "address";
  clientId?: string;
  tabId?: string;
  taskId?: string;
  envId?: string;
  /** 原任务续跑。必须 taskId、tabId、clientId 同时对上。 */
  resume?: boolean;
  knownTabIds: string[];
  createAgentTab: (activate?: boolean) => string;
  occupancy?: (tabId: string) => PageOccupancy;
  /** 旧参数。占用判断改看租约，不再使用。 */
  candidateBusy?: boolean;
};

export type AllocateResult =
  | { ok: true; tabId: string; leaseId: string; created: boolean }
  | { ok: false; error: "tab_busy" };

function ownerClientId(tabId: string): string {
  const owner = owners.get(tabId);
  return owner ? String(owner) : "";
}

function pageCanBeTaken(tabId: string, occupancy?: (tabId: string) => PageOccupancy): boolean {
  const lease = activeLeaseForTab(tabId);
  const owner = ownerClientId(tabId);
  const extra = occupancy?.(tabId);
  const snapshot: PageReuseSnapshot = {
    hasAgent: Boolean(lease || owner || extra?.agentOwned),
    hasOpenTask: Boolean(lease || extra?.openTask),
    leaseActive: Boolean(lease),
    released: !lease,
    idle: !lease && !owner && !extra?.agentOwned && !extra?.openTask,
  };
  return canReusePage(snapshot);
}

function knownTab(tabId: string, known: string[]): boolean {
  return known.includes(tabId);
}

function hold(clientId: string, tabId: string, taskId: string, envId?: string): AllocateResult {
  const acquired = acquireLease({ tabId, taskId, clientId, envId });
  if (!acquired.ok) return acquired;
  rememberClientTab(clientId, tabId);
  return { ok: true, tabId, leaseId: acquired.lease.leaseId, created: false };
}

/**
 * 新任务才占用。已经属于自己的页面只核对，不重新占用，也不报 tab_busy。
 * 没指定页面的新任务一律新开，不拿最近页，也不拿用户当前页。
 */
export function allocateClientTab(opts: AllocateRequest): AllocateResult {
  const clientId = String(opts.clientId || "").trim();
  const explicit = String(opts.tabId || "").trim();
  const intent = opts.intent || "address";
  const taskId = String(opts.taskId || "").trim();
  if (!clientId) return { ok: true, tabId: explicit, leaseId: "", created: false };

  if (intent === "task" && opts.resume) {
    if (!explicit || !taskId || !knownTab(explicit, opts.knownTabIds)) return { ok: false, error: "tab_busy" };
    const lease = activeLeaseForTab(explicit);
    if (!lease || lease.clientId !== clientId || lease.taskId !== taskId) return { ok: false, error: "tab_busy" };
    rememberClientTab(clientId, explicit);
    return { ok: true, tabId: explicit, leaseId: lease.leaseId, created: false };
  }

  if (explicit) {
    const lease = activeLeaseForTab(explicit);
    if (lease) {
      const sameTask = !taskId || lease.taskId === taskId;
      if (lease.clientId === clientId && (intent === "address" || sameTask)) {
        rememberClientTab(clientId, explicit);
        return { ok: true, tabId: explicit, leaseId: lease.leaseId, created: false };
      }
      return { ok: false, error: "tab_busy" };
    }
    const owner = ownerClientId(explicit);
    if (intent === "address" && owner === clientId) {
      rememberClientTab(clientId, explicit);
      return { ok: true, tabId: explicit, leaseId: "", created: false };
    }
    if (!knownTab(explicit, opts.knownTabIds) || !pageCanBeTaken(explicit, opts.occupancy)) {
      return { ok: false, error: "tab_busy" };
    }
    return hold(clientId, explicit, taskId || `open:${explicit}`, opts.envId);
  }

  if (intent === "address") {
    const mine = activeLeasesForClient(clientId)
      .filter((lease) => knownTab(lease.tabId, opts.knownTabIds))
      .sort((a, b) => b.boundAt - a.boundAt);
    const recentLease = mine[0];
    if (recentLease) {
      rememberClientTab(clientId, recentLease.tabId);
      return { ok: true, tabId: recentLease.tabId, leaseId: recentLease.leaseId, created: false };
    }
    const recent = sessions.get(clientId)?.tabId || "";
    if (recent && knownTab(recent, opts.knownTabIds) && ownerClientId(recent) === clientId) {
      const foreign = activeLeaseForTab(recent);
      if (!foreign || foreign.clientId === clientId) {
        rememberClientTab(clientId, recent);
        return { ok: true, tabId: recent, leaseId: foreign?.leaseId || "", created: false };
      }
    }
  }

  const created = opts.createAgentTab(clientId === SIDEBAR_CLIENT_ID);
  const createdId = String(created || "").trim();
  if (!createdId) return { ok: false, error: "tab_busy" };
  const acquired = acquireLease({
    tabId: createdId,
    taskId: taskId || `open:${createdId}`,
    clientId,
    envId: opts.envId,
  });
  if (!acquired.ok) return acquired;
  rememberClientTab(clientId, createdId);
  return { ok: true, tabId: createdId, leaseId: acquired.lease.leaseId, created: true };
}

/** 兼容旧调用。抢占失败时返回 undefined，需要稳定错误码时用 allocateClientTab。 */
export function bindClientTab(opts: AllocateRequest): string | undefined {
  const result = allocateClientTab(opts);
  if (!result.ok) return undefined;
  return result.tabId || undefined;
}

/** 释放这一页的租约，并清掉这一页的归属。同一 Agent 的其他页不动。 */
export function releaseClientLease(
  ref: { leaseId?: string; tabId?: string; taskId?: string },
  reason: string,
): { ok: true; already: boolean; lease: PageLease } | { ok: false; error: "lease_missing" } {
  const result = releaseLease(ref, reason);
  if (!result.ok || result.already) return result;
  const tabId = result.lease.tabId;
  owners.delete(tabId);
  tabSeats.delete(tabId);
  const session = sessions.get(result.lease.clientId);
  if (session?.tabId === tabId) {
    const another = [...owners.entries()].find(([, owner]) => owner === result.lease.clientId)?.[0];
    session.tabId = another;
  }
  return result;
}

export function listClientSessions(): ClientSession[] {
  return [...sessions.values()];
}

export function ownerForTab(tabId: string): "user" | `agent:${string}` {
  const clientId = owners.get(tabId);
  return clientId ? `agent:${clientId}` : "user";
}

export function backgroundPoolDecision(
  runningBackground: number,
  limit = 3,
): { ok: true } | { ok: false; error: "pool_full" } {
  if (runningBackground >= limit) return { ok: false, error: "pool_full" };
  return { ok: true };
}
