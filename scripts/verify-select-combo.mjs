#!/usr/bin/env node
import { loadAuth, initialize, mcpCall, sleep } from "./mcp-helpers.mjs";

const auth = loadAuth();
await initialize(auth);

const snap = await mcpCall(auth, "snapshot");
const els = snap?.data?.elements || [];

// Attribute comboboxes: ant rc_select search inputs
const combos = els.filter(
  (e) => e.role === "combobox" && /rc_select/i.test(e.selector || ""),
);
console.log(
  "COMBOS",
  combos.slice(0, 6).map((c) => ({ ref: c.ref, sel: c.selector, name: c.name, ph: c.placeholder })),
);

if (!combos[0]) {
  console.log("No ant combobox");
  process.exit(1);
}

const target = combos[0];
// open and list candidates via select with nonsense value
const fail = await mcpCall(auth, "select", { ref: target.ref, value: "__no_such_option__" });
console.log("SELECT_MISS", JSON.stringify(fail).slice(0, 700));

const candidates = fail?.data?.candidates || [];
if (candidates.length) {
  const val = candidates[0];
  const ok = await mcpCall(auth, "select", { ref: target.ref, value: val });
  console.log("SELECT_HIT", JSON.stringify(ok).slice(0, 500));
} else {
  // try execute to see dropdown after click
  await mcpCall(auth, "click", { ref: target.ref });
  await sleep(400);
  const opts = await mcpCall(auth, "execute", {
    script: `(() => {
      const nodes = Array.from(document.querySelectorAll('.ant-select-item-option, [role=option]'));
      return nodes.slice(0, 15).map(n => (n.innerText||'').trim()).filter(Boolean);
    })()`,
  });
  console.log("OPTIONS_AFTER_CLICK", JSON.stringify(opts).slice(0, 600));
  const list = opts?.data?.result || [];
  if (list[0]) {
    const ok = await mcpCall(auth, "select", { ref: target.ref, value: list[0] });
    console.log("SELECT_HIT2", JSON.stringify(ok).slice(0, 500));
  }
}
