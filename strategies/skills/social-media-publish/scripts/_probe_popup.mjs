// 临时探针：dump 百家号定时弹层 DOM
import { connect, call } from "./sparo.mjs";

const tabId = "2abf3f71";
const client = await connect();

// 1. 先点"定时发布"按钮
const openBtn = `(() => {
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
  const el = els.find((el) => {
    const t = (el.innerText || '').replace(/\s+/g, '').trim();
    return t === '定时发布' && el.getBoundingClientRect().height > 0;
  });
  if (!el) return JSON.stringify({ ok: false, reason: 'btn not found' });
  fire(el);
  return JSON.stringify({ ok: true });
})()`;

const r1 = await call(client, "exec", { script: openBtn, tabId });
console.log("openBtn:", JSON.stringify(r1, null, 2));

await new Promise(r => setTimeout(r, 800));

// 2. dump 页面上所有可能的弹层容器
const dumpAll = `(() => {
  function visible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    return true;
  }
  
  // 所有带 popup/dropdown/modal/picker 的
  const selectors = '[class*="dropdown"],[class*="popup"],[class*="picker"],[class*="modal"],[class*="popover"],[class*="select-menu"],[class*="rc-virtual-list"]';
  const all = Array.from(document.querySelectorAll(selectors)).filter(visible);
  
  const out = all.map((el, i) => {
    const cls = (el.className || '').toString().slice(0, 100);
    const text = (el.innerText || '').replace(/\\s+/g, ' ').slice(0, 200);
    const rect = el.getBoundingClientRect();
    return { i, cls, text, h: Math.round(rect.height), w: Math.round(rect.width), top: Math.round(rect.top), z: getComputedStyle(el).zIndex };
  });
  
  // 也找 cheetah-select widget（定时弹层里的那三个选择器）
  const selects = Array.from(document.querySelectorAll('.cheetah-select')).filter(visible).map((el, i) => {
    const input = el.querySelector('input');
    return { i, val: input?.value || '', text: (el.innerText || '').slice(0, 80), cls: (el.className || '').toString().slice(0, 80) };
  });
  
  return JSON.stringify({ out, selects, innerHeight: window.innerHeight });
})()`;

const r2 = await call(client, "exec", { script: dumpAll, tabId });
console.log("\n=== DUMP ===");
console.log(r2.result || r2.error || JSON.stringify(r2));

// 3. 尝试点第一个 .cheetah-select（日期），看弹层
await new Promise(r => setTimeout(r, 500));

const clickDateWidget = `(() => {
  function fire(el) {
    const r = el.getBoundingClientRect();
    const opt = { bubbles: true, cancelable: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2 };
    el.dispatchEvent(new PointerEvent('pointerdown', opt));
    el.dispatchEvent(new MouseEvent('mousedown', opt));
    el.dispatchEvent(new PointerEvent('pointerup', opt));
    el.dispatchEvent(new MouseEvent('mouseup', opt));
    el.click();
  }
  const widgets = Array.from(document.querySelectorAll('.cheetah-select')).filter(el => el.getBoundingClientRect().height > 0);
  if (!widgets[0]) return JSON.stringify({ ok: false, n: widgets.length });
  fire(widgets[0]);
  return JSON.stringify({ ok: true, n: widgets.length });
})()`;

const r3 = await call(client, "exec", { script: clickDateWidget, tabId });
console.log("\nclick date widget:", JSON.stringify(r3));

await new Promise(r => setTimeout(r, 800));

// 4. 再 dump 弹层
const dumpAfterClick = `(() => {
  function visible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    return true;
  }
  const selectors = '[class*="dropdown"],[class*="popup"],[class*="picker"],[class*="modal"],[class*="popover"],[class*="select-menu"],[class*="rc-virtual-list"]';
  const all = Array.from(document.querySelectorAll(selectors)).filter(visible);
  const out = all.map((el, i) => {
    const cls = (el.className || '').toString().slice(0, 120);
    const text = (el.innerText || '').replace(/\s+/g, ' ').slice(0, 300);
    const rect = el.getBoundingClientRect();
    return { i, cls, text, h: Math.round(rect.height), top: Math.round(rect.top), z: getComputedStyle(el).zIndex };
  });
  return JSON.stringify({ count: all.length, out });
})()`;

const r4 = await call(client, "exec", { script: dumpAfterClick, tabId });
console.log("\n=== AFTER CLICK DATE WIDGET ===");
console.log(r4.result || r4.error || JSON.stringify(r4));
