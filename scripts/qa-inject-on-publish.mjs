#!/usr/bin/env node
import { loadAuth, initialize, mcpCall } from "./mcp-helpers.mjs";

const auth = await loadAuth();
await initialize(auth);

const r = await mcpCall(auth, "execute", {
  script: `(() => {
    // Everything in top 100px with clickable text
    const top = [...document.querySelectorAll("button, a, span, div")].filter((el) => {
      const box = el.getBoundingClientRect();
      const t = (el.innerText || "").trim();
      return box.y >= 0 && box.y < 100 && box.height > 10 && box.height < 60 && t && t.length <= 12;
    }).map((el) => {
      const box = el.getBoundingClientRect();
      return {
        t: (el.innerText || "").trim().replace(/\\s+/g, " ").slice(0, 20),
        tag: el.tagName,
        cls: String(el.className || "").slice(0, 80),
        x: Math.round(box.x),
        y: Math.round(box.y),
        w: Math.round(box.width),
      };
    });
    // uniq
    const seen = new Set();
    const uniq = [];
    for (const x of top) {
      const k = x.t + "@" + x.x;
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push(x);
    }
    // Also search shadow / portal
    const portal = document.querySelector("#d-overlay-root");
    return {
      top: uniq.slice(0, 40),
      portalText: portal ? (portal.innerText || "").slice(0, 200) : null,
      titleValue: document.querySelector("input.d-text")?.value || null,
      captionLen: (document.querySelector(".tiptap.ProseMirror")?.innerText || "").trim().length,
    };
  })()`,
});
console.log(JSON.stringify(r.data?.result || r, null, 2));

// Try inject summary into TipTap + topics, then re-scan for 发布
const inj = await mcpCall(auth, "xhs_inject_publish", {
  summary: "Sparo：人和AI共用同一浏览器，AI直接操控网页。",
  topics: ["#Sparo浏览器", "#AI工具", "#开源浏览器"],
});
console.log("inject", JSON.stringify(inj, null, 2));

const r2 = await mcpCall(auth, "execute", {
  script: `(() => {
    const has = (document.body.innerText || "").split("\\n").filter((l) => l.trim() === "发布");
    const btn = [...document.querySelectorAll("button,span")].filter((el) => (el.innerText || "").trim() === "发布");
    return {
      lines: has,
      btnCount: btn.length,
      caption: (document.querySelector(".tiptap.ProseMirror")?.innerText || "").trim().slice(0, 80),
      topicSample: (document.body.innerText || "").match(/#[\\w\\u4e00-\\u9fff]+/g)?.slice(0, 15),
    };
  })()`,
});
console.log("after inject", JSON.stringify(r2.data?.result || r2, null, 2));
await mcpCall(auth, "screenshot", { name: "qa-after-inject-publish" });
await mcpCall(auth, "pause", {});
