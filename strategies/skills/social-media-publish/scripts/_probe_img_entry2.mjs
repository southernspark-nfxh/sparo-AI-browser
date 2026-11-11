// 用真实鼠标点击「图片」按钮，看是否有本地上传入口
import { call, exec, sleep } from "./sparo.mjs";

const tabId = process.argv[2];

console.log("CLICK:", (await call("click", { selector: ".edui-for-insertimage", tabId })).slice(0, 300));
await sleep(2500);

const probe = `(() => {
  const vis = el => el.offsetParent !== null;
  const inputs = [...document.querySelectorAll('input[type=file]')].map(el => ({ accept: el.accept || '', vis: vis(el), cls: String(el.className).slice(0,40) }));
  const abs = [...document.querySelectorAll('div,section')].filter(el => {
    if (!vis(el)) return false;
    const cs = getComputedStyle(el);
    const t = (el.innerText||'').trim();
    return (cs.position === 'fixed' || cs.position === 'absolute') && t.length > 0 && t.length < 200 && /上传|图片|相册|选择/.test(t);
  }).map(el => ({ cls: String(el.className).slice(0,70), text: (el.innerText||'').trim().slice(0,140) }))
    .filter((o,i,arr)=>arr.findIndex(x=>x.text===o.text)===i);
  return JSON.stringify({ inputs, abs: abs.slice(0,6) });
})()`;
console.log("PROBE:", (await exec(probe, tabId)).slice(0, 2500));
