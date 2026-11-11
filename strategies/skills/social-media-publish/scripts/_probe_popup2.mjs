// 临时探针：dump 百家号定时弹层 DOM
import { page, sleep } from "./page.mjs";

const ctx = { tabId: "2abf3f71", host: "baijiahao.baidu.com" };

// 0. 先 dump 当前页面有没有"定时发布"按钮
const checkBtn = `(() => {
  const els = Array.from(document.querySelectorAll('button,[role="button"],div,span,a'));
  const found = els.filter(el => {
    const t = (el.innerText || '').replace(/\s+/g, '').trim();
    return (t === '定时发布' || t === '确定' || t === '确认') && el.getBoundingClientRect().height > 0;
  }).slice(0, 10).map(el => {
    const t = (el.innerText || '').replace(/\s+/g, '').trim();
    const r = el.getBoundingClientRect();
    return { text: t, top: Math.round(r.top), h: Math.round(r.height), tag: el.tagName, cls: (el.className||'').toString().slice(0,60) };
  });
  return JSON.stringify({ href: location.href, found });
})()`;

const r0 = await page(ctx, checkBtn);
console.log("=== CHECK PAGE STATE ===");
console.log(r0.value || r0);

// 1. 点"定时发布"
await sleep(500);
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
  const el = els.find(el => {
    const t = (el.innerText || '').replace(/\s+/g, '').trim();
    return t === '定时发布' && el.getBoundingClientRect().height > 0;
  });
  if (!el) return JSON.stringify({ ok: false });
  fire(el);
  return JSON.stringify({ ok: true });
})()`;

const r1 = await page(ctx, openBtn);
console.log("\n=== OPEN TIMING ===");
console.log(r1.value || r1);

await sleep(1000);

// 2. dump 弹层
const dump = `(() => {
  function visible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    return true;
  }
  // 所有可能的弹层
  const popups = [];
  const allNodes = document.querySelectorAll('*');
  for (const el of allNodes) {
    if (!visible(el)) continue;
    const cls = (el.className || '').toString();
    if (/dropdown|popup|modal|popover|picker|select-menu|cheetah-modal|cheetah-select|rc-virtual-list/i.test(cls)) {
      const rect = el.getBoundingClientRect();
      const text = (el.innerText || '').replace(/\s+/g, ' ').slice(0, 300);
      popups.push({
        tag: el.tagName,
        cls: cls.slice(0, 150),
        text,
        top: Math.round(rect.top),
        h: Math.round(rect.height),
        w: Math.round(rect.width),
        z: getComputedStyle(el).zIndex,
      });
      if (popups.length > 30) break;
    }
  }
  // 定时弹层里的三个选择器
  const selects = Array.from(document.querySelectorAll('.cheetah-select, .cheetah-picker, .byte-picker')).filter(visible).map((el, i) => {
    const input = el.querySelector('input');
    return { i, inputVal: input?.value || '', text: (el.innerText || '').replace(/\s+/g,' ').slice(0, 80), cls: (el.className||'').toString().slice(0, 80) };
  });
  return JSON.stringify({ popupCount: popups.length, popups, selectCount: selects.length, selects });
})()`;

const r2 = await page(ctx, dump);
console.log("\n=== DUMP ALL ===");
if (r2.stop) console.log("STOP:", r2.stop);
else console.log(JSON.stringify(r2.value, null, 2));

// 3. 现在点第一个 cheetah-select（日期），再 dump
await sleep(500);
const clickFirstSelect = `(() => {
  function fire(el) {
    const r = el.getBoundingClientRect();
    const opt = { bubbles: true, cancelable: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2 };
    el.dispatchEvent(new PointerEvent('pointerdown', opt));
    el.dispatchEvent(new MouseEvent('mousedown', opt));
    el.dispatchEvent(new PointerEvent('pointerup', opt));
    el.dispatchEvent(new MouseEvent('mouseup', opt));
    el.click();
  }
  const widgets = Array.from(document.querySelectorAll('.cheetah-select, .cheetah-picker')).filter(el => {
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.width > 0;
  });
  if (!widgets[0]) return JSON.stringify({ ok: false, n: widgets.length });
  fire(widgets[0]);
  return JSON.stringify({ ok: true, n: widgets.length });
})()`;

const r3 = await page(ctx, clickFirstSelect);
console.log("\n=== CLICK FIRST SELECT ===");
console.log(r3.value || r3);

await sleep(800);

// 4. 再 dump 弹层，重点找日期选择器里的日子元素
const dumpDatePopup = `(() => {
  function visible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    return true;
  }
  
  // 找最靠上的弹层
  const nodes = Array.from(document.querySelectorAll('*')).filter(el => {
    if (!visible(el)) return false;
    const cls = (el.className || '').toString();
    return /dropdown|popup|modal|popover|picker|cheetah-modal|cheetah-select-menu/i.test(cls);
  });
  
  nodes.sort((a,b) => (Number(getComputedStyle(b).zIndex)||0) - (Number(getComputedStyle(a).zIndex)||0));
  const root = nodes[0];
  if (!root) return JSON.stringify({ ok: false, reason: 'no popup found' });
  
  // dump root 里所有有 text 的子元素
  const items = Array.from(root.querySelectorAll('td,li,div,span,button,a')).filter(visible).map(el => {
    const t = (el.innerText || '').replace(/\s+/g, ' ').slice(0, 50);
    const cls = (el.className || '').toString().slice(0, 80);
    return { text: t, cls };
  }).slice(0, 50);
  
  return JSON.stringify({ ok: true, rootCls: (root.className||'').toString().slice(0,100), items });
})()`;

const r4 = await page(ctx, dumpDatePopup);
console.log("\n=== DATE POPUP CONTENT ===");
if (r4.stop) console.log("STOP:", r4.stop);
else console.log(JSON.stringify(r4.value, null, 2));
