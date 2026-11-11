import { page, sleep } from "./page.mjs";
import { call } from "./sparo.mjs";

const tabId = "2abf3f71";

// 点"待发布" tab
const clickR = await call("click_text", { text: "待发布", tabId });
console.log("click 待发布:", clickR?.slice(0, 200));
await sleep(2000);

// dump
const r = await call("execute", { script: `(() => {
  function visible(el) { const r = el.getBoundingClientRect(); return r.height > 0 && r.width > 0; }
  const bodyText = document.body ? document.body.innerText.slice(0, 8000) : '';
  const links = [];
  document.querySelectorAll('a').forEach(a => {
    const href = a.href || '';
    if (href.indexOf('baijiahao.baidu.com/s?id=') >= 0 && visible(a)) {
      const text = (a.innerText || '').trim().slice(0, 80);
      if (text) links.push({ href: href.slice(href.length - 20), text });
    }
  });
  return JSON.stringify({ href: location.href, bodyStart: bodyText.slice(0, 3000), linkCount: links.length, links: links.slice(0, 10) });
})()`, tabId });

const parsed = JSON.parse(r);
console.log("\n=== 待发布 tab ===");
console.log(parsed.data?.result || parsed.message || JSON.stringify(parsed).slice(0, 500));
