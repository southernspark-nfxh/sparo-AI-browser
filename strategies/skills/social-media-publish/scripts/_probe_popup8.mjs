// 探针 v8 — 尝试不同元素打开下拉
import { page, sleep } from "./page.mjs";
import { call, clickText } from "./sparo.mjs";

const ctx = { tabId: "2abf3f71", host: "baijiahao.baidu.com" };

async function tryClick(desc, selector) {
  const r = await page(ctx, selector);
  console.log(`  ${desc}:`, r.value || r.stop);
  await sleep(500);
  return r;
}

// dump 函数
const dumpDropdown = async () => {
  const r = await page(ctx, `(() => {
    function visible(el) {
      if (!el || !el.isConnected) return false;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') return false;
      return true;
    }
    // 搜所有可能的弹层
    const selectors = '[class*="dropdown"],[class*="popup"],[class*="picker"],[class*="modal"],[class*="popover"],[class*="-menu"],[class*="select-menu"],[class*="rc-virtual-list"],[class*="-select-dropdown"]';
    const all = Array.from(document.querySelectorAll(selectors)).filter(visible);
    // 排除 cheetah-modal 本身
    const realDropdowns = all.filter(el => !el.closest('.cheetah-modal-wrap'));
    return JSON.stringify({
      count: all.length,
      realDropdowns: realDropdowns.map(el => ({
        cls: (el.className||'').toString().slice(0,150),
        text: (el.innerText||'').replace(/\s+/g,' ').slice(0,200),
        top: Math.round(el.getBoundingClientRect().top),
        h: Math.round(el.getBoundingClientRect().height),
        tag: el.tagName
      })).slice(0,10)
    });
  })()`);
  return r.value;
};

console.log("=== Try 1: fire .cheetah-select-arrow ===");
await tryClick("click arrow", `(() => {
  function fire(el) {
    const r = el.getBoundingClientRect();
    const opt = { bubbles: true, cancelable: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2 };
    for (const ev of ['pointerdown','mousedown','pointerup','mouseup','click']) {
      el.dispatchEvent(new PointerEvent(ev, opt));
    }
    el.click();
  }
  const arrows = Array.from(document.querySelectorAll('.cheetah-select-arrow')).filter(el => {
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.width > 0;
  });
  if (!arrows[0]) return JSON.stringify({ ok: false });
  return JSON.stringify({ ok: fire(arrows[0]) });
})()`);
console.log("  DROPDOWN:", await dumpDropdown());

console.log("\n=== Try 2: fire .cheetah-select-selection-item ===");
await tryClick("click selection-item", `(() => {
  function fire(el) {
    const r = el.getBoundingClientRect();
    const opt = { bubbles: true, cancelable: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2 };
    for (const ev of ['pointerdown','mousedown','pointerup','mouseup','click']) {
      el.dispatchEvent(new PointerEvent(ev, opt));
    }
    el.click();
  }
  const items = Array.from(document.querySelectorAll('.cheetah-select-selection-item')).filter(el => {
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.width > 0;
  });
  if (!items[0]) return JSON.stringify({ ok: false });
  return JSON.stringify({ ok: fire(items[0]), text: (items[0].innerText||'').trim() });
})()`);
console.log("  DROPDOWN:", await dumpDropdown());

console.log("\n=== Try 3: 用 Sparo 原生 click 点 selector ===");
// 先得到 selector 的 ref
const getRef = await page(ctx, `(() => {
  const sel = document.querySelector('.cheetah-select-selector');
  if (!sel) return JSON.stringify({ ok: false });
  return JSON.stringify({ ok: true, ref: sel, text: sel.innerText });
})()`);
console.log("  ref:", getRef.value);

// 用 Sparo 原生 click（模拟用户真实点击）
const nativeClick = await call("click_text", { text: "11月11日", tabId: ctx.tabId });
console.log("  native click_text result:", nativeClick?.slice(0, 200));
await sleep(600);
console.log("  DROPDOWN:", await dumpDropdown());

console.log("\n=== Try 4: click 日期文本（body 级）===");
const bodyClick = await call("click_text", { text: "11月11日", tabId: ctx.tabId, exact: false });
console.log("  result:", bodyClick?.slice(0, 200));
await sleep(600);
console.log("  DROPDOWN:", await dumpDropdown());

console.log("\n=== 最终 dump 全部弹层 ===");
const finalDump = await page(ctx, `(() => {
  const all = Array.from(document.querySelectorAll('*')).filter(el => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    const cls = (el.className || '').toString();
    return /rc-virtual-list|cheetah-select-dropdown|cheetah-select-menu|dropdown-menu|rc-menu/i.test(cls);
  }).map(el => {
    const r = el.getBoundingClientRect();
    return {
      cls: (el.className||'').toString().slice(0, 200),
      text: (el.innerText||'').replace(/\s+/g,' ').slice(0, 400),
      top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width),
      z: getComputedStyle(el).zIndex,
      tag: el.tagName,
      id: el.id
    };
  });
  return JSON.stringify({ count: all.length, items: all });
})()`);
console.log(finalDump.value);
