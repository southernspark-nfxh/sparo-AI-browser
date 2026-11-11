import { tabs, call, nav, sleep } from "./sparo.mjs";

const id = process.argv[2];
if (!id) { console.log("USAGE: _probe_published.mjs <articleId>"); process.exit(0); }

const listed = await tabs();
const tab = (listed.tabs || []).find((t) => /baijiahao\.baidu\.com/.test(t.url || ""));
if (!tab) { console.log("NO_TAB"); process.exit(0); }

const url = "https://baijiahao.baidu.com/builder/preview/s?id=" + id;
console.log("NAV", String(await nav(url, tab.id)).slice(0, 160));
await sleep(4000);

const script =
  "(() => {" +
  "const root = document.querySelector('article') || document.body;" +
  "const q = (s) => root.querySelectorAll(s).length;" +
  "const text = (root.innerText || '').replace(/\\s+/g, ' ');" +
  "return JSON.stringify({ href: location.href, h2: q('h2'), h3: q('h3'), strong: q('strong'), img: q('img'), li: q('li')," +
  "leakHash: /(^|\\s)##\\s/.test(text), leakStar: text.indexOf('**') >= 0," +
  "head: text.slice(0, 90), title: document.title.slice(0, 50) });" +
  "})()";
for (let i = 0; i < 6; i++) {
  const raw = await call("execute", { script, tabId: tab.id });
  const text = String(raw);
  if (/"h3":\s*\d/.test(text)) { console.log(text.slice(0, 1200)); break; }
  await sleep(1500);
  if (i === 5) console.log("TIMEOUT", text.slice(0, 400));
}
