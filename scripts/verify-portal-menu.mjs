#!/usr/bin/env node
import { loadAuth, initialize, mcpCall, sleep } from "./mcp-helpers.mjs";

const EDIT =
  process.env.DXM_EDIT_URL ||
  "https://www.dianxiaomi.com/web/smt/edit?id=YOUR_PRODUCT_ID";
const auth = loadAuth();
await initialize(auth);

await mcpCall(auth, "navigate", { url: EDIT });
await sleep(3000);
await mcpCall(auth, "dismiss_overlays");

await mcpCall(auth, "execute", {
  script: `(() => {
    const nav = Array.from(document.querySelectorAll('a,li,div,span')).find(el => (el.innerText||'').trim()==='产品信息' && el.getBoundingClientRect().width>0 && el.getBoundingClientRect().width<120);
    nav?.click();
    const label = Array.from(document.querySelectorAll('label,div,span')).find(el => (el.innerText||'').trim()==='产品图片' && el.children.length<5);
    label?.scrollIntoView({ block:'start' });
  })()`,
});
await sleep(800);

console.log("=== menu_click 编辑图片 → 图片翻译 ===");
const r = await mcpCall(auth, "menu_click", { trigger: "编辑图片", item: "图片翻译" });
console.log(JSON.stringify(r).slice(0, 800));
await sleep(1500);

const portals = await mcpCall(auth, "list_portals");
console.log("portals", JSON.stringify(portals?.data).slice(0, 400));

const modal = await mcpCall(auth, "execute", {
  script: `(() => {
    const wrap = Array.from(document.querySelectorAll('.ant-modal-wrap')).find(w => getComputedStyle(w).display !== 'none');
    return { title: wrap?.querySelector('.ant-modal-title')?.innerText?.trim() || null };
  })()`,
});
console.log("modal", JSON.stringify(modal?.data?.result));

const snap = await mcpCall(auth, "snapshot", { selector: "翻译" });
console.log(
  "snap portal-ish",
  (snap?.data?.portalItems || []).slice(0, 10),
  "elements",
  (snap?.data?.elements || []).slice(0, 5).map((e) => ({ ref: e.ref, name: e.name, inPortal: e.inPortal })),
);

process.exit(r?.ok && modal?.data?.result?.title === "图片翻译" ? 0 : 1);
