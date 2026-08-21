#!/usr/bin/env node
/**
 * Explore how to leave compose stage → publish settings without 下一步.
 * Tries: header buttons, upload MD path, DOM clues.
 */
import { loadAuth, initialize, mcpCall, sleep } from "./mcp-helpers.mjs";
import { join } from "node:path";
import { homedir } from "node:os";

const MD = join(homedir(), "Desktop", "Sparo小红书长文.md");

const DOM_CLUES = `(() => {
  const texts = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const t = (n.textContent || "").trim();
    if (!t || t.length > 40) continue;
    if (/发布|封面|话题|预览|设置|下一步|提交|完成|推荐|简介/.test(t)) {
      texts.push(t);
    }
  }
  const uniq = [...new Set(texts)].slice(0, 80);
  // header right actions
  const header = document.querySelector(".header, [class*=header]");
  const headerBtns = header
    ? [...header.querySelectorAll("button,span,a,[role=button]")].map((el) => ({
        t: (el.innerText || "").trim().slice(0, 40),
        cls: String(el.className || "").slice(0, 60),
      })).filter((x) => x.t)
    : [];
  // any input[type=file]
  const files = [...document.querySelectorAll('input[type=file]')].map((el) => ({
    accept: el.accept,
    cls: String(el.className || "").slice(0, 60),
    id: el.id,
    multiple: el.multiple,
    hidden: el.offsetParent === null && el.getBoundingClientRect().width === 0,
  }));
  // upload UI
  const uploadTexts = [...document.querySelectorAll("*")]
    .filter((el) => /上传|拖拽|markdown|md/i.test(el.innerText || "") && (el.innerText || "").length < 40)
    .slice(0, 10)
    .map((el) => (el.innerText || "").trim().slice(0, 40));
  return { uniq, headerBtns: headerBtns.slice(0, 30), files, uploadTexts: [...new Set(uploadTexts)] };
})()`;

const auth = await loadAuth();
await initialize(auth);

console.log("=== DOM clues ===");
const clues = await mcpCall(auth, "execute", { script: DOM_CLUES });
console.log(JSON.stringify(clues.data?.result || clues, null, 2));

// Try going back to chooser and using upload path
console.log("\\n=== go back / reopen fresh ===");
await mcpCall(auth, "navigate", {
  url: "https://creator.xiaohongshu.com/publish/publish?source=official",
});
await sleep(2500);
await mcpCall(auth, "xhs_ensure_editor", {});
await sleep(1500);

const stage = await mcpCall(auth, "xhs_page_stage", {});
console.log("stage", stage);

const clues2 = await mcpCall(auth, "execute", { script: DOM_CLUES });
console.log("clues after ensure", JSON.stringify(clues2.data?.result || clues2, null, 2));

// Look for upload UI
const uploadClick = await mcpCall(auth, "click_text", { text: "点击或拖拽上传", exact: false });
console.log("upload click", uploadClick);

if (uploadClick.ok) {
  await sleep(500);
  const up = await mcpCall(auth, "upload", { files: [MD] });
  console.log("upload", up);
  await sleep(4000);
  const after = await mcpCall(auth, "execute", { script: DOM_CLUES });
  console.log("after upload", JSON.stringify(after.data?.result || after, null, 2));
  const stage2 = await mcpCall(auth, "xhs_page_stage", {});
  console.log("stage2", stage2);
  const footer = await mcpCall(auth, "page_text", {});
  console.log("page_text tail", (footer.data?.text || "").slice(-400));
  await mcpCall(auth, "screenshot", { name: "qa-after-md-upload" });
}
