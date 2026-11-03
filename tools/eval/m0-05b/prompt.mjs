import crypto from "node:crypto";

export const PROMPT_VERSION = "verifier-prompt-1";

const SYSTEM = `你是独立 Verifier，没有浏览器或外部工具。
不要接受 Actor 的完成自述。候选摘要不是证据。
只根据给定的原句、约束、计划摘要、交付契约、证据索引、候选摘要，以及已经列出的 Artifact 区间做判断。
区间没给出的正文，不要当成已经读过。
按 verifier-rubric-1 输出一个 JSON 对象，不要写别的文字。字段：
goalSatisfied, confidence, rationale, deliverables, unexecutedStepIds, invalidEvidenceIds, actionableGaps。
confidence 只能是 high、medium 或 low。
goalSatisfied 为 true 时，每个必交付都必须是 satisfied 且带 evidenceIds。
inferred 没有来源和依据时不得通过。draft 不得写成 sent。
confidence 为 low 且关键交付无法判断时，goalSatisfied 必须是 false。`;

export function promptHash() {
  return crypto.createHash("sha256").update(SYSTEM, "utf8").digest("hex");
}

export function verifierMessages(input) {
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: JSON.stringify(input) },
  ];
}
