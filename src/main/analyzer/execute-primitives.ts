/**
 * execute_primitives — map payload → fields → fill/click/upload with mini-QA + learning.
 */
import type { ToolResult } from "../../shared/types.js";
import type { SparkBrowser } from "../browser.js";
import {
  getCachedMethod,
  loadStrategyCache,
  rememberMethod,
} from "./strategy-cache.js";
import { bestFieldMatch } from "./match.js";
import type {
  AnalyzedField,
  AnalyzedPage,
  ExecutePrimitivesResult,
  PrimitiveKind,
  PrimitivePlanStep,
  PrimitiveStepResult,
} from "./types.js";
import { datetimeCommitted, parseDatetimeValue } from "./datetime.js";

type BrowserLike = Pick<
  SparkBrowser,
  | "analyzePage"
  | "fill"
  | "click"
  | "clickText"
  | "select"
  | "upload"
  | "execute"
  | "configDir"
  | "pickCalendar"
>;

function methodsFor(primitive: PrimitiveKind, cached?: string | null): string[] {
  if (primitive === "date_picker_button") return ["pick_calendar"];
  const primary =
    cached ||
    ({
      text_input: "fill",
      number_input: "fill",
      password: "fill",
      search: "fill",
      date_input: "fill",
      date_picker_button: "pick_calendar",
      spinbutton: "fill",
      rich_text: "fill",
      tag_input: "fill_enter",
      select: "select",
      checkbox: "click",
      radio: "click",
      toggle: "click",
      file_upload: "upload",
      button: "click",
      link: "click",
      card_select: "click",
      unknown: "fill",
    } as Record<PrimitiveKind, string>)[primitive];
  const fallbacks: Record<string, string[]> = {
    fill: ["fill", "execute_value"],
    fill_enter: ["fill_enter", "fill", "execute_value"],
    select: ["select", "click"],
    click: ["click", "click_text"],
    pick_calendar: ["pick_calendar"],
    upload: ["upload"],
    execute_value: ["execute_value", "fill"],
  };
  const list = fallbacks[primary] || [primary, "fill", "execute_value"];
  // put cached first unique
  return [...new Set([primary, ...list])];
}

function valueAsString(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(String).join(" ");
  return String(v);
}

function softMatch(expected: string, actual: string, primitive: PrimitiveKind): boolean {
  const e = expected.trim();
  const a = actual.trim();
  if (!e) return true;
  if (primitive === "rich_text") {
    return a.length >= Math.min(20, Math.floor(e.length * 0.3)) || a.includes(e.slice(0, 12));
  }
  if (primitive === "tag_input") {
    const parts = e.split(/[\s,，#]+/).filter(Boolean);
    return parts.some((p) => a.includes(p));
  }
  if (primitive === "checkbox" || primitive === "radio" || primitive === "toggle") {
    const want = /^(1|true|yes|on)$/i.test(e);
    return (a === "true") === want;
  }
  if (primitive === "date_picker_button") {
    const dt = parseDatetimeValue(expected) || parseDatetimeValue(a);
    if (dt) return datetimeCommitted(a, dt);
  }
  return a === e || a.includes(e.slice(0, Math.min(20, e.length))) || e.includes(a.slice(0, 20));
}

async function readField(
  browser: BrowserLike,
  ref: string,
): Promise<{ ok: boolean; value: string }> {
  const r = await browser.execute(`(${FIELD_VALUE_SCRIPT})(${JSON.stringify(ref)})`);
  const data = r.data as { result?: { ok?: boolean; value?: string } } | undefined;
  const result = data?.result;
  if (result?.ok) return { ok: true, value: String(result.value || "") };
  // execute wraps differently sometimes
  const raw = (r.data as { result?: unknown })?.result;
  if (raw && typeof raw === "object" && "value" in (raw as object)) {
    return { ok: true, value: String((raw as { value: unknown }).value || "") };
  }
  return { ok: false, value: "" };
}

async function runMethod(
  browser: BrowserLike,
  method: string,
  field: AnalyzedField,
  value: unknown,
): Promise<ToolResult> {
  const ref = field.ref;
  const str = valueAsString(value);
  if (method === "fill") {
    return browser.fill({ ref }, str);
  }
  if (method === "fill_enter") {
    const filled = await browser.fill({ ref }, str);
    if (!filled.ok) return filled;
    await browser.execute(
      `(() => { const el=document.querySelector('[data-spark-ref="${ref}"]'); if(el){ el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); el.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',bubbles:true})); } return {ok:true}; })()`,
    );
    return filled;
  }
  if (method === "select") {
    return browser.select({ ref }, str);
  }
  if (method === "click") {
    return browser.click({ ref });
  }
  if (method === "click_text") {
    return browser.clickText(field.label || str, { exact: false });
  }
  if (method === "pick_calendar") {
    if (!browser.pickCalendar) {
      return { ok: false, message: "pick_calendar is not available" };
    }
    return browser.pickCalendar({
      triggerRef: field.ref,
      triggerLabel: field.label,
      value,
    });
  }
  if (method === "upload") {
    const files = Array.isArray(value) ? value.map(String) : [str];
    return browser.upload({ ref }, files.filter(Boolean));
  }
  if (method === "execute_value") {
    return browser.execute(
      `(() => {
        const el = document.querySelector('[data-spark-ref=${JSON.stringify(ref)}]');
        if (!el) return { ok: false, message: 'missing' };
        const v = ${JSON.stringify(str)};
        el.focus();
        if (el.isContentEditable || el.getAttribute('contenteditable')==='true') {
          try {
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(el);
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand('delete');
          } catch(_){}
          const ok = document.execCommand('insertText', false, v);
          if (!ok) { el.textContent = v; el.dispatchEvent(new InputEvent('input',{bubbles:true})); }
          return { ok: true, len: (el.innerText||'').length };
        }
        const proto = el.tagName==='TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto,'value')?.set;
        if (setter) setter.call(el, v); else el.value = v;
        el.dispatchEvent(new Event('input',{bubbles:true}));
        el.dispatchEvent(new Event('change',{bubbles:true}));
        return { ok: true, len: String(el.value||'').length };
      })()`,
    );
  }
  return { ok: false, message: `unknown method ${method}` };
}

export async function executePrimitivesOnBrowser(
  browser: BrowserLike,
  input: {
    payload: Record<string, unknown>;
    url?: string;
    includeOptional?: boolean;
    maxAttempts?: number;
  },
): Promise<ToolResult & { data?: ExecutePrimitivesResult }> {
  const payload = input.payload || {};
  const maxAttempts = Math.min(Math.max(input.maxAttempts || 3, 1), 5);
  const analyzed = await browser.analyzePage();
  if (!analyzed.ok || !analyzed.data) {
    return { ok: false, message: analyzed.message || "analyze_page failed", data: analyzed.data as never };
  }
  const page = analyzed.data as AnalyzedPage;
  const fields = [
    ...page.required_fields,
    ...(input.includeOptional !== false ? page.optional_fields : []),
  ];
  const cache = loadStrategyCache(browser.configDir());
  const usedRefs = new Set<string>();
  const plan: PrimitivePlanStep[] = [];
  const unmatchedKeys: string[] = [];

  for (const [key, value] of Object.entries(payload)) {
    if (value == null || value === "") continue;
    const match = bestFieldMatch(
      key,
      fields.filter((f) => !usedRefs.has(f.ref)),
    );
    if (!match) {
      unmatchedKeys.push(key);
      continue;
    }
    usedRefs.add(match.field.ref);
    const cached = getCachedMethod(cache, page.host, match.field.primitive);
    const methods = methodsFor(match.field.primitive, cached?.method);
    plan.push({
      key,
      ref: match.field.ref,
      primitive: match.field.primitive,
      label: match.field.label,
      value,
      method: methods[0]!,
      fallback: methods.slice(1),
      required: match.field.required,
    });
  }

  const steps: PrimitiveStepResult[] = [];
  for (const step of plan) {
    const field = fields.find((f) => f.ref === step.ref)!;
    const methods = [step.method, ...step.fallback];
    let done: PrimitiveStepResult | null = null;
    for (let attempt = 0; attempt < Math.min(maxAttempts, methods.length); attempt++) {
      const method = methods[attempt]!;
      const result = await runMethod(browser, method, field, step.value);
      const read = await readField(browser, step.ref);
      const expected = valueAsString(step.value);
      const dt = parseDatetimeValue(step.value);
      const matched =
        step.primitive === "date_picker_button"
          ? Boolean(result.ok && (dt ? datetimeCommitted(read.value, dt) : !/indefinitely/i.test(read.value)))
          : read.ok && softMatch(expected, read.value, step.primitive);
      if (result.ok && matched) {
        const learned = attempt > 0;
        if (learned || (attempt === 0 && method !== "fill")) {
          rememberMethod(browser.configDir(), page.host, step.primitive, method, field.selector);
        }
        done = {
          key: step.key,
          ref: step.ref,
          primitive: step.primitive,
          ok: true,
          method,
          attempts: attempt + 1,
          message: result.message,
          qa: { expected: expected.slice(0, 80), actual: read.value.slice(0, 80), matched: true },
          learned,
        };
        break;
      }
      done = {
        key: step.key,
        ref: step.ref,
        primitive: step.primitive,
        ok: false,
        method,
        attempts: attempt + 1,
        message: result.message || "qa mismatch",
        qa: { expected: expected.slice(0, 80), actual: read.value.slice(0, 80), matched: false },
      };
    }
    steps.push(done!);
  }

  // Final QA: re-analyze required non-empty
  const again = await browser.analyzePage();
  const page2 = (again.data as AnalyzedPage) || page;
  const emptyRequired = (page2.required_fields || [])
    .filter((f) => !String(f.current_value || "").trim())
    .map((f) => f.label || f.ref);

  // Only flag empty required that we attempted or that were empty and had payload
  const missingRequired = emptyRequired.filter((label) =>
    plan.some((p) => p.required && (p.label === label || softMatch(p.label, label, "text_input"))),
  );

  const allStepsOk = steps.every((s) => s.ok);
  const ok = allStepsOk && missingRequired.length === 0;
  const data: ExecutePrimitivesResult = {
    ok,
    url: page2.url || page.url,
    host: page.host,
    plan,
    steps,
    unmatchedKeys,
    missingRequired,
    finalQa: { ok: missingRequired.length === 0, emptyRequired },
    message: ok
      ? `execute_primitives ok (${steps.length} steps)`
      : `execute_primitives partial/fail · fail=${steps.filter((s) => !s.ok).length} unmatched=${unmatchedKeys.length}`,
  };
  return { ok, message: data.message, data };
}
