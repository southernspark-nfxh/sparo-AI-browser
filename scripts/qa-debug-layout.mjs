#!/usr/bin/env node
/**
 * Debug 一键排版: is button disabled? Does native click open panel?
 */
import { loadAuth, initialize, mcpCall, sleep } from "./mcp-helpers.mjs";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";

const MD = join(homedir(), "Desktop", "Sparo小红书长文.md");

const auth = await loadAuth();
await initialize(auth);

const inspect = await mcpCall(auth, "execute", {
  script: `(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => (b.innerText || "").trim() === "一键排版");
    if (!btn) return { ok: false, message: "no button" };
    const r = btn.getBoundingClientRect();
    return {
      ok: true,
      disabled: btn.disabled,
      ariaDisabled: btn.getAttribute("aria-disabled"),
      cls: String(btn.className || ""),
      type: btn.type,
      w: Math.round(r.width),
      h: Math.round(r.height),
      x: Math.round(r.x),
      y: Math.round(r.y),
      parent: btn.parentElement ? String(btn.parentElement.className || "").slice(0, 80) : null,
    };
  })()`,
});
console.log("button inspect", JSON.stringify(inspect.data?.result || inspect, null, 2));

// Native click + wait longer (layout can take 30s per docs)
const clicked = await mcpCall(auth, "execute", {
  script: `(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => (b.innerText || "").trim() === "一键排版");
    if (!btn) return { ok: false };
    btn.focus();
    btn.click();
    // also dispatch pointer events
    ["pointerdown","mousedown","pointerup","mouseup"].forEach((type) => {
      btn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    });
    return { ok: true, clicked: true };
  })()`,
});
console.log("native click", clicked.data?.result || clicked);

for (const ms of [3000, 8000, 15000, 25000]) {
  await sleep(ms === 3000 ? 3000 : ms - (ms === 8000 ? 3000 : ms === 15000 ? 8000 : 15000));
  const probe = await mcpCall(auth, "execute", {
    script: `(() => {
      const text = document.body.innerText || "";
      return {
        hasNext: text.includes("下一步"),
        hasTemplate: /简约|模板|配图|摘要|预览/.test(text),
        footer: (document.querySelector(".footer, .new-ui-footer")?.innerText || "").replace(/\\s+/g, " ").slice(0, 200),
        toast: [...document.querySelectorAll("[class*=toast],[class*=message],[class*=notice],[class*=loading]")]
          .map((el) => (el.innerText || "").trim().slice(0, 80))
          .filter(Boolean)
          .slice(0, 10),
        overlayCount: document.querySelectorAll("#d-overlay-root *, [class*=modal], [class*=drawer]").length,
      };
    })()`,
  });
  console.log(`t+${ms}ms`, JSON.stringify(probe.data?.result || probe, null, 2));
  if (probe.data?.result?.hasNext || probe.data?.result?.hasTemplate) break;
}

await mcpCall(auth, "screenshot", { name: "qa-after-native-layout" });

// If still nothing: force brand-new creation via returning and clearing
console.log("\\n=== try fresh creation + upload ===", existsSync(MD));
await mcpCall(auth, "click_text", { text: "返回", exact: true });
await sleep(1000);
// handle leave confirm
for (const t of ["不保存", "离开", "确定", "放弃"]) {
  const c = await mcpCall(auth, "click_text", { text: t, exact: false });
  if (c.ok) {
    console.log("dismiss", t, c.message);
    await sleep(800);
    break;
  }
}
await sleep(1500);

await mcpCall(auth, "click_text", { text: "写长文", exact: true });
await sleep(2000);
await mcpCall(auth, "click_text", { text: "新的创作", exact: true });
await sleep(2500);

const blank = await mcpCall(auth, "execute", {
  script: `(() => {
    return {
      textSample: (document.body.innerText || "").slice(0, 800),
      files: [...document.querySelectorAll("input[type=file]")].map((el) => ({
        accept: el.accept,
        id: el.id,
        cls: String(el.className||"").slice(0,60),
      })),
      hasUpload: /点击或拖拽上传|上传文档|Markdown|\\.md/.test(document.body.innerText || ""),
      titleEmpty: !(document.querySelector("textarea.d-text, input.d-text")?.value),
    };
  })()`,
});
console.log("blank state", JSON.stringify(blank.data?.result || blank, null, 2));
await mcpCall(auth, "screenshot", { name: "qa-blank-new" });

if (blank.data?.result?.files?.length || blank.data?.result?.hasUpload) {
  const up = await mcpCall(auth, "upload", { files: [MD] });
  console.log("upload", up);
  await sleep(6000);
  const after = await mcpCall(auth, "page_text", {});
  console.log("after upload tail", (after.data?.text || "").slice(-500));
  await mcpCall(auth, "screenshot", { name: "qa-uploaded" });

  await mcpCall(auth, "execute", {
    script: `(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => (b.innerText || "").trim() === "一键排版");
      if (btn) btn.click();
      return { ok: !!btn };
    })()`,
  });
  await sleep(20000);
  const afterLayout = await mcpCall(auth, "execute", {
    script: `(() => ({
      hasNext: (document.body.innerText || "").includes("下一步"),
      hasTemplate: /简约|模板/.test(document.body.innerText || ""),
      footer: (document.querySelector(".footer, .new-ui-footer")?.innerText || "").replace(/\\s+/g," ").slice(0,200),
      sample: (document.body.innerText || "").slice(0, 500),
    }))()`,
  });
  console.log("after upload+layout", JSON.stringify(afterLayout.data?.result || afterLayout, null, 2));
  await mcpCall(auth, "screenshot", { name: "qa-upload-layout" });
}
