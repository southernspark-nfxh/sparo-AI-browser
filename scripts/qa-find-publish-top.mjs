#!/usr/bin/env node
import { loadAuth, initialize, mcpCall } from "./mcp-helpers.mjs";

const auth = await loadAuth();
await initialize(auth);

// scroll top
await mcpCall(auth, "execute", {
  script: `(() => {
    window.scrollTo(0, 0);
    document.querySelectorAll("*").forEach((el) => {
      try {
        const s = getComputedStyle(el);
        if (/(auto|scroll)/.test(s.overflowY) && el.scrollTop) el.scrollTop = 0;
      } catch {}
    });
    return true;
  })()`,
});

const r = await mcpCall(auth, "execute", {
  script: `(() => {
    const candidates = [];
    for (const el of document.querySelectorAll("button, span, div, a")) {
      const cls = String(el.className || "");
      const t = (el.innerText || "").trim().replace(/\\s+/g, " ");
      if (/publish|submit|post-btn|publish-btn|submit-btn/i.test(cls) || t === "发布") {
        const box = el.getBoundingClientRect();
        candidates.push({
          t: t.slice(0, 40),
          tag: el.tagName,
          cls: cls.slice(0, 100),
          x: Math.round(box.x),
          y: Math.round(box.y),
          w: Math.round(box.width),
          h: Math.round(box.height),
        });
      }
    }
    // top-right area elements
    const topRight = [...document.querySelectorAll("button, span.d-text")].filter((el) => {
      const box = el.getBoundingClientRect();
      return box.y < 120 && box.x > 500 && box.width > 20 && (el.innerText || "").trim().length < 10;
    }).map((el) => {
      const box = el.getBoundingClientRect();
      return { t: (el.innerText || "").trim(), x: Math.round(box.x), y: Math.round(box.y), cls: String(el.className||"").slice(0,60) };
    });
    return {
      candidates: candidates.slice(0, 40),
      topRight,
      bodyTop: (document.body.innerText || "").slice(0, 300),
    };
  })()`,
});
console.log(JSON.stringify(r.data?.result || r, null, 2));
await mcpCall(auth, "screenshot", { name: "qa-publish-top" });
