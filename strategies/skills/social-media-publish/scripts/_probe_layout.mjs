import { tabs, call } from "./sparo.mjs";

const listed = await tabs();
const tab = (listed.tabs || []).find((t) => /baijiahao\.baidu\.com/.test(t.url || ""));
if (!tab) { console.log("NO_EDITOR_TAB"); process.exit(0); }
const script =
  "(() => {" +
  "const doc = document.querySelector('#ueditor_0')?.contentDocument;" +
  "const body = doc ? doc.body : null;" +
  "const html = body ? body.innerHTML : '';" +
  "const q = (s) => body ? body.querySelectorAll(s).length : -1;" +
  "return JSON.stringify({" +
  "h2: q('h2'), h3: q('h3'), strong: q('strong'), em: q('em'), blockquote: q('blockquote'), li: q('li'), img: q('img')," +
  "leakHash: /(^|>)\\s*##?\\s/.test(html), leakStar: html.includes('**')," +
  "head: (body ? body.innerText : '').replace(/\\s+/g,' ').slice(0, 90)," +
  "placeholder: html.includes('@@IMG')" +
  "});" +
  "})()";
const raw = await call("execute", { script, tabId: tab.id });
console.log(String(raw).slice(0, 1200));
