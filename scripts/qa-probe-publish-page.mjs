#!/usr/bin/env node
import { loadAuth, initialize, mcpCall, sleep } from "./mcp-helpers.mjs";

const auth = await loadAuth();
await initialize(auth);

const r = await mcpCall(auth, "execute", {
  script: `(() => {
    const inputs = [...document.querySelectorAll("textarea, input, [contenteditable=true]")].map((el) => {
      const box = el.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) return null;
      const near = (el.parentElement?.innerText || "").slice(0, 80).replace(/\\s+/g, " ");
      return {
        tag: el.tagName,
        ph: el.getAttribute("placeholder") || "",
        cls: String(el.className || "").slice(0, 80),
        value: String(el.value || el.innerText || "").slice(0, 60),
        x: Math.round(box.x),
        y: Math.round(box.y),
        w: Math.round(box.width),
        h: Math.round(box.height),
        near: near.slice(0, 60),
      };
    }).filter(Boolean);

    const allBtns = [...document.querySelectorAll("button, span.d-text, [role=button]")].map((el) => {
      const t = (el.innerText || "").trim().replace(/\\s+/g, " ");
      if (!t || t.length > 20) return null;
      const box = el.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) return null;
      if (!/发布|暂存|返回|话题|封面|预览|定时/.test(t)) return null;
      return { t, tag: el.tagName, x: Math.round(box.x), y: Math.round(box.y), cls: String(el.className||"").slice(0,60) };
    }).filter(Boolean);

    return { inputs: inputs.slice(0, 30), btns: allBtns.slice(0, 40), textHas发布: (document.body.innerText||"").includes("发布") };
  })()`,
});
console.log(JSON.stringify(r.data?.result || r, null, 2));

await mcpCall(auth, "xhs_scroll_bottom", {});
await sleep(500);
const r2 = await mcpCall(auth, "execute", {
  script: `(() => {
    const btns = [...document.querySelectorAll("button")].map((b) => ({
      t: (b.innerText || "").trim(),
      y: Math.round(b.getBoundingClientRect().y),
      x: Math.round(b.getBoundingClientRect().x),
      vis: b.getBoundingClientRect().height > 0,
      cls: String(b.className||"").slice(0,80),
    })).filter((b) => b.t && b.vis && b.t.length < 20);
    return { btns, fixed: [...document.querySelectorAll("*")].filter(el => {
      try { return getComputedStyle(el).position==='fixed' && /发布/.test(el.innerText||''); } catch { return false; }
    }).slice(0,5).map(el => (el.innerText||'').replace(/\\s+/g,' ').slice(0,120)) };
  })()`,
});
console.log("after scroll", JSON.stringify(r2.data?.result || r2, null, 2));
await mcpCall(auth, "screenshot", { name: "qa-publish-page" });
