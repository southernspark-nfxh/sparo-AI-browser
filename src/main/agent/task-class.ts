/**
 * 前后台任务分类。只查已有 kind / cap，不新写句子正则。
 * 拿不准的默认 foreground：宁可串行，不抢屏幕。
 */
import { classifyKind } from "./slots.js";
import { parseMission } from "./mission.js";
import { routeUserGoal } from "./intent-router.js";

export type TaskLane = "foreground" | "background";

/** 同人同窗：填表、回复、发帖、读当前页、闲聊、控制。 */
const FOREGROUND = new Set<string>([
  "fill_form",
  "form",
  "reply_draft",
  "one_click_reply",
  "reply",
  "feishu",
  "print",
  "publish",
  "page",
  "summarize",
  "chat",
  "control",
  "navigate",
  "act",
  "qa",
  "pause",
  "llm",
  "reader_mode",
  "reader_companion",
  "notes_action",
  "notes_search",
  "payment",
  "pay",
  "login",
  "waiting_human",
  "list_skills",
  "run_skill",
  "workflow",
  "set_title",
  "translate_title",
  "dxm_guide",
]);

/**
 * 调研 / 比价 / 出差 / 长检索。MissionKind 全表都在这里。
 * 新增 kind 没进表之前默认前台。
 */
const BACKGROUND = new Set<string>([
  "mission",
  "local_outing",
  "compare_shop",
  "research",
  "job_apply",
  "rent",
  "hospital",
  "gov_errand",
  "course",
  "papers",
  "logistics",
  "home_appliance",
  "weather",
  "movies",
  "translate",
  "download",
  "attractions",
  "sourcing",
  "insurance",
  "events",
  "social_hot",
  "cross_border",
  "saas",
  "supply",
  "tech_pick",
  "media_ops",
  "industry",
  "travel_search",
  "travel",
  "trip_plan",
  "trip",
  "eatplay",
  "search_read",
  "monitor",
  "hotel_search",
  "flight_search",
  "train_search",
  "video_search",
]);

export function laneFor(kind: string, step?: { cap?: string }): TaskLane {
  const cap = (step?.cap || "").trim();
  if (cap && FOREGROUND.has(cap)) return "foreground";
  if (cap && BACKGROUND.has(cap)) return "background";
  const name = (kind || "").trim();
  if (FOREGROUND.has(name)) return "foreground";
  if (BACKGROUND.has(name)) return "background";
  return "foreground";
}

/** 用现有路由 / 工作单 / 简报分类看这一句该走哪条车道。 */
export function laneForText(text: string): TaskLane {
  const routed = routeUserGoal(text);
  if (routed) {
    if (routed.type === "mission") return laneFor(routed.mission.kind);
    if (routed.type === "travel_search") return laneFor("travel_search");
    if (routed.type === "trip_plan") return laneFor("trip_plan");
    return laneFor(routed.type);
  }
  const mission = parseMission(text);
  if (mission) return laneFor(mission.kind);
  return laneFor(classifyKind(text));
}
