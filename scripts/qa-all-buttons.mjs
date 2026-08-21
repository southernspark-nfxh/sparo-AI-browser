#!/usr/bin/env node
import { loadAuth, initialize, mcpCall } from "./mcp-helpers.mjs";

const auth = await loadAuth();
await initialize(auth);

const r = await mcpCall(auth, "execute", {
  script: `(() => {
    const btns = [...document.querySelectorAll("button")].map((b) => {
      const box = b.getBoundingClientRect();
      return {
        t: (b.innerText || "").trim().replace(/\\s+/g, " ").slice(0, 40),
        cls: String(b.className || "").slice(0, 100),
        x: Math.round(box.x),
        y: Math.round(box.y),
        w: Math.round(box.width),
        h: Math.round(box.height),
        disabled: b.disabled,
      };
    }).filter((b) => b.w > 0 && b.h > 0);
    // red / primary looking
    const redish = [...document.querySelectorAll("*")].filter((el) => {
      const cls = String(el.className || "");
      return /bg-red|primary|submit|next-btn|publish-btn|post-btn/i.test(cls);
    }).slice(0, 30).map((el) => {
      const box = el.getBoundingClientRect();
      return {
        t: (el.innerText || "").trim().replace(/\\s+/g, " ").slice(0, 40),
        tag: el.tagName,
        cls: String(el.className || "").slice(0, 100),
        x: Math.round(box.x),
        y: Math.round(box.y),
        w: Math.round(box.width),
        h: Math.round(box.height),
      };
    }).filter((x) => x.w > 0 && x.h > 0);
    return { btns, redish };
  })()`,
});
console.log(JSON.stringify(r.data?.result || r, null, 2));
