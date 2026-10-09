/**
 * 事实层：城、约束、极性（只要/别查/已经订）与 kind 无关。
 * 先抽这里，再派生交付物和工作单。分类门控抽槽是根因。
 */
import { canonCity, findCities, findRegion, isCity } from "./place.js";
import { addDays, parseLooseCheckin, parseRelativeDate } from "./travel.js";
import type { Brief, KnownBlock } from "./types.js";

export type ExtractedFacts = {
  cities: string[];
  region?: string;
  origin?: string;
  start?: string;
  end?: string;
  hotelPriceMax?: number;
  hotelMinRating?: number;
  audience?: string;
  cheaper?: boolean;
  hotelAvoid: string[];
  exclude: KnownBlock[];
  prefer: KnownBlock[];
  only: boolean;
  judgment: boolean;
  stayDays: number;
  inherited: boolean;
  retarget?: string;
};

const BLOCKS: { id: KnownBlock; re: RegExp }[] = [
  { id: "stay", re: /住宿|酒店|宾馆|民宿|住哪儿|住哪|住的|hotels?\b|stay\b/i },
  { id: "food", re: /餐厅|美食|吃的|吃饭|吃什么|餐馆|必吃|restaurants?\b|food\b/i },
  { id: "sights", re: /景点|观光|打卡|必去|玩的|玩什么|去哪玩|展览|展会|看展|有什么展|attractions?\b|sights?\b/i },
  { id: "itinerary", re: /路线|日程|行程|怎么排|怎么玩|设计一下|安排一下|安排全程|全程安排|每天(的)?安排|itinerary|plan\s+\d+\s+days/i },
  { id: "flights", re: /机票|航班|flights?\b/i },
  { id: "trains", re: /高铁|火车|车票|trains?\b/i },
  { id: "report", re: /对比|比价|调研|值不值得|适不适合/ },
];

const CN_DAYS: Record<string, number> = {
  一: 1,
  两: 2,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

export function blocksIn(text: string): KnownBlock[] {
  const hits: { id: KnownBlock; at: number }[] = [];
  for (const b of BLOCKS) {
    const m = b.re.exec(text);
    if (m && m.index >= 0) hits.push({ id: b.id, at: m.index });
    b.re.lastIndex = 0;
  }
  hits.sort((a, b) => a.at - b.at);
  return uniq(hits.map((h) => h.id));
}

export function parseStayDays(text: string): number {
  const m =
    text.match(/玩\s*([一二三四五六七八九十两\d]+)\s*[天晚]/) ||
    text.match(/([一二三四五六七八九十两\d]+)\s*日(?:游|行程)/) ||
    text.match(/([一二三四五六七八九十两\d]+)\s*天(?:行程|自由行|游)?/) ||
    text.match(/plan\s+(\d+)\s+days/i);
  if (!m) return 0;
  const raw = m[1];
  if (/^\d+$/.test(raw)) return Math.max(1, Math.min(30, Number(raw)));
  return CN_DAYS[raw] || 0;
}

export function extractHotelConstraints(text: string): {
  hotelPriceMax?: number;
  hotelMinRating?: number;
} {
  const t = String(text || "");
  const within = t.match(/(\d{2,5})\s*(?:块|元|块钱)?\s*(?:以[内下]|之内)/);
  const cap = t.match(/(?:不要超过|不超过|别超过|最多|最高|控制在)\s*(\d{2,5})/);
  const nightly = t.match(/(?:每晚|住一晚|一晚)\s*(\d{2,5})|(\d{2,5})\s*(?:块|元|块钱)\s*(?:每晚|一晚)/);
  const budget = t.match(/预算\s*(?:每晚)?\s*(\d{2,5})/);
  const rating = t.match(/(\d(?:\.\d+)?)\s*分\s*以上/);
  const hotelPriceMax = within
    ? Number(within[1])
    : cap
      ? Number(cap[1])
      : nightly
        ? Number(nightly[1] || nightly[2])
        : budget
          ? Number(budget[1])
          : undefined;
  return {
    hotelPriceMax,
    hotelMinRating: rating ? Number(rating[1]) : undefined,
  };
}

function extractOrigin(text: string): string | undefined {
  const t = String(text || "");
  // 「从北京出发」「北京出发」
  const from = t.match(/从?([\u4e00-\u9fffA-Za-z]{2,12})出发/);
  if (from) return canonCity(from[1]) || undefined;
  // 「订北京往返机票」「北京来回高铁」——城市紧贴往返/来回，只认词表内地名
  const rt = t.match(/([\u4e00-\u9fffA-Za-z]{2,8})(?:往返|来回)(?:机票|航班|飞机|高铁|火车|车票|的)?/);
  if (rt) return canonCity(rt[1]) || undefined;
  return undefined;
}

function isSoftNegation(text: string): boolean {
  return /超过|以内|之下|最多|最高|机场|附近|太贵|太远/.test(text);
}

function extractPolarity(text: string): {
  exclude: KnownBlock[];
  prefer: KnownBlock[];
  only: boolean;
} {
  const exclude: KnownBlock[] = [];
  const prefer: KnownBlock[] = [];
  let only = false;
  const clauses = text.split(/[,，。；;！!？?\n]|然后|再(?!帮)/);
  for (const raw of clauses) {
    const c = raw.trim();
    if (!c) continue;
    if (/只要/.test(c)) {
      only = true;
      const after = c.replace(/^[\s\S]*?只要/, "");
      const hit = blocksIn(after);
      prefer.push(...(hit.length ? hit : blocksIn(c)));
    }
    if (/已经订|订好了|不用找/.test(c)) {
      const hit = blocksIn(c);
      exclude.push(...(hit.length ? hit : (["stay"] as KnownBlock[])));
    }
    const negated =
      /(?:不要|别|不用|先别|别再)(?!超过)/.test(c) || /别查|不要查|不用查/.test(c);
    if (negated && !isSoftNegation(c)) {
      const hit = blocksIn(c);
      if (hit.length) exclude.push(...hit);
    }
    if (/先(?:告诉我|帮我|排|查|做|设计)/.test(c) && !/先别/.test(c)) {
      prefer.push(...blocksIn(c));
    }
  }
  return { exclude: uniq(exclude), prefer: uniq(prefer), only };
}

function extractHotelAvoid(text: string): string[] {
  const t = String(text || "");
  const out: string[] = [];
  if (/(?:不要|别|避开|别订|别住).{0,8}机场|机场.{0,4}(?:附近|店)/.test(t)) out.push("机场");
  return out;
}

/** 改成 / 换成 / 换到 后面的目的地。 */
export function extractCityChange(text: string): string | undefined {
  const m = String(text || "").match(
    /(?:改成|换成|换到|改去|改到)\s*([\u4e00-\u9fffA-Za-z·\-\s]{2,24})/,
  );
  if (!m) return undefined;
  const raw = m[1].replace(/[吧啊呀呢].*$/, "").replace(/的.*$/, "").trim();
  if (!raw) return undefined;
  return canonCity(raw) || findCities(raw)[0] || undefined;
}

function extractAudience(text: string): string | undefined {
  if (/带小孩|带孩子|亲子/.test(text)) return "亲子";
  if (/老人|长辈/.test(text)) return "老人";
  if (/情侣/.test(text)) return "情侣";
  if (/一个人|独自|单身/.test(text)) return "独自";
  return undefined;
}

/**
 * 回程/末日：从原话里确定性地听出 end（含当天）。
 * 覆盖：「10月26日到30日」区间（30日无月名，沿用上一个月）、「30日回/返回/回广州」、
 * 完整日期+回、句中晚于 start 的任何完整日期。
 */
export function extractEndDate(text: string, start: string | undefined, now: Date): string | undefined {
  const t = String(text || "");
  if (!start) return undefined;
  const [sy, sm, sd] = start.split("-").map(Number);
  const rollDay = (day: number): string => {
    let y = sy;
    let m = sm;
    if (day < sd) {
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };
  // 1)「M月D日 到/至/-/~ [M月]D日」区间；结尾有月份就用结尾月份，没有则沿用上一个月
  const range = t.match(
    /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?\s*(?:到|至|[-—~～])\s*(?:(\d{1,2})\s*月\s*)?(\d{1,2})\s*[日号]?(?!\s*[\d月])/,
  );
  if (range) {
    if (range[3]) {
      let y = sy;
      const m = Number(range[3]);
      if (m < sm) y += 1;
      const end = `${y}-${String(m).padStart(2, "0")}-${String(Number(range[4])).padStart(2, "0")}`;
      if (end >= start) return end;
    } else {
      const end = rollDay(Number(range[4]));
      if (end >= start) return end;
    }
  }
  // 2) 完整日期或裸日 + 回/返回/回北京（允许中间夹「从长沙」「到广州」）
  const ret = t.match(
    /(?:(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?|(?:^|[^\d月])(\d{1,2})\s*[日号])\s*(?:从[一-龥A-Za-z]{0,12})?(?:回来|回去|回到|返回|飞回|回国|回)(?![一-龥]*(?:出发|程时间))/,
  );
  if (ret) {
    const end = ret[1]
      ? parseLooseCheckin(`${ret[1]}月${ret[2]}日`, now)
      : rollDay(Number(ret[3]));
    if (end && end >= start) return end;
  }
  // 3)「周日回/周六返回」等星期回程日：取该星期在 start 当天或之后的第一次出现
  const wd = t.match(
    /周([一二三四五六日天])\s*(?:从[一-龥A-Za-z]{0,12})?(?:回来|回去|回到|返回|飞回|回国|回)(?![一-龥]*(?:出发|程时间))/,
  );
  if (wd) {
    const map: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };
    const dow = map[wd[1]];
    const startDate = new Date(sy, sm - 1, sd);
    let add = (dow - startDate.getDay() + 7) % 7;
    const endDate = new Date(sy, sm - 1, sd + add);
    const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;
    if (end >= start) return end;
  }
  // 4) 句中所有完整日期里，晚于 start 的第一个
  const later = [...t.matchAll(/(?:20\d{2}\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/g)]
    .map((m) => parseLooseCheckin(m[0], now))
    .filter((d): d is string => Boolean(d))
    .find((d) => d > start);
  return later || undefined;
}

export function extractFacts(
  text: string,
  opts?: { last?: Brief; now?: Date },
): ExtractedFacts {
  const t = String(text || "").trim();
  const polarity = extractPolarity(t);
  const money = extractHotelConstraints(t);
  const hotelAvoid = extractHotelAvoid(t);
  const retarget = extractCityChange(t);
  const cheaper = /便宜(?:点|一点|一些|点的)?|更便宜|低一点/.test(t)
    // 「X和Y哪个便宜/哪家便宜/比价」是两个对象的对比调研，是新任务，不是对上一单压价
    && !/(哪个|哪家|哪款|哪边|谁家?|谁).{0,6}(便宜|划算|实惠)|比价|对比一下|相比(?:之下|较)?|哪个更/.test(t);
  const named = findCities(t);
  const region = findRegion(t) || undefined;
  let origin = extractOrigin(t);
  if (!origin && named.length === 1 && /出发|从/.test(t) && isCity(named[0])) origin = named[0];
  const dest = named.filter((c) => c !== origin);
  const now = opts?.now || new Date();
  const start =
    parseLooseCheckin((t.match(/(\d{1,2}\s*月\s*\d{1,2}\s*[日号]?)/) || [])[1] || "", now) ||
    parseRelativeDate(t, now) ||
    undefined;
  const stayDays = parseStayDays(t);
  // 末日先听原话（区间/回程）；没说死就用「N 天含首尾」推 start+N-1；继承上一单在 inherit 算出后补。
  const explicitEnd = extractEndDate(t, start, now);
  const patch =
    cheaper ||
    money.hotelPriceMax != null ||
    money.hotelMinRating != null ||
    polarity.exclude.length > 0 ||
    polarity.prefer.length > 0 ||
    hotelAvoid.length > 0 ||
    Boolean(retarget) ||
    Boolean(extractAudience(t));
  const last = opts?.last;
  const lastCities = last?.known.cities || last?.plan?.cities || [];
  const newCity = dest.some((c) => !lastCities.includes(c));
  const inherit = Boolean(
    last && patch && !region && (dest.length === 0 || !newCity || Boolean(retarget)),
  );
  const end =
    explicitEnd ||
    (start && stayDays >= 1 ? addDays(start, Math.max(1, stayDays - 1)) : undefined) ||
    (inherit ? last?.known.end : undefined);

  let cities = retarget ? [retarget] : dest;
  if (inherit && !cities.length) cities = lastCities.filter((c) => isCity(c));

  let hotelPriceMax = money.hotelPriceMax;
  if (hotelPriceMax == null && inherit && last?.known.hotelPriceMax != null) {
    hotelPriceMax = cheaper
      ? Math.max(100, Math.floor(last.known.hotelPriceMax * 0.7))
      : last.known.hotelPriceMax;
  } else if (hotelPriceMax == null && cheaper && inherit) {
    hotelPriceMax = last?.known.hotelPriceMax;
  }

  const lastExclude = last?.known.exclude || [];
  const lastPrefer = last?.known.prefer || [];

  return {
    cities,
    region: region || (inherit ? last?.known.region : undefined),
    origin: origin || (inherit ? last?.known.origin : undefined),
    start: start || (inherit ? last?.known.start : undefined),
    end,
    hotelPriceMax,
    hotelMinRating:
      money.hotelMinRating ?? (inherit ? last?.known.hotelMinRating : undefined),
    audience: extractAudience(t) || (inherit ? last?.known.audience : undefined),
    cheaper: cheaper || undefined,
    hotelAvoid: uniq([...(inherit ? last?.known.hotelAvoid || [] : []), ...hotelAvoid]),
    exclude: uniq([...lastExclude, ...polarity.exclude]),
    prefer: uniq(polarity.prefer.length ? polarity.prefer : inherit ? lastPrefer : []),
    only: polarity.only,
    judgment: /值不值得|适不适合|值得去|好不好去/.test(t),
    stayDays,
    inherited: inherit,
    retarget,
  };
}

function tripish(last?: Brief): boolean {
  return Boolean(last && (last.kind === "trip" || last.kind === "travel" || last.kind === "eatplay"));
}

/** 短句只改约束/排除/换城，不重开目标。 */
export function isConstraintTurn(text: string, last?: Brief): boolean {
  if (!tripish(last)) return false;
  if (extractCityChange(text)) return true;
  const facts = extractFacts(text);
  const lastCities = last!.known.cities || last!.plan?.cities || [];
  const newCity = facts.cities.some((c) => !lastCities.includes(c));
  const patch =
    facts.cheaper ||
    facts.hotelPriceMax != null ||
    facts.hotelMinRating != null ||
    facts.exclude.length > 0 ||
    facts.prefer.length > 0 ||
    facts.hotelAvoid.length > 0 ||
    Boolean(facts.audience);
  if (!patch) return false;
  if (newCity && !facts.exclude.length && !facts.prefer.length && !facts.cheaper && !facts.hotelAvoid.length) {
    return false;
  }
  return true;
}
