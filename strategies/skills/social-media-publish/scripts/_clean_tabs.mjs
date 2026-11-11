// 关掉所有百家号编辑标签，避免脏状态干扰发布
import { tabs, call } from "./sparo.mjs";

const listed = await tabs();
const targets = listed.tabs.filter((t) => /baijiahao\.baidu\.com\/builder\/rc\/edit/.test(t.url || ""));
for (const t of targets) {
  console.log("CLOSE", t.id, (t.url || "").slice(0, 60));
  await call("close_tab", { tabId: t.id });
}
console.log("done", targets.length);
