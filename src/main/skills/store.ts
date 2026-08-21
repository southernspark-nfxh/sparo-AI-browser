import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { app } from "electron";

export type SkillStep = {
  i?: number;
  action: string;
  selector?: string;
  text?: string;
  value?: string;
  url?: string;
  cssPath?: string;
  innerText?: string;
  ariaLabel?: string;
  placeholder?: string;
  elapsed_ms?: number;
  ts?: string;
  bounds?: { x: number; y: number; w: number; h: number };
};

export type Skill = {
  id: string;
  title: string;
  intent: string;
  source: "taught" | "auto" | "seeded";
  createdAt: string;
  updatedAt: string;
  url?: string;
  platform?: string;
  steps: SkillStep[];
  stepCount: number;
  stats: { success: number; fail: number };
  enabled: boolean;
  traceFile?: string;
};

function skillsDir(configDir: string): string {
  return join(configDir, "skills");
}

function ensureDir(configDir: string): string {
  const dir = skillsDir(configDir);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function skillPath(configDir: string, id: string): string {
  return join(skillsDir(configDir), `${id}.json`);
}

function slugify(title: string): string {
  return title
    .trim()
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 40) || "skill";
}

export function listSkills(configDir: string): Skill[] {
  const dir = ensureDir(configDir);
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const skills: Skill[] = [];
  for (const f of files) {
    try {
      const raw = JSON.parse(readFileSync(join(dir, f), "utf8")) as Skill;
      if (raw?.id && raw?.title) skills.push(raw);
    } catch {
      /* skip bad file */
    }
  }
  skills.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  return skills;
}

export function getSkill(configDir: string, id: string): Skill | null {
  const p = skillPath(configDir, id);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Skill;
  } catch {
    return null;
  }
}

export function saveSkill(configDir: string, skill: Skill): Skill {
  ensureDir(configDir);
  const next = { ...skill, updatedAt: new Date().toISOString() };
  writeFileSync(skillPath(configDir, next.id), JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function deleteSkill(configDir: string, id: string): boolean {
  const p = skillPath(configDir, id);
  if (!existsSync(p)) return false;
  unlinkSync(p);
  return true;
}

export function createSkillFromTrace(input: {
  configDir: string;
  title: string;
  steps: SkillStep[];
  url?: string;
  platform?: string;
  task?: string;
  traceFile?: string;
  source?: Skill["source"];
}): Skill {
  const id = `${slugify(input.title)}-${randomBytes(3).toString("hex")}`;
  const now = new Date().toISOString();
  const skill: Skill = {
    id,
    title: input.title.trim() || "未命名妙招",
    intent: input.task || input.title.trim() || "未命名",
    source: input.source || "taught",
    createdAt: now,
    updatedAt: now,
    url: input.url,
    platform: input.platform,
    steps: input.steps || [],
    stepCount: (input.steps || []).length,
    stats: { success: 0, fail: 0 },
    enabled: true,
    traceFile: input.traceFile,
  };
  return saveSkill(input.configDir, skill);
}

export function skillSummary(skill: Skill): {
  id: string;
  title: string;
  intent: string;
  stepCount: number;
  source: string;
  updatedAt: string;
  enabled: boolean;
  url?: string;
} {
  return {
    id: skill.id,
    title: skill.title,
    intent: skill.intent,
    stepCount: skill.stepCount,
    source: skill.source,
    updatedAt: skill.updatedAt,
    enabled: skill.enabled,
    url: skill.url,
  };
}

/**
 * Copy bundled strategies/skills/*.json into %APPDATA%/sparo/skills.
 * Overwrites seeded skills when bundled version is newer (by updatedAt / version).
 * Never touches source:"taught" user recordings with the same id unless missing.
 */
export function seedBundledSkills(configDir: string): { seeded: string[] } {
  const dir = ensureDir(configDir);
  const candidates: string[] = [];
  try {
    candidates.push(join(app.getAppPath(), "strategies", "skills"));
  } catch {
    /* not in electron yet */
  }
  candidates.push(
    join(__dirname, "../../../strategies/skills"),
    join(process.cwd(), "strategies", "skills"),
  );
  const srcDir = candidates.find((p) => existsSync(p));
  if (!srcDir) return { seeded: [] };

  const seeded: string[] = [];
  for (const f of readdirSync(srcDir).filter(
    (x) => x.endsWith(".json") && !x.startsWith("_"),
  )) {
    const src = join(srcDir, f);
    let bundled: Skill & { version?: number; distilled?: boolean };
    try {
      bundled = JSON.parse(readFileSync(src, "utf8")) as typeof bundled;
    } catch {
      continue;
    }
    if (!bundled?.id) continue;
    const dest = skillPath(configDir, bundled.id);
    if (existsSync(dest)) {
      try {
        const existing = JSON.parse(readFileSync(dest, "utf8")) as Skill & {
          version?: number;
        };
        if (existing.source === "taught") continue;
        const bv = Number(bundled.version || 0);
        const ev = Number(existing.version || 0);
        if (ev > bv) continue;
        if (
          ev === bv &&
          (existing.updatedAt || "") >= (bundled.updatedAt || "")
        ) {
          continue;
        }
      } catch {
        /* replace corrupt */
      }
    }
    const next: Skill = {
      ...bundled,
      source: "seeded",
      stepCount: bundled.steps?.length || bundled.stepCount || 0,
      stats: bundled.stats || { success: 0, fail: 0 },
      enabled: bundled.enabled !== false,
      createdAt: bundled.createdAt || new Date().toISOString(),
      updatedAt: bundled.updatedAt || new Date().toISOString(),
      intent: bundled.intent || bundled.title,
    };
    writeFileSync(dest, JSON.stringify(next, null, 2), "utf8");
    seeded.push(bundled.id);
  }
  return { seeded };
}
