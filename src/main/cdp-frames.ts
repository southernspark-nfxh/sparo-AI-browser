/**
 * CDP helpers for cross-origin iframe (incl. OOPIF) access.
 * Uses Page.createIsolatedWorld + Runtime.evaluate per frameId.
 */
import type { WebContents } from "electron";
import type { SnapshotElement } from "../shared/types.js";

export type CdpFrameInfo = {
  /** Host-assigned index → refs like x0.e1 */
  index: number;
  frameId: string;
  url: string;
  name?: string;
  offsetX: number;
  offsetY: number;
  sameOriginSkipped?: boolean;
};

export type IframeMeta = {
  index: number;
  src: string;
  sameOrigin: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
};

type Send = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

/** frameId → executionContextId for stable isolated worlds */
const isolatedWorldCache = new Map<string, number>();

function isolatedWorldName(frameId: string): string {
  return `sparo_frame_${frameId}`;
}

export function clearIsolatedWorldCache(): void {
  isolatedWorldCache.clear();
}

function invalidateIsolatedWorld(frameId: string): void {
  isolatedWorldCache.delete(frameId);
}

async function getOrCreateIsolatedWorld(send: Send, frameId: string): Promise<number> {
  const cached = isolatedWorldCache.get(frameId);
  if (cached != null) return cached;
  const world = (await send("Page.createIsolatedWorld", {
    frameId,
    worldName: isolatedWorldName(frameId),
  })) as { executionContextId: number };
  isolatedWorldCache.set(frameId, world.executionContextId);
  return world.executionContextId;
}

export async function withDebugger<T>(
  wc: WebContents,
  fn: (send: Send) => Promise<T>,
  options?: { keepAttached?: boolean },
): Promise<T> {
  const wasAttached = wc.debugger.isAttached();
  if (!wasAttached) {
    wc.debugger.attach("1.3");
  }
  const keepAttached =
    options?.keepAttached === true || process.env.SPARO_CDP_KEEP_ATTACHED === "1";
  const send: Send = (method, params) =>
    wc.debugger.sendCommand(method, params as never) as Promise<unknown>;
  try {
    await send("Page.enable");
    await send("Runtime.enable");
    try {
      await send("Target.setAutoAttach", {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true,
      });
    } catch {
      /* older Chromium — still works for in-process frames */
    }
    return await fn(send);
  } finally {
    if (!wasAttached && !keepAttached) {
      try {
        wc.debugger.detach();
      } catch {
        /* ignore */
      }
    }
  }
}

type FrameNode = {
  frame: { id: string; url?: string; name?: string };
  childFrames?: FrameNode[];
};

function walkFrames(
  node: FrameNode,
  out: Array<{ frameId: string; url: string; name?: string }>,
  isRoot = true,
): void {
  if (!isRoot && node.frame?.id) {
    out.push({
      frameId: node.frame.id,
      url: node.frame.url || "",
      name: node.frame.name,
    });
  }
  for (const child of node.childFrames || []) {
    walkFrames(child, out, false);
  }
}

export async function listChildFrames(
  send: Send,
): Promise<Array<{ frameId: string; url: string; name?: string }>> {
  const tree = (await send("Page.getFrameTree")) as { frameTree: FrameNode };
  const out: Array<{ frameId: string; url: string; name?: string }> = [];
  if (tree?.frameTree) walkFrames(tree.frameTree, out, true);
  return out;
}

async function runtimeEvaluate<T>(
  send: Send,
  contextId: number,
  expression: string,
): Promise<T> {
  const evaluated = (await send("Runtime.evaluate", {
    expression,
    contextId,
    returnByValue: true,
    awaitPromise: true,
  })) as {
    result?: { value?: T; type?: string; description?: string };
    exceptionDetails?: { text?: string; exception?: { description?: string } };
  };

  if (evaluated.exceptionDetails) {
    const msg =
      evaluated.exceptionDetails.exception?.description ||
      evaluated.exceptionDetails.text ||
      "CDP evaluate failed";
    throw new Error(msg);
  }
  return evaluated.result?.value as T;
}

export async function cdpEvaluate<T = unknown>(
  send: Send,
  frameId: string,
  expression: string,
): Promise<T> {
  let contextId = await getOrCreateIsolatedWorld(send, frameId);
  try {
    return await runtimeEvaluate<T>(send, contextId, expression);
  } catch (firstErr) {
    invalidateIsolatedWorld(frameId);
    contextId = await getOrCreateIsolatedWorld(send, frameId);
    try {
      return await runtimeEvaluate<T>(send, contextId, expression);
    } catch (retryErr) {
      throw retryErr instanceof Error ? retryErr : firstErr;
    }
  }
}

/**
 * ASCII-only JS expression that evaluates to the original UTF-8 string.
 * Avoid embedding raw CJK in CDP `Runtime.evaluate` expressions (Latin-1 mojibake).
 */
export function cdpUtf8Expr(text: string): string {
  const b64 = Buffer.from(String(text ?? ""), "utf8").toString("base64");
  return `new TextDecoder("utf-8").decode(Uint8Array.from(atob(${JSON.stringify(b64)}),function(c){return c.charCodeAt(0)}))`;
}

/**
 * Prefer this for any CDP call that takes user text (Chinese).
 * Uses Runtime.callFunctionOn so args travel as JSON values, not string-embedded source.
 * Falls back to evaluate + base64 literal if callFunctionOn is unavailable.
 */
export async function cdpCall<T = unknown>(
  send: Send,
  frameId: string,
  fnSource: string,
  args: unknown[] = [],
): Promise<T> {
  async function attempt(contextId: number): Promise<T> {
    try {
      const holder = (await send("Runtime.evaluate", {
        expression: "({})",
        contextId,
        returnByValue: false,
      })) as { result?: { objectId?: string } };
      const objectId = holder.result?.objectId;
      if (!objectId) throw new Error("no objectId for callFunctionOn");

      const fnDecl = /^\s*function\b/.test(fnSource)
        ? fnSource
        : `function(){ return (${fnSource}).apply(null, arguments); }`;

      const invoked = (await send("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: fnDecl,
        arguments: args.map((value) => serializeCdpArg(value)),
        returnByValue: true,
        awaitPromise: true,
      })) as {
        result?: { value?: T };
        exceptionDetails?: { text?: string; exception?: { description?: string } };
      };

      if (invoked.exceptionDetails) {
        throw new Error(
          invoked.exceptionDetails.exception?.description ||
            invoked.exceptionDetails.text ||
            "callFunctionOn failed",
        );
      }
      return invoked.result?.value as T;
    } catch (err) {
      const argExprs = args.map((a) => {
        if (typeof a === "string") return cdpUtf8Expr(a);
        if (a === null || a === undefined) return "null";
        if (typeof a === "boolean" || typeof a === "number") return String(a);
        return `JSON.parse(${cdpUtf8Expr(JSON.stringify(a))})`;
      });
      const expression = `(() => { const __fn = (${fnSource}); return __fn(${argExprs.join(",")}); })()`;
      try {
        return await runtimeEvaluate<T>(send, contextId, expression);
      } catch (evalErr) {
        throw evalErr instanceof Error ? evalErr : err;
      }
    }
  }

  let contextId = await getOrCreateIsolatedWorld(send, frameId);
  try {
    return await attempt(contextId);
  } catch (firstErr) {
    invalidateIsolatedWorld(frameId);
    contextId = await getOrCreateIsolatedWorld(send, frameId);
    try {
      return await attempt(contextId);
    } catch (retryErr) {
      throw retryErr instanceof Error ? retryErr : firstErr;
    }
  }
}

/** CDP RemoteObject "value" args — keep primitives; stringify nothing with wrong encoding. */
function serializeCdpArg(value: unknown): { value?: unknown; unserializableValue?: string } {
  if (value === undefined) return { unserializableValue: "undefined" };
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return { value };
  }
  // Complex values: pass as JSON string, decode inside callee if needed.
  // Callers should prefer flat string/number/boolean args for fill/click_text.
  return { value: JSON.parse(JSON.stringify(value)) };
}

/** Match CDP frame URLs to top-level iframe layout boxes. */
export function matchFrameOffsets(
  cdpFrames: Array<{ frameId: string; url: string; name?: string }>,
  metas: IframeMeta[],
): CdpFrameInfo[] {
  const usedMeta = new Set<number>();
  const out: CdpFrameInfo[] = [];
  let index = 0;
  for (const cf of cdpFrames) {
    let meta: IframeMeta | undefined;
    const cfUrl = cf.url || "";
    for (const m of metas) {
      if (usedMeta.has(m.index) || m.sameOrigin) continue;
      if (!cfUrl && !m.src) {
        meta = m;
        break;
      }
      if (cfUrl && m.src && (cfUrl.includes(m.src) || m.src.includes(cfUrl) || urlsLooselyEqual(cfUrl, m.src))) {
        meta = m;
        break;
      }
    }
    if (!meta) {
      // Fall back to first unused cross-origin / unknown iframe box
      meta = metas.find((m) => !usedMeta.has(m.index) && !m.sameOrigin);
    }
    if (meta) usedMeta.add(meta.index);
    out.push({
      index,
      frameId: cf.frameId,
      url: cf.url,
      name: cf.name,
      offsetX: meta?.x ?? 0,
      offsetY: meta?.y ?? 0,
    });
    index += 1;
  }
  return out;
}

function urlsLooselyEqual(a: string, b: string): boolean {
  try {
    const ua = new URL(a, "https://example.invalid");
    const ub = new URL(b, "https://example.invalid");
    return ua.pathname === ub.pathname && ua.host === ub.host;
  } catch {
    return a === b;
  }
}

/** Collect interactive elements inside an iframe document (run via CDP). */
export const FRAME_COLLECT_SCRIPT = `(() => {
  const INTERACTIVE = [
    'a[href]','button','input','textarea','select','option',
    '[role="button"]','[role="link"]','[role="textbox"]','[role="menuitem"]','[role="option"]',
    '[contenteditable="true"]','[contenteditable=""]','[aria-haspopup]'
  ].join(', ');
  function isVisible(el) {
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function nameOf(el) {
    return (
      el.getAttribute('aria-label') || el.getAttribute('title') ||
      el.getAttribute('placeholder') || el.getAttribute('name') ||
      (el.innerText || '').trim().slice(0, 80) || el.getAttribute('value') || ''
    );
  }
  function cssPath(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 5) {
      let part = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(cur) + 1) + ')';
      }
      parts.unshift(part);
      cur = parent;
    }
    return parts.join(' > ');
  }
  const nodes = Array.from(document.querySelectorAll(INTERACTIVE));
  const out = [];
  let local = 0;
  const seen = new Set();
  for (const el of nodes) {
    if (seen.has(el) || !isVisible(el)) continue;
    seen.add(el);
    local += 1;
    const ref = 'e' + local;
    try { el.setAttribute('data-spark-ref', ref); } catch (_) {}
    const r = el.getBoundingClientRect();
    out.push({
      ref: ref,
      role: el.getAttribute('role') || el.tagName.toLowerCase(),
      name: nameOf(el),
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || undefined,
      value: typeof el.value === 'string' ? String(el.value).slice(0, 120) : undefined,
      placeholder: el.getAttribute('placeholder') || undefined,
      selector: cssPath(el),
      bounds: { x: r.x, y: r.y, width: r.width, height: r.height },
      disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
    });
    if (out.length >= 200) break;
  }
  return { url: location.href, title: document.title, elements: out, text: String((document.body && document.body.innerText) || '').slice(0, 20000) };
})()`;

export const FRAME_FIND_TEXT_SCRIPT = `(text, exact) => {
  function norm(s) {
    s = String(s || '');
    try { s = s.normalize('NFKC'); } catch (_) {}
    return s.trim().replace(/\\s+/g, ' ');
  }
  const want = norm(text);
  if (!want) return { ok: false, message: 'empty text' };
  const candidates = Array.from(document.querySelectorAll(
    'a,button,span,div,li,label,[role=menuitem],[role=button],[role=option],[role=tab],.ant-dropdown-menu-item'
  ));
  let best = null;
  let bestEl = null;
  for (const el of candidates) {
    const raw = (el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '');
    const t = norm(raw);
    if (!t) continue;
    if (t.length > want.length + 200) continue;
    const match = exact ? t === want : (t === want || t.includes(want));
    if (!match) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) continue;
    const score = Math.abs(r.width * r.height - 1800) + (t === want ? 0 : 80) + t.length;
    if (!best || score < best.score) {
      best = { score, text: t.slice(0, 60), x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
      bestEl = el;
    }
  }
  if (!best || !bestEl) return { ok: false, message: 'text not found: ' + want };
  try { bestEl.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (_) {}
  const r2 = bestEl.getBoundingClientRect();
  best.x = r2.x + r2.width / 2;
  best.y = r2.y + r2.height / 2;
  best.w = r2.width;
  best.h = r2.height;
  try { bestEl.setAttribute('data-spark-ref', 'spark-text'); best.ref = 'spark-text'; } catch (_) {}
  return { ok: true, ...best };
}`;

export const FRAME_WAIT_SCRIPT = `(ref, selector, text, requireAll) => {
  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  let el = null;
  if (ref) {
    try { el = document.querySelector('[data-spark-ref="' + CSS.escape(ref) + '"]'); } catch (_) {}
  }
  if (!el && selector) {
    try {
      const nodes = Array.from(document.querySelectorAll(selector));
      if (requireAll && selector.includes(',')) {
        const parts = selector.split(',').map((s) => s.trim()).filter(Boolean);
        const ok = parts.every((part) => {
          try {
            return Array.from(document.querySelectorAll(part)).some(visible);
          } catch (_) { return false; }
        });
        if (ok) {
          el = nodes.find(visible) || document.querySelector(parts[0]);
          return { ok: true, tag: el && el.tagName, text: el && (el.innerText||el.getAttribute('placeholder')||'').trim().slice(0,60), all: true };
        }
        return { ok: false };
      }
      el = nodes.find(visible) || null;
    } catch (_) {}
  }
  if (!el && text) {
    el = Array.from(document.querySelectorAll('a,button,span,div,input,label,li,textarea,[contenteditable=true]')).find((n) => {
      const t = (n.innerText || n.textContent || n.getAttribute('placeholder') || '').trim();
      return t.includes(text) && visible(n);
    }) || null;
  }
  if (!el) return { ok: false };
  return { ok: visible(el), tag: el.tagName, text: (el.innerText||el.getAttribute('placeholder')||'').trim().slice(0,60) };
}`;

export const FRAME_HIT_SCRIPT = `(ref, selector) => {
  let el = null;
  if (ref) {
    try { el = document.querySelector('[data-spark-ref="' + CSS.escape(ref) + '"]'); } catch (_) {}
  }
  if (!el && selector) {
    try { el = document.querySelector(selector); } catch (_) {}
  }
  if (!el) return { ok: false, message: 'not found in frame' };
  try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (_) {}
  const r = el.getBoundingClientRect();
  return {
    ok: true,
    x: r.x + r.width / 2,
    y: r.y + r.height / 2,
    width: r.width,
    height: r.height,
    disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
    tag: el.tagName.toLowerCase(),
  };
}`;

export const FRAME_FILL_SCRIPT = `(ref, selector, value) => {
  let el = null;
  if (ref) {
    try { el = document.querySelector('[data-spark-ref="' + CSS.escape(ref) + '"]'); } catch (_) {}
  }
  if (!el && selector) {
    try { el = document.querySelector(selector); } catch (_) {}
  }
  if (!el) return { ok: false, message: 'not found in frame' };
  const nested = el.querySelector('[contenteditable="true"],[contenteditable=""],textarea,input');
  if (nested) el = nested;
  try { el.focus(); } catch (_) {}
  const isCe = el.isContentEditable || el.getAttribute('contenteditable') === 'true';
  if (isCe) {
    el.innerHTML = '';
    el.textContent = value;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
  } else if ('value' in el) {
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    return { ok: false, message: 'element not fillable' };
  }
  const read = isCe ? (el.innerText || '') : String(el.value || '');
  return { ok: true, matched: read.includes(value) || read === value, value: read.slice(0, 200) };
}`;

export function parseCrossFrameRef(
  ref: string | undefined,
): { frameIndex: number; localRef: string } | null {
  if (!ref || !/^x\d+\./i.test(ref)) return null;
  const [head, ...rest] = ref.split(".");
  const frameIndex = parseInt(head.slice(1), 10);
  if (Number.isNaN(frameIndex)) return null;
  return { frameIndex, localRef: rest.join(".") };
}

export function prefixFrameElements(
  frame: CdpFrameInfo,
  elements: Array<Omit<SnapshotElement, "frame" | "bounds"> & { bounds?: SnapshotElement["bounds"]; ref: string }>,
): SnapshotElement[] {
  return elements.map((el) => {
    const b = el.bounds;
    return {
      ...el,
      ref: `x${frame.index}.${el.ref}`,
      frame: `cdp:${frame.frameId}`,
      crossOrigin: true,
      bounds: b
        ? {
            x: b.x + frame.offsetX,
            y: b.y + frame.offsetY,
            width: b.width,
            height: b.height,
          }
        : undefined,
    } as SnapshotElement;
  });
}
