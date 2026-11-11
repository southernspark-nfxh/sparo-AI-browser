// 精确探针：dump 日期下拉展开后的 DOM
import { page, sleep } from "./page.mjs";

const ctx = { tabId: "2abf3f71", host: "baijiahao.baidu.com" };

// 先关弹层重开，保持干净
await page(ctx, `(() => {
  const close = document.querySelector('.cheetah-modal-close');
  if (close) close.click();
  // 或者点"取消"
  const btns = Array.from(document.querySelectorAll('button,div,span')).filter(el => {
    const t = (el.innerText||'').replace(/\s+/g,'').trim();
    return t === '取消' && el.getBoundingClientRect().height > 0;
  });
  btns[0]?.click();
  return JSON.stringify({ closed: !!close, n: btns.length });
})()`);

await sleep(500);

// 重开定时弹层
await page(ctx, `(() => {
  function fire(el) {
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const opt = { bubbles: true, cancelable: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2 };
    el.dispatchEvent(new PointerEvent('pointerdown', opt));
    el.dispatchEvent(new MouseEvent('mousedown', opt));
    el.dispatchEvent(new PointerEvent('pointerup', opt));
    el.dispatchEvent(new MouseEvent('mouseup', opt));
    el.click();
  }
  const els = Array.from(document.querySelectorAll('button,[role="button"],div,span,a'));
  const el = els.find(el => {
    const t = (el.innerText || '').replace(/\s+/g, '').trim();
    return t === '定时发布' && el.getBoundingClientRect().top > 800 && el.getBoundingClientRect().height > 0;
  });
  if (!el) return JSON.stringify({ ok: false });
  fire(el);
  return JSON.stringify({ ok: true });
})()`);

await sleep(800);

// 1. 点日期 widget（cheetah-select[0]）
await page(ctx, `(() => {
  function fire(el) {
    const r = el.getBoundingClientRect();
    const opt = { bubbles: true, cancelable: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2 };
    el.dispatchEvent(new PointerEvent('pointerdown', opt));
    el.dispatchEvent(new MouseEvent('mousedown', opt));
    el.dispatchEvent(new PointerEvent('pointerup', opt));
    el.dispatchEvent(new MouseEvent('mouseup', opt));
    el.click();
  }
  const widgets = Array.from(document.querySelectorAll('.cheetah-select')).filter(el => {
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.width > 0;
  });
  if (!widgets[0]) return JSON.stringify({ ok: false, n: widgets.length });
  fire(widgets[0]);
  return JSON.stringify({ ok: true, n: widgets.length });
})()`);

await sleep(600);

// 2. 全面 dump — 所有 z-index > 1000 的可见元素
const r = await page(ctx, `(() => {
  function visible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    return true;
  }
  
  // 找到 z-index 高的弹层
  const all = Array.from(document.querySelectorAll('*')).filter(visible).map(el => {
    const z = parseInt(getComputedStyle(el).zIndex, 10);
    if (isNaN(z)) return null;
    return { z, el };
  }).filter(x => x && x.z >= 100).sort((a,b) => b.z - a.z);
  
  const results = [];
  const seen = new Set();
  for (const item of all) {
    if (seen.has(item.z)) continue;
    seen.add(item.z);
    const el = item.el;
    const cls = (el.className || '').toString().slice(0, 200);
    const text = (el.innerText || '').replace(/\s+/g, ' ').slice(0, 500);
    const rect = el.getBoundingClientRect();
    results.push({ z: item.z, tag: el.tagName, cls, text: text.slice(0, 300), top: Math.round(rect.top), h: Math.round(rect.height), w: Math.round(rect.width) });
    if (results.length > 20) break;
  }
  
  // 同时找 cheetah-select-dropdown-menu
  const dropdowns = Array.from(document.querySelectorAll('[class*="select-dropdown"],[class*="-menu"],[class*="menu-"],[class*="dropdown-"],[class*="popup-"]')).filter(visible).map(el => ({
    cls: (el.className||'').toString().slice(0, 200),
    text: (el.innerText||'').replace(/\s+/g,' ').slice(0, 200),
    tag: el.tagName,
    top: Math.round(el.getBoundingClientRect().top),
    h: Math.round(el.getBoundingClientRect().height)
  }));
  
  return JSON.stringify({ byZ: results, dropdowns });
})()`);

console.log(JSON.stringify(r.value, null, 2));
