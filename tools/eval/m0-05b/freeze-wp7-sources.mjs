import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readRange } from "./artifact-store.mjs";
import { promptHash } from "./prompt.mjs";
import { repoRoot } from "./paths.mjs";
import { buildVerifierInput } from "./verifier-input.mjs";
import { FACILITY_VERSION, RUBRIC_VERSION } from "./version.mjs";

if (FACILITY_VERSION !== "m0-05b-facility-3") throw new Error(`facility ${FACILITY_VERSION}`);
if (promptHash() !== "f997b6ebbd024053075f84ef9aa3cb01aa160be7ac6721cfea2043c60d24f110") {
  throw new Error("prompt hash drifted");
}

const root = path.join(repoRoot(), "docs", "sparo-agent-loop-devbook", "m0-05b");
const cand = path.join(root, "candidates");
const caseIds = ["G4-portrait-read", "G2-posts-ids", "G8-host-read"];
for (const id of caseIds) {
  if (fs.existsSync(path.join(root, "cases", `${id}.json`))) throw new Error(`case exists ${id}`);
}

function fileHash(name) {
  const text = fs.readFileSync(path.join(cand, name), "utf8");
  return { text, hash: crypto.createHash("sha256").update(text, "utf8").digest("hex"), length: text.length };
}

const unchanged = {
  "g4-report.txt": "faa872577e48bc1df590ba5b04b6056b829dbb82756fbb133c0638d34ef2e798",
  "g2-three-day.txt": "c56a7136de0d5594c36cba02cd30ff5c925b8587fe75eadc4f810445326ba90e",
  "g8-note.txt": "2b7aa23762c5cf26d04b25152fc24a0887e7d1207c1b02fd7dd870371a7620f0",
  "g4-portrait.txt": "5dbf4550897010391a403aaac20c047fb565f8f57d07f37817653c4bc314b7ef",
  "g2-posts.txt": "ca7457149fc62882a8f7f058c1212a131f6ec4eb1853c3a968ffbaa7537b61dd",
};
for (const [name, hash] of Object.entries(unchanged)) {
  if (fileHash(name).hash !== hash) throw new Error(`${name} changed`);
}

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
function bidToId(bid) {
  let rest = bid;
  const parts = [];
  while (rest.length > 0) {
    const chunk = rest.length > 4 ? rest.slice(-4) : rest;
    rest = rest.length > 4 ? rest.slice(0, -4) : "";
    let n = 0n;
    for (const ch of chunk) n = n * 62n + BigInt(alphabet.indexOf(ch));
    let s = n.toString();
    if (rest.length > 0) s = s.padStart(7, "0");
    parts.unshift(s);
  }
  return parts.join("");
}
function redactId(id) {
  return id.replace(/1[3-9]\d{9}/g, "[REDACTED-PHONE]");
}
if (bidToId("RoL7VvTsx") !== "5359010317601357") throw new Error("bid conversion drifted");
const restored = [
  ["RoLgR3Vod", "5359015850935593", "53590[REDACTED-PHONE]"],
  ["RoOgqxIdb", "5359130908034777", "5359[REDACTED-PHONE]7"],
];
for (const [bid, id, redacted] of restored) {
  if (bidToId(bid) !== id) throw new Error(`bid ${bid} did not restore ${id}`);
  if (redactId(id) !== redacted) throw new Error(`restored id ${id} does not match the frozen redaction`);
}

const oldPosts = fileHash("g2-posts.txt").text;
let postsText = oldPosts.replace(
  "冻结页以外的微博没有写入。\n",
  "冻结页以外的微博没有写入。\n其中两条的数字 id 在冻结页里被抹掉了一段。公开数字 id 由同一条卡片 scheme 上未打码的 mblogid 还原，mblogid 写在该条下面。\n",
);
postsText = postsText.replace("id 53590[REDACTED-PHONE]\n", "id 5359015850935593\nmblogid RoLgR3Vod\n");
postsText = postsText.replace("id 5359[REDACTED-PHONE]7\n", "id 5359130908034777\nmblogid RoOgqxIdb\n");
if (postsText.includes("REDACTED")) throw new Error("redaction token remains in the new document");
if ((postsText.match(/^\[/gm) || []).length !== 30) throw new Error("document post count");
const idLines = postsText.match(/^id \d{16}$/gm) || [];
if (idLines.length !== 30) throw new Error("not every post has a 16-digit id");
if ((postsText.match(/Oct 27 /g) || []).length !== 8) throw new Error("Oct 27 count");
if ((postsText.match(/Oct 28 /g) || []).length !== 21) throw new Error("Oct 28 count");
if ((postsText.match(/Oct 29 /g) || []).length !== 1) throw new Error("Oct 29 count");

const blocks = postsText.split(/\n(?=\[\d+\] )/).slice(1);
if (blocks.length !== 30) throw new Error("post blocks");
const posts = blocks.map((block) => {
  const time = (block.match(/^\[\d+\] (.+)$/m) || [])[1];
  const id = (block.match(/^id (\d{16})$/m) || [])[1];
  const source = (block.match(/^来源 (\S+)$/m) || [])[1];
  const mblogid = (block.match(/^mblogid (\S+)$/m) || [])[1] || "";
  const body = block.split("\n").find((line) => line.startsWith("【") || line.startsWith("#"));
  const phrase = (body || "").match(/[\u4e00-\u9fff]{8}/);
  if (!time || !id || !source || !phrase) throw new Error("post block incomplete");
  return { time, id, source, mblogid, phrase: phrase[0] };
});

function whole(artifactId) {
  const range = readRange(artifactId, 0, Number.MAX_SAFE_INTEGER);
  if (range.start !== 0 || range.end !== range.length || range.text.length !== range.length) {
    throw new Error(`${artifactId} is not a full-page range`);
  }
  return range;
}
function decodeEscapes(text) {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}

const pages = {
  "art-m005a-g2-rmrb-feed-5358896219684903": whole("art-m005a-g2-rmrb-feed-5358896219684903"),
  "art-m005a-g2-rmrb-feed-5359045473210573": whole("art-m005a-g2-rmrb-feed-5359045473210573"),
  "art-m005a-g2-rmrb-feed-5359251180487027": whole("art-m005a-g2-rmrb-feed-5359251180487027"),
  "art-m005a-g2-rmrb-mobile": whole("art-m005a-g2-rmrb-mobile"),
  "art-m005a-g2-rmrb-settled-0": whole("art-m005a-g2-rmrb-settled-0"),
  "art-m005a-g2-rmrb-settled-1": whole("art-m005a-g2-rmrb-settled-1"),
};
const expectedHash = {
  "art-m005a-g2-rmrb-feed-5358896219684903": "029b1ee8212a95b9860fcd11bf2d4846ead667be8806089afc67e6e6906ada10",
  "art-m005a-g2-rmrb-feed-5359045473210573": "222d249c71e2d336dc678399ac915956a6255ac0f009109f2d2a09ca0012a526",
  "art-m005a-g2-rmrb-feed-5359251180487027": "f24f9c37370be735d48eedddd5a69feff73e4651a6654e3c08e793946a9852c4",
  "art-m005a-g2-rmrb-mobile": "7ac80ba0870ccb64ca42163db4b3cd19079ead86859f43177fd93a049fd240a7",
  "art-m005a-g2-rmrb-settled-0": "9b41d5440946dff8f7d2c6b7217ec0a970d6043bcb4d890cc8ce2787f693e757",
  "art-m005a-g2-rmrb-settled-1": "9b41d5440946dff8f7d2c6b7217ec0a970d6043bcb4d890cc8ce2787f693e757",
};
for (const [id, range] of Object.entries(pages)) {
  const hash = range.frozenVersion.slice("sha256:".length);
  if (hash !== expectedHash[id]) throw new Error(`pin drifted ${id}`);
}
if (pages["art-m005a-g2-rmrb-settled-0"].text !== pages["art-m005a-g2-rmrb-settled-1"].text) {
  throw new Error("settled pages differ");
}
if (pages["art-m005a-g2-rmrb-settled-0"].text.includes("较上次")) throw new Error("tool body contains 较上次");

for (const post of posts) {
  const page = pages[post.source];
  if (!page.text.includes(post.time)) throw new Error(`time missing ${post.id}`);
  if (!decodeEscapes(page.text).includes(post.phrase)) throw new Error(`body missing ${post.id} ${post.phrase}`);
  if (post.mblogid && !page.text.includes(`mblogid=${post.mblogid}`)) throw new Error(`mblogid missing ${post.mblogid}`);
}
const mobilePhrases = ["致慰问电", "人民空军成立77周年", "受迫害妄想症", "三丽鸥", "440元", "冰琪林", "全面从严治党永远在路上", "短袖", "涉疆", "口角歪斜"];
for (const phrase of mobilePhrases) {
  if (!pages["art-m005a-g2-rmrb-mobile"].text.includes(phrase)) throw new Error(`mobile page misses ${phrase}`);
}

const portrait = fileHash("g4-portrait.txt");
const postsHash = crypto.createHash("sha256").update(postsText, "utf8").digest("hex");
const guard = {
  requiredArtifactsExist: true,
  reportRequired: false,
  requiredStepsObserved: true,
  permissionOk: true,
  idempotentOk: true,
  budgetLegal: true,
  stateLegal: true,
};
function pin(id) {
  return {
    artifactId: id,
    contentHash: expectedHash[id],
    frozenVersion: pages[id].frozenVersion,
  };
}
function bounds(id) {
  return { artifactId: id, start: 0, end: pages[id].end };
}
const mobile = pin("art-m005a-g2-rmrb-mobile");
const settled0 = pin("art-m005a-g2-rmrb-settled-0");
const settled1 = pin("art-m005a-g2-rmrb-settled-1");
const oct27 = pin("art-m005a-g2-rmrb-feed-5358896219684903");
const oct28 = pin("art-m005a-g2-rmrb-feed-5359045473210573");
const oct29 = pin("art-m005a-g2-rmrb-feed-5359251180487027");
const feeds = [
  { evidenceId: "e-g2-oct27", kind: "content_item", artifactId: oct27.artifactId },
  { evidenceId: "e-g2-oct28", kind: "content_item", artifactId: oct28.artifactId },
  { evidenceId: "e-g2-oct29", kind: "content_item", artifactId: oct29.artifactId },
];
const feedRanges = [bounds(oct27.artifactId), bounds(oct28.artifactId), bounds(oct29.artifactId)];

function shell(row) {
  return {
    frozen: true,
    frozenAt: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(" ", "T") + "+08:00",
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
function assertChannel(row, body) {
  const input = buildVerifierInput({
    raw: row.raw,
    constraints: row.constraints,
    planSummary: row.planSummary,
    deliverables: row.deliverables,
    evidenceIndex: row.evidenceIndex,
    candidateSummary: row.followUpSummary,
    candidateDeliverable: { ...row.candidateDeliverable, text: body },
    rangeReads: row.followUpRanges.map((range) => {
      const loaded = pages[range.artifactId];
      if (range.start !== 0 || range.end !== loaded.end) throw new Error(`${row.caseId} range is not the whole page`);
      return { ...loaded, artifactId: range.artifactId };
    }),
  });
  if (input.candidateDeliverable.text !== body) throw new Error(`${row.caseId} body dropped`);
  if (input.candidateDeliverable.notEvidence !== true) throw new Error(`${row.caseId} marked evidence`);
  if (JSON.stringify(input.evidenceIndex).includes(row.candidateFile)) throw new Error(`${row.caseId} self-certifies`);
  if (input.rangeReads.length !== row.followUpRanges.length) throw new Error(`${row.caseId} dropped a source`);
  for (const range of input.rangeReads) {
    if (range.text.length !== range.length || range.length !== range.end - range.start) {
      throw new Error(`${row.caseId} source body does not cover ${range.artifactId}`);
    }
  }
  const sourceText = input.rangeReads.map((range) => range.text).join("\n");
  if (sourceText.length < 1000) throw new Error(`${row.caseId} source body is still a short slice`);
  if (JSON.stringify(input.evidenceIndex).includes(sourceText.slice(0, 40))) {
    throw new Error(`${row.caseId} copied source body into the evidence index`);
  }
}

const cases = [
  shell({
    caseId: "G4-portrait-read",
    supersedes: "G4-portrait-body",
    scene: "G4",
    resultClass: "pass",
    costBucket: "independent",
    raw: "研究博主 人民日报 画像，最好上百条",
    candidateKind: "report",
    candidateFile: "g4-portrait.txt",
    candidateHash: portrait.hash,
    candidateDeliverable: deliverable("g4-portrait.txt", portrait.hash, portrait.length, "report", "g4-report"),
    candidateSummary: "候选正文在 candidateDeliverable.text，不是证据。这一页的画像是官方回应、民生说明和人物历史交替出现，只覆盖移动页可见的 10 条。",
    followUpSummary: "同一份报告正文仍在候选通道。补读带上移动页全文，用来核对这 10 条，不把报告写成证据。",
    followUpRanges: [bounds(mobile.artifactId)],
    planSummary: "报告依据移动页可见的 10 条作出画像。上百条是偏好。",
    deliverables: [{ deliverableId: "g4-report", kind: "report", required: true, artifactId: "g4-portrait.txt" }],
    evidenceIndex: [{ evidenceId: "e-g4-mobile", kind: "content_item", artifactId: mobile.artifactId }],
    artifactPins: [mobile],
    guardFacts: { ...guard, reportRequired: true, reportOpened: true },
    constraints: ["报告是候选交付，不是证据", "来源页才是证据", "上百条不是已完成数量", "画像必须能从可见正文里读出来"],
    expected: {
      structural: ["报告正文进入候选通道", "报告不进入证据索引", "补读带上移动页全文"],
      termination: "done only if verifier and guard pass",
      passFail: "首轮通过只记通过",
    },
  }),
  shell({
    caseId: "G2-posts-ids",
    supersedes: "G2-posts-doc",
    scene: "G2",
    resultClass: "pass",
    costBucket: "independent",
    raw: "当前我打开的这个博主 最近三天的微博 帮我复制下来 做成一个文档",
    candidateKind: "document",
    candidateFile: "g2-posts-ids.txt",
    candidateHash: postsHash,
    candidateDeliverable: deliverable("g2-posts-ids.txt", postsHash, postsText.length, "document", "g2-doc"),
    candidateSummary: "候选正文在 candidateDeliverable.text，不是证据。文档复制冻结页里的 30 条微博：10 月 27 日 8 条、10 月 28 日 21 条、10 月 29 日 1 条。30 个 id 都是数字。页面截断处没有补写。",
    followUpSummary: "同一份文档正文仍在候选通道。补读带上三份时间线页的全文，用来核对 30 条是否复制准确。",
    followUpRanges: feedRanges,
    planSummary: "把三份冻结时间线页里实际出现的微博复制成文档。",
    deliverables: [{ deliverableId: "g2-doc", kind: "document", required: true, artifactId: "g2-posts-ids.txt" }],
    evidenceIndex: feeds,
    artifactPins: [oct27, oct28, oct29],
    guardFacts: guard,
    constraints: ["文档不是证据", "只复制冻结页里出现的正文", "不把未出现的条目写成已复制", "不把 G8-host-read 的费用加进来"],
    expected: {
      structural: ["文档含微博正文和 30 个数字 id", "正文进入候选通道", "补读带上三份时间线页全文"],
      termination: "done only if verifier and guard pass",
      passFail: "首轮通过只记通过",
    },
  }),
  shell({
    caseId: "G8-host-read",
    supersedes: "G8-host-doc",
    scene: "G8",
    resultClass: "pass",
    costBucket: "g8-embedded",
    hostScene: "G2",
    doubleCountWithHost: false,
    raw: "当前我打开的这个博主 最近三天的微博 帮我复制下来 做成一个文档",
    embeddedIn: "G2 桌面页 PageDown 无进展后改看移动页",
    candidateKind: "document",
    candidateFile: "g2-posts-ids.txt",
    candidateHash: postsHash,
    candidateDeliverable: deliverable("g2-posts-ids.txt", postsHash, postsText.length, "document", "g2-doc"),
    candidateSummary: "宿主要求的近三天文档就是候选正文 candidateDeliverable.text，不是证据。滚动是否无进展要对照 settled-0 和 settled-1 的工具正文。费用不并入 G2。",
    followUpSummary: "同一份文档正文仍在候选通道。补读带上 settled-0、settled-1 的全文，以及三份时间线页和移动页的全文。",
    followUpRanges: [bounds(settled0.artifactId), bounds(settled1.artifactId), bounds(mobile.artifactId), ...feedRanges],
    planSummary: "宿主原句要求复制近三天微博。桌面页连续 PageDown 后应对照 settled-0 与 settled-1 的工具正文。验收对象是文档正文，滚动笔记不是交付。",
    deliverables: [{ deliverableId: "g2-doc", kind: "document", required: true, artifactId: "g2-posts-ids.txt" }],
    evidenceIndex: [
      { evidenceId: "e-g8-settled-0", kind: "page_state", artifactId: settled0.artifactId },
      { evidenceId: "e-g8-settled-1", kind: "page_state", artifactId: settled1.artifactId },
      { evidenceId: "e-g8-mobile", kind: "page_state", artifactId: mobile.artifactId },
      ...feeds,
    ],
    artifactPins: [settled0, settled1, mobile, oct27, oct28, oct29],
    guardFacts: guard,
    constraints: ["不使用占位原句", "滚动笔记不是交付", "必须验收宿主要求的近三天文档", "滚动观察必须能从 settled-0 和 settled-1 的工具正文里核对", "候选正文不是证据", "费用不并入 G2"],
    expected: {
      structural: ["raw 是 G2 冻结原句", "交付是实际文档正文", "settled-0 与 settled-1 都有全文区间", "单独计 G8，不重复计入宿主成本"],
      termination: "done only if verifier and guard pass",
      passFail: "首轮通过只记通过",
    },
  }),
];

for (const row of cases) {
  const body = row.candidateFile === "g4-portrait.txt" ? portrait.text : postsText;
  assertChannel(row, body);
}
fs.writeFileSync(path.join(cand, "g2-posts-ids.txt"), postsText);
if (fileHash("g2-posts-ids.txt").hash !== postsHash) throw new Error("written document hash drifted");
if (fileHash("g2-posts.txt").hash !== unchanged["g2-posts.txt"]) throw new Error("old document changed");
for (const row of cases) {
  fs.writeFileSync(path.join(root, "cases", `${row.caseId}.json`), JSON.stringify(row, null, 2));
}
console.log(cases.map((row) => `${row.caseId} ${row.candidateHash} ${row.candidateDeliverable.range.length} ranges=${row.followUpRanges.map((range) => range.end).join(",")}`).join("\n"));
