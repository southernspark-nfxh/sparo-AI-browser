/** 独立预览开关。不复用旧店小秘总开关。 */

export const DXM_SMT_SKILL_ID = "dxm-smt-listing";

export const DXM_SMT_WORKFLOW_IDS = [
  "dxm_smt_probe",
  "dxm_smt_prepare",
  "dxm_smt_status",
  "dxm_smt_publish",
] as const;

export type DxmSmtWorkflowId = (typeof DXM_SMT_WORKFLOW_IDS)[number];

export const PREVIEW_CLOSED_MESSAGE = "该能力尚未开放";

export function dxmSmtPreviewEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SPARO_DXM_SMT_PREVIEW === "1";
}

export function isDxmSmtWorkflowId(id: string): id is DxmSmtWorkflowId {
  return (DXM_SMT_WORKFLOW_IDS as readonly string[]).includes(id);
}

export function gateFreeSoulWorkflow(
  id: string,
  env: NodeJS.ProcessEnv = process.env,
): { action: "reject" | "closed" | "run"; message: string } {
  if (!isDxmSmtWorkflowId(id)) {
    return { action: "reject", message: "Free Soul 只接受店小秘速卖通白名单工作流" };
  }
  if (!dxmSmtPreviewEnabled(env)) {
    return { action: "closed", message: PREVIEW_CLOSED_MESSAGE };
  }
  return { action: "run", message: "" };
}

export function gateDxmSmtSkill(
  skillId: string,
  env: NodeJS.ProcessEnv = process.env,
): { message: string } | null {
  if (skillId !== DXM_SMT_SKILL_ID) return null;
  if (dxmSmtPreviewEnabled(env)) return null;
  return { message: PREVIEW_CLOSED_MESSAGE };
}
