// 稳定探测：先 Esc 清场，点图片按钮，dump popover 结构
import { click, exec, press, sleep } from "./sparo.mjs";

const tabId = process.argv[2];

await press("Escape", tabId).catch(() => {});
await sleep(600);
await exec("(() => { document.body.click(); return '1'; })()", tabId);
await sleep(400);

await click(".edui-for-insertimage", tabId);
await sleep(2500);

const dump = `(() => {
  const vis = el => el.offsetParent !== null;
  const pops = [...document.querySelectorAll('.popover,[class*=popover],[class*=Popover],[class*=upload],[class*=Upload]')].filter(vis);
  const out = pops.map(el => ({ cls: String(el.className).slice(0,60), html: el.innerHTML.slice(0, 700) }));
  const inputs = [...document.querySelectorAll('input[type=file]')].map(el => ({ accept: el.accept||'', vis: vis(el) }));
  return JSON.stringify({ count: pops.length, out: out.slice(0,3), inputs });
})()`;
console.log(await exec(dump, tabId));
