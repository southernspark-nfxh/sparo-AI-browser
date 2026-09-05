/**
 * 稍复杂的行程：拆成「去程机票 → 各城酒店 → 城际机票 → 回程机票」，再汇总。
 * 跨国路段不走高德驾车。
 */
import {
  addDays,
  detectFlightSite,
  detectHotelSite,
  extractRoutePair,
  isTripPlanQuery,
  parseLooseCheckin,
  parseRelativeDate,
  ymd,
  type FlightSite,
  type HotelSite,
  type TravelQuery,
} from "./travel.js";

export type TripPlan = {
  origin: string;
  cities: string[];
  startDate: string;
  endDate: string;
  /** 与 cities 对齐；有「玩三天」时按夜数排，否则均分。 */
  nights?: number[];
  flightSite: FlightSite;
  hotelSite: HotelSite;
};

export type TripStep = {
  label: string;
  query: TravelQuery;
};

const PLACE_ALIASES: Record<string, string> = {
  土耳其: "伊斯坦布尔",
  turkey: "伊斯坦布尔",
  格鲁吉亚: "第比利斯",
  georgia: "第比利斯",
  伊斯坦布尔: "伊斯坦布尔",
  istanbul: "伊斯坦布尔",
  第比利斯: "第比利斯",
  tbilisi: "第比利斯",
  巴统: "巴统",
  batumi: "巴统",
  安卡拉: "安卡拉",
  ankara: "安卡拉",
  北京: "北京",
  beijing: "北京",
  上海: "上海",
  shanghai: "上海",
  广州: "广州",
  深圳: "深圳",
  成都: "成都",
  杭州: "杭州",
  东京: "东京",
  tokyo: "东京",
  大阪: "大阪",
  首尔: "首尔",
  曼谷: "曼谷",
  新加坡: "新加坡",
  伦敦: "伦敦",
  london: "伦敦",
  巴黎: "巴黎",
  paris: "巴黎",
  纽约: "纽约",
  香港: "香港",
  台北: "台北",
  日本: "东京",
  韩国: "首尔",
  泰国: "曼谷",
  英国: "伦敦",
  法国: "巴黎",
  三亚: "三亚",
  昆明: "昆明",
  大理: "大理",
  丽江: "丽江",
  厦门: "厦门",
  西安: "西安",
  重庆: "重庆",
  南京: "南京",
  武汉: "武汉",
  青岛: "青岛",
};

const CN_INT: Record<string, number> = {
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

function canonPlace(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (/攻略|旅游|酒店|机票|航班|出发|回来|规划|行程|手册/.test(t)) return null;
  return PLACE_ALIASES[t] || PLACE_ALIASES[t.toLowerCase()] || (/^[\u4e00-\u9fff]{2,4}$/.test(t) ? t : null);
}

/** 「22日回来」跟出发月；日比出发日小则跨月。 */
function parseReturnDate(text: string, startDate: string, now: Date): string | null {
  const withMonth = text.match(
    /((?:\d{1,2}\s*月\s*\d{1,2}\s*[日号]?)|(?:20\d{2}-\d{1,2}-\d{1,2}))\s*(?:从[\u4e00-\u9fffA-Za-z]{0,12})?(?:回来|回到|返回|飞回|回国)/,
  );
  if (withMonth) return parseLooseCheckin(withMonth[1], now);
  const dayOnly = text.match(/(\d{1,2})\s*[日号]\s*(?:回来|回到|返回|飞回|回国)/);
  if (!dayOnly) return null;
  const [y, m, startDay] = startDate.split("-").map(Number);
  const day = Number(dayOnly[1]);
  if (!day || day > 31) return null;
  const d = new Date(y, (m || 1) - 1, day);
  const start = new Date(y, (m || 1) - 1, startDay || 1);
  if (d <= start) d.setMonth(d.getMonth() + 1);
  return ymd(d);
}

function parseDayCount(raw: string): number {
  const t = String(raw || "").trim();
  if (/^\d+$/.test(t)) return Math.max(1, Math.min(14, Number(t)));
  return CN_INT[t] || 0;
}

/** 「去三亚玩三天 再去上海玩一天」→ 按出现顺序的住几晚。 */
export function parseStayHops(text: string): Array<{ city: string; nights: number }> {
  const re =
    /(?:再去|然后去|接着去|最后到|再到|去|到)([\u4e00-\u9fffA-Za-z]{2,12})玩\s*([一二三四五六七八九十两\d]+)\s*[天晚]/g;
  const out: Array<{ city: string; nights: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const city = canonPlace(m[1]);
    const nights = parseDayCount(m[2]);
    if (!city || nights < 1) continue;
    if (out.some((x) => x.city === city)) continue;
    out.push({ city, nights });
  }
  return out;
}

function extractAllIsoDates(text: string, now: Date): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (iso: string | null) => {
    if (!iso || seen.has(iso)) return;
    seen.add(iso);
    out.push(iso);
  };
  const re = /(?:(20\d{2})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    push(parseLooseCheckin(m[0], now));
  }
  const isoRe = /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g;
  while ((m = isoRe.exec(text))) {
    push(parseLooseCheckin(m[0], now));
  }
  return out;
}

function placesInText(text: string): string[] {
  const keys = Object.keys(PLACE_ALIASES).sort((a, b) => b.length - a.length);
  const hits: { at: number; name: string }[] = [];
  const used: [number, number][] = [];
  const overlaps = (a: number, b: number) => used.some(([s, e]) => a < e && b > s);
  for (const key of keys) {
    const re = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const at = m.index;
      const end = at + m[0].length;
      if (overlaps(at, end)) continue;
      const name = canonPlace(m[0]);
      if (!name) continue;
      used.push([at, end]);
      hits.push({ at, name });
    }
  }
  hits.sort((a, b) => a.at - b.at);
  const uniq: string[] = [];
  for (const h of hits) {
    if (!uniq.includes(h.name)) uniq.push(h.name);
  }
  return uniq;
}

export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const da = new Date(ay, (am || 1) - 1, ad || 1);
  const db = new Date(by, (bm || 1) - 1, bd || 1);
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

function splitStays(
  cities: string[],
  start: string,
  end: string,
  nightsPerCity?: number[],
): Array<{ city: string; checkin: string; checkout: string }> {
  const rows: Array<{ city: string; checkin: string; checkout: string }> = [];
  let cursor = start;
  const useNights =
    nightsPerCity &&
    nightsPerCity.length === cities.length &&
    nightsPerCity.every((n) => n >= 1);
  if (useNights) {
    for (let i = 0; i < cities.length; i++) {
      const checkout = addDays(cursor, nightsPerCity[i]);
      rows.push({ city: cities[i], checkin: cursor, checkout });
      cursor = checkout;
    }
    return rows;
  }
  const nights = Math.max(cities.length, daysBetween(start, end));
  const base = Math.floor(nights / cities.length);
  let extra = nights - base * cities.length;
  for (let i = 0; i < cities.length; i++) {
    const stay = base + (i === cities.length - 1 ? extra : extra > 0 ? 1 : 0);
    if (i < cities.length - 1 && extra > 0) extra -= 1;
    let checkout = i === cities.length - 1 ? end : addDays(cursor, Math.max(1, stay));
    if (checkout <= cursor) checkout = addDays(cursor, 1);
    rows.push({ city: cities[i], checkin: cursor, checkout });
    cursor = checkout;
  }
  return rows;
}

export function parseTripPlan(text: string, now = new Date()): TripPlan | null {
  const t = text.trim();
  if (!isTripPlanQuery(t)) return null;

  const dates = extractAllIsoDates(t, now);
  const startNear = t.match(
    /((?:\d{1,2}\s*月\s*\d{1,2}\s*[日号]?)|(?:20\d{2}-\d{1,2}-\d{1,2})).{0,8}(?:从.{0,8})?(?:出发|去)/,
  );
  const startDate =
    (startNear && parseLooseCheckin(startNear[1], now)) ||
    parseRelativeDate(t, now) ||
    dates[0] ||
    addDays(ymd(now), 7);

  const originHit =
    t.match(/从([\u4e00-\u9fffA-Za-z]{2,12})出发/) ||
    t.match(/从([\u4e00-\u9fffA-Za-z]{2,12})(?:飞往|飞)/) ||
    t.match(/(?:搜|查)([\u4e00-\u9fff]{2,4})\s*\d{1,2}\s*月/);
  const route = extractRoutePair(t);
  const origin =
    canonPlace(originHit?.[1] || "") ||
    (route && canonPlace(route.from)) ||
    placesInText(t)[0] ||
    "北京";

  const hops = parseStayHops(t).filter((h) => h.city !== origin);
  const land = t.match(/落地([\u4e00-\u9fffA-Za-z]{2,12})/);
  const back = t.match(/从([\u4e00-\u9fffA-Za-z]{2,12})(?:回到|返回|飞回|回国)/);
  const andPair = t.match(/要去([\u4e00-\u9fffA-Za-z]{2,12})和([\u4e00-\u9fffA-Za-z]{2,12})/);

  const first = canonPlace(land?.[1] || "");
  const last = canonPlace(back?.[1] || "");
  const named = [canonPlace(andPair?.[1] || ""), canonPlace(andPair?.[2] || "")].filter(
    (x): x is string => Boolean(x),
  );

  const mentioned = placesInText(t).filter((p) => p !== origin);
  const cities: string[] = [];
  const pushCity = (c: string | null | undefined) => {
    if (!c || c === origin || cities.includes(c)) return;
    cities.push(c);
  };
  let nights: number[] | undefined;
  if (hops.length) {
    for (const h of hops) pushCity(h.city);
    nights = hops.filter((h) => cities.includes(h.city)).map((h) => h.nights);
  } else {
    pushCity(first);
    for (const c of named) pushCity(c);
    for (const c of mentioned) pushCity(c);
    if (last) {
      if (cities.includes(last)) {
        cities.splice(cities.indexOf(last), 1);
      }
      cities.push(last);
    }
  }

  if (!cities.length) return null;

  if (!nights) {
    const dayHit = t.match(/(?:出差|待|住|玩)?\s*([一二三四五六七八九十两\d]+)\s*天/);
    const n = dayHit ? parseDayCount(dayHit[1]) : 0;
    if (n >= 1) {
      nights = cities.map(() => (cities.length === 1 ? n : Math.max(1, Math.floor(n / cities.length))));
    }
  }

  const hopNights = nights?.reduce((a, b) => a + b, 0) || 0;
  let endDate =
    (hopNights ? addDays(startDate, hopNights) : "") ||
    parseReturnDate(t, startDate, now) ||
    dates.find((d) => d > startDate) ||
    addDays(startDate, Math.max(8, cities.length * 2));
  if (endDate <= startDate) endDate = addDays(startDate, Math.max(1, hopNights || 8));

  return {
    origin,
    cities,
    startDate,
    endDate,
    nights,
    flightSite: detectFlightSite(t),
    hotelSite: detectHotelSite(t),
  };
}

export function expandTripPlan(plan: TripPlan): TripStep[] {
  const stays = splitStays(plan.cities, plan.startDate, plan.endDate, plan.nights);
  const steps: TripStep[] = [];
  const flight = (from: string, to: string, date: string, label: string) => {
    steps.push({
      label,
      query: {
        kind: "flight",
        site: plan.flightSite,
        from,
        to,
        date,
      },
    });
  };
  const hotel = (city: string, checkin: string, checkout: string) => {
    steps.push({
      label: `${city} 住宿 ${checkin} 至 ${checkout}`,
      query: {
        kind: "hotel",
        site: plan.hotelSite,
        city,
        checkin,
        checkout,
      },
    });
  };

  flight(
    plan.origin,
    stays[0].city,
    plan.startDate,
    `去程机票 ${plan.origin} → ${stays[0].city} ${plan.startDate}`,
  );
  hotel(stays[0].city, stays[0].checkin, stays[0].checkout);
  for (let i = 0; i < stays.length - 1; i++) {
    flight(
      stays[i].city,
      stays[i + 1].city,
      stays[i].checkout,
      `城际机票 ${stays[i].city} → ${stays[i + 1].city} ${stays[i].checkout}`,
    );
    hotel(stays[i + 1].city, stays[i + 1].checkin, stays[i + 1].checkout);
  }
  flight(
    stays[stays.length - 1].city,
    plan.origin,
    plan.endDate,
    `回程机票 ${stays[stays.length - 1].city} → ${plan.origin} ${plan.endDate}`,
  );
  return steps.slice(0, 12);
}

export function tripPlanProgress(plan: TripPlan): string {
  return `正在拆行程：${plan.startDate} 从${plan.origin}出发，途经 ${plan.cities.join("、")}，${plan.endDate} 回${plan.origin}。先查机票和酒店，再汇总路线与价格。`;
}

export function tripSynthesizePrompt(
  userAsk: string,
  plan: TripPlan,
  findings: Array<{ label: string; url: string; text: string }>,
): string {
  const blocks = findings
    .map((f, i) => `### ${i + 1}. ${f.label}\n网址：${f.url}\n${f.text.slice(0, 1800)}`)
    .join("\n\n");
  return [
    "用户要一份可执行的旅行规划，不是读当前某一页。",
    "你已经按步骤打开了机票/酒店结果页。只根据下面各步正文汇总，不要编造航班号、酒店名、价格。",
    "正文没有的数字写成「未知，需在窗口里再看」，不要估算假价格。",
    "某步写「列表未加载」或只有邻近城市时，不要写成当天没有航班；骨架仍按原计划。",
    `行程骨架：${plan.startDate} ${plan.origin}出发 → ${plan.cities.join(" → ")} → ${plan.endDate} 回${plan.origin}。`,
    "用中文写出：",
    "1. 日程表（哪天在哪座城、住几晚）",
    "2. 各段机票：写成 [北京 → 三亚 9/18](结果页链接)。必须写价格区间、最早一班几点、有没有直飞。没有明细也要保留链接，不要写成当天没航班。",
    "3. 各城酒店：各列 2～3 家，写成 [店名](链接)。每家用一两句说为什么选（地段/连住/赶飞机）、大约多少钱。没有链接不要编店名。",
    "4. 粗算总价：只加正文里的数字；缺的标未知",
    "5. 为什么这样排（时差、中转、入住夜数）。跨国路段用机票，不要写高德驾车。",
    `用户原话：${userAsk}`,
    blocks,
  ].join("\n");
}

export { isTripPlanQuery };
