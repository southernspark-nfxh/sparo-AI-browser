import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { MAX_LESSONS, type LearnAdvice, type LearnTrigger, type Lesson } from "./types.js";

function lessonsPath(configDir: string): string {
  return join(configDir, "lessons.json");
}

const TRIGGERS = new Set<LearnTrigger>(["login", "overlay", "captcha_human", "dead_click"]);
const ADVICES = new Set<LearnAdvice>(["pause", "dismiss_overlay", "stop_retry", "wait_human"]);

export function hostOf(urlOrHost: string): string {
  const raw = String(urlOrHost || "").trim().toLowerCase();
  if (!raw) return "";
  try {
    const u = raw.includes("://") ? new URL(raw) : new URL(`https://${raw}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return raw.replace(/^www\./, "").split("/")[0] || "";
  }
}

export function sanitizeNote(raw: string): string {
  let s = String(raw || "").replace(/\s+/g, " ").trim().slice(0, 80);
  s = s.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[已去掉]");
  s = s.replace(/\b\d{4,8}\b/g, "[已去掉]");
  s = s.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[已去掉]");
  if (/密码|password|验证码|captcha/i.test(s)) return "需要人处理";
  return s;
}

function normalize(row: Partial<Lesson>): Lesson | null {
  const host = hostOf(String(row.host || ""));
  const trigger = TRIGGERS.has(row.trigger as LearnTrigger) ? (row.trigger as LearnTrigger) : null;
  const advice = ADVICES.has(row.advice as LearnAdvice) ? (row.advice as LearnAdvice) : null;
  if (!host || !trigger || !advice) return null;
  return {
    id: String(row.id || randomBytes(6).toString("hex")),
    host,
    trigger,
    advice,
    note: sanitizeNote(String(row.note || "")),
    createdAt: String(row.createdAt || new Date().toISOString()),
    applyCount: Number(row.applyCount || 0),
    lastAppliedAt: row.lastAppliedAt ? String(row.lastAppliedAt) : undefined,
  };
}

export function loadLessons(configDir: string): Lesson[] {
  const p = lessonsPath(configDir);
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as { lessons?: Partial<Lesson>[] };
    return (raw.lessons || []).map(normalize).filter((x): x is Lesson => Boolean(x));
  } catch {
    return [];
  }
}

function saveAll(configDir: string, lessons: Lesson[]): Lesson[] {
  mkdirSync(configDir, { recursive: true });
  const trimmed = lessons
    .slice()
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, MAX_LESSONS);
  writeFileSync(lessonsPath(configDir), JSON.stringify({ lessons: trimmed }, null, 2), "utf8");
  return trimmed;
}

export function upsertLesson(
  configDir: string,
  input: { host: string; trigger: LearnTrigger; advice: LearnAdvice; note?: string },
): Lesson {
  const host = hostOf(input.host);
  const lessons = loadLessons(configDir);
  const existing = lessons.find((l) => l.host === host && l.trigger === input.trigger);
  if (existing) {
    existing.advice = input.advice;
    existing.note = sanitizeNote(input.note || existing.note);
    saveAll(configDir, lessons);
    return existing;
  }
  const next: Lesson = {
    id: randomBytes(6).toString("hex"),
    host,
    trigger: input.trigger,
    advice: input.advice,
    note: sanitizeNote(input.note || ""),
    createdAt: new Date().toISOString(),
    applyCount: 0,
  };
  lessons.unshift(next);
  saveAll(configDir, lessons);
  return next;
}

export function findLessonsForHost(configDir: string, hostOrUrl: string): Lesson[] {
  const host = hostOf(hostOrUrl);
  if (!host) return [];
  return loadLessons(configDir).filter((l) => host === l.host || host.endsWith(`.${l.host}`));
}

export function recordLessonApply(configDir: string, id: string): void {
  const lessons = loadLessons(configDir);
  const hit = lessons.find((l) => l.id === id);
  if (!hit) return;
  hit.applyCount += 1;
  hit.lastAppliedAt = new Date().toISOString();
  saveAll(configDir, lessons);
}

export function deleteLesson(configDir: string, id: string): boolean {
  const lessons = loadLessons(configDir);
  const next = lessons.filter((l) => l.id !== id);
  if (next.length === lessons.length) return false;
  saveAll(configDir, next);
  return true;
}

export function lessonPublic(l: Lesson): { id: string; host: string; note: string; trigger: LearnTrigger; applyCount: number } {
  return { id: l.id, host: l.host, note: l.note, trigger: l.trigger, applyCount: l.applyCount };
}
