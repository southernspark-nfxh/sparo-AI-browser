import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { normalizeUtterance, type Trigger } from "./gate.js";

function triggersPath(configDir: string): string {
  return join(configDir, "skill-triggers.json");
}

function normalize(row: Partial<Trigger>): Trigger | null {
  const text = normalizeUtterance(String(row.text || ""));
  const skillId = String(row.skillId || "").trim();
  if (!text || !skillId) return null;
  const id = String(row.id || "").trim() || randomBytes(4).toString("hex");
  return {
    id,
    skillId,
    text,
    addedAt: String(row.addedAt || new Date().toISOString()),
    runs: Number(row.runs || 0) || 0,
    fails: Number(row.fails || 0) || 0,
    enabled: row.enabled !== false,
    lastUsedAt: row.lastUsedAt ? String(row.lastUsedAt) : undefined,
  };
}

export function loadTriggers(configDir: string): Trigger[] {
  const p = triggersPath(configDir);
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as { triggers?: Partial<Trigger>[] };
    return (raw.triggers || []).map(normalize).filter((x): x is Trigger => Boolean(x));
  } catch {
    return [];
  }
}

function saveAll(configDir: string, triggers: Trigger[]): Trigger[] {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(triggersPath(configDir), JSON.stringify({ triggers }, null, 2), "utf8");
  return triggers;
}

/** 同一 normalize 文本只留一条。空串不写。 */
export function upsertTrigger(
  configDir: string,
  input: { skillId: string; text: string },
): Trigger | null {
  const text = normalizeUtterance(input.text);
  const skillId = String(input.skillId || "").trim();
  if (!text || !skillId) return null;
  const all = loadTriggers(configDir);
  const existing = all.find((row) => row.text === text);
  if (existing) {
    existing.skillId = skillId;
    saveAll(configDir, all);
    return existing;
  }
  const next: Trigger = {
    id: randomBytes(4).toString("hex"),
    skillId,
    text,
    addedAt: new Date().toISOString(),
    runs: 0,
    fails: 0,
    enabled: true,
  };
  all.unshift(next);
  saveAll(configDir, all);
  return next;
}

export function hasTriggerText(configDir: string, text: string): boolean {
  const key = normalizeUtterance(text);
  if (!key) return false;
  return loadTriggers(configDir).some((row) => row.text === key);
}

export function deleteTrigger(configDir: string, id: string): boolean {
  const all = loadTriggers(configDir);
  const next = all.filter((row) => row.id !== id);
  if (next.length === all.length) return false;
  saveAll(configDir, next);
  return true;
}

/** 恢复（enabled=true）时把 fails 清零。 */
export function toggleTrigger(configDir: string, id: string, enabled: boolean): boolean {
  const all = loadTriggers(configDir);
  const hit = all.find((row) => row.id === id);
  if (!hit) return false;
  hit.enabled = enabled;
  if (enabled) hit.fails = 0;
  saveAll(configDir, all);
  return true;
}

/** 成功：runs+1、fails=0。失败：fails+1，满 2 次停用（不删除）。 */
export function recordOutcome(configDir: string, id: string, ok: boolean): Trigger | null {
  const all = loadTriggers(configDir);
  const hit = all.find((row) => row.id === id);
  if (!hit) return null;
  hit.lastUsedAt = new Date().toISOString();
  if (ok) {
    hit.runs += 1;
    hit.fails = 0;
  } else {
    hit.fails += 1;
    if (hit.fails >= 2) hit.enabled = false;
  }
  saveAll(configDir, all);
  return hit;
}
