/**
 * Agent 共用类型。工作单、槽位、Brief 都在这里，避免脑和手互相引用。
 */
import type { TripPlan } from "./trip-plan.js";

export type BriefKind =
  | "trip"
  | "eatplay"
  | "travel"
  | "research"
  | "page"
  | "publish"
  | "form"
  | "chat"
  | "control";

/** 交付物块。事实层的排除/优先用同一套 id，不跟 kind 绑死。 */
export type KnownBlock =
  | "stay"
  | "food"
  | "sights"
  | "itinerary"
  | "flights"
  | "trains"
  | "report";

export type BriefKnown = {
  origin?: string;
  region?: string;
  cities?: string[];
  start?: string;
  end?: string;
  hotelPriceMax?: number;
  hotelMinRating?: number;
  exclude?: KnownBlock[];
  prefer?: KnownBlock[];
  audience?: string;
  cheaper?: boolean;
  /** 住宿软排除，如「机场」。不是交付物块。 */
  hotelAvoid?: string[];
};

export type Brief = {
  need: string;
  kind: BriefKind;
  known: BriefKnown;
  unknown: string[];
  approach: string;
  ready: boolean;
  needsConfirm: boolean;
  ask?: string;
  plan?: TripPlan;
  attach?: "last" | "new";
  /** 上一张单要交的块。约束短句续跑时用，避免「便宜点」把目标重解析成闲聊。 */
  wants?: string[];
};

/** 只有这些能把工作单打成 blocked。模型不能发明新槽。 */
export type SlotId = "origin" | "origin_confirm" | "destination" | "start";

export const SLOT_LABEL: Record<SlotId, string> = {
  origin: "出发地",
  origin_confirm: "出发地确认",
  destination: "目的地",
  start: "出发日",
};

export function slotAsk(id: SlotId, homeCity?: string): string {
  if (id === "origin") return "从哪座城出发？";
  if (id === "origin_confirm") return homeCity ? `按${homeCity}出发可以吗？` : "从哪座城出发？";
  if (id === "destination") return "想去哪座城？";
  return "哪天出发、哪天回？";
}

export type MissionState =
  | "blocked"
  | "propose"
  | "running"
  | "waiting_human"
  | "done"
  | "cancelled";

export type IngestKind =
  | "protocol_pause"
  | "protocol_resume"
  | "cancel"
  | "confirm"
  | "revise"
  | "slot_fill"
  | "side"
  | "continue"
  | "amend"
  | "new";

export type Ingest = {
  kind: IngestKind;
  city?: string;
};
