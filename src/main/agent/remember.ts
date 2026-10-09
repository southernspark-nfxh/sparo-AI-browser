/**
 * Turn a successful agent tool trace into a saved 妙招 so the next similar goal is faster.
 */
import type { Skill, SkillStep } from "../skills/store.js";
import { createSkillFromTrace, listSkills, saveSkill } from "../skills/store.js";

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

/** 大脑沉淀：轨迹是真的，名字/意图/别名由模型起。 */
export function distillMetaPrompt(goal: string, steps: SkillStep[]): string {
  const trace = steps
    .map((s) => `${s.action}${s.url ? " " + s.url : ""}${s.selector ? " " + s.selector : ""}`)
    .slice(0, 12)
    .join("\n");
  return [
    "一个 AI 浏览器刚用下面这串操作完成了用户的目标。把它提炼成一条可复用技能。",
    "只输出一个 JSON：",
    '{"title":"人能看懂的技能名，不超过12字","intent":"什么时候该调这条，一句话","aliases":["口语叫法1","口语叫法2"]}',
    "不要编步骤里没出现的站点。",
    `用户目标：${goal}`,
    "操作轨迹：",
    trace,
  ].join("\n");
}

export function parseDistillMeta(
  raw: string,
): { title: string; intent: string; aliases: string[] } | null {
  const t = String(raw || "").trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : t).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const o = JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
    const title = String(o.title || "").trim().slice(0, 24);
    if (!title) return null;
    return {
      title,
      intent: String(o.intent || "").trim().slice(0, 80) || title,
      aliases: (Array.isArray(o.aliases) ? o.aliases : [])
        .map((a) => String(a).trim())
        .filter((a) => a.length >= 2 && a.length <= 12)
        .slice(0, 4),
    };
  } catch {
    return null;
  }
}

/** 成功后自动沉淀成新技能；有模型时让模型起名字。返回 null 表示不值得记。 */
export async function distillSkillFromTrace(input: {
  configDir: string;
  goal: string;
  url?: string;
  reply?: string;
  mutations: Mutation[];
  complete?: (prompt: string) => Promise<string>;
}): Promise<Skill | null> {
  if (shouldSkipRemember(input.goal, input.reply)) return null;
  if (/打不开|失败|没办法|无法完成|还没有可用的模型/i.test(input.reply || "")) return null;
  const steps = mutationsToSteps(input.mutations);
  if (steps.filter((s) => s.action !== "navigate").length < 2) return null;

  let title = skillTitleFromGoal(input.goal);
  let intent = input.goal.slice(0, 80);
  let aliases: string[] = [];
  if (input.complete) {
    try {
      const meta = parseDistillMeta(await input.complete(distillMetaPrompt(input.goal, steps)));
      if (meta) {
        title = meta.title;
        intent = meta.intent;
        aliases = meta.aliases;
      }
    } catch {
      /* 起名失败就用规则名 */
    }
  }
  const existing = listSkills(input.configDir).find(
    (s) => s.title === title || s.intent === intent,
  );
  if (existing) return null;

  const skill = createSkillFromTrace({
    configDir: input.configDir,
    title,
    steps,
    url: input.url,
    task: intent,
    source: "auto",
  });
  if (aliases.length) {
    (skill as Skill & { aliases?: string[] }).aliases = aliases;
    saveSkill(input.configDir, skill);
  }
  return skill;
}

function skillTitleFromGoal(goal: string): string {
  if (/微博|weibo/i.test(goal)) return "微博发帖";
  if (/知乎|zhihu/i.test(goal)) return "知乎发帖";
  if (/小红书|xiaohongshu|rednote/i.test(goal)) return "小红书发帖";
  const t = goal.replace(/\s+/g, " ").trim().slice(0, 24);
  return t || "自动记下的操作";
}
