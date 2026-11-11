// 关掉视频格式提示，再列出编辑器工具栏所有按钮的 class/title
import { exec, sleep } from "./sparo.mjs";

const tabId = process.argv[2];

const close = `(() => {
  const btn = [...document.querySelectorAll('.cheetah-modal-confirm-btns button, .cheetah-btn-primary')]
    .filter(el => (el.innerText||'').trim() === '确认' && el.offsetParent !== null)[0];
  if (!btn) return JSON.stringify({ ok:false });
  btn.click();
  return JSON.stringify({ ok:true });
})()`;
console.log("CLOSE:", (await exec(close, tabId)).slice(0, 200));
await sleep(1200);

const bar = `(() => {
  const items = [...document.querySelectorAll('[class*="edui-for-"]')].map(el => {
    const cls = String(el.className);
    const m = cls.match(/edui-for-([A-Za-z0-9_]+)/);
    return { key: m ? m[1] : '', title: el.getAttribute('title') || '', text: (el.innerText||'').trim().slice(0,12), vis: el.offsetParent !== null };
  }).filter(o => o.key);
  const uniq = items.filter((o,i,arr)=>arr.findIndex(x=>x.key===o.key)===i);
  return JSON.stringify({ items: uniq.slice(0,40) });
})()`;
console.log("BAR:", (await exec(bar, tabId)).slice(0, 2500));
