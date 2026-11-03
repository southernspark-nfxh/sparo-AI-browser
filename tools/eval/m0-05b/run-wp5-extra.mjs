import fs from "node:fs";
import path from "node:path";
import { casesDir, loadVersions, runFrozenCase, writeRun } from "./case-runner.mjs";

const ids = ["G4-report-pass", "G6-false-reject-sample2", "G8-pass-sample2"];
const journal = path.join(process.env.APPDATA || "", "sparo-store", "missions.jsonl");
const before = fs.statSync(journal);
const versions = loadVersions();
for (const id of ids) {
  const caseDoc = JSON.parse(fs.readFileSync(path.join(casesDir(), `${id}.json`), "utf8"));
  const outcome = await runFrozenCase(caseDoc, versions);
  writeRun(id, {
    caseId: id,
    scene: caseDoc.scene,
    resultClass: caseDoc.resultClass,
    costBucket: caseDoc.costBucket,
    preJudgedValid: true,
    covered: outcome.covered,
    observedClass: outcome.observedClass,
    reason: outcome.reason || "",
    modelCalls: outcome.modelCalls || 0,
    versions,
    trace: outcome.trace || [],
  });
  console.log(`${id}\t${outcome.observedClass}\tcovered=${outcome.covered}\tcalls=${outcome.modelCalls || 0}\t${outcome.reason || ""}`);
}
const after = fs.statSync(journal);
if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error("missions.jsonl changed");
console.log("journal unchanged");
