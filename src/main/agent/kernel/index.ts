/**
 * Sparo Agent 内核：入句 → 工作单 → 下一步 → 观察 → 契约验收。
 * 浏览器只执行手，不在这里做决策。
 */
export { applyTurn, applyTurnAsync, classifyIngest, type ActiveMission, type TurnCtx, type TurnResult } from "../runtime.js";
export {
  nextThought,
  nextThoughtAsync,
  suggestNextStep,
  parseReasonerJson,
  applyModelPick,
  reasonerPromptV2,
  type Thought,
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
import { verifyContracts } from "./verify.js";

function thoughtInput(mission: ActiveMission, synthesized?: string) {
  return {
    intent: mission.goal.intent,
    goal: mission.goal,
    findings: mission.findings,
    state: mission.state,
    ask: mission.ask,
    synthesized,
    nudge: mission.nudge,
  };
}

export function thoughtFor(mission: ActiveMission, synthesized?: string): Thought {
  return nextThought(thoughtInput(mission, synthesized));
}

export async function thoughtForAsync(
  mission: ActiveMission,
  complete?: (prompt: string) => Promise<string>,
  synthesized?: string,
): Promise<Thought> {
  return nextThoughtAsync(thoughtInput(mission, synthesized), complete);
}

export function observe(mission: ActiveMission, finding: StepFinding): ActiveMission {
  return {
    ...mission,
    findings: [...mission.findings, finding],
    state: mission.state === "waiting_human" ? "running" : mission.state,
  };
}

export function kernelTick(mission: ActiveMission, synthesized?: string): {
  thought: Thought;
  verdict: ReturnType<typeof verifyContracts>;
} {
  const thought = thoughtFor(mission, synthesized);
  const verdict = verifyContracts(mission.goal, mission.findings, { synthesized });
  return { thought, verdict };
}
