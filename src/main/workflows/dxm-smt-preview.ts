/** 独立预览开关。不复用旧店小秘总开关。 */

export const DXM_SMT_SKILL_ID = "dxm-smt-listing";

export const DXM_SMT_WORKFLOW_IDS = [
  "dxm_smt_probe",
  "dxm_smt_prepare",
  "dxm_smt_status",
  "dxm_smt_publish",
  "dxm_smt_shops",
] as const;

export type DxmSmtWorkflowId = (typeof DXM_SMT_WORKFLOW_IDS)[number];

export const PREVIEW_CLOSED_MESSAGE =
  "店小秘专用工作流未开放，可改用通用页面工具继续；保存、认领、发布、付费仍需确认";

export const PREVIEW_CLOSED_DATA = {
  closed: true as const,
  fallback: "generic_page_tools" as const,
  code: "preview_closed" as const,
};

/** 五个白名单工作流和主技能关闭时共用这一份返回。 */
export function previewClosedToolResult(extra: Record<string, unknown> = {}): {
  ok: false;
  message: string;
  data: typeof PREVIEW_CLOSED_DATA & Record<string, unknown>;
} {
  return {
    ok: false,
    message: PREVIEW_CLOSED_MESSAGE,
    data: { ...PREVIEW_CLOSED_DATA, ...extra },
  };
}

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
