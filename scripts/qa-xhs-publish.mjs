#!/usr/bin/env node
/**
 * QA: Xiaohongshu long-form inject path (agent-facing).
 *
 * Usage:
 *   node scripts/qa-xhs-publish.mjs
 *
 * Requires: Sparo running + human logged into creator.xiaohongshu.com
 *
 * Flow under test:
 *   ensure_editor → inject_compose → xhs_layout_next → inject_publish → pause
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadAuth, initialize, mcpCall, sleep } from "./mcp-helpers.mjs";

function log(step, obj) {
  const line = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  console.log(`\n=== ${step} ===\n${line.slice(0, 2500)}`);
}

function extractMd(path) {
  const md = readFileSync(path, "utf8");
  const title =
    md.match(/##\s*标题\s*\n+([^\n#]+)/)?.[1]?.trim() ||
    "Sparo浏览器——AI终于有了自己的手。";
  const body =
    md.match(/##\s*正文\s*\n+([\s\S]*?)(?=\n##\s|$)/)?.[1]?.trim() || md;
  return { title, body };
}

function finish(report) {
  const dir = join(homedir(), "AppData", "Roaming", "sparo", "diag");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `qa-xhs-publish-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2), "utf8");
  console.log("\nREPORT", file);
  console.log("RESULT ok=" + report.ok + " error=" + (report.error || "-"));
}

async function main() {
  const report = { startedAt: new Date().toISOString(), steps: [], ok: false };
  const auth = loadAuth();
  await initialize(auth);
  await mcpCall(auth, "resume", {}).catch(() => {});

  const mdPath =
    process.env.XHS_MD || join(homedir(), "Desktop", "Sparo小红书长文.md");
  const { title, body } = existsSync(mdPath)
    ? extractMd(mdPath)
    : {
        title: "Sparo浏览器——AI终于有了自己的手。",
        body: "Sparo 不做插件，也不模拟人类。它是人和 AI 共同使用的一个浏览器。",
      };
  const topics = ["#Sparo浏览器", "#AI工具", "#开源"];
  const summary = "Sparo 人机同窗浏览器：AI 终于有了自己的手。";

  const run = async (name, args = {}) => {
    const t0 = Date.now();
    const parsed = await mcpCall(auth, name, args);
    const entry = {
      tool: name,
      ms: Date.now() - t0,
      ok: Boolean(parsed.ok),
      message: parsed.message,
      data: parsed.data,
    };
    report.steps.push(entry);
    log(`${name} (${entry.ms}ms) ok=${entry.ok}`, parsed);
    return parsed;
  };

  const info = await run("sparo_info", {});
  if (!String(JSON.stringify(info)).includes("xhs_inject_compose")) {
    report.error = "xhs_inject_compose missing — restart Sparo after build";
    throw new Error(report.error);
  }
  if (!String(JSON.stringify(info)).includes("xhs_layout_next")) {
    report.warn = "xhs_layout_next missing from sparo_info — restart Sparo";
    console.warn(report.warn);
  }

  await run("navigate", {
    url: "https://creator.xiaohongshu.com/publish/publish?target=article",
  });
  await sleep(2000);

  let stage = await run("xhs_page_stage", {});
  report.stageBefore = stage.data;

  let ensure = await run("xhs_ensure_editor", {});
  if (!ensure.ok) {
    await sleep(1500);
    ensure = await run("xhs_ensure_editor", {});
  }
  await sleep(1000);
  stage = await run("xhs_page_stage", {});
  report.stageAfterEnsure = stage.data;

  // If already on publish/layout from prior QA, still try to go back to compose via ensure
  if (stage.data?.stage === "publish" || stage.data?.stage === "layout") {
    report.note = "already past compose — will still try layout_next / inject_publish";
  }

  if (stage.data?.stage === "compose" || stage.data?.stage === "chooser") {
    const inj = await run("xhs_inject_compose", { title, body, force: true });
    if (!inj.ok) {
      await run("diagnose", { label: "qa-inject-compose-fail" });
      report.error = "inject_compose failed";
      finish(report);
      process.exit(3);
    }
    const pt = await run("page_text", {});
    const text = pt.data?.text || "";
    report.verifyCompose = {
      titleHit: text.includes(title.slice(0, 8)) || text.includes("自己的手"),
      bodyHit: text.includes("操作网页的手") || (inj.data?.bodyLen || 0) > 20,
    };
  }

  // layout → publish (handles wait for template panel)
  let layout = await run("xhs_layout_next", {
    template: "简约基础",
    timeoutMs: 35000,
  });
  if (!layout.ok) {
    // fallback: maybe tool missing — try long wait path via execute is not ideal
    await run("diagnose", { label: "qa-layout-next-fail" });
    report.error = "xhs_layout_next failed: " + layout.message;
    // still try inject if somehow on publish
  }

  await sleep(1500);
  stage = await run("xhs_page_stage", {});
  report.stageAfterLayout = stage.data;

  if (stage.data?.stage === "publish" || stage.data?.onPublishPage || stage.data?.hasTopic) {
    const pub = await run("xhs_inject_publish", { summary, topics });
    report.injectPublish = pub;
  } else {
    report.error = report.error || "not on publish stage after layout_next";
    await run("diagnose", { label: "qa-no-publish-stage" });
  }

  await run("pause", {});
  report.ok =
    !report.error &&
    (report.stageAfterLayout?.stage === "publish" ||
      report.stageAfterLayout?.onPublishPage ||
      report.injectPublish?.ok);
  report.finishedAt = new Date().toISOString();
  finish(report);
  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
