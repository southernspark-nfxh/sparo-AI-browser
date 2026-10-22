/**
 * Sparo Agent 内核：入句 → 工作单 → 下一步 → 观察 → 契约验收。
 * 浏览器只执行手，不在这里做决策。
 */
export {
  applyTurn,
  applyTurnAsync,
  classifyIngest,
  reviseActivePlan,
  type ActiveMission,
  type TurnCtx,
  type TurnResult,
} from "../runtime.js";
export {
  appendPlanAlternative,
  applyParsedRevision,
  closePlan,
  focusPlanOnStep,
  notePlanStep,
  nudgeFromPlan,
  parsePlanJson,
  parsePlanRevision,
  planFromHeuristic,
  planPrompt,
  planRevisionPrompt,
  type Plan,
  type PlanStep,
} from "./plan.js";
export {
  nextThought,
  nextThoughtAsync,
  suggestNextStep,
  parseReasonerJson,
  applyModelPick,
  reasonerPromptV2,
  gateSiteDelivery,
  mismatchWrap,
  forcedSiteNavigate,
  loginRedirectNote,
  parseSiteLanding,
  siteLandingPrompt,
  type Thought,
  type SiteGate,
} from "./reasoner.js";
export { verifyContracts, observationCovers, extractEntities, summaryFindings } from "./verify.js";
export { CAP_REGISTRY, capsFor } from "./caps.js";
export {
  understand,
  understandLocal,
  type Understanding,
} from "../brain/understand.js";
export {
  reconsider,
  reconsiderLocal,
  reconsiderMission,
  applyReconsider,
  type Reconsider,
} from "../brain/reconsider.js";

import type { ActiveMission } from "../runtime.js";
import type { StepFinding } from "../loop.js";
import { nextThought, nextThoughtAsync, type Thought } from "./reasoner.js";
import { notePlanStep } from "./plan.js";
import { journalMissionTurn } from "../mission-journal.js";
import { verifyContracts } from "./verify.js";

function thoughtInput(mission: ActiveMission, synthesized?: string, pageUrl?: string) {
  return {
    intent: mission.goal.intent,
    goal: mission.goal,
    findings: mission.findings,
    state: mission.state,
    ask: mission.ask,
    synthesized,
    nudge: mission.nudge,
    pageUrl,
  };
}

export function thoughtFor(mission: ActiveMission, synthesized?: string, pageUrl?: string): Thought {
  return nextThought(thoughtInput(mission, synthesized, pageUrl));
}

export async function thoughtForAsync(
  mission: ActiveMission,
  complete?: (prompt: string) => Promise<string>,
  synthesized?: string,
  pageUrl?: string,
): Promise<Thought> {
  return nextThoughtAsync(thoughtInput(mission, synthesized, pageUrl), complete);
}

export function observe(mission: ActiveMission, finding: StepFinding): ActiveMission {
  const next: ActiveMission = {
    ...mission,
    findings: [...mission.findings, finding],
    brainPlan: mission.brainPlan ? notePlanStep(mission.brainPlan, finding) : mission.brainPlan,
    state: mission.state === "waiting_human" ? "running" : mission.state,
  };
  journalMissionTurn(next);
  return next;
}

export function kernelTick(mission: ActiveMission, synthesized?: string): {
  thought: Thought;
  verdict: ReturnType<typeof verifyContracts>;
} {
  const thought = thoughtFor(mission, synthesized);
  const verdict = verifyContracts(mission.goal, mission.findings, { synthesized });
  return { thought, verdict };
}
