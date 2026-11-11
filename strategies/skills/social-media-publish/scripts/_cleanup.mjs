// 清理弹层
import { page } from "./page.mjs";
const ctx = { tabId: "2abf3f71", host: "baijiahao.baidu.com" };
const r = await page(ctx, `(() => {
  // 关 cheetah-modal close 按钮或点取消
  const close = document.querySelector('.cheetah-modal-close');
  if (close) { close.click(); return JSON.stringify({ closed: true, by: 'close' }); }
  const btns = Array.from(document.querySelectorAll('button,div,span')).filter(el => {
    const t = (el.innerText||'').replace(/\s+/g,'').trim();
    return t === '取消' && el.getBoundingClientRect().height > 0;
  });
  btns[0]?.click();
  return JSON.stringify({ closed: btns.length > 0, by: 'cancel', n: btns.length });
})()`);
console.log("CLEANUP:", r.value);
