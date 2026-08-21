#!/usr/bin/env node
import { loadAuth, initialize, mcpCall, sleep } from "./mcp-helpers.mjs";

const auth = await loadAuth();
await initialize(auth);

const r = await mcpCall(auth, "execute", {
  script: `(() => {
    const text = document.body.innerText || "";
    const btns = [...document.querySelectorAll("button")].map((b) => ({
      t: (b.innerText || "").trim().replace(/\\s+/g, " ").slice(0, 40),
      disabled: b.disabled,
      cls: String(b.className || "").slice(0, 80),
      y: Math.round(b.getBoundingClientRect().y),
      x: Math.round(b.getBoundingClientRect().x),
      vis: b.getBoundingClientRect().height > 0,
    })).filter((b) => b.t && b.vis);
    return {
      url: location.href,
      footer: (document.querySelector(".footer, .new-ui-footer")?.innerText || "").replace(/\\s+/g, " ").slice(0, 200),
      hasTopic: text.includes("话题") || text.includes("#话题"),
      hasSummary: /推荐语|简介|摘要|添加话题/.test(text),
      hasPublishBtn: btns.some((b) => b.t === "发布"),
      hasNext: btns.some((b) => b.t === "下一步"),
      btns: btns.slice(0, 30),
      sample: text.slice(0, 600),
      tail: text.slice(-400),
    };
  })()`,
});
console.log(JSON.stringify(r.data?.result || r, null, 2));
await mcpCall(auth, "screenshot", { name: "qa-after-next-state" });

// If still has next, click again after short wait
if (r.data?.result?.hasNext) {
  console.log("Still has 下一步 — click button native");
  await mcpCall(auth, "execute", {
    script: `(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => (b.innerText || "").trim() === "下一步");
      if (btn) btn.click();
      return { ok: !!btn };
    })()`,
  });
  await sleep(5000);
  const r2 = await mcpCall(auth, "xhs_page_stage", {});
  console.log("stage2", r2);
  const r3 = await mcpCall(auth, "execute", {
    script: `(() => ({
      footer: (document.querySelector(".footer, .new-ui-footer")?.innerText || "").replace(/\\s+/g, " ").slice(0, 200),
      tail: (document.body.innerText || "").slice(-500),
      hasPublish: [...document.querySelectorAll("button")].some((b) => (b.innerText || "").trim() === "发布"),
      hasTopic: (document.body.innerText || "").includes("话题"),
    }))()`,
  });
  console.log("after 2nd next", JSON.stringify(r3.data?.result || r3, null, 2));
  await mcpCall(auth, "screenshot", { name: "qa-after-2nd-next" });
}
