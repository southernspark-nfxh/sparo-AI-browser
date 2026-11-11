import { tabs, call } from "./sparo.mjs";

const listed = await tabs();
const tab = (listed.tabs || []).find((t) => /baijiahao\.baidu\.com\/builder\/rc\/edit/.test(t.url || ""));
if (!tab) { console.log("NO_EDITOR_TAB"); process.exit(0); }

const script =
  "(() => {" +
  "function info(el){" +
  "const r=el.getBoundingClientRect(); const cs=getComputedStyle(el);" +
  "return { cls:String(el.className).slice(0,70), rect:{l:Math.round(r.left),t:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)}, display:cs.display, visibility:cs.visibility, opacity:cs.opacity, z:cs.zIndex, text:(el.innerText||'').replace(/\\s+/g,' ').slice(0,60) };" +
  "}" +
  "const wraps = Array.from(document.querySelectorAll('.cheetah-modal-wrap')).map(info);" +
  "const closes = Array.from(document.querySelectorAll('.cheetah-modal-close')).map(info);" +
  "const coverImgs = Array.from(document.querySelectorAll('img')).filter(i => /cover/i.test(i.className||'') && i.naturalWidth>0).map(i => ({ w:i.naturalWidth, h:i.naturalHeight, src:(i.getAttribute('src')||'').slice(0,50) }));" +
  "const btns = Array.from(document.querySelectorAll('button')).filter(b => /^(确定|取消|确认)$/.test((b.innerText||'').trim())).map(b => ({ text:b.innerText.trim(), disabled:b.disabled, ...info(b) }));" +
  "const mask = Array.from(document.querySelectorAll('.cheetah-modal-mask')).map(info);" +
  "return JSON.stringify({ wraps, closes, coverImgs, btns, mask });" +
  "})()";
const raw = await call("execute", { script, tabId: tab.id });
console.log(String(raw).slice(0, 6000));
