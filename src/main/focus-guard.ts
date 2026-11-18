/**
 * 人机共用：活人正在打字时，Agent 的抢焦点动作要让开。
 * 只做判定和填表兜底脚本，不碰 0.7.3 的摘挂 / 退避 / 焦点归还。
 */

/** 与壳层 shellIsTyping 同一扇窗口：1.5 秒。 */
export const HUMAN_TYPING_WINDOW_MS = 1_500;

/** 点击撞上打字时，隔 1 秒再看一次。 */
export const FOCUS_GUARD_WAIT_MS = 1_000;

/** 最多让开这么多次，之后必须把「活人正在打字」交回去，不许把点击吞掉。 */
export const FOCUS_GUARD_MAX_DEFERRALS = 5;

export function humanTypingRecentlyAt(input: {
  shellAt?: number;
  mainAt?: number;
  now: number;
  windowMs?: number;
}): boolean {
  const windowMs = input.windowMs ?? HUMAN_TYPING_WINDOW_MS;
  const latest = Math.max(Number(input.shellAt) || 0, Number(input.mainAt) || 0);
  return latest > 0 && input.now - latest < windowMs;
}

/**
 * before-input-event 里哪些算真人按键。
 * Agent 的 sendInputEvent 在注入期间带 agentInjecting，不能把自己记成真人，否则门禁会把自己锁死。
 */
export function shouldStampHumanTyping(input: { type?: string; agentInjecting?: boolean }): boolean {
  if (input.agentInjecting) return false;
  const type = String(input.type || "");
  return type === "keyDown" || type === "char";
}

/** 人在打字就直接让开，不再看是谁发起的聚焦。 */
export function focusActivePagePlan(typingRecently: boolean): "defer" | "continue" {
  return typingRecently ? "defer" : "continue";
}

/** 人在打字时填表不走 el.focus()，把 value setter 提前。 */
export function fillDomPlan(typingRecently: boolean): {
  allowFocus: boolean;
  firstStep: "focus" | "value-setter";
} {
  if (typingRecently) return { allowFocus: false, firstStep: "value-setter" };
  return { allowFocus: true, firstStep: "focus" };
}

export function focusGuardClickError(): string {
  return "活人正在打字，点击已让开 5 次仍未结束，本次点击取消，没有抢键盘焦点";
}

export function focusGuardDetail(kind: "click" | "fill" | "focus", winId: string): string {
  return `defer kind=${kind} win=${winId}`;
}

export function clickDeferPlan(input: { typing: boolean; deferrals: number }):
  | { action: "click" }
  | { action: "wait"; waitMs: number; deferrals: number }
  | { action: "error"; message: string } {
  if (!input.typing) return { action: "click" };
  if (input.deferrals >= FOCUS_GUARD_MAX_DEFERRALS) {
    return { action: "error", message: focusGuardClickError() };
  }
  return {
    action: "wait",
    waitMs: FOCUS_GUARD_WAIT_MS,
    deferrals: input.deferrals + 1,
  };
}

const VALUE_SETTER_JS = `
const win = window;
const proto = el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
if (setter) setter.call(el, __v); else el.value = __v;
el.dispatchEvent(new Event('input', { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
`;

/**
 * fill 的 execCommand 兜底。skipFocus 时不调用 el.focus()，
 * 输入框直接走 value setter + input/change（原来失败后才走的那段，提前）。
 */
export function fillExecFallbackInner(skipFocus: boolean): string {
  if (skipFocus) {
    return `
if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
${VALUE_SETTER_JS}
} else {
  try { el.textContent = __v; } catch (_) {}
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
`;
  }
  return `
el.focus();
try {
  const selApi = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  selApi && selApi.removeAllRanges();
  selApi && selApi.addRange(range);
  document.execCommand('delete', false, undefined);
} catch (_) {}
const ok = document.execCommand('insertText', false, __v);
if (!ok && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
${VALUE_SETTER_JS}
}
`;
}

/** contenteditable 短文本重试。人在打字时同样不 el.focus()。 */
export function fillCeRetryInner(skipFocus: boolean): string {
  if (skipFocus) {
    return `
try { el.textContent = __v; } catch (_) {}
el.dispatchEvent(new Event('input', { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
`;
  }
  return `
el.focus();
try {
  const selApi = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  selApi && selApi.removeAllRanges();
  selApi && selApi.addRange(range);
  document.execCommand('selectAll', false, undefined);
  document.execCommand('delete', false, undefined);
} catch (_) {}
try { el.textContent = ''; } catch (_) {}
document.execCommand('insertText', false, __v);
`;
}
