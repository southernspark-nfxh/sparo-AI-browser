import { randomBytes } from "node:crypto";

export type ClientSession = { clientId: string; tabId?: string };

const sessions = new Map<string, ClientSession>();
const owners = new Map<string, string>();

export function resetMcpSessions(): void {
  sessions.clear();
  owners.clear();
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
    sessions.set(opts.clientId, { clientId: opts.clientId, tabId: explicit });
    owners.set(explicit, opts.clientId);
    return explicit;
  }
  const current = sessions.get(opts.clientId)?.tabId;
  if (current && opts.knownTabIds.includes(current)) return current;
  const created = opts.createAgentTab();
  sessions.set(opts.clientId, { clientId: opts.clientId, tabId: created });
  owners.set(created, opts.clientId);
  return created;
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
