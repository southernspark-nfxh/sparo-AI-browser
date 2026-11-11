// 完整探针：打开弹层 → 点日期 → dump dropdown
import { page, sleep } from "./page.mjs";

const ctx = { tabId: "2abf3f71", host: "baijiahao.baidu.com" };

function fireScript(selectorHint, textFilter) {
  return `(() => {
    function fire(el) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const opt = { bubbles: true, cancelable: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2 };
      el.dispatchEvent(new PointerEvent('pointerdown', opt));
      el.dispatchEvent(new MouseEvent('mousedown', opt));
      el.dispatchEvent(new PointerEvent('pointerup', opt));
      el.dispatchEvent(new MouseEvent('mouseup', opt));
      el.click();
      return true;
    }
    const els = Array.from(document.querySelectorAll('button,[role="button"],div,span,a'));
    const el = els.find(el => {
      const t = (el.innerText || '').replace(/\s+/g, '').trim();
      return ${textFilter} && el.getBoundingClientRect().height > 0;
    });
    if (!el) return JSON.stringify({ ok: false, reason: 'not found', checked: els.slice(-5).map(e => (e.innerText||'').replace(/\s+/g,'').trim()) });
    return JSON.stringify({ ok: fire(el), cls: (el.className||'').toString().slice(0,80) });
  })()`;
}

// 1. 打开定时弹层
const openR = await page(ctx, fireScript("定时发布", "t === '定时发布'"));
console.log("1. 打开定时:", openR.value || openR);
await sleep(800);

// 2. 确认弹层打开（有 cheetah-modal）
const check = await page(ctx, `(() => {
  const modal = document.querySelector('.cheetah-modal-wrap, .cheetah-modal-mask, [class*="cheetah-modal"]');
  const selects = Array.from(document.querySelectorAll('.cheetah-select')).filter(el => el.getBoundingClientRect().height > 0);
  return JSON.stringify({ 
    modalFound: !!modal, 
    modalCls: modal ? (modal.className||'').toString().slice(0,100) : '',
    selectCount: selects.length,
    selectTexts: selects.map(s => (s.innerText||'').replace(/\s+/g,' '))
  });
})()`);
console.log("2. 弹层状态:", check.value);

// 3. 点第一个 cheetah-select（日期）的选择器部分
const clickDate = await page(ctx, `(() => {
  function fire(el) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const opt = { bubbles: true, cancelable: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2 };
    el.dispatchEvent(new PointerEvent('pointerdown', opt));
    el.dispatchEvent(new MouseEvent('mousedown', opt));
    el.dispatchEvent(new PointerEvent('pointerup', opt));
    el.dispatchEvent(new MouseEvent('mouseup', opt));
    el.click();
    return true;
  }
  // 点选择器本体（.cheetah-select-selector），不是整个 cheetah-select
  const selectors = Array.from(document.querySelectorAll('.cheetah-select-selector')).filter(el => {
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.width > 0;
  });
  if (!selectors[0]) return JSON.stringify({ ok: false });
  return JSON.stringify({ ok: fire(selectors[0]), text: (selectors[0].innerText||'').trim() });
})()`);
console.log("3. 点日期选择器:", clickDate.value);

await sleep(800);

// 4. 全面 dump — 看所有弹层/下拉
const r = await page(ctx, `(() => {
  function visible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    return true;
  }
  
  // 找 cheetah-modal 外层的子元素（排除 modal 自己的后代，找独立的 dropdown）
  // 实际：找 body 下直接的子元素里可能的下拉
  const bodyChildren = Array.from(document.body.children).filter(visible).map(el => ({
    tag: el.tagName,
    cls: (el.className||'').toString().slice(0,150),
    z: getComputedStyle(el).zIndex,
    h: Math.round(el.getBoundingClientRect().height),
    top: Math.round(el.getBoundingClientRect().top),
    text: (el.innerText||'').replace(/\s+/g,' ').slice(0,200)
  }));
  
  // 也找 cheetah-select-dropdown-menu 或 rc-virtual-list
  const lists = Array.from(document.querySelectorAll('.rc-virtual-list, [class*="select-menu"], [class*="-dropdown-menu"], [class*="-popup"]')).filter(visible).map(el => {
    const r = el.getBoundingClientRect();
    return {
      cls: (el.className||'').toString().slice(0, 200),
      text: (el.innerText||'').replace(/\s+/g,' ').slice(0, 400),
      tag: el.tagName,
      top: Math.round(r.top),
      h: Math.round(r.height),
      w: Math.round(r.width),
      z: getComputedStyle(el).zIndex
    };
  });
  
  return JSON.stringify({ bodyChildren, lists });
})()`);

console.log("\n4. Dump 结果:");
console.log(JSON.stringify(r.value, null, 2));
