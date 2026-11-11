/** 谁在请求把某个标签变成某扇窗的当前页。 */
export type WindowActor = { clientId?: string; winId?: string };

export type ActivationInput = {
  actor?: WindowActor;
  tabWinId: string;
  tabOwner: "user" | `agent:${string}`;
  /** 用户点标签栏、快捷键、壳层开页。 */
  userAction?: boolean;
  /** ensure_render 专用：只在自己的窗口里切，不夺焦。 */
  backgroundRender?: boolean;
};

export type ActivationDenyReason = "other_window" | "not_your_tab" | "no_client_on_user_tab";

export type ActivationDecision = { ok: true } | { ok: false; reason: ActivationDenyReason };

/**
 * 能不能把这张标签变成它所在窗口的当前页。
 * 规则顺序固定：用户动作 > 无身份 > 跨窗 > 不是自己的标签 > 放行。
 */
export function mayActivateTab(input: ActivationInput): ActivationDecision {
  if (input.userAction === true) return { ok: true };
  const clientId = String(input.actor?.clientId || "").trim();
  if (!clientId) {
    if (input.tabOwner === "user") return { ok: false, reason: "no_client_on_user_tab" };
    return { ok: true };
  }
  if (input.tabWinId !== input.actor?.winId) return { ok: false, reason: "other_window" };
  if (input.tabOwner !== `agent:${clientId}`) {
    if (input.backgroundRender === true) return { ok: true };
    return { ok: false, reason: "not_your_tab" };
  }
  return { ok: true };
}

/**
 * createTab 在写 activeTabId 之前调用。
 * 请求激活但门不让，就把这次激活降成 false，标签留在后台。
 */
export function settleCreateActivate(
  requested: boolean,
  input: ActivationInput,
): { activate: boolean; reason?: ActivationDenyReason } {
  if (!requested) return { activate: false };
  const decision = mayActivateTab(input);
  if (!decision.ok) return { activate: false, reason: decision.reason };
  return { activate: true };
}

export const SWITCH_TAB_NEEDS_CLIENT = "switch_tab 需要 clientId：请先 initialize 获取 x-sparo-client";

/** 没有 clientId 时返回错误文案；有身份时返回空，调用方才可以 switchTab。 */
export function switchTabWithoutClient(clientId?: string): string | undefined {
  if (String(clientId || "").trim()) return undefined;
  return SWITCH_TAB_NEEDS_CLIENT;
}

/** 写操作必须已经解析出标签。无身份且无 tabId 时 bind 给出空串，这里拒绝，不回落用户当前页。 */
export function bindForWrite(tool: string, resolved?: string): string {
  if (resolved) return resolved;
  throw new Error(
    `${tool} 需要 clientId 或 tabId：请重新 initialize 获取 x-sparo-client 请求头，或显式传 tabId。不会默认操作用户当前标签。`,
  );
}
