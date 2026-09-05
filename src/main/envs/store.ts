/**
 * Environment store: create / list / get / update / clone / delete, persisted as
 * one JSON file per environment under `<configDir>/envs/<envId>/env.json`.
 *
 * The id is a short random slug, never the account name — account names can be
 * duplicated or renamed, ids are stable.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { EnvConfig, FingerprintConfig, ProxyConfig } from "./types.js";
import { resolveTemplate } from "./fingerprint-templates.js";

function envsDir(configDir: string): string {
  return join(configDir, "envs");
}

function envDir(configDir: string, envId: string): string {
  return join(envsDir(configDir), envId);
}

function envFile(configDir: string, envId: string): string {
  return join(envDir(configDir, envId), "env.json");
}

function newId(): string {
  return randomBytes(5).toString("hex").slice(0, 8);
}

function defaultProxy(localPort: number): ProxyConfig {
  return {
    source: "manual",
    localPort,
    selectedTag: undefined,
    subscriptionUrl: undefined,
    manualNode: undefined,
  };
}

export function defaultFingerprint(): FingerprintConfig {
  return resolveTemplate("win11-edge-126-intel");
}

export function createEnv(
  configDir: string,
  init: Partial<EnvConfig> & { account?: EnvConfig["account"] },
): EnvConfig {
  mkdirSync(envsDir(configDir), { recursive: true });
  const id = newId();
  const now = new Date().toISOString();
  const env: EnvConfig = {
    id,
    createdAt: now,
    updatedAt: now,
    account: init.account ?? { type: "other", name: "新环境" },
    fingerprint: init.fingerprint ?? defaultFingerprint(),
    proxy: init.proxy ?? defaultProxy(allocatePort(configDir)),
    enabled: init.enabled ?? true,
  };
  mkdirSync(envDir(configDir, id), { recursive: true });
  writeFileSync(envFile(configDir, id), JSON.stringify(env, null, 2), "utf8");
  return env;
}

export function listEnvs(configDir: string): EnvConfig[] {
  const dir = envsDir(configDir);
  if (!existsSync(dir)) return [];
  const out: EnvConfig[] = [];
  for (const name of readdirSync(dir)) {
    try {
      const raw = readFileSync(join(dir, name, "env.json"), "utf8");
      out.push(normalizeEnv(JSON.parse(raw)));
    } catch {
      /* skip broken env */
    }
  }
  out.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
  return out;
}

export function getEnv(configDir: string, envId: string): EnvConfig | null {
  const p = envFile(configDir, envId);
  if (!existsSync(p)) return null;
  try {
    return normalizeEnv(JSON.parse(readFileSync(p, "utf8")));
  } catch {
    return null;
  }
}

export function saveEnv(configDir: string, env: EnvConfig): EnvConfig {
  mkdirSync(envDir(configDir, env.id), { recursive: true });
  const next: EnvConfig = { ...env, updatedAt: new Date().toISOString() };
  writeFileSync(envFile(configDir, env.id), JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function updateEnv(
  configDir: string,
  envId: string,
  patch: Partial<EnvConfig>,
): EnvConfig | null {
  const current = getEnv(configDir, envId);
  if (!current) return null;
  return saveEnv(configDir, { ...current, ...patch, id: envId });
}

/** Clone an env's config but give it a fresh id and its own proxy port. */
export function cloneEnv(
  configDir: string,
  envId: string,
  newName?: string,
): EnvConfig | null {
  const src = getEnv(configDir, envId);
  if (!src) return null;
  return createEnv(configDir, {
    account: { ...src.account, name: newName ?? `${src.account.name} 副本` },
    fingerprint: { ...src.fingerprint },
    proxy: { ...src.proxy, localPort: allocatePort(configDir, src.proxy.localPort) },
    enabled: src.enabled,
  });
}

export function deleteEnv(configDir: string, envId: string): boolean {
  const dir = envDir(configDir, envId);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

/**
 * Allocate a free local port for a new env's sing-box. Starts at 4200 and skips
 * ports already taken by existing envs. Pure-ish: reads current envs, no socket bind.
 */
export function allocatePort(configDir: string, avoid?: number): number {
  const used = new Set(listEnvs(configDir).map((e) => e.proxy.localPort));
  let port = 4200;
  while (used.has(port) || port === avoid) port++;
  return port;
}

function normalizeEnv(raw: unknown): EnvConfig {
  const r = (raw || {}) as Partial<EnvConfig>;
  const id = typeof r.id === "string" && r.id ? r.id : newId();
  const fingerprint = r.fingerprint ?? defaultFingerprint();
  const proxy = r.proxy ?? defaultProxy(4200);
  return {
    id,
    createdAt: r.createdAt || new Date(0).toISOString(),
    updatedAt: r.updatedAt || new Date(0).toISOString(),
    account: r.account ?? { type: "other", name: "未命名" },
    fingerprint,
    proxy,
    enabled: r.enabled ?? true,
  };
}
