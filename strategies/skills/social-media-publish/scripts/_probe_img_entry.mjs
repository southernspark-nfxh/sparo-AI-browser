// 点工具栏「图片」后，列出弹出的面板与所有 file input
import { exec, sleep } from "./sparo.mjs";

const tabId = process.argv[2];

const clickImg = `(() => {
  const btn = document.querySelector('.edui-for-insertimage');
  if (!btn) return JSON.stringify({ ok:false, why:'no-btn' });
  btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
  btn.click();
  return JSON.stringify({ ok:true });
})()`;
console.log("CLICK:", (await exec(clickImg, tabId)).slice(0, 200));
await sleep(1800);

const probe = `(() => {
  const vis = el => el.offsetParent !== null;
  const inputs = [...document.querySelectorAll('input[type=file]')].map(el => {
    let p = el, chain = [];
    for (let i=0;i<4 && p;i++){ const c = String(p.className||'').slice(0,50); if(c) chain.push(c); p = p.parentElement; }
    return { accept: el.accept || '', vis: vis(el), chain };
  });
  const panels = [...document.querySelectorAll('[class*=drawer],[class*=Drawer],[class*=panel],[class*=upload],[class*=Upload]')]
    .filter(vis).map(el => ({ cls: String(el.className).slice(0,70), text: (el.innerText||'').trim().slice(0,120) }))
    .filter(o => o.text);
  return JSON.stringify({ inputs, panels: panels.slice(0,6) });
})()`;
console.log("PROBE:", (await exec(probe, tabId)).slice(0, 2200));
