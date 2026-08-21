#!/usr/bin/env node
/**
 * After 一键排版: find template panel → pick 简约基础 → 下一步.
 */
import { loadAuth, initialize, mcpCall, sleep } from "./mcp-helpers.mjs";

const PROBE = `(() => {
  const needles = /下一步|简约|基础|文艺|清新|理性|现代|优雅|几何|杂志|模板|预览|换配图|摘要/;
  const hits = [];
  const seen = new Set();
  for (const el of document.querySelectorAll("button,span,div,li,a,[role=button]")) {
    const t = (el.innerText || "").trim().replace(/\\s+/g, " ");
    if (!t || t.length > 30 || !needles.test(t)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const key = t + "@" + Math.round(r.x) + "," + Math.round(r.y);
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({ t, tag: el.tagName, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
  }
  return {
    url: location.href,
    hits: hits.slice(0, 60),
    hasNext: hits.some((h) => h.t === "下一步"),
    bodyHasTemplate: /简约基础|文艺清新/.test(document.body.innerText || ""),
  };
})()`;

const auth = await loadAuth();
await initialize(auth);

// Ensure we're on compose with content
let stage = await mcpCall(auth, "xhs_page_stage", {});
console.log("stage0", stage.data);
if (stage.data?.stage !== "compose") {
  await mcpCall(auth, "xhs_ensure_editor", {});
  await sleep(1500);
}

// If title empty, inject quickly
if (stage.data?.titleEmpty || stage.data?.bodyEmpty) {
  await mcpCall(auth, "xhs_inject_compose", {
    title: "Sparo浏览器——AI终于有了自己的手。",
    body: "先说一个你可能没意识到的问题：\\n\\nAI 终于有了一双能操作网页的手。Sparo 是人和 AI 共用的浏览器。",
    force: true,
  });
  await sleep(1000);
}

console.log(await mcpCall(auth, "click_text", { text: "一键排版", exact: true }));
await sleep(3000);

let probe = await mcpCall(auth, "execute", { script: PROBE });
console.log("after layout", JSON.stringify(probe.data?.result || probe, null, 2));
await mcpCall(auth, "screenshot", { name: "qa-layout-panel" });

// Try clicking template names
for (const name of ["简约基础", "清晰明朗", "文艺清新", "理性现代"]) {
  const c = await mcpCall(auth, "click_text", { text: name, exact: false });
  console.log("click template", name, c.ok, c.message);
  if (c.ok) {
    await sleep(1500);
    probe = await mcpCall(auth, "execute", { script: PROBE });
    console.log("after template", JSON.stringify(probe.data?.result || probe, null, 2));
    break;
  }
}

// Also try soft contains via page
if (!(probe.data?.result?.hasNext)) {
  // maybe template cards without exact text — click right panel area
  const right = await mcpCall(auth, "execute", {
    script: `(() => {
      const el = [...document.querySelectorAll("div,li,button")].find((n) => {
        const t = (n.innerText || "").trim();
        return t === "简约基础" || t.startsWith("简约");
      });
      if (!el) return { ok: false };
      el.click();
      return { ok: true, t: (el.innerText || "").slice(0, 40) };
    })()`,
  });
  console.log("direct click", right.data?.result || right);
  await sleep(1500);
  probe = await mcpCall(auth, "execute", { script: PROBE });
  console.log("probe2", JSON.stringify(probe.data?.result || probe, null, 2));
}

if (probe.data?.result?.hasNext || (await mcpCall(auth, "execute", { script: PROBE })).data?.result?.hasNext) {
  const next = await mcpCall(auth, "click_text", { text: "下一步", exact: true });
  console.log("下一步", next);
  await sleep(3000);
  const stage2 = await mcpCall(auth, "xhs_page_stage", {});
  console.log("stage after next", stage2);
  await mcpCall(auth, "screenshot", { name: "qa-after-next" });
} else {
  console.log("NEXT STILL MISSING");
  const pt = await mcpCall(auth, "page_text", {});
  console.log((pt.data?.text || "").slice(0, 2000));
}
