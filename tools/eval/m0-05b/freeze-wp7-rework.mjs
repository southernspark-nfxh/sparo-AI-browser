import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promptHash } from "./prompt.mjs";
import { repoRoot } from "./paths.mjs";
import { buildVerifierInput } from "./verifier-input.mjs";
import { FACILITY_VERSION, RUBRIC_VERSION } from "./version.mjs";

if (FACILITY_VERSION !== "m0-05b-facility-2") throw new Error(`facility ${FACILITY_VERSION}`);

const root = path.join(repoRoot(), "docs", "sparo-agent-loop-devbook", "m0-05b");
const cand = path.join(root, "candidates");

function fileHash(name) {
  const text = fs.readFileSync(path.join(cand, name), "utf8");
  return { text, hash: crypto.createHash("sha256").update(text, "utf8").digest("hex"), length: text.length };
}

const oldReport = fileHash("g4-report.txt");
const oldDoc = fileHash("g2-three-day.txt");
const oldNote = fileHash("g8-note.txt");
if (oldReport.hash !== "faa872577e48bc1df590ba5b04b6056b829dbb82756fbb133c0638d34ef2e798") throw new Error("old report changed");
if (oldDoc.hash !== "c56a7136de0d5594c36cba02cd30ff5c925b8587fe75eadc4f810445326ba90e") throw new Error("old doc changed");
if (oldNote.hash !== "2b7aa23762c5cf26d04b25152fc24a0887e7d1207c1b02fd7dd870371a7620f0") throw new Error("old note changed");

const portrait = fileHash("g4-portrait.txt");
const posts = fileHash("g2-posts.txt");
if (!portrait.text.includes("三种口气")) throw new Error("portrait has no analysis");
if (!posts.text.includes("【#小战士云贵川和甘肃腊子口#】")) throw new Error("document has no post body");
if ((posts.text.match(/^\[/gm) || []).length !== 30) throw new Error("document post count");

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
const oct28 = {
  artifactId: "art-m005a-g2-rmrb-feed-5359045473210573",
  contentHash: "222d249c71e2d336dc678399ac915956a6255ac0f009109f2d2a09ca0012a526",
  frozenVersion: "sha256:222d249c71e2d336dc678399ac915956a6255ac0f009109f2d2a09ca0012a526",
};
const oct29 = {
  artifactId: "art-m005a-g2-rmrb-feed-5359251180487027",
  contentHash: "f24f9c37370be735d48eedddd5a69feff73e4651a6654e3c08e793946a9852c4",
  frozenVersion: "sha256:f24f9c37370be735d48eedddd5a69feff73e4651a6654e3c08e793946a9852c4",
};
const feeds = [
  { evidenceId: "e-g2-oct27", kind: "content_item", artifactId: oct27.artifactId },
  { evidenceId: "e-g2-oct28", kind: "content_item", artifactId: oct28.artifactId },
  { evidenceId: "e-g2-oct29", kind: "content_item", artifactId: oct29.artifactId },
];

function shell(row) {
  return {
    frozen: true,
    frozenAt: "2026-10-30T12:20:00+08:00",
    prejudgedBeforeModelCall: true,
    supersedes: row.supersedes,
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

function assertChannel(row, body) {
  const input = buildVerifierInput({
    raw: row.raw,
    constraints: row.constraints,
    planSummary: row.planSummary,
    deliverables: row.deliverables,
    evidenceIndex: row.evidenceIndex,
    candidateSummary: row.candidateSummary,
    candidateDeliverable: { ...row.candidateDeliverable, text: body },
    rangeReads: (row.followUpRanges || []).map((range) => ({ ...range, unit: "chars", length: 300, text: "来源页切片" })),
  });
  if (input.candidateDeliverable.text !== body) throw new Error(`${row.caseId} body dropped`);
  if (input.candidateDeliverable.notEvidence !== true) throw new Error(`${row.caseId} marked evidence`);
  if (JSON.stringify(input.evidenceIndex).includes(row.candidateFile)) throw new Error(`${row.caseId} self-certifies`);
  if (input.rangeReads.some((range) => "text" in range)) throw new Error(`${row.caseId} source text leaked`);
  if (!input.candidateSummary || input.candidateSummary === body) throw new Error(`${row.caseId} summary replaced the body`);
}

const cases = [
  shell({
    caseId: "G4-portrait-body",
    supersedes: "G4-report-artifact",
    scene: "G4",
    resultClass: "pass",
    costBucket: "independent",
    raw: "研究博主 人民日报 画像，最好上百条",
    candidateKind: "report",
    candidateFile: "g4-portrait.txt",
    candidateHash: portrait.hash,
    candidateDeliverable: deliverable("g4-portrait.txt", portrait.hash, portrait.length, "report", "g4-report"),
    candidateSummary: "候选正文在 candidateDeliverable.text，不是证据。这一页的画像是官方回应、民生说明和人物历史交替出现，只覆盖移动页可见的 10 条。",
    followUpSummary: "同一份报告正文仍在候选通道。补读只带来源页边界，不把报告写成证据。",
    followUpRanges: [{ artifactId: mobile.artifactId, start: 200, end: 500 }],
    planSummary: "报告依据移动页可见的 10 条作出画像。上百条是偏好。",
    deliverables: [{ deliverableId: "g4-report", kind: "report", required: true, artifactId: "g4-portrait.txt" }],
    evidenceIndex: [{ evidenceId: "e-g4-mobile", kind: "content_item", artifactId: mobile.artifactId }],
    artifactPins: [mobile],
    guardFacts: { ...guard, reportRequired: true, reportOpened: true },
    constraints: ["报告是候选交付，不是证据", "来源页才是证据", "上百条不是已完成数量", "画像必须能从可见正文里读出来"],
    expected: {
      structural: ["报告正文进入候选通道", "报告不进入证据索引", "来源区间不含正文"],
      termination: "done only if verifier and guard pass",
      passFail: "首轮通过只记通过",
    },
  }),
  shell({
    caseId: "G2-posts-doc",
    supersedes: "G2-three-day-doc",
    scene: "G2",
    resultClass: "pass",
    costBucket: "independent",
    raw: "当前我打开的这个博主 最近三天的微博 帮我复制下来 做成一个文档",
    candidateKind: "document",
    candidateFile: "g2-posts.txt",
    candidateHash: posts.hash,
    candidateDeliverable: deliverable("g2-posts.txt", posts.hash, posts.length, "document", "g2-doc"),
    candidateSummary: "候选正文在 candidateDeliverable.text，不是证据。文档复制冻结页里的 30 条微博：10 月 27 日 8 条、10 月 28 日 21 条、10 月 29 日 1 条。页面截断处没有补写。",
    followUpSummary: "同一份文档正文仍在候选通道。补读只带 10 月 27 日来源页边界。",
    followUpRanges: [{ artifactId: oct27.artifactId, start: 200, end: 500 }],
    planSummary: "把三份冻结时间线页里实际出现的微博复制成文档。",
    deliverables: [{ deliverableId: "g2-doc", kind: "document", required: true, artifactId: "g2-posts.txt" }],
    evidenceIndex: feeds,
    artifactPins: [oct27, oct28, oct29],
    guardFacts: guard,
    constraints: ["文档不是证据", "只复制冻结页里出现的正文", "不把未出现的条目写成已复制", "不把 G8-host-doc 的费用加进来"],
    expected: {
      structural: ["文档含微博正文", "正文进入候选通道", "文档不进入证据索引"],
      termination: "done only if verifier and guard pass",
      passFail: "首轮通过只记通过",
    },
  }),
  shell({
    caseId: "G8-host-doc",
    supersedes: "G8-host-g2",
    scene: "G8",
    resultClass: "pass",
    costBucket: "g8-embedded",
    hostScene: "G2",
    doubleCountWithHost: false,
    raw: "当前我打开的这个博主 最近三天的微博 帮我复制下来 做成一个文档",
    embeddedIn: "G2 桌面页 PageDown 无进展后改看移动页",
    candidateKind: "document",
    candidateFile: "g2-posts.txt",
    candidateHash: posts.hash,
    candidateDeliverable: deliverable("g2-posts.txt", posts.hash, posts.length, "document", "g2-doc"),
    candidateSummary: "宿主要求的近三天文档就是候选正文 candidateDeliverable.text，不是证据。滚动只记录执行，不代替这份文档。费用不并入 G2。",
    followUpSummary: "同一份文档正文仍在候选通道。补读只带来源页边界，不把滚动笔记当成交付。",
    followUpRanges: [{ artifactId: oct27.artifactId, start: 200, end: 500 }],
    planSummary: "宿主原句要求复制近三天微博。桌面页连续 PageDown 后 settled-1 与 settled-0 同哈希，离线差为 0，工具正文没有「较上次」，随后改看移动页。验收对象是文档正文。",
    deliverables: [{ deliverableId: "g2-doc", kind: "document", required: true, artifactId: "g2-posts.txt" }],
    evidenceIndex: [
      { evidenceId: "e-g8-settled", kind: "page_state", artifactId: settled.artifactId, note: "hash equals settled-0; offline delta 0" },
      { evidenceId: "e-g8-mobile", kind: "page_state", artifactId: mobile.artifactId, note: "strategy change page" },
      ...feeds,
    ],
    artifactPins: [settled, mobile, oct27, oct28, oct29],
    guardFacts: guard,
    constraints: ["不使用占位原句", "滚动笔记不是交付", "必须验收宿主要求的近三天文档", "候选正文不是证据", "费用不并入 G2"],
    expected: {
      structural: ["raw 是 G2 冻结原句", "交付是实际文档正文", "单独计 G8，不重复计入宿主成本"],
      termination: "done only if verifier and guard pass",
      passFail: "首轮通过只记通过",
    },
  }),
];

for (const row of cases) {
  const body = row.candidateFile === "g4-portrait.txt" ? portrait.text : posts.text;
  assertChannel(row, body);
  const dest = path.join(root, "cases", `${row.caseId}.json`);
  if (fs.existsSync(dest)) throw new Error(`case exists ${row.caseId}`);
  fs.writeFileSync(dest, JSON.stringify(row, null, 2));
}
console.log(cases.map((row) => `${row.caseId} ${row.candidateHash} ${row.candidateDeliverable.range.length}`).join("\n"));
