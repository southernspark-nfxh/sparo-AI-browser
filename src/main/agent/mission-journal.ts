/**
 * 工作单事件日志。每次状态变化追加一行，启动时回放未完成的单。
 * 只写本机 missions.jsonl，不加密、不同步。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { storeConfigDir } from "../paths.js";
import { isCancelText } from "./slots.js";
import type { ActiveMission } from "./runtime.js";
import type { StepFinding } from "./loop.js";
import type { Plan } from "./kernel/plan.js";
import type { MissionState } from "./types.js";

export type MissionEvent =
  | { t: number; op: "open"; mission: ActiveMission }
  | { t: number; op: "turn"; id: string; state: MissionState; plan?: Plan; findings?: StepFinding[] }
  | { t: number; op: "close"; id: string; reason: string };

export type RestoredMission = {
  mission: ActiveMission;
  openedAt: number;
  /** 回放时数到的 turn 行。压缩快照会丢掉这个数，执行过的发现仍留在 mission 上。 */
  turns?: number;
};

const FINDING_TEXT_CAP = 500;
const COMPACT_AT = 2000;
const TAIL_KEEP = 200;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function missionsPath(dir = storeConfigDir()): string {
  return join(dir, "missions.jsonl");
}

/** 单测和运行时都可以关。vitest 默认不写用户目录。 */
export function missionJournalEnabled(): boolean {
  if (process.env.SPARO_MISSION_JOURNAL === "0") return false;
  if (process.env.VITEST && process.env.SPARO_MISSION_JOURNAL !== "1") return false;
  return true;
}

function shrinkFinding(finding: StepFinding): StepFinding {
  const text = String(finding.text || "").slice(0, FINDING_TEXT_CAP);
  if (!finding.doc) return { ...finding, text };
  return {
    ...finding,
    text,
    doc: {
      title: finding.doc.title,
      path: finding.doc.path,
      ...(finding.doc.kind ? { kind: finding.doc.kind } : {}),
    },
  };
}

function shrinkMission(mission: ActiveMission): ActiveMission {
  return {
    ...mission,
    findings: (mission.findings || []).map(shrinkFinding),
    plan: mission.plan ? mission.plan.map((step) => ({ ...step })) : [],
    brainPlan: mission.brainPlan
      ? { ...mission.brainPlan, steps: mission.brainPlan.steps.map((s) => ({ ...s, covers: [...s.covers] })) }
      : mission.brainPlan,
  };
}

function readLines(dir: string): string[] {
  const path = missionsPath(dir);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (error) {
    console.warn("[mission-journal] read failed", error instanceof Error ? error.message : error);
    return [];
  }
}

export function parseMissionLine(line: string): MissionEvent | null {
  try {
    const raw = JSON.parse(line) as MissionEvent;
    if (!raw || typeof raw !== "object") return null;
    if (raw.op === "open" && raw.mission && typeof raw.mission.id === "string" && raw.mission.state) return raw;
    if (raw.op === "turn" && typeof raw.id === "string" && typeof raw.state === "string") return raw;
    if (raw.op === "close" && typeof raw.id === "string") return raw;
    return null;
  } catch {
    return null;
  }
}

function applyEvent(open: Map<string, RestoredMission>, closed: Set<string>, event: MissionEvent): void {
  if (event.op === "close") {
    closed.add(event.id);
    open.delete(event.id);
    return;
  }
  if (event.op === "open") {
    if (closed.has(event.mission.id)) return;
    open.set(event.mission.id, {
      mission: shrinkMission(event.mission),
      openedAt: event.t || Date.now(),
      turns: 0,
    });
    return;
  }
  const hit = open.get(event.id);
  if (!hit || closed.has(event.id)) return;
  const mission: ActiveMission = {
    ...hit.mission,
    state: event.state,
    ...(event.plan ? { brainPlan: event.plan } : {}),
    ...(event.findings ? { findings: event.findings.map(shrinkFinding) } : {}),
  };
  if (mission.state === "done" || mission.state === "cancelled") {
    closed.add(event.id);
    open.delete(event.id);
    return;
  }
  open.set(event.id, { mission, openedAt: hit.openedAt, turns: (hit.turns || 0) + 1 });
}

export function replayMissions(dir = storeConfigDir()): RestoredMission[] {
  const open = new Map<string, RestoredMission>();
  const closed = new Set<string>();
  for (const line of readLines(dir)) {
    const event = parseMissionLine(line);
    if (!event) continue;
    applyEvent(open, closed, event);
  }
  return [...open.values()].filter((item) => item.mission.state !== "done" && item.mission.state !== "cancelled");
}

function compact(dir: string, lines: string[]): void {
  const restored = replayFromLines(lines);
  const head = restored.map((item) =>
    JSON.stringify({ t: item.openedAt, op: "open", mission: shrinkMission(item.mission) } satisfies MissionEvent),
  );
  const tail = lines.slice(-TAIL_KEEP);
  const next = [...head, ...tail];
  writeFileSync(missionsPath(dir), `${next.join("\n")}\n`, "utf8");
}

function replayFromLines(lines: string[]): RestoredMission[] {
  const open = new Map<string, RestoredMission>();
  const closed = new Set<string>();
  for (const line of lines) {
    const event = parseMissionLine(line);
    if (!event) continue;
    applyEvent(open, closed, event);
  }
  return [...open.values()].filter((item) => item.mission.state !== "done" && item.mission.state !== "cancelled");
}

export function appendMissionEvent(event: MissionEvent, dir = storeConfigDir()): void {
  try {
    mkdirSync(dir, { recursive: true });
    const line = JSON.stringify(event);
    appendFileSync(missionsPath(dir), `${line}\n`, "utf8");
    const lines = readLines(dir);
    if (lines.length > COMPACT_AT) compact(dir, lines);
  } catch (error) {
    console.warn("[mission-journal] append failed", error instanceof Error ? error.message : error);
  }
}

export function journalMissionOpen(mission: ActiveMission, dir = storeConfigDir()): void {
  if (!shouldWrite(dir)) return;
  appendMissionEvent({ t: Date.now(), op: "open", mission: shrinkMission(mission) }, dir);
}

export function journalMissionTurn(mission: ActiveMission, dir = storeConfigDir()): void {
  if (!shouldWrite(dir)) return;
  if (!mission?.id) return;
  appendMissionEvent(
    {
      t: Date.now(),
      op: "turn",
      id: mission.id,
      state: mission.state,
      ...(mission.brainPlan ? { plan: mission.brainPlan } : {}),
      findings: (mission.findings || []).map(shrinkFinding),
    },
    dir,
  );
}

export function journalMissionClose(id: string, reason: string, dir = storeConfigDir()): void {
  if (!shouldWrite(dir)) return;
  if (!id) return;
  appendMissionEvent({ t: Date.now(), op: "close", id, reason: reason.slice(0, 80) }, dir);
}

/** 同一句用户原话。没有 parent / session，阶段 1 只能用这句话分组。 */
export function utteranceKey(mission: Pick<ActiveMission, "raw" | "goal"> | null | undefined): string {
  return String(mission?.raw || mission?.goal?.raw || "").replace(/\s+/g, " ").trim();
}

/**
 * 实际开始执行过。计划第 0 步在创建时就会被标成 running，那不是执行记录。
 * turn 行或发现才算。
 */
export function missionWasExecuted(item: RestoredMission): boolean {
  if ((item.turns || 0) > 0) return true;
  return (item.mission.findings || []).length > 0;
}

function planStillOpen(mission: ActiveMission): boolean {
  const steps = mission.brainPlan?.steps || [];
  if (!steps.length) return true;
  return steps.some((step) => step.status !== "done" && step.status !== "skipped");
}

/**
 * 实际开始执行过、且还没正常收尾的单里，取最近开出的一张。
 * 只读回放结果，不写盘，也不要在启动时拿它去关旧单。
 */
export function pickInterruptedMission(items: RestoredMission[]): RestoredMission | undefined {
  const eligible = items.filter((item) => {
    if (item.mission.state === "done" || item.mission.state === "cancelled") return false;
    if (!missionWasExecuted(item)) return false;
    if (!planStillOpen(item.mission)) return false;
    return true;
  });
  return eligible[eligible.length - 1];
}

/**
 * 追加 close，不改历史行。
 * onlyIdle 时只顺手关掉同一句里还没执行过的影子单（正常收尾）；
 * 否则同一句还开着的单全部关掉（用户当场说「算了」）。
 * 空原文不按组扫，只关 alsoId，避免把原文缺失的单误并成一组。
 */
export function journalCloseUtterance(
  raw: string,
  reason: string,
  dir = storeConfigDir(),
  opts?: { alsoId?: string; onlyIdle?: boolean },
): string[] {
  const key = raw.replace(/\s+/g, " ").trim();
  const ids: string[] = [];
  const seen = new Set<string>();
  const push = (id: string | undefined) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };
  if (opts?.alsoId) push(opts.alsoId);
  if (key) {
    for (const item of replayMissions(dir)) {
      if (utteranceKey(item.mission) !== key) continue;
      if (opts?.onlyIdle && missionWasExecuted(item)) continue;
      push(item.mission.id);
    }
  }
  for (const id of ids) journalMissionClose(id, reason, dir);
  return ids;
}

function shouldWrite(dir: string): boolean {
  if (process.env.SPARO_MISSION_JOURNAL_DIR && dir === process.env.SPARO_MISSION_JOURNAL_DIR) return true;
  return missionJournalEnabled();
}

/** applyTurn 之后记一笔。状态、计划、发现没变就不写。 */
export function journalTurn(before: ActiveMission | null | undefined, after: ActiveMission | null | undefined, dir = storeConfigDir()): void {
  if (!shouldWrite(dir)) return;
  try {
    if (before && (!after || after.id !== before.id || after.state === "cancelled" || after.state === "done")) {
      if (!after || after.id !== before.id || after.state === "cancelled") {
        journalMissionClose(before.id, after?.state === "cancelled" ? "cancelled" : "replaced", dir);
      }
    }
    if (!after) return;
    const opened = !before || before.id !== after.id;
    if (opened && after.state !== "done" && after.state !== "cancelled") journalMissionOpen(after, dir);
    const changed =
      !opened &&
      (before?.state !== after.state ||
        before?.brainPlan !== after.brainPlan ||
        (before?.findings.length || 0) !== after.findings.length);
    if (changed && after.state !== "done" && after.state !== "cancelled") journalMissionTurn(after, dir);
    if (after.state === "done" || after.state === "cancelled") {
      if (opened) journalMissionOpen(after, dir);
      journalMissionClose(after.id, after.state, dir);
    }
  } catch (error) {
    console.warn("[mission-journal] turn failed", error instanceof Error ? error.message : error);
  }
}

export function recoveryLine(item: RestoredMission, now = Date.now()): string {
  const mission = item.mission;
  const title = (mission.goal?.intent || mission.raw || "上次的任务").replace(/\s+/g, " ").slice(0, 42);
  const steps = mission.brainPlan?.steps || [];
  const idx = steps.findIndex((s) => s.status === "running" || s.status === "pending");
  const step = idx >= 0 ? steps[idx] : undefined;
  const where = step ? `跑到第 ${idx + 1} 步「${step.label}」` : `停在${stateLabel(mission.state)}`;
  const old = now - item.openedAt >= WEEK_MS;
  const when = old ? `（${formatDay(item.openedAt)}的单）` : "";
  return `上次${when}「${title}」${where}，继续？`;
}

function stateLabel(state: MissionState): string {
  if (state === "waiting_human") return "等你处理";
  if (state === "blocked") return "还缺一项";
  if (state === "propose") return "等你确认";
  return "进行中";
}

function formatDay(t: number): string {
  const d = new Date(t);
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export type RecoveryChoice = "resume" | "dismiss";

export function decideRecovery(text: string): RecoveryChoice | null {
  const t = text.trim();
  if (isCancelText(t)) return "dismiss";
  if (/^继续[吧啊]?$/.test(t)) return "resume";
  return null;
}
