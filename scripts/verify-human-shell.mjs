#!/usr/bin/env node
import { loadAuth, initialize, mcpCall, sleep } from "./mcp-helpers.mjs";

const auth = loadAuth();
await initialize(auth);

const tabs0 = await mcpCall(auth, "list_tabs");
console.log("TABS0", JSON.stringify(tabs0?.data).slice(0, 300));

const nav = await mcpCall(auth, "navigate", { url: "https://www.baidu.com" });
console.log("NAV", nav.ok, nav.message);

await sleep(2000);
const tabs1 = await mcpCall(auth, "list_tabs");
console.log("TABS1", JSON.stringify(tabs1?.data).slice(0, 400));

const t2 = await mcpCall(auth, "new_tab", { url: "https://example.com" });
console.log("NEW", t2.ok, JSON.stringify(t2?.data).slice(0, 300));
await sleep(1500);

const list = await mcpCall(auth, "list_tabs");
console.log("LIST", JSON.stringify(list?.data).slice(0, 500));

const wait = await mcpCall(auth, "wait_for", { text: "Example", timeoutMs: 8000 });
console.log("WAIT", wait.ok, wait.message);

const qa = await mcpCall(auth, "qa_check");
console.log("QA", qa.ok, qa.message);

// switch back to first tab
const first = list?.data?.tabs?.[0]?.id;
if (first) {
  const sw = await mcpCall(auth, "switch_tab", { id: first });
  console.log("SWITCH", sw.ok, sw.message);
}

const pause = await mcpCall(auth, "pause");
const blocked = await mcpCall(auth, "click_text", { text: "新闻" });
console.log("PAUSE_BLOCK", pause.ok, blocked.ok, blocked.message);
await mcpCall(auth, "resume");

console.log("DONE");
