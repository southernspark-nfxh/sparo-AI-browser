import { tabs, call } from "./sparo.mjs";

const listed = await tabs();
const tab = (listed.tabs || []).find((t) => /baijiahao\.baidu\.com/.test(t.url || ""));
if (!tab) {
  console.log("NO_EDITOR_TAB");
  process.exit(0);
}
const script =
  "(() => {" +
  "const mod = document.querySelector('.cheetah-ui-pro-image-modal');" +
  "const sel = '.cheetah-ui-pro-image-modal .cheetah-modal-footer button.cheetah-btn-primary';" +
  "const hit = document.querySelector(sel);" +
  "const foot = document.querySelector('.cheetah-ui-pro-image-modal .cheetah-modal-footer');" +
  "const r = hit ? hit.getBoundingClientRect() : null;" +
  "const top = r ? document.elementFromPoint(r.left + r.width/2, r.top + r.height/2) : null;" +
  "return JSON.stringify({" +
  "modal: !!mod, modalText: ((mod && mod.innerText) || '').replace(/\\s+/g,' ').slice(0,120)," +
  "foot: foot ? (foot.innerText||'').replace(/\\s+/g,'|') : ''," +
  "footHtml: foot ? foot.innerHTML.slice(0,500) : ''," +
  "hit: !!hit, hitText: hit ? (hit.innerText||'') : ''," +
  "rect: r ? { l: r.left, t: r.top, w: r.width, h: r.height } : null," +
  "topCls: top ? String(top.className).slice(0,80) : ''," +
  "topIsBtn: top === hit," +
  "imgs: document.querySelectorAll('#ueditor_0') ? 0 : -1" +
  "});" +
  "})()";
const raw = await call("execute", { script, tabId: tab.id });
console.log(String(raw).slice(0, 3000));
