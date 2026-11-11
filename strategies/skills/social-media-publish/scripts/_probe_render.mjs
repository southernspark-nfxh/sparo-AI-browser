import { tabs, call } from "./sparo.mjs";

const listed = await tabs();
const tab = (listed.tabs || []).find((t) => /baijiahao\.baidu\.com/.test(t.url || "")) || (listed.tabs || [])[0];
console.log("tab", tab && tab.id, tab && tab.url);
const raw = await call("ensure_render", { tabId: tab.id });
console.log("ensure_render:", String(raw).slice(0, 600));
const h = await call("execute", { script: "(() => JSON.stringify({ innerHeight: window.innerHeight }))()", tabId: tab.id });
console.log("height:", String(h).slice(0, 300));
const sw = await call("switch_tab", { id: tab.id });
console.log("switch:", String(sw).slice(0, 300));
