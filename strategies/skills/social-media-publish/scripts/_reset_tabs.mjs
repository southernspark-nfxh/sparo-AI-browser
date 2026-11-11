// 关掉所有标签，消除多窗口/脏编辑页导致 switch_tab other_window
import { tabs, call, activeIdOf } from "./sparo.mjs";

const listed = await tabs();
const list = listed.tabs || [];
console.log("before", list.map((t) => t.id + ":" + (t.url || "").slice(0, 48)).join(" | "));
for (const t of list) {
  const raw = await call("close_tab", { id: t.id });
  console.log("CLOSE", t.id, String(raw).slice(0, 120));
}
const after = await tabs();
console.log("after", (after.tabs || []).map((t) => t.id + ":" + (t.url || "").slice(0, 48)).join(" | "), "active=", activeIdOf(after));
