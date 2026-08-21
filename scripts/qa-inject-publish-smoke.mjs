#!/usr/bin/env node
/** Smoke: xhs_inject_publish topics only (expects publish stage). */
import { loadAuth, initialize, mcpCall } from "./mcp-helpers.mjs";

const auth = await loadAuth();
await initialize(auth);
await mcpCall(auth, "resume", {}).catch(() => {});

const stage = await mcpCall(auth, "xhs_page_stage", {});
console.log("stage", stage.data?.stage, stage.data?.onPublishPage);

if (stage.data?.stage !== "publish" && !stage.data?.onPublishPage) {
  console.log("SKIP: not on publish page — open publish first");
  process.exit(0);
}

const t0 = Date.now();
const r = await mcpCall(auth, "xhs_inject_publish", {
  summary: "Sparo：人和AI同窗浏览器。",
  topics: ["#AI工具", "#开源", "#Sparo浏览器"],
});
console.log("ms", Date.now() - t0);
console.log(JSON.stringify(r, null, 2));
process.exit(r.ok ? 0 : 1);
