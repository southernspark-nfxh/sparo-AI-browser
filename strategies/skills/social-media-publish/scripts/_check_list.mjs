// 探针：百家号内容列表，看实际发布状态
import { page, sleep } from "./page.mjs";
import { nav } from "./sparo.mjs";

const ctx = { tabId: "2abf3f71", host: "baijiahao.baidu.com" };

// 先导航到列表
const moved = await nav("https://baijiahao.baidu.com/builder/rc/content", ctx.tabId);
console.log("nav result:", moved);
await sleep(2000);

// dump 列表前 15 条
const r = await page(ctx, `(() => {
  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.width > 0;
  }
  // 列表里的每一行
  const rows = Array.from(document.querySelectorAll('tr, [class*="list-item"], [class*="content-item"], [class*="article-row"]')).filter(visible).slice(0, 20);
  
  // 或者找包含标题的所有可点击元素
  const links = Array.from(document.querySelectorAll('a')).filter(visible).map(a => {
    const href = a.href || '';
    if (!/baijiahao\.baidu\.com\/s\?id=/.test(href)) return null;
    return { href, text: (a.innerText || '').trim().slice(0, 60) };
  }).filter(Boolean).slice(0, 15);
  
  // 也找所有带日期/状态文字的元素
  const statusEls = Array.from(document.querySelectorAll('span,div,td')).filter(el => {
    if (!visible(el)) return false;
    const t = (el.innerText || '').trim();
    return /已发布|审核中|定时|待发布|草稿|2026-11/.test(t) && t.length < 30;
  }).map(el => (el.innerText || '').trim()).slice(0, 20);
  
  return JSON.stringify({ href: location.href, links, statusEls });
})()`);

console.log("LIST:", JSON.stringify(r.value, null, 2));
