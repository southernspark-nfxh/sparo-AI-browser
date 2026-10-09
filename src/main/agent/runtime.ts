/**
 * 工作单运行时：入句分类 → 开单/续跑/补槽/取消。
 * 这是侧栏唯一的脑。模型只许补充已知槽，不许选 ask。
 */
import { canonCity, findCities, findRegion, isCity } from "./place.js";
import { wantsFillForm, wantsPublish, wantsReply, wantsSummarize } from "./intent-router.js";
import { parseLocalIntent } from "./stub.js";
import { parseTripPlan, type TripPlan } from "./trip-plan.js";
import type { Brief, Ingest, IngestKind, MissionState, SlotId } from "./types.js";
import { slotAsk } from "./types.js";
import {
  analyzeSlots,
  classifyKind,
  isCancelText,
  isConfirmText,
  isConfusionText,
  isModifyCue,
  isNewTripTopic,
  isPauseText,
  isResumeText,
  isReviseText,
  looksLikeTripAsk,
} from "./slots.js";
import {
  analyzeGoal,
  analyzeGoalHeuristic,
  compileHands,
  goalToBrief,
  sealWorkOrder,
  type AgentGoal,
  type AgentStep,
  type StepFinding,
} from "./loop.js";

export type ActiveMission = {
  id: string;
  raw: string;
  goal: AgentGoal;
  plan: AgentStep[];
  findings: StepFinding[];
  state: MissionState;
  blockedSlot?: SlotId;
  ask?: string;
  /** 观察后组合出的下一步，只用现有的手。 */
  nudge?: AgentStep;
};

export type TurnEffect = "ask" | "propose" | "run" | "chat" | "cancel" | "pause" | "resume";

export type TurnResult = {
  effect: TurnEffect;
  mission: ActiveMission | null;
  last?: ActiveMission | null;
  side?: ActiveMission;
  say: string;
  ingest: IngestKind;
};

export type TurnCtx = {
  active?: ActiveMission | null;
  last?: ActiveMission | null;
  homeCity?: string;
  now?: Date;
  page?: { url?: string; title?: string };
  paused?: boolean;
};

function newId(): string {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function lastBrief(m?: ActiveMission | null): Brief | undefined {
  return m ? goalToBrief(m.goal) : undefined;
}

function openFromGoal(goal: AgentGoal, homeCity?: string): ActiveMission {
  let sealed = sealWorkOrder(goal, { homeCity });
  // 无论走不走 propose，act 态的 trip 只要 known 里有城+起止日期，就确定性补建行程结构，
  // 否则会退化成通用 8 步散手循环（多城行程拿不到手册）。
  if (sealed.decision === "act" && sealed.kind === "trip" && !sealed.plan?.cities?.length) {
    const trip = ensureTripPlan(sealed, new Date());
    if (trip) sealed = { ...sealed, plan: trip };
  }
  const plan = compileHands(sealed);
  if (sealed.decision === "chat") {
    return {
      id: newId(),
      raw: sealed.raw,
      goal: sealed,
      plan: [],
      findings: [],
      state: "done",
    };
  }
  if (sealed.decision === "ask") {
    return {
      id: newId(),
      raw: sealed.raw,
      goal: sealed,
      plan,
      findings: [],
      state: "blocked",
      blockedSlot: sealed.blockedSlot,
      ask: sealed.ask || slotAsk(sealed.blockedSlot || "destination"),
    };
  }
  if (sealed.decision === "propose") {
    return {
      id: newId(),
      raw: sealed.raw,
      goal: sealed,
      plan,
      findings: [],
      state: "propose",
    };
  }
  let hands = plan.length
    ? plan
    : compileHands(sealed).length
      ? compileHands(sealed)
      : [];
  // answer-only（搜天气/搜XX 这类检索问答）没编出任何手时，补一只 search_read 兜底，query 用原话
  const needsAnswer = sealed.deliverables.some((d) => d.id === "answer" && d.required);
  const hasAnswerHand = hands.some((s) =>
    ["search_read", "read_page", "navigate", "reply_draft", "video_search"].includes(s.cap),
  );
  if (needsAnswer && !hasAnswerHand) {
    hands = [
      ...hands,
      {
        id: `search_read-answer-${sealed.raw.replace(/\s+/g, "").slice(0, 16)}`,
        cap: "search_read" as const,
        label: `查：${sealed.raw.slice(0, 20)}`,
        covers: ["answer" as const],
        query: sealed.raw.slice(0, 80),
        site: "baidu" as const,
      },
    ];
  }
  const local = !hands.length ? parseLocalIntent(sealed.raw) : null;
  if (local?.type === "reply") {
    return {
      id: newId(),
      raw: sealed.raw,
      goal: { ...sealed, decision: "chat", say: local.text },
      plan: [],
      findings: [],
      state: "done",
    };
  }
  return {
    id: newId(),
    raw: sealed.raw,
    goal: { ...sealed, handbook: hands.length ? hands : sealed.handbook },
    plan: hands,
    findings: [],
    state: "running",
  };
}

function effectOf(m: ActiveMission): TurnEffect {
  if (m.state === "blocked") return "ask";
  if (m.state === "propose") return "propose";
  if (m.state === "cancelled") return "cancel";
  if (m.goal.decision === "chat") return "chat";
  return "run";
}

function sayOf(m: ActiveMission): string {
  if (m.state === "blocked") return m.ask || m.goal.ask || "还缺一项才能动手。";
  if (m.state === "propose") return `打算这样做：${m.goal.approach}`;
  if (m.goal.decision === "chat") return m.goal.say || "好。";
  return m.goal.approach;
}

export function classifyIngest(
  text: string,
  active?: ActiveMission | null,
  last?: ActiveMission | null,
  opts?: { paused?: boolean },
): Ingest {
  const t = text.trim();
  if (isPauseText(t)) return { kind: "protocol_pause" };
  if (isResumeText(t)) return { kind: "protocol_resume" };
  if (/^继续[吧啊]?$/.test(t)) {
    if (opts?.paused) return { kind: "protocol_resume" };
    if (active && (active.state === "blocked" || active.state === "propose" || active.state === "running" || active.state === "waiting_human")) {
      return { kind: "continue" };
    }
    return { kind: "protocol_resume" };
  }
  if (isCancelText(t) && active && active.state !== "done") return { kind: "cancel" };

  const open =
    active &&
    (active.state === "blocked" ||
      active.state === "propose" ||
      active.state === "running" ||
      active.state === "waiting_human");

  const side =
    wantsSummarize(t) ||
    /总结当前页|读这一页|读这页|这一页|这是什么网站/.test(t) ||
    wantsFillForm(t) ||
    wantsReply(t) ||
    wantsPublish(t) ||
    /把当前页打印|打印这一页|^打印$/.test(t);
  if (open && side) return { kind: "side" };

  // 等人（登录墙/验证/点不动）时，只有对卡点的回答、继续、取消还算这件事
  if (open && active.state === "waiting_human") {
    const helpAnswer =
      /^(有弹窗|弹层|换入口|换个入口|先登录|要登录|先不管|跳过|不管|是|对|要|需要|否|不是|不用|没有)[。.!！,，]?/.test(t) ||
      /登录|登陆|sign\s?in|login/i.test(t) ||
      isConfirmText(t);
    if (!helpAnswer && !isCancelText(t) && !/^继续/.test(t)) {
      // 同域长句（如给发布任务补内容）仍归这单按 amend 吸收；跨域才是新题
      const nextKindW = classifyKind(t, goalToBrief(active.goal));
      if (nextKindW !== active.goal.kind) return { kind: "new" };
      if (t.length > 12) return { kind: "amend" };
      return { kind: "new" };
    }
  }

  if (open) {
    if (isReviseText(t)) return { kind: "revise" };
    if (isConfirmText(t)) return { kind: "confirm" };
    const asCity = canonCity(t.replace(/^从/, "").replace(/出发$/, ""));
    if (asCity && isCity(asCity) && t.length <= 12 && active.state === "blocked") {
      return { kind: "slot_fill", city: asCity };
    }
    if (isConfusionText(t)) return { kind: "continue" };
    if (isNewTripTopic(t, goalToBrief(active.goal))) return { kind: "new" };
    if (isModifyCue(t, goalToBrief(active.goal)) || isModifyCue(t, lastBrief(last))) {
      return { kind: "amend" };
    }
    // 阻塞问城时，回复是同类的完整重述且带了城（「纽约两天住加吃加景点加行程」）→ 用原话整句重开，城和块都不丢
    if (active.state === "blocked" && active.blockedSlot === "destination" && t.length > 12) {
      const cityHit = findCities(t).map(canonCity).find((c) => isCity(c));
      if (cityHit && classifyKind(t, goalToBrief(active.goal)) === active.goal.kind) {
        return { kind: "new" };
      }
    }
    // 跨域（kind 不同）→ 开新事。chat 也算跨域（搜天气/搜XX 是检索，不是对前单的续跑）；
    // 但 trip/eatplay/travel/control 互转可能是同一件事的不同面，先当续跑让模型判。
    const nextKind = classifyKind(t, goalToBrief(active.goal));
    if (
      nextKind !== active.goal.kind &&
      nextKind !== "control" &&
      nextKind !== "trip" &&
      nextKind !== "eatplay" &&
      nextKind !== "travel"
    ) {
      return { kind: "new" };
    }
    // 短句有行程意图但缺城（「我打算去玩两天」「玩两天」），不能继承 active 的城 → 开新事让模型问城
    const tripCue = looksLikeTripAsk(t) || /玩\s*[一二三四五六七八九十两\d]+\s*[天周晚]|去\s*玩|打算\s*玩|旅游|自由行|行程/.test(t);
    const hasCity = (findCities(t).length > 0) || Boolean(findRegion(t));
    if (tripCue && !hasCity) {
      return { kind: "new" };
    }
    return { kind: "continue" };
  }

  const prev = last && last.state !== "cancelled" ? last : null;
  if (prev) {
    if (isModifyCue(t, lastBrief(prev))) return { kind: "amend" };
    const slots = analyzeSlots(t, { last: lastBrief(prev) });
    if (slots.attach === "last") return { kind: "amend" };
    if (isNewTripTopic(t, lastBrief(prev)!)) return { kind: "new" };
  }
  return { kind: "new" };
}

function analyzeSync(text: string, ctx: TurnCtx, confirmed?: boolean): AgentGoal {
  return analyzeGoalHeuristic(text, {
    homeCity: ctx.homeCity,
    now: ctx.now,
    last: lastBrief(ctx.active) || lastBrief(ctx.last),
    confirmed,
  });
}

function reopen(text: string, ctx: TurnCtx, confirmed?: boolean, inherit?: ActiveMission | null): ActiveMission {
  const base = inherit || ctx.active || ctx.last || undefined;
  const goal = analyzeSync(text, { ...ctx, last: base || ctx.last }, confirmed);
  const opened = openFromGoal(goal, ctx.homeCity);
  if (base && opened.state === "running") opened.id = base.id;
  return opened;
}

/**
 * 从大脑的 goal.known 确定性补建 TripPlan（纯执行结构，不改任何判断）。
 * 模型推荐的城市在 goal.known.cities 里，必须原样保留；日期/站点能从原话解析到就沿用。
 */
function ensureTripPlan(goal: AgentGoal, now: Date): TripPlan | undefined {
  if (goal.plan?.cities?.length) return goal.plan;
  const k = goal.known;
  if (!k.cities?.length || !k.start) return undefined;
  const fromRaw = parseTripPlan(goal.raw, now);
  const endDate = k.end || fromRaw?.endDate;
  if (!endDate) return undefined;
  const origin = k.origin || fromRaw?.origin || "";
  // 出发地不能混进目的地（模型偶尔会在 cities 里重复 origin，导致「北京 → 北京 → …」）
  const cities = k.cities.filter((c, i) => c && c !== origin && k.cities!.indexOf(c) === i);
  if (!cities.length) return undefined;
  return {
    origin,
    cities,
    startDate: k.start,
    endDate,
    flightSite: fromRaw?.flightSite || "ctrip",
    hotelSite: fromRaw?.hotelSite || "ctrip",
    hotelPriceMax: k.hotelPriceMax ?? fromRaw?.hotelPriceMax,
    hotelMinRating: k.hotelMinRating ?? fromRaw?.hotelMinRating,
    extras: fromRaw?.extras,
  };
}

/**
 * 人确认了大脑的 propose：把模型已存的 goal 直接转 act 开工。
 * 不重新分析原话——goal 的 kind/城市/日期/交付物都是模型判好的，
 * 再用本地 heuristic 重判一遍，长行程句会被误判成「直接回答」。
 */
function acceptProposal(active: ActiveMission, homeCity?: string, now: Date = new Date()): ActiveMission {
  let sealed = sealWorkOrder({ ...active.goal, needsConfirm: false }, { homeCity });
  // trip 缺执行结构时，从大脑已判的 known 补建（不重新理解原话）。
  if (sealed.kind === "trip" && !sealed.plan?.cities?.length) {
    const trip = ensureTripPlan(sealed, now);
    if (trip) sealed = { ...sealed, plan: trip };
  }
  // sealed 现在是 act 态：重新编译双手（propose 时只编了散手，act 才会产出 trip_plan 等整手）。
  // compileHands 只是把大脑的 goal 落成可执行步骤，不是重新分析原话。
  const plan = compileHands(sealed);
  const state: ActiveMission["state"] =
    sealed.decision === "act"
      ? "running"
      : sealed.decision === "ask"
        ? "blocked"
        : sealed.decision === "chat"
          ? "done"
          : "propose";
  return {
    ...active,
    goal: { ...sealed, handbook: plan.length ? plan : sealed.handbook },
    plan,
    findings: active.findings || [],
    state,
    blockedSlot: sealed.blockedSlot,
    ask: sealed.ask,
  };
}

export function applyTurn(text: string, ctx: TurnCtx = {}): TurnResult {
  const ingest = classifyIngest(text, ctx.active, ctx.last, { paused: ctx.paused });

  if (ingest.kind === "protocol_pause") {
    return { effect: "pause", mission: ctx.active || null, last: ctx.last, say: "已暂停，人可接管。", ingest: ingest.kind };
  }
  if (ingest.kind === "protocol_resume") {
    return { effect: "resume", mission: ctx.active || null, last: ctx.last, say: "已恢复 Agent 操控。", ingest: ingest.kind };
  }
  if (ingest.kind === "cancel" && ctx.active) {
    const mission = { ...ctx.active, state: "cancelled" as const };
    return { effect: "cancel", mission, last: mission, say: "好，这张单取消了。", ingest: ingest.kind };
  }

  if (ingest.kind === "side") {
    const side = openFromGoal(analyzeSync(text, { ...ctx, active: undefined, last: undefined }), ctx.homeCity);
    return {
      effect: effectOf(side) === "run" || effectOf(side) === "chat" ? effectOf(side) : "run",
      mission: ctx.active || null,
      last: ctx.last,
      side,
      say: sayOf(side),
      ingest: ingest.kind,
    };
  }

  if (ingest.kind === "revise" && ctx.active) {
    return {
      effect: "ask",
      mission: {
        ...ctx.active,
        state: "blocked",
        ask: "想改出发地、城市还是日期？说一项就行。",
        blockedSlot: ctx.active.blockedSlot || "destination",
      },
      last: ctx.last,
      say: "想改出发地、城市还是日期？说一项就行。",
      ingest: ingest.kind,
    };
  }

  if (ingest.kind === "confirm" && ctx.active) {
    if (ctx.active.state === "propose") {
      // 人确认了大脑的提案：直接把模型已存的 goal 转 act 开工，绝不重新分析原话。
      const opened = acceptProposal(ctx.active, ctx.homeCity, ctx.now);
      return { effect: effectOf(opened), mission: opened, last: ctx.last, say: sayOf(opened), ingest: ingest.kind };
    }
    if (ctx.active.blockedSlot === "origin_confirm") {
      const opened = reopen(ctx.active.raw, ctx, true, ctx.active);
      return { effect: effectOf(opened), mission: opened, last: ctx.last, say: sayOf(opened), ingest: ingest.kind };
    }
    const resealed = sealWorkOrder(ctx.active.goal, { homeCity: ctx.homeCity });
    if (resealed.decision === "act") {
      const opened = { ...ctx.active, goal: resealed, plan: compileHands(resealed), state: "running" as const };
      return { effect: "run", mission: opened, last: ctx.last, say: sayOf(opened), ingest: ingest.kind };
    }
    return {
      effect: "ask",
      mission: ctx.active,
      last: ctx.last,
      say: resealed.ask || ctx.active.ask || slotAsk(ctx.active.blockedSlot || "origin", ctx.homeCity),
      ingest: ingest.kind,
    };
  }

  if (ingest.kind === "slot_fill" && ctx.active && ingest.city) {
    const merged =
      ctx.active.blockedSlot === "origin" || ctx.active.blockedSlot === "origin_confirm"
        ? `${ctx.active.raw} 从${ingest.city}出发`
        : `${ctx.active.raw} ${ingest.city}`;
    const opened = reopen(merged, ctx, true, ctx.active);
    return { effect: effectOf(opened), mission: opened, last: ctx.last, say: sayOf(opened), ingest: ingest.kind };
  }

  if (ingest.kind === "continue" && ctx.active) {
    if (ctx.active.state === "propose") {
      // 等同确认：用已存 goal 直接开工，不重新分析原话。
      const opened = acceptProposal(ctx.active, ctx.homeCity, ctx.now);
      return { effect: effectOf(opened), mission: opened, last: ctx.last, say: sayOf(opened), ingest: ingest.kind };
    }
    if (ctx.active.state === "waiting_human" || ctx.active.state === "running") {
      return {
        effect: "run",
        mission: { ...ctx.active, state: "running", ask: undefined },
        last: ctx.last,
        say: "接着做。",
        ingest: ingest.kind,
      };
    }
    const resealed = sealWorkOrder(
      { ...ctx.active.goal, needsConfirm: false },
      { homeCity: ctx.homeCity },
    );
    if (resealed.decision === "act") {
      const opened = {
        ...ctx.active,
        goal: resealed,
        plan: compileHands(resealed),
        state: "running" as const,
        ask: undefined,
        blockedSlot: undefined,
      };
      return { effect: "run", mission: opened, last: ctx.last, say: sayOf(opened), ingest: ingest.kind };
    }
    return {
      effect: resealed.decision === "propose" ? "propose" : "ask",
      mission: {
        ...ctx.active,
        goal: resealed,
        state: resealed.decision === "propose" ? "propose" : "blocked",
        ask: resealed.ask,
        blockedSlot: resealed.blockedSlot,
      },
      last: ctx.last,
      say:
        resealed.decision === "propose"
          ? `打算这样做：${resealed.approach}`
          : resealed.ask || slotAsk(resealed.blockedSlot || "origin", ctx.homeCity),
      ingest: ingest.kind,
    };
  }

  if (ingest.kind === "amend") {
    const inherit = ctx.active && ctx.active.state !== "done" ? ctx.active : ctx.last;
    const opened = reopen(text, { ...ctx, last: inherit }, false, inherit);
    return { effect: effectOf(opened), mission: opened, last: ctx.last, say: sayOf(opened), ingest: ingest.kind };
  }

  const opened = openFromGoal(analyzeSync(text, ctx), ctx.homeCity);
  return { effect: effectOf(opened), mission: opened, last: ctx.last, say: sayOf(opened), ingest: ingest.kind };
}

export async function applyTurnAsync(
  text: string,
  ctx: TurnCtx,
  complete?: (prompt: string) => Promise<string>,
  configDir?: string,
): Promise<TurnResult> {
  const ingest = classifyIngest(text, ctx.active, ctx.last, { paused: ctx.paused });
  const needModel = ingest.kind === "new" || ingest.kind === "amend";
  if (!complete || !needModel) return applyTurn(text, ctx);

  const inherit = ingest.kind === "amend"
    ? ctx.active && ctx.active.state !== "done"
      ? ctx.active
      : ctx.last
    : undefined;
  const goal = await analyzeGoal(
    inherit && ingest.kind === "amend" ? text : text,
    {
      homeCity: ctx.homeCity,
      now: ctx.now,
      last: lastBrief(inherit) || lastBrief(ctx.last),
      page: ctx.page,
    },
    complete,
    configDir,
  );
  const opened = openFromGoal(goal, ctx.homeCity);
  if (inherit && opened.state === "running") opened.id = inherit.id;
  return { effect: effectOf(opened), mission: opened, last: ctx.last, say: sayOf(opened), ingest: ingest.kind };
}

export function missionBriefKind(m: ActiveMission | null | undefined): string | undefined {
  return m?.goal.kind;
}
