import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { safeStorage } from "electron";
import { cloudApiBase } from "./config.js";

export type CloudTokens = {
  access: string;
  refresh: string;
  email: string;
};

export type QuotaSnap = {
  canStart: boolean;
  points: number;
  approxTasks: number;
  trial: { used: number; left: number; cap: number };
  subscription: { active: boolean; plan: string | null };
  email?: string;
};

function devicePath(configDir: string): string {
  return join(configDir, "cloud-device.json");
}

function tokenPath(configDir: string): string {
  return join(configDir, "cloud-session.bin");
}

export function getDeviceId(configDir: string): string {
  mkdirSync(configDir, { recursive: true });
  const p = devicePath(configDir);
  if (existsSync(p)) {
    try {
      const j = JSON.parse(readFileSync(p, "utf8")) as { id?: string };
      if (j.id) return j.id;
    } catch {
      /* rewrite */
    }
  }
  const id = randomBytes(12).toString("hex");
  writeFileSync(p, JSON.stringify({ id }), "utf8");
  return id;
}

function encodeTokens(tokens: CloudTokens): Buffer {
  const raw = Buffer.from(JSON.stringify(tokens), "utf8");
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(raw.toString("utf8"));
  }
  return raw;
}

function decodeTokens(buf: Buffer): CloudTokens | null {
  try {
    const text = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buf)
      : buf.toString("utf8");
    const j = JSON.parse(text) as CloudTokens;
    if (!j.access) return null;
    return j;
  } catch {
    return null;
  }
}

export function loadTokens(configDir: string): CloudTokens | null {
  const p = tokenPath(configDir);
  if (!existsSync(p)) return null;
  try {
    return decodeTokens(readFileSync(p));
  } catch {
    return null;
  }
}

export function saveTokens(configDir: string, tokens: CloudTokens): void {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(tokenPath(configDir), encodeTokens(tokens));
}

export function clearTokens(configDir: string): void {
  const p = tokenPath(configDir);
  if (existsSync(p)) writeFileSync(p, "");
}

async function api(
  path: string,
  init: RequestInit & { token?: string; deviceId?: string } = {},
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string>),
  };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.deviceId) headers["X-Sparo-Device"] = init.deviceId;
  const res = await fetch(`${cloudApiBase()}${path}`, { ...init, headers });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(String(json.error || json.message || `HTTP ${res.status}`));
  }
  return json;
}

export async function sendLoginCode(email: string): Promise<string> {
  const j = await api("/auth/send-code", { method: "POST", body: JSON.stringify({ email }) });
  return String(j.message || "已发送");
}

export async function verifyLogin(
  configDir: string,
  email: string,
  code: string,
): Promise<QuotaSnap> {
  const deviceId = getDeviceId(configDir);
  const j = await api("/auth/verify", {
    method: "POST",
    deviceId,
    body: JSON.stringify({ email, code, deviceId }),
  });
  saveTokens(configDir, {
    access: String(j.access || ""),
    refresh: String(j.refresh || ""),
    email: String(j.email || email),
  });
  return (j.quota || {}) as QuotaSnap;
}

export async function refreshIfNeeded(configDir: string): Promise<CloudTokens | null> {
  const cur = loadTokens(configDir);
  if (!cur) return null;
  try {
    const j = await api("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh: cur.refresh }),
    });
    const next = {
      access: String(j.access || cur.access),
      refresh: String(j.refresh || cur.refresh),
      email: String(j.email || cur.email),
    };
    saveTokens(configDir, next);
    return next;
  } catch {
    return cur;
  }
}

export async function fetchMe(configDir: string): Promise<QuotaSnap | null> {
  const tokens = loadTokens(configDir);
  if (!tokens) return null;
  try {
    const j = await api("/me", {
      method: "GET",
      token: tokens.access,
      deviceId: getDeviceId(configDir),
    });
    return { ...(j.quota as QuotaSnap), email: tokens.email };
  } catch {
    const refreshed = await refreshIfNeeded(configDir);
    if (!refreshed) return null;
    const j = await api("/me", {
      method: "GET",
      token: refreshed.access,
      deviceId: getDeviceId(configDir),
    });
    return { ...(j.quota as QuotaSnap), email: refreshed.email };
  }
}
