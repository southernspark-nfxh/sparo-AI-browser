import fs from "node:fs";
import path from "node:path";
import { casesDir, loadVersions, runFrozenCase, writeRun } from "./case-runner.mjs";
import { evalOutDir } from "./paths.mjs";

const ids = ["G4-portrait-read", "G2-posts-ids", "G8-host-read"];
if (process.env.SPARO_EVAL_ALLOW_MODEL !== "1") throw new Error("model call not enabled");

const journal = path.join(process.env.APPDATA || "", "sparo-store", "missions.jsonl");
const before = fs.statSync(journal);
const runDir = evalOutDir("runs", "wp4");
for (const id of ids) {
  const dest = path.join(runDir, `${id}.json`);
  if (fs.existsSync(dest)) throw new Error(`trace exists ${id}`);
}
const versions = loadVersions();
const rows = [];
for (const id of ids) {
  const caseDoc = JSON.parse(fs.readFileSync(path.join(casesDir(), `${id}.json`), "utf8"));
  if (!ids.includes(caseDoc.caseId)) throw new Error(`unexpected case ${caseDoc.caseId}`);
  const outcome = await runFrozenCase(caseDoc, versions);
  writeRun(id, {
    caseId: id,
    scene: caseDoc.scene,
    resultClass: caseDoc.resultClass,
    costBucket: caseDoc.costBucket,
    hostScene: caseDoc.hostScene,
    doubleCountWithHost: caseDoc.doubleCountWithHost,
    preJudgedValid: caseDoc.preJudgedValid === true,
    covered: outcome.covered,
    observedClass: outcome.observedClass,
    reason: outcome.reason || "",
    modelCalls: outcome.modelCalls || 0,
    versions,
    trace: outcome.trace || [],
  });
  rows.push({ id, observedClass: outcome.observedClass, covered: outcome.covered, calls: outcome.modelCalls || 0, reason: outcome.reason || "" });
  console.log(`${id}\t${outcome.observedClass}\tcovered=${outcome.covered}\tcalls=${outcome.modelCalls || 0}\t${outcome.reason || ""}`);
  const mid = fs.statSync(journal);
  if (before.size !== mid.size || before.mtimeMs !== mid.mtimeMs) throw new Error("missions.jsonl changed");
}
const after = fs.statSync(journal);
if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error("missions.jsonl changed");
console.log(`journal unchanged size=${after.size}`);
console.log(JSON.stringify(rows));
