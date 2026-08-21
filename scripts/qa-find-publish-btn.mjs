#!/usr/bin/env node
import { loadAuth, initialize, mcpCall } from "./mcp-helpers.mjs";

const auth = await loadAuth();
await initialize(auth);

const r = await mcpCall(auth, "execute", {
  script: `(() => {
    const all = [...document.querySelectorAll("button,div,span,a")].filter((el) => {
      const t = (el.innerText || "").trim();
      return t === "发布" || t === "定时发布";
    }).map((el) => {
      const box = el.getBoundingClientRect();
      return {
        t: (el.innerText || "").trim(),
        tag: el.tagName,
        cls: String(el.className || "").slice(0, 100),
        x: Math.round(box.x),
        y: Math.round(box.y),
        w: Math.round(box.width),
        h: Math.round(box.height),
      };
    });
    const header = (document.querySelector(".header")?.innerText || "").replace(/\\s+/g, " ").slice(0, 300);
    // TipTap near topic
    const ce = [...document.querySelectorAll("[contenteditable=true], .tiptap.ProseMirror")].map((el) => {
      const box = el.getBoundingClientRect();
      return {
        cls: String(el.className || "").slice(0, 80),
        ph: el.getAttribute("data-placeholder") || el.getAttribute("placeholder") || "",
        text: (el.innerText || "").slice(0, 40),
        y: Math.round(box.y),
        h: Math.round(box.height),
      };
    });
    return { all: all.slice(0, 30), header, ce };
  })()`,
});
console.log(JSON.stringify(r.data?.result || r, null, 2));
