/**
 * 交付物、计划、验收。不管入句，不管问人。
 */
import { canonCity, isCity, plausiblePlace } from "./place.js";
import { addDays } from "./travel.js";
import { parseMission, tripEatPlayMission, type Mission } from "./mission.js";
import { parseLocalIntent, type ChatAction } from "./stub.js";
import type { TripPlan } from "./trip-plan.js";
import type { Brief, BriefKind, SlotId } from "./types.js";
import { SLOT_LABEL, slotAsk } from "./types.js";
import { analyzeSlots, extractOrigin, wantsOrigin } from "./slots.js";
import { recallExperience } from "./experience.js";
import { extractFacts, isConstraintTurn, type ExtractedFacts } from "./extract.js";
import type { KnownBlock } from "./types.js";
import { understand, understandLocal } from "./brain/understand.js";
import type { PlanStep } from "./brain/understand.js";
import { understandPrompt } from "./brain/understand.js";

export const DELIVERABLE_IDS = [
  "stay",
  "food",
  "sights",
  "itinerary",
  "flights",
  "trains",
  "report",
  "page",
  "form",
  "video",
  "answer",
] as const;

export type DeliverableId = (typeof DELIVERABLE_IDS)[number];

export type Deliverable = {
  id: DeliverableId;
  label: string;
  required: boolean;
};

export type AgentGoal = {
  raw: string;
  intent: string;
  kind: BriefKind;
  deliverables: Deliverable[];
  known: Brief["known"];
  unknown: string[];
  blockedSlot?: SlotId;
  needsConfirm?: boolean;
  decision: "ask" | "propose" | "act" | "chat";
  ask?: string;
  approach: string;
  say?: string;
  attach?: "last" | "new";
  plan?: TripPlan;
  /** 模型在 understand 阶段编的手（mergePlan 把 PlanStep[] 转成 AgentStep[] 后填入）。 */
  handbook?: AgentStep[];
};

export type LoopCap =
  | "trip_plan"
  | "hotel_search"
  | "flight_search"
  | "train_search"
  | "search_read"
  | "video_search"
  | "read_page"
  | "fill_form"
  | "mission"
  | "feishu"
  | "run_skill"
  | "reply_draft"
  | "print"
  | "navigate"
  | "act"
  | "synthesize";

/** LoopCap 的运行时集合，供 mergePlan 校验模型编的 cap 合法。与 LoopCap 类型保持同步。 */
export const LOOP_CAP_SET = new Set<string>([
  "trip_plan",
  "hotel_search",
  "flight_search",
  "train_search",
  "search_read",
  "video_search",
  "read_page",
  "fill_form",
  "mission",
  "feishu",
  "run_skill",
  "reply_draft",
  "print",
  "navigate",
  "act",
  "synthesize",
]);

export type AgentStep = {
  id: string;
  cap: LoopCap;
  label: string;
  covers: DeliverableId[];
  query?: string;
  city?: string;
  from?: string;
  to?: string;
  date?: string;
  checkin?: string;
  checkout?: string;
  trip?: TripPlan;
  mission?: Mission;
  action?: ChatAction;
  /** 合法站点表里的站。用户点名则锁死。 */
  site?: string;
};

export type StepFinding = {
  step: AgentStep;
  text: string;
  url: string;
  ok: boolean;
  doc?: { title: string; path: string; kind?: string };
};

export type VerifyResult = {
  complete: boolean;
  covered: DeliverableId[];
  missing: DeliverableId[];
  notes: string;
};

const LABEL: Record<DeliverableId, string> = {
  stay: "住宿",
  food: "餐厅",
  sights: "景点",
  itinerary: "日程",
  flights: "机票",
  trains: "车票",
  report: "对照报告",
  page: "读懂当前页",
  form: "填表",
  video: "视频",
  answer: "直接回答",
};

const CUES: Record<DeliverableId, RegExp> = {
  stay: /酒店|宾馆|住宿|民宿|hotel|每晚|入住|客房/i,
  food: /餐厅|美食|必吃|料理|餐馆|小吃|米其林|restaurant|cafe/i,
  sights: /景点|博物馆|公园|海滩|必去|乐园|观景|步行|打卡/i,
  itinerary: /第.?天|第一天|第二天|上午|下午|晚上|日程/,
  flights: /航班|机票|起飞|直飞|flight/i,
  trains: /车次|高铁|火车|G\d{1,4}|动车/,
  report: /对比|价格|推荐|评测|结论/,
  page: /.{60,}/,
  form: /已填|字段|草稿/,
  video: /视频|UP主|播放|youtube|bilibili|BV/i,
  answer: /.{20,}/,
};

function addDeliverable(out: Deliverable[], id: DeliverableId): void {
  if (out.some((d) => d.id === id)) return;
  out.push({ id, label: LABEL[id], required: true });
}

function allowed(id: DeliverableId, facts: ExtractedFacts): boolean {
  return !facts.exclude.includes(id as KnownBlock);
}

/** 听整句里每一件事。不再按第一个关键词定题。 */
export function inferDeliverables(text: string, facts?: ExtractedFacts): Deliverable[] {
  const f = facts || extractFacts(text);
  const heard = understandLocal(text);
  const out: Deliverable[] = [];
  for (const id of heard.deliverables) {
    if (!DELIVERABLE_IDS.includes(id as DeliverableId)) continue;
    if (id === "answer" && heard.deliverables.some((x) => x !== "answer")) continue;
    if (!allowed(id as DeliverableId, f) && id !== "page" && id !== "form" && id !== "video" && id !== "answer") {
      continue;
    }
    addDeliverable(out, id as DeliverableId);
  }
  if (!out.length) addDeliverable(out, "answer");
  return out;
}

export function kindFromDeliverables(ids: DeliverableId[]): BriefKind {
  if (ids.includes("page")) return "page";
  if (ids.includes("form")) return "form";
  if (
    ids.includes("itinerary") ||
    (ids.includes("stay") && (ids.includes("food") || ids.includes("sights") || ids.includes("flights")))
  ) {
    return "trip";
  }
  if (ids.includes("report") || ids.includes("video")) return "research";
  if (ids.includes("stay") || ids.includes("flights") || ids.includes("trains")) return "travel";
  if (ids.includes("food") || ids.includes("sights")) return "eatplay";
  return "chat";
}

function isChatty(text: string): boolean {
  return /^(嗯|好|谢谢|哈哈|ok|好的)[。.!！]?$/i.test(text.trim());
}

function legalSlots(goal: AgentGoal, homeCity?: string): SlotId[] {
  const t = goal.raw;
  const out: SlotId[] = [];
  if (wantsOrigin(t) && !goal.known.origin) {
    out.push(homeCity ? "origin_confirm" : "origin");
  }
  const needsDest =
    goal.kind === "trip" ||
    goal.kind === "eatplay" ||
    goal.deliverables.some((d) => ["stay", "food", "sights", "itinerary"].includes(d.id));
  if (needsDest && !goal.known.cities?.length && !goal.known.region) {
    out.push("destination");
  }
  return out;
}

/** 模型不能选 ask。只有空的合法槽能把单子打成 blocked。 */
export function sealWorkOrder(goal: AgentGoal, opts?: { homeCity?: string; chatty?: boolean }): AgentGoal {
  const chatty = opts?.chatty ?? isChatty(goal.raw);
  if (chatty) {
    return {
      ...goal,
      unknown: [],
      blockedSlot: undefined,
      decision: "chat",
      ask: undefined,
      needsConfirm: false,
      say: goal.say || "嗯。",
    };
  }
  const slots = legalSlots(goal, opts?.homeCity);
  if (slots.length) {
    const first = slots[0];
    return {
      ...goal,
      unknown: slots.map((s) => SLOT_LABEL[s]),
      blockedSlot: first,
      decision: "ask",
      ask:
        first === "origin_confirm" && goal.ask?.includes("按")
          ? goal.ask
          : slotAsk(first, opts?.homeCity),
      needsConfirm: false,
    };
  }
  if (goal.needsConfirm) {
    return {
      ...goal,
      unknown: [],
      blockedSlot: undefined,
      decision: "propose",
      ask: undefined,
    };
  }
  return {
    ...goal,
    unknown: [],
    blockedSlot: undefined,
    decision: "act",
    ask: undefined,
  };
}

function restoreWants(last: Brief, facts: ExtractedFacts): Deliverable[] {
  if (facts.only && facts.prefer.length) {
    const only: Deliverable[] = [];
    for (const id of facts.prefer) {
      if (DELIVERABLE_IDS.includes(id as DeliverableId)) addDeliverable(only, id as DeliverableId);
    }
    return only;
  }
  const out: Deliverable[] = [];
  for (const id of last.wants || []) {
    if (DELIVERABLE_IDS.includes(id as DeliverableId) && allowed(id as DeliverableId, facts)) {
      addDeliverable(out, id as DeliverableId);
    }
  }
  for (const id of facts.prefer) {
    if (DELIVERABLE_IDS.includes(id as DeliverableId) && allowed(id as DeliverableId, facts)) {
      addDeliverable(out, id as DeliverableId);
    }
  }
  return out;
}

export function analyzeGoalHeuristic(
  text: string,
  ctx?: { homeCity?: string; now?: Date; last?: Brief; confirmed?: boolean },
): AgentGoal {
  const facts = extractFacts(text, { last: ctx?.last, now: ctx?.now });
  const slots = analyzeSlots(text, ctx);
  const constraint = Boolean(ctx?.last && isConstraintTurn(text, ctx.last));
  let deliverables =
    constraint && ctx?.last?.wants?.length ? restoreWants(ctx.last, facts) : inferDeliverables(text, facts);
  if (!deliverables.length) deliverables = inferDeliverables(text, facts);
  const ids = deliverables.map((d) => d.id);
  let kind = slots.kind;
  if (constraint && ctx?.last) kind = ctx.last.kind;
  else {
    const derived = kindFromDeliverables(ids);
    if (derived !== "chat") kind = derived;
  }
  const known = {
    ...slots.known,
    cities: slots.known.cities?.length && !facts.inherited
      ? slots.known.cities
      : facts.cities.length
        ? facts.cities
        : slots.known.cities,
    region: facts.region || slots.known.region,
    origin: facts.origin || slots.known.origin,
    start: facts.start || slots.known.start,
    end: facts.end || slots.known.end,
    hotelPriceMax: facts.hotelPriceMax ?? slots.known.hotelPriceMax,
    hotelMinRating: facts.hotelMinRating ?? slots.known.hotelMinRating,
    exclude: facts.exclude.length ? facts.exclude : slots.known.exclude,
    prefer: facts.prefer.length ? facts.prefer : slots.known.prefer,
    audience: facts.audience || slots.known.audience,
    cheaper: facts.cheaper || slots.known.cheaper,
    hotelAvoid: facts.hotelAvoid.length ? facts.hotelAvoid : slots.known.hotelAvoid,
  };
  const goal: AgentGoal = {
    raw: text,
    intent: slots.need || `${deliverables.map((d) => d.label).join("、")}：${text.slice(0, 32)}`,
    kind,
    deliverables,
    known,
    unknown: slots.unknown.map((s) => SLOT_LABEL[s]),
    blockedSlot: slots.unknown[0],
    needsConfirm: slots.needsConfirm,
    decision: "act",
    approach: slots.approach,
    attach: slots.attach,
    plan: slots.plan,
  };
  return sealWorkOrder(goal, { homeCity: ctx?.homeCity, chatty: isChatty(text) });
}

export function parseAnalyzeJson(raw: string): Partial<AgentGoal> | null {
  const m = String(raw || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as Record<string, unknown>;
    const dels = Array.isArray(j.deliverables) ? j.deliverables : [];
    const deliverables: Deliverable[] = [];
    for (const d of dels) {
      const id = String((d as { id?: string }).id || "") as DeliverableId;
      if (!DELIVERABLE_IDS.includes(id)) continue;
      addDeliverable(deliverables, id);
    }
    const knownRaw = (j.known && typeof j.known === "object" ? j.known : {}) as Brief["known"];
    const cities = (knownRaw.cities || [])
      .map((c) => canonCity(String(c)) || "")
      .filter((c) => isCity(c));
    return {
      intent: String(j.intent || "").slice(0, 80),
      deliverables,
      known: { ...knownRaw, cities: cities.length ? cities : undefined },
      approach: j.approach ? String(j.approach) : undefined,
      say: j.say ? String(j.say) : undefined,
    };
  } catch {
    return null;
  }
}

/** 模型可以补充，但不能删交付物、不能加机票、不能改 decision。 */
export function mergeAnalyze(heuristic: AgentGoal, model: Partial<AgentGoal>): AgentGoal {
  const dels = [...heuristic.deliverables];
  const excluded = new Set(heuristic.known.exclude || []);
  for (const d of model.deliverables || []) {
    if (excluded.has(d.id as KnownBlock)) continue;
    if ((d.id === "flights" || d.id === "trains") && !heuristic.deliverables.some((h) => h.id === d.id)) {
      continue;
    }
    addDeliverable(dels, d.id);
  }
  // 大脑给的城市：词表内能规范就规范；景区/小城（喀纳斯、鼓浪屿、乌镇…）原样保留，
  // 本地尺子短不能把大脑选的目的地丢掉。
  const modelCities = model.known?.cities
    ?.map((c) => canonCity(c) || plausiblePlace(c) || "")
    .filter(Boolean);
  const cities = modelCities?.length ? modelCities : heuristic.known.cities;
  const rawOrigin = extractOrigin(heuristic.raw);
  const origin =
    heuristic.known.origin ||
    (rawOrigin && model.known?.origin && isCity(model.known.origin) ? model.known.origin : undefined);
  return sealWorkOrder({
    ...heuristic,
    intent: model.intent || heuristic.intent,
    deliverables: dels,
    kind: heuristic.kind === "trip" || heuristic.kind === "eatplay" ? heuristic.kind : kindFromDeliverables(dels.map((d) => d.id)),
    known: {
      ...heuristic.known,
      // 日期以本地从原话确定性听到的为准（耳朵的听写事实），本地没有才用模型补的
      start: heuristic.known.start || model.known?.start,
      end: heuristic.known.end || model.known?.end,
      hotelPriceMax: model.known?.hotelPriceMax ?? heuristic.known.hotelPriceMax,
      hotelMinRating: model.known?.hotelMinRating ?? heuristic.known.hotelMinRating,
      cities,
      origin,
      region: heuristic.known.region || model.known?.region,
      exclude: heuristic.known.exclude,
      prefer: heuristic.known.prefer,
      audience: heuristic.known.audience || model.known?.audience,
      cheaper: heuristic.known.cheaper || model.known?.cheaper,
      hotelAvoid: heuristic.known.hotelAvoid || model.known?.hotelAvoid,
    },
    approach: model.approach || heuristic.approach,
    say: model.say || heuristic.say,
  });
}

export function analyzePrompt(
  text: string,
  ctx?: { homeCity?: string; now?: Date; last?: Brief; page?: { url?: string; title?: string } },
  configDir?: string,
): string {
  const lessons = configDir ? recallExperience(configDir, text) : [];
  const brain = understandPrompt(text, ctx);
  if (!lessons.length) return brain;
  return `${brain}\n你以前做过：\n${lessons.map((l) => `- ${l.lesson}`).join("\n")}`;
}

export async function analyzeGoal(
  text: string,
  ctx: { homeCity?: string; now?: Date; last?: Brief; page?: { url?: string; title?: string }; confirmed?: boolean },
  complete?: (prompt: string) => Promise<string>,
  configDir?: string,
): Promise<AgentGoal> {
  const heuristic = analyzeGoalHeuristic(text, ctx);
  if (!complete) return heuristic;
  try {
    const heard = await understand(text, ctx, complete);
    const merged = mergeAnalyze(heuristic, {
      intent: heard.heard,
      deliverables: heard.deliverables
        .filter((id): id is DeliverableId => DELIVERABLE_IDS.includes(id as DeliverableId))
        .map((id) => ({ id, label: LABEL[id], required: true })),
      known: heard.known,
      approach: heard.clauses.map((c) => c.purpose).filter(Boolean).join("；"),
    });
    // 模型在 understand 阶段编了 plan：转成 AgentStep[] 写入 handbook，
    // compileHands 会优先用 handbook，否则走本地启发式 fallback。
    if (heard.plan && heard.plan.length > 0) {
      const handbook = mergePlan(merged, heard.plan);
      if (handbook.length > 0) return { ...merged, handbook };
    }
    return merged;
  } catch {
    /* 模型失败用本地理解 */
  }
  return heuristic;
}

function step(
  cap: LoopCap,
  label: string,
  covers: DeliverableId[],
  extra: Partial<AgentStep> = {},
): AgentStep {
  const tag = extra.city || extra.query || extra.mission?.kind || extra.trip?.origin || label;
  return {
    id: `${cap}-${covers.join("-")}-${String(tag).replace(/\s+/g, "").slice(0, 20)}`,
    cap,
    label,
    covers,
    ...extra,
  };
}

function isLocalTrip(goal: AgentGoal): boolean {
  return !goal.known.origin && !/机票|航班|往返|火车|高铁/.test(goal.raw);
}

function actionToSteps(action: ChatAction, goal: AgentGoal): AgentStep[] {
  if (action.type === "reply" || action.type === "pause") return [];
  if (action.type === "summarize") return [step("read_page", "读当前页", ["page"])];
  if (action.type === "fill_form") return [step("fill_form", "填表", ["form"])];
  if (action.type === "print") return [step("print", "打印", ["answer"], { action })];
  if (action.type === "travel_search") {
    if (action.kind === "hotel") {
      return [
        step("hotel_search", `查 ${action.city} 住宿`, ["stay"], {
          city: action.city,
          checkin: action.checkin,
          checkout: action.checkout,
        }),
      ];
    }
    if (action.kind === "flight") {
      return [
        step("flight_search", `查 ${action.from} → ${action.to} 机票`, ["flights"], {
          from: action.from,
          to: action.to,
          date: action.date,
        }),
      ];
    }
    if (action.kind === "train") {
      return [
        step("train_search", `查 ${action.from} → ${action.to} 车票`, ["trains"], {
          from: action.from,
          to: action.to,
          date: action.date,
        }),
      ];
    }
    return [step("act", "查路线", ["answer"], { query: goal.raw, action })];
  }
  if (action.type === "trip_plan") {
    return [step("trip_plan", "行程手册", ["itinerary"], { trip: action.plan })];
  }
  if (action.type === "mission") {
    return [step("mission", action.mission.title, ["report"], { mission: action.mission })];
  }
  if (action.type === "feishu") return [step("feishu", "飞书", ["answer"], { action })];
  if (action.type === "run_skill") {
    return [step("run_skill", action.query, ["form"], { action })];
  }
  if (action.type === "one_click_reply") {
    return [step("reply_draft", "写回复草稿", ["answer"], { action })];
  }
  if (action.type === "navigate") {
    return [step("navigate", action.note || "打开页面", ["answer"], { action })];
  }
  if (action.type === "act" || action.type === "llm") {
    return [step("act", "完成这句话", ["answer"], { query: action.type === "act" || action.type === "llm" ? action.text : goal.raw, action })];
  }
  return [step("act", "完成这句话", ["answer"], { query: goal.raw, action })];
}

/** 每块交付物至少有一步手盖住。合成步单独放在最后。 */
export function planForGoal(goal: AgentGoal): AgentStep[] {
  const city = goal.known.cities?.[0] || "";
  const start = goal.known.start || "";
  const end = goal.known.end || (start ? addDays(start, 2) : "");
  const origin = goal.known.origin || "";
  const ids = goal.deliverables.filter((d) => d.required).map((d) => d.id);
  const steps: AgentStep[] = [];
  if (ids.includes("page")) {
    steps.push(step("read_page", "读当前页", ["page"]));
  }
  if (ids.includes("form")) {
    steps.push(step("fill_form", "分析并填写当前表", ["form"]));
  }
  const extra = [goal.known.audience, goal.known.cheaper ? "便宜" : ""].filter(Boolean).join(" ");
  if (ids.includes("stay") && city) {
    steps.push(
      step("hotel_search", `查 ${city} 住宿`, ["stay"], {
        city,
        checkin: start,
        checkout: end,
      }),
    );
  }
  if (ids.includes("flights") && origin && city && start) {
    steps.push(
      step("flight_search", `查 ${origin} → ${city} 机票`, ["flights"], {
        from: origin,
        to: city,
        date: start,
      }),
    );
  }
  if (ids.includes("trains") && origin && city && start) {
    steps.push(
      step("train_search", `查 ${origin} → ${city} 车票`, ["trains"], {
        from: origin,
        to: city,
        date: start,
      }),
    );
  }
  if (ids.includes("food") && city) {
    steps.push(
      step("search_read", `查 ${city} 餐厅`, ["food"], {
        query: `${city} 必吃 餐厅 推荐 ${extra}`.trim(),
        city,
      }),
    );
  }
  if (ids.includes("sights") && city) {
    steps.push(
      step("search_read", `查 ${city} 景点`, ["sights"], {
        query: `${city} 必去景点 行程 ${extra}`.trim(),
        city,
      }),
    );
  }
  if (ids.includes("itinerary") && city && (goal.known.prefer?.includes("itinerary") || !ids.includes("stay"))) {
    steps.push(
      step("search_read", `查 ${city} 行程`, ["itinerary"], {
        query: `${city} ${extra} 两天 行程 路线`.trim(),
        city,
      }),
    );
  }
  if (ids.includes("video")) {
    const q = goal.raw.replace(/帮我|找|相关/g, "").slice(0, 24);
    steps.push(step("video_search", `找视频：${q}`, ["video"], { query: q }));
  }
  if (ids.includes("report")) {
    steps.push(step("search_read", "检索来源 A", ["report"], { query: goal.raw.slice(0, 40) }));
    steps.push(
      step("search_read", "检索来源 B", ["report"], { query: `${goal.raw.slice(0, 24)} 对比 推荐` }),
    );
  }
  return ensurePlanCovers(goal, steps).slice(0, 8);
}

/**
 * 模型在 understand 阶段编的 PlanStep[] → AgentStep[]。
 * 校验：cap ∈ LOOP_CAP_SET、covers ⊆ DELIVERABLE_IDS。site 不校验（留给 composeStep/caps 执行层）。
 * 模型乱编的 cap/covers 直接丢弃；空数组返回，调用方走 compileHands fallback。
 */
/** 校验模型编的 cap 合法：在 LOOP_CAP_SET 且不是 synthesize（synthesize 是终止信号不是手）。 */
export function isLegalCap(cap: string): boolean {
  return LOOP_CAP_SET.has(cap) && cap !== "synthesize";
}

/** 过滤合法交付物 id，丢掉模型编的非法值。 */
export function filterLegalCovers(covers: string[]): DeliverableId[] {
  return covers
    .filter((c) => (DELIVERABLE_IDS as readonly string[]).includes(c))
    .map((c) => c as DeliverableId);
}

export function mergePlan(goal: AgentGoal, planSteps: PlanStep[]): AgentStep[] {
  const out: AgentStep[] = [];
  let i = 0;
  for (const s of planSteps) {
    const cap = String(s.cap || "");
    if (!isLegalCap(cap)) continue;
    const covers = filterLegalCovers(s.covers || []);
    if (!covers.length) continue;
    const city = s.city ? canonCity(s.city) || "" : "";
    const extra: Record<string, unknown> = {
      query: s.query?.slice(0, 80),
      city: city || undefined,
      site: s.site,
    };
    // 模型 plan 里如果选了 trip_plan，补上 trip 数据（和 nextThoughtAsync 一致）
    if (cap === "trip_plan" && goal.plan) extra.trip = goal.plan;
    out.push(
      step(cap as LoopCap, s.label || covers.map((c) => LABEL[c] || c).join("、"), covers, extra),
    );
    i++;
    if (i >= 8) break;
  }
  return out;
}

/** 工作单 → 手。混合需求并在一张单里，不再因第一个 kind 丢掉另一件事。 */
export function compileHands(goal: AgentGoal): AgentStep[] {
  // 多城行程的整合手册：模型散手 plan 里若漏了 trip_plan，由本地手补上 ——
  // 散手 flight_search 没有结构化 from/to/date，跑不出口径统一的逐日手册。
  if (goal.kind === "trip" && goal.plan?.cities?.length && !isLocalTrip(goal)) {
    const ids = goal.deliverables.filter((d) => d.required).map((d) => d.id);
    const tripCovers: DeliverableId[] = ["itinerary"];
    if (ids.includes("stay")) tripCovers.push("stay");
    if (ids.includes("flights")) tripCovers.push("flights");
    if (ids.includes("trains")) tripCovers.push("trains");
    if (ids.includes("food")) tripCovers.push("food");
    if (ids.includes("sights")) tripCovers.push("sights");
    const tripStep = step(
      "trip_plan",
      `行程手册 ${goal.known.origin || ""} → ${goal.plan.cities.join("、")}`,
      tripCovers,
      { trip: goal.plan },
    );
    if (goal.handbook && goal.handbook.length > 0) {
      if (goal.handbook.some((s) => s.cap === "trip_plan")) return goal.handbook;
      // 丢掉被整合手册完全覆盖的散手（散手机票/酒店），保留它额外要的（视频等）
      const rest = goal.handbook.filter((s) => s.covers.some((c) => !tripCovers.includes(c)));
      return [tripStep, ...rest].slice(0, 8);
    }
    return compileHeuristicHands(goal, ids, [tripStep]);
  }
  // 调研/比价报告：模型散手 plan 若漏了 mission 整手，由本地补上 ——
  // 散手 search_read 只读百度壳页，深读与对照表合成都在 mission 手里。
  const needReport = goal.deliverables.some((d) => d.required && d.id === "report");
  if (goal.handbook && goal.handbook.length > 0) {
    if (needReport && !goal.handbook.some((s) => s.cap === "mission")) {
      const m = parseMission(goal.raw);
      if (m) {
        const missionStep = step("mission", m.title, ["report"], { mission: m });
        return dedupeReportMissions([
          missionStep,
          ...goal.handbook.filter((s) => !s.covers.includes("report")),
        ]).slice(0, 8);
      }
    }
    return dedupeReportMissions(goal.handbook, !needReport);
  }
  const ids = goal.deliverables.filter((d) => d.required).map((d) => d.id);
  return compileHeuristicHands(goal, ids, []);
}

/**
 * 模型会把同一个调研目标编成多个重复 mission（实测同一标题编 7 个，每个 ~85s）。
 * 报告型目标只跑第一个 report mission；coverAll=true 时不去重（天气+调研等不同整手）。
 */
function dedupeReportMissions(hands: AgentStep[], coverAll = false): AgentStep[] {
  if (coverAll) return hands;
  let seenReportMission = false;
  return hands.filter((s) => {
    if (s.cap !== "mission" || !s.covers.includes("report")) return true;
    if (seenReportMission) return false;
    seenReportMission = true;
    return true;
  });
}

function compileHeuristicHands(goal: AgentGoal, ids: DeliverableId[], seed: AgentStep[]): AgentStep[] {
  if (goal.kind === "control") return seed;
  if (goal.kind === "page" || ids.includes("page")) {
    return [step("read_page", "读当前页", ["page"])];
  }
  if (goal.kind === "form" || goal.kind === "publish" || ids.includes("form")) {
    const local = parseLocalIntent(goal.raw);
    if (local.type === "run_skill") {
      return [step("run_skill", local.query, ["form"], { action: local })];
    }
    return [step("fill_form", "分析并填写当前表", ["form"])];
  }

  const onlyEat =
    goal.kind === "eatplay" &&
    Boolean(goal.known.cities?.length) &&
    ids.includes("food") &&
    ids.includes("sights") &&
    !ids.includes("itinerary") &&
    !ids.includes("stay") &&
    !ids.includes("report");
  if (onlyEat) {
    return [
      step("mission", `${goal.known.cities!.join("、")} 吃喝玩`, ["food", "sights"], {
        mission: tripEatPlayMission({ cities: goal.known.cities! }),
      }),
    ];
  }

  const out: AgentStep[] = [...seed];
  if (ids.includes("report")) {
    const m = parseMission(goal.raw);
    if (m) out.push(step("mission", m.title, ["report"], { mission: m }));
  }
  for (const s of planForGoal(goal)) {
    if (s.covers.includes("report") && out.some((x) => x.cap === "mission" && x.covers.includes("report"))) {
      continue;
    }
    if (out.some((x) => x.cap === "trip_plan" && s.covers.every((c) => x.covers.includes(c)))) {
      continue;
    }
    if (!out.some((x) => x.id === s.id)) out.push(s);
  }
  if (out.length) return out;
  return actionToSteps(parseLocalIntent(goal.raw), goal);
}

export function ensurePlanCovers(goal: AgentGoal, steps: AgentStep[]): AgentStep[] {
  const covered = new Set(steps.flatMap((s) => s.covers));
  const extra = adaptPlan(
    goal,
    goal.deliverables
      .filter((d) => d.required && !covered.has(d.id) && d.id !== "itinerary" && d.id !== "answer")
      .map((d) => d.id),
  );
  return [...steps, ...extra.filter((s) => !steps.some((x) => x.id === s.id))];
}

export function adaptPlan(goal: AgentGoal, missing: DeliverableId[]): AgentStep[] {
  const city = goal.known.cities?.[0] || "";
  const out: AgentStep[] = [];
  for (const id of missing) {
    if (id === "itinerary" || id === "answer") continue;
    if (id === "food" && city) {
      out.push(step("search_read", `补查 ${city} 餐厅`, ["food"], { query: `${city} 美食 餐厅 推荐`, city }));
    } else if (id === "sights" && city) {
      out.push(step("search_read", `补查 ${city} 景点`, ["sights"], { query: `${city} 景点 必去`, city }));
    } else if (id === "stay" && city) {
      out.push(step("hotel_search", `补查 ${city} 住宿`, ["stay"], { city }));
    } else if (id === "itinerary" && city) {
      out.push(step("search_read", `补查 ${city} 行程`, ["itinerary"], { query: `${city} 行程 路线`, city }));
    } else if (id === "report") {
      out.push(step("search_read", "补检索", ["report"], { query: goal.raw.slice(0, 30) }));
    }
  }
  return out;
}

export function findingCovers(finding: StepFinding, id: DeliverableId): boolean {
  if (!finding.ok || !finding.step.covers.includes(id)) return false;
  if (id === "itinerary" || id === "answer") return false;
  const text = finding.text || "";
  if (text.length < 8) return false;
  return CUES[id].test(text);
}

export function verifyProgress(
  goal: AgentGoal,
  findings: StepFinding[],
  opts?: { synthesized?: string },
): VerifyResult {
  const required = goal.deliverables.filter((d) => d.required).map((d) => d.id);
  const covered: DeliverableId[] = [];
  for (const id of required) {
    if (id === "itinerary" || id === "answer" || id === "report") {
      if (opts?.synthesized && CUES[id].test(opts.synthesized)) covered.push(id);
      else if (id === "report" && findings.filter((f) => findingCovers(f, "report")).length >= 1 && opts?.synthesized) {
        covered.push(id);
      } else if (id === "answer" && opts?.synthesized) covered.push(id);
      continue;
    }
    if (findings.some((f) => findingCovers(f, id))) covered.push(id);
  }
  const missing = required.filter((id) => !covered.includes(id));
  return {
    complete: missing.length === 0,
    covered,
    missing,
    notes: missing.length ? `还缺：${missing.map((id) => LABEL[id]).join("、")}` : "交付物已齐。",
  };
}

export function goalToBrief(goal: AgentGoal): Brief {
  return {
    need: goal.intent.slice(0, 42),
    kind: goal.kind,
    known: goal.known,
    unknown: goal.unknown,
    approach: goal.approach,
    ready: goal.decision === "act",
    needsConfirm: goal.decision === "propose",
    ask: goal.ask,
    attach: goal.attach,
    plan: goal.plan,
    wants: goal.deliverables.filter((d) => d.required).map((d) => d.id),
  };
}

export function goalProgress(goal: AgentGoal): string {
  const bits = goal.deliverables.filter((d) => d.required).map((d) => d.label);
  return `目标：${goal.intent}。要交付：${bits.join("、")}。`;
}

export function planProgress(steps: AgentStep[]): string {
  return `计划 ${steps.length} 步：${steps.map((s) => s.label).join(" → ")}`;
}

export function synthesizePrompt(goal: AgentGoal, findings: StepFinding[]): string {
  const blocks = findings
    .map((f, i) => `### ${i + 1}. ${f.step.label}\n网址：${f.url}\n${f.text.slice(0, 1600)}`)
    .join("\n\n");
  const must = goal.deliverables.filter((d) => d.required).map((d) => d.label);
  return [
    "把下面各步结果合成用户要的那一份东西。不要只复述其中一步。",
    `用户原话：${goal.raw}`,
    `必须交代：${must.join("、")}。缺的正文写「未知」，不要编。`,
    goal.kind === "trip"
      ? "行程类：写成每日上午/下午/晚上；酒店、餐厅、景点都用 [名称](链接)。没说出发地不要编往返机票。"
      : "写成给人看的清单：名称、链接、一句话理由。",
    "不要出现「大家还在搜」、广告、页脚。",
    blocks,
  ].join("\n");
}

export function reviewLesson(
  goal: AgentGoal,
  verify: VerifyResult,
  steps: AgentStep[],
): {
  cue: string;
  lesson: string;
} {
  const labels = goal.deliverables.filter((d) => d.required).map((d) => d.label);
  const caps = [...new Set(steps.map((s) => s.cap))].join("、");
  const cue = `${labels.join(" ")} ${goal.known.cities?.join(" ") || ""}`.trim();
  if (verify.complete) {
    return {
      cue,
      lesson: `这类目标交付物是${labels.join("、")}，按 ${caps} 做完再交，不能只做第一步。`,
    };
  }
  return {
    cue,
    lesson: `这次缺了${verify.missing.map((id) => LABEL[id]).join("、")}。下次先列交付物再动手，有字不能当验收通过。`,
  };
}
