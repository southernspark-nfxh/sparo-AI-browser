/**
 * 大脑自己记的策略经验：做成了什么、下回别再踩什么。
 * 和 lessons.json（站点登录/验证码）分开，只留本机。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Experience = {
  ts: string;
  cue: string;
  lesson: string;
};

const MAX = 40;

const BUILTIN: Experience[] = [
  {
    ts: "built-in",
    cue: "设计 住 餐厅 景点 两天 行程 安排",
    lesson:
      "当地短途（住+吃+景点+设计）按交付物逐步查再合成手册，不要只开酒店列表。没说机票不要问出发地、不要编往返。往返多城含机票才走行程手册。",
  },
];

function pathOf(configDir: string): string {
  return join(configDir, "experience.json");
}

export function loadExperience(configDir: string): Experience[] {
  const p = pathOf(configDir);
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as { items?: Experience[] };
    return Array.isArray(raw.items) ? raw.items.filter((x) => x?.lesson) : [];
  } catch {
    return [];
  }
}

export function writeExperience(
  configDir: string,
  input: { cue: string; lesson: string },
): void {
  const lesson = String(input.lesson || "").trim().slice(0, 200);
  const cue = String(input.cue || "").trim().slice(0, 80);
  if (!lesson || !cue) return;
  const items = loadExperience(configDir).filter((x) => x.lesson !== lesson);
  items.unshift({ ts: new Date().toISOString(), cue, lesson });
  mkdirSync(configDir, { recursive: true });
  writeFileSync(pathOf(configDir), JSON.stringify({ items: items.slice(0, MAX) }, null, 2), "utf8");
}

export function recallExperience(configDir: string, text: string): Experience[] {
  const t = String(text || "");
  const pool = [...BUILTIN, ...loadExperience(configDir)];
  const hit = pool.filter((x) =>
    x.cue.split(/\s+/).some((w) => w.length >= 2 && t.includes(w)),
  );
  const seen = new Set<string>();
  const out: Experience[] = [];
  for (const x of hit) {
    if (seen.has(x.lesson)) continue;
    seen.add(x.lesson);
    out.push(x);
    if (out.length >= 3) break;
  }
  return out;
}
