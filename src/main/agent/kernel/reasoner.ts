/**
 * 推理器：模型是大脑，本地只做最小校验 + 兜底。
 * 看见观察后模型自己决定下一步；失败或启发式已 ask/propose/synthesize 时走兜底。
 */
import {
  compileHands,
  isLegalCap,
  filterLegalCovers,
  type AgentGoal,
  type AgentStep,
  type DeliverableId,
  type LoopCap,
  type StepFinding,
} from "../loop.js";
import { verifyContracts } from "./verify.js";
import { canonCity } from "../place.js";

export type Thought = {
  intent: string;
  deliverables: DeliverableId[];
  why: string;
  next?: AgentStep;
  ask?: string;
  propose?: string;
  synthesize?: boolean;
};

function usedStepIds(findings: StepFinding[]): Set<string> {
  return new Set(findings.filter((f) => f.ok).map((f) => f.step.id));
}

/** 对照缺块挑一手。排除的块不查；用户说先做的优先。启发式兜底用。 */
export function suggestNextStep(goal: AgentGoal, findings: StepFinding[]): AgentStep | undefined {
  const verdict = verifyContracts(goal, findings);
  const excluded = new Set(goal.known.exclude || []);
  const prefer = goal.known.prefer || [];
  const missing = verdict.missing.filter((id) => id !== "answer" && !excluded.has(id));
  if (!missing.length) return undefined;
  const hasItineraryFinding = findings.some((f) => f.ok && f.step.covers.includes("itinerary"));
  const actionable = missing.filter((id) => id !== "itinerary");
  const first =
    prefer.find((id) => missing.includes(id)) ||
    (missing.includes("itinerary") && !hasItineraryFinding && !actionable.length
      ? "itinerary"
      : undefined) ||
    actionable[0];
  if (!first) return undefined;
  const used = usedStepIds(findings);
  const catalog = compileHands(goal);
  const hit = catalog.find((s) => s.covers.includes(first) && !used.has(s.id));
  if (hit) return hit;
  const city = goal.known.cities?.[0] || "";
  const tag = [goal.known.audience, goal.known.cheaper ? "便宜" : ""].filter(Boolean).join(" ");
  if (first === "itinerary") {
    return {
      id: `search_read-itinerary-${findings.length}`,
      cap: "search_read",
      label: `查 ${city || ""} 行程`.trim(),
      covers: ["itinerary"],
      query: `${city} ${tag} 行程 路线`.trim(),
      city,
    };
  }
  const label =
    first === "food"
      ? `查 ${city || ""} 餐厅`.trim()
      : first === "sights"
        ? `查 ${city || ""} 景点`.trim()
        : `补上${first}`;
  return {
    id: `explore-${first}-${findings.length}`,
    cap: "act",
    label,
    covers: [first],
    query: city
      ? `${city} ${label} ${tag} ${goal.raw.slice(0, 24)}`.trim()
      : `${goal.raw} —— 只要补上这一块：${first}`,
  };
}

export function nextThought(input: {
  intent: string;
  goal: AgentGoal;
  findings: StepFinding[];
  state: string;
  ask?: string;
  synthesized?: string;
  nudge?: AgentStep;
}): Thought {
  const dels = input.goal.deliverables.filter((d) => d.required).map((d) => d.id);
  const base = {
    intent: input.intent,
    deliverables: dels,
    why: input.goal.approach,
  };
  if (input.state === "blocked") {
    return { ...base, ask: input.ask || input.goal.ask || "还缺一项才能动手。", why: "合法空槽未齐。" };
  }
  if (input.state === "propose") {
    return { ...base, propose: input.goal.approach, why: "省名拆城是假设，先给你看。" };
  }
  const verdict = verifyContracts(input.goal, input.findings, { synthesized: input.synthesized });
  if (verdict.complete) {
    return { ...base, synthesize: true, why: "交付物已齐，汇总。" };
  }
  const seen = new Set(input.findings.map((f) => f.step.id));
  let next =
    (input.nudge && !seen.has(input.nudge.id) ? input.nudge : undefined) ||
    suggestNextStep(input.goal, input.findings);
  // answer-only 单：suggestNextStep 把 answer 当兜底过滤了，这里手动挑一只 cover answer 的手
  if (!next && !verdict.complete) {
    const answerHand = compileHands(input.goal).find(
      (s) => s.covers.includes("answer") && !seen.has(s.id),
    );
    if (answerHand) next = answerHand;
  }
  if (!next) {
    return { ...base, synthesize: true, why: verdict.notes };
  }
  return {
    ...base,
    next,
    why: input.nudge && next.id === input.nudge.id ? `换个查法：${next.label}` : `${verdict.notes}。下一步：${next.label}`,
  };
}

/**
 * 解析模型输出的下一步。模型自由表达 next/ask/synthesize。
 * 接受 {next:{cap,covers,query,city,site,label,why}} 或顶层平铺字段。
 * 不再强制"从菜单挑"——合法性校验留给 applyModelPick。
 */
export function parseReasonerJson(raw: string): {
  cap?: string;
  covers?: string[];
  query?: string;
  city?: string;
  site?: string;
  label?: string;
  why?: string;
  ask?: string;
  synthesize?: boolean;
} | null {
  const m = String(raw || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as {
      next?: { cap?: string; covers?: unknown; query?: string; city?: string; site?: string; label?: string; why?: string };
      cap?: string;
      covers?: unknown;
      query?: string;
      city?: string;
      site?: string;
      label?: string;
      why?: string;
      ask?: string;
      synthesize?: boolean;
    };
    const nx = j.next || {};
    const cap = String(nx.cap || j.cap || "");
    const coversRaw = Array.isArray(nx.covers) ? nx.covers : Array.isArray(j.covers) ? j.covers : [];
    const ask = j.ask ? String(j.ask) : undefined;
    const synthesize = j.synthesize === true;
    if (!cap && !ask && !synthesize) return null;
    return {
      cap: cap || undefined,
      covers: coversRaw.map((c) => String(c)),
      query: nx.query || j.query,
      city: nx.city || j.city,
      site: nx.site || j.site,
      label: nx.label || j.label,
      why: j.why || nx.why ? String(j.why || nx.why) : undefined,
      ask,
      synthesize,
    };
  } catch {
    return null;
  }
}

/**
 * 把模型挑的下一步套上最小校验：cap ∈ LOOP_CAP_SET、covers ⊆ DELIVERABLE_IDS。
 * 模型说 ask：透传（模型是大脑，由它判断要不要问用户，本地不二次拦截）。
 * 模型说 synthesize：透传（交给契约层验收）。
 * 模型给非法 cap 或空 covers：退回启发式兜底。
 */
export function applyModelPick(
  heuristic: Thought,
  pick: ReturnType<typeof parseReasonerJson>,
): Thought {
  if (!pick) return heuristic;
  if (pick.synthesize) {
    return { ...heuristic, synthesize: true, next: undefined, why: pick.why || heuristic.why };
  }
  if (pick.ask) {
    return { ...heuristic, ask: pick.ask, next: undefined, why: pick.why || "模型判断需要问用户。" };
  }
  const cap = pick.cap || "";
  if (!isLegalCap(cap)) return heuristic;
  const covers = filterLegalCovers(pick.covers || []);
  if (!covers.length) return heuristic;
  const city = pick.city ? canonCity(pick.city) || "" : "";
  const next: AgentStep = {
    id: `${cap}-${covers.join("-")}-${(pick.label || city || pick.query || "").replace(/\s+/g, "").slice(0, 20)}`,
    cap: cap as LoopCap,
    label: pick.label || covers.join("、"),
    covers,
    query: pick.query?.slice(0, 80),
    city: city || undefined,
    site: pick.site,
  };
  return { ...heuristic, next, why: pick.why || `${heuristic.why}。模型选了 ${next.label}` };
}

/**
 * 给模型完整上下文：已做、还缺、可用的手（作为信息而非约束）。
 * 模型自己决定下一步，不再从菜单里挑。
 */
export function reasonerPromptV2(goal: AgentGoal, findings: StepFinding[]): string {
  const seen = findings
    .map((f) => `${f.ok ? "完成" : "失败"} ${f.step.cap} ${f.step.label} → ${(f.text || "").slice(0, 60)}`)
    .join("\n");
  const verdict = verifyContracts(goal, findings);
  const catalog = compileHands(goal);
  return [
    "你是 Sparo 的大脑。看见已做的和还缺的，自己决定下一步用哪只手。",
    "原则：",
    "- 不要把任务推回给用户。能动手就动手。除非真缺合法空槽（出发地、日期、人数等），才输出 ask。",
    "- 交付物都齐了就输出 synthesize: true。",
    "- cap 只能用：trip_plan / hotel_search / flight_search / train_search / search_read / video_search / read_page / fill_form / mission / feishu / run_skill / reply_draft / print / navigate / act / synthesize。",
    "- covers 用交付物 id：stay food sights itinerary flights trains report page form video answer。",
    "- site 只能用：酒店 ctrip/tuniu/booking/airbnb，机票 ctrip/qunar/kayak/gflights，检索 baidu/bing，火车 12306/ctrip。用户点名的站不要换。",
    "- search_read 的 query 用用户原话里的主题词（城市 + 原话主题），不要替换成别的商品、行业或关联词（用户说「展览」就搜展览，不要搜成礼品展/博览会）。",
    `目标：${goal.intent}`,
    `原话：${goal.raw}`,
    `必须交付：${goal.deliverables.map((d) => d.id).join("、")}`,
    `已知：${JSON.stringify(goal.known)}`,
    seen ? `已观察到：\n${seen}` : "还没有观察。",
    `还缺：${verdict.missing.join("、") || "（都齐了，可汇总）"}`,
    `可用的手（参考，不是约束）：${catalog.map((s) => `${s.cap}(${s.covers.join(",")})`).join(" / ")}`,
    '只输出 JSON：{"next":{"cap":"...","covers":["stay"],"query":"...","city":"...","site":"...","label":"..."},"why":"..."} 或 {"synthesize":true,"why":"..."} 或 {"ask":"还缺X才能动手","why":"..."}',
  ].join("\n");
}

/** 有模型时让模型决定下一步；失败或启发式已 ask/propose/synthesize 就走兜底。 */
export async function nextThoughtAsync(
  input: {
    intent: string;
    goal: AgentGoal;
    findings: StepFinding[];
    state: string;
    ask?: string;
    synthesized?: string;
    nudge?: AgentStep;
  },
  complete?: (prompt: string) => Promise<string>,
): Promise<Thought> {
  const heuristic = nextThought(input);
  if (!complete || heuristic.ask || heuristic.propose || heuristic.synthesize || !heuristic.next) {
    return heuristic;
  }
  try {
    const parsed = parseReasonerJson(await complete(reasonerPromptV2(input.goal, input.findings)));
    const modelThought = applyModelPick(heuristic, parsed);
    // 模型选了 trip_plan / mission / run_skill 但 step 里缺执行数据
    //（applyModelPick 不带 trip/mission/action）→ 从 compileHands 里补
    const ns = modelThought.next;
    if (ns && ns.cap === "trip_plan" && !ns.trip) {
      const hand = compileHands(input.goal).find((s) => s.cap === "trip_plan");
      if (hand?.trip) ns.trip = hand.trip;
    }
    if (ns && ns.cap === "mission" && !ns.mission) {
      const hand = compileHands(input.goal).find((s) => s.cap === "mission");
      if (hand?.mission) ns.mission = hand.mission;
    }
    if (ns && ns.cap === "run_skill" && !ns.action) {
      const hand = compileHands(input.goal).find((s) => s.cap === "run_skill");
      if (hand?.action) ns.action = hand.action;
    }
    return modelThought;
  } catch {
    return heuristic;
  }
}
