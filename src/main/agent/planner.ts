/**
 * 规划层：先对照能力清单理解用户要什么，再交给执行器。
 * 正则只做高置信快路径；句子一脏或像目标，就让模型填槽，不让它直接点网页。
 * 这是 Hermes / 龙虾的用法：模型是脑，浏览器能力是手。
 */
import {
  detectFlightSite,
  detectHotelSite,
  parseLooseCheckin,
  type TravelQuery,
} from "./travel.js";
import type { TripPlan } from "./trip-plan.js";
import { looksLikeMissionGoal, parseMission } from "./mission.js";

export type PlannedGoal =
  | { type: "trip_plan"; plan: TripPlan }
  | ({ type: "travel_search" } & TravelQuery)
  | { type: "none" };

const DIRTY_PLACE = /做一个|做一份|做个|出一份|帮我|旅游攻略|攻略/;

export function looksLikeTravelGoal(text: string): boolean {
  const t = text.trim();
  if (t.length < 8) return false;
  return /攻略|手册|行程|旅游|旅行|出游|怎么玩|机票|酒店|航班|出发|回来|往返|入住|出差/.test(
    t,
  );
}

export function travelParseLooksDirty(q: TravelQuery): boolean {
  const places =
    q.kind === "hotel"
      ? q.city
      : q.kind === "flight" || q.kind === "train" || q.kind === "maps"
        ? `${q.from} ${q.to}`
        : "";
  return DIRTY_PLACE.test(places);
}

export function shouldAskPlanner(
  action: { type: string } & Partial<TravelQuery>,
  text: string,
): boolean {
  if (action.type === "travel_search") return travelParseLooksDirty(action as TravelQuery);
  if (action.type === "llm") return looksLikeTravelGoal(text) || looksLikeMissionGoal(text);
  return false;
}

export function plannerPrompt(userAsk: string, now = new Date()): string {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return [
    "你是 Sparo 的规划器，不是操作员。只根据用户原话选择一项能力并填槽。",
    "禁止打开频道首页、禁止编造没写的城市。地名要从原话里抠，不要带「做一个/攻略/帮我」。",
    "今天是 " + today + "。年份默认今年；日期已过则用明年。",
    "能力：",
    "- trip_plan：往返/多城/攻略，且同时要机票和酒店（或明确要一份行程）",
    "- travel_search：只查一次酒店、一次机票、一次火车或一次路线",
    "- none：不是出行，或信息不够",
    "只输出一个 JSON，不要解释。字段：",
    'trip_plan: {"type":"trip_plan","origin":"北京","cities":["曼谷"],"startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD","nights":[6]}',
    '机票: {"type":"travel_search","kind":"flight","from":"北京","to":"曼谷","date":"YYYY-MM-DD"}',
    '酒店: {"type":"travel_search","kind":"hotel","city":"曼谷","checkin":"YYYY-MM-DD","checkout":"YYYY-MM-DD"}',
    '不确定: {"type":"none"}',
    "用户原话：",
    userAsk,
  ].join("\n");
}

function cleanCity(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw
    .replace(/帮我|做一个|做一份|做个|出一份|旅游攻略|攻略|的/g, "")
    .trim();
  if (t.length < 2 || t.length > 16) return null;
  if (/酒店|机票|航班|出发|回来|规划|行程/.test(t)) return null;
  return t;
}

function asIso(raw: unknown, now: Date): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const t = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  return parseLooseCheckin(t, now);
}

function extractJson(raw: string): unknown | null {
  const t = raw.trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : t).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function parsePlannerJson(raw: string, userAsk: string, now = new Date()): PlannedGoal | null {
  const j = extractJson(raw);
  if (!j || typeof j !== "object") return null;
  const o = j as Record<string, unknown>;
  const type = String(o.type || "");
  if (type === "none") return { type: "none" };

  if (type === "trip_plan") {
    const origin = cleanCity(o.origin) || "北京";
    const cities = (Array.isArray(o.cities) ? o.cities : [])
      .map(cleanCity)
      .filter((c): c is string => Boolean(c) && c !== origin);
    if (!cities.length) return null;
    const startDate = asIso(o.startDate, now);
    const endDate = asIso(o.endDate, now);
    if (!startDate || !endDate || endDate <= startDate) return null;
    const nights = Array.isArray(o.nights)
      ? o.nights.map((n) => Number(n)).filter((n) => n >= 1 && n <= 14)
      : undefined;
    return {
      type: "trip_plan",
      plan: {
        origin,
        cities,
        startDate,
        endDate,
        nights: nights?.length === cities.length ? nights : undefined,
        flightSite: detectFlightSite(userAsk),
        hotelSite: detectHotelSite(userAsk),
      },
    };
  }

  if (type === "travel_search") {
    const kind = String(o.kind || "");
    if (kind === "flight") {
      const from = cleanCity(o.from);
      const to = cleanCity(o.to);
      const date = asIso(o.date, now);
      if (!from || !to || !date) return null;
      return {
        type: "travel_search",
        kind: "flight",
        site: detectFlightSite(userAsk),
        from,
        to,
        date,
      };
    }
    if (kind === "hotel") {
      const city = cleanCity(o.city);
      const checkin = asIso(o.checkin, now);
      const checkout = asIso(o.checkout, now);
      if (!city || !checkin || !checkout) return null;
      return {
        type: "travel_search",
        kind: "hotel",
        site: detectHotelSite(userAsk),
        city,
        checkin,
        checkout,
      };
    }
  }

  return { type: "none" };
}

export async function planUserGoal(
  userAsk: string,
  complete: (prompt: string) => Promise<string>,
  now = new Date(),
): Promise<PlannedGoal | null> {
  const raw = await complete(plannerPrompt(userAsk, now));
  if (!raw.trim()) return null;
  return parsePlannerJson(raw, userAsk, now);
}
