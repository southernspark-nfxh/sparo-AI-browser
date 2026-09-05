/**
 * 出行一句话：订酒店 / 机票 / 火车 / 路线。
 * 先解析站点+地点+日期，再走结果页 URL，避免在城市弹层里空转。
 */
import { monthIndex } from "../analyzer/datetime.js";

export type HotelSite = "ctrip" | "tuniu" | "booking" | "airbnb";
export type FlightSite = "ctrip" | "qunar" | "gflights" | "kayak";
export type TrainSite = "ctrip" | "12306" | "trainline" | "omio";
export type MapsSite = "amap" | "baidumap" | "gmaps" | "bingmaps";

export type TravelQuery =
  | {
      kind: "hotel";
      site: HotelSite;
      city: string;
      checkin: string;
      checkout: string;
    }
  | {
      kind: "flight";
      site: FlightSite;
      from: string;
      to: string;
      date: string;
    }
  | {
      kind: "train";
      site: TrainSite;
      from: string;
      to: string;
      date: string;
    }
  | {
      kind: "maps";
      site: MapsSite;
      from: string;
      to: string;
    };

const STOP_WORDS =
  /帮我|请|查查|查找|看看|搜搜|搜索|找一些|找一下|找|做一个|做一份|做个|出一份|一些|携程|ctrip|途牛|tuniu|booking|airbnb|爱彼迎|去哪儿|qunar|kayak|酒店|宾馆|住宿|民宿|房源|机票|航班|网页版|首页|今天|明天|旅游攻略|攻略/gi;

const CITY_EN: Record<string, string> = {
  伊斯坦布尔: "Istanbul",
  北京: "Beijing",
  上海: "Shanghai",
  广州: "Guangzhou",
  深圳: "Shenzhen",
  成都: "Chengdu",
  杭州: "Hangzhou",
  东京: "Tokyo",
  大阪: "Osaka",
  首尔: "Seoul",
  曼谷: "Bangkok",
  新加坡: "Singapore",
  伦敦: "London",
  巴黎: "Paris",
  纽约: "New York",
  洛杉矶: "Los Angeles",
  阿姆斯特丹: "Amsterdam",
  香港: "Hong Kong",
  台北: "Taipei",
  第比利斯: "Tbilisi",
  安卡拉: "Ankara",
  巴统: "Batumi",
  三亚: "Sanya",
  昆明: "Kunming",
  大理: "Dali",
  丽江: "Lijiang",
  厦门: "Xiamen",
  西安: "Xian",
  重庆: "Chongqing",
  南京: "Nanjing",
  武汉: "Wuhan",
  青岛: "Qingdao",
};

/** 携程城市码 / Kayak 机场码 */
const FLIGHT_CODE: Record<string, { ctrip: string; kayak: string }> = {
  北京: { ctrip: "bjs", kayak: "PEK" },
  beijing: { ctrip: "bjs", kayak: "PEK" },
  上海: { ctrip: "sha", kayak: "SHA" },
  shanghai: { ctrip: "sha", kayak: "SHA" },
  广州: { ctrip: "can", kayak: "CAN" },
  深圳: { ctrip: "szx", kayak: "SZX" },
  成都: { ctrip: "ctu", kayak: "CTU" },
  杭州: { ctrip: "hgh", kayak: "HGH" },
  香港: { ctrip: "hkg", kayak: "HKG" },
  台北: { ctrip: "tpe", kayak: "TPE" },
  东京: { ctrip: "tyo", kayak: "TYO" },
  tokyo: { ctrip: "tyo", kayak: "TYO" },
  伊斯坦布尔: { ctrip: "ist", kayak: "IST" },
  istanbul: { ctrip: "ist", kayak: "IST" },
  伦敦: { ctrip: "lon", kayak: "LON" },
  london: { ctrip: "lon", kayak: "LON" },
  巴黎: { ctrip: "par", kayak: "PAR" },
  paris: { ctrip: "par", kayak: "PAR" },
  纽约: { ctrip: "nyc", kayak: "NYC" },
  "new york": { ctrip: "nyc", kayak: "NYC" },
  新加坡: { ctrip: "sin", kayak: "SIN" },
  首尔: { ctrip: "sel", kayak: "ICN" },
  曼谷: { ctrip: "bkk", kayak: "BKK" },
  阿姆斯特丹: { ctrip: "ams", kayak: "AMS" },
  amsterdam: { ctrip: "ams", kayak: "AMS" },
  第比利斯: { ctrip: "tbs", kayak: "TBS" },
  tbilisi: { ctrip: "tbs", kayak: "TBS" },
  安卡拉: { ctrip: "ank", kayak: "ESB" },
  ankara: { ctrip: "ank", kayak: "ESB" },
  三亚: { ctrip: "syx", kayak: "SYX" },
  昆明: { ctrip: "kmg", kayak: "KMG" },
  大理: { ctrip: "dlu", kayak: "DLU" },
  丽江: { ctrip: "ljg", kayak: "LJG" },
  厦门: { ctrip: "xmn", kayak: "XMN" },
  西安: { ctrip: "sia", kayak: "XIY" },
  重庆: { ctrip: "ckg", kayak: "CKG" },
  南京: { ctrip: "nkg", kayak: "NKG" },
  武汉: { ctrip: "wuh", kayak: "WUH" },
  青岛: { ctrip: "tao", kayak: "TAO" },
};

const TRAIN_CODE: Record<string, string> = {
  北京: "BJP",
  上海: "SHH",
  广州: "GZQ",
  深圳: "SZQ",
  杭州: "HGH",
  南京: "NJH",
  成都: "CDW",
  西安: "XAY",
  武汉: "WHN",
  天津: "TJP",
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + days);
  return ymd(dt);
}

export function cityEnglish(name: string): string {
  const t = name.trim();
  if (CITY_EN[t]) return CITY_EN[t];
  const hit = Object.keys(CITY_EN)
    .sort((a, b) => b.length - a.length)
    .find((k) => t.includes(k));
  if (hit) return CITY_EN[hit];
  return /^[A-Za-z]/.test(t) ? t : t;
}

export function flightCodes(name: string): { ctrip: string; kayak: string } | null {
  const raw = name.trim();
  const key = raw.toLowerCase();
  const direct =
    FLIGHT_CODE[raw] ||
    FLIGHT_CODE[key] ||
    Object.entries(FLIGHT_CODE).find(([k]) => k.toLowerCase() === key)?.[1];
  if (direct) return direct;
  const hit = Object.keys(FLIGHT_CODE)
    .sort((a, b) => b.length - a.length)
    .find((k) => raw.includes(k) || raw.toLowerCase().includes(k.toLowerCase()));
  return hit ? FLIGHT_CODE[hit] : null;
}

/** 下周一 / 周六 / 明天。同一天则推到下一周。 */
export function nextWeekdayIso(now: Date, dow: number): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let add = (dow - d.getDay() + 7) % 7;
  if (add === 0) add = 7;
  d.setDate(d.getDate() + add);
  return ymd(d);
}

export function parseRelativeDate(text: string, now = new Date()): string | null {
  const t = text.trim();
  if (/今天/.test(t)) return ymd(now);
  if (/明天/.test(t)) return addDays(ymd(now), 1);
  if (/后天/.test(t)) return addDays(ymd(now), 2);
  if (/下周一|下星期一/.test(t)) return nextWeekdayIso(now, 1);
  if (/下周二/.test(t)) return nextWeekdayIso(now, 2);
  if (/下周三/.test(t)) return nextWeekdayIso(now, 3);
  if (/下周四/.test(t)) return nextWeekdayIso(now, 4);
  if (/下周五/.test(t)) return nextWeekdayIso(now, 5);
  if (/下周六/.test(t)) return nextWeekdayIso(now, 6);
  if (/下周日|下星期日/.test(t)) return nextWeekdayIso(now, 0);
  if (/周六|星期六/.test(t)) return nextWeekdayIso(now, 6);
  if (/周日|星期日|周天/.test(t)) return nextWeekdayIso(now, 0);
  if (/周一|星期一/.test(t)) return nextWeekdayIso(now, 1);
  if (/下周/.test(t)) return addDays(ymd(now), 7);
  return parseLooseCheckin(t, now);
}

/** 9月15日 / Sep 15 / 2026-09-15。早于今天则落到明年。 */
export function parseLooseCheckin(text: string, now = new Date()): string | null {
  const iso = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    return `${iso[1]}-${pad2(Number(iso[2]))}-${pad2(Number(iso[3]))}`;
  }
  const cn = text.match(/(?:(20\d{2})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  if (cn) {
    let year = cn[1] ? Number(cn[1]) : now.getFullYear();
    const month = Number(cn[2]);
    const day = Number(cn[3]);
    const candidate = new Date(year, month - 1, day);
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (candidate < startToday) year += 1;
    return `${year}-${pad2(month)}-${pad2(day)}`;
  }
  const en = text.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(20\d{2}))?/i,
  );
  if (en) {
    const month = monthIndex(en[1].replace(/sept/i, "sep"));
    if (!month) return null;
    let year = en[3] ? Number(en[3]) : now.getFullYear();
    const day = Number(en[2]);
    const candidate = new Date(year, month - 1, day);
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (candidate < startToday) year += 1;
    return `${year}-${pad2(month)}-${pad2(day)}`;
  }
  return null;
}

function stripDateTokens(text: string): string {
  return text
    .replace(/\d{4}\s*年|\d{1,2}\s*月\s*\d{1,2}\s*日?/g, " ")
    .replace(/\d{4}-\d{1,2}-\d{1,2}/g, " ")
    .replace(
      /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*20\d{2})?\b/gi,
      " ",
    );
}

export function extractTravelCity(text: string): string | null {
  const named = stripDateTokens(text).match(
    /([\u4e00-\u9fffA-Za-z·\-]{2,20})的(?:酒店|宾馆|住宿|民宿|房源)/,
  );
  if (named) {
    const city = named[1].replace(STOP_WORDS, "").trim();
    if (city.length >= 2) return city;
  }
  const cleaned = stripDateTokens(text)
    .replace(STOP_WORDS, " ")
    .replace(/[,，。、；;!！?？]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const part = cleaned.split(" ").find((p) => p.length >= 2);
  return part || null;
}

function cleanPlace(raw: string): string {
  const t = raw
    .replace(STOP_WORDS, "")
    .replace(/做一个|做一份|做个|出一份/g, "")
    .replace(/的.+$/, "")
    .replace(/怎么[走去]?|路线|导航$/g, "")
    .replace(/^从/, "")
    .replace(/回$/, "")
    .replace(/的$/g, "")
    .trim();
  const known = Object.keys(FLIGHT_CODE)
    .concat(Object.keys(CITY_EN))
    .sort((a, b) => b.length - a.length)
    .find((k) => t === k || t.endsWith(k));
  return known || t;
}

const ROUTE_CONN = "飞往|飞回|飞|回到|返回|到|至|→|去";

export function extractRoutePair(
  text: string,
): { from: string; to: string } | null {
  const prefer = text.match(
    new RegExp(
      `从([\\u4e00-\\u9fffA-Za-z·\\-]{2,16})(?:${ROUTE_CONN})([\\u4e00-\\u9fffA-Za-z·\\-]{2,16})`,
    ),
  );
  const cn =
    prefer ||
    stripDateTokens(text).match(
      new RegExp(
        `([\\u4e00-\\u9fffA-Za-z·\\-]{2,16})(?:${ROUTE_CONN})([\\u4e00-\\u9fffA-Za-z·\\-]{2,16})`,
      ),
    );
  if (cn) {
    const from = cleanPlace(cn[1]);
    const to = cleanPlace(cn[2]);
    if (from.length >= 2 && to.length >= 2) return { from, to };
  }
  const en = text.match(
    /\b([A-Za-z][A-Za-z ]{1,24}?)\s+to\s+([A-Za-z][A-Za-z ]{1,24}?)(?:\s+on|\s+train|\s+flight|[?？]|$)/i,
  );
  if (en) {
    return { from: en[1].trim(), to: en[2].trim() };
  }
  return null;
}

export function detectHotelSite(text: string): HotelSite {
  if (/爱彼迎|airbnb/i.test(text)) return "airbnb";
  if (/booking\.com|booking/i.test(text)) return "booking";
  if (/途牛|tuniu/i.test(text)) return "tuniu";
  return "ctrip";
}

export function detectFlightSite(text: string): FlightSite {
  if (/kayak/i.test(text)) return "kayak";
  if (/google\.com\/travel\/flights|google\s*flights/i.test(text)) return "gflights";
  if (/去哪儿|qunar/i.test(text)) return "qunar";
  if (/携程|ctrip/i.test(text)) return "ctrip";
  return /[\u4e00-\u9fff]{2}/.test(text) ? "ctrip" : "gflights";
}

export function detectTrainSite(text: string): TrainSite {
  if (/12306/i.test(text)) return "12306";
  if (/trainline/i.test(text)) return "trainline";
  if (/omio/i.test(text)) return "omio";
  if (/携程|ctrip/i.test(text)) return "ctrip";
  return /[\u4e00-\u9fff]{2}/.test(text) ? "ctrip" : "trainline";
}

/** 多段行程（往返 + 多城 + 机票酒店一起问），不要当成单次导航。 */
export function isTripPlanQuery(text: string): boolean {
  const t = text.trim();
  if (t.length < 20) return false;
  const planish = /规划|行程|安排|怎么安排|旅行计划|出差|报销|见客户|全路线|整条路线|攻略|旅游/.test(t);
  const flights = /机票|航班|flights?/i.test(t);
  const stays = /酒店|宾馆|住宿|民宿|入住|hotels?/i.test(t);
  const multiIntent = flights && stays;
  const round = /出发/.test(t) && /回(到|国|来)|返回|飞回|往返/.test(t);
  const backHome = /之后回|然后再回|最后回|再回|飞回|返回|回到|回国|回来|往返|回[\u4e00-\u9fff]{1,8}/.test(t);
  const multiPlace = /两个城市|两国|以及.{0,12}(和|与)|要去.{2,12}和/.test(t);
  const hopStays =
    /再去|然后去|接着去|最后到|再到/.test(t) &&
    /玩\s*[一二三四五六七八九十两\d]+\s*[天晚]/.test(t);
  if (multiIntent && (planish || round || multiPlace || hopStays || backHome)) return true;
  if (planish && round && (multiPlace || stays || flights)) return true;
  if (hopStays && backHome && (stays || flights || planish || /路线/.test(t))) return true;
  return false;
}

export function detectMapsSite(text: string): MapsSite {
  if (/百度地图|map\.baidu/i.test(text)) return "baidumap";
  if (/google\.com\/maps|maps\.google|google\s*maps/i.test(text)) return "gmaps";
  if (/bing\.com\/maps|bing\s*maps/i.test(text)) return "bingmaps";
  if (/高德|amap/i.test(text)) return "amap";
  return /[\u4e00-\u9fff]{2}/.test(text) ? "amap" : "gmaps";
}

export function parseTravelQuery(text: string, now = new Date()): TravelQuery | null {
  const t = text.trim();
  if (!t) return null;
  if (isTripPlanQuery(t)) return null;

  const pair = extractRoutePair(t);
  const date = parseLooseCheckin(t, now) || addDays(ymd(now), 1);

  // 「旅行路线 / 规划路线」是行程，不是高德市内导航
  const mapsCue = /怎么走|怎么去|导航|(?:查|看).{0,6}(?:怎么走|路线)/.test(t);
  const itineraryCue = /规划|行程|旅行路线|入住|查询航班|两个城市/.test(t);
  if (pair && mapsCue && !itineraryCue) {
    return { kind: "maps", site: detectMapsSite(t), from: pair.from, to: pair.to };
  }
  if (pair && /机票|航班|flights?/i.test(t)) {
    return {
      kind: "flight",
      site: detectFlightSite(t),
      from: pair.from,
      to: pair.to,
      date,
    };
  }
  if (pair && /高铁|火车|车票|火车票|trains?/i.test(t)) {
    return {
      kind: "train",
      site: detectTrainSite(t),
      from: pair.from,
      to: pair.to,
      date,
    };
  }
  if (/酒店|宾馆|住宿|民宿|房源|hotels?/i.test(t)) {
    const city = extractTravelCity(t);
    if (!city) return null;
    const range = t.match(
      /(\d{1,2}\s*月\s*\d{1,2}\s*日?|\d{4}-\d{1,2}-\d{1,2})\s*[-~到至]\s*(\d{1,2}\s*月\s*\d{1,2}\s*日?|\d{4}-\d{1,2}-\d{1,2})/,
    );
    const checkin = parseLooseCheckin(t, now) || addDays(ymd(now), 1);
    const checkout = range
      ? parseLooseCheckin(range[2], now) || addDays(checkin, 1)
      : addDays(checkin, 1);
    return {
      kind: "hotel",
      site: detectHotelSite(t),
      city,
      checkin,
      checkout: checkout <= checkin ? addDays(checkin, 1) : checkout,
    };
  }
  return null;
}

export function lifeProgress(q: TravelQuery): string {
  if (q.kind === "hotel") {
    return `正在${siteLabel(q.site)}查 ${q.city} ${q.checkin} 的住宿…`;
  }
  if (q.kind === "flight") {
    return `正在查 ${q.from} → ${q.to} ${q.date} 的机票…`;
  }
  if (q.kind === "train") {
    return `正在查 ${q.from} → ${q.to} ${q.date} 的车票…`;
  }
  return `正在查 ${q.from} 到 ${q.to} 怎么走…`;
}

export function siteLabel(site: string): string {
  const map: Record<string, string> = {
    ctrip: "携程",
    tuniu: "途牛",
    booking: "Booking",
    airbnb: "Airbnb",
    qunar: "去哪儿",
    gflights: "Google Flights",
    kayak: "Kayak",
    "12306": "12306",
    trainline: "Trainline",
    omio: "Omio",
    amap: "高德",
    baidumap: "百度地图",
    gmaps: "Google 地图",
    bingmaps: "Bing 地图",
  };
  return map[site] || site;
}

type SuggestHit = {
  type?: string;
  word?: string;
  eName?: string;
  cityId?: number;
  districtId?: number;
  id?: number;
};

/** 联想接口失败时的国内/热门城市兜底。 */
export const CTRIP_HOTEL_CITY_ID: Record<string, number> = {
  北京: 1,
  上海: 2,
  天津: 3,
  重庆: 4,
  青岛: 7,
  西安: 10,
  南京: 12,
  杭州: 17,
  厦门: 21,
  成都: 28,
  深圳: 30,
  广州: 32,
  昆明: 34,
  大理: 36,
  丽江: 37,
  三亚: 43,
  武汉: 477,
  伊斯坦布尔: 532,
  东京: 228,
  首尔: 274,
};

export function pickCtripHotelCity(
  rows: SuggestHit[],
  city: string,
): { cityId: number; label: string } | null {
  const district = rows.find((r) => r.type === "district" && Number(r.cityId) > 0);
  const list = rows.find((r) => r.type === "hotellist" && Number(r.cityId || r.id) > 0);
  const hotel = rows.find((r) => r.type === "hotel" && Number(r.cityId) > 0);
  const hit = district || list || hotel;
  const cityId = Number(hit?.cityId || (hit?.type === "hotellist" ? hit.id : 0) || 0);
  if (!cityId) return null;
  return { cityId, label: String(hit?.word || hit?.eName || city) };
}

export async function resolveCtripHotelCity(
  city: string,
): Promise<{ cityId: number; label: string } | null> {
  try {
    const url =
      "https://m.ctrip.com/restapi/h5api/globalsearch/search?action=online&source=globalonline&keyword=" +
      encodeURIComponent(city);
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
    });
    if (res.ok) {
      const data = (await res.json()) as { data?: SuggestHit[] };
      const picked = pickCtripHotelCity(data.data || [], city);
      if (picked) return picked;
    }
  } catch {
    /* 联想失败就走本地城市码 */
  }
  const id = CTRIP_HOTEL_CITY_ID[city.trim()];
  if (id) return { cityId: id, label: city.trim() };
  return null;
}

export function ctripHotelDetailUrl(
  hotelId: string | number,
  checkin?: string,
  checkout?: string,
): string {
  const q = new URLSearchParams();
  if (checkin) q.set("checkIn", checkin);
  if (checkout) q.set("checkOut", checkout);
  const qs = q.toString();
  return `https://hotels.ctrip.com/hotels/${hotelId}.html${qs ? `?${qs}` : ""}`;
}

export function ctripHotelListUrl(
  cityId: number,
  checkin: string,
  checkout: string,
): string {
  const q = new URLSearchParams({
    city: String(cityId),
    checkin,
    checkout,
  });
  return `https://hotels.ctrip.com/hotels/list?${q.toString()}`;
}

export function hotelSearchUrl(q: Extract<TravelQuery, { kind: "hotel" }>): string {
  const en = cityEnglish(q.city);
  if (q.site === "booking") {
    const p = new URLSearchParams({
      ss: en,
      checkin: q.checkin,
      checkout: q.checkout,
      group_adults: "1",
      no_rooms: "1",
      group_children: "0",
    });
    return `https://www.booking.com/searchresults.html?${p}`;
  }
  if (q.site === "airbnb") {
    const p = new URLSearchParams({
      checkin: q.checkin,
      checkout: q.checkout,
      adults: "1",
    });
    return `https://www.airbnb.com/s/${encodeURIComponent(en)}/homes?${p}`;
  }
  if (q.site === "tuniu") {
    const p = new URLSearchParams({
      city: q.city,
      checkin: q.checkin,
      checkout: q.checkout,
    });
    return `https://hotel.tuniu.com/list?${p}`;
  }
  return "";
}

export function flightSearchUrl(q: Extract<TravelQuery, { kind: "flight" }>): string {
  const fromCode = flightCodes(q.from);
  const toCode = flightCodes(q.to);
  const enFrom = cityEnglish(q.from);
  const enTo = cityEnglish(q.to);
  if (q.site === "gflights") {
    return (
      "https://www.google.com/travel/flights?q=" +
      encodeURIComponent(`Flights from ${enFrom} to ${enTo} on ${q.date}`)
    );
  }
  if (q.site === "kayak" && fromCode && toCode) {
    return `https://www.kayak.com/flights/${fromCode.kayak}-${toCode.kayak}/${q.date}?sort=bestflight_a`;
  }
  if (q.site === "qunar") {
    const p = new URLSearchParams({
      searchDepartureAirport: q.from,
      searchArrivalAirport: q.to,
      searchDepartureTime: q.date,
      nextNDays: "0",
      startSearch: "true",
    });
    if (fromCode) p.set("fromCode", fromCode.ctrip.toUpperCase());
    if (toCode) p.set("toCode", toCode.ctrip.toUpperCase());
    return `https://flight.qunar.com/ncs/page/flightsearch?${p}`;
  }
  if (fromCode && toCode) {
    return `https://flights.ctrip.com/online/list/oneway-${fromCode.ctrip}-${toCode.ctrip}?depdate=${q.date}&cabin=y_s&adult=1&child=0&infant=0`;
  }
  return (
    "https://www.google.com/travel/flights?q=" +
    encodeURIComponent(`Flights from ${enFrom} to ${enTo} on ${q.date}`)
  );
}

export function isFlightResultUrl(url: string): boolean {
  const u = String(url || "").toLowerCase();
  if (!u) return false;
  if (/\/online\/channel\/?(\?|$)/.test(u)) return false;
  return /\/online\/list\/|flights?\/(list|search)|tickets-|flightsearch|travel\/flights|kayak\.com\/flights/i.test(
    u,
  );
}

export function trainSearchUrl(q: Extract<TravelQuery, { kind: "train" }>): string {
  if (q.site === "12306") {
    const fs = TRAIN_CODE[q.from];
    const ts = TRAIN_CODE[q.to];
    if (fs && ts) {
      return `https://kyfw.12306.cn/otn/leftTicket/init?linktypeid=dc&fs=${encodeURIComponent(q.from)},${fs}&ts=${encodeURIComponent(q.to)},${ts}&date=${q.date}&flag=N,N,Y`;
    }
    return "https://kyfw.12306.cn/otn/leftTicket/init";
  }
  if (q.site === "trainline") {
    const p = new URLSearchParams({
      origin: cityEnglish(q.from),
      destination: cityEnglish(q.to),
      outwardDate: q.date,
    });
    return `https://www.thetrainline.com/book/results?${p}`;
  }
  if (q.site === "omio") {
    const p = new URLSearchParams({
      departure: cityEnglish(q.from),
      arrival: cityEnglish(q.to),
      departureDate: q.date,
    });
    return `https://www.omio.com/search?${p}`;
  }
  const p = new URLSearchParams({
    departure: q.from,
    destination: q.to,
    date: q.date,
  });
  return `https://trains.ctrip.com/TrainBooking/leftTicketList?${p}`;
}

export function mapsSearchUrl(q: Extract<TravelQuery, { kind: "maps" }>): string {
  if (q.site === "baidumap") {
    return `https://map.baidu.com/dir/${encodeURIComponent(q.from)}/${encodeURIComponent(q.to)}`;
  }
  if (q.site === "gmaps") {
    return `https://www.google.com/maps/dir/${encodeURIComponent(cityEnglish(q.from))}/${encodeURIComponent(cityEnglish(q.to))}`;
  }
  if (q.site === "bingmaps") {
    return `https://www.bing.com/maps?rtp=adr.${encodeURIComponent(cityEnglish(q.from))}~adr.${encodeURIComponent(cityEnglish(q.to))}`;
  }
  return `https://www.amap.com/dir?from=${encodeURIComponent(q.from)}&to=${encodeURIComponent(q.to)}`;
}

export function travelResultUrl(q: TravelQuery): string {
  if (q.kind === "hotel") return hotelSearchUrl(q);
  if (q.kind === "flight") return flightSearchUrl(q);
  if (q.kind === "train") return trainSearchUrl(q);
  return mapsSearchUrl(q);
}

export type TravelListState = "ready" | "empty" | "pending" | "blocked";

export function travelListState(kind: TravelQuery["kind"], text: string): TravelListState {
  const raw = text || "";
  if (/验证码|滑块|captcha|人机验证/i.test(raw) && raw.length < 900) return "blocked";
  if (kind === "flight") {
    const hasPrice = /[¥￥$€]\s*\d{2,}/.test(raw);
    const hasTime = /\d{1,2}:\d{2}/.test(raw);
    const hasAirline = /航空|Airlines?|航司|直飞|中转|nonstop|layover/i.test(raw);
    if (hasPrice && (hasTime || hasAirline)) return "ready";
    if (/没有符合|未找到符合|暂无航班|没有找到航班|No flights found/i.test(raw)) return "empty";
    if (/为您推荐|其他城市|伊兹密尔|达拉曼|安塔利亚|库塔伊西/.test(raw) && !hasTime) {
      return "empty";
    }
    if (raw.length < 1600 && /我的订单|关于携程|ICP证/.test(raw)) return "pending";
    return raw.length > 4000 && hasPrice ? "ready" : "pending";
  }
  if (kind === "hotel") {
    if (/酒店|Hotel|房源|住宿/i.test(raw) && (/[¥￥$€]\s*\d{2,}/.test(raw) || /\d\.\d\s*分/.test(raw))) {
      return "ready";
    }
    if (/找不到|暂无.*酒店|没有符合|没有找到酒店/i.test(raw) && raw.length < 800) return "empty";
    return "pending";
  }
  return raw.length > 400 ? "ready" : "pending";
}

export function shouldFallbackFlight(text: string, site: string, url = ""): boolean {
  if (site === "gflights" || site === "kayak") return false;
  if (url && !isFlightResultUrl(url)) return true;
  const s = travelListState("flight", text);
  return s === "empty" || s === "pending";
}

export function flightFallbackUrl(q: Extract<TravelQuery, { kind: "flight" }>): string {
  const fromCode = flightCodes(q.from);
  const toCode = flightCodes(q.to);
  const enFrom = cityEnglish(q.from);
  const enTo = cityEnglish(q.to);
  if (fromCode && toCode) {
    const slug = (s: string) => s.toLowerCase().replace(/\s+/g, "-");
    return `https://www.trip.com/flights/${slug(enFrom)}-to-${slug(enTo)}/tickets-${fromCode.kayak.toLowerCase()}-${toCode.kayak.toLowerCase()}?ddate=${q.date}&flighttype=ow`;
  }
  return flightSearchUrl({ ...q, site: "gflights" });
}

export function travelReadPrompt(q: TravelQuery): string {
  if (q.kind === "hotel") {
    return [
      `根据下面住宿列表正文，用中文列出 5 条左右：名称、价格或评分（有就写）。站点是${siteLabel(q.site)}。`,
      `城市：${q.city}。入住 ${q.checkin}，离店 ${q.checkout}。`,
      "若有「可点击酒店」列表，店名必须写成 [店名](链接)，不要只写名字、不要丢掉链接。",
      "只根据正文，不要编造。若是验证码或登录页，如实说。",
    ].join("\n");
  }
  if (q.kind === "flight") {
    return [
      `根据下面机票列表，用中文列出几条航班：航司、时刻、大概价格（有就写）。`,
      `${q.from} → ${q.to}，出发 ${q.date}。`,
      "只根据正文。若航线错了或是验证码，如实说。",
      "邻近城市（伊兹密尔、达拉曼、安塔利亚、库塔伊西、巴统、上海等）不是本次航线，不要写成「当天没有航班」。",
      "若只有页眉页脚、没有时刻和价格：写「列表未加载」，不要断言无航班。",
    ].join("\n");
  }
  if (q.kind === "train") {
    return [
      `根据下面车票列表，用中文列出几趟：车次、时刻、余票或价格（有就写）。`,
      `${q.from} → ${q.to}，${q.date}。`,
      "只根据正文。若是登录/验证码，如实说。",
    ].join("\n");
  }
  return [
    `根据下面地图/路线正文，用中文说明从 ${q.from} 到 ${q.to} 怎么走：耗时、方式、关键换乘。`,
    "只根据正文，不要编造。",
  ].join("\n");
}
