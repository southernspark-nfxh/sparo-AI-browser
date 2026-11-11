// 看"待发布"tab
import { page, sleep, clickText } from "./page.mjs";

const ctx = { tabId: "2abf3f71", host: "baijiahao.baidu.com" };

// 点"待发布"
const clicked = await clickText(ctx, "待发布");
console.log("click 待发布:", clicked);
await sleep(2000);

// dump 列表
const r = await page(ctx, `(() => {
  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.width > 0;
  }
  const bodyText = document.body ? document.body.innerText.slice(0, 8000) : '';
  const links = [];
  document.querySelectorAll('a').forEach(a => {
    const href = a.href || '';
    if (href.indexOf('baijiahao.baidu.com/s?id=') >= 0 && visible(a)) {
      const text = (a.innerText || '').trim().slice(0, 80);
      if (text) links.push({ href: href.slice(0, 80), text });
    }
  });
  return JSON.stringify({ href: location.href, bodyStart: bodyText.slice(0, 2000), links });
})()`);

console.log("\n=== 待发布 ===");
console.log(r.value?.bodyStart || "no body text");
console.log("\nlinks:", JSON.stringify(r.value?.links?.slice(0, 10), null, 2));
