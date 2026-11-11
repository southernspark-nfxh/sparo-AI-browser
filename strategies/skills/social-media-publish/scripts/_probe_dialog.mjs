// 读当前百家号编辑页可见弹窗与按钮文本
import { exec } from "./sparo.mjs";

const tabId = process.argv[2];
const script = `(() => {
  const vis = el => el.offsetParent !== null && el.getBoundingClientRect().width > 0;
  const boxes = [...document.querySelectorAll('[class*=dialog],[class*=modal],[class*=Modal],[class*=Dialog]')]
    .filter(vis).map(el => ({ cls: String(el.className).slice(0,70), text: (el.innerText||'').trim().slice(0,160) }))
    .filter(o => o.text);
  const btns = [...document.querySelectorAll('button,[class*=btn],span,div,a')].filter(el => {
    const t = (el.innerText||'').trim();
    return vis(el) && t && t.length <= 6 && /确定|确认|插入|完成|上传|取消|关闭/.test(t);
  }).map(el => ({ tag: el.tagName, text: el.innerText.trim(), cls: String(el.className).slice(0,60) }));
  const uniq = btns.filter((b,i,arr)=>arr.findIndex(x=>x.text===b.text&&x.cls===b.cls)===i);
  return JSON.stringify({ url: location.href, boxes: boxes.slice(0,4), btns: uniq.slice(0,15) });
})()`;
console.log(await exec(script, tabId));
