export type LearnTrigger = "login" | "overlay" | "captcha_human" | "dead_click";
export type LearnAdvice = "pause" | "dismiss_overlay" | "stop_retry" | "wait_human";
export type FailureKind = "repeated_action" | "dead_click" | "login_wall" | "captcha_wall";
export type HelpKind = "yes_no" | "choice" | "continue";

export interface Lesson {
  id: string;
  host: string;
  trigger: LearnTrigger;
  advice: LearnAdvice;
  note: string;
  createdAt: string;
  applyCount: number;
  lastAppliedAt?: string;
}

export interface PageFinger {
  url: string;
  title: string;
  host: string;
}

export interface ActionKey {
  tool: string;
  target: string;
}

export interface ObservedAction {
  key: ActionKey;
  before: PageFinger;
  after: PageFinger;
}

export interface FailureHit {
  kind: FailureKind;
  host: string;
  target: string;
  count: number;
}

export interface HelpAsk {
  kind: HelpKind;
  question: string;
  options?: string[];
  failure: FailureHit;
}

export const WATCH_TOOLS = new Set(["navigate", "click", "click_text", "fill"]);
export const MAX_LESSONS = 200;
export const REPEAT_LIMIT = 3;
