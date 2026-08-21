/**
 * Skill match + execute — turn saved 妙招 into fast browser automation.
 */
import { existsSync, readFileSync } from "node:fs";
import type { PageSnapshot, SnapshotElement, ToolResult } from "../../shared/types.js";
import {
  getSkill,
  listSkills,
  skillSummary,
  type Skill,
  type SkillStep,
} from "./store.js";

export type SkillBrowser = {
  getUrl(): string;
  navigate(url: string, opts?: { asHuman?: boolean }): Promise<ToolResult>;
  snapshot(selector?: string): Promise<ToolResult & { data?: PageSnapshot }>;
  click(target: {
    ref?: string;
    selector?: string;
    caret?: boolean;
  }): Promise<ToolResult>;
  fill(
    target: { ref?: string; selector?: string },
    value: string,
  ): Promise<ToolResult>;
  clickText(
    text: string,
    opts?: { exact?: boolean; withinPortal?: boolean; caret?: boolean },
  ): Promise<ToolResult>;
  waitFor(input: {
    selector?: string;
    text?: string;
    ref?: string;
    timeoutMs?: number;
    all?: boolean;
  }): Promise<ToolResult>;
  pageText(): Promise<ToolResult & { data?: { text?: string } }>;
  setPaused(paused: boolean): void;
  execute?(script: string, opts?: { frame?: number | string }): Promise<ToolResult>;
  analyzePage?(): Promise<ToolResult>;
  executePrimitives?(input: {
    payload: Record<string, unknown>;
    url?: string;
    includeOptional?: boolean;
    maxAttempts?: number;
  }): Promise<ToolResult>;
  csScan?(): Promise<ToolResult>;
  csDraftReply?(input?: {
    draft?: string;
    fill?: boolean;
    preferLlm?: boolean;
  }): Promise<ToolResult>;
  xhsScrollBottom?(): Promise<ToolResult>;
  xhsAddTopics?(topics: string[]): Promise<ToolResult>;
  xhsPickCover?(): Promise<ToolResult>;
  xhsClickPublish?(): Promise<ToolResult>;
  xhsEnsureEditor?(): Promise<ToolResult>;
  xhsPageStage?(): Promise<ToolResult>;
  xhsInjectCompose?(input: {
    title?: string;
    body?: string;
    force?: boolean;
  }): Promise<ToolResult>;
  xhsInjectPublish?(input: {
    summary?: string;
    topics?: string[];
  }): Promise<ToolResult>;
  xhsLayoutNext?(input?: {
    template?: string;
    timeoutMs?: number;
  }): Promise<ToolResult>;
  screenshot?(label?: string): Promise<ToolResult>;
  diagnose?(label?: string): Promise<ToolResult>;
};

export type SkillMatch = {
  id: string;
  title: string;
  score: number;
  reason: string;
  stepCount: number;
  intent?: string;
};

type AnyStep = SkillStep & {
  tool?: string;
  args?: Record<string, unknown>;
  optional?: boolean;
  hint?: string;
  id?: string;
  do?: AnyStep[];
  retries?: number;
  retryDelayMs?: number;
};

const BUILTIN_ALIASES: Record<string, string[]> = {
  "cs-semi-auto-reply": [
    "客服回复",
    "自动客服",
    "半自动客服",
    "帮我回客户",
    "customer service",
    "cs_draft",
  ],
  "universal-form-fill": [
    "通用填表",
    "自动填表",
    "填表单",
    "fill form",
    "表单填写",
    "analyze_page",
    "execute_primitives",
  ],
  "xhs-longform-publish": [
    "小红书",
    "发小红书",
    "小红书发布",
    "小红书长文",
    "发布长文",
    "写长文发布",
    "xhs",
    "xiaohongshu",
    "rednote",
  ],
  "xhs-longform-compose": [
    "小红书草稿",
    "小红书填文",
    "写长文",
    "compose长文",
  ],
  "小红书发布-256a4a": [
    "小红书发布",
    "发小红书",
    "小红书长文发布",
  ],
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function skillKeywords(skill: Skill): string[] {
  const extra = asRecord(skill as unknown as Record<string, unknown>);
  const aliases = [
    ...(BUILTIN_ALIASES[skill.id] || []),
    ...((extra.aliases as string[]) || []),
  ];
  const blob = [
    skill.id,
    skill.title,
    skill.intent,
    skill.platform || "",
    skill.url || "",
    ...aliases,
  ]
    .join(" ")
    .toLowerCase();
  return [...new Set([blob, ...aliases.map((a) => a.toLowerCase())])];
}

export function matchSkills(
  configDir: string,
  query: string,
  limit = 5,
): SkillMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const skills = listSkills(configDir).filter((s) => s.enabled !== false);
  const scored: SkillMatch[] = [];
  for (const s of skills) {
    let score = 0;
    const reasons: string[] = [];
    const idL = s.id.toLowerCase();
    const titleL = (s.title || "").toLowerCase();
    const intentL = (s.intent || "").toLowerCase();
    if (q === idL || q === titleL) {
      score += 100;
      reasons.push("exact");
    }
    if (idL.includes(q) || q.includes(idL)) {
      score += 40;
      reasons.push("id");
    }
    if (titleL.includes(q) || q.includes(titleL.slice(0, 8))) {
      score += 35;
      reasons.push("title");
    }
    if (intentL && (intentL.includes(q) || q.includes(intentL.slice(0, 8)))) {
      score += 25;
      reasons.push("intent");
    }
    for (const alias of BUILTIN_ALIASES[s.id] || []) {
      const a = alias.toLowerCase();
      if (q.includes(a) || a.includes(q)) {
        score += 50;
        reasons.push(`alias:${alias}`);
      }
    }
    // token overlap
    for (const token of q.split(/[\s,，、/|]+/).filter((t) => t.length >= 2)) {
      if (skillKeywords(s).some((k) => k.includes(token))) {
        score += 8;
      }
    }
    // Prefer distilled / tool-based skills over raw traces
    if ((s as { distilled?: boolean }).distilled || (s as { cleanSkillId?: string }).cleanSkillId) {
      score += 5;
    }
    if (s.id.startsWith("xhs-")) score += 3;
    if (score > 0) {
      scored.push({
        id: s.id,
        title: s.title,
        score,
        reason: reasons.slice(0, 4).join(",") || "keyword",
        stepCount: s.stepCount || s.steps?.length || 0,
        intent: s.intent,
      });
    }
  }
  scored.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return scored.slice(0, limit);
}

export function resolveSkill(
  configDir: string,
  idOrQuery: string,
): Skill | null {
  const direct = getSkill(configDir, idOrQuery);
  if (direct) return direct;
  // Prefer clean skill if taught skill points at one
  const matches = matchSkills(configDir, idOrQuery, 3);
  if (!matches.length) return null;
  const best = matches[0];
  const skill = getSkill(configDir, best.id);
  if (!skill) return null;
  const cleanId = (skill as { cleanSkillId?: string }).cleanSkillId;
  if (cleanId) {
    const clean = getSkill(configDir, cleanId);
    if (clean) return clean;
  }
  // Prefer xhs-longform-publish over raw twin when scores close
  if (
    best.id === "小红书发布-256a4a" ||
    /小红书/.test(idOrQuery)
  ) {
    const publish = getSkill(configDir, "xhs-longform-publish");
    if (publish) return publish;
  }
  return skill;
}

export function skillCatalog(configDir: string): Array<{
  id: string;
  title: string;
  intent: string;
  stepCount: number;
  aliases: string[];
}> {
  return listSkills(configDir)
    .filter((s) => s.enabled !== false)
    .slice(0, 20)
    .map((s) => ({
      ...skillSummary(s),
      intent: s.intent,
      aliases: BUILTIN_ALIASES[s.id] || [],
    }));
}

function subst(input: string, vars: Record<string, string>): string {
  return input.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key: string) => {
    if (key in vars) return vars[key];
    return `{{${key}}}`;
  });
}

function substDeep<T>(value: T, vars: Record<string, string>): T {
  if (typeof value === "string") return subst(value, vars) as T;
  if (Array.isArray(value)) {
    return value.map((v) => substDeep(v, vars)) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = substDeep(v, vars);
    }
    return out as T;
  }
  return value;
}

function extractBodyFromMarkdown(md: string): { title?: string; body?: string } {
  const titleMatch =
    md.match(/##\s*标题\s*\n+([^\n#]+)/) ||
    md.match(/^#\s+(.+)$/m);
  const bodyMatch = md.match(/##\s*正文\s*\n+([\s\S]*?)(?=\n##\s|$)/);
  return {
    title: titleMatch?.[1]?.trim(),
    body: bodyMatch?.[1]?.trim() || md.trim(),
  };
}

function buildVars(
  skill: Skill,
  params: Record<string, unknown> = {},
): Record<string, string> {
  const defaults = asRecord(
    (skill as { defaultsFromRecording?: Record<string, unknown> })
      .defaultsFromRecording,
  );
  type ParamDef = { default?: unknown; example?: unknown };
  const paramMeta = asRecord(
    (skill as { params?: Record<string, ParamDef> }).params,
  ) as Record<string, ParamDef>;
  const titleDefault =
    (typeof params.title === "string" && params.title) ||
    (typeof defaults.title === "string" && defaults.title) ||
    (typeof paramMeta.title?.default === "string" && paramMeta.title.default) ||
    "";
  let body =
    (typeof params.body === "string" && params.body) ||
    (typeof defaults.body === "string" && defaults.body) ||
    "";
  const mdPath =
    (typeof params.mdPath === "string" && params.mdPath) ||
    (typeof paramMeta.mdPath?.example === "string" &&
      paramMeta.mdPath.example) ||
    "";
  if ((!body || !titleDefault) && mdPath && existsSync(mdPath)) {
    try {
      const parsed = extractBodyFromMarkdown(readFileSync(mdPath, "utf8"));
      if (!body && parsed.body) body = parsed.body;
    } catch {
      /* ignore */
    }
  }
  let topics: string[] =
    (Array.isArray(params.topics) && params.topics.map(String)) ||
    (Array.isArray(defaults.topicsClicked) &&
      (defaults.topicsClicked as string[]).filter((t) => t !== "#Hermes")) ||
    (Array.isArray(paramMeta.topics?.default) &&
      (paramMeta.topics.default as string[])) ||
    [];
  const vars: Record<string, string> = {
    title: titleDefault,
    body,
    topics: JSON.stringify(topics),
    summary:
      (typeof params.summary === "string" && params.summary) ||
      (typeof defaults.summary === "string" && defaults.summary) ||
      "",
    mdPath,
    titleRef: "",
    bodyRef: "",
    autoPublish: String(params.autoPublish ?? false),
  };
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "string") vars[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") vars[k] = String(v);
    else if (Array.isArray(v)) vars[k] = JSON.stringify(v);
    else if (v && typeof v === "object") vars[k] = JSON.stringify(v);
  }
  return vars;
}

function resolveRefsFromSnapshot(
  snap: PageSnapshot | undefined,
  vars: Record<string, string>,
): void {
  if (!snap?.elements?.length) return;
  const els = snap.elements;
  const titleEl =
    els.find(
      (e) =>
        (e.tag === "textarea" || e.tag === "input") &&
        (/输入标题|标题/.test(e.placeholder || "") || /d-text/i.test(e.selector || "")),
    ) ||
    els.find(
      (e) =>
        /输入标题|标题/.test(e.placeholder || "") ||
        (/textarea/i.test(e.tag) && /title|标题/i.test(e.name || e.placeholder || "")),
    ) ||
    els.find((e) => (e.tag === "textarea" || e.tag === "input") && /d-text/i.test(e.selector || ""));
  const bodyEl =
    els.find((e) => /ProseMirror|tiptap|contenteditable/i.test(e.selector || e.role || "")) ||
    els.find(
      (e) =>
        e.role === "textbox" &&
        /正文|内容|编辑/.test(e.name || e.placeholder || ""),
    );
  if (titleEl?.ref) vars.titleRef = titleEl.ref;
  if (bodyEl?.ref) vars.bodyRef = bodyEl.ref;
  // Heuristic fallbacks used on XHS creator
  if (!vars.titleRef) {
    const t =
      els.find((e: SnapshotElement) => e.tag === "textarea" && /d-text/i.test(e.selector || "") && !/shadow/i.test(e.selector || "")) ||
      els.find((e: SnapshotElement) => e.tag === "input" && /d-text/i.test(e.selector || "")) ||
      els.find((e: SnapshotElement) => (e.tag === "textarea" || e.tag === "input") && /标题/.test(e.placeholder || "")) ||
      els.find((e: SnapshotElement) => e.tag === "textarea");
    if (t?.ref) vars.titleRef = t.ref;
  }
  if (!vars.bodyRef) {
    const b = els.find((e) => /contenteditable|ProseMirror/i.test(e.selector));
    if (b?.ref) vars.bodyRef = b.ref;
  }
}

function stepTool(step: AnyStep): string {
  return String(step.tool || step.action || "").toLowerCase();
}

function stepArgs(step: AnyStep): Record<string, unknown> {
  if (step.args && typeof step.args === "object") return { ...step.args };
  const args: Record<string, unknown> = {};
  if (step.selector) args.selector = step.selector;
  if (step.text) args.text = step.text;
  if (step.value != null) args.value = step.value;
  if (step.url) args.url = step.url;
  if (step.cssPath) args.cssPath = step.cssPath;
  if (step.innerText) args.innerText = step.innerText;
  if (step.ariaLabel) args.ariaLabel = step.ariaLabel;
  if (step.placeholder) args.placeholder = step.placeholder;
  return args;
}

async function runOneStep(
  browser: SkillBrowser,
  step: AnyStep,
  vars: Record<string, string>,
): Promise<ToolResult> {
  const tool = stepTool(step);
  const args = substDeep(stepArgs(step), vars);
  const optional = Boolean(step.optional);

  const wrap = async (p: Promise<ToolResult>): Promise<ToolResult> => {
    const r = await p;
    if (!r.ok && optional) {
      return { ok: true, message: `skipped optional: ${r.message}`, data: r.data };
    }
    return r;
  };

  switch (tool) {
    case "navigate":
      return wrap(browser.navigate(String(args.url || ""), { asHuman: true }));
    case "click_text":
      return wrap(
        browser.clickText(String(args.text || step.text || ""), {
          exact: Boolean(args.exact),
          withinPortal: Boolean(args.withinPortal),
          caret: Boolean(args.caret),
        }),
      );
    case "click": {
      const clickOpts = {
        exact: Boolean(args.exact),
        withinPortal: Boolean(args.withinPortal),
        caret: Boolean(args.caret),
      };
      const ref = args.ref ? String(args.ref) : undefined;
      const selector = args.selector ? String(args.selector) : undefined;
      const cssPath = args.cssPath ? String(args.cssPath) : step.cssPath;
      const clickTextVal =
        args.text ||
        step.text ||
        args.innerText ||
        step.innerText ||
        args.ariaLabel ||
        step.ariaLabel;

      if (ref) {
        const r = await browser.click({ ref, ...clickOpts });
        if (r.ok) return wrap(Promise.resolve(r));
      }
      if (selector) {
        const r = await browser.click({ selector, ...clickOpts });
        if (r.ok) return wrap(Promise.resolve(r));
      }
      if (cssPath) {
        const r = await browser.click({ selector: cssPath, ...clickOpts });
        if (r.ok) return wrap(Promise.resolve(r));
      }
      if (clickTextVal) {
        return wrap(browser.clickText(String(clickTextVal), clickOpts));
      }
      return wrap(
        browser.click({
          ref,
          selector,
          caret: Boolean(args.caret),
        }),
      );
    }
    case "fill":
    case "change": {
      let ref = args.ref ? String(args.ref) : undefined;
      let selector = args.selector ? String(args.selector) : undefined;
      if (!selector && (args.cssPath || step.cssPath)) {
        selector = String(args.cssPath || step.cssPath);
      }
      const value = String(args.value ?? step.value ?? "");
      if (ref && ref.includes("{{")) {
        return { ok: false, message: `fill ref unresolved: ${ref}` };
      }
      // XHS title may be textarea.d-text or input.d-text
      if (selector && /^(input|textarea)\.d-text$/i.test(selector.trim())) {
        selector = "textarea.d-text, input.d-text";
      }
      if (selector && /textarea\.d-text/i.test(selector) && !/input\.d-text/i.test(selector)) {
        selector = selector.replace(/textarea\.d-text/gi, "textarea.d-text, input.d-text");
      }
      if (selector && /input\.d-text/i.test(selector) && !/textarea\.d-text/i.test(selector)) {
        selector = selector.replace(/input\.d-text/gi, "textarea.d-text, input.d-text");
      }
      if (!ref && !selector) {
        if (/title/i.test(step.id || "") && vars.titleRef) ref = vars.titleRef;
        else if (/body/i.test(step.id || "") && vars.bodyRef) ref = vars.bodyRef;
        else if (/title/i.test(step.id || "")) selector = "textarea.d-text, input.d-text";
        else if (/body/i.test(step.id || "")) selector = ".tiptap.ProseMirror";
      }
      if (!ref && !selector) {
        return { ok: false, message: "fill needs ref or selector" };
      }
      if (ref === "" && vars.titleRef && /title/i.test(step.id || "")) {
        ref = vars.titleRef;
      }
      let result = await browser.fill({ ref, selector }, value);
      if (!result.ok && /title/i.test(step.id || "")) {
        result = await browser.fill({ selector: "textarea.d-text, input.d-text" }, value);
      }
      if (!result.ok && /body/i.test(step.id || "")) {
        result = await browser.fill({ selector: ".tiptap.ProseMirror" }, value);
      }
      return wrap(Promise.resolve(result));
    }
    case "wait_for": {
      const text = args.text ? String(args.text) : undefined;
      const selector = args.selector ? String(args.selector) : undefined;
      const all = Boolean(args.all);
      if (text && text.includes("|") && !selector) {
        const parts = text.split("|").map((s) => s.trim()).filter(Boolean);
        let last: ToolResult = { ok: false, message: "wait_for: no match" };
        for (const part of parts) {
          last = await browser.waitFor({
            text: part,
            timeoutMs: Math.min(Number(args.timeoutMs) || 8000, 15000),
          });
          if (last.ok) return last;
        }
        return optional
          ? { ok: true, message: `skipped optional wait_for: ${text}` }
          : last;
      }
      return wrap(
        browser.waitFor({
          text,
          selector,
          ref: args.ref ? String(args.ref) : undefined,
          timeoutMs: Number(args.timeoutMs) || 20000,
          all,
        }),
      );
    }
    case "snapshot": {
      const snap = await browser.snapshot(
        args.selector ? String(args.selector) : undefined,
      );
      if (snap.ok) resolveRefsFromSnapshot(snap.data, vars);
      return {
        ok: snap.ok,
        message:
          snap.message +
          (vars.titleRef || vars.bodyRef
            ? ` · titleRef=${vars.titleRef || "?"} bodyRef=${vars.bodyRef || "?"}`
            : ""),
        data: {
          ...(typeof snap.data === "object" ? snap.data : {}),
          titleRef: vars.titleRef || undefined,
          bodyRef: vars.bodyRef || undefined,
        },
      };
    }
    case "page_text":
      return browser.pageText();
    case "scroll":
    case "scroll_bottom":
    case "xhs_scroll_bottom":
      if (browser.xhsScrollBottom) return wrap(browser.xhsScrollBottom());
      if (browser.execute) {
        return wrap(
          browser.execute(
            `(() => { window.scrollTo(0, document.body.scrollHeight); return {ok:true}; })()`,
          ),
        );
      }
      return { ok: false, message: "scroll not available" };
    case "xhs_ensure_editor":
    case "ensure_editor":
      if (browser.xhsEnsureEditor) return wrap(browser.xhsEnsureEditor());
      return { ok: false, message: "xhsEnsureEditor not available" };
    case "xhs_page_stage":
    case "page_stage":
      if (browser.xhsPageStage) return wrap(browser.xhsPageStage());
      return { ok: false, message: "xhsPageStage not available" };
    case "xhs_inject_compose":
    case "inject_compose": {
      if (!browser.xhsInjectCompose) {
        return { ok: false, message: "xhsInjectCompose not available" };
      }
      return wrap(
        browser.xhsInjectCompose({
          title: String(args.title ?? vars.title ?? ""),
          body: String(args.body ?? vars.body ?? ""),
          force: args.force !== false,
        }),
      );
    }
    case "xhs_inject_publish":
    case "inject_publish": {
      if (!browser.xhsInjectPublish) {
        return { ok: false, message: "xhsInjectPublish not available" };
      }
      let topics: string[] = [];
      const raw = args.topics ?? vars.topics;
      if (Array.isArray(raw)) topics = raw.map(String);
      else if (typeof raw === "string") {
        try {
          const parsed = JSON.parse(raw) as unknown;
          topics = Array.isArray(parsed) ? parsed.map(String) : [];
        } catch {
          topics = [];
        }
      }
      return wrap(
        browser.xhsInjectPublish({
          summary: String(args.summary ?? vars.summary ?? ""),
          topics,
        }),
      );
    }
    case "xhs_layout_next":
    case "layout_next": {
      if (!browser.xhsLayoutNext) {
        return { ok: false, message: "xhsLayoutNext not available" };
      }
      return wrap(
        browser.xhsLayoutNext({
          template: args.template != null ? String(args.template) : "简约基础",
          timeoutMs:
            args.timeoutMs != null ? Number(args.timeoutMs) : undefined,
        }),
      );
    }
    case "diagnose":
      if (browser.diagnose) return wrap(browser.diagnose(String(args.label || step.id || "step")));
      return { ok: true, message: "diagnose skipped" };
    case "screenshot":
      if (browser.screenshot) return wrap(browser.screenshot(String(args.label || step.id || "shot")));
      return { ok: false, message: "screenshot not available" };
    case "xhs_add_topics":
    case "add_topics": {
      let topics: string[] = [];
      const raw = args.topics ?? args.items ?? vars.topics;
      if (Array.isArray(raw)) topics = raw.map(String);
      else if (typeof raw === "string") {
        try {
          const parsed = JSON.parse(raw) as unknown;
          topics = Array.isArray(parsed) ? parsed.map(String) : [raw];
        } catch {
          topics = raw.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
        }
      }
      if (browser.xhsAddTopics) return wrap(browser.xhsAddTopics(topics));
      return { ok: false, message: "xhsAddTopics not available" };
    }
    case "xhs_pick_cover":
    case "pick_cover":
      if (browser.xhsPickCover) return wrap(browser.xhsPickCover());
      return { ok: false, message: "xhsPickCover not available" };
    case "xhs_click_publish":
    case "publish": {
      const when = args.when != null ? String(args.when) : "true";
      if (/^(0|false|no|off)$/i.test(when)) {
        return { ok: true, message: "skipped publish (autoPublish off)" };
      }
      if (browser.xhsClickPublish) return wrap(browser.xhsClickPublish());
      return { ok: false, message: "xhsClickPublish not available" };
    }
    case "pause":
      browser.setPaused(true);
      return {
        ok: true,
        message: step.hint || "已暂停，请人确认后继续（发布请人手点）。",
      };
    case "foreach": {
      const itemsRaw = args.items;
      let items: string[] = [];
      if (Array.isArray(itemsRaw)) items = itemsRaw.map(String);
      else if (typeof itemsRaw === "string") {
        try {
          const parsed = JSON.parse(itemsRaw) as unknown;
          items = Array.isArray(parsed) ? parsed.map(String) : [itemsRaw];
        } catch {
          items = itemsRaw.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
        }
      }
      // Prefer dedicated XHS topic helper over naive click_text loop
      if (browser.xhsAddTopics && items.length) {
        return wrap(browser.xhsAddTopics(items));
      }
      const doSteps = (Array.isArray(args.do) ? args.do : step.do || []) as AnyStep[];
      const results: string[] = [];
      for (const item of items) {
        vars.item = item;
        for (const child of doSteps) {
          const r = await runOneStep(browser, { ...child, optional: true }, vars);
          results.push(`${item}: ${r.message}`);
          await sleep(350);
        }
      }
      delete vars.item;
      return { ok: true, message: `topics: ${results.join(" · ")}`, data: { results } };
    }
    case "sleep":
    case "wait":
      await sleep(Number(args.ms || args.timeoutMs || 800));
      return { ok: true, message: "waited" };
    case "execute":
    case "evaluate":
      if (!browser.execute) return { ok: false, message: "execute not available" };
      return wrap(browser.execute(String(args.script || args.code || "")));
    case "analyze_page":
      if (!browser.analyzePage) return { ok: false, message: "analyzePage not available" };
      return wrap(browser.analyzePage());
    case "cs_scan":
      if (!browser.csScan) return { ok: false, message: "csScan not available" };
      return wrap(browser.csScan());
    case "cs_draft_reply":
    case "cs_draft": {
      if (!browser.csDraftReply) return { ok: false, message: "csDraftReply not available" };
      return wrap(
        browser.csDraftReply({
          draft: args.draft != null ? String(args.draft) : vars.draft || undefined,
          fill: args.fill !== false,
          preferLlm: args.preferLlm !== false,
        }),
      );
    }
    case "execute_primitives": {
      if (!browser.executePrimitives) {
        return { ok: false, message: "executePrimitives not available" };
      }
      let payload: Record<string, unknown> = {};
      const rawPayload = args.payload ?? vars.payload;
      if (rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)) {
        payload = rawPayload as Record<string, unknown>;
      } else if (typeof rawPayload === "string" && rawPayload.trim()) {
        try {
          payload = JSON.parse(rawPayload) as Record<string, unknown>;
        } catch {
          return { ok: false, message: "execute_primitives payload JSON invalid" };
        }
      } else {
        const skip = new Set([
          "titleRef",
          "bodyRef",
          "mdPath",
          "autoPublish",
          "payload",
        ]);
        for (const [k, v] of Object.entries(vars)) {
          if (skip.has(k) || !v) continue;
          if (k === "topics") {
            try {
              payload[k] = JSON.parse(v);
            } catch {
              payload[k] = v;
            }
          } else if (k === "title") payload["标题"] = v;
          else if (k === "body") payload["正文"] = v;
          else if (k === "summary") payload["简介"] = v;
          else payload[k] = v;
        }
      }
      if (!Object.keys(payload).length) {
        return {
          ok: false,
          message: "execute_primitives needs params.payload (label→value object)",
        };
      }
      return wrap(
        browser.executePrimitives({
          payload,
          includeOptional: args.includeOptional !== false,
          maxAttempts:
            args.maxAttempts != null ? Number(args.maxAttempts) : undefined,
        }),
      );
    }
    default:
      if (optional) {
        return { ok: true, message: `skipped unknown tool: ${tool}` };
      }
      return { ok: false, message: `unsupported skill step: ${tool || "(empty)"}` };
  }
}

async function runOneStepWithRetry(
  browser: SkillBrowser,
  step: AnyStep,
  vars: Record<string, string>,
): Promise<ToolResult> {
  const retries = Math.max(0, Number(step.retries ?? step.args?.retries ?? 0));
  const delay = Math.max(200, Number(step.retryDelayMs ?? step.args?.retryDelayMs ?? 1200));
  let last: ToolResult = { ok: false, message: "not run" };
  for (let attempt = 0; attempt <= retries; attempt++) {
    last = await runOneStep(browser, step, vars);
    if (last.ok) {
      if (attempt > 0) {
        return { ...last, message: `${last.message} (retry ${attempt})` };
      }
      return last;
    }
    if (attempt < retries) await sleep(delay);
  }
  return last;
}

export async function runSkill(
  browser: SkillBrowser,
  configDir: string,
  input: {
    id?: string;
    query?: string;
    params?: Record<string, unknown>;
    dryRun?: boolean;
  },
): Promise<ToolResult> {
  const key = String(input.id || input.query || "").trim();
  if (!key) {
    return { ok: false, message: "run_skill needs id or query" };
  }
  const skill = resolveSkill(configDir, key);
  if (!skill) {
    const suggestions = matchSkills(configDir, key, 5);
    return {
      ok: false,
      message: `未找到妙招「${key}」`,
      data: { suggestions },
    };
  }
  const steps = (skill.steps || []) as AnyStep[];
  if (!steps.length) {
    return { ok: false, message: `妙招「${skill.title}」没有可执行步骤` };
  }
  const vars = buildVars(skill, input.params || {});
  if (input.dryRun) {
    return {
      ok: true,
      message: `dry-run ${skill.id} (${steps.length} steps)`,
      data: {
        skill: skillSummary(skill),
        vars: { title: vars.title, bodyLen: vars.body.length, topics: vars.topics },
        steps: steps.map((s, i) => ({
          i: i + 1,
          tool: stepTool(s),
          id: s.id,
          optional: s.optional,
        })),
      },
    };
  }

  // Auto-fill body/title from md when still empty
  if (!vars.body && vars.mdPath && existsSync(vars.mdPath)) {
    try {
      const parsed = extractBodyFromMarkdown(readFileSync(vars.mdPath, "utf8"));
      if (parsed.body) vars.body = parsed.body;
      if (!vars.title && parsed.title) vars.title = parsed.title;
    } catch {
      /* ignore */
    }
  }

  const log: Array<{ i: number; tool: string; ok: boolean; message: string }> = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const tool = stepTool(step);
    // Before fill that needs refs, snapshot if missing
    if (
      (tool === "fill" || tool === "change") &&
      (!vars.titleRef || !vars.bodyRef) &&
      /titleRef|bodyRef|\{\{/.test(JSON.stringify(stepArgs(step)))
    ) {
      const snap = await browser.snapshot();
      if (snap.ok) resolveRefsFromSnapshot(snap.data, vars);
    }
    const result = await runOneStepWithRetry(browser, step, vars);
    log.push({
      i: i + 1,
      tool: tool || "?",
      ok: result.ok,
      message: result.message,
    });
    if (!result.ok) {
      let diag: ToolResult | undefined;
      try {
        if (browser.diagnose) {
          diag = await browser.diagnose(`skill-fail-${i + 1}-${tool || "step"}`);
        }
      } catch {
        /* ignore diag errors */
      }
      return {
        ok: false,
        message: `妙招「${skill.title}」第 ${i + 1} 步失败（${tool}）：${result.message}`,
        data: {
          skillId: skill.id,
          title: skill.title,
          log,
          diagnose: diag?.data,
          vars: { titleRef: vars.titleRef, bodyRef: vars.bodyRef },
        },
      };
    }
    if (tool === "pause") {
      return {
        ok: true,
        message: `妙招「${skill.title}」已执行到暂停（${i + 1}/${steps.length}）。${result.message}`,
        data: { skillId: skill.id, title: skill.title, log, paused: true },
      };
    }
    // Small pacing between UI steps
    if (tool === "click_text" || tool === "click" || tool === "navigate") {
      await sleep(450);
    }
  }
  return {
    ok: true,
    message: `妙招「${skill.title}」完成（${log.length} 步）`,
    data: { skillId: skill.id, title: skill.title, log },
  };
}
