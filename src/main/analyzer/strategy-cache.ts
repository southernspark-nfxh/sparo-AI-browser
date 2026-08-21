/**
 * Per-host primitive method cache — learn which fill/click strategy works.
 * File: %APPDATA%/sparo/strategy-cache.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type StrategyEntry = {
  method: string;
  selector?: string;
  updatedAt: string;
  hits?: number;
};

export type StrategyCache = Record<string, Record<string, StrategyEntry>>;

export function strategyCachePath(configDir: string): string {
  return join(configDir, "strategy-cache.json");
}

export function loadStrategyCache(configDir: string): StrategyCache {
  const p = strategyCachePath(configDir);
  if (!existsSync(p)) return {};
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as StrategyCache;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

export function saveStrategyCache(configDir: string, cache: StrategyCache): void {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(strategyCachePath(configDir), JSON.stringify(cache, null, 2), "utf8");
}

export function getCachedMethod(
  cache: StrategyCache,
  host: string,
  primitive: string,
): StrategyEntry | null {
  const h = cache[host];
  if (!h) return null;
  return h[primitive] || null;
}

export function rememberMethod(
  configDir: string,
  host: string,
  primitive: string,
  method: string,
  selector?: string,
): void {
  if (!host || !primitive || !method) return;
  const cache = loadStrategyCache(configDir);
  if (!cache[host]) cache[host] = {};
  const prev = cache[host][primitive];
  cache[host][primitive] = {
    method,
    selector: selector || prev?.selector,
    updatedAt: new Date().toISOString(),
    hits: (prev?.hits || 0) + 1,
  };
  saveStrategyCache(configDir, cache);
}
