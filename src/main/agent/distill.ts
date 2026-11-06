/**
 * 新任务沉淀与 one-shot 判定。提示词和 JSON 形状在这里，拍板在模型。
 * 不碰浏览器。store 不反向 import 本文件。
 */
import { randomBytes } from "node:crypto";
import {
  listSkills,
  saveSkill,
  slugify,
  type RouteMilestone,
  type Skill,
} from "../skills/store.js";

const FIXED_TOOLS = new Set(["navigate", "page_text", "wait_for", "report"]);
const SECRET_QUERY = ["token", "access_token", "password", "pwd", "captcha"];
const DROP_ARG_KEYS = new Set([
  "selector",
  "csspath",
  "css",
  "xpath",
  "bound",
  "bounds",
  "x",
  "y",
  "coordinates",
]);

export function oneShotJudgePrompt(skill: {
  title: string;
  intent: string;
  stepCount: number;
  steps: unknown;
  params?: unknown;
}): string {
  const steps = Array.isArray(skill.steps) ? skill.steps : [];
  const tools = steps.map((step) => {
    const row = step as { tool?: string; action?: string };
    return String(row?.tool || row?.action || "?");
  });
  const required: string[] = [];
  if (skill.params && typeof skill.params === "object") {
    for (const [key, def] of Object.entries(skill.params as Record<string, { required?: boolean }>)) {
      if (def && typeof def === "object" && def.required === true) required.push(key);
    }
  }
  return [
    "这条技能是不是一步到位：动作固定、不需要看页面现场决定、没有必传参数、跑完即有结果？",
    `标题：${skill.title}`,
    `意图：${skill.intent}`,
    `步数：${skill.stepCount || tools.length}`,
    `步骤工具：${tools.join(" → ") || "（无）"}`,
    `必传参数：${required.join("、") || "无"}`,
    '只输出 {"oneShot":true} 或 {"oneShot":false}',
  ].join("\n");
}

export function parseOneShotVerdict(raw: string): boolean | null {
  const matched = String(raw || "").match(/\{[\s\S]*\}/);
  if (!matched) return null;
  try {
    const parsed = JSON.parse(matched[0]) as { oneShot?: unknown };
    if (parsed.oneShot === true) return true;
    if (parsed.oneShot === false) return false;
    return null;
  } catch {
    return null;
  }
}

export function distillMissionPrompt(input: {
  raw: string;
  intent: string;
  plan: Array<{ label: string; cap: string; status: string }>;
  findings: Array<{ cap: string; label: string; ok: boolean; text: string }>;
}): string {
  const plan = input.plan
    .map((step, i) => `${i + 1}. ${step.status || "?"} ${step.cap} ${step.label}`.trim())
    .join("\n");
  const findings = input.findings
    .map((row) => `- ${row.ok ? "ok" : "fail"} ${row.cap} ${row.label}：${String(row.text || "").slice(0, 200)}`)
    .join("\n");
  return [
    "把这次跑成的新任务压成一条可复用的路线。只输出一个 JSON。",
    "route 1～8 段。fixed 段 tool 只能是 navigate / page_text / wait_for / report，args 里用 {{槽位}} 写 URL 模板。",
    "open 段只写目标，不写点击坐标、cssPath、选择器。",
    "不要写密码、验证码、带 token 的 URL。",
    "pitfalls 挂里程碑序号（从 1 开始）。contract 是验收要点。",
    '形状：{"title":"","intent":"","aliases":[],"route":[{"kind":"fixed","tool":"navigate","args":{"url":"https://example.com/{{query}}"}},{"kind":"open","goal":"读列表","tools":["page_text"]}],"params":{"query":{"type":"string","required":true}},"pitfalls":[{"milestone":1,"note":"","from":""}],"contract":{"deliverable":"report"}}',
    `原话：${input.raw}`,
    `意图：${input.intent}`,
    plan ? `计划：\n${plan}` : "计划：（无）",
    findings ? `发现：\n${findings}` : "发现：（无）",
  ].join("\n");
}

export type DistillSkillDraft = {
  title: string;
  intent: string;
  aliases: string[];
  route: RouteMilestone[];
  params: Record<string, { type?: string; required?: boolean }>;
  pitfalls: Array<{ milestone: number; note: string; from?: string }>;
  contract: Record<string, unknown>;
};

export function stripSecretQuery(value: string): string {
  if (!/^https?:\/\//i.test(value) || !/[?&]/.test(value)) return value;
  try {
    const url = new URL(value);
    for (const key of SECRET_QUERY) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return value;
  }
}

export function cleanArgs(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (DROP_ARG_KEYS.has(key.toLowerCase())) continue;
    out[key] = typeof value === "string" ? stripSecretQuery(value) : value;
  }
  return out;
}

export function asRoute(raw: unknown): RouteMilestone[] {
  if (!Array.isArray(raw)) return [];
  const out: RouteMilestone[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as { kind?: string; tool?: string; args?: unknown; goal?: string; tools?: unknown };
    if (row.kind === "fixed") {
      const tool = String(row.tool || "").toLowerCase();
      if (!FIXED_TOOLS.has(tool)) continue;
      out.push({
        kind: "fixed",
        tool: tool as "navigate" | "page_text" | "wait_for" | "report",
        args: cleanArgs(row.args),
      });
    } else if (row.kind === "open") {
      const goal = String(row.goal || "").trim();
      if (!goal) continue;
      const tools = Array.isArray(row.tools) ? row.tools.map((t) => String(t)).filter(Boolean).slice(0, 6) : undefined;
      out.push({ kind: "open", goal: goal.slice(0, 80), tools });
    }
    if (out.length >= 8) break;
  }
  return out;
}

export function parseDistillSkill(raw: string): DistillSkillDraft | null {
  const matched = String(raw || "").match(/\{[\s\S]*\}/);
  if (!matched) return null;
  try {
    const parsed = JSON.parse(matched[0]) as Record<string, unknown>;
    const title = String(parsed.title || "").trim().slice(0, 24);
    if (!title) return null;
    const route = asRoute(parsed.route);
    if (!route.length) return null;
    const aliases = Array.isArray(parsed.aliases)
      ? parsed.aliases.map((a) => String(a).trim()).filter(Boolean).slice(0, 6)
      : [];
    const params: DistillSkillDraft["params"] = {};
    if (parsed.params && typeof parsed.params === "object" && !Array.isArray(parsed.params)) {
      for (const [key, def] of Object.entries(parsed.params as Record<string, unknown>)) {
        if (!def || typeof def !== "object") continue;
        const row = def as { type?: string; required?: boolean };
        params[key] = {
          type: row.type ? String(row.type) : undefined,
          required: row.required === true,
        };
      }
    }
    const pitfalls: DistillSkillDraft["pitfalls"] = [];
    if (Array.isArray(parsed.pitfalls)) {
      for (const item of parsed.pitfalls) {
        if (!item || typeof item !== "object") continue;
        const row = item as { milestone?: unknown; note?: unknown; from?: unknown };
        const milestone = Number(row.milestone);
        const note = String(row.note || "").trim();
        if (!Number.isFinite(milestone) || milestone < 1 || !note) continue;
        pitfalls.push({
          milestone,
          note: note.slice(0, 80),
          from: row.from ? String(row.from).slice(0, 40) : undefined,
        });
      }
    }
    const contract =
      parsed.contract && typeof parsed.contract === "object" && !Array.isArray(parsed.contract)
        ? (parsed.contract as Record<string, unknown>)
        : {};
    return {
      title,
      intent: String(parsed.intent || title).trim().slice(0, 80) || title,
      aliases,
      route,
      params,
      pitfalls,
      contract,
    };
  } catch {
    return null;
  }
}

export function saveDistilledSkill(configDir: string, meta: DistillSkillDraft): Skill | null {
  const title = meta.title.trim();
  if (!title) return null;
  if (listSkills(configDir).some((skill) => skill.title.trim() === title)) return null;
  const now = new Date().toISOString();
  const skill = {
    id: `taught-${slugify(title)}-${randomBytes(3).toString("hex")}`,
    title,
    intent: meta.intent || title,
    source: "taught",
    createdAt: now,
    updatedAt: now,
    steps: [],
    stepCount: 0,
    stats: { success: 0, fail: 0 },
    enabled: true,
    distilled: true,
    route: meta.route,
    params: meta.params,
    pitfalls: meta.pitfalls,
    contract: meta.contract,
    ...(meta.aliases.length ? { aliases: meta.aliases } : {}),
  } as Skill;
  return saveSkill(configDir, skill);
}

export type SoulTraceStep = {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  round: number;
};

export type SoulRunTrace = {
  input: string;
  trace: SoulTraceStep[];
};

const TRACE_KEYS = new Set([
  "url",
  "text",
  "query",
  "from",
  "to",
  "date",
  "site",
  "title",
  "label",
  "key",
  "src",
  "id",
  "name",
  "action",
  "detail",
  "intent",
  "value",
]);
const SECRET_ARG = /token|password|pwd|captcha|secret|cookie|authorization|apikey|api_key/i;

/** 轨迹里只留网址和文本关键词。选择器、坐标、密钥沿用 cleanArgs / stripSecretQuery。 */
export function traceArgs(raw: unknown): Record<string, unknown> {
  const cleaned = cleanArgs(raw);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(cleaned)) {
    if (SECRET_ARG.test(key) || !TRACE_KEYS.has(key.toLowerCase())) continue;
    if (typeof value === "string") out[key] = stripSecretQuery(value).slice(0, 200);
    else if (typeof value === "number" || typeof value === "boolean") out[key] = value;
  }
  return out;
}

function formatSoulTrace(last: SoulRunTrace): string {
  const lines = last.trace.map((step) => {
    const args = Object.entries(step.args)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(" ");
    return `- r${step.round} ${step.tool} ${step.ok ? "ok" : "fail"}${args ? ` ${args}` : ""}`;
  });
  return [
    `原话：${last.input}`,
    "轨迹：",
    ...lines,
    "基于此轨迹输出 route JSON 后带参数再调 save_skill。",
  ].join("\n");
}

function routePayload(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/** 用户点名沉淀时的两段式落盘。不在任务成功时自动调用。 */
export function saveTaughtFromTrace(
  configDir: string,
  last: SoulRunTrace | null | undefined,
  args: Record<string, unknown>,
): { ok: boolean; message: string; id?: string; title?: string } {
  const trace = last?.trace?.length ? last : null;
  if (!trace) return { ok: false, message: "最近没有跑成功的任务，无可沉淀" };

  const reused = trace.trace.find((step) => step.tool === "run_skill" && step.ok);
  if (reused) {
    const key = String(reused.args.id || reused.args.query || "").trim();
    const known = key
      ? listSkills(configDir).find((skill) => skill.id === key || skill.title === key)
      : undefined;
    const name = known?.title || key || "已有技能";
    return { ok: false, message: `这趟走的是既有技能 ${name}，无需重复沉淀` };
  }

  if (args.route === undefined) return { ok: true, message: formatSoulTrace(trace) };

  const route = asRoute(routePayload(args.route));
  if (!route.length) {
    return {
      ok: false,
      message:
        "route 没有合法段。请修正后重试一次：fixed 段只能是 navigate、page_text、wait_for、report，open 段要有目标，不要写选择器或坐标。",
    };
  }

  const title = String(args.title || "").trim().slice(0, 24);
  if (!title) return { ok: false, message: "缺少 title。请补上技能名后重试一次。" };
  const intent = String(args.intent || title).trim().slice(0, 80) || title;
  const same = (left: string, right: string) => Boolean(left) && left === right;
  const existing = listSkills(configDir).find(
    (skill) =>
      same(skill.title.trim(), title) ||
      same(skill.intent.trim(), intent) ||
      same(skill.title.trim(), intent) ||
      same(skill.intent.trim(), title),
  );
  if (existing) return { ok: false, message: `已有技能 ${existing.id}（${existing.title}），无需重复沉淀` };

  const draft = parseDistillSkill(
    JSON.stringify({
      title,
      intent,
      aliases: args.aliases,
      route,
      params: args.params,
      pitfalls: args.pitfalls,
      contract: args.contract,
    }),
  );
  if (!draft) {
    return {
      ok: false,
      message:
        "route 没有合法段。请修正后重试一次：fixed 段只能是 navigate、page_text、wait_for、report，open 段要有目标，不要写选择器或坐标。",
    };
  }
  const saved = saveDistilledSkill(configDir, draft);
  if (!saved) {
    const again = listSkills(configDir).find((skill) => skill.title.trim() === title);
    if (again) return { ok: false, message: `已有技能 ${again.id}（${again.title}），无需重复沉淀` };
    return { ok: false, message: "没能记下这条技能。" };
  }
  return { ok: true, message: `已记成 ${saved.title}（${saved.id}）`, id: saved.id, title: saved.title };
}

export async function distillMission(input: {
  configDir: string;
  goal: { raw: string; intent: string };
  plan?: { steps?: Array<{ label?: string; cap?: string; status?: string }> } | null;
  findings: Array<{ ok?: boolean; text?: string; step?: { cap?: string; label?: string } }>;
  complete: (prompt: string) => Promise<string>;
}): Promise<Skill | null> {
  const plan = (input.plan?.steps || []).map((step) => ({
    label: String(step.label || ""),
    cap: String(step.cap || ""),
    status: String(step.status || ""),
  }));
  const findings = (input.findings || []).map((row) => ({
    cap: String(row.step?.cap || ""),
    label: String(row.step?.label || ""),
    ok: Boolean(row.ok),
    text: String(row.text || "").slice(0, 200),
  }));
  const raw = await input.complete(
    distillMissionPrompt({
      raw: input.goal.raw,
      intent: input.goal.intent,
      plan,
      findings,
    }),
  );
  const meta = parseDistillSkill(raw);
  if (!meta) return null;
  return saveDistilledSkill(input.configDir, meta);
}
