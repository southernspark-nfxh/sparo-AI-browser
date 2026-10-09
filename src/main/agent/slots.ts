/**
 * 槽位表：从原话抠已知/未知。不是大脑，不能决定问还是做。
 */
import {
  canonCity,
  findCities,
  findRegion,
  isCity,
  isNotPlace,
  isRegion,
  regionCities,
} from "./place.js";
import { parseTripPlan, tripDesignExtras, type TripPlan } from "./trip-plan.js";
import {
  addDays,
  detectFlightSite,
  detectHotelSite,
  isTripPlanQuery,
  looksLikeTripDesign,
  parseLooseCheckin,
  parseRelativeDate,
  parseTravelQuery,
  ymd,
} from "./travel.js";
import { looksLikeEatPlayAsk, looksLikeResearchAsk } from "./research-report.js";
import { wantsFillForm, wantsPublish, wantsSummarize } from "./intent-router.js";
import type { Brief, BriefKind, BriefKnown, SlotId } from "./types.js";
import {
  extractFacts,
  extractHotelConstraints,
  extractCityChange,
  extractEndDate,
  isConstraintTurn,
  parseStayDays,
  type ExtractedFacts,
} from "./extract.js";

export { extractHotelConstraints, extractFacts, isConstraintTurn, parseStayDays } from "./extract.js";

export const SAMPLE_YUNNAN_ASK =
  "你好 我打算去云南旅游 时间是七天 请帮我规划旅游的路线 包含机票酒店 9月20日出发 9月28日回到";

export type SlotSnapshot = {
  kind: BriefKind;
  need: string;
  known: BriefKnown;
  unknown: SlotId[];
  needsConfirm: boolean;
  ask?: string;
  approach: string;
  attach: "last" | "new";
  plan?: TripPlan;
};

export function looksLikeTripAsk(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (looksLikeTripDesign(t) || isTripPlanQuery(t)) return true;
  if (/旅游|行程|规划|自由行|日游|几日/.test(t) && /机票|酒店|出发|回来|回到|路线/.test(t)) return true;
  if ((findRegion(t) || findCities(t).length) && parseStayDays(t) >= 1 && /玩|旅游|去|自由行/.test(t)) {
    return true;
  }
  if (
    /机票/.test(t) &&
    /酒店/.test(t) &&
    (findRegion(t) || /去[\u4e00-\u9fff]{2,8}玩|玩\s*[一二三四五六七八九十两\d]+\s*[天周晚]|一周|几天/.test(t))
  ) {
    return true;
  }
  // 模糊出行意图（无城无日期）→ trip 分诊，destination unknown → 问城，不直接搜
  if (/出去走走|出去转转|想出去|出去散心|出去放松|想旅游|想去旅游|想出去玩|想出去逛逛/.test(t)) return true;
  return false;
}

export function isConfirmText(text: string): boolean {
  return /^(按这个做|就这个|就这样|可以|好的?|行|确认|开始(做|吧)?|是的?)$/i.test(text.trim());
}

export function isReviseText(text: string): boolean {
  return /^(改|不要|重来|换一个)$/i.test(text.trim());
}

export function isCancelText(text: string): boolean {
  return /^(取消|算了|不做了|停止任务|关掉)$/.test(text.trim());
}

export function isConfusionText(text: string): boolean {
  const t = text.trim();
  return (
    /^[?？]+$/.test(t) ||
    /你有啥困惑|你在问什么|还缺什么|缺哪一项|你怎么不[做干]|你在干嘛|为什么不[做开始]/.test(t)
  );
}

export function isPauseText(text: string): boolean {
  return /暂停|接管|^pause$/i.test(text.trim());
}

export function isResumeText(text: string): boolean {
  const t = text.trim();
  return /恢复\s*Agent|恢复操控|^resume$/i.test(t);
}

export function wantsOrigin(text: string): boolean {
  return /机票|航班|出发|往返|飞往|飞回|回国/.test(text);
}

export function extractOrigin(text: string): string | null {
  const from = text.match(/从([\u4e00-\u9fffA-Za-z]{2,12})出发/);
  if (from) return canonCity(from[1]);
  const back = text.match(/回到([\u4e00-\u9fffA-Za-z]{2,8})/);
  const cities = findCities(text);
  if (back) {
    const home = canonCity(back[1]);
    if (home && cities.filter((c) => c !== home).length) return home;
  }
  return null;
}


function extractGoPlace(text: string): { region?: string; city?: string; raw?: string } {
  const region = findRegion(text);
  if (region) return { region };
  const m = text.match(/去([\u4e00-\u9fff]{2,8})/);
  if (!m) return {};
  const raw = m[1].replace(/玩.*$/, "").replace(/旅[游行].*$/, "").replace(/自由行.*$/, "");
  if (raw.length < 2 || isNotPlace(raw)) return {};
  if (isRegion(raw)) return { region: raw };
  const city = canonCity(raw);
  if (city) return { city };
  return { raw };
}

function extractReturnDate(text: string, start: string, now: Date): string | null {
  return extractEndDate(text, start, now) ?? null;
}

function constraintText(c: { hotelPriceMax?: number; hotelMinRating?: number }): string {
  const bits = [
    c.hotelPriceMax ? `≤${c.hotelPriceMax}元` : "",
    c.hotelMinRating ? `评分≥${c.hotelMinRating}` : "",
  ].filter(Boolean);
  return bits.length ? `酒店${bits.join("、")}` : "";
}

export function classifyKind(text: string, last?: Brief): BriefKind {
  const t = text.trim();
  if (isPauseText(t) || isResumeText(t) || /^继续[吧啊]?$/.test(t)) return "control";
  if (looksLikeTripAsk(t) || looksLikeTripDesign(t)) return "trip";
  if (looksLikeEatPlayAsk(t) && !looksLikeResearchAsk(t)) return "eatplay";
  if (
    last &&
    (last.kind === "trip" || last.kind === "eatplay") &&
    (last.known.cities?.length || last.plan?.cities?.length) &&
    t.length <= 24 &&
    /那边|当地|这几座|沿途|怎么样|还有呢|然后呢/.test(t) &&
    !/机票|酒店|比价|筛选|打开|总结/.test(t)
  ) {
    return "eatplay";
  }
  if (/机票|车票|火车票|酒店/.test(t) && !parseTravelQuery(t)) return "trip";
  if (wantsSummarize(t) || /总结|这一页|这是什么网站|读这一页|读这页|页面摘要/.test(t)) {
    return "page";
  }
  if (wantsFillForm(t)) return "form";
  if (wantsPublish(t) || /发小红书|发布小红书/.test(t)) return "publish";
  if (looksLikeResearchAsk(t) && !(looksLikeTripAsk(t) || looksLikeTripDesign(t))) return "research";
  if (parseTravelQuery(t)) return "travel";
  return "chat";
}

function tripSlots(
  text: string,
  opts?: { homeCity?: string; now?: Date; confirmed?: boolean; last?: Brief },
): SlotSnapshot {
  const t = text.trim();
  const now = opts?.now || new Date();
  const clue = parseTripPlan(t, now);
  const go = extractGoPlace(t);
  const region = go.region || findRegion(t);
  const named = findCities(t);
  let origin = extractOrigin(t);
  if (!origin && clue?.origin && isCity(clue.origin)) origin = clue.origin;
  if (!origin && named.length === 1 && /出发|从/.test(t) && isCity(named[0])) origin = named[0];

  const destCities = named.filter((c) => c !== origin);
  if (go.city && go.city !== origin && !destCities.includes(go.city)) destCities.unshift(go.city);

  const lastTrip = opts?.last?.kind === "trip" ? opts.last : undefined;
  const modifyCue =
    Boolean(lastTrip) &&
    !region &&
    named.length === 0 &&
    !go.city &&
    (isConstraintTurn(t, lastTrip) ||
      /重新|再帮|再来|换|改成|改一下|调整|筛选|酒店|继续|这趟|那个/.test(t));
  if (modifyCue && lastTrip && !origin) {
    origin = lastTrip.known.origin || lastTrip.plan?.origin || null;
  }
  const inheritedStart =
    modifyCue && lastTrip ? lastTrip.known.start || lastTrip.plan?.startDate || "" : "";
  const inheritedEnd =
    modifyCue && lastTrip ? lastTrip.known.end || lastTrip.plan?.endDate || "" : "";
  const inheritedCities =
    modifyCue && lastTrip
      ? (lastTrip.known.cities || lastTrip.plan?.cities || []).filter(Boolean)
      : [];
  const inheritedRegion = modifyCue ? lastTrip?.known.region : undefined;
  const textConstraints = extractHotelConstraints(t);
  const constraints = {
    hotelPriceMax:
      textConstraints.hotelPriceMax ?? (modifyCue ? lastTrip?.known.hotelPriceMax : undefined),
    hotelMinRating:
      textConstraints.hotelMinRating ?? (modifyCue ? lastTrip?.known.hotelMinRating : undefined),
  };

  const start =
    (clue && isCity(clue.origin || "") ? clue.startDate : null) ||
    parseLooseCheckin((t.match(/(\d{1,2}\s*月\s*\d{1,2}\s*[日号]?)/) || [])[1] || "", now) ||
    parseRelativeDate(t, now) ||
    clue?.startDate ||
    inheritedStart ||
    "";
  const explicitEnd = start ? extractReturnDate(t, start, now) : null;
  const stay = parseStayDays(t);
  const stayEnd = start && stay ? addDays(start, Math.max(1, stay - 1)) : "";
  const end =
    explicitEnd ||
    (clue && clue.endDate > (start || "") ? clue.endDate : "") ||
    stayEnd ||
    inheritedEnd ||
    "";

  const unknown: SlotId[] = [];
  const home = opts?.homeCity && isCity(opts.homeCity) ? canonCity(opts.homeCity) : null;
  const needOrigin = wantsOrigin(t);

  if (!origin && needOrigin) {
    if (home && !opts?.confirmed) unknown.push("origin_confirm");
    else if (home && opts?.confirmed) origin = home;
    else unknown.push("origin");
  }
  if (
    !region &&
    !inheritedRegion &&
    destCities.length === 0 &&
    inheritedCities.length === 0 &&
    !go.raw &&
    !clue?.cities?.length
  ) {
    unknown.push("destination");
  }

  const cities =
    destCities.length > 0
      ? destCities
      : region
        ? regionCities(region)
        : inheritedCities.length
          ? inheritedCities
          : (clue?.cities || []).filter((c) => isCity(c) && c !== origin);
  const effRegion = region || inheritedRegion;
  const needsConfirm = Boolean(region && destCities.length < 2 && !opts?.confirmed && !modifyCue);
  const startEff =
    start || (looksLikeTripDesign(t) && unknown.length === 0 ? addDays(ymd(now), 1) : "");

  let ask: string | undefined;
  if (unknown[0] === "origin") ask = "从哪座城出发？";
  else if (unknown[0] === "origin_confirm" && home) ask = `按${home}出发可以吗？`;
  else if (unknown[0] === "destination") ask = "想去哪座城或哪个省？";

  const approachBits = [
    origin ? `从${origin}出发` : needOrigin ? "先定出发城市" : "当地安排，不涉及往返机票",
    region
      ? `${region}按${(regionCities(region) || cities).join("、")}分住（假设，你可改）`
      : go.raw
        ? `去${go.raw}`
        : cities.length
          ? `途经${cities.join("、")}`
          : "",
    startEff && end
      ? `${startEff} 出发、${end} 回，不以「几天」覆盖原话日期`
      : startEff
        ? `${startEff} 出发`
        : "",
    constraintText(constraints),
  ].filter(Boolean);

  const known: BriefKnown = {
    origin: origin || undefined,
    region: effRegion || undefined,
    cities: cities.length ? cities : undefined,
    start: startEff || undefined,
    end: end || undefined,
    hotelPriceMax: constraints.hotelPriceMax,
    hotelMinRating: constraints.hotelMinRating,
  };

  const ready = unknown.length === 0 && (Boolean(origin) || !needOrigin) && (cities.length > 0 || Boolean(effRegion));
  let plan: TripPlan | undefined;
  if (ready && cities.length && startEff && (!needsConfirm || opts?.confirmed)) {
    const stayN = parseStayDays(t);
    const endDate =
      end || clue?.endDate || (stayN ? addDays(startEff, Math.max(1, stayN)) : addDays(startEff, 2));
    known.end = known.end || endDate;
    plan = {
      origin: origin || "",
      cities,
      startDate: startEff,
      endDate,
      flightSite: detectFlightSite(t, origin || "", cities[0]),
      hotelSite: detectHotelSite(t),
      hotelPriceMax: constraints.hotelPriceMax,
      hotelMinRating: constraints.hotelMinRating,
      extras: tripDesignExtras(t, cities),
    };
  }

  return {
    kind: "trip",
    need: effRegion ? `${effRegion}自由行` : "行程安排",
    known,
    unknown,
    needsConfirm,
    ask,
    approach: approachBits.join("；") || "先把出发地和日期说清。",
    attach: modifyCue ? "last" : "new",
    plan,
  };
}

function eatPlaySlots(text: string, last?: Brief): SlotSnapshot {
  const named = findCities(text);
  const region = findRegion(text);
  const fromLast =
    last && (last.kind === "trip" || last.kind === "eatplay")
      ? last.known.cities || last.plan?.cities || []
      : [];
  const cities = named.length > 0 ? named : region ? regionCities(region) : fromLast.filter(Boolean);
  if (!cities.length) {
    return {
      kind: "eatplay",
      need: "吃的玩的推荐",
      known: { region: region || last?.known.region, origin: last?.known.origin },
      unknown: ["destination"],
      needsConfirm: false,
      ask: last?.kind === "trip" ? "上一趟行程里要哪座城的吃喝玩？" : "哪座城的吃的玩的？",
      approach: "先定哪座城，再查吃和玩。",
      attach: last?.kind === "trip" ? "last" : "new",
    };
  }
  return {
    kind: "eatplay",
    need: `${cities.join("、")} 吃喝玩`,
    known: {
      cities,
      region: region || last?.known.region,
      origin: last?.known.origin,
    },
    unknown: [],
    needsConfirm: false,
    approach: `按${cities.join("、")}查必吃和必去，不打开点评首页，不写成筛选报告。`,
    attach: fromLast.length && named.length === 0 ? "last" : "new",
  };
}

function attachFacts(snap: SlotSnapshot, facts: ExtractedFacts): SlotSnapshot {
  const cities = facts.cities.length ? facts.cities : snap.known.cities;
  const region = facts.region || snap.known.region;
  const unknown = snap.unknown.filter(
    (u) => !(u === "destination" && (cities?.length || region)),
  );
  let ask = snap.ask;
  if (!unknown.length) ask = undefined;
  else if (unknown[0] !== snap.unknown[0]) ask = undefined;
  return {
    ...snap,
    known: {
      ...snap.known,
      cities: cities?.length ? cities : undefined,
      region,
      origin: facts.origin || snap.known.origin,
      start: facts.start || snap.known.start,
      end: facts.end || snap.known.end,
      hotelPriceMax: facts.hotelPriceMax ?? snap.known.hotelPriceMax,
      hotelMinRating: facts.hotelMinRating ?? snap.known.hotelMinRating,
      exclude: facts.exclude.length ? facts.exclude : snap.known.exclude,
      prefer: facts.prefer.length ? facts.prefer : snap.known.prefer,
      audience: facts.audience || snap.known.audience,
      cheaper: facts.cheaper || snap.known.cheaper,
      hotelAvoid: facts.hotelAvoid.length ? facts.hotelAvoid : snap.known.hotelAvoid,
    },
    unknown,
    ask,
    attach: facts.inherited ? "last" : snap.attach,
  };
}

function emptySlots(kind: BriefKind, need: string, approach: string): SlotSnapshot {
  return {
    kind,
    need,
    known: {},
    unknown: [],
    needsConfirm: false,
    approach,
    attach: "new",
  };
}

/** 只填槽，不决定 ask/act。 */
export function analyzeSlots(
  text: string,
  opts?: { homeCity?: string; now?: Date; confirmed?: boolean; last?: Brief },
): SlotSnapshot {
  const t = text.trim();
  const last = opts?.last;
  const facts = extractFacts(t, { last, now: opts?.now });
  const kind = classifyKind(t, last);
  let snap: SlotSnapshot;
  if (kind === "eatplay") snap = eatPlaySlots(t, last);
  else if (kind === "trip") snap = tripSlots(t, opts);
  else if (kind === "page") snap = emptySlots("page", "读当前页", "用当前页正文回答，不新开无关网站。");
  else if (kind === "form") snap = emptySlots("form", "填表", "先分析当前页字段，再一次写入。");
  else if (kind === "publish") snap = emptySlots("publish", "发帖", "按发布技能整段写入，不循环 fill。");
  else if (kind === "control") snap = emptySlots("control", "暂停或恢复", "只改操控状态，不开新页。");
  else if (kind === "travel") {
    const q = parseTravelQuery(t, opts?.now);
    const city = q && "city" in q ? q.city : q && "to" in q ? q.to : "";
    snap = {
      kind: "travel",
      need: t.slice(0, 42),
      known: { cities: city && isCity(String(city)) ? [String(city)] : undefined },
      unknown: [],
      needsConfirm: false,
      approach: "打开结果页再读，不在首页空点。",
      attach: "new",
    };
  } else if (kind === "research") {
    snap = emptySlots("research", "对照调研", "多源对照后写成调研报告，不是吃喝玩筛选。");
  } else {
    snap = emptySlots("chat", t.slice(0, 42) || "对话", "按原话做事。");
  }
  return attachFacts(snap, facts);
}

export function isModifyCue(text: string, last?: Brief): boolean {
  if (!last) return false;
  if (isConstraintTurn(text, last)) return true;
  if (
    extractCityChange(text) &&
    (last.kind === "trip" || last.kind === "travel" || last.kind === "eatplay")
  ) {
    return true;
  }
  if (last.kind !== "trip" && last.kind !== "travel" && last.kind !== "eatplay") return false;
  const t = text.trim();
  return (
    !findRegion(t) &&
    findCities(t).length === 0 &&
    /重新|再帮|再来|换|改成|改一下|调整|筛选|酒店|继续|这趟|那个/.test(t)
  );
}

export function isNewTripTopic(text: string, current: Brief): boolean {
  if (extractCityChange(text)) return false;
  const next = analyzeSlots(text, {});
  if (next.attach === "last") return false;
  if (next.kind !== "trip" && next.kind !== "travel") return false;
  const newRegion = next.known.region;
  const oldRegion = current.known.region;
  if (newRegion && oldRegion && newRegion !== oldRegion) return true;
  const newCities = next.known.cities || [];
  const oldCities = current.known.cities || current.plan?.cities || [];
  if (newCities.length && oldCities.length && !newCities.some((c) => oldCities.includes(c))) {
    return looksLikeTripAsk(text) || wantsOrigin(text);
  }
  return false;
}
