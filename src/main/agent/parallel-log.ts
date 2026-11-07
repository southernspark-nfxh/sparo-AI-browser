/** T75 取证日志。只记，不改走向。 */

export function formatFillFailure(input: {
  tab: string;
  active: boolean;
  focused: boolean;
  method: string;
  matched: boolean;
}): string {
  return `[fill] tab=${input.tab} active=${input.active} focused=${input.focused} method=${input.method} matched=${input.matched}`;
}

export function formatLane(input: {
  path: "sidebar" | "mcp";
  classified: string;
  applied: string;
  chatRunning: boolean;
  freeSoulRunning: boolean;
  active: string;
  agentTab: string;
}): string {
  return `[lane] path=${input.path} classified=${input.classified} applied=${input.applied} chatRunning=${input.chatRunning} freeSoulRunning=${input.freeSoulRunning} active=${input.active} agentTab=${input.agentTab}`;
}

export function formatLearnSwallow(where: "openHelpAsk" | "applyHostLessons" | "answerLearning"): string {
  return `[learn] swallowed ${where} while freeSoulRunning`;
}
