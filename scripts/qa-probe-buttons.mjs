#!/usr/bin/env node
import { loadAuth, initialize, mcpCall } from "./mcp-helpers.mjs";

const SCRIPT = `(() => {
  const interesting = /下一步|发布|排版|暂存|封面|话题|返回|完成|继续|设置|写长文|新的创作|预览/;
  const out = [];
  const seen = new Set();
  const push = (el) => {
    const t = (el.innerText || el.textContent || "").trim().replace(/\\s+/g, " ");
    if (!t || t.length > 40 || !interesting.test(t)) return;
    const r = el.getBoundingClientRect();
    const key = t + "|" + el.tagName + "|" + Math.round(r.x) + "|" + Math.round(r.y);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      t,
      tag: el.tagName,
      cls: String(el.className || "").slice(0, 120),
      w: Math.round(r.width),
      h: Math.round(r.height),
      x: Math.round(r.x),
      y: Math.round(r.y),
      vis: r.width > 0 && r.height > 0,
    });
  };
  const walk = (root) => {
    root.querySelectorAll("button, a, [role=button], span, div, li").forEach(push);
  };
  walk(document);
  document.querySelectorAll("*").forEach((el) => {
    if (el.shadowRoot) walk(el.shadowRoot);
  });
  // also look for fixed bars
  const fixedBars = [...document.querySelectorAll("*")]
    .filter((el) => {
      try {
        const s = getComputedStyle(el);
        return s.position === "fixed" && el.childElementCount > 0 && el.childElementCount < 40;
      } catch { return false; }
    })
    .map((el) => ({
      cls: String(el.className || "").slice(0, 80),
      t: (el.innerText || "").slice(0, 120).replace(/\\s+/g, " "),
      y: Math.round(el.getBoundingClientRect().y),
      h: Math.round(el.getBoundingClientRect().height),
    }))
    .filter((x) => x.t && /排版|下一步|发布|暂存|字数/.test(x.t))
    .slice(0, 10);
  return {
    url: location.href,
    matches: out.slice(0, 100),
    fixedBars,
    tail: (document.body.innerText || "").slice(-600),
  };
})()`;

const auth = await loadAuth();
await initialize(auth);
const r = await mcpCall(auth, "execute", { script: SCRIPT });
console.log(JSON.stringify(r, null, 2));
