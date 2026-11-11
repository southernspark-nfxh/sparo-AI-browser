// 探针 v7 — 在已打开弹层的基础上，点日期 widget 看 dropdown
import { page, sleep } from "./page.mjs";

const ctx = { tabId: "2abf3f71", host: "baijiahao.baidu.com" };

// 1. 点第一个 cheetah-select（日期）
const clickDate = await page(ctx, `(() => {
  function fire(el) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const opt = { bubbles: true, cancelable: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2 };
    for (const ev of ['pointerdown','mousedown','pointerup','mouseup','click']) {
      el.dispatchEvent(new PointerEvent(ev, opt));
    }
    el.click();
    return true;
  }
  const selects = Array.from(document.querySelectorAll('.cheetah-select')).filter(el => {
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.width > 0 && el.innerText.includes('月');
  });
  if (!selects[0]) return JSON.stringify({ ok: false, reason: 'date select not found' });
  return JSON.stringify({ ok: fire(selects[0]), text: (selects[0].innerText||'').replace(/\s+/g,'').trim() });
})()`);
console.log("CLICK DATE:", clickDate.value);

await sleep(800);

// 2. 全页面 dump — 找所有新出现的下拉
const dump = await page(ctx, `(() => {
  function visible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    return true;
  }
  
  // 所有 rc-virtual-list
  const vlists = Array.from(document.querySelectorAll('.rc-virtual-list')).filter(visible).map(el => {
    const r = el.getBoundingClientRect();
    const items = Array.from(el.querySelectorAll('[class*="select-item"], [class*="-item"]')).slice(0,12).map(it => (it.innerText||'').trim());
    return { cls: (el.className||'').toString().slice(0,100), top: Math.round(r.top), h: Math.round(r.height), items };
  });
  
  // 所有 body.children 里 z-index 较高的
  const zhigh = Array.from(document.body.children).filter(visible).map(el => {
    const z = getComputedStyle(el).zIndex;
    return { tag: el.tagName, cls: (el.className||'').toString().slice(0,150), z, top: Math.round(el.getBoundingClientRect().top), h: Math.round(el.getBoundingClientRect().height), text: (el.innerText||'').replace(/\s+/g,' ').slice(0,200) };
  }).filter(p => parseInt(p.z) > 100 || /modal|dropdown|popup|picker/i.test(p.cls));
  
  // 也搜 cheetah-select-dropdown-menu / cheetah-select-dropdown / ant-select-dropdown
  const ant = Array.from(document.querySelectorAll('[class*="dropdown-menu"],[class*="-select-dropdown"],[class*="select-dropdown"]')).filter(visible).map(el => ({
    cls: (el.className||'').toString().slice(0,150),
    text: (el.innerText||'').replace(/\s+/g,' ').slice(0,300),
    top: Math.round(el.getBoundingClientRect().top),
    h: Math.round(el.getBoundingClientRect().height),
    z: getComputedStyle(el).zIndex
  }));
  
  return JSON.stringify({ vlists, zhigh, ant });
})()`);

console.log("DUMP:", JSON.stringify(dump.value, null, 2));
