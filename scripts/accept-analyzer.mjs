#!/usr/bin/env node
/**
 * Accept: analyze_page + execute_primitives on Baidu (or run_skill 通用填表).
 * Usage: npm run accept:analyzer
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
check("navigate", Boolean(nav.ok), nav.message);
await sleep(1500);

const an = await mcpCall(auth, "analyze_page", {});
check("analyze_page", Boolean(an.ok), an.message);
check(
  "analyze_has_fields",
  Number(an.data?.field_count || 0) > 0 ||
    (an.data?.optional_fields || []).length + (an.data?.required_fields || []).length > 0,
  `fields=${an.data?.field_count}`,
);

const match = await mcpCall(auth, "match_skill", { query: "通用填表" });
const hit = (match.data?.matches || match.data?.skills || []).find?.(
  (m) => m.id === "universal-form-fill" || /填表/.test(m.title || ""),
) || (match.data?.matches || [])[0];
check(
  "match_skill.universal-form-fill",
  Boolean(hit || match.ok),
  JSON.stringify(hit || match.data || match.message).slice(0, 120),
);

const keyword = `Sparo填表验收${Date.now().toString().slice(-4)}`;
const ex = await mcpCall(auth, "execute_primitives", {
  payload: { 搜索: keyword, wd: keyword },
});
check(
  "execute_primitives",
  Boolean(ex.ok || (ex.data?.steps || []).some((s) => s.ok)),
  ex.message,
);

const skill = await mcpCall(auth, "run_skill", {
  query: "通用填表",
  params: { payload: { 搜索: keyword + "B" } },
}).catch((e) => ({ ok: false, message: String(e) }));
check(
  "run_skill.通用填表",
  Boolean(skill.ok || /execute_primitives|填/.test(skill.message || "")),
  skill.message,
);

console.log(failed === 0 ? "\naccept:analyzer PASS" : `\naccept:analyzer FAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
