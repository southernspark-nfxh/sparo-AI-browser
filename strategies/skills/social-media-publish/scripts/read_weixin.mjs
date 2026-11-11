import { call, sleep } from './sparo.mjs';

const URL_ = 'https://mp.weixin.qq.com/s/4Daf3JyE3Ac0Akay4lfdyg';

console.log('1. new_tab');
const nt = await call('new_tab', { url: URL_ });
console.log('   ', String(nt).slice(0, 200));

await sleep(5000);

const tabsRaw = await call('list_tabs');
const tabs = JSON.parse(tabsRaw)?.data?.tabs || [];
const target = tabs.find(t => (t.url || '').includes('mp.weixin.qq.com'));
if (!target) {
  console.log('未找到微信 tab。当前 tabs:');
  tabs.forEach(t => console.log('  ', t.id, (t.url || '').slice(0, 70)));
  process.exit(1);
}
console.log('2. tab:', target.id);

await call('switch_tab', { id: target.id });
await sleep(1500);

const textRaw = await call('page_text', { tabId: target.id, maxChars: 30000 });
let text = '';
try {
  const p = JSON.parse(textRaw);
  text = p?.data?.text || p?.data?.content || p?.data?.result || '';
} catch {
  text = String(textRaw);
}
if (typeof text !== 'string') text = JSON.stringify(text);

console.log('3. 长度:', text.length);
console.log('---BEGIN---');
console.log(text.slice(0, 12000));
console.log('---END---');
