// 探针 v2：百家号内容列表
import { page, sleep } from "./page.mjs";
import { nav } from "./sparo.mjs";

const ctx = { tabId: "2abf3f71", host: "baijiahao.baidu.com" };

await nav("https://baijiahao.baidu.com/builder/rc/content", ctx.tabId);
await sleep(2000);

const r = await page(ctx, `(() => {
  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.width > 0;
  }
  // 找公开链接
  const links = [];
  document.querySelectorAll('a').forEach(a => {
    const href = a.href || '';
    if (href.indexOf('baijiahao.baidu.com/s?id=') >= 0 && visible(a)) {
      links.push({ href, text: (a.innerText || '').trim().slice(0, 60) });
    }
  });
  
  // 找页面上所有可见文字里的状态关键词
  const bodyText = document.body ? document.body.innerText.slice(0, 5000) : '';
  const statusMatches = [];
  const patterns = ['已发布', '审核中', '定时', '待发布', '草稿'];
  for (const p of patterns) {
    const idx = bodyText.indexOf(p);
    if (idx >= 0) {
      statusMatches.push({ status: p, context: bodyText.slice(Math.max(0, idx-15), idx+30) });
    }
  }
  
  return JSON.stringify({ href: location.href, links, statusMatches });
})()`);

console.log("LIST:", JSON.stringify(r.value, null, 2));
