// 页面动作都走带 tabId 的客户端。地址不对就停，不再发这一步。
import { activeIdOf, call, click, ensureRender, exec, nav, sessionStamp, sleep, switchTab, tabRows, tabs, uploadFile, useTab } from "./sparo.mjs";

export { sleep };

export function pass(detail) {
  return { ok: true, detail };
}

export function fail(code, detail, hint = "") {
  return { ok: false, code, detail, hint: hint || (typeof detail === "string" ? detail : "") };
}

export function unwrap(raw) {
  if (raw == null) return "";
  const text = String(raw);
  if (text.startsWith("MISMATCH")) return text;
  try {
    const parsed = JSON.parse(text);
    const inner = parsed?.data?.result ?? parsed?.result ?? parsed;
    if (typeof inner === "string") {
      try {
        return JSON.parse(inner);
      } catch {
        return inner;
      }
    }
    return inner;
  } catch {
    return text;
  }
}

export function renderGate(innerHeight) {
  if (!Number(innerHeight)) {
    return fail("RENDER_NOT_READY", { innerHeight: Number(innerHeight) || 0 }, "编辑标签还没有布局");
  }
  return null;
}

export function blockedCall(raw) {
  if (typeof raw !== "string") return null;
  if (raw.startsWith("URL_UNREAD")) return fail("URL_UNREAD", raw, "读不到标签地址");
  if (raw.startsWith("MISMATCH")) return fail("MISMATCH", raw, raw);
  return null;
}

export function titlesEqual(actual, expected) {
  return String(actual ?? "") === String(expected ?? "");
}

export function scheduleMatches(read, schedule) {
  if (!read || !schedule?.date || !schedule?.time) return false;
  const [hour, minute] = String(schedule.time).split(":");
  return read.date === schedule.date && read.hour === hour && read.minute === minute;
}

export function canResume(state) {
  const href = String(state?.href || "");
  const mark = String(state?.writeMark || "");
  if (!mark || !href.includes(mark)) {
    return { ok: false, code: "RESUME_NOT_EDITOR", hint: "当前不是编辑页，请从头跑" };
  }
  if (!state?.title || String(state.pageTitle ?? "") !== String(state.title)) {
    return { ok: false, code: "RESUME_NO_TITLE", hint: "编辑页没有这篇标题，请从头跑" };
  }
  return { ok: true };
}

export async function page(ctx, script) {
  // 渲染进程忙的时候 execute 会回空串，别把这当成页面的答案：重问两次
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await exec(script, ctx.tabId, ctx.host);
    const stopped = blockedCall(raw);
    if (stopped) return { mismatch: raw, stop: stopped };
    const value = unwrap(raw);
    if (value !== "" && value != null) return { value, raw };
    await sleep(250);
  }
  return { value: "", raw: "" };
}

const DANGER_NEIGHBORS = ["认领", "删除", "立即发布", "保存并认领", "确认发布"];

export function explainReach(text, snap, tried, next) {
  const view = snap?.viewport || {};
  const box = snap?.target || {};
  const triedText = (tried || []).join("、") || "还没试";
  const nextText = (next || []).join("、") || "manual";
  const facts = [
    "目标「" + text + "」",
    "视口 " + Number(view.w || 0) + "×" + Number(view.h || 0),
    "四边 left=" + Number(box.left || 0) + " top=" + Number(box.top || 0) + " right=" + Number(box.right || 0) + " bottom=" + Number(box.bottom || 0),
    "试过 " + triedText,
    "还剩 " + nextText,
  ];
  if (!Number(view.h) || !Number(view.w)) facts.push("视口高度为 0，标签未排版");
  if (snap?.inside && snap.inside.y === false) facts.push("纵向不在视口内");
  if (snap?.inside && snap.inside.x === false) facts.push("横向不在视口内");
  if (Array.isArray(snap?.scrollers) && !snap.scrollers.length) facts.push("祖先链上没有可滚容器");
  if (Array.isArray(snap?.blockers) && snap.blockers.length) facts.push("中心点被挡住");
  if (Array.isArray(snap?.candidates) && snap.candidates.length > 1) facts.push("同名按钮有 " + snap.candidates.length + " 个");
  return facts.join("；");
}

export function clickExact(text) {
  const want = JSON.stringify(String(text).replace(/\s+/g, ""));
  return (
    "(() => {" +
    "const want = " + want + ";" +
    "const danger = " + JSON.stringify(DANGER_NEIGHBORS) + ";" +
    "const norm = (el) => ((el && el.innerText) || '').replace(/\\s+/g, '').trim();" +
    "const nodes = Array.from(document.querySelectorAll('button,[role=\"button\"],a,label'));" +
    "const hits = nodes.filter((el) => norm(el) === want);" +
    "const neighbors = nodes.filter((el) => { const t = norm(el); return t && t !== want && (t.includes(want) || want.includes(t) || danger.some((word) => t.includes(word))); }).slice(0, 8).map(norm);" +
    "function snapshot(el) {" +
    "const r = el ? el.getBoundingClientRect() : { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };" +
    "const view = { w: window.innerWidth || 0, h: window.innerHeight || 0, scrollX: window.scrollX || 0, scrollY: window.scrollY || 0, dpr: window.devicePixelRatio || 1 };" +
    "const root = document.scrollingElement || document.documentElement;" +
    "const doc = { scrollW: root.scrollWidth || 0, scrollH: root.scrollHeight || 0 };" +
    "const target = { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height };" +
    "const inside = { x: r.width > 0 && r.left >= 0 && r.right <= view.w, y: r.height > 0 && r.top >= 0 && r.bottom <= view.h };" +
    "const scrollers = [];" +
    "let node = el && el.parentElement;" +
    "while (node && node !== document.documentElement) {" +
    "const st = getComputedStyle(node);" +
    "const canY = (st.overflowY === 'auto' || st.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1;" +
    "const canX = (st.overflowX === 'auto' || st.overflowX === 'scroll') && node.scrollWidth > node.clientWidth + 1;" +
    "if (canX || canY) scrollers.push({ cls: String(node.className).slice(0, 80), scrollW: node.scrollWidth, scrollH: node.scrollHeight, clientW: node.clientWidth, clientH: node.clientHeight, scrollLeft: node.scrollLeft, scrollTop: node.scrollTop });" +
    "node = node.parentElement;" +
    "}" +
    "const blockers = [];" +
    "if (el && view.w && view.h && r.width && r.height) {" +
    "const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);" +
    "if (top && top !== el && !el.contains(top)) {" +
    "const br = top.getBoundingClientRect();" +
    "blockers.push({ cls: String(top.className).slice(0, 80), left: br.left, top: br.top, w: br.width, h: br.height });" +
    "}" +
    "}" +
    "const dialogs = document.querySelectorAll('[role=\"dialog\"],[class*=\"modal\"],[class*=\"popup\"],[class*=\"dropdown\"],[class*=\"preview\"]').length;" +
    "const input = el ? el.querySelector('input') : null;" +
    "return { viewport: view, doc, target, inside, scrollers, blockers, neighbors, signals: { dialogs, expanded: el ? el.getAttribute('aria-expanded') : null, checked: !!(input && input.checked) } };" +
    "}" +
    "function ready(snap) { return snap.inside.x && snap.inside.y && !snap.blockers.length && snap.viewport.w > 0 && snap.viewport.h > 0; }" +
    "function scrollAncestor(el) {" +
    "let node = el.parentElement;" +
    "while (node && node !== document.documentElement) {" +
    "const st = getComputedStyle(node);" +
    "const r = el.getBoundingClientRect();" +
    "const box = node.getBoundingClientRect();" +
    "if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1) node.scrollTop += (r.top + r.height / 2) - (box.top + box.height / 2);" +
    "if ((st.overflowX === 'auto' || st.overflowX === 'scroll') && node.scrollWidth > node.clientWidth + 1) node.scrollLeft += (r.left + r.width / 2) - (box.left + box.width / 2);" +
    "node = node.parentElement;" +
    "}" +
    "}" +
    "function scrollDoc(el) {" +
    "const r = el.getBoundingClientRect();" +
    "const root = document.scrollingElement || document.documentElement;" +
    "root.scrollLeft += (r.left + r.width / 2) - (window.innerWidth / 2);" +
    "root.scrollTop += (r.top + r.height / 2) - (window.innerHeight / 2);" +
    "}" +
    "function fire(el) {" +
    "const r = el.getBoundingClientRect();" +
    "const opt = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };" +
    "el.dispatchEvent(new PointerEvent('pointerdown', opt));" +
    "el.dispatchEvent(new MouseEvent('mousedown', opt));" +
    "el.dispatchEvent(new PointerEvent('pointerup', opt));" +
    "el.dispatchEvent(new MouseEvent('mouseup', opt));" +
    "el.click();" +
    "}" +
    "if (hits.length !== 1) {" +
    "const snap = snapshot(hits[0] || null);" +
    "snap.candidates = hits.slice(0, 6).map((el) => ({ text: norm(el), cls: String(el.className).slice(0, 80) }));" +
    "const layout = !snap.viewport.w || !snap.viewport.h;" +
    "const code = layout ? 'RENDER_NOT_READY' : (hits.length ? 'AMBIGUOUS' : 'BUTTON_MISSING');" +
    "const tried = ['measure'];" +
    "const next = layout ? ['request-layout', 'manual'] : ['manual'];" +
    "return JSON.stringify({ ok: false, code, geometry: snap, tried, next, target: want });" +
    "}" +
    "const hit = hits[0];" +
    "const tried = [];" +
    "let snap = snapshot(hit);" +
    "tried.push('inline');" +
    "if (!ready(snap) && snap.scrollers.length) { scrollAncestor(hit); snap = snapshot(hit); tried.push('scroll-ancestor'); }" +
    "const root = document.scrollingElement || document.documentElement;" +
    "if (!ready(snap) && (root.scrollWidth > window.innerWidth || root.scrollHeight > window.innerHeight)) { scrollDoc(hit); snap = snapshot(hit); tried.push('scroll-doc'); }" +
    "if (!snap.viewport.w || !snap.viewport.h) {" +
    "return JSON.stringify({ ok: false, code: 'RENDER_NOT_READY', geometry: snap, tried, next: ['request-layout', 'manual'], target: want });" +
    "}" +
    "if (!ready(snap)) {" +
    "const next = snap.blockers.length ? ['clear-blocker', 'manual'] : ['manual'];" +
    "return JSON.stringify({ ok: false, code: 'UNREACHABLE', geometry: snap, tried, next, target: want });" +
    "}" +
    "const before = snap.signals;" +
    "const top = document.elementFromPoint(snap.target.left + snap.target.w / 2, snap.target.top + snap.target.h / 2);" +
    "if (!top || (top !== hit && !hit.contains(top))) {" +
    "return JSON.stringify({ ok: false, code: 'UNREACHABLE', geometry: snap, tried, next: ['clear-blocker', 'manual'], target: want });" +
    "}" +
    "fire(hit);" +
    "const after = snapshot(hit).signals;" +
    "const changed = before.dialogs !== after.dialogs || before.expanded !== after.expanded || before.checked !== after.checked;" +
    "if (!changed) return JSON.stringify({ ok: false, code: 'CLICK_UNPROVEN', geometry: snap, tried, next: ['request-layout', 'manual'], target: want, fired: true });" +
    "return JSON.stringify({ ok: true, geometry: snapshot(hit), tried, target: want, readback: after });" +
    "})()"
  );
}

export async function clickRevealed(ctx, text) {
  return clickLabeled(ctx, text);
}

export async function clickLabeled(ctx, text) {
  const read = await page(ctx, clickExact(text));
  if (read.stop) return read.stop;
  const value = read.value || {};
  const snap = value.geometry || {};
  const diagnosis = explainReach(text, snap, value.tried || [], value.next || []);
  if (!value.ok) {
    return {
      ok: false,
      code: value.code || "UNREACHABLE",
      detail: value,
      hint: diagnosis,
      diagnosis,
      tried: value.tried || [],
      next: value.next || ["manual"],
      geometry: snap,
    };
  }
  return pass({ ...value, diagnosis });
}

export function setNativeValue(selector, value) {
  return (
    "(() => {" +
    "const el = document.querySelector(" + JSON.stringify(selector) + ");" +
    "if (!el) return JSON.stringify({ ok: false, code: 'NO_INPUT' });" +
    "const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;" +
    "const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;" +
    "const next = " + JSON.stringify(value) + ";" +
    "if (setter) setter.call(el, next); else el.value = next;" +
    "el.dispatchEvent(new Event('input', { bubbles: true }));" +
    "el.dispatchEvent(new Event('change', { bubbles: true }));" +
    "return JSON.stringify({ ok: el.value === next, value: el.value, len: (el.value || '').length });" +
    "})()"
  );
}

export function tagFileInput(rootSelector, strict = false) {
  const rootExpr = rootSelector
    ? "document.querySelector(" + JSON.stringify(rootSelector) + ")"
    : "document";
  return (
    "(() => {" +
    "const root = " + rootExpr + ";" +
    "const strict = " + (strict ? "true" : "false") + ";" +
    "if (!root) return JSON.stringify({ selector: '' });" +
    "const inputs = Array.from(root.querySelectorAll('input[type=\"file\"]'));" +
    "const images = inputs.filter((el) => /image/i.test(el.accept || ''));" +
    "const picked = images[0] || (strict ? null : inputs.find((el) => el.accept === '') || inputs[0]);" +
    "if (!picked) return JSON.stringify({ selector: '' });" +
    "if (!picked.id) picked.id = 'sparo-file-' + Math.random().toString(16).slice(2);" +
    "return JSON.stringify({ selector: '#' + picked.id, accept: picked.accept || '' });" +
    "})()"
  );
}

export async function uploadPicked(ctx, file, rootSelector, strict = false) {
  const picked = await page(ctx, tagFileInput(rootSelector, strict));
  const stopped = picked.stop || blockedCall(picked.mismatch);
  if (stopped) return stopped;
  if (!picked.value?.selector) return fail("NO_FILE_INPUT", rootSelector || "document", "没有找到图片文件框");
  const raw = await uploadFile(picked.value.selector, file, ctx.tabId, ctx.host);
  const uploadStopped = blockedCall(raw);
  if (uploadStopped) return uploadStopped;
  return pass({ selector: picked.value.selector, upload: unwrap(raw) });
}

const BLOCKER_SCRIPT =
  "(() => {" +
  "const boxes = Array.from(document.querySelectorAll('[role=\"dialog\"],[class*=\"modal\"],[class*=\"dialog\"],[class*=\"mask\"],[class*=\"captcha\"],[class*=\"verify\"]'));" +
  "const text = boxes.map((el) => (el.innerText || '').trim()).filter((t) => t && t.length < 800).join('\\n').slice(0, 1500);" +
  "if (/滑块|拖动[\\s\\S]{0,8}验证|请完成验证|短信验证|验证码/.test(text)) {" +
  "return JSON.stringify({ code: 'NEED_HUMAN', hint: text.slice(0, 180) });" +
  "}" +
  "return JSON.stringify({ code: '', hint: text.slice(0, 180) });" +
  "})()";

export async function guard(ctx) {
  const read = await page(ctx, BLOCKER_SCRIPT);
  if (read.stop) return read.stop;
  if (read.value?.code) return fail(read.value.code, read.value.hint || read.value.code, read.value.hint || "");
  return null;
}

export async function pageHint(ctx) {
  const read = await page(ctx, BLOCKER_SCRIPT);
  if (read.stop) return read.stop.hint || read.mismatch;
  return read.value?.hint || "";
}

export async function waitEditor(ctx, selector, timeoutMs = 15000, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() <= deadline) {
    last = await page(
      ctx,
      "(() => JSON.stringify({ href: location.href, has: !!document.querySelector(" + JSON.stringify(selector) + ") }))()",
    );
    if (last.stop) {
      if (last.stop.code !== "URL_UNREAD" || Date.now() + intervalMs > deadline) return last.stop;
      await sleep(intervalMs);
      continue;
    }
    const href = last.value?.href || "";
    if (/login|passport|clientAuth|signin/i.test(href)) return fail("LOGIN", href, "登录态失效，只把这个平台交给用户");
    if (last.value?.has) return pass({ href });
    if (Date.now() + intervalMs > deadline) break;
    await sleep(intervalMs);
  }
  return fail("EDITOR_NOT_READY", last?.value?.href || "", "空白编辑器没有出现");
}

const createdIds = new Set();

function tabIsOurs(tab, stamp, hasOwner) {
  if (!hasOwner) return createdIds.has(tab.id);
  const owner = String(tab.owner || "").trim();
  if (!owner) return false;
  return owner === stamp.owner || owner === stamp.clientId || owner === "agent:" + stamp.clientId;
}

export function findOwnedEditor(rows, stamp, writeMark) {
  const hasOwner = rows.some((tab) => Object.prototype.hasOwnProperty.call(tab, "owner"));
  return rows.find((tab) => String(tab.url || "").includes(writeMark) && tabIsOurs(tab, stamp, hasOwner)) || null;
}

export function chooseEditorTab({ before, after, stamp, writeMark }) {
  const beforeTabs = before?.tabs || [];
  const afterTabs = after?.tabs || [];
  const hasOwner = afterTabs.some((tab) => Object.prototype.hasOwnProperty.call(tab, "owner"));
  const beforeIds = new Set(beforeTabs.map((tab) => tab.id));
  const beforeUrl = new Map(beforeTabs.map((tab) => [tab.id, String(tab.url || "")]));
  const tried = ["new-id", "url-became-editor", "active-became-editor"];
  const editorUrl = (url) => String(url || "").includes(writeMark);
  const ours = (tab) => tabIsOurs(tab, stamp, hasOwner);
  const fresh = afterTabs.filter((tab) => !beforeIds.has(tab.id));
  const created = fresh.find((tab) => editorUrl(tab.url) && ours(tab));
  if (created) return { ok: true, tab: created, via: "new-id" };
  const changed = afterTabs.find((tab) => {
    const previous = beforeUrl.get(tab.id) || "";
    return beforeIds.has(tab.id) && editorUrl(tab.url) && !editorUrl(previous) && ours(tab);
  });
  if (changed) return { ok: true, tab: changed, via: "url-became-editor" };
  const active = afterTabs.find((tab) => tab.id === after?.activeId);
  const activePrevious = active ? beforeUrl.get(active.id) || "" : "";
  if (active && editorUrl(active.url) && !editorUrl(activePrevious) && ours(active)) {
    return { ok: true, tab: active, via: "active-became-editor" };
  }
  const ownFresh = fresh.find((tab) => ours(tab) && tab.url);
  const ownChanged = afterTabs.find((tab) => ours(tab) && String(tab.url || "") !== (beforeUrl.get(tab.id) || ""));
  const landing = ownFresh?.url || ownChanged?.url || (active && ours(active) ? active.url : "") || fresh[0]?.url || "";
  return {
    ok: false,
    code: "NO_EDITOR_TAB",
    tried,
    landing,
    activeId: after?.activeId || "",
    tabs: afterTabs,
  };
}

/**
 * 只复用 owner 是自己的编辑页。对不上就报错，不接管。
 */
export async function openWriteTab(ctx) {
  const stamp = await sessionStamp();
  const beforeListed = await tabs();
  const beforeRows = tabRows(beforeListed);
  // 「修改已发布文章」的编辑页长得和新建页一样，复用它会改错稿：带 article_id / online_modify 的一律不复用
  const reusable = ctx.editExisting
    ? beforeRows.filter((tab) => !ctx.editExisting.test(String(tab.url || "")))
    : beforeRows;
  const ready = findOwnedEditor(reusable, stamp, ctx.writeMark);
  if (ready && String(ready.url || "").includes(ctx.host)) {
    const pin = await useTab(ready.id, ctx.host);
    const stopped = blockedCall(pin);
    if (stopped) return stopped;
    ctx.tabId = ready.id;
    return pass({ tabId: ctx.tabId, reused: true, owner: ready.owner || stamp.owner, via: "already-editor" });
  }
  const before = {
    activeId: activeIdOf(beforeListed),
    tabs: beforeRows.map((tab) => ({ id: tab.id, url: tab.url || "", owner: tab.owner || "" })),
  };
  await call("navigate", { url: ctx.writeUrl });
  const deadline = Date.now() + 15000;
  let last = before;
  while (Date.now() <= deadline) {
    const listed = await tabs();
    const rows = tabRows(listed);
    last = {
      activeId: activeIdOf(listed),
      tabs: rows.map((tab) => ({ id: tab.id, url: tab.url || "", owner: tab.owner || "" })),
    };
    const choice = chooseEditorTab({ before, after: last, stamp, writeMark: ctx.writeMark });
    if (choice.ok && String(choice.tab.url || "").includes(ctx.host)) {
      const pin = await useTab(choice.tab.id, ctx.host);
      const stopped = blockedCall(pin);
      if (stopped?.code === "URL_UNREAD") {
        await sleep(200);
        continue;
      }
      if (stopped) return stopped;
      createdIds.add(choice.tab.id);
      ctx.tabId = choice.tab.id;
      return pass({ tabId: ctx.tabId, reused: choice.via !== "new-id", owner: choice.tab.owner || stamp.owner, via: choice.via });
    }
    await sleep(200);
  }
  const choice = chooseEditorTab({ before, after: last, stamp, writeMark: ctx.writeMark });
  const landing = choice.landing || "";
  return {
    ok: false,
    code: "NO_EDITOR_TAB",
    detail: { tabs: last.tabs, activeId: last.activeId, tried: choice.tried, landing, writeUrl: ctx.writeUrl },
    hint: "没有进入编辑页，实际落在 " + (landing || "未知地址"),
    tried: choice.tried,
    landing,
  };
}

export async function readHref(ctx) {
  const read = await page(ctx, "(() => JSON.stringify({ href: location.href }))()");
  if (read.stop) return read.stop;
  return pass(read.value || {});
}

/** 目标标签没排版时，用活动标签的高度区分环境问题和单标签问题。 */
export function renderFailure({ targetHeight, activeHeight }) {
  if (Number(targetHeight) > 0) return null;
  if (activeHeight == null || !Number.isFinite(Number(activeHeight))) {
    return fail("RENDER_NOT_READY", { innerHeight: Number(targetHeight) || 0, activeHeight: null }, "读不到活动标签的布局高度");
  }
  if (Number(activeHeight) > 0) {
    const stopped = fail("RENDER_NOT_READY", { innerHeight: 0, activeHeight: Number(activeHeight) }, "目标标签未排版，活动标签正常");
    stopped.diagnosis = "目标标签未排版，活动标签正常";
    stopped.next = ["switch-tab", "manual"];
    return stopped;
  }
  const stopped = fail("WINDOW_MINIMIZED", { innerHeight: 0, activeHeight: 0 }, "窗口最小化，全部标签未排版");
  stopped.diagnosis = "窗口最小化，全部标签未排版";
  stopped.next = ["ensure-render", "manual"];
  return stopped;
}

async function measureHeight(ctx) {
  let height = 0;
  // 窗口最小化时 restore + showInactive 要等系统动画，实测约 10 秒才重新排版
  const deadline = Date.now() + 15000;
  while (Date.now() <= deadline) {
    const read = await page(ctx, "(() => JSON.stringify({ innerHeight: window.innerHeight }))()");
    if (read.stop?.code === "URL_UNREAD") {
      await sleep(200);
      continue;
    }
    if (read.stop) return { stop: read.stop, height: 0 };
    height = Number(read.value?.innerHeight || 0);
    if (height > 0) return { height };
    await sleep(200);
  }
  return { height };
}

async function measureTabHeight(tab) {
  if (!tab?.id) return null;
  let host = "";
  try {
    host = new URL(String(tab.url || "")).hostname.replace(/^www\./, "");
  } catch {
    host = "";
  }
  const raw = await exec("(() => JSON.stringify({ innerHeight: window.innerHeight || 0 }))()", tab.id, host);
  if (typeof raw === "string" && raw.startsWith("MISMATCH")) return null;
  const value = unwrap(raw);
  const n = Number(value?.innerHeight);
  return Number.isFinite(n) ? n : null;
}

async function activeTabHeight(ctx) {
  const listed = await tabs();
  const activeId = activeIdOf(listed);
  if (!activeId) return null;
  if (activeId === ctx.tabId) {
    const read = await page(ctx, "(() => JSON.stringify({ innerHeight: window.innerHeight || 0 }))()");
    if (read.stop) return null;
    const n = Number(read.value?.innerHeight);
    return Number.isFinite(n) ? n : null;
  }
  const row = tabRows(listed).find((tab) => tab.id === activeId);
  return measureTabHeight(row || { id: activeId, url: "" });
}

export async function activateEditor(ctx) {
  if (!ctx.tabId) return fail("NO_TAB", "", "没有编辑标签");
  const beforeActive = await activeTabHeight(ctx);
  const raw = await switchTab(ctx.tabId);
  const bad = unwrap(raw);
  if (bad && typeof bad === "object" && bad.ok === false) {
    return fail("SWITCH_FAILED", bad, bad.message || "切不到编辑标签");
  }
  const first = await measureHeight(ctx);
  if (first.stop) return first.stop;
  if (first.height > 0) return pass({ innerHeight: first.height, ensured: false });
  // 编辑标签没有高度时，不管活动标签是否有高度，都尝试 ensureRender。
  // 新开的编辑页经常是这种情况：活动标签（用户之前用的）有高度，新标签页在后台没渲染。
  const ensured = await ensureRender(ctx.tabId);
  if (ensured.missing) return renderFailure({ targetHeight: 0, activeHeight: beforeActive });
  if (ensured.ok) ctx.renderHeld = true;
  const second = await measureHeight(ctx);
  if (second.stop) return second.stop;
  if (second.height > 0) return pass({ innerHeight: second.height, ensured: true });
  const again = await activeTabHeight(ctx);
  return renderFailure({ targetHeight: 0, activeHeight: again == null ? 0 : again });
}

export async function restoreActive(previous) {
  if (!previous) return pass({ restored: false });
  const listed = await tabs();
  if (!tabRows(listed).some((tab) => tab.id === previous)) return pass({ restored: false, closed: true });
  if (String(listed.activeId || "") === previous) return pass({ restored: true });
  await switchTab(previous);
  return pass({ restored: true });
}

function scheduleScanScript() {
  return (
    "(() => {" +
    "const innerHeight = window.innerHeight || 0;" +
    "if (!innerHeight) return JSON.stringify({ code: 'RENDER_NOT_READY', innerHeight: 0 });" +
    "function visible(el) {" +
    "if (!el || !el.isConnected) return false;" +
    "const r = el.getBoundingClientRect();" +
    "const st = getComputedStyle(el);" +
    "if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;" +
    "return r.width > 0 && r.height > 0;" +
    "}" +
    "const widgets = Array.from(document.querySelectorAll('.cheetah-select, .cheetah-picker, .byte-picker, .byte-select, .byte-timepicker')).filter(visible);" +
    "const host = widgets[0] ? widgets[0].closest('[role=\"dialog\"], [class*=\"modal\"]') : null;" +
    "return JSON.stringify({ innerHeight, widgets: widgets.length, host: host ? String(host.className).slice(0, 80) : '' });" +
    "})()"
  );
}

function clickWidgetScript(index) {
  return (
    "(() => {" +
    "try {" +
    "const innerHeight = window.innerHeight || 0;" +
    "if (!innerHeight) return JSON.stringify({ code: 'RENDER_NOT_READY', innerHeight: 0 });" +
    "function visible(el) {" +
    "if (!el || !el.isConnected) return false;" +
    "const r = el.getBoundingClientRect();" +
    "const st = getComputedStyle(el);" +
    "if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;" +
    "return r.width > 0 && r.height > 0;" +
    "}" +
    "function fire(el) {" +
    "const r = el.getBoundingClientRect();" +
    "const opt = { bubbles: true, cancelable: true, clientX: r.left + Math.max(r.width, 2) / 2, clientY: r.top + Math.max(r.height, 2) / 2 };" +
    "el.dispatchEvent(new PointerEvent('pointerdown', opt));" +
    "el.dispatchEvent(new MouseEvent('mousedown', opt));" +
    "el.dispatchEvent(new PointerEvent('pointerup', opt));" +
    "el.dispatchEvent(new MouseEvent('mouseup', opt));" +
    "el.click();" +
    "}" +
    "const widgets = Array.from(document.querySelectorAll('.cheetah-select, .cheetah-picker, .byte-picker, .byte-select, .byte-timepicker')).filter(visible);" +
    "const widget = widgets[" + Number(index) + "];" +
    "if (!widget) return JSON.stringify({ ok: false, widgets: widgets.length });" +
    "const innerTarget = widget.querySelector('.cheetah-select-selection-item, .cheetah-select-selector, .cheetah-select-arrow') || widget;" +
    "fire(innerTarget);" +
    "return JSON.stringify({ ok: true, widgets: widgets.length, innerText: (widget.innerText||'').trim() });" +
    "} catch(e) { return JSON.stringify({ ok: false, error: String(e), stack: String(e && e.stack || '').slice(0, 200) }); }" +
    "})()"
  );
}

function pickPopupScript(text, date) {
  return (
    "(() => {" +
    "const innerHeight = window.innerHeight || 0;" +
    "if (!innerHeight) return JSON.stringify({ code: 'RENDER_NOT_READY', innerHeight: 0 });" +
    "const want = " + JSON.stringify(String(text)) + ";" +
    "const date = " + JSON.stringify(String(date || "")) + ";" +
    "function visible(el) {" +
    "if (!el || !el.isConnected) return false;" +
    "const r = el.getBoundingClientRect();" +
    "const st = getComputedStyle(el);" +
    "if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;" +
    "return r.width > 0 && r.height > 0;" +
    "}" +
    "function fire(el) {" +
    "const r = el.getBoundingClientRect();" +
    "const opt = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };" +
    "el.dispatchEvent(new PointerEvent('pointerdown', opt));" +
    "el.dispatchEvent(new MouseEvent('mousedown', opt));" +
    "el.dispatchEvent(new PointerEvent('pointerup', opt));" +
    "el.dispatchEvent(new MouseEvent('mouseup', opt));" +
    "el.click();" +
    "}" +
    "const nodes = Array.from(document.querySelectorAll('[class*=\"dropdown\"],[class*=\"popup\"],[class*=\"picker\"]'));" +
    "const live = nodes.filter((el) => visible(el) && el.getAttribute('aria-hidden') !== 'true' && el.getBoundingClientRect().height > 20);" +
    "live.sort((a, b) => (Number(getComputedStyle(a).zIndex) || 0) - (Number(getComputedStyle(b).zIndex) || 0));" +
    "const root = live[live.length - 1];" +
    "if (!root) return JSON.stringify({ ok: false, popup: false });" +
    "const hit = Array.from(root.querySelectorAll('td,li,div,span,button')).find((el) => {" +
    "if (!visible(el) || !el.isConnected) return false;" +
    "const cls = String(el.className || '');" +
    "if (/disabled|prev|next|out-of|not-in/.test(cls)) return false;" +
    "const title = el.getAttribute('title') || el.getAttribute('aria-label') || '';" +
    "const t = (el.innerText || '').replace(/\\s+/g, '').replace(/分|时|点/g, '');" +
    "if (date && title.includes(date)) return true;" +
    "if (date && /月.*日/.test(t)) { const m = t.match(/(\\d+)日/); return m && m[1] === want; }" +
    "if (t === want) return true;" +
    // 小时列表写成「7点」，脚本传的是「07」，按数值再比一次
    "return /^\\d+$/.test(t) && /^\\d+$/.test(want) && Number(t) === Number(want);" +
    "});" +
    "if (!hit) return JSON.stringify({ ok: false, popup: true });" +
    "fire(hit);" +
    "return JSON.stringify({ ok: true, popup: true });" +
    "})()"
  );
}

function scrollPopupScript(step) {
  return (
    "(() => {" +
    "function visible(el) {" +
    "if (!el || !el.isConnected) return false;" +
    "const r = el.getBoundingClientRect();" +
    "const st = getComputedStyle(el);" +
    "if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;" +
    "return r.width > 0 && r.height > 0;" +
    "}" +
    "const lists = Array.from(document.querySelectorAll('[class*=\"dropdown\"],[class*=\"popup\"],[class*=\"picker\"]'))" +
    ".filter((el) => visible(el) && el.getBoundingClientRect().height > 20);" +
    "lists.sort((a, b) => (Number(getComputedStyle(a).zIndex) || 0) - (Number(getComputedStyle(b).zIndex) || 0));" +
    "const root = lists[lists.length - 1];" +
    "if (!root) return JSON.stringify({ ok: false, popup: false });" +
    "const named = Array.from(root.querySelectorAll('[class*=\"virtual-list-holder\"],[class*=\"scroll\"],[class*=\"list-holder\"]'))" +
    ".filter((el) => el.scrollHeight > el.clientHeight + 4);" +
    "const holder = named[0] || Array.from(root.querySelectorAll('div,ul'))" +
    ".filter((el) => el.scrollHeight > el.clientHeight + 20 && el.clientHeight > 40).pop() || root;" +
    "const before = holder.scrollTop;" +
    "if (" + Number(step) + " < 0) holder.scrollTop = 0;" +
    "else holder.scrollTop = Math.min(holder.scrollHeight, before + holder.clientHeight * " + Number(step) + ");" +
    "holder.dispatchEvent(new Event('scroll', { bubbles: true }));" +
    "return JSON.stringify({ ok: true, top: holder.scrollTop, height: holder.scrollHeight, client: holder.clientHeight, moved: holder.scrollTop !== before });" +
    "})()"
  );
}

// 分钟下拉同样是 rc-virtual-list，只渲染当前可见的十几项。分两步：先扫当前渲染项，找不到再滚一屏。
// 不按行高估算位置——React 还没重渲染就读 DOM 会读到旧值（上次就是这么卡住的）。
function findMinuteListBody() {
  return (
    "function visible(el) {" +
    "if (!el || !el.isConnected) return false;" +
    "const r = el.getBoundingClientRect();" +
    "return r.width > 0 && r.height > 0;" +
    "}" +
    "const lists = Array.from(document.querySelectorAll('.rc-virtual-list')).filter(visible);" +
    "let minuteList = null;" +
    "for (const list of lists) {" +
    "const items = list.querySelectorAll('.cheetah-select-item, [class*=\"select-item\"]');" +
    "if (items.length && /分/.test(items[0].textContent || '')) { minuteList = list; break; }" +
    "}" +
    "if (!minuteList) return { error: 'no minute list' };" +
    "const holder = minuteList.querySelector('.rc-virtual-list-holder') || minuteList;" +
    "return { list: minuteList, holder };"
  );
}

function pickMinuteScript(minute) {
  const target = Number(minute);
  return (
    "(() => {" +
    "function visible(el) {" +
    "if (!el || !el.isConnected) return false;" +
    "const r = el.getBoundingClientRect();" +
    "return r.width > 0 && r.height > 0;" +
    "}" +
    "function fire(el) {" +
    "const r = el.getBoundingClientRect();" +
    "const opt = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };" +
    "el.dispatchEvent(new PointerEvent('pointerdown', opt));" +
    "el.dispatchEvent(new MouseEvent('mousedown', opt));" +
    "el.dispatchEvent(new PointerEvent('pointerup', opt));" +
    "el.dispatchEvent(new MouseEvent('mouseup', opt));" +
    "el.click();" +
    "}" +
    "const found = (() => {" + findMinuteListBody() + "})();" +
    "if (found.error) return JSON.stringify({ ok: false, reason: found.error });" +
    // 列表写「0分」，参数是「00」：按数值比，别比字符串
    "const items = Array.from(found.list.querySelectorAll('.cheetah-select-item, [class*=\"select-item\"]')).filter(visible);" +
    "for (const it of items) {" +
    "const m = (it.textContent || '').replace(/\\s+/g, '').match(/^(\\d+)分$/);" +
    "if (m && Number(m[1]) === " + target + ") { fire(it); return JSON.stringify({ ok: true }); }" +
    "}" +
    "const shown = items.map((it) => { const m = (it.textContent || '').replace(/\\s+/g, '').match(/^(\\d+)分$/); return m ? Number(m[1]) : null; }).filter((n) => n !== null);" +
    "return JSON.stringify({ ok: false, reason: 'not rendered', shown: shown.slice(0, 6), last: shown[shown.length - 1] });" +
    "})()"
  );
}

function scrollMinuteListScript(step) {
  return (
    "(() => {" +
    "const found = (() => {" + findMinuteListBody() + "})();" +
    "if (found.error) return JSON.stringify({ ok: false, reason: found.error });" +
    "const holder = found.holder;" +
    "const before = holder.scrollTop;" +
    "if (" + Number(step) + " < 0) holder.scrollTop = 0;" +
    "else holder.scrollTop = Math.min(holder.scrollHeight - holder.clientHeight, before + Math.max(24, Math.round(holder.clientHeight * " + Number(step) + ")));" +
    "holder.dispatchEvent(new Event('scroll', { bubbles: true }));" +
    "return JSON.stringify({ ok: true, top: holder.scrollTop, moved: Math.abs(holder.scrollTop - before) > 1, height: holder.scrollHeight, client: holder.clientHeight });" +
    "})()"
  );
}

function readScheduleScript() {
  return (
    "(() => {" +
    "const innerHeight = window.innerHeight || 0;" +
    "if (!innerHeight) return JSON.stringify({ code: 'RENDER_NOT_READY', innerHeight: 0 });" +
    "function visible(el) {" +
    "if (!el || !el.isConnected) return false;" +
    "const r = el.getBoundingClientRect();" +
    "return r.width > 0 && r.height > 0;" +
    "}" +
    "const sel = '.cheetah-picker, .cheetah-select, .byte-picker, .byte-select, .byte-timepicker';" +
    // 定时弹层里真正的主体是 .timepublish-wrap；按「弹窗里谁含定时二字」找会抓到页脚的按钮条
    "const wrap = document.querySelector('.timepublish-wrap');" +
    "let widgets = wrap ? Array.from(wrap.querySelectorAll(sel)).filter(visible) : [];" +
    "if (!widgets.length) widgets = Array.from(document.querySelectorAll(sel)).filter(visible);" +
    "const readOf = (widget, kind) => {" +
    "if (!widget) return '';" +
    "const text = ((widget.querySelector('input') && widget.querySelector('input').value) || widget.innerText || '').replace(/\\s+/g, '');" +
    // 日期控件只显示「11月12日」，补上日历年，才能和 --schedule 的 YYYY-MM-DD 比
    "if (kind === 'date') {" +
    "const full = text.match(/\\d{4}-\\d{2}-\\d{2}/);" +
    "if (full) return full[0];" +
    "const md = text.match(/(\\d{1,2})月(\\d{1,2})日/);" +
    "if (!md) return '';" +
    "const now = new Date();" +
    "const month = Number(md[1]);" +
    "const year = month < now.getMonth() + 1 ? now.getFullYear() + 1 : now.getFullYear();" +
    "return year + '-' + String(month).padStart(2, '0') + '-' + String(Number(md[2])).padStart(2, '0');" +
    "}" +
    "const m = text.match(/\\d{1,2}/); return m ? String(Number(m[0])).padStart(2, '0') : '';" +
    "};" +
    "return JSON.stringify({ date: readOf(widgets[0], 'date'), hour: readOf(widgets[1], 'hour'), minute: readOf(widgets[2], 'minute'), widgets: widgets.length, innerHeight });" +
    "})()"
  );
}

async function pollPage(ctx, script, ready) {
  let last = null;
  for (let i = 0; i < 20; i++) {
    last = await page(ctx, script);
    if (last.stop) return last;
    if (last.value?.code === "RENDER_NOT_READY") return { stop: fail("RENDER_NOT_READY", last.value, "编辑标签还没有布局") };
    if (ready(last.value)) return last;
    await sleep(300);
  }
  return last;
}

function popupOpenScript() {
  return (
    "(() => {" +
    "function visible(el) {" +
    "if (!el || !el.isConnected) return false;" +
    "const r = el.getBoundingClientRect();" +
    "const st = getComputedStyle(el);" +
    "if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;" +
    "return r.width > 0 && r.height > 0;" +
    "}" +
    "const open = Array.from(document.querySelectorAll('[class*=\"dropdown\"],[class*=\"popup\"],[class*=\"picker\"]'))" +
    ".some((el) => visible(el) && el.getAttribute('aria-hidden') !== 'true' && el.getBoundingClientRect().height > 20);" +
    "return JSON.stringify({ open });" +
    "})()"
  );
}

/** 点开一个下拉。上一层下拉收起来要时间，浮层还在淡出时会吃掉这一次点击，所以先等它收干净再点。 */
function markWidgetScript(index) {
  return (
    "(() => {" +
    "function visible(el) {" +
    "if (!el || !el.isConnected) return false;" +
    "const r = el.getBoundingClientRect();" +
    "const st = getComputedStyle(el);" +
    "if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;" +
    "return r.width > 0 && r.height > 0;" +
    "}" +
    "document.querySelectorAll('[data-sparo-widget]').forEach((el) => el.removeAttribute('data-sparo-widget'));" +
    "const sel = '.cheetah-select, .cheetah-picker, .byte-picker, .byte-select, .byte-timepicker';" +
    "const wrap = document.querySelector('.timepublish-wrap');" +
    "const inWrap = wrap ? Array.from(wrap.querySelectorAll(sel)).filter(visible) : [];" +
    "const all = inWrap.length ? inWrap : Array.from(document.querySelectorAll(sel)).filter(visible);" +
    "const widget = all[" + Number(index) + "];" +
    "if (!widget) return JSON.stringify({ ok: false, widgets: all.length });" +
    "widget.setAttribute('data-sparo-widget', '1');" +
    "const r = widget.getBoundingClientRect();" +
    "return JSON.stringify({ ok: true, widgets: all.length, text: (widget.innerText || '').trim(), rect: { w: Math.round(r.width), h: Math.round(r.height) } });" +
    "})()"
  );
}

function coverScript() {
  return (
    "(() => {" +
    "const el = document.querySelector('[data-sparo-widget=\"1\"]');" +
    "if (!el) return JSON.stringify({ missing: true });" +
    "const r = el.getBoundingClientRect();" +
    "const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);" +
    "return JSON.stringify({ top: top ? String(top.className).slice(0, 70) : '', covered: !!top && !el.contains(top) && top !== el });" +
    "})()"
  );
}

/** 点开一个下拉。用真实鼠标点（JS 合成事件在弹层刚出现时会被吞），点完确认真展开了，没展开就再点。 */
async function openWidget(ctx, index, label) {
  let last = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    // 等上一个浮层彻底消失，别点到正在淡出的遮罩上
    for (let settle = 0; settle < 10; settle++) {
      const p = await page(ctx, popupOpenScript());
      if (p.stop) return p.stop;
      if (!p.value?.open) break;
      await sleep(200);
    }
    const marked = await page(ctx, markWidgetScript(index));
    if (marked.stop) return marked.stop;
    if (!marked.value?.ok) return fail("SCHEDULE_CONTROLS_MISSING", marked.value, label + "找不到");
    const real = await click('[data-sparo-widget="1"]', ctx.tabId);
    if (!/"ok"\s*:\s*true/.test(String(real))) {
      // 真实点击落空时退回 JS 合成事件
      const fired = await page(ctx, clickWidgetScript(index));
      if (fired.stop) return fired.stop;
      last = fired.value;
    } else {
      last = marked.value;
    }
    const opened = await page(ctx, popupOpenScript());
    if (opened.stop) return opened.stop;
    if (opened.value?.open) return pass(last);
    const cover = await page(ctx, coverScript());
    last = { ...(last || {}), cover: cover.value || null };
    await sleep(600);
  }
  return fail("SCHEDULE_CONTROLS_MISSING", { index, last }, label + "点了三次都没展开下拉");
}

async function chooseWidget(ctx, index, text, date) {
  const opened = await openWidget(ctx, index, "定时控件");
  if (!opened.ok) return opened;
  const picked = await pickInPopup(ctx, text, date);
  if (picked.stop) return picked.stop;
  if (!picked.value?.ok) return fail("SCHEDULE_CONTROLS_MISSING", picked.value, "弹层里没有 " + text);
  return pass(picked.value);
}

/** 下拉是虚拟列表：目标项可能还没渲染，得先滚到顶部，再逐屏下滑边滑边找。 */
async function pickInPopup(ctx, text, date) {
  const fresh = await pollPage(ctx, pickPopupScript(text, date), (value) => value?.ok);
  if (fresh.stop || fresh.value?.ok) return fresh;
  if (!fresh.value?.popup) return fresh;
  let last = fresh;
  await page(ctx, scrollPopupScript(-1));
  for (let i = 0; i < 30; i++) {
    const again = await page(ctx, pickPopupScript(text, date));
    if (again.stop) return again;
    if (again.value?.ok) return again;
    last = again;
    if (!again.value?.popup) return again;
    const moved = await page(ctx, scrollPopupScript(0.8));
    if (!moved.value?.moved) break;
    await sleep(220);
  }
  return last;
}

async function chooseMinute(ctx, index, minute) {
  const opened = await openWidget(ctx, index, "分钟下拉");
  if (!opened.ok) return opened;
  return pollMinuteInOpenPopup(ctx, minute);
}

async function pollMinuteInOpenPopup(ctx, minute) {
  let last = null;
  // 下拉挂载要时间：先等列表出现，别把「还没渲染」当成「没有分钟」
  for (let i = 0; i < 12; i++) {
    const fresh = await page(ctx, pickMinuteScript(minute));
    if (fresh.stop) return fresh.stop;
    last = fresh.value;
    if (last?.ok) return pass(last);
    if (last?.reason !== "no minute list") break;
    await sleep(300);
  }
  if (last?.reason === "no minute list") {
    return fail("SCHEDULE_CONTROLS_MISSING", last, "弹层里没有分钟 " + minute);
  }
  // 目标可能还没渲染：先回顶，再逐屏下滑，每滑一次重新扫一遍
  const top = await page(ctx, scrollMinuteListScript(-1));
  if (top.stop) return top.stop;
  if (!top.value?.ok) return fail("SCHEDULE_CONTROLS_MISSING", top.value, "弹层里没有分钟 " + minute);
  for (let i = 0; i < 40; i++) {
    const again = await page(ctx, pickMinuteScript(minute));
    if (again.stop) return again.stop;
    if (again.value?.ok) return pass(again.value);
    last = again.value;
    const moved = await page(ctx, scrollMinuteListScript(0.6));
    if (moved.stop) return moved.stop;
    if (!moved.value?.moved) break;
    await sleep(200);
  }
  return fail("SCHEDULE_CONTROLS_MISSING", last, "弹层里没有分钟 " + minute);
}

export async function runSchedule(ctx) {
  const openScript =
    "(() => {" +
    "function fire(el) {" +
    "el.scrollIntoView({ block: 'center' });" +
    "const r = el.getBoundingClientRect();" +
    "const opt = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };" +
    "el.dispatchEvent(new PointerEvent('pointerdown', opt));" +
    "el.dispatchEvent(new MouseEvent('mousedown', opt));" +
    "el.dispatchEvent(new PointerEvent('pointerup', opt));" +
    "el.dispatchEvent(new MouseEvent('mouseup', opt));" +
    "el.click();" +
    "}" +
    "const els = Array.from(document.querySelectorAll('button,[role=\"button\"],div,span,a')).filter((el) => {" +
    "const t = (el.innerText || '').replace(/\\s+/g, '').trim();" +
    "if (t !== '定时发布') return false;" +
    "if (el.getBoundingClientRect().height <= 0) return false;" +
    "let p = el.parentElement;" +
    "while (p) { if (/modal|dialog/i.test(p.className || '')) return false; p = p.parentElement; }" +
    "return true;" +
    "});" +
    // 优先 fire BUTTON 元素（百家号页面上第一个匹配的是 DIV 容器，fire 它无效）
    "const btn = els.find(el => el.tagName === 'BUTTON') || els[0];" +
    "if (!btn) return JSON.stringify({ ok: false });" +
    "fire(btn);" +
    "return JSON.stringify({ ok: true, tag: btn.tagName });" +
    "})()";
  // 续跑时弹层可能已经开着：再点一次开弹层的按钮会把它关掉
  const existing = await page(
    ctx,
    "(() => {" +
      "const wrap = document.querySelector('.timepublish-wrap');" +
      "const r = wrap ? wrap.getBoundingClientRect() : null;" +
      "return JSON.stringify({ open: !!r && r.height > 8 });" +
      "})()",
  );
  if (existing.stop) return existing.stop;
  if (!existing.value?.open) {
    const opened = await page(ctx, openScript);
    if (opened.stop) return opened.stop;
    if (!opened.value?.ok) {
      const fallback = await clickLabeled(ctx, "定时发布");
      if (!fallback.ok && !fallback.fired && !fallback.detail?.fired) return fallback;
    }
  }
  const seen = await pollPage(ctx, scheduleScanScript(), (value) => Number(value?.widgets) >= 1);
  if (seen.stop) return seen.stop;
  if (!Number(seen.value?.widgets)) return fail("SCHEDULE_CONTROLS_MISSING", seen.value, "定时弹层没有出现");
  const date = ctx.schedule.date;
  const [hour, minute] = String(ctx.schedule.time || "").split(":");
  const day = String(Number(String(date).slice(8, 10)));
  const count = Number(seen.value.widgets);
  // 先读取当前值，只设置不正确的
  const current = await page(ctx, readScheduleScript());
  const curDate = current.value?.date || "";
  const curHour = current.value?.hour || "";
  const curMinute = current.value?.minute || "";
  // 日期：默认就是今天，如果已正确则跳过
  if (curDate !== date) {
    const dayPick = await chooseWidget(ctx, 0, day, date);
    if (!dayPick.ok) return dayPick;
    await sleep(600); // 选完日期后等弹层收起/重渲染
  }
  if (count >= 3) {
    if (curHour !== hour) {
      const hourPick = await chooseWidget(ctx, 1, hour, "");
      if (!hourPick.ok) return hourPick;
      await sleep(600);
    }
    if (curMinute !== minute) {
      const minutePick = await chooseMinute(ctx, 2, minute);
      if (!minutePick.ok) return minutePick;
    }
  } else {
    const hourPick = await pollPage(ctx, pickPopupScript(hour, ""), (value) => value?.ok);
    if (hourPick.stop) return hourPick.stop;
    if (!hourPick.value?.ok) return fail("SCHEDULE_CONTROLS_MISSING", { ...seen.value, step: "hour" }, "弹层里没有小时 " + hour);
    const minutePick = await pollMinuteInOpenPopup(ctx, minute);
    if (!minutePick.ok) return minutePick;
  }
  const read = await pollPage(ctx, readScheduleScript(), (value) => value?.date === date && value?.hour === hour && value?.minute === minute);
  if (read.stop) return read.stop;
  const got = { ...(read.value || {}) };
  if (!scheduleMatches(got, ctx.schedule)) {
    return fail("SCHEDULE_CONTROLS_MISSING", got, "定时控件没有回读到 " + ctx.schedule.text);
  }
  return pass(got);
}
export function confirmCoverScript(rootSelector) {
  return (
    "(() => {" +
    "function visible(el) {" +
    "if (!el || !el.isConnected) return false;" +
    "const r = el.getBoundingClientRect();" +
    "return r.width >= 8 && r.height >= 8;" +
    "}" +
    "function fire(el) {" +
    "const r = el.getBoundingClientRect();" +
    "const opt = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };" +
    "el.dispatchEvent(new PointerEvent('pointerdown', opt));" +
    "el.dispatchEvent(new MouseEvent('mousedown', opt));" +
    "el.dispatchEvent(new PointerEvent('pointerup', opt));" +
    "el.dispatchEvent(new MouseEvent('mouseup', opt));" +
    "el.click();" +
    "}" +
    "const root = document.querySelector(" + JSON.stringify(rootSelector) + ");" +
    "if (!root || !visible(root)) return JSON.stringify({ ok: false, code: 'NO_DIALOG' });" +
    "const thumbs = Array.from(root.querySelectorAll('img,.img-span')).filter((el) => visible(el) && (el.tagName === 'IMG' ? ((el.currentSrc || el.getAttribute('src') || '').length > 8) : (getComputedStyle(el).backgroundImage || '').includes('url(')));" +
    "if (!thumbs.length) return JSON.stringify({ ok: false, code: 'NO_THUMB' });" +
    "fire(thumbs[0]);" +
    "const confirm = Array.from(root.querySelectorAll('button,[role=\"button\"],span,a,div')).find((el) => visible(el) && (el.innerText || '').replace(/\\s+/g, '') === '确定');" +
    "if (!confirm) return JSON.stringify({ ok: false, code: 'NO_CONFIRM', thumbs: thumbs.length });" +
    "fire(confirm);" +
    "return JSON.stringify({ ok: true, thumbs: thumbs.length });" +
    "})()"
  );
}

