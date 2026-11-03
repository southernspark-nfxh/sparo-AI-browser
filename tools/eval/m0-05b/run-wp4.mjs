import fs from "node:fs";
import path from "node:path";
import { casesDir, loadVersions, runFrozenCase, writeRun } from "./case-runner.mjs";
import { evalOutDir } from "./paths.mjs";

const journal = path.join(process.env.APPDATA || "", "sparo-store", "missions.jsonl");
const before = fs.existsSync(journal) ? fs.statSync(journal) : null;
const versions = loadVersions();
fs.mkdirSync(evalOutDir("runs", "wp4"), { recursive: true });
fs.writeFileSync(evalOutDir("runs", "wp4", "versions.json"), JSON.stringify(versions, null, 2));

const files = fs.readdirSync(casesDir()).filter((name) => name.endsWith(".json")).sort();
const rows = [];
for (const file of files) {
  const caseDoc = JSON.parse(fs.readFileSync(path.join(casesDir(), file), "utf8"));
  let outcome;
  try {
    outcome = await runFrozenCase(caseDoc, versions);
  } catch (error) {
    outcome = { covered: false, observedClass: "error", reason: error instanceof Error ? error.message : String(error), modelCalls: 0, trace: [] };
  }
  writeRun(caseDoc.caseId, {
    caseId: caseDoc.caseId,
    scene: caseDoc.scene,
    resultClass: caseDoc.resultClass,
    costBucket: caseDoc.costBucket,
    preJudgedValid: caseDoc.preJudgedValid === true,
    covered: outcome.covered,
    observedClass: outcome.observedClass,
    reason: outcome.reason || "",
    modelCalls: outcome.modelCalls || 0,
    versions,
    trace: outcome.trace || [],
  });
  rows.push({ caseId: caseDoc.caseId, scene: caseDoc.scene, resultClass: caseDoc.resultClass, covered: outcome.covered, observedClass: outcome.observedClass, modelCalls: outcome.modelCalls || 0 });
  console.log(`${caseDoc.caseId}\t${outcome.observedClass}\tcovered=${outcome.covered}\tcalls=${outcome.modelCalls || 0}`);
}

const after = fs.existsSync(journal) ? fs.statSync(journal) : null;
if (!before || !after || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
  throw new Error("missions.jsonl changed");
}
fs.writeFileSync(evalOutDir("runs", "wp4", "index.json"), JSON.stringify({ versions, rows, o01: "[TBD]", journalUnchanged: true }, null, 2));
console.log(`ran ${rows.length}`);
