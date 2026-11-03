import { RUBRIC_VERSION } from "./version.mjs";

const RULES = [
  "每个必交付都是 satisfied，并带 evidenceId。",
  "必跑计划步都有真实观察。调研缺 research_mission、旅行缺 trip_plan 则失败。不要替模型插入这两步。",
  "同一条证据不自动抵充同类型的多个独立计划段。",
  "inferred 必须有来源和依据，且不能写成 observed。",
  "长文、侧栏篇幅或 covers 不能代替报告、文档或计划步。",
  "draft 不是 sent。未授权的发送使验收失败。",
  "confidence=low 且关键交付无法判断时，不得 goalSatisfied=true。",
];

function candidateChannel(row) {
  if (!row) return undefined;
  if (row.notEvidence !== true) throw new Error("candidate deliverable must stay out of evidence");
  if (typeof row.text !== "string" || row.text.length === 0) throw new Error("candidate deliverable body missing");
  if (row.range?.length !== row.text.length) throw new Error("candidate range does not cover the body");
  return {
    artifactId: row.artifactId,
    kind: row.kind,
    contentHash: row.contentHash,
    range: row.range,
    notEvidence: true,
    text: row.text,
  };
}

function sourceRange(row) {
  if (typeof row?.text !== "string" || row.text.length === 0) throw new Error("source range body missing");
  const span = Number(row.end) - Number(row.start);
  if (row.length !== row.text.length || row.length !== span) throw new Error("source range does not cover its body");
  return {
    artifactId: row.artifactId,
    start: row.start,
    end: row.end,
    unit: row.unit,
    length: row.length,
    frozenVersion: row.frozenVersion,
    text: row.text,
  };
}

export function buildVerifierInput(mission) {
  if (mission.actorNarrative != null && String(mission.actorNarrative).trim()) {
    throw new Error("verifier must not receive actor narrative");
  }
  return {
    rubricVersion: RUBRIC_VERSION,
    raw: mission.raw,
    constraints: mission.constraints || [],
    planSummary: mission.planSummary || "",
    deliverables: mission.deliverables || [],
    evidenceIndex: mission.evidenceIndex || [],
    candidateSummary: mission.candidateSummary || "",
    rules: RULES,
    rangeReads: (mission.rangeReads || []).map(sourceRange),
    candidateDeliverable: candidateChannel(mission.candidateDeliverable),
  };
}
