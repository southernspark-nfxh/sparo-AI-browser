import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promptHash } from "./prompt.mjs";
import { repoRoot } from "./paths.mjs";
import { FACILITY_VERSION, RUBRIC_VERSION } from "./version.mjs";

const root = path.join(repoRoot(), "docs", "sparo-agent-loop-devbook", "m0-05b");
const report = [
  "来源是人民日报 2803301701 的移动页，抓取时间 2026-10-29。",
  "页面用相对时间列出 10 条，不是上百条。上百条只是偏好。",
  "画像只依据这 10 条标题：西班牙列车慰问电；人民空军 77 周年；国防部回应日方；三丽鸥取消 Vivant 联名；成品油价格上调；红军战士；全面从严治党；南方短袖与东北棉袄；商务部回应涉疆实体清单；中风前兆。",
  "没有把没看到的条目写成已经采到。",
  "",
].join("\n");
const reportFile = path.join(root, "candidates", "g4-report.txt");
if (fs.existsSync(reportFile)) throw new Error("report exists");
fs.writeFileSync(reportFile, report, "utf8");
const reportHash = crypto.createHash("sha256").update(report, "utf8").digest("hex");
const poem = fs.readFileSync(path.join(root, "candidates", "g6-poem.txt"), "utf8");
const note = fs.readFileSync(path.join(root, "candidates", "g8-note.txt"), "utf8");
const poemHash = crypto.createHash("sha256").update(poem, "utf8").digest("hex");
const noteHash = crypto.createHash("sha256").update(note, "utf8").digest("hex");
if (poemHash !== "9a873e67fd05c8bf24b9d301ace021ec5a3fe5b7f7045beb423eca0cba76c9f3") throw new Error("poem hash");
if (noteHash !== "2b7aa23762c5cf26d04b25152fc24a0887e7d1207c1b02fd7dd870371a7620f0") throw new Error("note hash");

function shell(row) {
  return {
    frozen: true,
    frozenAt: "2026-10-29T19:50:00+08:00",
    facilityVersion: FACILITY_VERSION,
    rubricVersion: RUBRIC_VERSION,
    promptVersion: "verifier-prompt-1",
    promptHash: promptHash(),
    manifestSampleSetId: "m0-05a-2026-10-29",
    allowedTools: [],
    sendTool: false,
    payTool: false,
    evalBudget: { verifierTurns: 2, notO01: true, label: "evalBudget" },
    costBucket: "independent",
    preJudgedValid: true,
    ...row,
  };
}

const guardPass = {
  requiredArtifactsExist: true,
  reportRequired: false,
  requiredStepsObserved: true,
  permissionOk: true,
  idempotentOk: true,
  budgetLegal: true,
  stateLegal: true,
};
const mobilePin = {
  artifactId: "art-m005a-g2-rmrb-mobile",
  contentHash: "7ac80ba0870ccb64ca42163db4b3cd19079ead86859f43177fd93a049fd240a7",
  frozenVersion: "sha256:7ac80ba0870ccb64ca42163db4b3cd19079ead86859f43177fd93a049fd240a7",
};
const settledPin = {
  artifactId: "art-m005a-g2-rmrb-settled-1",
  contentHash: "9b41d5440946dff8f7d2c6b7217ec0a970d6043bcb4d890cc8ce2787f693e757",
  frozenVersion: "sha256:9b41d5440946dff8f7d2c6b7217ec0a970d6043bcb4d890cc8ce2787f693e757",
};

const cases = [
  shell({
    caseId: "G4-report-pass",
    scene: "G4",
    resultClass: "pass",
    raw: "研究博主 人民日报 画像，最好上百条",
    candidateKind: "report",
    candidateFile: "g4-report.txt",
    candidateHash: reportHash,
    candidateSummary: report,
    followUpSummary: `同一份已打开的报告，补读移动页区间后复验。\n${report}`,
    followUpRanges: [{ artifactId: mobilePin.artifactId, start: 200, end: 500 }],
    planSummary: "根据移动页可见的 10 条写画像。上百条是偏好，不是已完成数量。",
    deliverables: [{ deliverableId: "g4-report", kind: "report", required: true }],
    evidenceIndex: [{ evidenceId: "e-g4-mobile", kind: "content_item", artifactId: mobilePin.artifactId }],
    artifactPins: [mobilePin],
    guardFacts: { ...guardPass, reportRequired: true, reportOpened: true },
    expected: {
      structural: ["报告文件先被读开", "只写移动页可见的 10 条", "不把上百条写成已完成"],
      termination: "done only if verifier and guard pass",
      passFail: "首轮通过只记通过；误拒必须是原始 goalSatisfied false",
    },
  }),
  shell({
    caseId: "G6-false-reject-sample2",
    scene: "G6",
    resultClass: "false_reject_then_pass",
    raw: "帮我写一首诗",
    candidateKind: "offline_document",
    candidateFile: "g6-poem.txt",
    candidateHash: poemHash,
    candidateSummary: `离线文档，不是网页。\n${poem}`,
    followUpSummary: `同一首离线诗，复验。\n${poem}`,
    planSummary: "离线写一首诗，不打开网页。",
    deliverables: [{ deliverableId: "g6-poem-doc", kind: "document", required: true }],
    evidenceIndex: [{ evidenceId: "e-g6-file", kind: "artifact", note: "offline document, not a web page" }],
    artifactPins: [],
    guardFacts: guardPass,
    constraints: ["网页证据 not_applicable", "候选不是网页"],
    expected: {
      structural: ["与 G6-pass-or-false-reject 同一首诗", "不改旧 case"],
      termination: "首轮通过则误拒格仍未覆盖",
      passFail: "不得为了出现拒绝而改 prompt",
    },
  }),
  shell({
    caseId: "G8-pass-sample2",
    scene: "G8",
    resultClass: "pass",
    raw: "长采集滚动，不单列原句",
    candidateKind: "observation_note",
    candidateFile: "g8-note.txt",
    candidateHash: noteHash,
    candidateSummary: `观察记录。\n${note}`,
    followUpSummary: `同一观察，补读移动页区间后复验。\n${note}`,
    followUpRanges: [{ artifactId: mobilePin.artifactId, start: 200, end: 500 }],
    planSummary: "滚动无进展后改看移动页。较上次不是工具原文。",
    deliverables: [{ deliverableId: "g8-note", kind: "answer", required: true }],
    evidenceIndex: [
      { evidenceId: "e-g8-settled", kind: "page_state", artifactId: settledPin.artifactId, note: "offline delta 0" },
      { evidenceId: "e-g8-mobile", kind: "page_state", artifactId: mobilePin.artifactId },
    ],
    artifactPins: [settledPin, mobilePin],
    guardFacts: guardPass,
    expected: {
      structural: ["与上一份有效观察相同", "不改写上一轮两次拒绝"],
      termination: "首轮通过只记通过",
      passFail: "补读后仍拒绝则通过和误拒后通过都继续未覆盖",
    },
  }),
];

for (const row of cases) {
  const dest = path.join(root, "cases", `${row.caseId}.json`);
  if (fs.existsSync(dest)) throw new Error(`case exists ${row.caseId}`);
  fs.writeFileSync(dest, JSON.stringify(row, null, 2));
}
console.log(`appended ${cases.map((row) => row.caseId).join(", ")}`);
