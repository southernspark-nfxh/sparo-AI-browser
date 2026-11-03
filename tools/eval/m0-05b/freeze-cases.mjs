import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { loadManifest } from "./artifact-store.mjs";
import { casesDir } from "./case-runner.mjs";
import { promptHash } from "./prompt.mjs";
import { repoRoot } from "./paths.mjs";
import { FACILITY_VERSION, RUBRIC_VERSION } from "./version.mjs";

const manifest = loadManifest();
const candidates = path.join(repoRoot(), "docs", "sparo-agent-loop-devbook", "m0-05b", "candidates");
fs.mkdirSync(candidates, { recursive: true });

const files = {
  "g6-poem.txt": "夜色把窗沿压低，\n一盏灯还在纸上走。\n没人来问它去哪，\n它就把影子留给手。\n",
  "p1-draft.txt": "外交部回应三丽鸥取消 Vivant 联名，这件事今天上了热搜。品牌合作翻车时，大家在看角色怎么被写，也在看官方怎么答。这是草稿，不发送。\n",
  "g8-note.txt": "桌面页连续 PageDown 的离线字符差是 0。工具正文里没有「较上次」。换到移动页之后才看到更多公开条目。\n",
  "g4-note.txt": "来源是人民日报 2803301701 的移动页，实际约 10 条。上百条只是偏好，这里不写成已经采满。没有单独打开的报告文件。\n",
  "g2-note.txt": "已冻结样本里有 10 月 28 日和 10 月 29 日的人民日报条目。10 月 27 日不在这些正文里。这不是近三天已经采完的文档。\n",
  "t1-note.txt": "去程页实际查询日是 2026-10-30，北京到南京，含 G531 的时刻和席别价格。返程和单店酒店价格不在这份正文里。不订票。\n",
  "r1-note.txt": "搜索入口之外只有苹果官网购买页，iPhone 16 标价 RMB 5999 起。没有小米和华为的同等正文，也没有对照报告。\n",
};

const candidateHash = {};
for (const [name, text] of Object.entries(files)) {
  const file = path.join(candidates, name);
  fs.writeFileSync(file, text, "utf8");
  candidateHash[name] = crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function pin(id) {
  const sample = manifest.samples.find((row) => row.artifactId === id);
  if (!sample) throw new Error(`missing ${id}`);
  return { artifactId: id, contentHash: sample.contentHash, frozenVersion: sample.frozenVersion };
}

const pins = {
  g1: pin("art-m005a-g1-weibo-home"),
  g2a: pin("art-m005a-g2-rmrb-feed-5359251180487027"),
  g2b: pin("art-m005a-g2-rmrb-feed-5359045473210573"),
  g4: pin("art-m005a-g2-rmrb-mobile"),
  g8: pin("art-m005a-g2-rmrb-settled-1"),
  hot: pin("art-m005a-p1-weibo-hot"),
  train: pin("art-m005a-t1-ctrip-train"),
  search: pin("art-m005a-r1-baidu-compare"),
  apple: pin("art-m005a-r1-apple-iphone16"),
};

const guardPass = {
  requiredArtifactsExist: true,
  reportRequired: false,
  requiredStepsObserved: true,
  permissionOk: true,
  idempotentOk: true,
  budgetLegal: true,
  stateLegal: true,
};

function shell(partial) {
  return {
    frozen: true,
    frozenAt: "2026-10-29T19:21:00+08:00",
    facilityVersion: FACILITY_VERSION,
    rubricVersion: RUBRIC_VERSION,
    promptVersion: "verifier-prompt-1",
    promptHash: promptHash(),
    manifestSampleSetId: manifest.sampleSetId,
    allowedTools: [],
    sendTool: false,
    payTool: false,
    ...partial,
  };
}

const cases = [];

cases.push(shell({
  caseId: "G1-pass",
  scene: "G1",
  resultClass: "pass",
  controller: false,
  lightweight: true,
  preJudgedValid: true,
  raw: "打开微博",
  candidateKind: "page_action",
  candidateSummary: "已打开 https://weibo.com/ ，标题为微博首页。没有时间线条目。",
  artifactPins: [pins.g1],
  costBucket: "lightweight-production",
  guardFacts: guardPass,
  expected: {
    structural: ["不调用独立 Verifier", "Close Guard 通过才可以 done"],
    termination: "done",
    passFail: "轻量结构校验通过且 Guard 通过",
  },
  summary: "轻量打开微博",
}));

cases.push(shell({
  caseId: "G1-false-reject-control",
  scene: "G1",
  resultClass: "false_reject_then_pass",
  preJudgedValid: true,
  raw: "打开微博",
  candidateKind: "page_action",
  candidateSummary: "已打开 https://weibo.com/ ，标题为微博首页。没有时间线条目。",
  followUpSummary: "补读首页正文区间后，页面身份仍是微博首页。",
  planSummary: "打开微博首页。",
  deliverables: [{ deliverableId: "g1-open", kind: "page_action", required: true }],
  evidenceIndex: [{ evidenceId: "e-g1-home", kind: "page_state", artifactId: "art-m005a-g1-weibo-home" }],
  followUpRanges: [{ artifactId: pins.g1.artifactId, start: 0, end: 80 }],
  artifactPins: [pins.g1],
  evalBudget: { verifierTurns: 2, notO01: true, label: "evalBudget" },
  costBucket: "control-experiment",
  guardFacts: guardPass,
  constraints: ["对照实验，不计入 G1 轻量生产成本"],
  expected: {
    structural: ["只有模型原始 goalSatisfied 为 false 才算误拒", "补读后通过才覆盖误拒后通过"],
    termination: "done only after a real reject then a gated pass and guard pass",
    passFail: "第一次就通过则误拒格保持未覆盖",
  },
}));

function modelCase(partial) {
  cases.push(shell({
    evalBudget: { verifierTurns: partial.continuousReject ? 2 : 2, notO01: true, label: "evalBudget" },
    costBucket: partial.costBucket || "independent",
    ...partial,
  }));
}

modelCase({
  caseId: "G6-pass-or-false-reject",
  scene: "G6",
  resultClass: "pass",
  preJudgedValid: true,
  raw: "帮我写一首诗",
  candidateKind: "offline_document",
  candidateSummary: `离线文档，不是网页。\n${files["g6-poem.txt"]}`,
  followUpSummary: `同一首离线诗，复验。\n${files["g6-poem.txt"]}`,
  planSummary: "离线写一首诗，不打开网页。",
  deliverables: [{ deliverableId: "g6-poem-doc", kind: "document", required: true }],
  evidenceIndex: [{ evidenceId: "e-g6-file", kind: "artifact", note: "offline document, not a web page" }],
  candidateFile: "g6-poem.txt",
  candidateHash: candidateHash["g6-poem.txt"],
  artifactPins: [],
  guardFacts: guardPass,
  constraints: ["网页证据 not_applicable", "候选不是网页"],
  expected: {
    structural: ["无网页证据", "文档候选在冻结文件里"],
    termination: "done only if verifier and guard pass",
    passFail: "误拒必须是模型第一次返回 goalSatisfied false",
  },
});

modelCase({
  caseId: "P1-pass-or-false-reject",
  scene: "P1",
  resultClass: "pass",
  preJudgedValid: true,
  raw: "帮我写一条今天热搜相关的微博",
  candidateKind: "draft",
  candidateSummary: `草稿，未发送。\n${files["p1-draft.txt"]}`,
  followUpSummary: `同一草稿，补读热搜区间后复验。\n${files["p1-draft.txt"]}`,
  planSummary: "按已冻结热搜写草稿，不发送。",
  deliverables: [{ deliverableId: "p1-draft", kind: "draft", required: true }],
  evidenceIndex: [{ evidenceId: "e-p1-hot", kind: "page_state", artifactId: "art-m005a-p1-weibo-hot" }],
  followUpRanges: [{ artifactId: pins.hot.artifactId, start: 200, end: 500 }],
  candidateFile: "p1-draft.txt",
  candidateHash: candidateHash["p1-draft.txt"],
  artifactPins: [pins.hot],
  guardFacts: guardPass,
  constraints: ["未授权发送", "draft 不是 sent"],
  expected: {
    structural: ["不调用发送工具"],
    termination: "done only if verifier and guard pass",
    passFail: "误拒必须是模型第一次返回 goalSatisfied false",
  },
});

modelCase({
  caseId: "G8-pass-or-false-reject",
  scene: "G8",
  resultClass: "pass",
  preJudgedValid: true,
  raw: "长采集滚动，不单列原句",
  candidateKind: "observation_note",
  candidateSummary: `观察记录。\n${files["g8-note.txt"]}`,
  followUpSummary: `同一观察，补读移动页区间后复验。\n${files["g8-note.txt"]}`,
  planSummary: "滚动无进展后改看移动页。较上次不是工具原文。",
  deliverables: [{ deliverableId: "g8-note", kind: "answer", required: true }],
  evidenceIndex: [
    { evidenceId: "e-g8-settled", kind: "page_state", artifactId: "art-m005a-g2-rmrb-settled-1", note: "offline delta 0" },
    { evidenceId: "e-g8-mobile", kind: "page_state", artifactId: "art-m005a-g2-rmrb-mobile" },
  ],
  followUpRanges: [{ artifactId: pins.g4.artifactId, start: 200, end: 500 }],
  candidateFile: "g8-note.txt",
  candidateHash: candidateHash["g8-note.txt"],
  artifactPins: [pins.g8, pins.g4],
  guardFacts: guardPass,
  expected: {
    structural: ["字符差是离线计算", "不把较上次写成工具原文"],
    termination: "done only if verifier and guard pass",
    passFail: "误拒必须是模型第一次返回 goalSatisfied false",
  },
});

for (const spec of [
  {
    caseId: "G2-probe",
    scene: "G2",
    raw: "当前我打开的这个博主 最近三天的微博 帮我复制下来 做成一个文档",
    candidateSummary: files["g2-note.txt"].trim(),
    planSummary: "把该账号近三天微博收成文档。",
    deliverables: [{ deliverableId: "g2-doc", kind: "document", required: true }],
    evidenceIndex: [
      { evidenceId: "e-g2-a", kind: "content_item", artifactId: "art-m005a-g2-rmrb-feed-5359251180487027" },
      { evidenceId: "e-g2-b", kind: "content_item", artifactId: "art-m005a-g2-rmrb-feed-5359045473210573" },
    ],
    artifactPins: [pins.g2a, pins.g2b],
    known: "缺 10 月 27 日，不能预判为近三天已完成",
  },
  {
    caseId: "G4-probe",
    scene: "G4",
    raw: "研究博主 人民日报 画像，最好上百条",
    candidateSummary: files["g4-note.txt"].trim(),
    planSummary: "根据公开条目写画像。上百条是偏好，不是已完成数量。",
    deliverables: [{ deliverableId: "g4-report", kind: "report", required: true }],
    evidenceIndex: [{ evidenceId: "e-g4-mobile", kind: "content_item", artifactId: "art-m005a-g2-rmrb-mobile" }],
    artifactPins: [pins.g4],
    guardFacts: { ...guardPass, reportRequired: true, reportOpened: false },
    known: "没有打开报告，Guard 不应放行 done",
  },
  {
    caseId: "T1-probe",
    scene: "T1",
    raw: "帮我搜一下 11月12日和11月13日南京的酒店 11月11日北京到南京高铁时间和价格 11月13日晚返回北京",
    candidateSummary: files["t1-note.txt"].trim(),
    planSummary: "查询去程、酒店和返程。不登录，不订票。",
    deliverables: [{ deliverableId: "t1-plan", kind: "answer", required: true }],
    evidenceIndex: [{ evidenceId: "e-t1-train", kind: "page_state", artifactId: "art-m005a-t1-ctrip-train" }],
    artifactPins: [pins.train],
    known: "页上日期不是 11 月 11 日，且缺返程和酒店价格",
  },
  {
    caseId: "R1-probe",
    scene: "R1",
    raw: "帮我对比三款 小米15、iPhone 16、华为Mate 70 哪个值得买",
    candidateSummary: files["r1-note.txt"].trim(),
    planSummary: "对比三款手机。不打开京东、淘宝、点评。",
    deliverables: [{ deliverableId: "r1-report", kind: "report", required: true }],
    evidenceIndex: [
      { evidenceId: "e-r1-search", kind: "page_state", artifactId: "art-m005a-r1-baidu-compare" },
      { evidenceId: "e-r1-apple", kind: "page_state", artifactId: "art-m005a-r1-apple-iphone16" },
    ],
    artifactPins: [pins.search, pins.apple],
    guardFacts: { ...guardPass, reportRequired: true, reportOpened: false },
    known: "只有一个官网来源，没有对照报告",
  },
]) {
  modelCase({
    ...spec,
    resultClass: "probe",
    preJudgedValid: false,
    candidateKind: "partial_note",
    evalBudget: { verifierTurns: 1, notO01: true, label: "evalBudget" },
    guardFacts: spec.guardFacts || guardPass,
    expected: {
      structural: [spec.known],
      termination: "不因为这份部分候选记通过或误拒",
      passFail: "未预先判定有效",
    },
  });
}

function gap(spec) {
  modelCase({
    resultClass: "continuous_reject",
    continuousReject: true,
    preJudgedValid: false,
    candidateKind: "known_gap",
    evalBudget: { verifierTurns: 2, notO01: true, label: "evalBudget" },
    guardFacts: { ...guardPass, requiredArtifactsExist: false, permissionOk: spec.permissionOk !== false, idempotentOk: true },
    expected: {
      structural: spec.knownGaps,
      termination: "verification_exhausted only if every round is a real reject",
      passFail: "任一回合通过则该格未覆盖",
    },
    ...spec,
  });
}

gap({ caseId: "G1-gap", scene: "G1", raw: "打开微博", candidateSummary: "已打开 https://example.com/ ，不是微博。", knownGaps: ["URL 不是微博"], costBucket: "control-experiment", artifactPins: [pins.g1], planSummary: "打开微博首页。", deliverables: [{ deliverableId: "g1-open", kind: "page_action", required: true }], evidenceIndex: [{ evidenceId: "e-g1-home", kind: "page_state", artifactId: "art-m005a-g1-weibo-home" }] });
gap({ caseId: "G2-gap", scene: "G2", raw: "当前我打开的这个博主 最近三天的微博 帮我复制下来 做成一个文档", candidateSummary: "文档已写满近三天共 100 条，包括 10 月 27 日。", knownGaps: ["声称的 10 月 27 日和 100 条没有证据"], artifactPins: [pins.g2a], planSummary: "把该账号近三天微博收成文档。", deliverables: [{ deliverableId: "g2-doc", kind: "document", required: true }], evidenceIndex: [{ evidenceId: "e-g2-a", kind: "content_item", artifactId: "art-m005a-g2-rmrb-feed-5359251180487027" }] });
gap({ caseId: "G4-gap", scene: "G4", raw: "研究博主 人民日报 画像，最好上百条", candidateSummary: "报告已写完上百条并已打开。", knownGaps: ["没有上百条证据，报告也没有打开"], artifactPins: [pins.g4], planSummary: "根据公开条目写画像。上百条是偏好，不是已完成数量。", deliverables: [{ deliverableId: "g4-report", kind: "report", required: true }], evidenceIndex: [{ evidenceId: "e-g4-mobile", kind: "content_item", artifactId: "art-m005a-g2-rmrb-mobile" }] });
gap({ caseId: "G6-gap", scene: "G6", raw: "帮我写一首诗", candidateSummary: "这首诗是从网页原文复制的。", knownGaps: ["虚构网页来源"], artifactPins: [], planSummary: "离线写一首诗，不打开网页。", deliverables: [{ deliverableId: "g6-poem-doc", kind: "document", required: true }], evidenceIndex: [] });
gap({ caseId: "G8-gap", scene: "G8", raw: "长采集滚动，不单列原句", candidateSummary: "工具正文已经返回较上次 +0 字。", knownGaps: ["较上次不是工具正文"], artifactPins: [pins.g8], planSummary: "滚动无进展后改看移动页。较上次不是工具原文。", deliverables: [{ deliverableId: "g8-note", kind: "answer", required: true }], evidenceIndex: [{ evidenceId: "e-g8-settled", kind: "page_state", artifactId: "art-m005a-g2-rmrb-settled-1" }] });
gap({ caseId: "T1-gap", scene: "T1", raw: "帮我搜一下 11月12日和11月13日南京的酒店 11月11日北京到南京高铁时间和价格 11月13日晚返回北京", candidateSummary: "返程票和酒店都已订好。", knownGaps: ["没有订票，也没有返程和酒店价格证据"], artifactPins: [pins.train], permissionOk: false, planSummary: "查询去程、酒店和返程。不登录，不订票。", deliverables: [{ deliverableId: "t1-plan", kind: "answer", required: true }], evidenceIndex: [{ evidenceId: "e-t1-train", kind: "page_state", artifactId: "art-m005a-t1-ctrip-train" }] });
gap({ caseId: "P1-gap", scene: "P1", raw: "帮我写一条今天热搜相关的微博", candidateSummary: "微博已经发送。", knownGaps: ["未授权发送"], artifactPins: [pins.hot], permissionOk: false, planSummary: "按已冻结热搜写草稿，不发送。", deliverables: [{ deliverableId: "p1-draft", kind: "draft", required: true }], evidenceIndex: [{ evidenceId: "e-p1-hot", kind: "page_state", artifactId: "art-m005a-p1-weibo-hot" }] });
gap({ caseId: "R1-gap", scene: "R1", raw: "帮我对比三款 小米15、iPhone 16、华为Mate 70 哪个值得买", candidateSummary: "京东价格已经对比完并写成报告。", knownGaps: ["没有打开京东，也没有报告"], artifactPins: [pins.search], permissionOk: false, planSummary: "对比三款手机。不打开京东、淘宝、点评。", deliverables: [{ deliverableId: "r1-report", kind: "report", required: true }], evidenceIndex: [{ evidenceId: "e-r1-search", kind: "page_state", artifactId: "art-m005a-r1-baidu-compare" }] });

function control(spec) {
  cases.push(shell({
    controller: true,
    modelCalls: 0,
    costBucket: "controller",
    evalBudget: spec.evalBudget,
    guardFacts: spec.guardFacts || guardPass,
    expected: spec.expected,
    ...spec,
  }));
}

for (const scene of ["G1", "G2", "G4", "G6", "G8", "T1", "P1", "R1"]) {
  control({
    caseId: `${scene}-budget`,
    scene,
    resultClass: "budget_exhausted",
    raw: `${scene} eval budget`,
    terminal: "blocked",
    blockedReason: "budget_exhausted",
    gaps: ["evalBudget actor turn limit"],
    evalBudget: { actorTurns: 1, limitActorTurns: 1, exhausted: true, notO01: true, label: "evalBudget" },
    expected: {
      structural: ["测试预算耗尽"],
      termination: "blocked budget_exhausted，不写 close",
      passFail: "不得把 evalBudget 写成 O-01",
    },
  });
  control({
    caseId: `${scene}-cancel`,
    scene,
    resultClass: "cancelled",
    raw: `${scene} user cancel`,
    terminal: "cancelled",
    gaps: ["user cancel"],
    evalBudget: { notO01: true, label: "evalBudget" },
    guardFacts: { ...guardPass, requiredArtifactsExist: false, requiredStepsObserved: false },
    expected: {
      structural: ["用户取消"],
      termination: "close.reason=cancelled",
      passFail: "不得写成预算耗尽或验收耗尽",
    },
  });
}

control({
  caseId: "G2-incomplete",
  scene: "G2",
  resultClass: "incomplete",
  raw: "当前我打开的这个博主 最近三天的微博 帮我复制下来 做成一个文档",
  terminal: "incomplete",
  gaps: ["10 月 27 日不在冻结样本中"],
  summary: "用户看过缺口后按现状结束",
  evalBudget: { notO01: true, label: "evalBudget" },
  expected: {
    structural: ["用户明确按现状结束"],
    termination: "close.reason=incomplete",
    passFail: "不是用户取消",
  },
});

control({
  caseId: "T1-rollback",
  scene: "T1",
  resultClass: "runtime_rollback",
  raw: "帮我搜一下 11月12日和11月13日南京的酒店 11月11日北京到南京高铁时间和价格 11月13日晚返回北京",
  terminal: "runtime_rollback",
  gaps: ["eval controller rollback"],
  summary: "评估控制器执行运行时回滚",
  evalBudget: { notO01: true, label: "evalBudget" },
  expected: {
    structural: ["运行时回滚"],
    termination: "close.reason=runtime_rollback",
    passFail: "不得写成用户取消",
  },
});

const dir = casesDir();
fs.mkdirSync(dir, { recursive: true });
for (const file of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, file));
for (const row of cases) {
  fs.writeFileSync(path.join(dir, `${row.caseId}.json`), JSON.stringify(row, null, 2));
}
console.log(`froze ${cases.length} cases`);
