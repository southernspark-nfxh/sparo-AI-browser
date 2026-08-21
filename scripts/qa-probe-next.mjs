#!/usr/bin/env node
/**
 * After layout: does 下一步 appear? Explore scroll containers / footer.
 */
import { loadAuth, initialize, mcpCall, sleep } from "./mcp-helpers.mjs";

const PROBE = `(() => {
  const btns = [...document.querySelectorAll("button,span.d-text,[role=button]")]
    .map((el) => {
      const t = (el.innerText || "").trim().replace(/\\s+/g, " ");
      if (!t || t.length > 30) return null;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return null;
      return { t, tag: el.tagName, y: Math.round(r.y), x: Math.round(r.x), cls: String(el.className || "").slice(0, 60) };
    })
    .filter(Boolean);
  const uniq = [];
  const seen = new Set();
  for (const b of btns) {
    const k = b.t + "@" + b.y;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(b);
  }
  const footer = document.querySelector(".footer, .new-ui-footer");
  return {
    url: location.href,
    hasNextText: (document.body.innerText || "").includes("下一步"),
    footerText: footer ? (footer.innerText || "").replace(/\\s+/g, " ").slice(0, 200) : null,
    btns: uniq.slice(0, 80),
  };
})()`;

const SCROLL = `(() => {
  const candidates = [...document.querySelectorAll("*")].filter((el) => {
    try {
      const s = getComputedStyle(el);
      return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 50;
    } catch {
      return false;
    }
  }).slice(0, 12);
  const info = candidates.map((el) => {
    el.scrollTop = el.scrollHeight;
    return {
      cls: String(el.className || "").slice(0, 80),
      tag: el.tagName,
      sh: el.scrollHeight,
      ch: el.clientHeight,
      st: el.scrollTop,
    };
  });
  window.scrollTo(0, 99999);
  return {
    scrolled: info,
    hasNextText: (document.body.innerText || "").includes("下一步"),
  };
})()`;

const auth = await loadAuth();
await initialize(auth);

async function dump(label) {
  const r = await mcpCall(auth, "execute", { script: PROBE });
  console.log("\\n===" + label + "===");
  console.log(JSON.stringify(r.data?.result || r, null, 2));
}

console.log(await mcpCall(auth, "click_text", { text: "一键排版", exact: true }));
await sleep(2500);
await dump("after-layout-2.5s");
await sleep(6000);
await dump("after-layout-8.5s");

const scrolled = await mcpCall(auth, "execute", { script: SCROLL });
console.log("\\n===scroll===", JSON.stringify(scrolled.data?.result || scrolled, null, 2));
await sleep(800);
await dump("after-scroll");

const shot = await mcpCall(auth, "screenshot", { name: "qa-after-layout" });
console.log("screenshot", shot.message, shot.data?.file || shot.data);

// Also list any dialogs / overlays
const overlays = await mcpCall(auth, "execute", {
  script: `(() => {
    const roots = [
      document.querySelector("#d-overlay-root"),
      ...document.querySelectorAll("[class*=modal],[class*=dialog],[class*=drawer],[class*=popup]"),
    ].filter(Boolean);
    return roots.slice(0, 20).map((el) => ({
      cls: String(el.className || "").slice(0, 80),
      id: el.id,
      t: (el.innerText || "").replace(/\\s+/g, " ").slice(0, 200),
      vis: el.getBoundingClientRect().height > 0,
    }));
  })()`,
});
console.log("\\n===overlays===", JSON.stringify(overlays.data?.result || overlays, null, 2));
