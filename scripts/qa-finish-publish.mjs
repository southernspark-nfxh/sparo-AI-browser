#!/usr/bin/env node
/**
 * From layout preview: pick template → 下一步 → inject_publish → pause.
 */
import { loadAuth, initialize, mcpCall, sleep } from "./mcp-helpers.mjs";

const auth = await loadAuth();
await initialize(auth);

const probe = async (label) => {
  const r = await mcpCall(auth, "execute", {
    script: `(() => {
      const text = document.body.innerText || "";
      const hits = [];
      for (const el of document.querySelectorAll("button,span,div,li,[role=button]")) {
        const t = (el.innerText || "").trim().replace(/\\s+/g, " ");
        if (!t || t.length > 24) continue;
        if (!/下一步|发布|简约|基础|文艺|清新|理性|现代|优雅|几何|杂志|换配图|摘要|话题|封面|暂存|一键/.test(t)) continue;
        const box = el.getBoundingClientRect();
        if (box.width < 2 || box.height < 2) continue;
        hits.push({ t, tag: el.tagName, x: Math.round(box.x), y: Math.round(box.y) });
      }
      const uniq = [];
      const seen = new Set();
      for (const h of hits) {
        const k = h.t + "@" + h.y;
        if (seen.has(k)) continue;
        seen.add(k);
        uniq.push(h);
      }
      return {
        url: location.href,
        hasNext: text.includes("下一步"),
        hasPublish: /\\b发布\\b/.test(text) && !text.includes("发布笔记"),
        hasTopic: text.includes("话题"),
        sample: text.slice(0, 400),
        hits: uniq.slice(0, 50),
      };
    })()`,
  });
  console.log("\\n===" + label + "===");
  console.log(JSON.stringify(r.data?.result || r, null, 2));
  return r.data?.result;
};

let state = await probe("current");

// If not in template UI, re-open layout with long wait
if (!state?.hasNext && !state?.hits?.some((h) => /简约|模板/.test(h.t))) {
  console.log("Re-trigger layout via button.click(), wait up to 30s...");
  // may need to go back to compose first
  if (/1\/4|2\/4|预览/.test(state?.sample || "")) {
    console.log("Looks like already in layout preview pages");
  } else {
    await mcpCall(auth, "execute", {
      script: `(() => {
        const btn = [...document.querySelectorAll("button")].find((b) => (b.innerText || "").trim() === "一键排版");
        if (btn) btn.click();
        return { ok: !!btn };
      })()`,
    });
    for (let i = 0; i < 12; i++) {
      await sleep(2500);
      state = await probe("wait-" + (i + 1));
      if (state?.hasNext || state?.hits?.some((h) => /简约|下一步/.test(h.t))) break;
    }
  }
}

// Pick first template-like text
for (const name of ["简约基础", "简约", "清晰明朗", "文艺清新"]) {
  const c = await mcpCall(auth, "click_text", { text: name, exact: name.length > 2 });
  console.log("template", name, c.ok, c.message);
  if (c.ok) {
    await sleep(1500);
    break;
  }
}

state = await probe("after-template");

if (state?.hasNext) {
  const next = await mcpCall(auth, "click_text", { text: "下一步", exact: true });
  console.log("下一步", next.ok, next.message);
  await sleep(3000);
} else {
  // try button click via JS
  const n = await mcpCall(auth, "execute", {
    script: `(() => {
      const btn = [...document.querySelectorAll("button,span")].find((b) => (b.innerText || "").trim() === "下一步");
      if (!btn) return { ok: false };
      (btn.closest("button") || btn).click();
      return { ok: true };
    })()`,
  });
  console.log("js next", n.data?.result || n);
  await sleep(3000);
}

const stage = await mcpCall(auth, "xhs_page_stage", {});
console.log("stage", stage);

await mcpCall(auth, "screenshot", { name: "qa-publish-stage" });

const inj = await mcpCall(auth, "xhs_inject_publish", {
  summary: "Sparo：人和 AI 共用同一浏览器窗口，AI 直接操控网页。",
  topics: ["#Sparo浏览器", "#AI工具", "#开源"],
});
console.log("inject_publish", inj);

await mcpCall(auth, "xhs_pick_cover", {});
await mcpCall(auth, "pause", {});
await mcpCall(auth, "screenshot", { name: "qa-final-paused" });
console.log("DONE");
