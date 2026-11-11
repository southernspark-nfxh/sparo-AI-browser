// 探针 v6 — 精准找对按钮
import { page, sleep } from "./page.mjs";

const ctx = { tabId: "2abf3f71", host: "baijiahao.baidu.com" };

// dump 所有"定时发布"按钮详情
const dump = await page(ctx, `(() => {
  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.width > 0;
  }
  const all = Array.from(document.querySelectorAll('button,[role="button"],div,span,a')).filter(el => {
    const t = (el.innerText||'').replace(/\s+/g,'').trim();
    return t === '定时发布' && visible(el);
  }).map(el => {
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName,
      top: Math.round(r.top),
      left: Math.round(r.left),
      h: Math.round(r.height),
      w: Math.round(r.width),
      cls: (el.className||'').toString().slice(0, 120),
      parent: (el.parentElement?.className||'').toString().slice(0, 80),
      grandParent: (el.parentElement?.parentElement?.className||'').toString().slice(0, 80),
      onclick: !!el.onclick,
      isInModal: !!el.closest('[class*="modal"]'),
      text: (el.innerText||'').replace(/\s+/g,' ').slice(0, 50)
    };
  });
  return JSON.stringify(all);
})()`);
console.log("ALL TIMING BUTTONS:", dump.value);

// 尝试点第一个 BUTTON 元素（tag === 'BUTTON'，且不在 modal 里）
const click = await page(ctx, `(() => {
  function fire(el) {
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const opt = { bubbles: true, cancelable: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2 };
    // 先试最完整的事件序列
    for (const ev of ['pointerdown','mousedown','pointerup','mouseup','click']) {
      el.dispatchEvent(new PointerEvent(ev, opt));
    }
    el.click();
    return true;
  }
  const buttons = Array.from(document.querySelectorAll('button')).filter(el => {
    const t = (el.innerText||'').replace(/\s+/g,'').trim();
    return t === '定时发布' && el.getBoundingClientRect().height > 0;
  });
  const btn = buttons.find(b => !b.closest('[class*="modal"]')) || buttons[0];
  if (!btn) return JSON.stringify({ ok: false, n: buttons.length });
  return JSON.stringify({ ok: fire(btn), text: (btn.innerText||'').trim() });
})()`);
console.log("CLICK BUTTON:", click.value);

await sleep(1500);

// dump modal
const modal = await page(ctx, `(() => {
  const modals = Array.from(document.querySelectorAll('[class*="cheetah-modal"]')).filter(el => {
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.width > 0;
  }).map(el => ({
    cls: (el.className||'').toString().slice(0,150),
    text: (el.innerText||'').replace(/\s+/g,' ').slice(0,200),
    tag: el.tagName,
    top: Math.round(el.getBoundingClientRect().top)
  }));
  const selects = Array.from(document.querySelectorAll('.cheetah-select')).filter(el => {
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.width > 0;
  }).map(el => ({
    text: (el.innerText||'').replace(/\s+/g,' ').slice(0,80),
    top: Math.round(el.getBoundingClientRect().top)
  }));
  return JSON.stringify({ modalCount: modals.length, modals, selectCount: selects.length, selects });
})()`);
console.log("AFTER CLICK:", modal.value);
