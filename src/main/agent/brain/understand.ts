/**
 * Sparo 的脑：先听懂整句话里有几件事，再交手。
 * 对标 Hermes：分析器听原话，不按第一个关键词定题。
 * 本机理解器在没模型时顶上；有模型时模型先拆，这里只校正地点和合法槽。
 */
import {
  leftoverAfterOpen,
  wantsFillForm,
  wantsPublish,
  wantsSummarize,
} from "../intent-router.js";
import { extractFacts, blocksIn, type ExtractedFacts } from "../extract.js";
import { canonCity, isCity, plausiblePlace, regionCities } from "../place.js";
import type { Brief, BriefKnown, IngestKind, KnownBlock } from "../types.js";

export const HEARD_IDS = [
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

export type HeardId = (typeof HEARD_IDS)[number];

export type HeardClause = {
  text: string;
  purpose: string;
  deliverables: HeardId[];
};

/**
 * 模型在 understand 阶段编的「手」草稿。cap/covers 是字符串，
 * 合法性校验留给 loop.ts:mergePlan（避免 understand.ts 反向 import loop/kernel）。
 */
export type PlanStep = {
  cap: string;
  covers: string[];
  query?: string;
  city?: string;
  site?: string;
  label?: string;
};

export type Understanding = {
  heard: string;
  clauses: HeardClause[];
  deliverables: HeardId[];
  known: BriefKnown;
  leftover?: string;
  /** 模型编的手草稿；mergePlan 会转成 AgentStep 并校验合法性。 */
  plan?: PlanStep[];
  /** 模型判断的入句分类；本地只校验枚举合法。 */
  ingest?: string;
};

const CLAUSE_SPLIT = /[,，。；;]|顺便|还有呢?|以及|和附近|然后再/;

function uniqIds(ids: HeardId[]): HeardId[] {
  const out: HeardId[] = [];
  for (const id of ids) {
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

function purposeOf(ids: HeardId[], clause: string): string {
  if (ids.includes("report") && ids.includes("itinerary")) return "行程并对照";
  if (ids.includes("report")) return "对照 / 判断";
  if (ids.includes("itinerary")) return "行程";
  if (ids.includes("stay") && ids.includes("food")) return "住和吃";
  if (ids.includes("stay")) return "住宿";
  if (ids.includes("food")) return "餐厅";
  if (ids.includes("sights")) return "看点 / 展览";
  if (ids.includes("page")) return "读当前页";
  if (ids.includes("form")) return "填表";
  if (/打开|搜|查/.test(clause)) return "打开并接着做";
  return "原话要办的事";
}

function clauseIds(clause: string, facts: ExtractedFacts): HeardId[] {
  const t = clause.trim();
  if (!t) return [];
  const out: HeardId[] = [];
  const blocks = blocksIn(t);
  for (const id of blocks) out.push(id);
  if (/展览|展会|艺术展|有什么展|看展/.test(t) && !out.includes("sights")) out.push("sights");
  if (/能住|附近住|订附近/.test(t) && !out.includes("stay")) out.push("stay");
  if (/值不值得|适不适合|值得去|好不好去|旅行社报价/.test(t) && !out.includes("report")) {
    out.push("report");
  }
  if (/视频|跟练|UP主/.test(t) && !out.includes("video")) out.push("video");
  if (wantsSummarize(t) || /讲了什么|这页|当前页/.test(t)) out.push("page");
  if (wantsFillForm(t) || wantsPublish(t)) out.push("form");
  if (facts.exclude.length) {
    return out.filter((id) => !facts.exclude.includes(id as KnownBlock)) as HeardId[];
  }
  return uniqIds(out);
}

/** 把一句拆成并列需求，不丢掉「顺便」。 */
export function splitHeard(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  const leftover = leftoverAfterOpen(t);
  if (leftover) {
    const head = t.slice(0, Math.max(0, t.indexOf(leftover))).trim() || t;
    return [head, leftover].filter((s) => s.length >= 2);
  }
  const parts = t
    .split(CLAUSE_SPLIT)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
  return parts.length ? parts : [t];
}

function implyTrip(ids: HeardId[], facts: ExtractedFacts, text: string): HeardId[] {
  const out = [...ids];
  const place = Boolean(facts.region || facts.cities.length);
  const tripCue = /玩|旅游|去|自由行|日游|行程|规划/.test(text);
  if (facts.stayDays >= 1 && tripCue && !out.includes("itinerary") && !facts.exclude.includes("itinerary")) {
    out.push("itinerary");
  }
  if (
    place &&
    facts.stayDays >= 3 &&
    tripCue &&
    !out.includes("stay") &&
    !facts.exclude.includes("stay") &&
    !/只要/.test(text)
  ) {
    out.push("stay");
  }
  return uniqIds(out);
}

export function understandLocal(
  text: string,
  ctx?: { last?: Brief; now?: Date },
): Understanding {
  const t = text.trim();
  const facts = extractFacts(t, { last: ctx?.last, now: ctx?.now });
  const leftover = leftoverAfterOpen(t) || undefined;
  const rawParts = splitHeard(t);
  const clauses: HeardClause[] = rawParts.map((part) => {
    const deliverables = clauseIds(part, facts);
    return { text: part, purpose: purposeOf(deliverables, part), deliverables };
  });
  let deliverables = uniqIds(clauses.flatMap((c) => c.deliverables));
  if (facts.only && facts.prefer.length) {
    deliverables = facts.prefer.filter((id) => HEARD_IDS.includes(id as HeardId)) as HeardId[];
  } else {
    deliverables = implyTrip(deliverables, facts, t);
    const whole = clauseIds(t, facts);
    deliverables = uniqIds([...deliverables, ...whole]);
    deliverables = implyTrip(deliverables, facts, t);
  }
  if (!deliverables.length) deliverables = leftover ? ["answer"] : ["answer"];

  let cities = (facts.cities || []).map((c) => canonCity(c) || c).filter((c) => isCity(c));
  if (!cities.length && facts.region) cities = regionCities(facts.region);
  return {
    heard: clauses
      .map((c) => c.purpose)
      .filter(Boolean)
      .join("；") || t.slice(0, 42),
    clauses,
    deliverables,
    leftover,
    known: {
      cities: cities.length ? cities : undefined,
      region: facts.region,
      origin: facts.origin,
      start: facts.start,
      end: facts.end,
      hotelPriceMax: facts.hotelPriceMax,
      hotelMinRating: facts.hotelMinRating,
      exclude: facts.exclude.length ? facts.exclude : undefined,
      prefer: facts.prefer.length ? facts.prefer : undefined,
      audience: facts.audience,
      cheaper: facts.cheaper || undefined,
      hotelAvoid: facts.hotelAvoid.length ? facts.hotelAvoid : undefined,
    },
  };
}

/** Hermes 式：先列出每一件独立的事，禁止只报第一个关键词。 */
export function understandPrompt(
  text: string,
  ctx?: { homeCity?: string; now?: Date; last?: Brief; page?: { url?: string; title?: string } },
): string {
  const today = (ctx?.now || new Date()).toISOString().slice(0, 10);
  return [
    "你是 Sparo 的大脑。先听懂用户在说几件事，列要交什么；可选地编个 plan（怎么动手的草稿）。",
    `今天 ${today}。`,
    ctx?.homeCity ? `常住地：${ctx.homeCity}` : "常住地未设。",
    ctx?.page?.url ? `当前页：${ctx.page.title || ""} ${ctx.page.url}` : "",
    ctx?.last ? `上一件事：${ctx.last.need} ${JSON.stringify(ctx.last.known)}` : "",
    "规则：",
    "- 「顺便 / 还有 / 以及」是另一件事，不能丢掉。",
    "- 「打开某站，搜…」是打开 + 后半句，不是闲聊。",
    "- 「值不值得 / 适不适合」是判断调研，要 report。",
    "- 玩几天、日游、自由行：要 itinerary；超过三天且没说别查酒店，加上 stay。",
    "- 展览 / 展会算 sights。能住的 / 附近住算 stay。",
    "- 已经订了、别查、只要某块：尊重排除。",
    "- 原话出现的城市写入 known.cities。用户说「不知道去哪」「帮我规划」时，你应推荐合适的城市加入 known.cities——你是大脑，用户信你的判断。",
    "- known.start / known.end 一律用 YYYY-MM-DD，且都含当天：start 是出发日，end 是回程当天（不是前一天）。「10月26日到30日共5天」→ start=\"2026-10-26\"、end=\"2026-10-30\"（住4晚）；「30日回」也把 end 设为 30 日。「明年6月」按实际年份填。只说玩 N 天没说末日时 end=start+(N-1)。",
    "- 用户提到「飞机/航班/flight」加 flights；提到「高铁/火车/车票」加 trains。用户只问「怎么过去/什么交通」时，flights 和 trains 都加，让搜索结果决定最优方案。",
    "- ingest 是这句相对于上一件事的关系：new（新事）/ amend（改上一件）/ continue（接着跑）/ side（旁支）/ revise（修正）/ confirm（确认）/ slot_fill（填空）/ cancel / protocol_pause / protocol_resume。",
    "- ingest 判 new 的硬规则：用户提到上一件事里没有的城市或区域 → new；用户提到跟上一件完全不同的主题（如上一件是行程，这句是回评论/发小红书/总结当前页/比价/值不值得） → new；缺城的行程意图（「我打算去玩两天」） → new（不要继承上一件的城）。",
    "- ingest 判 amend 的条件：只改上一件的约束（更便宜/换城/改日期/排除某块）且没引入新主题。不满足就别判 amend。",
    "- plan 可选；要编就列 [{\"cap\":\"...\",\"covers\":[\"stay\"],\"query\":\"...\",\"city\":\"...\",\"site\":\"...\",\"label\":\"...\"}]。cap 只能用：trip_plan / hotel_search / flight_search / train_search / search_read / video_search / read_page / fill_form / mission / feishu / run_skill / reply_draft / print / navigate / act / synthesize。covers 用交付物 id。site 只能用：酒店 ctrip/tuniu/booking/airbnb，机票 ctrip/qunar/kayak/gflights，检索 baidu/bing，火车 12306/ctrip。用户点名的站不要换。",
    "- cap=navigate 时 query 放目标 URL（用户原话点名的 https://... 原样放进去）；cap=search_read 时 query 放搜索词。",
    "交付物 id 只能用：stay food sights itinerary flights trains report page form video answer",
    '只输出 JSON：{"heard":"一句话听懂了什么","ingest":"new","clauses":[{"text":"原句片段","purpose":"","deliverables":["stay"]}],"deliverables":["stay"],"known":{"cities":[]},"plan":[{"cap":"hotel_search","covers":["stay"],"query":"...","city":"...","site":"ctrip"}]}',
    `用户原话：${text}`,
  ]
    .filter(Boolean)
    .join("\n");
}

const INGEST_KINDS = new Set<string>([
  "protocol_pause",
  "protocol_resume",
  "cancel",
  "confirm",
  "revise",
  "slot_fill",
  "side",
  "continue",
  "amend",
  "new",
]);

export function parseUnderstandJson(raw: string): Partial<Understanding> | null {
  const m = String(raw || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as Record<string, unknown>;
    const asIds = (xs: unknown): HeardId[] =>
      (Array.isArray(xs) ? xs : [])
        .map((x) => {
          if (typeof x === "string") return x;
          return String((x as { id?: string }).id || "");
        })
        .filter((id): id is HeardId => HEARD_IDS.includes(id as HeardId));
    const clausesIn = Array.isArray(j.clauses) ? j.clauses : [];
    const clauses: HeardClause[] = clausesIn.map((c) => {
      const row = c as { text?: string; purpose?: string; deliverables?: unknown };
      const deliverables = asIds(row.deliverables);
      return {
        text: String(row.text || "").slice(0, 80),
        purpose: String(row.purpose || purposeOf(deliverables, String(row.text || ""))),
        deliverables,
      };
    });
    const knownRaw = (j.known && typeof j.known === "object" ? j.known : {}) as BriefKnown;
    // 大脑给的城市：能规范就规范；词表外的景区/小城（喀纳斯、鼓浪屿、乌镇…）也原样保留，
    // 不能因为本地尺子短就把大脑选的目的地丢掉。
    const cities = (knownRaw.cities || [])
      .map((c) => canonCity(String(c)) || plausiblePlace(String(c)) || "")
      .filter(Boolean);
    const planIn = Array.isArray(j.plan) ? j.plan : [];
    const plan: PlanStep[] = planIn
      .map((s) => {
        const row = s as { cap?: string; covers?: unknown; query?: string; city?: string; site?: string; label?: string };
        const covers = Array.isArray(row.covers) ? row.covers.map((c) => String(c)) : [];
        return {
          cap: String(row.cap || ""),
          covers,
          query: row.query ? String(row.query).slice(0, 80) : undefined,
          city: row.city ? String(row.city) : undefined,
          site: row.site ? String(row.site) : undefined,
          label: row.label ? String(row.label).slice(0, 40) : undefined,
        };
      })
      .filter((s) => s.cap && s.covers.length > 0);
    const ingestRaw = j.ingest ? String(j.ingest) : "";
    const ingest = INGEST_KINDS.has(ingestRaw) ? (ingestRaw as IngestKind) : undefined;
    return {
      heard: j.heard ? String(j.heard).slice(0, 80) : undefined,
      clauses,
      deliverables: asIds(j.deliverables).length ? asIds(j.deliverables) : uniqIds(clauses.flatMap((c) => c.deliverables)),
      known: { ...knownRaw, cities: cities.length ? cities : undefined },
      plan: plan.length ? plan : undefined,
      ingest,
    };
  } catch {
    return null;
  }
}

/**
 * 模型可以加需求，不能删本地已听出来的块，不能发明城。
 * flights/trains 只要原话说过机票/高铁/火车就允许加（产品死规则：不发明交付物）。
 * raw 可选；为空时退化为「模型加 flights/trains 一律丢」，保留旧行为兼容旧测试。
 */
export function mergeUnderstanding(
  local: Understanding,
  model: Partial<Understanding>,
  raw?: string,
): Understanding {
  const allowFlights = raw ? /机票|航班|flight/i.test(raw) : false;
  const allowTrains = raw ? /高铁|火车|车票|train/i.test(raw) : false;
  const extra = (model.deliverables || []).filter(
    (id) => (id !== "flights" || allowFlights) && (id !== "trains" || allowTrains),
  );
  const deliverables = uniqIds([...local.deliverables, ...extra]);
  // 大脑给的城市一律信任（解析时已做 canon/plausible 校验）；再排掉出发地和重复项，
  // 避免「北京 → 北京 → 乌鲁木齐」这种把出发地当目的地的路线。
  const originRaw: string | undefined =
    local.known.origin ||
    (model.known?.origin
      ? (canonCity(model.known.origin) || plausiblePlace(model.known.origin) || undefined)
      : undefined);
  const modelCities: string[] = (model.known?.cities || [])
    .map((c) => canonCity(c) || plausiblePlace(c) || c)
    .filter((c): c is string => Boolean(c) && c !== originRaw);
  const dedupCities = (xs: Array<string | null | undefined> | undefined): string[] => {
    const out: string[] = [];
    for (const x of xs || []) {
      if (x && x !== originRaw && !out.includes(x)) out.push(x);
    }
    return out;
  };
  return {
    heard: model.heard || local.heard,
    clauses: model.clauses?.length ? model.clauses : local.clauses,
    deliverables,
    leftover: local.leftover,
    plan: model.plan?.length ? model.plan : local.plan,
    ingest: model.ingest || local.ingest,
    known: {
      ...local.known,
      ...model.known,
      cities: dedupCities(modelCities.length ? modelCities : local.known.cities),
      origin: originRaw,
      // 日期是从原话确定性听出来的（区间/回程/相对日期），属于耳朵的听写事实，
      // 不让模型算术覆盖；本地没听到时才用模型补的。
      start: local.known.start || model.known?.start,
      end: local.known.end || model.known?.end,
      exclude: local.known.exclude,
      prefer: local.known.prefer,
    },
  };
}

export async function understand(
  text: string,
  ctx?: { homeCity?: string; now?: Date; last?: Brief; page?: { url?: string; title?: string } },
  complete?: (prompt: string) => Promise<string>,
): Promise<Understanding> {
  const local = understandLocal(text, ctx);
  if (!complete) return local;
  try {
    const parsed = parseUnderstandJson(await complete(understandPrompt(text, ctx)));
    if (parsed) return mergeUnderstanding(local, parsed, text);
  } catch {
    /* 模型失败用本地理解 */
  }
  return local;
}
