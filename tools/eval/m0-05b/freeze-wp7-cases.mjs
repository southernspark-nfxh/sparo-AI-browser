import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promptHash } from "./prompt.mjs";
import { repoRoot } from "./paths.mjs";
import { FACILITY_VERSION, RUBRIC_VERSION } from "./version.mjs";

const root = path.join(repoRoot(), "docs", "sparo-agent-loop-devbook", "m0-05b");
const cand = path.join(root, "candidates");

function fileHash(name) {
  const text = fs.readFileSync(path.join(cand, name), "utf8");
  return { text, hash: crypto.createHash("sha256").update(text, "utf8").digest("hex"), length: text.length };
}

const report = fileHash("g4-report.txt");
const note = fileHash("g8-note.txt");
const doc = fileHash("g2-three-day.txt");
if (report.hash !== "faa872577e48bc1df590ba5b04b6056b829dbb82756fbb133c0638d34ef2e798") {
  throw new Error(`report hash ${report.hash}`);
}
if (note.hash !== "2b7aa23762c5cf26d04b25152fc24a0887e7d1207c1b02fd7dd870371a7620f0") {
  throw new Error(`note hash ${note.hash}`);
}

const guard = {
  requiredArtifactsExist: true,
  reportRequired: false,
  requiredStepsObserved: true,
  permissionOk: true,
  idempotentOk: true,
  budgetLegal: true,
  stateLegal: true,
};
const mobile = {
  artifactId: "art-m005a-g2-rmrb-mobile",
  contentHash: "7ac80ba0870ccb64ca42163db4b3cd19079ead86859f43177fd93a049fd240a7",
  frozenVersion: "sha256:7ac80ba0870ccb64ca42163db4b3cd19079ead86859f43177fd93a049fd240a7",
};
const settled = {
  artifactId: "art-m005a-g2-rmrb-settled-1",
  contentHash: "9b41d5440946dff8f7d2c6b7217ec0a970d6043bcb4d890cc8ce2787f693e757",
  frozenVersion: "sha256:9b41d5440946dff8f7d2c6b7217ec0a970d6043bcb4d890cc8ce2787f693e757",
};
const oct27 = {
  artifactId: "art-m005a-g2-rmrb-feed-5358896219684903",
  contentHash: "029b1ee8212a95b9860fcd11bf2d4846ead667be8806089afc67e6e6906ada10",
  frozenVersion: "sha256:029b1ee8212a95b9860fcd11bf2d4846ead667be8806089afc67e6e6906ada10",
};

function shell(row) {
  return {
    frozen: true,
    frozenAt: "2026-10-30T11:20:00+08:00",
    prejudgedBeforeModelCall: true,
    facilityVersion: FACILITY_VERSION,
    rubricVersion: RUBRIC_VERSION,
    promptVersion: "verifier-prompt-1",
    promptHash: promptHash(),
    manifestSampleSetId: "m0-05a-2026-10-29",
    allowedTools: [],
    sendTool: false,
    payTool: false,
    evalBudget: { verifierTurns: 2, notO01: true, label: "evalBudget" },
    preJudgedValid: true,
    ...row,
  };
}

function deliverable(file, hash, length, kind, id) {
  return {
    artifactId: file,
    kind,
    contentHash: hash,
    range: { start: 0, end: length, unit: "chars", length },
    role: "candidate-deliverable",
    notEvidence: true,
    deliverableId: id,
  };
}

const cases = [
  shell({
    caseId: "G4-report-artifact",
    scene: "G4",
    resultClass: "pass",
    costBucket: "independent",
    raw: "研究博主 人民日报 画像，最好上百条",
    candidateKind: "report",
    candidateFile: "g4-report.txt",
    candidateHash: report.hash,
    candidateDeliverable: deliverable("g4-report.txt", report.hash, report.length, "report", "g4-report"),
    candidateSummary: "候选交付是报告 Artifact g4-report.txt。它不是证据。证据只有移动页。",
    followUpSummary: "同一份报告 Artifact。补读的是来源页区间，不是报告自证。",
    followUpRanges: [{ artifactId: mobile.artifactId, start: 200, end: 500 }],
    planSummary: "报告只依据移动页可见的 10 条。上百条是偏好。",
    deliverables: [{ deliverableId: "g4-report", kind: "report", required: true, artifactId: "g4-report.txt" }],
    evidenceIndex: [{ evidenceId: "e-g4-mobile", kind: "content_item", artifactId: mobile.artifactId }],
    artifactPins: [mobile],
    guardFacts: { ...guard, reportRequired: true, reportOpened: true },
    constraints: ["报告是候选交付，不是证据", "来源页才是证据", "上百条不是已完成数量"],
    expected: {
      structural: ["报告不进入证据索引", "来源页是唯一证据", "不把报告摘要当成自证"],
      termination: "done only if verifier and guard pass",
      passFail: "首轮通过只记通过",
    },
  }),
  shell({
    caseId: "G8-host-g2",
    scene: "G8",
    resultClass: "pass",
    costBucket: "g8-embedded",
    hostScene: "G2",
    doubleCountWithHost: false,
    raw: "当前我打开的这个博主 最近三天的微博 帮我复制下来 做成一个文档",
    embeddedIn: "G2 桌面页 PageDown 无进展后改看移动页",
    candidateKind: "observation_note",
    candidateFile: "g8-note.txt",
    candidateHash: note.hash,
    candidateDeliverable: deliverable("g8-note.txt", note.hash, note.length, "answer", "g8-note"),
    candidateSummary: "候选交付是观察 Artifact g8-note.txt。它不是证据。本 case 只验收 G2 里的滚动段，费用不计入 G2。",
    followUpSummary: "同一份观察 Artifact。补读的是移动页来源区间。",
    followUpRanges: [{ artifactId: mobile.artifactId, start: 200, end: 500 }],
    planSummary: "宿主是 G2。滚动无进展后改看移动页。较上次不是工具原文。",
    deliverables: [{ deliverableId: "g8-note", kind: "answer", required: true, artifactId: "g8-note.txt" }],
    evidenceIndex: [
      { evidenceId: "e-g8-settled", kind: "page_state", artifactId: settled.artifactId, note: "hash equals settled-0; offline delta 0" },
      { evidenceId: "e-g8-mobile", kind: "page_state", artifactId: mobile.artifactId, note: "strategy change page" },
    ],
    artifactPins: [settled, mobile],
    guardFacts: guard,
    constraints: ["不使用占位原句", "观察不是证据", "费用不并入 G2", "不验收近三天文档"],
    expected: {
      structural: ["raw 是 G2 冻结原句", "单独计 G8，不重复计入宿主成本"],
      termination: "done only if verifier and guard pass",
      passFail: "首轮通过只记通过",
    },
  }),
  shell({
    caseId: "G2-three-day-doc",
    scene: "G2",
    resultClass: "pass",
    costBucket: "independent",
    raw: "当前我打开的这个博主 最近三天的微博 帮我复制下来 做成一个文档",
    candidateKind: "document",
    candidateFile: "g2-three-day.txt",
    candidateHash: doc.hash,
    candidateDeliverable: deliverable("g2-three-day.txt", doc.hash, doc.length, "document", "g2-doc"),
    candidateSummary: "候选交付是文档 Artifact g2-three-day.txt。它不是证据。证据是冻结时间线页。",
    followUpSummary: "同一份文档 Artifact。补读的是 10 月 27 日那一页的来源区间。",
    followUpRanges: [{ artifactId: oct27.artifactId, start: 200, end: 500 }],
    planSummary: "把该账号冻结页里已经出现的 10 月 27 日至 29 日收成文档。",
    deliverables: [{ deliverableId: "g2-doc", kind: "document", required: true, artifactId: "g2-three-day.txt" }],
    evidenceIndex: [
      { evidenceId: "e-g2-oct27", kind: "content_item", artifactId: oct27.artifactId },
      { evidenceId: "e-g2-oct28", kind: "content_item", artifactId: "art-m005a-g2-rmrb-feed-5359045473210573" },
      { evidenceId: "e-g2-oct29", kind: "content_item", artifactId: "art-m005a-g2-rmrb-feed-5359251180487027" },
    ],
    artifactPins: [
      oct27,
      {
        artifactId: "art-m005a-g2-rmrb-feed-5359045473210573",
        contentHash: "222d249c71e2d336dc678399ac915956a6255ac0f009109f2d2a09ca0012a526",
        frozenVersion: "sha256:222d249c71e2d336dc678399ac915956a6255ac0f009109f2d2a09ca0012a526",
      },
      {
        artifactId: "art-m005a-g2-rmrb-feed-5359251180487027",
        contentHash: "f24f9c37370be735d48eedddd5a69feff73e4651a6654e3c08e793946a9852c4",
        frozenVersion: "sha256:f24f9c37370be735d48eedddd5a69feff73e4651a6654e3c08e793946a9852c4",
      },
    ],
    guardFacts: guard,
    constraints: ["文档不是证据", "只收录冻结页里出现的日期", "不把未出现的条目写成已复制"],
    expected: {
      structural: ["10 月 27 日来自新冻结页", "文档不自证"],
      termination: "done only if verifier and guard pass",
      passFail: "首轮通过只记通过",
    },
  }),
];

for (const row of cases) {
  const dest = path.join(root, "cases", `${row.caseId}.json`);
  if (fs.existsSync(dest)) throw new Error(`case exists ${row.caseId}`);
  fs.writeFileSync(dest, JSON.stringify(row, null, 2));
}
console.log(cases.map((row) => `${row.caseId} ${row.candidateHash}`).join("\n"));
