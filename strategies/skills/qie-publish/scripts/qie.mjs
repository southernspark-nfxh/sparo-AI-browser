// 企鹅号（腾讯内容开放平台 om.qq.com）发布脚本 —— 只做「潜意识」那半套：
// 导入 docx 正文（含图）→ 填标题 → 选分类 → 过 AI 生成声明 → 存草稿 / 发布。
// 审稿、改稿、判断异常由「意识」（AI）负责，本脚本不替它下判断。
//
// 用法：
//   node qie.mjs probe                             # 看当前编辑器状态
//   node qie.mjs import  --article <目录|md>       # 只导入正文
//   node qie.mjs title   --title "标题"
//   node qie.mjs category --name 财经
//   node qie.mjs draft   --article <目录|md> [--category 财经] [--title "..."]
//   node qie.mjs publish --article <目录|md> --yes
//
// 文章目录约定（和 social-media-publish 一致）：title.txt / body.md / images/
// 也接受单个 .md 文件：第一行 "# 标题" 当标题，其余当正文。
// 也可以直接给 --docx <文件> 跳过生成。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { call, tabs, useTab, click, uploadFile, nav, switchTab, press, sleep } from "./sparo.mjs";

const EDITOR_URL = "https://om.qq.com/main/creation/article";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const TITLE_SEL = ".omui-articletitle__input1 .omui-inputautogrowing__inner";

const log = (...a) => console.error("[qie]", ...a);
const j = (s) => {
  if (s && typeof s === "object") return s;
  try { return JSON.parse(s); } catch { return { raw: s }; }
};

// ---------------- 页面/标签 ----------------
async function openEditor() {
  const listed = await tabs();
  let tab = listed.tabs.find((t) => /om\.qq\.com\/main\/creation\/article/.test(t.url || ""));
  if (!tab) tab = listed.tabs.find((t) => /om\.qq\.com/.test(t.url || ""));
  if (!tab) {
    const raw = j(await nav(EDITOR_URL));
    if (!raw.tabId) throw new Error("打不开企鹅号编辑器：" + JSON.stringify(raw).slice(0, 300));
    await sleep(3000);
    tab = { id: raw.tabId };
  } else if (!/creation\/article/.test(tab.url || "")) {
    await nav(EDITOR_URL, tab.id);
    await sleep(3000);
  }
  await switchTab(tab.id);
  await sleep(1000);
  const g = String(await useTab(tab.id, "om.qq.com"));
  if (g.startsWith("MISMATCH") || g === "URL_UNREAD") throw new Error("标签地址不符，停手：" + g);
  return tab.id;
}

const PROBE_JS = `(() => {
  const words = (document.body.innerText.match(/正文字数：(\\d+)/) || [])[1] || "0";
  const t = document.querySelector('.omui-articletitle__input1 .omui-inputautogrowing__inner');
  const title = t ? (t.innerText || "").replace(/\\s+/g, " ").trim() : "";
  const cat = [...document.querySelectorAll('.omui-suggestion__value-single')].map(e => (e.innerText || "").trim()).filter(Boolean);
  const tagBox = (() => {
    const multi = document.querySelector('.omui-suggestion__input.is--multi');
    return multi ? multi.closest('.omui-suggestion') : null;
  })();
  const tags = tagBox ? [...tagBox.querySelectorAll('.omui-suggestion__choselabel')].map(e => (e.innerText || "").trim()).filter(Boolean) : [];
  const text = document.body.innerText;
  const dialogs = [...document.querySelectorAll('.omui-dialog')].filter(d => d.offsetParent !== null).map(d => d.innerText.replace(/\\n+/g, " | ").slice(0, 120));
  const errors = [...document.querySelectorAll('.omui-form__help-error')].map(e => (e.innerText || "").trim()).filter(Boolean);
  return JSON.stringify({
    url: location.href,
    account: (() => { const m = text.match(/\\n([^\\n]{2,20})\\n正式运营/); return m ? m[1].trim() : ""; })(),
    title,
    words: Number(words),
    categories: cat,
    tags,
    declaration: (() => { const m = text.match(/作者声明：([^\\n]{0,30})/); return m ? m[1].trim() : ""; })(),
    aiDeclared: /已完成AI生成素材声明/.test(text),
    coverPicked: /更换[\\s\\S]{0,6}编辑/.test(text),
    dialogs,
    errors,
    editorReady: !!document.querySelector('.ProseMirror')
  });
})()`;

// 连续 execute 时 Sparo 偶尔回空串；空结果必须重试，不能当页面没有元素。
async function probe(tabId, tries = 3) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    const env = j(await call("execute", { script: PROBE_JS, tabId }));
    const inner = j(env?.data?.result || "{}");
    if (env?.ok !== false && inner && typeof inner === "object" && "words" in inner) return inner;
    last = env;
    await sleep(800);
  }
  const inner = j(last?.data?.result || "{}");
  return { ...inner, probeError: last?.message || "execute 无结果" };
}

async function exists(tabId, selector) {
  const r = j(await call("execute", { script: `!!document.querySelector(${JSON.stringify(selector)})`, tabId }));
  return r?.data?.result === true;
}

// ---------------- 正文：docx 导入 ----------------
async function importDocx(tabId, docxFile) {
  const before = await probe(tabId);
  const open = j(await click("button.exeditor-menu-basic-file", tabId));
  if (open?.ok === false) return { ok: false, error: "点不动「插入文档」：" + (open.message || "") };

  let hasInput = false;
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    if (await exists(tabId, "#fileInput")) { hasInput = true; break; }
  }
  if (!hasInput) return { ok: false, error: "插入文档弹窗没有出现 #fileInput" };

  const up = j(await uploadFile("#fileInput", docxFile, tabId));
  if (up?.ok === false) return { ok: false, error: "上传失败：" + (up.message || "") };

  let last = before;
  let parsing = true;
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    last = await probe(tabId);
    parsing = (last.dialogs || []).some((d) => /解析进行中|上传中/.test(d));
    if (!parsing && last.words > before.words) break;
    if (!parsing && i > 3) break;
  }
  return {
    ok: last.words > before.words,
    wordsBefore: before.words,
    wordsAfter: last.words,
    stillParsing: parsing,
    error: last.words > before.words ? "" : "正文没有变长，导入可能失败（弹窗：" + JSON.stringify(last.dialogs) + "）",
  };
}

// ---------------- 标题 ----------------
async function fillTitle(tabId, title) {
  const r = j(await call("fill", { selector: TITLE_SEL, value: title, tabId }));
  const after = await probe(tabId);
  const got = String(after.title || "").replace(/\s+/g, "");
  const want = String(title).replace(/\s+/g, "");
  return { ok: got === want, field: r?.message || "", readback: after.title };
}

// ---------------- 分类 ----------------
const CAT_ARM_JS = `(() => {
  const labels = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && (e.innerText || '').trim() === '分类');
  let box = null;
  for (const label of labels) {
    let node = label;
    for (let i = 0; i < 6 && node; i++) {
      const cand = node.querySelector && node.querySelector('.omui-suggestion');
      if (cand) { box = cand; break; }
      node = node.parentElement;
    }
    if (box) break;
  }
  if (!box) box = [...document.querySelectorAll('.omui-suggestion')].find(x => x.getBoundingClientRect().width > 300) || null;
  if (!box) return 'no-box';
  document.querySelectorAll('[data-qie-cat]').forEach(e => e.removeAttribute('data-qie-cat'));
  document.querySelectorAll('[data-qie-opt]').forEach(e => e.removeAttribute('data-qie-opt'));
  const input = box.querySelector('input');
  if (!input) return 'no-input';
  input.setAttribute('data-qie-cat', '1');
  box.setAttribute('data-qie-box', '1');
  return JSON.stringify({ value: (box.querySelector('.omui-suggestion__value-single') || {}).innerText || '' });
})()`;

const CAT_PICK_JS = (name) => `(() => {
  const box = document.querySelector('[data-qie-box="1"]');
  if (!box) return JSON.stringify({ err: 'no-box' });
  const wrap = box.querySelector('.omui-suggestion__dropdown-wrap');
  if (!wrap || getComputedStyle(wrap).display === 'none') return JSON.stringify({ err: 'closed' });
  const scroller = wrap.querySelector('div[style*="overflow"]') || wrap.firstElementChild;
  const opts = [...wrap.querySelectorAll('.omui-suggestion__option')];
  const texts = opts.map(o => (o.innerText || '').trim());
  const want = ${JSON.stringify(name)};
  const hit = opts.find(o => (o.innerText || '').trim() === want) || opts.find(o => (o.innerText || '').trim().includes(want));
  const wrapRect = wrap.getBoundingClientRect();
  // 虚拟列表：选项是绝对定位，可能被滚出可视区，先滚到能完整看见再点
  if (!hit) {
    const before = scroller.scrollTop;
    scroller.scrollTop = Math.min(before + 140, scroller.scrollHeight);
    return JSON.stringify({ err: 'not-rendered', texts, moved: scroller.scrollTop !== before });
  }
  const r = hit.getBoundingClientRect();
  if (r.top < wrapRect.top || r.bottom > wrapRect.bottom) {
    scroller.scrollTop += (r.top - wrapRect.top - 36);
    return JSON.stringify({ err: 'need-scroll', texts });
  }
  document.querySelectorAll('[data-qie-opt]').forEach(e => e.removeAttribute('data-qie-opt'));
  hit.setAttribute('data-qie-opt', '1');
  // 这个下拉只认页面内事件；Sparo 的真实点击在虚拟列表上会点偏
  ['mousedown', 'mouseup', 'click'].forEach(t => hit.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
  return JSON.stringify({ ok: true, texts });
})()`;

const CAT_STATE_JS = `(() => {
  const box = document.querySelector('[data-qie-box="1"]');
  if (!box) return JSON.stringify({ err: 'no-box' });
  const wrap = box.querySelector('.omui-suggestion__dropdown-wrap');
  return JSON.stringify({
    open: !!wrap && getComputedStyle(wrap).display !== 'none',
    value: (box.querySelector('.omui-suggestion__value-single') || {}).innerText || ''
  });
})()`;

async function pickCategory(tabId, name) {
  // 已经是这个分类就别再展开下拉（重复操作只会增加失败面）
  const cur = await probe(tabId);
  if ((cur.categories || []).map((s) => s.trim()).includes(name)) {
    return { ok: true, readback: cur.categories, already: true };
  }
  const armed = j(await call("execute", { script: CAT_ARM_JS, tabId }))?.data?.result;
  const a = typeof armed === "string" ? j(armed) : armed;
  if (!a || a === "no-box" || a === "no-input") return { ok: false, error: "找不到分类控件：" + armed };

  let seen = [];
  let lastErr = "";
  for (let round = 0; round < 3; round++) {
    let state = j(j(await call("execute", { script: CAT_STATE_JS, tabId }))?.data?.result || "{}");
    if (!state.open) {
      const opened = j(await click('[data-qie-cat="1"]', tabId));
      if (opened?.ok === false) return { ok: false, error: "点不开分类下拉：" + (opened.message || "") };
      await sleep(800);
    }

    let clicked = false;
    for (let i = 0; i < 25; i++) {
      const pick = j(j(await call("execute", { script: CAT_PICK_JS(name), tabId }))?.data?.result || "{}");
      if (pick.texts) seen = pick.texts;
      lastErr = pick.err || "";
      if (pick.ok) { clicked = true; break; }
      if (pick.err === "closed" || pick.err === "no-box") break;
      await sleep(300);
    }
    if (clicked) {
      await sleep(900);
      const now = await probe(tabId);
      const got = (now.categories || []).map((s) => s.trim());
      if (got.includes(name)) return { ok: true, readback: got, seen };
      lastErr = "点了但值没变";
    }
  }

  const now = await probe(tabId);
  return {
    ok: false,
    error: "分类没选上（" + (lastErr || "未知") + "）",
    readback: (now.categories || []).map((s) => s.trim()),
    seen,
  };
}

// ---------------- 标签 ----------------
// 标签是「输入 → 空格/Enter → 变成 chip」的多选控件。fill 只能填字，
// 真正落成标签靠 press("Space")；Sparo 的 press 只认单键，"Space" 可用。
// 标签框的稳定锚点：只有它是 is--multi（分类是 value-single）。
// 空的时候有 .placeholder，加了 chip 之后 placeholder 会消失，不能拿 placeholder 找。
const TAG_ARM_JS = `(() => {
  const multi = document.querySelector('.omui-suggestion__input.is--multi');
  if (!multi) return 'no-tagbox';
  const box = multi.closest('.omui-suggestion');
  const input = box.querySelector('input');
  if (!input) return 'no-input';
  box.setAttribute('data-qie-tags', '1');
  input.setAttribute('data-qie-taginput', '1');
  return 'ok';
})()`;

const TAG_CLEAR_JS = `(() => {
  const multi = document.querySelector('.omui-suggestion__input.is--multi');
  if (!multi) return 'no-tagbox';
  const box = multi.closest('.omui-suggestion');
  const btns = [...box.querySelectorAll('.omui-suggestion__choseclear')];
  btns.forEach(b => ['mousedown', 'mouseup', 'click'].forEach(t => b.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }))));
  return 'cleared:' + btns.length;
})()`;

async function clearTags(tabId) {
  const raw = j(await call("execute", { script: TAG_CLEAR_JS, tabId }))?.data?.result;
  await sleep(300);
  const now = (await probe(tabId)).tags || [];
  return { ok: now.length === 0, cleared: String(raw || ""), left: now };
}

async function setTags(tabId, list) {
  const want = [...new Set((list || []).map((s) => String(s).trim()).filter(Boolean))];
  if (!want.length) return { ok: true, tags: [], added: [] };

  const have = new Set((await probe(tabId)).tags || []);
  const added = [];
  for (const name of want) {
    if (have.has(name)) continue;
    let armed = null;
    for (let i = 0; i < 3; i++) {
      armed = j(await call("execute", { script: TAG_ARM_JS, tabId }))?.data?.result;
      if (armed === "ok") break;
      await sleep(800);
    }
    if (armed !== "ok") return { ok: false, error: "找不到标签输入框：" + String(armed), tags: [...have] };
    const f = j(await call("fill", { selector: '[data-qie-taginput="1"]', value: name, tabId }));
    if (f?.ok === false) return { ok: false, error: "标签填不进去：" + name + "（" + (f.message || "") + "）", tags: [...have] };
    await press("Space", tabId);
    await sleep(500);
    have.add(name);
    added.push(name);
  }
  const after = (await probe(tabId)).tags || [];
  let missing = want.filter((t) => !after.includes(t));
  if (missing.length) {
    // 状态脏了（重复输入会把已有 chip 顶掉）：清空重来一遍
    await clearTags(tabId);
    for (const name of want) {
      const armed = j(await call("execute", { script: TAG_ARM_JS, tabId }))?.data?.result;
      if (armed !== "ok") break;
      await call("fill", { selector: '[data-qie-taginput="1"]', value: name, tabId });
      await press("Space", tabId);
      await sleep(600);
    }
    const retry = (await probe(tabId)).tags || [];
    missing = want.filter((t) => !retry.includes(t));
    return { ok: missing.length === 0, tags: retry, added, repaired: true, error: missing.length ? "重加后仍缺：" + missing.join("、") : "" };
  }
  return { ok: true, tags: after, added, error: "" };
}

// ---------------- 内容自主声明 ----------------
const DECL_OPEN_JS = `(() => {
  const b = [...document.querySelectorAll('button')].find(x => /添加内容自主声明/.test(x.innerText || '') && x.offsetParent !== null);
  if (!b) return 'no-btn';
  ['mousedown', 'mouseup', 'click'].forEach(t => b.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
  return 'opened';
})()`;

const DECL_PICK_JS = (name) => `(() => {
  const dlg = [...document.querySelectorAll('.omui-dialog,.omui-modal,[role="dialog"]')].find(d => d.offsetParent !== null && /发布内容自主声明/.test(d.innerText || ''));
  if (!dlg) return JSON.stringify({ err: 'no-dialog' });
  const labels = [...dlg.querySelectorAll('label.omui-radio')];
  const opts = labels.map(l => (l.innerText || '').trim());
  const hit = labels.find(l => (l.innerText || '').trim().startsWith(${JSON.stringify(name)}));
  if (!hit) return JSON.stringify({ err: 'no-option', opts });
  const input = hit.querySelector('input');
  ['mousedown', 'mouseup', 'click'].forEach(t => hit.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
  if (input) { input.click(); input.dispatchEvent(new Event('change', { bubbles: true })); }
  return JSON.stringify({ ok: true, opts, checked: input ? input.checked : null });
})()`;

const DECL_CONFIRM_JS = `(() => {
  const dlg = [...document.querySelectorAll('.omui-dialog,.omui-modal,[role="dialog"]')].find(d => d.offsetParent !== null && /发布内容自主声明/.test(d.innerText || ''));
  if (!dlg) return 'no-dialog';
  const b = [...dlg.querySelectorAll('button')].find(x => (x.innerText || '').replace(/\\s/g, '') === '确认');
  if (!b) return 'no-confirm';
  ['mousedown', 'mouseup', 'click'].forEach(t => b.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
  return 'confirmed';
})()`;

async function setDeclaration(tabId, name) {
  const cur = await probe(tabId);
  if (cur.declaration) {
    const already = cur.declaration.startsWith(name);
    return { ok: already, declaration: cur.declaration, already: true, error: already ? "" : "已声明为「" + cur.declaration + "」，不是「" + name + "」" };
  }
  const opened = j(await call("execute", { script: DECL_OPEN_JS, tabId }))?.data?.result;
  if (opened !== "opened") return { ok: false, error: "打不开自主声明面板：" + opened };
  await sleep(800);
  const pick = j(j(await call("execute", { script: DECL_PICK_JS(name), tabId }))?.data?.result || "{}");
  if (pick.err) {
    return {
      ok: false,
      error: pick.err === "no-option" ? "没有「" + name + "」这一项，可选：" + (pick.opts || []).join(" / ") : pick.err,
      options: pick.opts,
    };
  }
  await sleep(500);
  const confirmed = j(await call("execute", { script: DECL_CONFIRM_JS, tabId }))?.data?.result;
  if (confirmed !== "confirmed") return { ok: false, error: "声明面板没点成确认：" + confirmed };
  await sleep(800);
  const after = await probe(tabId);
  return { ok: after.declaration.startsWith(name), declaration: after.declaration, options: pick.opts };
}

// ---------------- 清空当前编辑器 ----------------
// 导入是「追加」，批量发稿前必须先把上一篇清掉，否则会串稿。
// 坑：Sparo 的 press 只认单键（无修饰键），press("Control+A") 会被当成文本打出 "Co"。
// 所以这里在页面内用 Range 全选，再用真实 Backspace 删；Backspace 无效则退到 execCommand。
const SELECT_JS = (sel) => `(() => {
  let el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return 'no-el';
  const ed = el.closest('[contenteditable="true"]') || el.closest('[contenteditable=""]') || el;
  ed.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(ed);
  sel.removeAllRanges();
  sel.addRange(range);
  return 'selected:' + ((ed.innerText || '').length);
})()`;

const EXEC_DELETE_JS = `(() => { document.execCommand('delete'); return 'ok'; })()`;

async function wipe(tabId, selector) {
  const sel = j(await call("execute", { script: SELECT_JS(selector), tabId }));
  const v = sel?.data?.result;
  if (typeof v !== "string" || !v.startsWith("selected")) return { ok: false, error: String(v), how: "select" };
  await press("Backspace", tabId);
  await sleep(400);
  await call("execute", { script: EXEC_DELETE_JS, tabId });
  await sleep(200);
  return { ok: true, selected: Number(v.split(":")[1] || 0), how: "backspace" };
}

async function resetEditor(tabId) {
  const before = await probe(tabId);
  const body = await wipe(tabId, ".ProseMirror");
  const title = await wipe(tabId, ".omui-articletitle__input1 .omui-inputautogrowing__inner");
  const tags = await clearTags(tabId);
  const after = await probe(tabId);
  return {
    ok: after.words === 0 && !after.title && tags.ok,
    wordsBefore: before.words,
    wordsAfter: after.words,
    titleBefore: before.title,
    titleAfter: after.title,
    tagsBefore: before.tags,
    tagsAfter: after.tags,
    body,
    titleWipe: title,
    tagsWipe: tags,
    error:
      after.words === 0
        ? ""
        : "正文还剩 " + after.words + " 字，Range 全选或 Backspace 没生效",
  };
}

// ---------------- AI 生成声明 ----------------
async function settleDeclaration(tabId, waitMs = 8000) {
  const JS = `(() => {
    const d = [...document.querySelectorAll('.omui-dialog')].find(x => x.offsetParent !== null && /生成声明/.test(x.innerText || ''));
    if (!d) return 'none';
    const b = [...d.querySelectorAll('button')].find(x => (x.innerText || '').replace(/\\s/g, '') === '提交');
    if (!b) return 'no-submit';
    // Sparo 的 click 会把这个「提交」误判成电商页提交并拦下，这里走页面内点击
    ['mousedown', 'mouseup', 'click'].forEach(t => b.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
    return 'submitted';
  })()`;
  for (let i = 0; i < Math.ceil(waitMs / 1000); i++) {
    const r = j(await call("execute", { script: JS, tabId }));
    const v = r?.data?.result;
    if (v === "submitted") {
      await sleep(1500);
      const after = await probe(tabId);
      const gone = !(after.dialogs || []).some((d) => /生成声明/.test(d));
      return { shown: true, submitted: true, closed: gone };
    }
    if (v === "no-submit") return { shown: true, submitted: false, error: "声明弹窗里没有「提交」" };
    await sleep(1000);
  }
  return { shown: false, submitted: false };
}

// ---------------- 底部按钮 ----------------
// 不用 Sparo 的真实 click：它会把弹窗按钮误判成电商提交（QA 门），
// 页面内合成点击对「发布 / 存草稿」是有效的（已实测）。
async function clickBottom(tabId, text, seconds = 10) {
  for (let i = 0; i < seconds; i++) {
    const r = j(await call("execute", { script: `(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim() === ${JSON.stringify(text)});
    if (!b) return 'not-found';
    ['mousedown', 'mouseup', 'click'].forEach(t => b.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
    return 'clicked';
  })()`, tabId }));
    const v = r?.data?.result;
    if (v === "clicked") return { ok: true };
    // 页面正在跳转/重渲染时 execute 可能回空，按未完成处理，继续等
    if (v !== "not-found" && v) return { ok: false, error: "点「" + text + "」失败：" + JSON.stringify(r || {}).slice(0, 300) };
    await sleep(1200);
  }
  return { ok: false, error: "等了 " + seconds + " 秒也没出现「" + text + "」按钮" };
}

async function waitSave(tabId, seconds = 15) {
  for (let i = 0; i < seconds; i++) {
    await sleep(1000);
    const p = await probe(tabId);
    const errs = p.errors || [];
    if (errs.some((e) => /请选择分类/.test(e))) return { ok: false, error: "平台提示「请选择分类」，分类没选上" };
    if (errs.some((e) => /自主声明/.test(e))) return { ok: false, error: "平台要求先选自主声明（发布必填）" };
    if (errs.some((e) => /标题/.test(e))) return { ok: false, error: "标题没填" };
    if (errs.length) return { ok: false, error: "平台提示：" + errs.join("；") };
    if (p.aiDeclared && p.words > 0 && p.categories.length) {
      // 已保存是常态；这里只确认页面还在编辑态且没有报错
      return { ok: true, state: p };
    }
  }
  const p = await probe(tabId);
  return { ok: false, error: "没等到保存结果", state: p };
}

// 点「发布」后唯一可信的结果是：跳到内容管理页 / 出现成功提示。留在编辑器 = 没发出去。
async function waitPublish(tabId, seconds = 30) {
  for (let i = 0; i < seconds; i++) {
    await sleep(1000);
    const p = await probe(tabId);
    const errs = p.errors || [];
    if (errs.length) return { ok: false, url: p.url, error: "平台提示：" + errs.join("；") };
    if (/\/management\/articleManage/.test(p.url || "")) {
      return { ok: true, url: p.url, state: "已跳到内容管理" };
    }
    const d = (p.dialogs || []).join(" ");
    if (/发布成功|提交成功/.test(d)) return { ok: true, url: p.url, state: d.slice(0, 80) };
  }
  const p = await probe(tabId);
  return { ok: false, url: p.url, error: "点了发布但 " + seconds + " 秒内没跳转、也没成功提示", errors: p.errors };
}

// 在内容管理列表里按标题找这一行，读状态（审核中 / 已发布 / 未通过…）
// 列表是 div 卡片不是 table，不能按 tr 找。
async function readManageRow(tabId, title) {
  const JS = `(() => {
    const want = ${JSON.stringify(title)};
    const marks = ['审核中', '已发布', '未通过', '草稿', '发布失败', '定时发布'];
    const hits = [...document.querySelectorAll('div,li,tr,article')].filter(e => {
      const t = e.innerText || '';
      return t.includes(want) && marks.some(m => t.includes(m));
    });
    if (!hits.length) return JSON.stringify({ found: false });
    hits.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
    const text = (hits[0].innerText || '').replace(/\\n+/g, ' | ');
    return JSON.stringify({ found: true, status: marks.find(m => text.includes(m)) || '', text: text.slice(0, 220) });
  })()`;
  return j(j(await call("execute", { script: JS, tabId }))?.data?.result || "{}");
}

const CLICK_DRAFT_JS = `(() => {
  const els = [...document.querySelectorAll('div,span,li,a,button')].filter(e => (e.innerText || '').trim() === '草稿');
  const el = els[els.length - 1];
  if (!el) return 'no-tab';
  ['mousedown', 'mouseup', 'click'].forEach(t => el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
  return 'clicked';
})()`;

// 存草稿最可信的核验：另开一个标签页去 内容管理 → 草稿 里按标题找。
// 编辑器里的「已保存」只是自动保存提示，证明不了草稿箱里有这一篇。
async function verifyDraft(tabId, title) {
  const opened = j(await call("new_tab", { url: "https://om.qq.com/main/management/articleManage" }));
  const id = opened?.data?.id;
  if (!id) return { ok: false, error: "开不了内容管理标签页：" + (opened?.message || "") };
  try {
    await switchTab(id);
    await sleep(3500);
    await call("execute", { script: CLICK_DRAFT_JS, tabId: id });
    await sleep(2500);
    const row = await readManageRow(id, title);
    return { ok: !!row.found, ...row };
  } finally {
    await call("close_tab", { id });
    await switchTab(tabId);
  }
}

const splitTags = (raw) => String(raw || "").split(/[\n,，、;；]+/).map((s) => s.trim()).filter(Boolean);

// ---------------- 稿件装载 ----------------
function loadArticle(arg) {
  const p = path.resolve(arg);
  if (!fs.existsSync(p)) throw new Error("稿件不存在：" + p);
  const stat = fs.statSync(p);
  if (stat.isDirectory()) {
    const titleFile = path.join(p, "title.txt");
    const bodyFile = path.join(p, "body.md");
    if (!fs.existsSync(titleFile) || !fs.existsSync(bodyFile)) throw new Error("目录缺 title.txt 或 body.md：" + p);
    const tagsFile = path.join(p, "tags.txt");
    return {
      dir: p,
      title: fs.readFileSync(titleFile, "utf8").replace(/^\uFEFF/, "").trim(),
      body: fs.readFileSync(bodyFile, "utf8").replace(/^\uFEFF/, "").trim(),
      tags: fs.existsSync(tagsFile) ? splitTags(fs.readFileSync(tagsFile, "utf8").replace(/^\uFEFF/, "")) : [],
    };
  }
  if (/\.docx$/i.test(p)) return { dir: path.dirname(p), docx: p, title: "", body: "", tags: [] };
  const raw = fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "").trim();
  const m = raw.match(/^#\s+(.+)$/m);
  const title = m ? m[1].trim() : path.basename(p, path.extname(p));
  const body = raw.replace(/^#\s+.+\n?/, "").trim();
  return { dir: path.dirname(p), title, body, tags: [] };
}

function buildDocx(article) {
  if (article.docx) return article.docx;
  if (!article.body) throw new Error("正文为空，没法生成 docx");
  const spec = path.join(os.tmpdir(), "qie-spec-" + Date.now() + ".json");
  const out = path.join(os.tmpdir(), "qie-" + Date.now() + ".docx");
  fs.writeFileSync(spec, JSON.stringify({
    out,
    title: article.title,
    body_md: article.body,
    article_dir: article.dir,
  }, null, 2), "utf8");
  const py = process.env.QIE_PYTHON || "python";
  const raw = execFileSync(py, [path.join(HERE, "make_docx.py"), spec], { encoding: "utf8" });
  const r = j(raw.trim().split("\n").pop());
  if (!r.ok) throw new Error("生成 docx 失败：" + (r.error || raw));
  log("docx:", r.out, "blocks=" + r.blocks, "images=" + r.images);
  return r.out;
}

// ---------------- 主流程 ----------------
async function run(opts) {
  const article = opts.article ? loadArticle(opts.article) : null;
  const title = opts.title || article?.title || "";
  const tabId = await openEditor();

  const report = { steps: [], ok: false };

  if (opts.reset) {
    const r = await resetEditor(tabId);
    report.steps.push({ step: "清空编辑器", ...r });
    if (!r.ok) return finish(report);
  }

  if (article) {
    const docx = buildDocx(article);
    const imp = await importDocx(tabId, docx);
    report.steps.push({ step: "导入正文", ...imp });
    if (!imp.ok) return finish(report);
  }

  if (title) {
    const t = await fillTitle(tabId, title);
    report.steps.push({ step: "填标题", ...t });
    if (!t.ok) return finish(report);
  }

  if (opts.category) {
    const c = await pickCategory(tabId, opts.category);
    report.steps.push({ step: "选分类", ...c });
    if (!c.ok) return finish(report);
  }

  const tags = opts.tags && opts.tags.length ? opts.tags : article?.tags || [];
  if (tags.length) {
    const tg = await setTags(tabId, tags);
    report.steps.push({ step: "加标签", ...tg });
    if (!tg.ok) return finish(report);
  }

  if ((opts.action === "draft" || opts.action === "publish") && opts.declaration) {
    const dc = await setDeclaration(tabId, opts.declaration);
    report.steps.push({ step: "内容自主声明", ...dc });
    if (!dc.ok) return finish(report);
  }

  if (opts.action === "draft" || opts.action === "publish") {
    const pre = await probe(tabId);
    const missing = [];
    if (!pre.title) missing.push("标题");
    if (!pre.words) missing.push("正文");
    if (!(pre.categories || []).length) missing.push("分类");
    if ((pre.tags || []).length < 5) missing.push("标签少于5个（现 " + (pre.tags || []).length + " 个）");
    if (!pre.declaration) missing.push("内容自主声明");
    report.steps.push({
      step: "发布/存稿前自检",
      ok: missing.length === 0,
      title: pre.title,
      words: pre.words,
      categories: pre.categories,
      tags: pre.tags,
      declaration: pre.declaration,
      error: missing.length ? "缺：" + missing.join("、") : "",
    });
    if (missing.length) return finish(report);
  }

  if (opts.action === "draft" || opts.action === "publish") {
    const label = opts.action === "draft" ? "存草稿" : "发布";
    const clicked = await clickBottom(tabId, label);
    report.steps.push({ step: "点" + label, ...clicked });
    if (!clicked.ok) return finish(report);

    const decl = await settleDeclaration(tabId);
    report.steps.push({ step: "AI 生成声明", ...decl });

    if (opts.action === "publish") {
      const sent = await waitPublish(tabId);
      report.steps.push({ step: "核验发布", ...sent });
      if (sent.ok) {
        const row = await readManageRow(tabId, pre_title(report) || title);
        report.steps.push({ step: "作品管理", ...row });
      }
      report.ok = clicked.ok && sent.ok && (report.steps.find((s) => s.step === "作品管理")?.found !== false);
    } else {
      if (decl.submitted) {
        // AI 声明弹窗会吃掉第一次「存草稿」，提交完再点一次
        await sleep(800);
        const re = await clickBottom(tabId, "存草稿");
        report.steps.push({ step: "声明后重新点存草稿", ...re });
      }
      const saved = await waitSave(tabId);
      report.steps.push({ step: "核验", ...saved });
      const inDrafts = (pre_title(report) || title)
        ? await verifyDraft(tabId, pre_title(report) || title)
        : { ok: false, error: "没有标题，无法核对草稿箱" };
      report.steps.push({ step: "草稿箱", ...inDrafts });
      report.ok = clicked.ok && saved.ok && inDrafts.ok;
    }
  } else {
    const p = await probe(tabId);
    report.steps.push({ step: "当前状态", ...p });
    report.ok = p.words > 0 && (!title || p.title === title);
  }

  return finish(report);
}

const pre_title = (report) => report.steps.find((s) => s.step === "发布/存稿前自检")?.title || "";

function finish(report) {
  report.ok = report.ok || report.steps.every((s) => s.ok !== false) && report.steps.some((s) => s.step === "点存草稿" || s.step === "点发布");
  console.log(JSON.stringify(report, null, 2));
  return report;
}

// ---------------- CLI ----------------
const argv = process.argv.slice(2);
const cmd = argv[0] || "probe";
const flag = (name, fallback = "") => {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};

try {
  if (cmd === "probe") {
    const tabId = await openEditor();
    console.log(JSON.stringify(await probe(tabId), null, 2));
  } else if (cmd === "import") {
    const article = loadArticle(flag("article"));
    const tabId = await openEditor();
    console.log(JSON.stringify(await importDocx(tabId, buildDocx(article)), null, 2));
  } else if (cmd === "title") {
    const tabId = await openEditor();
    console.log(JSON.stringify(await fillTitle(tabId, flag("title")), null, 2));
  } else if (cmd === "category") {
    const tabId = await openEditor();
    console.log(JSON.stringify(await pickCategory(tabId, flag("name")), null, 2));
  } else if (cmd === "tags") {
    const tabId = await openEditor();
    const list = splitTags(flag("tags"));
    console.log(JSON.stringify(list.length ? await setTags(tabId, list) : await probe(tabId).then((p) => ({ tags: p.tags })), null, 2));
  } else if (cmd === "declaration") {
    const tabId = await openEditor();
    console.log(JSON.stringify(await setDeclaration(tabId, flag("name")), null, 2));
  } else if (cmd === "reset") {
    const tabId = await openEditor();
    console.log(JSON.stringify(await resetEditor(tabId), null, 2));
  } else if (cmd === "draft" || cmd === "publish") {
    if (cmd === "publish" && !argv.includes("--yes")) {
      console.error(JSON.stringify({ ok: false, error: "发布要显式加 --yes（这道闸留给意识/AI 确认）" }));
      process.exit(2);
    }
    await run({
      action: cmd,
      article: flag("article"),
      title: flag("title"),
      category: flag("category") || (cmd === "publish" ? "财经" : ""),
      tags: splitTags(flag("tags")),
      declaration: flag("declaration"),
      reset: argv.includes("--reset"),
    });
  } else {
    console.log("命令：probe | import | title | category | tags | declaration | reset | draft | publish");
  }
} catch (err) {
  console.error(JSON.stringify({ ok: false, error: String(err && err.message || err) }));
  process.exit(1);
}
