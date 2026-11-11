import { tabs, call, sleep } from "./sparo.mjs";

const listed = await tabs();
const tab = (listed.tabs || []).find((t) => /baijiahao\.baidu\.com\/builder\/rc\/edit/.test(t.url || ""));
if (!tab) { console.log("NO_EDITOR_TAB"); process.exit(0); }

const dump = "(() => {" +
  "const wrap = Array.from(document.querySelectorAll('.cheetah-modal-wrap')).find(m => m.getBoundingClientRect().height > 8);" +
  "if (!wrap) return JSON.stringify({ noModal: true });" +
  "const imgs = Array.from(wrap.querySelectorAll('img')).map((i, idx) => ({ idx, cls: String(i.className).slice(0, 40), w: i.naturalWidth, h: i.naturalHeight, rw: Math.round(i.getBoundingClientRect().width), src: (i.currentSrc || i.getAttribute('src') || '').slice(0, 70) }));" +
  "const inputs = Array.from(wrap.querySelectorAll('input[type=file]')).map(i => ({ accept: i.accept, cls: String(i.className).slice(0,40) }));" +
  "const confirm = Array.from(wrap.querySelectorAll('button')).find(b => /确定/.test((b.innerText||'').trim()));" +
  "return JSON.stringify({ imgs, inputs, confirmDisabled: confirm ? confirm.disabled : null, confirmCls: confirm ? String(confirm.className).slice(0,80) : '', text: (wrap.innerText||'').replace(/\\s+/g,' ').slice(0,140) });" +
  "})()";

const a = await call("execute", { script: dump, tabId: tab.id });
console.log("BEFORE:", String(a).slice(0, 3000));

// 点弹窗里最后一张图，看确定是否变可用
const pick = "(() => {" +
  "function fire(el){ el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect(); const o={bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2}; el.dispatchEvent(new PointerEvent('pointerdown',o)); el.dispatchEvent(new MouseEvent('mousedown',o)); el.dispatchEvent(new PointerEvent('pointerup',o)); el.dispatchEvent(new MouseEvent('mouseup',o)); el.click(); }" +
  "const wrap = Array.from(document.querySelectorAll('.cheetah-modal-wrap')).find(m => m.getBoundingClientRect().height > 8);" +
  "if (!wrap) return JSON.stringify({ noModal: true });" +
  "const imgs = Array.from(wrap.querySelectorAll('img')).filter(i => i.getBoundingClientRect().width > 20);" +
  "if (!imgs.length) return JSON.stringify({ noImg: true });" +
  "const thumb = imgs[imgs.length - 1];" +
  "fire(thumb);" +
  "return JSON.stringify({ picked: true, idx: imgs.length - 1, src: (thumb.currentSrc||thumb.getAttribute('src')||'').slice(0,60) });" +
  "})()";
const b = await call("execute", { script: pick, tabId: tab.id });
console.log("PICK:", String(b).slice(0, 800));
await sleep(1200);

const c = await call("execute", { script: dump, tabId: tab.id });
console.log("AFTER:", String(c).slice(0, 3000));
