/**
 * 合法站点表。失败后只在表里换站；用户点名的站不换。
 */
import { isChinaCity } from "../place.js";

export type SiteLane = "hotel" | "flight" | "train" | "search";

const ALIAS: Record<string, string> = {
  携程: "ctrip",
  ctrip: "ctrip",
  途牛: "tuniu",
  tuniu: "tuniu",
  booking: "booking",
  爱彼迎: "airbnb",
  airbnb: "airbnb",
  去哪儿: "qunar",
  qunar: "qunar",
  kayak: "kayak",
  谷歌机票: "gflights",
  gflights: "gflights",
  "12306": "12306",
  百度: "baidu",
  baidu: "baidu",
  必应: "bing",
  bing: "bing",
  谷歌: "google",
  google: "google",
};

const LANE_IDS: Record<SiteLane, string[]> = {
  hotel: ["ctrip", "tuniu", "booking", "airbnb"],
  flight: ["ctrip", "qunar", "kayak", "gflights"],
  train: ["12306", "ctrip"],
  search: ["baidu", "bing", "google"],
};

const URL_HINT: { id: string; re: RegExp }[] = [
  { id: "ctrip", re: /ctrip\.com|trip\.com/i },
  { id: "tuniu", re: /tuniu\.com/i },
  { id: "booking", re: /booking\.com/i },
  { id: "airbnb", re: /airbnb\./i },
  { id: "qunar", re: /qunar\.com/i },
  { id: "kayak", re: /kayak\.com/i },
  { id: "gflights", re: /google\.com\/travel\/flights/i },
  { id: "12306", re: /12306\.cn/i },
  { id: "baidu", re: /baidu\.com/i },
  { id: "bing", re: /bing\.com/i },
  { id: "google", re: /google\.com\/search/i },
];

export function laneForCap(cap: string, covers: string[] = []): SiteLane | undefined {
  if (cap === "hotel_search" || covers.includes("stay")) return "hotel";
  if (cap === "flight_search" || covers.includes("flights")) return "flight";
  if (cap === "train_search" || covers.includes("trains")) return "train";
  if (cap === "search_read" || covers.includes("food") || covers.includes("sights") || covers.includes("report")) {
    return "search";
  }
  return undefined;
}

export function isLegalSite(lane: SiteLane, site: string): boolean {
  return LANE_IDS[lane].includes(site);
}

export function lockedSite(raw: string, lane: SiteLane): string | undefined {
  const t = String(raw || "");
  const keys = Object.keys(ALIAS).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    const id = ALIAS[key];
    if (!LANE_IDS[lane].includes(id)) continue;
    const re = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    if (re.test(t)) return id;
  }
  return undefined;
}

export function siteFromUrl(url: string): string | undefined {
  const hit = URL_HINT.find((h) => h.re.test(url || ""));
  return hit?.id;
}

export function fallbackOrder(lane: SiteLane, city?: string): string[] {
  if (lane === "hotel") {
    return city && isChinaCity(city) ? ["ctrip", "tuniu"] : ["booking", "airbnb", "ctrip"];
  }
  if (lane === "flight") {
    return city && isChinaCity(city) ? ["ctrip", "qunar"] : ["kayak", "gflights"];
  }
  if (lane === "train") return ["12306", "ctrip"];
  return ["baidu", "bing"];
}

export function triedSites(
  findings: { url?: string; step?: { site?: string } }[],
  lane: SiteLane,
): string[] {
  const out: string[] = [];
  for (const f of findings) {
    const id = f.step?.site || siteFromUrl(f.url || "");
    if (id && isLegalSite(lane, id) && !out.includes(id)) out.push(id);
  }
  return out;
}

export function nextLegalSite(opts: {
  lane: SiteLane;
  raw: string;
  city?: string;
  tried: string[];
  want?: string;
}): string | undefined {
  const lock = lockedSite(opts.raw, opts.lane);
  if (lock) return opts.tried.includes(lock) ? undefined : lock;
  if (opts.want && isLegalSite(opts.lane, opts.want) && !opts.tried.includes(opts.want)) {
    return opts.want;
  }
  return fallbackOrder(opts.lane, opts.city).find((id) => !opts.tried.includes(id));
}

export function searchResultUrl(site: string, query: string): string | undefined {
  const q = encodeURIComponent(query);
  if (site === "baidu") return `https://www.baidu.com/s?wd=${q}`;
  if (site === "bing") return `https://www.bing.com/search?q=${q}`;
  if (site === "google") return `https://www.google.com/search?q=${q}`;
  return undefined;
}

export function siteLabel(id: string): string {
  const names: Record<string, string> = {
    ctrip: "携程",
    tuniu: "途牛",
    booking: "Booking",
    airbnb: "Airbnb",
    qunar: "去哪儿",
    kayak: "Kayak",
    gflights: "Google Flights",
    "12306": "12306",
    baidu: "百度",
    bing: "必应",
    google: "谷歌",
  };
  return names[id] || id;
}
