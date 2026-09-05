/**
 * Turn a successful agent tool trace into a saved 妙招 so the next similar goal is faster.
 */
import type { Skill, SkillStep } from "../skills/store.js";
import { createSkillFromTrace, listSkills } from "../skills/store.js";

export type Mutation = { tool: string; args: Record<string, unknown> };

const MUTATING = new Set(["navigate", "click", "fill", "click_text"]);

export function mutationsToSteps(mutations: Mutation[]): SkillStep[] {
  const steps: SkillStep[] = [];
  for (const m of mutations) {
    if (!MUTATING.has(m.tool)) continue;
    const args = m.args || {};
    const step: SkillStep = { action: m.tool };
    if (typeof args.url === "string") step.url = args.url;
    if (typeof args.selector === "string") step.selector = args.selector;
    if (typeof args.ref === "string") step.cssPath = args.ref;
    if (typeof args.text === "string") step.text = args.text;
    if (m.tool === "fill") {
      const value = String(args.value ?? "");
      step.value = value.length > 16 ? "{{body}}" : value;
    }
    steps.push(step);
  }
  return steps;
}

export function shouldSkipRemember(goal: string, reply = ""): boolean {
  return /已暂停|滑块|验证码|captcha|paused|Human has taken|登录验证/i.test(
    `${goal} ${reply}`,
  );
}

export function rememberFromTrace(input: {
  configDir: string;
  goal: string;
  url?: string;
  mutations: Mutation[];
}): Skill | null {
  if (shouldSkipRemember(input.goal)) return null;
  const steps = mutationsToSteps(input.mutations);
  if (steps.filter((s) => s.action !== "navigate").length < 2) return null;

  const title = skillTitleFromGoal(input.goal);
  const existing = listSkills(input.configDir).find(
    (s) => s.title === title || s.intent === title,
  );
  if (existing) return null;

  return createSkillFromTrace({
    configDir: input.configDir,
    title,
    steps,
    url: input.url,
    task: input.goal.slice(0, 80),
    source: "auto",
  });
}

function skillTitleFromGoal(goal: string): string {
  if (/微博|weibo/i.test(goal)) return "微博发帖";
  if (/知乎|zhihu/i.test(goal)) return "知乎发帖";
  if (/小红书|xiaohongshu|rednote/i.test(goal)) return "小红书发帖";
  const t = goal.replace(/\s+/g, " ").trim().slice(0, 24);
  return t || "自动记下的操作";
}
