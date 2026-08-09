import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export type SkillStep = {
  i?: number;
  action: string;
  selector?: string;
  text?: string;
  value?: string;
  url?: string;
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
