import { randomBytes } from "node:crypto";

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
let nextSeat = 1;

export function resetMcpSessions(): void {
  sessions.clear();
  owners.clear();
  nextSeat = 1;
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
}

/** 一个 client 可以拥有多张标签。最近一次登记的是主标签。 */
export function claimTabForClient(clientId: string, tabId: string): void {
  const id = String(clientId || "").trim();
  const tab = String(tabId || "").trim();
  if (!id || !tab) return;
  rememberClientTab(id, tab);
}

/** 任务作用域优先；没有作用域时，从打开它的那张 agent 页继承。用户自己开的页两边都空。 */
export function agentClientFromScope(chatKey?: string, openerOwner?: string): string {
  if (chatKey?.startsWith("agent:")) return chatKey.slice("agent:".length);
  if (openerOwner?.startsWith("agent:")) return openerOwner.slice("agent:".length);
  return "";
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
}): string | undefined {
  const explicit = String(opts.tabId || "").trim();
  if (!opts.clientId) return explicit || undefined;
  if (explicit) {
    rememberClientTab(opts.clientId, explicit);
    return explicit;
  }
  const current = sessions.get(opts.clientId)?.tabId;
  if (current && opts.knownTabIds.includes(current)) return current;
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
