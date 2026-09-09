import type { FailureHit, HelpAsk, LearnAdvice, LearnTrigger } from "./types.js";

const OVERLAY = "有弹窗";
const OTHER_ENTRY = "要换入口";
const NEED_LOGIN = "先登录";
const SKIP = "先不管";

export function questionFor(failure: FailureHit, zh: boolean): HelpAsk {
  if (failure.kind === "login_wall") {
    return {
      kind: "yes_no",
      question: zh ? "这个网站要先登录吗？" : "Does this site need you to sign in first?",
      failure,
    };
  }
  if (failure.kind === "captcha_wall") {
    return {
      kind: "continue",
      question: zh
        ? "页面在等人机验证。请你在网页上完成，不要把验证码发给我。完成后点「我过完了」。"
        : "The page wants a human check. Finish it on the page — don’t send me the code. Then tap Done.",
      failure,
    };
  }
  const target = failure.target ? `「${failure.target}」` : zh ? "这个按钮" : "this control";
  return {
    kind: "choice",
    question: zh
      ? `${target}点了没反应。是被弹窗挡住了，还是要换个入口？`
      : `${target} did nothing. Overlay in the way, or a different entry?`,
    options: zh
      ? [OVERLAY, OTHER_ENTRY, NEED_LOGIN, SKIP]
      : ["Overlay", "Another entry", "Sign in first", "Skip"],
    failure,
  };
}

export function parseAnswer(
  ask: HelpAsk,
  raw: string,
): { skip: boolean; trigger?: LearnTrigger; advice?: LearnAdvice; note?: string } {
  const t = String(raw || "").trim();
  if (!t) return { skip: true };
  if (ask.kind === "continue") {
    return { skip: false, trigger: "captcha_human", advice: "wait_human", note: "验证由人过" };
  }
  if (/先不管|跳过|不管|skip/i.test(t)) return { skip: true };
  if (ask.kind === "yes_no") {
    if (/^否|不是|不用|没有|no$/i.test(t)) return { skip: true };
    if (/^是|要|需要|对|yes$/i.test(t) || /登录|登陆|sign in|login/i.test(t)) {
      return { skip: false, trigger: "login", advice: "pause", note: "要先登录" };
    }
    return { skip: true };
  }
  if (/有弹窗|弹层|overlay/i.test(t)) {
    return { skip: false, trigger: "overlay", advice: "dismiss_overlay", note: "先关弹窗" };
  }
  if (/换入口|换个|another/i.test(t)) {
    return { skip: false, trigger: "dead_click", advice: "stop_retry", note: "同一按钮别连点" };
  }
  if (/先登录|要登录|sign in|login/i.test(t)) {
    return { skip: false, trigger: "login", advice: "pause", note: "要先登录" };
  }
  return { skip: true };
}
