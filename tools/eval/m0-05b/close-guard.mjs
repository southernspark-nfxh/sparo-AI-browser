const CHECKS = [
  ["artifact_exists", (facts) => facts.requiredArtifactsExist === true],
  ["report_opened", (facts) => facts.reportRequired !== true || facts.reportOpened === true],
  ["plan_observed", (facts) => facts.requiredStepsObserved === true],
  ["permission_and_idempotency", (facts) => facts.permissionOk === true && facts.idempotentOk === true],
  ["budget_and_state", (facts) => facts.budgetLegal === true && facts.stateLegal === true],
];

export function runCloseGuard(facts) {
  const checks = CHECKS.map(([name, pass]) => ({ name, passed: pass(facts || {}) }));
  return { passed: checks.every((row) => row.passed), checks };
}
