#!/usr/bin/env node
/**
 * Force blank「新的创作」and try MD upload → look for 下一步.
 */
import { loadAuth, initialize, mcpCall, sleep } from "./mcp-helpers.mjs";
import { join } from "node:path";
import { homedir } from "node:os";

const MD = join(homedir(), "Desktop", "Sparo小红书长文.md");

const FOOTER = `(() => {
  const footer = document.querySelector(".footer, .new-ui-footer");
  const texts = [...document.querySelectorAll("button, span.d-text")]
    .map((el) => (el.innerText || "").trim())
    .filter((t) => t && t.length < 20);
  return {
    url: location.href,
    footer: footer ? (footer.innerText || "").replace(/\\s+/g, " ") : null,
    hasNext: texts.includes("下一步"),
    hasUpload: (document.body.innerText || "").includes("点击或拖拽上传") || (document.body.innerText || "").includes("上传"),
    sample: [...new Set(texts)].slice(0, 40),
    files: document.querySelectorAll('input[type=file]').length,
  };
})()`;

const auth = await loadAuth();
await initialize(auth);

async function footer(label) {
  const r = await mcpCall(auth, "execute", { script: FOOTER });
  console.log(`\\n=== ${label} ===`);
  console.log(JSON.stringify(r.data?.result || r, null, 2));
  return r.data?.result;
}

// Fresh start
await mcpCall(auth, "navigate", {
  url: "https://creator.xiaohongshu.com/publish/publish?source=official",
});
await sleep(3000);
await footer("landed");

// Click 写长文
let r = await mcpCall(auth, "click_text", { text: "写长文", exact: true });
console.log("写长文", r.ok, r.message);
await sleep(2000);
await footer("after-写长文");

// Prefer 新的创作; if draft list, still click it
r = await mcpCall(auth, "click_text", { text: "新的创作", exact: true });
console.log("新的创作", r.ok, r.message);
await sleep(2500);
await footer("after-新的创作");

// If still no upload (opened existing draft), click 返回 and try again
let state = await footer("check");
if (!state?.hasUpload && !state?.files) {
  console.log("No upload UI — try 返回 then 新的创作 again");
  await mcpCall(auth, "click_text", { text: "返回", exact: true });
  await sleep(1500);
  // dismiss leave dialog if any
  await mcpCall(auth, "click_text", { text: "离开", exact: false }).catch(() => {});
  await sleep(800);
  await mcpCall(auth, "click_text", { text: "写长文", exact: true });
  await sleep(1500);
  await mcpCall(auth, "click_text", { text: "新的创作", exact: true });
  await sleep(2500);
  state = await footer("after-retry-new");
}

if (state?.hasUpload || state?.files) {
  console.log("Upload UI present — uploading MD");
  // click upload area if needed
  await mcpCall(auth, "click_text", { text: "点击或拖拽上传", exact: false }).catch(() => {});
  await sleep(400);
  const up = await mcpCall(auth, "upload", { files: [MD] });
  console.log("upload result", up);
  await sleep(5000);
  await footer("after-upload");
  await mcpCall(auth, "screenshot", { name: "qa-md-upload-footer" });

  // try layout + wait for next
  await mcpCall(auth, "click_text", { text: "一键排版", exact: true });
  await sleep(5000);
  await footer("after-layout-on-upload");
  await mcpCall(auth, "xhs_scroll_bottom", {});
  await footer("after-scroll");
} else {
  console.log("Still no upload UI. Dumping page_text tail + snapshot-ish.");
  const pt = await mcpCall(auth, "page_text", {});
  console.log((pt.data?.text || "").slice(0, 1500));
  await mcpCall(auth, "screenshot", { name: "qa-no-upload-ui" });
}
