/**
 * 能力登记表。手的契约：覆盖哪块交付物、什么时候能用。
 * 执行仍在 browser，这里只给推理器看菜单。
 */
import type { DeliverableId, LoopCap } from "../loop.js";

export type CapSpec = {
  id: LoopCap;
  covers: DeliverableId[];
  when: string;
};

export const CAP_REGISTRY: CapSpec[] = [
  { id: "hotel_search", covers: ["stay"], when: "有城，用户要住宿/酒店" },
  { id: "flight_search", covers: ["flights"], when: "有出发地、目的地、日期" },
  { id: "train_search", covers: ["trains"], when: "有出发地、目的地、日期" },
  { id: "search_read", covers: ["food", "sights", "report"], when: "检索页可读回实体" },
  { id: "video_search", covers: ["video"], when: "要视频/跟练" },
  { id: "read_page", covers: ["page"], when: "读当前页" },
  { id: "fill_form", covers: ["form"], when: "填当前表" },
  { id: "trip_plan", covers: ["stay", "flights", "itinerary"], when: "往返多城含机票" },
  { id: "mission", covers: ["report", "food", "sights"], when: "比价/调研/吃喝玩" },
  { id: "run_skill", covers: ["form"], when: "发布等已有技能" },
  { id: "feishu", covers: ["answer"], when: "飞书网页" },
  { id: "reply_draft", covers: ["answer"], when: "客服草稿" },
  { id: "print", covers: ["answer"], when: "打印当前页" },
  { id: "navigate", covers: ["answer"], when: "只打开一个站点" },
  { id: "act", covers: ["answer", "food", "sights"], when: "没有更合适的手，有限步探索" },
];

export function capsFor(id: DeliverableId): CapSpec[] {
  return CAP_REGISTRY.filter((c) => c.covers.includes(id));
}
