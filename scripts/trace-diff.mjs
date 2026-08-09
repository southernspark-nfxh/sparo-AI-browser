#!/usr/bin/env node
/**
 * P2: Compare a recorded human trace vs an AI replay attempt.
 *
 * Usage:
 *   node scripts/trace-diff.mjs <reference.trace.json> <replay.trace.json>
 *   node scripts/trace-diff.mjs --latest
 *
 * --latest: pick the two newest traces in %APPDATA%/sparo/traces
 *           (older = reference, newer = replay) or compare newest to strategies reference.
 */
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

function tracesDir() {
  return process.platform === "win32" && process.env.APPDATA
    ? join(process.env.APPDATA, "sparo", "traces")
    : join(homedir(), ".config", "sparo", "traces");
}

function loadTrace(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return {
    path,
    platform: raw.platform,
    task: raw.task,
    url: raw.url,
    steps: Array.isArray(raw.steps) ? raw.steps : [],
  };
}

function normText(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function stepKey(step) {
  return `${step.action || "?"}::${normText(step.text) || step.selector || ""}`;
}

function alignSteps(refSteps, replaySteps) {
  const diffs = [];
  const n = Math.max(refSteps.length, replaySteps.length);
  for (let i = 0; i < n; i++) {
    const a = refSteps[i];
    const b = replaySteps[i];
    if (!a && b) {
      diffs.push({
        i: i + 1,
        kind: "extra_in_replay",
        replay: { action: b.action, text: normText(b.text), selector: b.selector },
      });
      continue;
    }
    if (a && !b) {
      diffs.push({
        i: i + 1,
        kind: "missing_in_replay",
        reference: { action: a.action, text: normText(a.text), selector: a.selector },
        hint: "AI 少做了这一步——可能是 Portal 未打开、弹窗遮挡、或选择器漂移",
      });
      continue;
    }
    const ka = stepKey(a);
    const kb = stepKey(b);
    if (ka !== kb) {
      diffs.push({
        i: i + 1,
        kind: "action_mismatch",
        reference: { action: a.action, text: normText(a.text), selector: a.selector },
        replay: { action: b.action, text: normText(b.text), selector: b.selector },
        hint: classifyMismatch(a, b),
      });
    } else if (
      a.elapsed_ms != null &&
      b.elapsed_ms != null &&
      Math.abs(a.elapsed_ms - b.elapsed_ms) > 3000
    ) {
      diffs.push({
        i: i + 1,
        kind: "timing_drift",
        referenceMs: a.elapsed_ms,
        replayMs: b.elapsed_ms,
        hint: "时序差异大——可能缺等待/异步弹窗未 settle",
      });
    }
  }
  return diffs;
}

function classifyMismatch(a, b) {
  const at = normText(a.text);
  const bt = normText(b.text);
  if (/编辑图片|下拉|dropdown/i.test(at) || /编辑图片/.test(bt)) {
    return "疑似 Portal/下拉问题：检查 menu_click、是否去掉了合成 DOM 双击";
  }
  if (/翻译|一键/.test(at) || /翻译|一键/.test(bt)) {
    return "疑似翻译弹窗/菜单项未点到：用 click_text + withinPortal 或 caret";
  }
  if (/关闭|遮罩|modal/i.test(at + bt)) {
    return "疑似弹窗残留：先 dismiss_overlays";
  }
  if ((a.action || "") !== (b.action || "")) {
    return "动作类型不一致：检查策略 YAML 步骤顺序";
  }
  return "选择器或文案漂移：更新 strategies/*.yaml 或重录 reference_trace";
}

function main() {
  const args = process.argv.slice(2);
  let refPath;
  let replayPath;

  if (args[0] === "--latest") {
    const dir = tracesDir();
    if (!existsSync(dir)) {
      console.error("No traces dir:", dir);
      process.exit(1);
    }
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".trace.json"))
      .map((f) => join(dir, f))
      .sort();
    if (files.length < 2) {
      console.error("Need at least 2 traces in", dir);
      process.exit(1);
    }
    refPath = files[files.length - 2];
    replayPath = files[files.length - 1];
  } else if (args.length >= 2) {
    refPath = args[0];
    replayPath = args[1];
  } else {
    console.log(`Usage:
  node scripts/trace-diff.mjs <reference.trace.json> <replay.trace.json>
  node scripts/trace-diff.mjs --latest`);
    process.exit(1);
  }

  const ref = loadTrace(refPath);
  const replay = loadTrace(replayPath);
  const diffs = alignSteps(ref.steps, replay.steps);

  const report = {
    ok: diffs.length === 0,
    reference: { path: ref.path, steps: ref.steps.length, url: ref.url },
    replay: { path: replay.path, steps: replay.steps.length, url: replay.url },
    diffCount: diffs.length,
    diffs,
    summary:
      diffs.length === 0
        ? "轨迹一致"
        : `发现 ${diffs.length} 处差异；优先看 missing_in_replay / action_mismatch`,
  };

  const outDir = tracesDir();
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `diff_${Date.now()}.json`);
  writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");

  console.log(JSON.stringify(report, null, 2));
  console.log("\nSaved:", outFile);
  process.exit(report.ok ? 0 : 2);
}

main();
