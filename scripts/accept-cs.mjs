#!/usr/bin/env node
/**
 * Accept: cs_scan + cs_draft_reply on local chat fixture (never sends).
 * Usage: npm run accept:cs
 */
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAuth, initialize, mcpCall, sleep } from "./mcp-helpers.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = pathToFileURL(join(__dirname, "fixtures", "cs-chat.html")).href;

const auth = await loadAuth();
await initialize(auth);
await mcpCall(auth, "resume", {}).catch(() => {});

let failed = 0;
const check = (name, ok, detail) => {
  console.log(ok ? `PASS ${name}` : `FAIL ${name}`, detail || "");
  if (!ok) failed += 1;
};

const nav = await mcpCall(auth, "navigate", { url: fixture });
check("navigate.fixture", Boolean(nav.ok), nav.message);
await sleep(800);

const scan = await mcpCall(auth, "cs_scan", {});
check("cs_scan", Boolean(scan.ok), scan.message);
check(
  "cs_scan.composer",
  Boolean(scan.data?.composer?.ref || scan.data?.composer?.selector),
  JSON.stringify(scan.data?.composer),
);
check(
  "cs_scan.messages",
  (scan.data?.messages?.length || 0) >= 1,
  `msgs=${scan.data?.messages?.length}`,
);

const draft = await mcpCall(auth, "cs_draft_reply", {
  fill: true,
  preferLlm: false,
});
check("cs_draft_reply", Boolean(draft.ok), draft.message);
check("cs_draft.filled", Boolean(draft.data?.filled), draft.message);
check(
  "cs_draft.sendBlocked",
  draft.data?.sendBlocked === true,
  JSON.stringify(draft.data?.sendBlocked),
);
check(
  "cs_draft.hasText",
  Boolean(draft.data?.draft && String(draft.data.draft).length > 5),
  String(draft.data?.draft || "").slice(0, 60),
);
check(
  "cs_draft.intent",
  Boolean(draft.data?.intent?.intent),
  JSON.stringify(draft.data?.intent),
);

const skill = await mcpCall(auth, "match_skill", { query: "客服回复" });
const hit = (skill.data?.matches || []).find((m) => m.id === "cs-semi-auto-reply");
check("match_skill.cs", Boolean(hit), JSON.stringify((skill.data?.matches || [])[0]));

const comments = pathToFileURL(join(__dirname, "fixtures", "cs-comments.html")).href;
const nav2 = await mcpCall(auth, "navigate", { url: comments });
check("navigate.comments", Boolean(nav2.ok), nav2.message);
await sleep(800);

const one = await mcpCall(auth, "cs_one_click_reply", {});
check("cs_one_click_reply", Boolean(one.ok), one.message);
check("one.filled", Boolean(one.data?.filled), one.message);
check("one.sendBlocked", one.data?.sendBlocked === true, JSON.stringify(one.data?.sendBlocked));
check(
  "one.hasText",
  Boolean(one.data?.draft && String(one.data.draft).length > 5),
  String(one.data?.draft || "").slice(0, 80),
);
check(
  "one.composer",
  Boolean(one.data?.scan?.composer?.ref || one.data?.scan?.composer?.selector),
  JSON.stringify(one.data?.scan?.composer),
);

console.log(failed === 0 ? "\naccept:cs PASS" : `\naccept:cs FAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
