/**
 * 交付物契约：只做结构校验（step.covers.includes(id) && finding.ok）+ synthesized 长度兜底。
 * 语义判断（这页是不是真的有餐厅、价格对不对、酒店页上的餐厅算不算）交给模型在 reconsider 阶段判。
 */
import type { DeliverableId, AgentGoal, StepFinding, VerifyResult } from "../loop.js";

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

export function isHotelUrl(url: string): boolean {
  return /hotels?\.ctrip|hotel\.|\/hotel|booking\.com|airbnb\./i.test(url);
}

function unique(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const k = x.replace(/\s+/g, "").slice(0, 24);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

/** 从一步观察里抠可点实体。供 prompt/synthesis 用，不做覆盖判断。 */
export function extractEntities(text: string, id: DeliverableId): string[] {
  const lines = String(text || "")
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4 && s.length < 80);
  if (id === "stay") {
    return unique(
      lines.filter((s) => /酒店|宾馆|民宿|Hotel|客房|每晚|入住|希尔顿|万豪|如家|汉庭/i.test(s)),
    ).slice(0, 8);
  }
  if (id === "food") {
    return unique(
      lines.filter(
        (s) =>
          /餐厅|美食|必吃|料理|餐馆|小吃|米其林/i.test(s) &&
          !/大家还在搜|广告|热门搜索|相关搜索|为您推荐|百度热榜/.test(s),
      ),
    ).slice(0, 8);
  }
  if (id === "sights") {
    return unique(
      lines.filter(
        (s) =>
          /景点|博物馆|公园|海滩|必去|乐园|步行街|打卡/i.test(s) &&
          !/大家还在搜|广告|热门搜索|相关搜索|为您推荐|百度热榜/.test(s),
      ),
    ).slice(0, 8);
  }
  return [];
}

/**
 * 一步观察是否结构上覆盖某交付物。只看 step.covers 和 ok，不硬判页内容。
 * avoid/价格/酒店页餐厅等语义判断交给模型在 reconsider 阶段判。
 * 保留 opts 签名兼容旧调用，但不再使用。
 */
export function observationCovers(
  finding: StepFinding,
  id: DeliverableId,
  _opts?: { avoid?: string[] },
): boolean {
  return finding.ok && finding.step.covers.includes(id);
}

/** 把 findings 摘要成字符串，塞给模型判下一步/验收。 */
export function summaryFindings(findings: StepFinding[]): string {
  return findings
    .map((f) => `${f.ok ? "完成" : "失败"} ${f.step.cap} ${f.step.label} → ${(f.text || "").slice(0, 80)}`)
    .join("\n");
}

export function verifyContracts(
  goal: AgentGoal,
  findings: StepFinding[],
  opts?: { synthesized?: string },
): VerifyResult {
  const required = goal.deliverables.filter((d) => d.required).map((d) => d.id);
  const covered: DeliverableId[] = [];
  const synth = opts?.synthesized || "";
  for (const id of required) {
    if (id === "itinerary") {
      if (/第.?天|第一天|第二天|上午|下午|晚上/.test(synth)) covered.push(id);
      else if (findings.some((f) => observationCovers(f, id))) covered.push(id);
      continue;
    }
    if (id === "report") {
      if (findings.some((f) => observationCovers(f, id)) && synth.length > 40) {
        covered.push(id);
      }
      continue;
    }
    if (id === "answer") {
      if (synth.length > 20 || findings.some((f) => f.ok && f.text.length > 20)) covered.push(id);
      continue;
    }
    if (findings.some((f) => observationCovers(f, id))) {
      covered.push(id);
    }
  }
  const missing = required.filter((id) => !covered.includes(id));
  return {
    complete: missing.length === 0,
    covered,
    missing,
    notes: missing.length ? `还缺：${missing.map((id) => LABEL[id]).join("、")}` : "交付物已齐。",
  };
}

export function deliverableLabel(id: DeliverableId): string {
  return LABEL[id];
}
