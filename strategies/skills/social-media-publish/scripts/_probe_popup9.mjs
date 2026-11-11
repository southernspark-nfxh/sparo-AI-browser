// 探针 v9 — 看弹层里 cheetah-select 的内部结构
import { page, sleep } from "./page.mjs";
import { call } from "./sparo.mjs";

const ctx = { tabId: "2abf3f71", host: "baijiahao.baidu.com" };

// 1. 先点 BUTTON "定时发布" 打开弹层
const open = await page(ctx, `(() => {
  function fire(el) {
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const opt = { bubbles: true, cancelable: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2 };
    for (const ev of ['pointerdown','mousedown','pointerup','mouseup','click']) {
      el.dispatchEvent(new PointerEvent(ev, opt));
    }
    el.click();
    return true;
  }
  const els = Array.from(document.querySelectorAll('button,[role="button"],div,span,a')).filter(el => {
    const t = (el.innerText||'').replace(/\s+/g,'').trim();
    if (t !== '定时发布') return false;
    if (el.getBoundingClientRect().height <= 0) return false;
    let p = el.parentElement;
    while (p) { if (/modal|dialog/i.test(p.className||'')) return false; p = p.parentElement; }
    return true;
  });
  const btn = els.find(el => el.tagName === 'BUTTON') || els[0];
  if (!btn) return JSON.stringify({ ok: false });
  return JSON.stringify({ ok: fire(btn), tag: btn.tagName });
})()`);
console.log("OPEN:", open.value);
await sleep(1200);

// 2. dump 弹层里每个 cheetah-select 的内部
const dump = await page(ctx, `(() => {
  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.width > 0;
  }
  const selects = Array.from(document.querySelectorAll('.cheetah-select')).filter(visible);
  const out = selects.map((sel, i) => {
    // dump 直接子元素
    const children = Array.from(sel.children).map(c => ({
      tag: c.tagName,
      cls: (c.className||'').toString().slice(0, 100),
      text: (c.innerText||'').replace(/\s+/g,' ').slice(0, 80)
    }));
    // 也找 selection-item, selector, arrow
    const item = sel.querySelector('.cheetah-select-selection-item');
    const selector = sel.querySelector('.cheetah-select-selector');
    const arrow = sel.querySelector('.cheetah-select-arrow');
    return {
      i,
      text: (sel.innerText||'').replace(/\s+/g,' ').slice(0, 80),
      hasSelectionItem: !!item,
      hasSelector: !!selector,
      hasArrow: !!arrow,
      itemCls: item ? (item.className||'').toString().slice(0,80) : null,
      childCount: children.length,
      children
    };
  });
  return JSON.stringify({ count: selects.length, selects: out });
})()`);
console.log("SELECTS:", JSON.stringify(dump.value, null, 2));

// 3. 尝试 fire 内部元素
if (dump.value?.selects?.[0]) {
  const tryFire = await page(ctx, `(() => {
    function fire(el) {
      const r = el.getBoundingClientRect();
      const opt = { bubbles: true, cancelable: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2 };
      for (const ev of ['pointerdown','mousedown','pointerup','mouseup','click']) {
        el.dispatchEvent(new PointerEvent(ev, opt));
      }
      el.click();
      return true;
    }
    const selects = Array.from(document.querySelectorAll('.cheetah-select')).filter(el => {
      const r = el.getBoundingClientRect();
      return r.height > 0 && r.width > 0;
    });
    const sel = selects[0];
    // 先试 selection-item
    const item = sel.querySelector('.cheetah-select-selection-item');
    if (item) return JSON.stringify({ fired: fire(item), target: 'selection-item' });
    const selector = sel.querySelector('.cheetah-select-selector');
    if (selector) return JSON.stringify({ fired: fire(selector), target: 'selector' });
    return JSON.stringify({ fired: fire(sel), target: 'whole' });
  })()`);
  console.log("FIRE:", tryFire.value);
  
  await sleep(800);
  
  // 4. dump dropdown 是否出现
  const checkDrop = await page(ctx, `(() => {
    function visible(el) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') return false;
      return true;
    }
    const drops = Array.from(document.querySelectorAll('[class*="dropdown"],[class*="popup"],[class*="-menu"],[class*="rc-virtual-list"]')).filter(visible);
    const real = drops.filter(el => !el.closest('.cheetah-modal'));
    return JSON.stringify({ total: drops.length, realCount: real.length, real: real.map(el => ({
      cls: (el.className||'').toString().slice(0,150),
      text: (el.innerText||'').replace(/\s+/g,' ').slice(0,200),
      top: Math.round(el.getBoundingClientRect().top),
      h: Math.round(el.getBoundingClientRect().height)
    })).slice(0,10) });
  })()`);
  console.log("DROPDOWN:", JSON.stringify(checkDrop.value, null, 2));
}
