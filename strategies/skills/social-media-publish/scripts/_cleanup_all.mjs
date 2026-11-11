// 彻底清理所有 cheetah-modal
import { page } from "./page.mjs";
const ctx = { tabId: "2abf3f71", host: "baijiahao.baidu.com" };
const r = await page(ctx, `(() => {
  // 点所有 .cheetah-modal-close 按钮
  const closes = Array.from(document.querySelectorAll('.cheetah-modal-close'));
  closes.forEach(c => { try { c.click(); } catch(e) {} });
  // 也点弹层里的"取消"按钮
  const cancels = Array.from(document.querySelectorAll('button,div,span')).filter(el => {
    const t = (el.innerText||'').replace(/\s+/g,'').trim();
    return t === '取消' && el.getBoundingClientRect().height > 0;
  });
  cancels.forEach(c => { try { c.click(); } catch(e) {} });
  // 最后点 mask 也可以关
  const masks = Array.from(document.querySelectorAll('.cheetah-modal-mask'));
  masks.forEach(m => { try { m.click(); } catch(e) {} });
  
  const remaining = document.querySelectorAll('[class*="cheetah-modal"]').length;
  return JSON.stringify({ closed: closes.length + cancels.length, remaining });
})()`);
console.log(r.value);
