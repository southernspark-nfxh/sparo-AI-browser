import { tabs, call } from "./sparo.mjs";

const listed = await tabs();
const tab = (listed.tabs || []).find((t) => /baijiahao\.baidu\.com\/builder\/rc\/edit/.test(t.url || ""));
if (!tab) { console.log("NO_EDITOR_TAB"); process.exit(0); }

const script =
  "(() => {" +
  "const labels = Array.from(document.querySelectorAll('label')).map(l => (l.innerText||'').replace(/\\s+/g,'').slice(0,40)).filter(Boolean);" +
  "const aiLabels = labels.filter(t => /AI/i.test(t));" +
  "const body = (document.body.innerText||'').replace(/\\s+/g,' ');" +
  "const idx = body.indexOf('AI');" +
  "const ctxText = idx >= 0 ? body.slice(Math.max(0, idx-40), idx+80) : '';" +
  "const publishBtn = Array.from(document.querySelectorAll('button')).filter(b => /发布/.test((b.innerText||'').trim())).map(b => ({ text: b.innerText.trim().slice(0,10), disabled: b.disabled, w: Math.round(b.getBoundingClientRect().width) }));" +
  "return JSON.stringify({ aiLabels: aiLabels.slice(0,10), ctxText, publishBtn, title: (document.querySelector('[data-lexical-editor=\"true\"]')?.innerText||'').slice(0,40) });" +
  "})()";
const raw = await call("execute", { script, tabId: tab.id });
console.log(String(raw).slice(0, 3000));
