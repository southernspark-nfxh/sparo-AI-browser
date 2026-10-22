/**
 * 用户可见的分步计划。模型先列计划，本地只校验 cap/covers，模型没出计划就用 compileHands 兜底。
 * 与 ActiveMission.plan（可执行 AgentStep[]）分开：那边带着 trip/mission 载荷，不能被这份卡片覆盖。
 */
import {
  compileHands,
  filterLegalCovers,
  isLegalCap,
  type AgentGoal,
  type AgentStep,
} from "../loop.js";

export type PlanStepStatus = "pending" | "running" | "done" | "failed" | "skipped";

export type PlanStep = {
  id: string;
  label: string;
  cap: string;
  covers: string[];
  status: PlanStepStatus;
  note?: string;
};

export type Plan = {
  steps: PlanStep[];
  createdAt: number;
  revisedFrom?: string;
};

export type PlanRevision =
  | { revise: false }
  | { revise: true; why: string; steps: Array<{ label: string; cap: string; covers: string[] }> };

const CAPS =
  "trip_plan / hotel_search / flight_search / train_search / search_read / video_search / read_page / fill_form / mission / feishu / run_skill / reply_draft / print / navigate / act";
const COVERS = "stay food sights itinerary flights trains report page form video answer";

function stepKey(step: { cap: string; covers: string[]; label?: string }): string {
  return `${step.cap}|${[...step.covers].sort().join(",")}|${step.label || ""}`;
}

function asPlanStep(
  draft: { label?: string; cap: string; covers: string[] },
  id: string,
  status: PlanStepStatus,
): PlanStep {
  return {
    id,
    label: (draft.label || draft.covers.join("、")).slice(0, 40),
    cap: draft.cap,
    covers: [...draft.covers],
    status,
  };
}

/** 给模型的计划提示。简单一句 1～2 步，多种交付 3～8 步。 */
export function planPrompt(goal: AgentGoal): string {
  const required = goal.deliverables.filter((d) => d.required).map((d) => d.id);
  return [
    "你是 Sparo 的大脑。动手之前先列出计划，不要现在就执行。",
    "原则：",
    "- 只输出 JSON，不要解释。",
    "- 多种交付（机票、酒店、行程、对照等）出 3～8 步。一句话就能做完的（总结当前页、读这一页、填一张表）只出 1～2 步，不要为了凑数拆开。",
    `- cap 只能用：${CAPS}。`,
    `- covers 用交付物 id：${COVERS}。`,
    "- 用户点名的站点不许换。",
    "- label 用人话，例如「查去程机票」「查上海酒店」。",
    `目标：${goal.intent}`,
    `原话：${goal.raw}`,
    `必须交付：${required.join("、") || "（无）"}`,
    `已知：${JSON.stringify(goal.known)}`,
    '只输出 JSON：{"steps":[{"label":"查去程机票","cap":"flight_search","covers":["flights"]}]}',
  ].join("\n");
}

/** 与 parseReasonerJson 同风格：抠出 JSON，丢掉非法 cap/covers。全非法或空步骤返回 null。 */
export function parsePlanJson(raw: string): Plan | null {
  const m = String(raw || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as { steps?: unknown };
    if (!Array.isArray(j.steps) || !j.steps.length) return null;
    const steps: PlanStep[] = [];
    for (const item of j.steps) {
      if (!item || typeof item !== "object") continue;
      const rec = item as { label?: unknown; cap?: unknown; covers?: unknown };
      const cap = String(rec.cap || "");
      if (!isLegalCap(cap)) continue;
      const covers = filterLegalCovers(
        Array.isArray(rec.covers) ? rec.covers.map((c) => String(c)) : [],
      );
      if (!covers.length) continue;
      steps.push(
        asPlanStep(
          { label: rec.label ? String(rec.label) : undefined, cap, covers },
          `p${steps.length}-${cap}`,
          steps.length === 0 ? "running" : "pending",
        ),
      );
      if (steps.length >= 8) break;
    }
    if (!steps.length) return null;
    if (steps[0].status !== "running") steps[0] = { ...steps[0], status: "running" };
    return { steps, createdAt: Date.now() };
  } catch {
    return null;
  }
}

/** 模型不给计划时的兜底。按 compileHands 的 covers 顺序生成，至少一步，任务不能卡死。 */
export function planFromHeuristic(goal: AgentGoal): Plan {
  const hands = compileHands(goal).slice(0, 8);
  const steps: PlanStep[] = hands.map((hand, i) =>
    asPlanStep(
      { label: hand.label, cap: hand.cap, covers: hand.covers },
      hand.id || `h${i}-${hand.cap}`,
      i === 0 ? "running" : "pending",
    ),
  );
  if (!steps.length) {
    steps.push({
      id: "fallback-answer",
      label: (goal.intent || goal.raw || "直接处理").slice(0, 24),
      cap: "act",
      covers: ["answer"],
      status: "running",
    });
  }
  return { steps, createdAt: Date.now() };
}

function coversHit(step: PlanStep, covers: string[], cap: string): boolean {
  return step.cap === cap && (covers.length === 0 || step.covers.some((c) => covers.includes(c)));
}

/** 一步做完或失败后回写状态。已经记过的观察不会再推进下一步。 */
export function notePlanStep(
  plan: Plan,
  finding: { ok: boolean; text?: string; step: { cap: string; covers: string[] } },
): Plan {
  const steps = plan.steps.map((s) => ({ ...s, covers: [...s.covers] }));
  const open = steps.findIndex(
    (s) =>
      (s.status === "running" || s.status === "pending") &&
      coversHit(s, finding.step.covers, finding.step.cap),
  );
  if (open < 0) return plan;
  const nextStatus: PlanStepStatus = finding.ok ? "done" : "failed";
  steps[open] = {
    ...steps[open],
    status: nextStatus,
    note: finding.ok
      ? steps[open].note
      : String(finding.text || "").replace(/\s+/g, " ").slice(0, 80) || "这步没做成",
  };
  if (!steps.some((s) => s.status === "running")) {
    const nxt = steps.findIndex((s) => s.status === "pending");
    if (nxt >= 0) steps[nxt] = { ...steps[nxt], status: "running" };
  }
  return { ...plan, steps };
}

/** 失败换路：原步保持 failed，替代步变成当前步。 */
export function appendPlanAlternative(
  plan: Plan,
  alt: { label: string; cap: string; covers: string[] },
  reason: string,
): Plan {
  if (!isLegalCap(alt.cap)) return plan;
  const covers = filterLegalCovers(alt.covers);
  if (!covers.length) return plan;
  const label = (alt.label || covers.join("、")).slice(0, 40);
  const steps = plan.steps.map((s) => ({ ...s, covers: [...s.covers] }));
  if (steps.some((s) => s.cap === alt.cap && s.label === label && (s.status === "running" || s.status === "pending"))) {
    return { ...plan, revisedFrom: reason.slice(0, 80) };
  }
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].status === "running") steps[i] = { ...steps[i], status: "pending" };
  }
  steps.push({
    id: `alt-${alt.cap}-${covers.join("-")}-${steps.length}`,
    label,
    cap: alt.cap,
    covers,
    status: "running",
  });
  return { ...plan, steps, revisedFrom: reason.slice(0, 80) };
}

/** 把计划当前步对上可执行手册里的那一手，保留 query / trip / mission。 */
export function nudgeFromPlan(plan: Plan | undefined, hands: AgentStep[]): AgentStep | undefined {
  if (!plan) return undefined;
  const step = plan.steps.find((s) => s.status === "running") || plan.steps.find((s) => s.status === "pending");
  if (!step || !isLegalCap(step.cap)) return undefined;
  return (
    hands.find((h) => h.id === step.id) ||
    hands.find((h) => h.cap === step.cap && h.covers.some((c) => step.covers.includes(c)))
  );
}

/** 卡片高亮真正要做的那一步。 */
export function focusPlanOnStep(
  plan: Plan,
  step: { cap: string; covers: string[] },
): Plan {
  const steps = plan.steps.map((s) => ({ ...s, covers: [...s.covers] }));
  const idx = steps.findIndex(
    (s) => (s.status === "running" || s.status === "pending") && coversHit(s, step.covers, step.cap),
  );
  if (idx < 0) return plan;
  return {
    ...plan,
    steps: steps.map((s, i) => {
      if (i === idx) return { ...s, status: "running" };
      if (s.status === "running") return { ...s, status: "pending" };
      return s;
    }),
  };
}

/** 收摊：交付齐了就把还没勾的标完成；没收齐就标跳过，卡片不留转圈。 */
export function closePlan(plan: Plan, complete: boolean): Plan {
  const steps = plan.steps.map((s) => {
    if (s.status === "done" || s.status === "failed" || s.status === "skipped") return s;
    if (complete) return { ...s, status: "done" as const };
    return { ...s, status: "skipped" as const, note: s.note || "先汇总已查到的" };
  });
  return { ...plan, steps };
}

export function planRevisionPrompt(goal: AgentGoal, plan: Plan, text: string): string {
  const lines = plan.steps
    .map((s, i) => `${i + 1}. [${s.status}] ${s.label} cap=${s.cap} covers=${s.covers.join(",")}`)
    .join("\n");
  return [
    "你是 Sparo 的大脑。用户看着上面的计划说了一句话。",
    "只有当这句话是在改计划（去掉某步、跳过某步、调整顺序、先做某步）时，才输出修订。",
    "如果是在继续、确认、补一个槽、或者另起一件事，必须输出 {\"revise\":false}。",
    "不要重新询问已经知道的出发地、城市、日期。你只改步骤。",
    "去掉的步骤不要出现在 steps 里。先做某步就把那步排到最前。",
    `cap 只能用：${CAPS}。covers 只能用：${COVERS}。用户点名的站点不许换。`,
    `原话任务：${goal.raw}`,
    `已知：${JSON.stringify(goal.known)}`,
    `当前计划：\n${lines}`,
    `用户现在说：${text}`,
    '只输出 JSON：{"revise":false} 或 {"revise":true,"why":"去掉最后一步","steps":[{"label":"查去程机票","cap":"flight_search","covers":["flights"]}]}',
  ].join("\n");
}

export function parsePlanRevision(raw: string): PlanRevision | null {
  const m = String(raw || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as { revise?: unknown; why?: unknown; steps?: unknown };
    if (j.revise === false) return { revise: false };
    if (j.revise !== true || !Array.isArray(j.steps)) return null;
    const steps: Array<{ label: string; cap: string; covers: string[] }> = [];
    for (const item of j.steps) {
      if (!item || typeof item !== "object") continue;
      const rec = item as { label?: unknown; cap?: unknown; covers?: unknown };
      const cap = String(rec.cap || "");
      if (!isLegalCap(cap)) continue;
      const covers = filterLegalCovers(Array.isArray(rec.covers) ? rec.covers.map((c) => String(c)) : []);
      if (!covers.length) continue;
      steps.push({
        label: String(rec.label || covers.join("、")).slice(0, 40),
        cap,
        covers,
      });
      if (steps.length >= 8) break;
    }
    if (!steps.length) return { revise: false };
    return { revise: true, why: String(j.why || "按你的话改了计划").slice(0, 80), steps };
  } catch {
    return null;
  }
}

/** 已完成/失败的步骤留着；模型没再提到的未完成步骤标跳过；其余按模型的新顺序排。 */
export function applyParsedRevision(plan: Plan, edit: Extract<PlanRevision, { revise: true }>): Plan {
  const why = edit.why || "按你的话改了计划";
  const wanted = edit.steps.filter((s) => isLegalCap(s.cap) && filterLegalCovers(s.covers).length);
  if (!wanted.length) return plan;
  const kept: PlanStep[] = [];
  const consumed = new Set<number>();
  for (const old of plan.steps) {
    const hit = wanted.findIndex((s, i) => !consumed.has(i) && stepKey(s) === stepKey(old));
    if (old.status === "done" || old.status === "failed") {
      kept.push({ ...old, covers: [...old.covers] });
      if (hit >= 0) consumed.add(hit);
      continue;
    }
    if (hit < 0) {
      kept.push({ ...old, covers: [...old.covers], status: "skipped", note: why });
      continue;
    }
    consumed.add(hit);
  }
  const fresh: PlanStep[] = [];
  wanted.forEach((s, i) => {
    if (kept.some((x) => (x.status === "done" || x.status === "failed") && stepKey(x) === stepKey(s))) return;
    fresh.push(asPlanStep(s, `rev-${i}-${s.cap}`, "pending"));
  });
  const steps = [...kept, ...fresh];
  const run = steps.findIndex((s) => s.status === "pending");
  if (run >= 0) steps[run] = { ...steps[run], status: "running" };
  return { steps, createdAt: plan.createdAt, revisedFrom: why };
}
