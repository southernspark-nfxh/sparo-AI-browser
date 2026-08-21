#!/usr/bin/env node
/**
 * Weibo accept: open weibo (session required) and soft-check compose/send tools.
 * Usage: npm run accept:weibo
 * Does NOT auto-publish spam — only verifies login + fill path when composer exists.
 */
import { loadAuth, initialize, mcpCall, sleep } from "./mcp-helpers.mjs";

const auth = await loadAuth();
await initialize(auth);
await mcpCall(auth, "resume", {}).catch(() => {});

let failed = 0;
const check = (name, ok, detail) => {
  console.log(ok ? `PASS ${name}` : `FAIL ${name}`, detail || "");
  if (!ok) failed += 1;
};

const sess = await mcpCall(auth, "list_sessions", {});
const weibo = (sess.data?.sites || []).find((s) => s.id === "weibo");
check("session.weibo", Boolean(weibo && (weibo.cookieCount || 0) > 0), JSON.stringify(weibo?.cookieCount));

const nav = await mcpCall(auth, "navigate", { url: "https://weibo.com/" });
check("navigate", Boolean(nav.ok), nav.message);
await sleep(3000);

const pt = await mcpCall(auth, "page_text", {});
const text = pt.data?.text || "";
const loggedIn = !/请先登录|扫码登录|手机号登录/.test(text.slice(0, 400)) || /首页|关注|热门/.test(text.slice(0, 400));
check("logged_in", loggedIn, text.slice(0, 80).replace(/\s+/g, " "));

const an = await mcpCall(auth, "analyze_page", {});
check("analyze_page", Boolean(an.ok), an.message);

// Soft: try fill composer if present — do not click 发送 (avoid spam)
const box = [...(an.data?.optional_fields || []), ...(an.data?.required_fields || [])].find(
  (f) => f.primitive === "rich_text" || f.primitive === "text_input",
);
if (box?.ref) {
  const fill = await mcpCall(auth, "fill", {
    ref: box.ref,
    value: `Sparo accept:weibo 烟测 ${Date.now()}（不发送）`,
  });
  check("fill.composer", Boolean(fill.ok), fill.message);
} else {
  console.log("SKIP fill.composer — no composer field (UI variant)");
}

console.log(failed === 0 ? "\naccept:weibo PASS" : `\naccept:weibo FAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
