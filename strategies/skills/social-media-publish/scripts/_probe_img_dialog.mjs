import { tabs, call, activeIdOf } from "./sparo.mjs";

const listed = await tabs();
const tab = (listed.tabs || []).find((t) => /baijiahao\.baidu\.com/.test(t.url || ""));
if (!tab) {
  console.log("NO_EDITOR_TAB", JSON.stringify(listed.tabs || []));
  process.exit(0);
}
const script =
  "(() => {" +
  "function vis(el){ if(!el||!el.isConnected) return false; const r=el.getBoundingClientRect(); return r.width>=6&&r.height>=6; }" +
  "const mods = Array.from(document.querySelectorAll('[class*=modal],[class*=dialog],[role=dialog],[class*=upload]')).filter(vis);" +
  "const rows = mods.map(m => ({ cls: (m.className||'').toString().slice(0,80), text: (m.innerText||'').replace(/\\s+/g,' ').slice(0,160) }));" +
  "const btns = Array.from(document.querySelectorAll('button,[role=button],a,span,div')).filter(vis).filter(el => { const t=(el.innerText||'').replace(/\\s+/g,''); return t && t.length<=8 && /确认|确定|取消|插入|完成/.test(t); }).map(el => ({ tag: el.tagName, cls: (el.className||'').toString().slice(0,60), text: (el.innerText||'').replace(/\\s+/g,'') }));" +
  "const files = Array.from(document.querySelectorAll('input[type=file]')).map(el => ({ accept: el.accept, cls: (el.className||'').toString().slice(0,40) }));" +
  "return JSON.stringify({ href: location.href, rows, btns: btns.slice(0, 30), files });" +
  "})()";
const raw = await call("execute", { script, tabId: tab.id });
console.log(String(raw).slice(0, 6000));
