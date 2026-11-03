import fs from "node:fs";
import path from "node:path";
import { readRange } from "./artifact-store.mjs";
import { callConfiguredModel } from "./model.mjs";
import { evalOutDir } from "./paths.mjs";
import { replayMission } from "./replay.mjs";
import { buildVerifierInput } from "./verifier-input.mjs";
import { FACILITY_VERSION } from "./version.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const journal = path.join(process.env.APPDATA || "", "sparo-store", "missions.jsonl");
const before = fs.existsSync(journal) ? fs.statSync(journal) : null;

const range = readRange("art-m005a-r1-apple-iphone16", 200, 500);
const again = readRange("art-m005a-r1-apple-iphone16", 200, 500);
assert(range.text === again.text && range.length === 300, "range reread failed");
assert(range.frozenVersion.startsWith("sha256:"), "missing frozen version");

let rejected = false;
try {
  buildVerifierInput({ raw: "x", actorNarrative: "I already finished" });
} catch {
  rejected = true;
}
assert(rejected, "actor narrative was accepted");

const skipped = await callConfiguredModel({ messages: [] });
assert(skipped.called === false, "model was called without permission");
assert(skipped.usage.outputTokens === "[TBD]", "missing usage was not TBD");

const guardFail = await replayMission({
  missionId: "eval-self-guard-fail",
  scene: "self-check",
  raw: "设施自检",
  lightweight: false,
  structuralOk: false,
  terminal: "done",
  rangeRequests: [{ artifactId: "art-m005a-r1-apple-iphone16", start: 200, end: 500 }],
  deliverables: [{ deliverableId: "report", status: "satisfied", evidenceIds: ["e1"] }],
  guardFacts: {
    requiredArtifactsExist: true,
    reportRequired: true,
    reportOpened: false,
    requiredStepsObserved: true,
    permissionOk: true,
    idempotentOk: true,
    budgetLegal: true,
    stateLegal: true,
  },
  suspendReason: "error",
}, {
  model: async () => ({
    called: true,
    described: { modelVersion: "self-check-stub" },
    usage: skipped.usage,
    verification: {
      goalSatisfied: true,
      confidence: "high",
      rationale: "stub",
      deliverables: [{ deliverableId: "report", status: "satisfied", reason: "", evidenceIds: ["e1"] }],
    },
  }),
});
assert(!guardFail.trace.some((event) => event.name === "mission.closed"), "guard fail closed the mission");
assert(guardFail.trace.some((event) => event.name === "mission.suspended" && event.closeGuard), "suspend missed guard result");
assert(guardFail.trace.some((event) => event.name === "verification.completed" && event.closeGuard?.passed === false), "verifier event missed guard failure");
assert(!JSON.stringify(guardFail.verifierInput).includes("I already finished"), "narrative leaked");
assert(guardFail.verifierInput.rangeReads[0].length === 300, "range was not bounded");
assert(guardFail.verifierInput.rangeReads[0].text === range.text, "named source range body was dropped");
assert(guardFail.verifierInput.rangeReads[0].text.length === 300, "source range body does not cover the slice");

const withBody = buildVerifierInput({
  raw: "候选正文通道",
  evidenceIndex: [{ evidenceId: "e-source", artifactId: "art-source" }],
  candidateDeliverable: {
    artifactId: "candidate.txt",
    kind: "document",
    contentHash: "abc",
    range: { start: 0, end: 2, unit: "chars", length: 2 },
    notEvidence: true,
    text: "正文",
  },
  rangeReads: [{ artifactId: "art-source", start: 0, end: 4, unit: "chars", length: 4, text: "来源正文" }],
});
assert(withBody.candidateDeliverable.text === "正文", "candidate body did not enter verifier input");
assert(withBody.candidateDeliverable.notEvidence === true, "candidate was marked as evidence");
assert(!JSON.stringify(withBody.evidenceIndex).includes("candidate.txt"), "candidate entered evidence");
assert(withBody.rangeReads[0].text === "来源正文", "follow-up source body was dropped");
assert(!JSON.stringify(withBody.evidenceIndex).includes("来源正文"), "source body was copied into the evidence index");
let missingBody = false;
try {
  buildVerifierInput({
    raw: "缺正文",
    candidateDeliverable: { artifactId: "candidate.txt", notEvidence: true, range: { length: 0 } },
  });
} catch {
  missingBody = true;
}
assert(missingBody, "metadata-only candidate was accepted");
let missingSource = false;
try {
  buildVerifierInput({
    raw: "缺来源正文",
    rangeReads: [{ artifactId: "art-source", start: 200, end: 500, unit: "chars", length: 300 }],
  });
} catch {
  missingSource = true;
}
assert(missingSource, "metadata-only source range was accepted");

const done = await replayMission({
  missionId: "eval-self-lightweight-done",
  scene: "G1",
  raw: "打开微博",
  lightweight: true,
  structuralOk: true,
  terminal: "done",
  guardFacts: {
    requiredArtifactsExist: true,
    reportRequired: false,
    requiredStepsObserved: true,
    permissionOk: true,
    idempotentOk: true,
    budgetLegal: true,
    stateLegal: true,
  },
});
const closed = done.trace.filter((event) => event.name === "mission.closed");
assert(closed.length === 1 && closed[0].close.reason === "done" && closed[0].closeGuard.passed, "done close missing guard pass");
assert(done.verification.mode === "lightweight", "lightweight called a verifier mode");
assert(!done.trace.some((event) => event.name === "model.requested"), "lightweight requested a model");

const cancel = await replayMission({
  missionId: "eval-self-cancel",
  scene: "self-check",
  raw: "取消",
  lightweight: true,
  structuralOk: false,
  terminal: "cancelled",
  guardFacts: {
    requiredArtifactsExist: false,
    reportRequired: false,
    requiredStepsObserved: false,
    permissionOk: true,
    idempotentOk: true,
    budgetLegal: true,
    stateLegal: true,
  },
});
assert(cancel.trace.some((event) => event.name === "mission.closed" && event.close.reason === "cancelled"), "cancel did not close");
assert(cancel.closeGuard.passed === false, "cancel was forced through guard");

const outDir = evalOutDir("facility-self-check");
fs.mkdirSync(outDir, { recursive: true });
const report = {
  facilityVersion: FACILITY_VERSION,
  evaluationMode: "offline_replay",
  productionV2: false,
  modelCalls: 0,
  o01: "[TBD]",
  checks: ["range", "narrative", "guard-fail", "lightweight-done", "cancel", "candidate-body", "source-body"],
};
fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(outDir, "guard-fail.jsonl"), guardFail.trace.map((event) => JSON.stringify(event)).join("\n") + "\n");

const after = fs.existsSync(journal) ? fs.statSync(journal) : null;
assert(before && after && before.size === after.size && before.mtimeMs === after.mtimeMs, "missions.jsonl changed");
console.log(`self-check ok ${FACILITY_VERSION}`);
