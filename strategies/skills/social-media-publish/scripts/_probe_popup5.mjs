// 探针 v5 — 打开弹层后立刻 dump，不睡眠
import { page, sleep } from "./page.mjs";

const ctx = { tabId: "2abf3f71", host: "baijiahao.baidu.com" };

// 先确认页面状态
const init = await page(ctx, `(() => {
  const btns = Array.from(document.querySelectorAll('button,div,span'));
  const timing = btns.filter(el => {
    const t = (el.innerText||'').replace(/\s+/g,'').trim();
    return t === '定时发布' && el.getBoundingClientRect().height > 0;
  }).map(el => ({
    text: (el.innerText||'').replace(/\s+/g,'').trim(),
    top: Math.round(el.getBoundingClientRect().top),
    visible: el.getBoundingClientRect().top > 500
  }));
  return JSON.stringify({ href: location.href, timing });
})()`);
console.log("INIT:", init.value);

// 点可见的那个定时发布按钮
const open = await page(ctx, `(() => {
  function fire(el) {
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const opt = { bubbles: true, cancelable: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2 };
    el.dispatchEvent(new PointerEvent('pointerdown', opt));
    el.dispatchEvent(new MouseEvent('mousedown', opt));
    el.dispatchEvent(new PointerEvent('pointerup', opt));
    el.dispatchEvent(new MouseEvent('mouseup', opt));
    el.click();
    return true;
  }
  const els = Array.from(document.querySelectorAll('button,[role="button"],div,span,a'));
  // 找底部操作栏的那个（top > 500）
  const el = els.find(el => {
    const t = (el.innerText||'').replace(/\s+/g,'').trim();
    const r = el.getBoundingClientRect();
    return t === '定时发布' && r.top > 500 && r.height > 0;
  });
  if (!el) return JSON.stringify({ ok: false });
  return JSON.stringify({ ok: fire(el) });
})()`);
console.log("OPEN:", open.value);

await sleep(1000);

// 立刻 dump
const dump = await page(ctx, `(() => {
  function visible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    return true;
  }
  
  // 找 cheetah modal（定时弹层的三个选择器在里面）
  const modals = Array.from(document.querySelectorAll('[class*="cheetah-modal"]')).filter(visible).map(el => {
    return { cls: (el.className||'').toString().slice(0,120), text: (el.innerText||'').replace(/\s+/g,' ').slice(0,200), tag: el.tagName, top: Math.round(el.getBoundingClientRect().top), h: Math.round(el.getBoundingClientRect().height) };
  });
  
  const selects = Array.from(document.querySelectorAll('.cheetah-select')).filter(visible).map(el => {
    const r = el.getBoundingClientRect();
    return { text: (el.innerText||'').replace(/\s+/g,' ').slice(0,80), top: Math.round(r.top), h: Math.round(r.height) };
  });
  
  return JSON.stringify({ modalCount: modals.length, modals, selectCount: selects.length, selects });
})()`);
console.log("DUMP:", dump.value);

if (dump.value?.selectCount > 0) {
  // 有弹层了！现在点第一个 select
  const clickDate = await page(ctx, `(() => {
    function fire(el) {
      const r = el.getBoundingClientRect();
      const opt = { bubbles: true, cancelable: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2 };
      el.dispatchEvent(new PointerEvent('pointerdown', opt));
      el.dispatchEvent(new MouseEvent('mousedown', opt));
      el.dispatchEvent(new PointerEvent('pointerup', opt));
      el.dispatchEvent(new MouseEvent('mouseup', opt));
      el.click();
      return true;
    }
    const selects = Array.from(document.querySelectorAll('.cheetah-select-selector')).filter(el => {
      const r = el.getBoundingClientRect();
      return r.height > 0 && r.width > 0;
    });
    if (!selects[0]) return JSON.stringify({ ok: false });
    return JSON.stringify({ ok: fire(selects[0]), text: (selects[0].innerText||'').trim() });
  })()`);
  console.log("CLICK DATE:", clickDate.value);
  
  await sleep(800);
  
  // dump dropdown
  const afterClick = await page(ctx, `(() => {
    function visible(el) {
      if (!el || !el.isConnected) return false;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') return false;
      return true;
    }
    
    // 找所有 rc-virtual-list（百家号下拉用这个）
    const vlists = Array.from(document.querySelectorAll('.rc-virtual-list')).filter(visible).map(el => {
      const r = el.getBoundingClientRect();
      const items = Array.from(el.querySelectorAll('.cheetah-select-item, [class*="select-item"]')).slice(0,10).map(it => (it.innerText||'').trim());
      return { cls: (el.className||'').toString().slice(0,120), top: Math.round(r.top), h: Math.round(r.height), items };
    });
    
    // 找所有 z-index 高的 body children
    const popups = Array.from(document.body.children).filter(visible).map(el => ({
      tag: el.tagName,
      cls: (el.className||'').toString().slice(0,200),
      z: getComputedStyle(el).zIndex,
      top: Math.round(el.getBoundingClientRect().top),
      h: Math.round(el.getBoundingClientRect().height),
      text: (el.innerText||'').replace(/\s+/g,' ').slice(0,300)
    })).filter(p => parseInt(p.z) > 100);
    
    return JSON.stringify({ vlists, popups });
  })()`);
  console.log("AFTER CLICK:", afterClick.value);
}
