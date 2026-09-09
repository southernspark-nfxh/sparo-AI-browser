import { REPEAT_LIMIT, WATCH_TOOLS, type ActionKey, type FailureHit, type ObservedAction, type PageFinger } from "./types.js";
import { hostOf } from "./store.js";

export function pageFinger(url: string, title: string): PageFinger {
  return { url: String(url || ""), title: String(title || ""), host: hostOf(url) };
}

export function actionKey(tool: string, args: Record<string, unknown>): ActionKey | null {
  if (!WATCH_TOOLS.has(tool)) return null;
  const target =
    tool === "navigate"
      ? hostOf(String(args.url || ""))
      : String(args.text || args.selector || args.ref || "").trim().slice(0, 80);
  if (!target) return null;
  return { tool, target: target.toLowerCase() };
}

export function sameKey(a: ActionKey, b: ActionKey): boolean {
  return a.tool === b.tool && a.target === b.target;
}

export function sameView(a: PageFinger, b: PageFinger): boolean {
  return a.url === b.url && a.title === b.title;
}

/** 登录墙：看地址和标题，不看正文（首页常有「登录」按钮）。 */
export function isLoginWall(finger: PageFinger): boolean {
  const url = finger.url.toLowerCase();
  const title = finger.title;
  if (/\/(login|signin|sign-in|passport|auth\/|account\/login)/i.test(url)) return true;
  if (/(accounts|login|passport|sso)\./i.test(finger.host)) return true;
  if (/^(登录|登陆|sign in|log in|sign-in)\b/i.test(title.trim())) return true;
  if (/请(先)?(登录|登陆)/.test(title)) return true;
  return false;
}

export function isCaptchaWall(finger: PageFinger): boolean {
  const blob = `${finger.url} ${finger.title}`;
  return /captcha|recaptcha|hcaptcha|滑块|人机验证|安全验证/i.test(blob);
}

export function detectFailure(recent: ObservedAction[]): FailureHit | null {
  if (!recent.length) return null;
  const last = recent[recent.length - 1];
  if (isCaptchaWall(last.after)) {
    return { kind: "captcha_wall", host: last.after.host, target: last.key.target, count: 1 };
  }
  if (!isLoginWall(last.before) && isLoginWall(last.after)) {
    return { kind: "login_wall", host: last.after.host, target: last.key.target, count: 1 };
  }
  const tail = recent.slice(-REPEAT_LIMIT);
  if (
    tail.length >= REPEAT_LIMIT &&
    tail.every((x) => sameKey(x.key, last.key))
  ) {
    return {
      kind: "repeated_action",
      host: last.after.host || last.before.host,
      target: last.key.target,
      count: tail.length,
    };
  }
  const pair = recent.slice(-2);
  if (
    pair.length === 2 &&
    sameKey(pair[0].key, pair[1].key) &&
    pair[1].key.tool !== "navigate" &&
    sameView(pair[1].before, pair[1].after) &&
    sameView(pair[0].before, pair[0].after)
  ) {
    return {
      kind: "dead_click",
      host: last.after.host || last.before.host,
      target: last.key.target,
      count: 2,
    };
  }
  return null;
}
