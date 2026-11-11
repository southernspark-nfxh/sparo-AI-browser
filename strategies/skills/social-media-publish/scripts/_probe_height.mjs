import { tabs, call, sleep } from "./sparo.mjs";

const listed = await tabs();
const tab = (listed.tabs || []).find((t) => /baijiahao\.baidu\.com/.test(t.url || "")) || (listed.tabs || [])[0];
for (let i = 0; i < 12; i++) {
  const h = await call("execute", { script: "(() => JSON.stringify({ innerHeight: window.innerHeight, visibility: document.visibilityState, hidden: document.hidden }))()", tabId: tab.id });
  console.log(i, String(h).replace(/\s+/g, " ").slice(0, 220));
  await sleep(1500);
}
