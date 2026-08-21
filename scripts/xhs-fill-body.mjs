#!/usr/bin/env node
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadAuth, initialize, mcpCall, sleep } from "./mcp-helpers.mjs";

const TITLE = "Sparo浏览器——AI终于有了自己的手。";

function loadBody() {
  const p = join(homedir(), "Desktop", "Sparo小红书长文.md");
  const raw = readFileSync(p, "utf8");
  return raw.slice(raw.indexOf("## 正文")).replace(/^## 正文\s*/, "").trim();
}

function p(label, r) {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(r, null, 2).slice(0, 1500));
}

async function main() {
  const auth = loadAuth();
  await initialize(auth);
  await mcpCall(auth, "resume", {}).catch(() => {});
  const body = loadBody();

  // Ensure editor open + snapshot
  let snap = await mcpCall(auth, "snapshot", {});
  p("snap", {
    message: snap.message,
    els: (snap.data?.elements || []).map((e) => ({
      ref: e.ref,
      name: (e.name || "").slice(0, 40),
      role: e.role,
      tag: e.tag,
      ph: e.placeholder,
    })),
  });

  // Title e13
  let r = await mcpCall(auth, "fill", { ref: "e13", value: TITLE });
  p("title", {
    ok: r.ok,
    message: r.message,
    actual: r.data?.actual,
    method: r.data?.method,
  });

  // Body: TipTap ProseMirror e14
  // Click to focus first
  r = await mcpCall(auth, "click", { ref: "e14" });
  p("click body", r);
  await sleep(300);

  r = await mcpCall(auth, "fill", { ref: "e14", value: body });
  p("fill body e14", {
    ok: r.ok,
    message: r.message,
    matched: r.data?.matched,
    method: r.data?.method,
    actualLen: String(r.data?.actual || "").length,
    actualHead: String(r.data?.actual || "").slice(0, 120),
    mojibake: /ä½|Ã/.test(String(r.data?.actual || "")),
  });

  // If fill failed on ProseMirror, try execCommand path via execute
  if (!r.ok || !r.data?.matched) {
    r = await mcpCall(auth, "execute", {
      script: `(() => {
        const el = document.querySelector('[data-spark-ref="e14"]') || document.querySelector('.tiptap.ProseMirror');
        if (!el) return { ok:false, msg:'no editor' };
        el.focus();
        // select all
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
        const text = ${JSON.stringify(body)};
        const ok = document.execCommand('insertText', false, text);
        return { ok, len: (el.innerText||'').length, head: (el.innerText||'').slice(0,80) };
      })()`,
    });
    p("execCommand body", r);
  }

  await sleep(800);
  const verify = await mcpCall(auth, "page_text", {});
  const t = verify.data?.text || "";
  p("verify", {
    len: t.length,
    hasTitle: t.includes("自己的手"),
    hasBody: t.includes("操作网页的手"),
    wordCountLine: (t.match(/字数：\\d+/) || [])[0],
    mojibake: /ä½|Ã/.test(t),
    snippet: t.slice(0, 600),
  });

  // Look for 发布 note button - might be in top bar
  snap = await mcpCall(auth, "snapshot", {});
  const actions = (snap.data?.elements || []).filter((e) =>
    /发布|暂存|预览|排版|返回/.test(e.name || ""),
  );
  p(
    "actions",
    actions.map((e) => ({ ref: e.ref, name: e.name })),
  );

  // Save skill if title+body look good
  const okContent =
    t.includes("自己的手") &&
    (t.includes("操作网页的手") || String(r.data?.actual || "").includes("操作网页的手") || (r?.data?.result?.len || 0) > 100);

  if (okContent || t.includes("自己的手")) {
    // Start recording is for human actions — instead write a skill JSON manually
    const skillDir =
      process.platform === "win32" && process.env.APPDATA
        ? join(process.env.APPDATA, "sparo", "skills")
        : join(homedir(), ".config", "sparo", "skills");
    mkdirSync(skillDir, { recursive: true });
    const skill = {
      id: "xhs-longform-sparo-intro",
      title: "小红书长文：打开编辑器并填入标题正文（Sparo 介绍稿）",
      platform: "xiaohongshu-creator",
      createdAt: new Date().toISOString(),
      notes:
        "Requires logged-in creator.xiaohongshu.com. Does not auto-click 发布 — human confirms. Uses fill-unicode-v2.",
      steps: [
        {
          tool: "navigate",
          args: {
            url: "https://creator.xiaohongshu.com/publish/publish?target=article",
          },
        },
        { tool: "click_text", args: { text: "写长文" } },
        { tool: "click_text", args: { text: "新的创作" } },
        { tool: "wait_for", args: { text: "输入标题", timeoutMs: 8000 } },
        { tool: "snapshot", args: {} },
        {
          tool: "fill",
          args: { ref: "e13", value: "{{title}}" },
          hint: "title textarea placeholder 输入标题",
        },
        { tool: "click", args: { ref: "e14" }, hint: "TipTap ProseMirror body" },
        {
          tool: "fill",
          args: { ref: "e14", value: "{{body}}" },
          hint: "rich text body",
        },
        { tool: "pause", args: {}, hint: "Human reviews and clicks 发布" },
      ],
      lastRun: {
        titleFilled: t.includes("自己的手"),
        bodyFilled: t.includes("操作网页的手"),
        verifySnippet: t.slice(0, 300),
      },
    };
    const path = join(skillDir, "xhs-longform-sparo-intro.json");
    writeFileSync(path, JSON.stringify(skill, null, 2), "utf8");
    console.log("\nSKILL_SAVED", path);
  }

  await mcpCall(auth, "pause", {});
  console.log("\nHuman: review window, click 发布 if OK.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
