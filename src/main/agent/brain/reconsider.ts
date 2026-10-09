/**
 * 观察后重分类：页上结果可以改题、补块，不能删原话点名的交付物，不能投票 ask。
 */
import { looksLikeResearchAsk, looksLikeResearchBody } from "../research-report.js";
import { isHotelUrl } from "../kernel/verify.js";
import {
  compileHands,
  kindFromDeliverables,
  DELIVERABLE_IDS,
  type AgentGoal,
  type AgentStep,
  type Deliverable,
  type DeliverableId,
  type LoopCap,
  type StepFinding,
} from "../loop.js";
import { CAP_REGISTRY } from "../kernel/caps.js";
import { canonCity } from "../place.js";
import { understandLocal, HEARD_IDS, type HeardId } from "./understand.js";
import {
  isLegalSite,
  laneForCap,
  lockedSite,
  nextLegalSite,
  siteLabel,
  triedSites,
} from "./sites.js";
import type { ActiveMission } from "../runtime.js";

const LEGAL_CAPS = new Set(CAP_REGISTRY.map((c) => c.id));

export type RetrySpec = {
  cap: string;
  query?: string;
  city?: string;
  covers?: HeardId[];
  label?: string;
  site?: string;
};

export type Reconsider = {
  same: boolean;
  heard?: string;
  add: HeardId[];
  drop: HeardId[];
  why: string;
  nextCap?: string;
  retry?: RetrySpec;
};

function uniqIds(ids: HeardId[]): HeardId[] {
  const out: HeardId[] = [];
  for (const id of ids) {
    if (HEARD_IDS.includes(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

function lastFinding(findings: StepFinding[]): StepFinding | undefined {
  return findings[findings.length - 1];
}

function rawAllowsTransport(raw: string, id: HeardId): boolean {
  if (id === "flights") return /机票|航班|flight/i.test(raw);
  if (id === "trains") return /高铁|火车|车票|train/i.test(raw);
  return true;
}

function defaultQuery(goal: AgentGoal, covers: string[], city: string): string {
  const tag = [goal.known.audience, goal.known.cheaper ? "便宜" : ""].filter(Boolean).join(" ");
  const names = covers.map((id) => LABEL[id as DeliverableId] || id).join(" ");
  return `${city} ${names} ${tag} 推荐`.replace(/\s+/g, " ").trim();
}

function failedSameCover(findings: StepFinding[], covers: string[]): number {
  return findings.filter((f) => !f.ok && f.step.covers.some((c) => covers.includes(c))).length;
}

/** 只用登记过的手。换查询、换城，不能发明 cap。 */
export function composeStep(
  goal: AgentGoal,
  findings: StepFinding[],
  retry: RetrySpec,
): AgentStep | undefined {
  if (!LEGAL_CAPS.has(retry.cap as LoopCap) || retry.cap === "ask") return undefined;
  const last = lastFinding(findings);
  const covers = (
    retry.covers?.filter((id) => DELIVERABLE_IDS.includes(id as DeliverableId)) ||
    last?.step.covers ||
    []
  ) as DeliverableId[];
  if (!covers.length) return undefined;
  const city = canonCity(retry.city || last?.step.city || goal.known.cities?.[0] || "") || "";
  const query = (retry.query || "").trim().slice(0, 80) || defaultQuery(goal, covers, city);
  if (failedSameCover(findings, covers) >= 2 && !retry.query && !retry.site) return undefined;
  const lane = laneForCap(retry.cap, covers);
  const lock = lane ? lockedSite(goal.raw, lane) : undefined;
  let site = retry.site || undefined;
  if (site && lane && !isLegalSite(lane, site)) site = undefined;
  if (lock) site = lock;
  return {
    id: `compose-${retry.cap}-${covers.join("-")}-${site || ""}-${query.replace(/\s+/g, "").slice(0, 16)}-${findings.length}`,
    cap: retry.cap as LoopCap,
    label: retry.label || (site ? `换到${siteLabel(site)}再查` : `换个查法：${query.slice(0, 24)}`),
    covers,
    query,
    city: city || undefined,
    site,
  };
}

function localRetry(goal: AgentGoal, last: StepFinding, findings: StepFinding[]): RetrySpec | undefined {
  const text = last.text || "";
  if (/登录|验证码|人机验证|请先登录/.test(text)) return undefined;
  const thin = !last.ok || text.length < 40;
  if (!thin) return undefined;
  const covers = last.step.covers;
  if (failedSameCover(findings, covers) >= 2) return undefined;
  const city = last.step.city || goal.known.cities?.[0] || "";
  const cap = last.step.cap === "hotel_search" && city ? "hotel_search" : last.step.cap === "flight_search" ? "flight_search" : last.step.cap === "train_search" ? "train_search" : "search_read";
  const lane = laneForCap(cap, covers);
  const tried = lane ? triedSites(findings, lane) : [];
  if (last.step.site && !tried.includes(last.step.site)) tried.push(last.step.site);
  const site = lane
    ? nextLegalSite({ lane, raw: goal.raw, city, tried })
    : undefined;
  return {
    cap,
    query: defaultQuery(goal, covers, city),
    city,
    covers: covers.filter((c) => HEARD_IDS.includes(c as HeardId)) as HeardId[],
    site,
    label: site
      ? `换到${siteLabel(site)}补${covers.map((c) => LABEL[c] || c).join("、")}`
      : `换个查法补${covers.map((c) => LABEL[c] || c).join("、")}`,
  };
}

/** 没模型时也能根据页上正文改题：对照材料补 report；页没用就换查询。 */
export function reconsiderLocal(goal: AgentGoal, findings: StepFinding[]): Reconsider {
  const last = lastFinding(findings);
  if (!last) return { same: true, add: [], drop: [], why: "还没有观察。" };
  const text = last.text || "";
  const hotel = isHotelUrl(last.url || "");
  if (hotel && last.ok) {
    return { same: true, add: [], drop: [], why: "酒店页不能改成餐厅或对照题。" };
  }
  if (/登录|验证码|人机验证|请先登录/.test(text)) {
    return { same: true, add: [], drop: [], why: "页上要人先处理，不改题。" };
  }
  const add: HeardId[] = [];
  const hasReport = goal.deliverables.some((d) => d.id === "report");
  if (
    last.ok &&
    !hasReport &&
    !hotel &&
    (looksLikeResearchBody(text) || looksLikeResearchAsk(goal.raw)) &&
    /对比|比价|值不值得|调研|评测|报价|推荐几/.test(`${goal.raw}\n${text}`)
  ) {
    add.push("report");
  }
  const retry = localRetry(goal, last, findings);
  return {
    same: add.length === 0 && !retry,
    add,
    drop: [],
    why: add.length ? "页上是对照材料，补上报告。" : retry ? "这一页没用，换查询再查。" : "仍是原来那道题。",
    retry,
  };
}

export function reconsiderPrompt(goal: AgentGoal, findings: StepFinding[]): string {
  const last = lastFinding(findings);
  const seen = findings
    .map((f) => `${f.ok ? "完成" : "失败"} ${f.step.cap} ${f.step.label} ${(f.url || "").slice(0, 48)}\n${(f.text || "").slice(0, 180)}`)
    .join("\n---\n");
  return [
    "你是 Sparo 的大脑。刚看完一页。判断：还是原来那道题吗？要不要补一块、换个查法、或换站？",
    "不要把任务推回给用户（不输出 ask）。不要删用户原话点名的块。",
    "原话说了「机票/航班/flight」就允许加 flights；说了「高铁/火车/车票」就允许加 trains；原话没说就不要加。",
    "酒店列表页上的「餐厅」二字不是新的餐厅题；但酒店页本身是住宿题的答案，要不要补吃/玩看你判断。",
    "retry 只能用已有的手：hotel_search / search_read / flight_search / train_search / video_search / read_page。",
    "换站只能用表内 id：酒店 ctrip/tuniu/booking/airbnb，机票 ctrip/qunar/kayak/gflights，检索 baidu/bing，火车 12306/ctrip。",
    "用户点名的站不要换。页太空或失败时换查询或换站，不要发明新 cap。",
    `原话：${goal.raw}`,
    `当前理解：${goal.intent}`,
    `必须交付：${goal.deliverables.map((d) => d.id).join("、")}`,
    last ? `这一步：${last.step.label} ${last.ok ? "成功" : "失败"}` : "",
    seen ? `观察：\n${seen}` : "还没有观察。",
    '只输出 JSON：{"same":true,"heard":"","add":[],"drop":[],"why":"","retry":{"cap":"search_read","query":"","city":"","covers":["food"],"site":"bing"}}',
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseReconsiderJson(raw: string): Partial<Reconsider> | null {
  const m = String(raw || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as Record<string, unknown>;
    const asIds = (xs: unknown): HeardId[] =>
      (Array.isArray(xs) ? xs : [])
        .map((x) => String(x))
        .filter((id): id is HeardId => HEARD_IDS.includes(id as HeardId));
    if (String(j.decision || j.nextCap || "") === "ask") {
      return { same: true, add: [], drop: [], why: "模型不能问人。" };
    }
    const retryRaw = j.retry && typeof j.retry === "object" ? (j.retry as Record<string, unknown>) : undefined;
    const retry: RetrySpec | undefined = retryRaw
      ? {
          cap: String(retryRaw.cap || j.nextCap || ""),
          query: retryRaw.query ? String(retryRaw.query).slice(0, 80) : undefined,
          city: retryRaw.city ? String(retryRaw.city) : undefined,
          covers: asIds(retryRaw.covers),
          label: retryRaw.label ? String(retryRaw.label).slice(0, 40) : undefined,
          site: retryRaw.site ? String(retryRaw.site) : undefined,
        }
      : j.nextCap && j.nextCap !== "ask"
        ? { cap: String(j.nextCap) }
        : undefined;
    return {
      same: j.same !== false,
      heard: j.heard ? String(j.heard).slice(0, 80) : undefined,
      add: asIds(j.add),
      drop: asIds(j.drop),
      why: j.why ? String(j.why).slice(0, 120) : "",
      nextCap: j.nextCap ? String(j.nextCap) : undefined,
      retry,
    };
  } catch {
    return null;
  }
}

export function mergeReconsider(local: Reconsider, model: Partial<Reconsider>): Reconsider {
  return {
    same: model.same !== false && local.add.length === 0,
    heard: model.heard || local.heard,
    add: uniqIds([...local.add, ...(model.add || [])]),
    drop: uniqIds(model.drop || []),
    why: model.why || local.why,
    nextCap: model.nextCap,
    retry: model.retry?.cap ? model.retry : local.retry,
  };
}

const LABEL: Record<DeliverableId, string> = {
  stay: "住宿",
  food: "餐厅",
  sights: "景点",
  itinerary: "日程",
  flights: "机票",
  trains: "车票",
  report: "对照报告",
  page: "读懂当前页",
  form: "填表",
  video: "视频",
  answer: "直接回答",
};

function asDeliverable(id: DeliverableId): Deliverable {
  return { id, label: LABEL[id], required: true };
}

/** 尺子：原话点名的块锁死；机票/火车必须原话说过。酒店页要不要补吃/玩由模型判断，本地不硬拦。 */
export function applyReconsider(goal: AgentGoal, findings: StepFinding[], patch: Reconsider): AgentGoal {
  const locked = new Set(understandLocal(goal.raw).deliverables);
  const ids: DeliverableId[] = goal.deliverables.filter((d) => d.required).map((d) => d.id);
  for (const id of patch.drop) {
    if (locked.has(id)) continue;
    const at = ids.indexOf(id as DeliverableId);
    if (at >= 0) ids.splice(at, 1);
  }
  for (const id of patch.add) {
    if (!DELIVERABLE_IDS.includes(id as DeliverableId)) continue;
    if (!rawAllowsTransport(goal.raw, id)) continue;
    if (!ids.includes(id as DeliverableId)) ids.push(id as DeliverableId);
  }
  const derived = kindFromDeliverables(ids);
  return {
    ...goal,
    intent: patch.heard || goal.intent,
    approach: patch.why || goal.approach,
    deliverables: ids.map((id) => asDeliverable(id)),
    kind: derived !== "chat" ? derived : goal.kind,
    decision: "act",
    ask: undefined,
  };
}

export async function reconsider(
  goal: AgentGoal,
  findings: StepFinding[],
  complete?: (prompt: string) => Promise<string>,
): Promise<Reconsider> {
  const local = reconsiderLocal(goal, findings);
  if (!complete) return local;
  try {
    const parsed = parseReconsiderJson(await complete(reconsiderPrompt(goal, findings)));
    if (parsed) return mergeReconsider(local, parsed);
  } catch {
    /* 模型失败用本地重分类 */
  }
  return local;
}

export async function reconsiderMission(
  mission: ActiveMission,
  complete?: (prompt: string) => Promise<string>,
): Promise<ActiveMission> {
  const patch = await reconsider(mission.goal, mission.findings, complete);
  const nudge = patch.retry ? composeStep(mission.goal, mission.findings, patch.retry) : undefined;
  if (patch.same && !patch.add.length && !patch.drop.length && !patch.heard && !nudge) return mission;
  const goal = applyReconsider(mission.goal, mission.findings, patch);
  const sameDels =
    goal.deliverables.map((d) => d.id).join() === mission.goal.deliverables.map((d) => d.id).join() &&
    goal.intent === mission.goal.intent;
  if (sameDels) return { ...mission, goal, nudge };
  return { ...mission, goal, plan: compileHands(goal), nudge };
}
