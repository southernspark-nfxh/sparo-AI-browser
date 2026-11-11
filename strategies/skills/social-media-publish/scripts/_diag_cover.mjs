import { tabs, call } from "./sparo.mjs";

const listed = await tabs();
const tab = (listed.tabs || []).find((t) => /baijiahao\.baidu\.com\/builder\/rc\/edit/.test(t.url || ""));
if (!tab) { console.log("NO_EDITOR_TAB"); process.exit(0); }

const script =
  "(() => {" +
  "function vis(el){ if(!el||!el.isConnected) return false; const r=el.getBoundingClientRect(); return r.width>8&&r.height>8; }" +
  "function d(el){ const r=el.getBoundingClientRect(); return { t: Math.round(r.top), l: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) }; }" +
  "const wraps = Array.from(document.querySelectorAll('.cheetah-modal-wrap')).filter(vis);" +
  "const out = wraps.map((w, wi) => ({" +
  "  wi, cls: String(w.className).slice(0,80), rect: d(w)," +
  "  text: (w.innerText||'').replace(/\\s+/g,' ').slice(0,120)," +
  "  buttons: Array.from(w.querySelectorAll('button')).filter(vis).map(b => ({ text: (b.innerText||'').trim(), disabled: b.disabled, rect: d(b), cls: String(b.className).slice(0,90) }))," +
  "  imgs: Array.from(w.querySelectorAll('img')).filter(vis).map((i, ii) => ({ ii, rect: d(i), src: (i.currentSrc||i.getAttribute('src')||'').slice(0,60), cls: String(i.className).slice(0,60) }))," +
  "  checkedNodes: Array.from(w.querySelectorAll('[class*=select],[class*=check],[class*=active]')).filter(vis).map(e => String(e.className).slice(0,70)).slice(0,10)" +
  "}));" +
  "return JSON.stringify({ count: wraps.length, wraps: out });" +
  "})()";
const raw = await call("execute", { script, tabId: tab.id });
console.log(String(raw).slice(0, 7000));
