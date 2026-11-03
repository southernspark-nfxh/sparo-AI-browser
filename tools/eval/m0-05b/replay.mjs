import { readRange } from "./artifact-store.mjs";
import { runCloseGuard } from "./close-guard.mjs";
import { callConfiguredModel, emptyUsage } from "./model.mjs";
import { createTrace } from "./trace.mjs";
import { buildVerifierInput } from "./verifier-input.mjs";
import { RUBRIC_VERSION } from "./version.mjs";

function verificationShell(mission, mode) {
  return {
    verificationId: `${mission.missionId}-verify`,
    missionId: mission.missionId,
    mode,
    rubricVersion: RUBRIC_VERSION,
    goalSatisfied: false,
    deliverables: (mission.deliverables || []).map((row) => ({
      deliverableId: row.deliverableId,
      status: row.status || "missing",
      reason: row.reason || "",
      evidenceIds: row.evidenceIds || [],
    })),
    unexecutedStepIds: mission.unexecutedStepIds || [],
    invalidEvidenceIds: mission.invalidEvidenceIds || [],
    actionableGaps: mission.actionableGaps || [],
    confidence: "low",
    rationale: "",
  };
}

export async function replayMission(mission, options = {}) {
  const trace = createTrace(mission.missionId);
  trace.push("mission.opened", { raw: mission.raw, scene: mission.scene || "" });
  const rangeReads = [];
  for (const request of mission.rangeRequests || []) {
    const range = readRange(request.artifactId, request.start, request.end);
    rangeReads.push(range);
    trace.push("artifact.created", {
      artifactId: range.artifactId,
      frozenVersion: range.frozenVersion,
      contentRange: { start: range.start, end: range.end, unit: range.unit, length: range.length },
    });
  }
  const verifierInput = buildVerifierInput({ ...mission, rangeReads });
  let result = verificationShell(mission, mission.lightweight ? "lightweight" : "independent");
  if (mission.lightweight) {
    result = {
      ...result,
      mode: "lightweight",
      goalSatisfied: mission.structuralOk === true,
      confidence: mission.structuralOk === true ? "high" : "low",
      rationale: "lightweight structural check; independent verifier was not called",
    };
    trace.push("verification.completed", { verification: result, modelCalls: 0 });
  } else {
    trace.push("model.requested", { role: "verifier", rubricVersion: RUBRIC_VERSION });
    const model = options.model || callConfiguredModel;
    const response = await model({ messages: [{ role: "user", content: JSON.stringify(verifierInput) }] });
    const usage = response.usage || emptyUsage();
    if (!response.called) {
      trace.push("model.failed", { role: "verifier", reason: response.reason || "not called", ...usage });
      result = {
        ...result,
        rationale: response.reason || "verifier was not called",
        actionableGaps: [{ gapId: "model-unavailable", problem: result.rationale, suggestedNextAction: "enable the existing model only for a later replay" }],
      };
    } else {
      trace.push("model.completed", {
        role: "verifier",
        modelVersion: response.described?.modelVersion || "[TBD]",
        ...usage,
        artifactRanges: rangeReads.map((row) => ({
          artifactId: row.artifactId,
          start: row.start,
          end: row.end,
          unit: row.unit,
          length: row.length,
        })),
      });
      result = { ...result, ...(response.verification || {}), rubricVersion: RUBRIC_VERSION, mode: "independent" };
    }
    trace.push("verification.completed", { verification: result });
  }

  const closeGuard = runCloseGuard(mission.guardFacts || {});
  const terminal = mission.terminal || null;
  const userStop = terminal === "cancelled" || terminal === "incomplete" || terminal === "runtime_rollback";
  if (userStop) {
    trace.push("mission.closed", {
      close: { reason: terminal, summary: mission.closeSummary || "", gaps: mission.closeGaps || [] },
      closeGuard,
    });
  } else if (!closeGuard.passed) {
    const last = trace.events.filter((event) => event.name === "verification.completed").at(-1);
    if (last) last.closeGuard = closeGuard;
    trace.push("mission.suspended", {
      reason: mission.suspendReason || "error",
      gaps: closeGuard.checks.filter((row) => !row.passed).map((row) => row.name),
      closeGuard,
    });
  } else if (terminal === "done") {
    trace.push("mission.closed", {
      close: { reason: "done", summary: mission.closeSummary || "", gaps: [] },
      closeGuard,
    });
  }

  const closed = trace.events.filter((event) => event.name === "mission.closed");
  if (!closeGuard.passed && closed.some((event) => event.close?.reason === "done")) {
    throw new Error("guard failure wrote close.reason=done");
  }
  return { trace: trace.events, verification: result, closeGuard, verifierInput };
}
