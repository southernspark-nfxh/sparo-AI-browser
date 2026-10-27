/**
 * 墙钟停滞：循环挂起、长时间没有新观察。
 * 和「连续三步失败」分开。那边管还在跑的重复动作，这边管 5 分钟零消息。
 */

export const NO_PROGRESS_MS = 5 * 60 * 1000;

export type StallDecision =
  | { action: "continue" }
  | { action: "switch"; say: string }
  | { action: "close"; say: string };

const ALT_SITES: Record<string, string[]> = {
  train_search: ["12306", "ctrip"],
  hotel_search: ["ctrip", "tuniu", "booking"],
  flight_search: ["ctrip", "qunar", "kayak"],
  search_read: ["baidu", "bing"],
};

/** 同一只手换一个已经登记过的站。没有别的站就换不了。 */
export function alternateSite(cap: string, site?: string): string | undefined {
  const list = ALT_SITES[cap];
  if (!list) return undefined;
  const cur = site || list[0];
  return list.find((item) => item !== cur);
}

export function decideStall(input: {
  elapsedMs: number;
  waitingHuman: boolean;
  switched: boolean;
  tried: string[];
  lastNote?: string;
}): StallDecision {
  if (input.waitingHuman) return { action: "continue" };
  if (input.elapsedMs < NO_PROGRESS_MS) return { action: "continue" };
  if (!input.switched) {
    return { action: "switch", say: "这一步超过 5 分钟没有新进展，我换个入口再试一次。" };
  }
  const note = String(input.lastNote || "没有新结果").replace(/\s+/g, " ").trim().slice(0, 80);
  const tried = input.tried.map((item) => item.trim()).filter(Boolean);
  const where = tried.length ? `已试过的入口：${tried.join("、")}。` : "";
  return {
    action: "close",
    say: `${note} 没能继续。${where}这单先停在这里。`,
  };
}
