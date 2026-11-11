import { tabs } from "./sparo.mjs";
const listed = await tabs();
console.log(JSON.stringify(listed.tabs.map(t => ({ id: t.id, win: t.windowId ?? t.window ?? '', active: t.active, url: (t.url||'').slice(0,60) })), null, 1));
