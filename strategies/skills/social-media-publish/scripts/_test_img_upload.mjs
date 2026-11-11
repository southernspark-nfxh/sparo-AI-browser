// 实测：真实点击「图片」→ 上传 jpg → 观察是否需要确认
import { click, uploadFile, exec, sleep } from "./sparo.mjs";

const tabId = process.argv[2];
const file = process.argv[3];

await click(".edui-for-insertimage", tabId);
await sleep(1800);

const tag = `(() => {
  const inputs = [...document.querySelectorAll('input[type=file]')];
  const img = inputs.find(el => /image/i.test(el.accept || ''));
  if (!img) return JSON.stringify({ ok:false, accepts: inputs.map(i => i.accept || '') });
  if (!img.id) img.id = 'sparo-img-' + Math.random().toString(16).slice(2);
  return JSON.stringify({ ok:true, selector: '#' + img.id, accept: img.accept });
})()`;
const picked = await exec(tag, tabId);
console.log("PICKED:", picked.slice(0, 400));
const sel = (picked.match(/"selector":\s*"([^"]+)"/) || [])[1];
if (!sel) { console.log("没有图片输入框"); process.exit(1); }

console.log("UPLOAD:", (await uploadFile(sel, file, tabId)).slice(0, 300));
await sleep(4000);

const after = `(() => {
  const vis = el => el.offsetParent !== null;
  const iframe = document.querySelector('#ueditor_0');
  const imgs = iframe?.contentDocument?.querySelectorAll('img')?.length || 0;
  const btns = [...document.querySelectorAll('button,span,div')].filter(el => {
    const t = (el.innerText||'').trim();
    return vis(el) && t && t.length <= 4 && /^(确定|确认|插入|完成)$/.test(t);
  }).map(el => ({ tag: el.tagName, text: el.innerText.trim(), cls: String(el.className).slice(0,50) }));
  const pop = [...document.querySelectorAll('.popover,[class*=upload]')].filter(vis).map(el => (el.innerText||'').trim().slice(0,100)).filter(Boolean);
  return JSON.stringify({ imgs, btns: btns.slice(0,8), pop: pop.slice(0,3) });
})()`;
console.log("AFTER:", (await exec(after, tabId)).slice(0, 1200));
