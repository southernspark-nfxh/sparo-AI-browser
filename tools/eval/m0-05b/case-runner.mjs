import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readRange, loadManifest } from "./artifact-store.mjs";
import { runCloseGuard } from "./close-guard.mjs";
import { callConfiguredModel, describeConfiguredModel, emptyUsage } from "./model.mjs";
import { evalOutDir, repoRoot } from "./paths.mjs";
import { promptHash, verifierMessages } from "./prompt.mjs";
import { createTrace } from "./trace.mjs";
import { buildVerifierInput } from "./verifier-input.mjs";
import { EVALUATION_MODE, FACILITY_VERSION, RUBRIC_VERSION } from "./version.mjs";

function parseVerification(text) {
  const match = String(text || "").match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const json = JSON.parse(match[0]);
    if (typeof json.goalSatisfied !== "boolean") return null;
    return json;
  } catch {
    return null;
  }
}

function gatedPass(parsed) {
  if (!parsed) return false;
  const confidence = parsed.confidence;
  return parsed.goalSatisfied === true && (confidence === "high" || confidence === "medium");
}

function assertFrozen(caseDoc) {
  if (caseDoc.frozen !== true) throw new Error(`${caseDoc.caseId} is not frozen`);
  if (caseDoc.promptHash !== promptHash()) throw new Error(`${caseDoc.caseId} prompt hash drifted`);
  if (caseDoc.rubricVersion !== RUBRIC_VERSION) throw new Error(`${caseDoc.caseId} rubric drifted`);
  if (caseDoc.facilityVersion !== FACILITY_VERSION) throw new Error(`${caseDoc.caseId} facility drifted`);
  const manifest = loadManifest();
  if (caseDoc.manifestSampleSetId !== manifest.sampleSetId) throw new Error("manifest id drifted");
  for (const pin of caseDoc.artifactPins || []) {
    const sample = manifest.samples.find((row) => row.artifactId === pin.artifactId);
    if (!sample || sample.contentHash !== pin.contentHash) throw new Error(`pin drifted ${pin.artifactId}`);
  }
}

function readDeclaredCandidate(caseDoc, trace) {
  if (caseDoc.guardFacts?.reportOpened === true && !caseDoc.candidateFile) {
    throw new Error(`${caseDoc.caseId} claims the report is open without a file`);
  }
  if (!caseDoc.candidateFile) return null;
  const file = path.join(repoRoot(), "docs", "sparo-agent-loop-devbook", "m0-05b", "candidates", caseDoc.candidateFile);
  const text = fs.readFileSync(file, "utf8");
  const hash = crypto.createHash("sha256").update(text, "utf8").digest("hex");
  if (caseDoc.candidateHash && hash !== caseDoc.candidateHash) throw new Error(`${caseDoc.caseId} candidate hash drifted`);
  if (caseDoc.guardFacts?.reportOpened === true) {
    trace.push("artifact.created", {
      artifactId: caseDoc.candidateFile,
      kind: "report_opened",
      contentHash: hash,
      length: text.length,
      unit: "chars",
    });
  }
  return { text, hash, length: text.length };
}

function candidateForVerifier(caseDoc, loaded) {
  const declared = caseDoc.candidateDeliverable;
  if (!declared) return undefined;
  if (!loaded?.text) throw new Error(`${caseDoc.caseId} candidate body was not read`);
  if (declared.contentHash !== loaded.hash) throw new Error(`${caseDoc.caseId} candidate hash drifted`);
  if (declared.range?.length !== loaded.length) throw new Error(`${caseDoc.caseId} candidate range does not cover the body`);
  if ((caseDoc.evidenceIndex || []).some((row) => row.artifactId === declared.artifactId)) {
    throw new Error(`${caseDoc.caseId} put the candidate deliverable into evidence`);
  }
  return { ...declared, notEvidence: true, text: loaded.text };
}

function baseTrace(caseDoc, versions) {
  const trace = createTrace(`eval-${caseDoc.caseId}`);
  trace.push("mission.opened", {
    scene: caseDoc.scene,
    resultClass: caseDoc.resultClass,
    raw: caseDoc.raw,
    versions,
    costBucket: caseDoc.costBucket,
  });
  return trace;
}

function finishLightweight(caseDoc, trace) {
  const closeGuard = runCloseGuard(caseDoc.guardFacts || {});
  trace.push("verification.completed", {
    verification: {
      verificationId: `eval-${caseDoc.caseId}-light`,
      missionId: `eval-${caseDoc.caseId}`,
      mode: "lightweight",
      rubricVersion: RUBRIC_VERSION,
      goalSatisfied: closeGuard.passed,
      independentVerifierCalls: 0,
    },
  });
  if (closeGuard.passed) {
    trace.push("mission.closed", {
      close: { reason: "done", summary: caseDoc.summary || "", gaps: [] },
      closeGuard,
    });
  } else {
    trace.push("mission.suspended", { reason: "error", gaps: [], closeGuard });
  }
  return {
    covered: closeGuard.passed,
    observedClass: closeGuard.passed ? "pass" : "uncovered",
    reason: closeGuard.passed ? "lightweight structure and guard passed; independent verifier calls 0" : "lightweight guard failed",
    modelCalls: 0,
    closeGuard,
    trace: trace.events,
  };
}

function finishController(caseDoc, trace) {
  const closeGuard = runCloseGuard(caseDoc.guardFacts || {});
  trace.push("budget.updated", { evalBudget: caseDoc.evalBudget, notO01: true });
  if (caseDoc.terminal === "blocked") {
    trace.push("mission.suspended", {
      reason: caseDoc.blockedReason,
      gaps: caseDoc.gaps || [],
      closeGuard,
      evalBudget: caseDoc.evalBudget,
    });
  } else {
    trace.push("mission.closed", {
      close: { reason: caseDoc.terminal, summary: caseDoc.summary || "", gaps: caseDoc.gaps || [] },
      closeGuard,
    });
  }
  return {
    covered: true,
    observedClass: caseDoc.resultClass,
    modelCalls: 0,
    closeGuard,
    trace: trace.events,
  };
}

async function oneVerifierCall(caseDoc, trace, versions, round, rangeRequests, loadedCandidate) {
  const rangeReads = [];
  for (const request of rangeRequests || []) {
    const range = readRange(request.artifactId, request.start, request.end);
    rangeReads.push({
      artifactId: range.artifactId,
      start: range.start,
      end: range.end,
      unit: range.unit,
      length: range.length,
      frozenVersion: range.frozenVersion,
      text: range.text,
    });
    trace.push("artifact.created", {
      artifactId: range.artifactId,
      frozenVersion: range.frozenVersion,
      contentRange: { start: range.start, end: range.end, unit: range.unit, length: range.length },
    });
  }
  const input = buildVerifierInput({
    raw: caseDoc.raw,
    constraints: caseDoc.constraints,
    planSummary: caseDoc.planSummary,
    deliverables: caseDoc.deliverables,
    evidenceIndex: caseDoc.evidenceIndex,
    candidateSummary: round === 1 ? caseDoc.candidateSummary : caseDoc.followUpSummary || caseDoc.candidateSummary,
    candidateDeliverable: candidateForVerifier(caseDoc, loadedCandidate),
    rangeReads,
  });
  trace.push("model.requested", {
    role: "verifier",
    round,
    rubricVersion: RUBRIC_VERSION,
    promptVersion: caseDoc.promptVersion,
    modelVersion: versions.modelVersion,
    candidateDeliverable: input.candidateDeliverable
      ? {
          artifactId: input.candidateDeliverable.artifactId,
          contentHash: input.candidateDeliverable.contentHash,
          textLength: input.candidateDeliverable.text.length,
          notEvidence: true,
        }
      : undefined,
  });
  const response = await callConfiguredModel({ messages: verifierMessages(input) });
  const usage = response.usage || emptyUsage();
  if (!response.called) {
    trace.push("model.failed", { role: "verifier", round, reason: response.reason || "not called", ...usage });
    return { called: false, parsed: null, rawGoalSatisfied: null, gated: false, usage };
  }
  const parsed = parseVerification(response.text);
  trace.push("model.completed", {
    role: "verifier",
    round,
    modelVersion: response.described?.modelVersion || versions.modelVersion,
    promptVersion: caseDoc.promptVersion,
    ...usage,
    parsed: Boolean(parsed),
    artifactRanges: rangeReads.map((row) => ({
      artifactId: row.artifactId,
      start: row.start,
      end: row.end,
      unit: row.unit,
      length: row.length,
      frozenVersion: row.frozenVersion,
      textLength: row.text.length,
    })),
  });
  const verification = {
    verificationId: `eval-${caseDoc.caseId}-r${round}`,
    missionId: `eval-${caseDoc.caseId}`,
    mode: "independent",
    rubricVersion: RUBRIC_VERSION,
    goalSatisfied: gatedPass(parsed),
    rawGoalSatisfied: parsed ? parsed.goalSatisfied : null,
    confidence: parsed?.confidence || "low",
    rationale: parsed?.rationale || "unparsed verifier output",
    deliverables: parsed?.deliverables || [],
    unexecutedStepIds: parsed?.unexecutedStepIds || [],
    invalidEvidenceIds: parsed?.invalidEvidenceIds || [],
    actionableGaps: parsed?.actionableGaps || [],
  };
  trace.push("verification.completed", { verification });
  return { called: true, parsed, rawGoalSatisfied: parsed ? parsed.goalSatisfied : null, gated: gatedPass(parsed), usage, verification };
}

export async function runFrozenCase(caseDoc, versions) {
  assertFrozen(caseDoc);
  const trace = baseTrace(caseDoc, versions);
  const loadedCandidate = readDeclaredCandidate(caseDoc, trace);
  if (caseDoc.controller) return finishController(caseDoc, trace);
  if (caseDoc.lightweight) return finishLightweight(caseDoc, trace);

  const rounds = [];
  const max = caseDoc.evalBudget?.verifierTurns || 1;
  let round = 1;
  let first = await oneVerifierCall(caseDoc, trace, versions, round, [], loadedCandidate);
  rounds.push(first);
  const follow = caseDoc.preJudgedValid === true && first.called && first.parsed && first.rawGoalSatisfied === false;
  if (follow && max >= 2) {
    round = 2;
    rounds.push(await oneVerifierCall(caseDoc, trace, versions, round, caseDoc.followUpRanges || [], loadedCandidate));
  }
  if (caseDoc.continuousReject === true && first.called && first.parsed && first.rawGoalSatisfied === false && max >= 2) {
    round = 2;
    rounds.push(await oneVerifierCall(caseDoc, trace, versions, round, [], loadedCandidate));
  }

  const closeGuard = runCloseGuard(caseDoc.guardFacts || {});
  const last = rounds.at(-1);
  const passed = Boolean(last?.gated) && closeGuard.passed;
  let covered = false;
  let observedClass = "uncovered";
  let reason = "";
  if (!first.called || !first.parsed) {
    reason = first.called ? "verifier output was not the frozen JSON" : first.usage && first.called === false ? "model call failed" : "model unavailable";
    if (!first.called) reason = "model call failed or disabled";
    if (first.called && !first.parsed) reason = "verifier output was not the frozen JSON";
  } else if (caseDoc.preJudgedValid === true && first.rawGoalSatisfied === false && last?.gated && closeGuard.passed) {
    covered = true;
    observedClass = "false_reject_then_pass";
  } else if (caseDoc.preJudgedValid === true && first.gated && closeGuard.passed) {
    covered = true;
    observedClass = "pass";
    reason = "预先判定有效的候选没有被拒绝，误拒格未覆盖";
  } else if (caseDoc.preJudgedValid === true && first.rawGoalSatisfied === false) {
    observedClass = "false_reject_then_pass";
    reason = "发生拒绝，但补读后的复验或 Close Guard 没有通过";
  } else if (caseDoc.continuousReject === true && rounds.length === max && rounds.every((row) => row.parsed && row.rawGoalSatisfied === false)) {
    covered = true;
    observedClass = "continuous_reject";
    trace.push("mission.suspended", {
      reason: "verification_exhausted",
      gaps: caseDoc.knownGaps || [],
      closeGuard,
      evalBudget: caseDoc.evalBudget,
    });
  } else if (caseDoc.continuousReject === true) {
    reason = "Verifier 没有按冻结轮次连续拒绝这份有缺口的候选";
  } else if (caseDoc.preJudgedValid === true && first.gated && !closeGuard.passed) {
    reason = "Verifier 通过但 Close Guard 未通过，通过格不记";
  } else if (passed) {
    reason = "候选未预先判定为有效，通过格不记";
  } else {
    reason = "候选未预先判定为有效，拒绝也不记成误拒";
  }

  if ((observedClass === "pass" || observedClass === "false_reject_then_pass") && closeGuard.passed && covered) {
    trace.push("mission.closed", {
      close: { reason: "done", summary: caseDoc.summary || "", gaps: [] },
      closeGuard,
    });
  } else if (observedClass !== "continuous_reject" && !closeGuard.passed) {
    const verifyEvent = trace.events.filter((event) => event.name === "verification.completed").at(-1);
    if (verifyEvent) verifyEvent.closeGuard = closeGuard;
    if (caseDoc.preJudgedValid === true) {
      trace.push("mission.suspended", {
        reason: "error",
        gaps: closeGuard.checks.filter((row) => !row.passed).map((row) => row.name),
        closeGuard,
      });
    }
  }

  const doneEvents = trace.events.filter((event) => event.name === "mission.closed" && event.close?.reason === "done");
  if (doneEvents.length && !closeGuard.passed) throw new Error("guard failure wrote done");
  return { covered, observedClass, reason, modelCalls: rounds.filter((row) => row.called).length, rounds: rounds.length, closeGuard, trace: trace.events };
}

export function loadVersions() {
  const described = describeConfiguredModel();
  const manifest = loadManifest();
  return {
    evaluationMode: EVALUATION_MODE,
    facilityVersion: FACILITY_VERSION,
    rubricVersion: RUBRIC_VERSION,
    promptVersion: "verifier-prompt-1",
    promptHash: promptHash(),
    manifestSampleSetId: manifest.sampleSetId,
    modelVersion: described.modelVersion || "[TBD]",
    provider: described.provider || "[TBD]",
    llmMode: described.llmMode || "[TBD]",
    priceVersion: "[TBD]",
    productionV2: false,
  };
}

export function casesDir() {
  return evalOutDir("cases");
}

export function writeRun(caseId, payload) {
  const dir = evalOutDir("runs", "wp4");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${caseId}.json`), JSON.stringify(payload, null, 2));
}
