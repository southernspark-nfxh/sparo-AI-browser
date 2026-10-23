/**
 * 推理器：模型是大脑，本地只做最小校验 + 兜底。
 * 看见观察后模型自己决定下一步；失败或启发式已 ask/propose/synthesize 时走兜底。
 */
import {
  compileHands,
  isLegalCap,
  filterLegalCovers,
  type AgentGoal,
  type AgentStep,
  type DeliverableId,
  type LoopCap,
  type StepFinding,
} from "../loop.js";
import { verifyContracts } from "./verify.js";
import { canonCity } from "../place.js";
import { sameSite } from "../intent-router.js";
import { legalSiteTarget } from "../brain/understand.js";

export type Thought = {
  intent: string;
  deliverables: DeliverableId[];
  why: string;
  next?: AgentStep;
  ask?: string;
  propose?: string;
  synthesize?: boolean;
};

function usedStepIds(findings: StepFinding[]): Set<string> {
  return new Set(findings.filter((f) => f.ok).map((f) => f.step.id));
}

/** 对照缺块挑一手。排除的块不查；用户说先做的优先。启发式兜底用。 */
export function suggestNextStep(goal: AgentGoal, findings: StepFinding[]): AgentStep | undefined {
  const verdict = verifyContracts(goal, findings);
  const excluded = new Set<string>(goal.known.exclude || []);
  const prefer = goal.known.prefer || [];
  const missing = verdict.missing.filter((id) => id !== "answer" && !excluded.has(id));
  if (!missing.length) return undefined;
  const hasItineraryFinding = findings.some((f) => f.ok && f.step.covers.includes("itinerary"));
  const actionable = missing.filter((id) => id !== "itinerary");
  const first =
    prefer.find((id) => missing.includes(id)) ||
    (missing.includes("itinerary") && !hasItineraryFinding && !actionable.length
      ? "itinerary"
      : undefined) ||
    actionable[0];
  if (!first) return undefined;
  const used = usedStepIds(findings);
  const catalog = compileHands(goal);
  const hit = catalog.find((s) => s.covers.includes(first) && !used.has(s.id));
  if (hit) return hit;
  const city = goal.known.cities?.[0] || "";
  const tag = [goal.known.audience, goal.known.cheaper ? "便宜" : ""].filter(Boolean).join(" ");
  if (first === "itinerary") {
    return {
      id: `search_read-itinerary-${findings.length}`,
      cap: "search_read",
      label: `查 ${city || ""} 行程`.trim(),
      covers: ["itinerary"],
      query: `${city} ${tag} 行程 路线`.trim(),
      city,
    };
  }
  const label =
    first === "food"
      ? `查 ${city || ""} 餐厅`.trim()
      : first === "sights"
        ? `查 ${city || ""} 景点`.trim()
        : `补上${first}`;
  return {
    id: `explore-${first}-${findings.length}`,
    cap: "act",
    label,
    covers: [first],
    query: city
      ? `${city} ${label} ${tag} ${goal.raw.slice(0, 24)}`.trim()
      : `${goal.raw} —— 只要补上这一块：${first}`,
  };
}

function coverForSite(goal: AgentGoal): DeliverableId[] {
  const ids = goal.deliverables.filter((d) => d.required).map((d) => d.id);
  if (ids.includes("answer")) return ["answer"];
  if (ids.length) return [ids[0]];
  return ["answer"];
}

/** 目标站点还没打开：下一步只能是 navigate。当前页未知时不猜。 */
export function forcedSiteNavigate(
  goal: AgentGoal,
  pageUrl: string | undefined,
  findings: StepFinding[],
): AgentStep | undefined {
  if (!goal.site || !goal.siteUrl || pageUrl === undefined) return undefined;
  if (pageUrl && sameSite(pageUrl, goal.siteUrl)) return undefined;
  const opened = findings.some(
    (f) => f.ok && f.step.cap === "navigate" && Boolean(f.url) && sameSite(f.url, goal.siteUrl!),
  );
  if (opened) return undefined;
  return {
    id: `navigate-site-${goal.site}`,
    cap: "navigate",
    label: `打开 ${goal.site}`,
    covers: coverForSite(goal),
    query: goal.siteUrl,
  };
}

export type SiteGate =
  | { action: "allow" }
  | { action: "navigate"; step: AgentStep }
  | { action: "ask"; ask: string };

function navigateAttempted(goal: AgentGoal, findings: StepFinding[]): boolean {
  if (!goal.site || !goal.siteUrl) return false;
  return findings.some((f) => {
    if (f.step.cap !== "navigate") return false;
    const legal = legalSiteTarget(f.step.query || "");
    if (legal && (legal.host === goal.site || sameSite(legal.url, goal.siteUrl!))) return true;
    return Boolean(f.url && sameSite(f.url, goal.siteUrl!));
  });
}

/**
 * 收摊守门：人还在错页上时，说明文不能当交付。
 * 还没去过就 navigate；去过仍不在该站就问一句，不标完成。
 */
export function gateSiteDelivery(opts: {
  goal: AgentGoal;
  pageUrl?: string;
  findings: StepFinding[];
}): SiteGate {
  const goal = opts.goal;
  if (!goal.site || !goal.siteUrl) return { action: "allow" };
  const page = opts.pageUrl || "";
  if (page && sameSite(page, goal.siteUrl)) return { action: "allow" };
  if (!navigateAttempted(goal, opts.findings)) {
    const step = forcedSiteNavigate(goal, page, []);
    if (step) return { action: "navigate", step };
  }
  const login = /\/(login|signin|sign-in)|passport\./i.test(goal.siteUrl);
  const ask = login ? `要我先打开 ${goal.site} 登录页吗？` : `要我先打开 ${goal.site} 吗？`;
  return { action: "ask", ask };
}

/**
 * 原话只是打开一个点名的站，没有总结、搜索、对比这类后半句。
 * 这种单子的交付是站点本身，不是把首页正文写成阅读页。
 */
/** 原话没有要求读页、总结或对比。只打开页面时不要再把正文写成阅读页。 */
export function userDidNotAskToRead(goal: { raw?: string; intent?: string }): boolean {
  const raw = `${goal.raw || ""}\n${goal.intent || ""}`;
  return !/总结|摘要|提炼|概括|归纳|对比|比价|调研|评测|阅读|读一下|读这一页|这是什么/.test(raw);
}

export function openSiteIsTheJob(goal: { raw: string; site?: string }): boolean {
  if (!goal.site) return false;
  const raw = String(goal.raw || "").trim();
  if (!raw) return false;
  if (!/(?:打开|前往|进入)/.test(raw) && !/(?:^|[\s，,])去/.test(raw)) return false;
  const rest = raw
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/(?:请)?(?:帮我)?(?:打开|前往|进入)/g, "")
    .replace(/(?:^|[\s，,])去/g, "")
    .replace(/[\s，,。.!！？?、]/g, "");
  if (!rest) return true;
  if (/总结|摘要|提炼|概括|归纳|对比|比价|调研|评测|搜索|搜|查|看|推荐|热搜|填|发|登录|登陆|订|买|下载|注册/.test(rest)) {
    return false;
  }
  return true;
}

/** 登录地址已经打开过、站点却跳进站内时，交这一句并收工。换账号是下一句新任务。 */
export function loginRedirectNote(goal: AgentGoal, findings: StepFinding[]): string | undefined {
  const tried = findings.some(
    (f) => f.step.cap === "navigate" && /\/(login|signin|sign-in)|passport\./i.test(String(f.step.query || "")),
  );
  if (!tried || !goal.site) return undefined;
  return `已打开 ${goal.site} 的登录地址，站点把它跳回了现在这个页面，没有停在登录墙。`;
}

/** 已经站在目标站上时，问模型要不要再打开登录页。只收同站合法 URL。 */
export function siteLandingPrompt(goal: AgentGoal, pageUrl: string): string {
  return [
    "你是 Sparo。用户点名了一个网站，浏览器现在停在某一页。只输出 JSON，不要解释。",
    "用户要登录，而当前页不是该站登录页：{\"navigate\":\"登录页的完整 https URL\"}。这个 URL 必须属于目标站点。",
    "目标站是 weibo.com 且用户要登录、当前在首页时，输出 {\"navigate\":\"https://weibo.com/login.php\"}。",
    "当前页已经是用户要的那一页（登录页或结果页）才输出 {\"done\":true}。登录任务在首页不许 done。",
    "不许写为什么做不了。",
    `用户原话：${goal.raw}`,
    `目标站点：${goal.site || ""} ${goal.siteUrl || ""}`,
    `当前页：${pageUrl}`,
  ].join("\n");
}

function samePath(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    const host = (h: string) => h.replace(/^www\./i, "");
    return host(ua.hostname) === host(ub.hostname) && ua.pathname.replace(/\/$/, "") === ub.pathname.replace(/\/$/, "");
  } catch {
    return false;
  }
}

export function parseSiteLanding(
  raw: string,
  goal: AgentGoal,
  pageUrl?: string,
): { navigate: string } | { done: true } | null {
  if (!goal.site) return null;
  const m = String(raw || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as { navigate?: string; done?: boolean };
    if (j.navigate) {
      const legal = legalSiteTarget(String(j.navigate));
      if (!legal) return null;
      const expected = goal.siteUrl || `https://${goal.site}/`;
      const onTarget = legal.host === goal.site || legal.host.endsWith(`.${goal.site}`) || sameSite(legal.url, expected);
      if (!onTarget) return null;
      if (pageUrl && samePath(legal.url, pageUrl)) return null;
      return { navigate: legal.url };
    }
    if (j.done === true) return { done: true };
  } catch {
    return null;
  }
  return null;
}

/** 错配收摊的结果。说明文不会变成 done。 */
export function mismatchWrap(opts: {
  goal: AgentGoal;
  pageUrl: string;
  findings: StepFinding[];
  explanation: string;
}): { state: "done" | "running" | "waiting_human"; text: string; navigateTo?: string } {
  const gate = gateSiteDelivery(opts);
  if (gate.action === "navigate") {
    return { state: "running", text: "", navigateTo: gate.step.query };
  }
  if (gate.action === "ask") {
    return { state: "waiting_human", text: gate.ask };
  }
  return { state: "done", text: opts.explanation };
}

export function nextThought(input: {
  intent: string;
  goal: AgentGoal;
  findings: StepFinding[];
  state: string;
  ask?: string;
  synthesized?: string;
  nudge?: AgentStep;
  pageUrl?: string;
}): Thought {
  const dels = input.goal.deliverables.filter((d) => d.required).map((d) => d.id);
  const base = {
    intent: input.intent,
    deliverables: dels,
    why: input.goal.approach,
  };
  if (input.state === "blocked") {
    return { ...base, ask: input.ask || input.goal.ask || "还缺一项才能动手。", why: "合法空槽未齐。" };
  }
  if (input.state === "propose") {
    return { ...base, propose: input.goal.approach, why: "省名拆城是假设，先给你看。" };
  }
  const forced = forcedSiteNavigate(input.goal, input.pageUrl, input.findings);
  if (forced) {
    return { ...base, next: forced, why: "目标站点与当前页不符，先打开该站。" };
  }
  const verdict = verifyContracts(input.goal, input.findings, { synthesized: input.synthesized });
  if (verdict.complete) {
    return { ...base, synthesize: true, why: "交付物已齐，汇总。" };
  }
  const seen = new Set(input.findings.map((f) => f.step.id));
  let next =
    (input.nudge && !seen.has(input.nudge.id) ? input.nudge : undefined) ||
    suggestNextStep(input.goal, input.findings);
  // answer-only 单：suggestNextStep 把 answer 当兜底过滤了，这里手动挑一只 cover answer 的手
  if (!next && !verdict.complete) {
    const answerHand = compileHands(input.goal).find(
      (s) => s.covers.includes("answer") && !seen.has(s.id),
    );
    if (answerHand) next = answerHand;
  }
  if (!next) {
    return { ...base, synthesize: true, why: verdict.notes };
  }
  return {
    ...base,
    next,
    why: input.nudge && next.id === input.nudge.id ? `换个查法：${next.label}` : `${verdict.notes}。下一步：${next.label}`,
  };
}

/**
 * 解析模型输出的下一步。模型自由表达 next/ask/synthesize。
 * 接受 {next:{cap,covers,query,city,site,label,why}} 或顶层平铺字段。
 * 不再强制"从菜单挑"——合法性校验留给 applyModelPick。
 */
export function parseReasonerJson(raw: string): {
  cap?: string;
  covers?: string[];
  query?: string;
  city?: string;
  site?: string;
  label?: string;
  why?: string;
  ask?: string;
  synthesize?: boolean;
} | null {
  const m = String(raw || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as {
      next?: { cap?: string; covers?: unknown; query?: string; city?: string; site?: string; label?: string; why?: string };
      cap?: string;
      covers?: unknown;
      query?: string;
      city?: string;
      site?: string;
      label?: string;
      why?: string;
      ask?: string;
      synthesize?: boolean;
    };
    const nx = j.next || {};
    const cap = String(nx.cap || j.cap || "");
    const coversRaw = Array.isArray(nx.covers) ? nx.covers : Array.isArray(j.covers) ? j.covers : [];
    const ask = j.ask ? String(j.ask) : undefined;
    const synthesize = j.synthesize === true;
    if (!cap && !ask && !synthesize) return null;
    return {
      cap: cap || undefined,
      covers: coversRaw.map((c) => String(c)),
      query: nx.query || j.query,
      city: nx.city || j.city,
      site: nx.site || j.site,
      label: nx.label || j.label,
      why: j.why || nx.why ? String(j.why || nx.why) : undefined,
      ask,
      synthesize,
    };
  } catch {
    return null;
  }
}

/**
 * 把模型挑的下一步套上最小校验：cap ∈ LOOP_CAP_SET、covers ⊆ DELIVERABLE_IDS。
 * 模型说 ask：透传（模型是大脑，由它判断要不要问用户，本地不二次拦截）。
 * 模型说 synthesize：透传（交给契约层验收）。
 * 模型给非法 cap 或空 covers：退回启发式兜底。
 */
export function applyModelPick(
  heuristic: Thought,
  pick: ReturnType<typeof parseReasonerJson>,
): Thought {
  if (!pick) return heuristic;
  if (pick.synthesize) {
    return { ...heuristic, synthesize: true, next: undefined, why: pick.why || heuristic.why };
  }
  if (pick.ask) {
    return { ...heuristic, ask: pick.ask, next: undefined, why: pick.why || "模型判断需要问用户。" };
  }
  const cap = pick.cap || "";
  if (!isLegalCap(cap)) return heuristic;
  const covers = filterLegalCovers(pick.covers || []);
  if (!covers.length) return heuristic;
  const city = pick.city ? canonCity(pick.city) || "" : "";
  const next: AgentStep = {
    id: `${cap}-${covers.join("-")}-${(pick.label || city || pick.query || "").replace(/\s+/g, "").slice(0, 20)}`,
    cap: cap as LoopCap,
    label: pick.label || covers.join("、"),
    covers,
    query: pick.query?.slice(0, 80),
    city: city || undefined,
    site: pick.site,
  };
  return { ...heuristic, next, why: pick.why || `${heuristic.why}。模型选了 ${next.label}` };
}

/**
 * 给模型完整上下文：已做、还缺、可用的手（作为信息而非约束）。
 * 模型自己决定下一步，不再从菜单里挑。
 */
export function reasonerPromptV2(goal: AgentGoal, findings: StepFinding[], pageUrl?: string): string {
  const seen = findings
    .map((f) => `${f.ok ? "完成" : "失败"} ${f.step.cap} ${f.step.label} → ${(f.text || "").slice(0, 60)}`)
    .join("\n");
  const verdict = verifyContracts(goal, findings);
  const catalog = compileHands(goal);
  return [
    "你是 Sparo 的大脑。看见已做的和还缺的，自己决定下一步用哪只手。",
    "原则：",
    "- 不要把任务推回给用户。能动手就动手。除非真缺合法空槽（出发地、日期、人数等），才输出 ask。",
    "- 硬规则：目标点名了站点（见「目标站点」）而当前页域名不是它，第一步 next 必须是 navigate，query 用该站 URL。不许在错页上读页、搜索或汇总，也不许写「为什么做不了」。解释为什么做不了永远不是交付。",
    "- 交付物都齐了就输出 synthesize: true。人还停在别的网站上时不许 synthesize。",
    "- cap 只能用：trip_plan / hotel_search / flight_search / train_search / search_read / video_search / read_page / fill_form / mission / feishu / run_skill / reply_draft / print / navigate / act / synthesize。",
    "- covers 用交付物 id：stay food sights itinerary flights trains report page form video answer。",
    "- site 只能用：酒店 ctrip/tuniu/booking/airbnb，机票 ctrip/qunar/kayak/gflights，检索 baidu/bing，火车 12306/ctrip。用户点名的站不要换。",
    "- search_read 的 query 用用户原话里的主题词（城市 + 原话主题），不要替换成别的商品、行业或关联词（用户说「展览」就搜展览，不要搜成礼品展/博览会）。",
    `目标：${goal.intent}`,
    goal.site ? `目标站点：${goal.site} ${goal.siteUrl || ""}` : "目标站点：未点名",
    pageUrl ? `当前页：${pageUrl}` : "",
    `原话：${goal.raw}`,
    `必须交付：${goal.deliverables.map((d) => d.id).join("、")}`,
    `已知：${JSON.stringify(goal.known)}`,
    seen ? `已观察到：\n${seen}` : "还没有观察。",
    `还缺：${verdict.missing.join("、") || "（都齐了，可汇总）"}`,
    `可用的手（参考，不是约束）：${catalog.map((s) => `${s.cap}(${s.covers.join(",")})`).join(" / ")}`,
    '只输出 JSON：{"next":{"cap":"...","covers":["stay"],"query":"...","city":"...","site":"...","label":"..."},"why":"..."} 或 {"synthesize":true,"why":"..."} 或 {"ask":"还缺X才能动手","why":"..."}',
  ]
    .filter(Boolean)
    .join("\n");
}

/** 有模型时让模型决定下一步；失败或启发式已 ask/propose/synthesize 就走兜底。 */
export async function nextThoughtAsync(
  input: {
    intent: string;
    goal: AgentGoal;
    findings: StepFinding[];
    state: string;
    ask?: string;
    synthesized?: string;
    nudge?: AgentStep;
    pageUrl?: string;
  },
  complete?: (prompt: string) => Promise<string>,
): Promise<Thought> {
  const heuristic = nextThought(input);
  if (heuristic.next?.id.startsWith("navigate-site-")) return heuristic;
  if (!complete || heuristic.ask || heuristic.propose || heuristic.synthesize || !heuristic.next) {
    return heuristic;
  }
  try {
    const parsed = parseReasonerJson(await complete(reasonerPromptV2(input.goal, input.findings, input.pageUrl)));
    const modelThought = applyModelPick(heuristic, parsed);
    // 模型选了 trip_plan / mission / run_skill 但 step 里缺执行数据
    //（applyModelPick 不带 trip/mission/action）→ 从 compileHands 里补
    const ns = modelThought.next;
    if (ns && ns.cap === "trip_plan" && !ns.trip) {
      const hand = compileHands(input.goal).find((s) => s.cap === "trip_plan");
      if (hand?.trip) ns.trip = hand.trip;
    }
    if (ns && ns.cap === "mission" && !ns.mission) {
      const hand = compileHands(input.goal).find((s) => s.cap === "mission");
      if (hand?.mission) ns.mission = hand.mission;
    }
    if (ns && ns.cap === "run_skill" && !ns.action) {
      const hand = compileHands(input.goal).find((s) => s.cap === "run_skill");
      if (hand?.action) ns.action = hand.action;
    }
    return modelThought;
  } catch {
    return heuristic;
  }
}
