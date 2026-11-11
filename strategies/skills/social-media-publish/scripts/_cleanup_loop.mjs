// 彻底关弹层循环
import { page, sleep } from "./page.mjs";
const ctx = { tabId: "2abf3f71", host: "baijiahao.baidu.com" };

for (let i = 0; i < 5; i++) {
  const r = await page(ctx, `(() => {
    // 关 cheetah-modal close 按钮（点按钮内的 x icon）
    const closes = Array.from(document.querySelectorAll('.cheetah-modal-close')).filter(el => {
      const r = el.getBoundingClientRect();
      return r.height > 0 && r.width > 0;
    });
    // 点 cheetah-modal-mask（遮罩）也能关
    const masks = Array.from(document.querySelectorAll('.cheetah-modal-mask')).filter(el => {
      const r = el.getBoundingClientRect();
      return r.height > 0 && r.width > 0;
    });
    closes.forEach(c => { try { c.click(); } catch(e) {} });
    masks.forEach(m => { try { m.click(); } catch(e) {} });
    
    const visibleModals = Array.from(document.querySelectorAll('.cheetah-modal-wrap')).filter(el => {
      const r = el.getBoundingClientRect();
      return r.height > 0 && r.width > 0;
    }).length;
    const visibleSelects = Array.from(document.querySelectorAll('.cheetah-select')).filter(el => {
      const r = el.getBoundingClientRect();
      return r.height > 0 && r.width > 0;
    }).length;
    return JSON.stringify({ i: ${i}, closedClose: closes.length, closedMask: masks.length, remainingModal: visibleModals, remainingSelect: visibleSelects });
  })()`);
  console.log(r.value);
  await sleep(300);
}
