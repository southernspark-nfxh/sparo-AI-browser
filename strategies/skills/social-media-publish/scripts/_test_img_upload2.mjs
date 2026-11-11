// 图片 modal 已打开：上传真实 jpg，观察是否自动插入 / 需要点确定
import { uploadFile, exec, sleep } from "./sparo.mjs";

const tabId = process.argv[2];
const file = process.argv[3];

const tag = `(() => {
  const img = [...document.querySelectorAll('input[type=file]')].find(el => /image/i.test(el.accept || ''));
  if (!img) return JSON.stringify({ ok:false });
  if (!img.id) img.id = 'sparo-img-' + Math.random().toString(16).slice(2);
  return JSON.stringify({ ok:true, selector: '#' + img.id });
})()`;
const picked = await exec(tag, tabId);
console.log("PICK:", picked.slice(0, 300));
const sel = (picked.match(/\\"selector\\":\s*\\"([^\\"]+)\\"/) || [])[1] || (picked.match(/"selector":\s*"([^"]+)"/) || [])[1];
if (!sel) { console.log("NO INPUT"); process.exit(1); }

console.log("UPLOAD:", (await uploadFile(sel, file, tabId)).slice(0, 250));
await sleep(6000);

const after = `(() => {
  const vis = el => el.offsetParent !== null;
  const iframe = document.querySelector('#ueditor_0');
  const imgs = iframe?.contentDocument?.querySelectorAll('img')?.length || 0;
  const modal = document.querySelector('.cheetah-ui-pro-image-modal-local-upload');
  const modalVis = modal && modal.offsetParent !== null;
  const btns = [...document.querySelectorAll('button')].filter(el => vis(el)).map(el => (el.innerText||'').trim()).filter(t => t && t.length <= 6 && /确定|确认|插入|完成|取消/.test(t));
  return JSON.stringify({ imgs, modalVis: !!modalVis, btns: [...new Set(btns)] });
})()`;
console.log("AFTER:", (await exec(after, tabId)).slice(0, 800));
