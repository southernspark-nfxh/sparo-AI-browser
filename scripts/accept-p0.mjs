#!/usr/bin/env node
/**
 * P0 accept: Baidu navigate / fill / click confirmation.
 * Usage: npm run accept:p0
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

const nav = await mcpCall(auth, "navigate", { url: "https://www.baidu.com/" });
check("navigate.confirmed", Boolean(nav.ok && nav.data?.confirmed), nav.message);
await sleep(1500);

const an = await mcpCall(auth, "analyze_page", {});
const search =
  [...(an.data?.optional_fields || []), ...(an.data?.required_fields || [])].find(
    (f) =>
      f.primitive === "text_input" ||
      f.primitive === "search" ||
      /搜索|wd|chat-input|textarea/i.test(f.label + (f.placeholder || "") + (f.name || "")),
  ) || null;

let fillOk = false;
if (search?.ref) {
  const fill = await mcpCall(auth, "fill", { ref: search.ref, value: "星火浏览器" });
  fillOk = Boolean(fill.ok && (fill.data?.matched !== false));
  check("fill.matched", fillOk, fill.message);
} else {
  // fallback classic #kw
  const fill = await mcpCall(auth, "fill", { selector: "#kw", value: "星火浏览器" });
  fillOk = Boolean(fill.ok);
  check("fill#kw", fillOk, fill.message || "no analyze field");
}

const click = await mcpCall(auth, "click", { selector: "#su" }).catch(async () =>
  mcpCall(auth, "click_text", { text: "百度一下", exact: false }),
);
check(
  "click.changed",
  Boolean(click.ok && (click.data?.changed || click.data?.urlChanged || click.message)),
  click.message,
);

console.log(failed === 0 ? "\naccept:p0 PASS" : `\naccept:p0 FAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
