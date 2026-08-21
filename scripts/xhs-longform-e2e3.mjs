#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadAuth, initialize, mcpCall, sleep } from "./mcp-helpers.mjs";

const TITLE = "Sparo浏览器——AI终于有了自己的手。";

function loadBody() {
  const p = join(homedir(), "Desktop", "Sparo小红书长文.md");
  if (!existsSync(p)) throw new Error("missing desktop md: " + p);
  const raw = readFileSync(p, "utf8");
  const idx = raw.indexOf("## 正文");
  return raw
    .slice(idx)
    .replace(/^## 正文\s*/, "")
    .trim();
}

function p(label, r) {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(r, null, 2).slice(0, 2000));
}

async function main() {
  const auth = loadAuth();
  await initialize(auth);
  await mcpCall(auth, "resume", {}).catch(() => {});

  const body = loadBody();
  console.log("BODY_LEN", body.length, "HEAD", body.slice(0, 40));

  // Full probe of editors on main doc
  let r = await mcpCall(auth, "execute", {
    script: `(() => {
      const all = [...document.querySelectorAll('input,textarea,[contenteditable],[role=textbox],.ql-editor,.ProseMirror,[class*=editor],[class*=Editor]')];
      return all.map((el,i) => {
        const rect = el.getBoundingClientRect();
        return {
          i,
          tag: el.tagName,
          id: el.id||'',
          ph: el.placeholder||'',
          role: el.getAttribute('role')||'',
          ce: el.getAttribute('contenteditable')||String(el.isContentEditable),
          cls: String(el.className||'').slice(0,100),
          w: Math.round(rect.width), h: Math.round(rect.height),
          y: Math.round(rect.y),
          val: (el.value||el.innerText||'').slice(0,40),
          spark: el.getAttribute('data-spark-ref')||''
        };
      }).filter(x => x.w>10 && x.h>5);
    })()`,
  });
  p("editors", r);

  const editors = r?.data?.result || [];
  const title = editors.find((e) => e.ph.includes("标题") || e.ph.includes("输入标题"));
  const bodyEd =
    editors.find((e) => e.ce === "true" || e.cls.includes("editor") || e.cls.includes("ql-")) ||
    editors.find((e) => e.tag === "TEXTAREA" && !e.ph.includes("标题") && e.h > 40) ||
    editors.find((e) => e.h > 80);

  p("picked", { title, bodyEd });

  // Ensure title
  if (title?.spark) {
    r = await mcpCall(auth, "fill", { ref: title.spark, value: TITLE });
    p("refill title", { ok: r.ok, message: r.message, actual: r.data?.actual });
  } else if (title) {
    // mark and fill via execute then Input.insertText path using fill by selector
    r = await mcpCall(auth, "execute", {
      script: `(() => {
        const el = document.querySelectorAll('input,textarea,[contenteditable]')[${title.i}];
        if (!el) return {ok:false};
        el.setAttribute('data-spark-ref','xhs-title');
        return {ok:true};
      })()`,
    });
    // wrong index - use placeholder
    r = await mcpCall(auth, "execute", {
      script: `(() => {
        const el = [...document.querySelectorAll('textarea,input')].find(e => (e.placeholder||'').includes('标题') || (e.placeholder||'').includes('输入标题'));
        if (!el) return {ok:false};
        el.setAttribute('data-spark-ref','xhs-title');
        el.focus();
        return {ok:true, ph: el.placeholder};
      })()`,
    });
    p("mark title", r);
    r = await mcpCall(auth, "fill", { ref: "xhs-title", value: TITLE });
    p("fill title", { ok: r.ok, message: r.message, actual: r.data?.actual, method: r.data?.method });
  }

  // Mark body editor
  r = await mcpCall(auth, "execute", {
    script: `(() => {
      const all = [...document.querySelectorAll('[contenteditable="true"],[contenteditable=""],[role=textbox],.ql-editor,.ProseMirror,textarea')];
      const visible = all.filter(el => {
        const r = el.getBoundingClientRect();
        const ph = el.placeholder||'';
        if (ph.includes('标题') || ph.includes('输入标题')) return false;
        return r.width > 100 && r.height > 40;
      });
      if (!visible.length) return { ok:false, count:0 };
      // prefer tallest
      visible.sort((a,b)=>b.getBoundingClientRect().height - a.getBoundingClientRect().height);
      const el = visible[0];
      el.setAttribute('data-spark-ref','xhs-body');
      el.scrollIntoView({block:'center'});
      el.focus();
      const r = el.getBoundingClientRect();
      return { ok:true, tag: el.tagName, cls: String(el.className||'').slice(0,80), h: r.height, w: r.width, ce: el.isContentEditable };
    })()`,
  });
  p("mark body", r);

  if (r?.data?.result?.ok) {
    const fill = await mcpCall(auth, "fill", { ref: "xhs-body", value: body });
    p("fill body", {
      ok: fill.ok,
      message: fill.message,
      matched: fill.data?.matched,
      method: fill.data?.method,
      actualHead: String(fill.data?.actual || "").slice(0, 100),
      actualLen: String(fill.data?.actual || "").length,
      mojibake: /ä½|Ã/.test(String(fill.data?.actual || "")),
    });
  }

  await sleep(500);
  const verify = await mcpCall(auth, "page_text", {});
  const t = verify.data?.text || "";
  p("verify", {
    len: t.length,
    hasTitle: t.includes("自己的手") || t.includes("Sparo浏览器"),
    hasBody: t.includes("操作网页的手") || t.includes("人机"),
    mojibake: /ä½|Ã/.test(t),
    snippet: t.slice(0, 500),
  });

  const snap = await mcpCall(auth, "snapshot", {});
  const pubs = (snap.data?.elements || []).filter((e) =>
    /发布|存草稿|预览|一键排版|暂存/.test(e.name || ""),
  );
  p(
    "actions",
    pubs.map((e) => ({ ref: e.ref, name: e.name })),
  );

  // Also list by click_text candidates
  for (const text of ["发布", "存草稿", "暂存离开", "一键排版"]) {
    const found = await mcpCall(auth, "contains_text", { text });
    console.log("contains", text, found);
  }

  console.log("\nPaused for human to review & click 发布");
  await mcpCall(auth, "pause", {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
