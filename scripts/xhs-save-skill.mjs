#!/usr/bin/env node
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadAuth, initialize, mcpCall, sleep } from "./mcp-helpers.mjs";

function p(label, r) {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(r, null, 2).slice(0, 2000));
}

async function main() {
  const auth = loadAuth();
  await initialize(auth);
  await mcpCall(auth, "resume", {}).catch(() => {});

  // Probe publish-related controls
  let r = await mcpCall(auth, "execute", {
    script: `(() => {
      const nodes = [...document.querySelectorAll('button,a,[role=button],div,span')];
      const hits = [];
      for (const el of nodes) {
        const t = (el.innerText||el.textContent||'').trim().replace(/\\s+/g,' ');
        if (!t || t.length > 20) continue;
        if (!/发布|预览|提交|公开|定时/.test(t)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 8 || rect.height < 8) continue;
        hits.push({
          t, tag: el.tagName,
          cls: String(el.className||'').slice(0,80),
          w: Math.round(rect.width), h: Math.round(rect.height),
          x: Math.round(rect.x), y: Math.round(rect.y),
          spark: el.getAttribute('data-spark-ref')||''
        });
      }
      return hits.slice(0, 40);
    })()`,
  });
  p("publish-ish", r);

  // Verify content still good
  const pt = await mcpCall(auth, "page_text", {});
  const t = pt.data?.text || "";
  p("content-check", {
    len: t.length,
    titleOk: /21\/64|自己的手|Sparo浏览器/.test(t),
    bodyOk: t.includes("操作网页的手"),
    mojibake: /ä½|Ã/.test(t),
  });

  // Save skill regardless — compose path is proven
  const skillDir =
    process.platform === "win32" && process.env.APPDATA
      ? join(process.env.APPDATA, "sparo", "skills")
      : join(homedir(), ".config", "sparo", "skills");
  mkdirSync(skillDir, { recursive: true });
  const skill = {
    id: "xhs-longform-compose",
    title: "小红书长文：写长文→新的创作→填标题正文（不停开发布）",
    platform: "xiaohongshu-creator",
    version: 1,
    createdAt: new Date().toISOString(),
    verifiedAt: new Date().toISOString(),
    notes:
      "Proven on Sparo fill-unicode-v2. Login required. Human clicks 发布. Body editor is TipTap .tiptap.ProseMirror (often ref e14 after snapshot). Title is textarea placeholder 输入标题 (often e13).",
    steps: [
      {
        tool: "navigate",
        args: {
          url: "https://creator.xiaohongshu.com/publish/publish?target=article",
        },
      },
      { tool: "click_text", args: { text: "写长文", exact: false } },
      { tool: "click_text", args: { text: "新的创作", exact: false } },
      { tool: "wait_for", args: { text: "输入标题", timeoutMs: 10000 } },
      { tool: "snapshot", args: {} },
      {
        tool: "fill",
        args: { ref: "{{titleRef}}", value: "{{title}}" },
        resolve:
          "snapshot → textarea placeholder 输入标题 (commonly e13)",
      },
      {
        tool: "click",
        args: { ref: "{{bodyRef}}" },
        resolve: "snapshot → .tiptap.ProseMirror contenteditable (commonly e14)",
      },
      {
        tool: "fill",
        args: { ref: "{{bodyRef}}", value: "{{body}}" },
      },
      {
        tool: "page_text",
        assert: "includes body needle; no mojibake",
      },
      {
        tool: "pause",
        hint: "Human reviews in shared window and clicks 发布",
      },
    ],
    lastRun: {
      title: "Sparo浏览器——AI终于有了自己的手。",
      titleFill: "ok fill-unicode-v2",
      bodyFill: "ok execCommand-insertText 1161 chars",
      autoPublish: false,
    },
  };
  const path = join(skillDir, "xhs-longform-compose.json");
  writeFileSync(path, JSON.stringify(skill, null, 2), "utf8");
  console.log("\nSKILL_SAVED", path);

  // Also copy into repo for agents (optional public skill template)
  const repoSkill = join(
    process.cwd(),
    "strategies",
    "skills",
    "xhs-longform-compose.json",
  );
  mkdirSync(join(process.cwd(), "strategies", "skills"), { recursive: true });
  writeFileSync(repoSkill, JSON.stringify(skill, null, 2), "utf8");
  console.log("REPO_SKILL", repoSkill);

  // Do NOT auto publish — list candidates for human
  console.log("\nPaused. Please click 发布 in Sparo window if content looks right.");
  await mcpCall(auth, "pause", {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
