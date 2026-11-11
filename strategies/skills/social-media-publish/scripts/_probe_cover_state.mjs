import { tabs, call } from "./sparo.mjs";

const listed = await tabs();
const tab = (listed.tabs || []).find((t) => /baijiahao\.baidu\.com\/builder\/rc\/edit/.test(t.url || ""));
if (!tab) { console.log("NO_EDITOR_TAB", JSON.stringify((listed.tabs || []).map(t => t.url))); process.exit(0); }

const script =
  "(() => {" +
  "function vis(el){ if(!el||!el.isConnected) return false; const r=el.getBoundingClientRect(); return r.width>8&&r.height>8; }" +
  "const mods = Array.from(document.querySelectorAll('[class*=modal],[class*=dialog],[role=dialog]')).filter(vis);" +
  "const modalTexts = mods.map(m => ({ cls: String(m.className).slice(0,60), text: (m.innerText||'').replace(/\\s+/g,' ').slice(0,70), z: getComputedStyle(m).zIndex }));" +
  "const masks = Array.from(document.querySelectorAll('[class*=mask],[class*=overlay]')).filter(vis).length;" +
  "const coverImgs = Array.from(document.querySelectorAll('img')).filter(i => /cover/i.test(i.className||'')).map(i => ({ cls: String(i.className).slice(0,50), w: i.naturalWidth, h: i.naturalHeight, src: (i.getAttribute('src')||'').slice(0,60) }));" +
  "const radios = Array.from(document.querySelectorAll('input[type=radio],label')).filter(vis).map(el => ({ tag: el.tagName, text: (el.innerText||el.value||'').replace(/\\s+/g,'').slice(0,12), checked: el.checked })).filter(r => /单图|三图|无图/.test(r.text));" +
  "return JSON.stringify({ modals: modalTexts, masks, coverImgs, radios, coverCount: coverImgs.length });" +
  "})()";
const raw = await call("execute", { script, tabId: tab.id });
console.log(String(raw).slice(0, 4000));
