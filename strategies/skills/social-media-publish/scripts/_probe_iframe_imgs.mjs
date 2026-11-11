import { tabs, call } from "./sparo.mjs";

const listed = await tabs();
const tab = (listed.tabs || []).find((t) => /baijiahao\.baidu\.com/.test(t.url || ""));
if (!tab) { console.log("NO_EDITOR_TAB"); process.exit(0); }
const script =
  "(() => {" +
  "const iframe = document.querySelector('#ueditor_0');" +
  "const doc = iframe && iframe.contentDocument;" +
  "const imgs = Array.from(doc ? doc.querySelectorAll('img') : []);" +
  "const html = doc ? (doc.body ? doc.body.innerHTML : '') : '';" +
  "return JSON.stringify({ n: imgs.length, srcs: imgs.map(i => (i.getAttribute('src')||'').slice(0,80)), tail: html.slice(-600) });" +
  "})()";
const raw = await call("execute", { script, tabId: tab.id });
console.log(String(raw).slice(0, 4000));
