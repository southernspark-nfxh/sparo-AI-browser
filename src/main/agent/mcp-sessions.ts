import { randomBytes } from "node:crypto";
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

const LIVE_TAB_STATES = new Set(["running", "queued", "waiting_human"]);

/** 只有本 client 自己的活任务占着这张标签才算忙。别人占着不算。 */
export function candidateTabBusy(input: {
  clientId: string;
  candidateTabId: string;
  live: Array<{ clientId?: string; tabId?: string; state?: string }>;
}): boolean {
  const tabId = String(input.candidateTabId || "").trim();
  if (!tabId) return false;
  return input.live.some(
    (task) => task.clientId === input.clientId && task.tabId === tabId && LIVE_TAB_STATES.has(String(task.state || "")),
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

/**
 * 有 clientId 时，不带 tabId 的操作落在该 client 最近的标签上。
 * 还没有就新建后台标签，绝不返回空去抢用户的 activeTabId。
 * 没有 clientId 时保持旧行为：显式 tabId 照传，否则 undefined（当前激活标签）。
 */
export function bindClientTab(opts: {
  clientId?: string;
  tabId?: string;
  knownTabIds: string[];
  createAgentTab: () => string;
  /** 候选标签正被本 client 另一个活任务占着。别的 client 占着时调用方传 false。 */
  candidateBusy?: boolean;
}): string | undefined {
  const explicit = String(opts.tabId || "").trim();
  if (!opts.clientId) return explicit || undefined;
  if (explicit) {
    rememberClientTab(opts.clientId, explicit);
    return explicit;
  }
  const current = sessions.get(opts.clientId)?.tabId;
  if (current && opts.knownTabIds.includes(current) && !opts.candidateBusy) return current;
  const created = opts.createAgentTab();
  rememberClientTab(opts.clientId, created);
  return created;
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
