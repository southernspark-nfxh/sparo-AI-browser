// 批量发布：串行调用 publish.mjs，每篇分配一个定时时间，失败不中断
// 用法：
//   node batch_publish.mjs --plan <计划.json>                # 按计划文件跑
//   node batch_publish.mjs --root <目录> --platform baijiahao --start "2026-11-11 16:30" --interval 30 --count 20
//   node batch_publish.mjs --plan <计划.json> --from 5        # 从第5篇续跑
//
// 计划文件格式（JSON 数组）：
//   [ { "dir": "<文章目录>", "schedule": "2026-11-11 16:30" }, ... ]
//
// 每篇独立调用 publish.mjs，退出码 != 0 记为失败，继续下一篇。
// 运行结束后输出 summary + 写 ledger 到 scripts/ledger/batch_<timestamp>.jsonl

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendLegacyLedger } from "./ledger.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLISH = path.join(__dirname, "publish.mjs");

function parseArgs(argv) {
  const out = { plan: "", root: "", platform: "", start: "", interval: 30, count: 0, from: 0, ledger: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--plan") out.plan = argv[++i] || "";
    else if (a === "--root") out.root = argv[++i] || "";
    else if (a === "--platform") out.platform = argv[++i] || "";
    else if (a === "--start") out.start = argv[++i] || "";
    else if (a === "--interval") out.interval = Number(argv[++i] || "30");
    else if (a === "--count") out.count = Number(argv[++i] || "0");
    else if (a === "--from") out.from = Number(argv[++i] || "0");
    else if (a === "--ledger") out.ledger = argv[++i] || "";
  }
  return out;
}

// 根据根目录 + 参数自动生成排期
function buildPlan(root, platform, start, interval, count) {
  if (!root || !platform || !start) {
    console.error("缺少 --root / --platform / --start 参数，或提供 --plan 计划文件");
    process.exit(2);
  }
  const startDate = new Date(start.replace(" ", "T"));
  if (isNaN(startDate.getTime())) {
    console.error("--start 格式应为 YYYY-MM-DD HH:mm");
    process.exit(2);
  }

  // 递归找所有含 title.txt 的目录
  const articleDirs = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (name === "title.txt") articleDirs.push(path.dirname(full));
    }
  }
  walk(root);
  articleDirs.sort(); // 按路径字典序

  const take = count > 0 ? articleDirs.slice(0, count) : articleDirs;
  const plan = take.map((dir, i) => {
    const t = new Date(startDate.getTime() + i * interval * 60000);
    const pad = (n) => String(n).padStart(2, "0");
    const schedule = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
    return { dir, schedule };
  });
  return plan;
}

async function runOne(platform, dir, schedule) {
  return new Promise((resolve) => {
    const args = [
      PUBLISH,
      "--platform", platform,
      "--article", dir,
      "--schedule", schedule,
    ];
    const child = spawn(process.execPath, args, {
      cwd: __dirname,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("close", (code) => {
      // publish.mjs 本身输出 JSON 报告到最后一行，尝试解析
      let report = null;
      const lines = (out + err).trim().split("\n");
      for (let i = lines.length - 1; i >= 0; i--) {
        const l = lines[i].trim();
        if (l.startsWith("{") && l.includes('"ok"')) {
          try { report = JSON.parse(l); break; } catch { /* continue */ }
        }
      }
      resolve({
        ok: code === 0,
        code,
        step: report?.step || "",
        reason: report?.reason || "",
        detail: report || null,
        tail: lines.slice(-3).join("\n"),
      });
    });
  });
}

function log(msg) {
  const t = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  console.log(`[${t}] ${msg}`);
}

function saveLedger(ledgerPath, entries) {
  const saved = appendLegacyLedger(ledgerPath, { time: new Date().toISOString(), entries });
  if (!saved.ok) throw new Error(saved.message || "台账没有写下");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let plan;
  if (args.plan) {
    const raw = fs.readFileSync(args.plan, "utf8");
    plan = JSON.parse(raw);
  } else {
    plan = buildPlan(args.root, args.platform, args.start, args.interval, args.count);
  }
  if (!plan.length) {
    console.error("计划为空，没有可发布的文章");
    process.exit(2);
  }

  // 确定平台（从计划或参数）
  const platform = args.platform || (plan[0].platform) || "baijiahao";

  // 续跑
  const from = args.from || 0;
  const toRun = plan.slice(from);

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const ledgerPath = args.ledger || path.join(__dirname, "ledger", `batch_${ts}.jsonl`);

  log(`===== 批量发布开始 =====`);
  log(`平台: ${platform}`);
  log(`总数: ${plan.length}，本次跑: ${toRun.length}（从 #${from + 1} 起）`);
  log(`台账: ${ledgerPath}`);
  log("");

  const results = [];
  let ok = 0, fail = 0;

  for (let i = 0; i < toRun.length; i++) {
    const item = toRun[i];
    const idx = from + i + 1;
    const name = path.basename(item.dir);
    const relDir = path.relative(path.dirname(item.dir), item.dir);
    log(`[${idx}/${plan.length}] ▶ ${relDir} → ${item.schedule}`);

    const r = await runOne(platform, item.dir, item.schedule);
    results.push({ idx, dir: item.dir, schedule: item.schedule, ...r });

    if (r.ok) {
      ok++;
      log(`       ✅ 成功`);
    } else {
      fail++;
      log(`       ❌ 失败 (code=${r.code}) step=${r.step || "-"} reason=${r.reason || "-"}`);
      if (r.tail) log(`       tail: ${r.tail.replace(/\n/g, " | ")}`);
    }
    log("");

    // 每篇之间等 2 秒让页面稳定
    if (i < toRun.length - 1) await new Promise((r) => setTimeout(r, 2000));
  }

  // Summary
  log("===== 批量发布结束 =====");
  log(`总计: ${plan.length} 篇 | 成功: ${ok} | 失败: ${fail}`);
  if (fail > 0) {
    log("");
    log("失败列表：");
    for (const r of results.filter((x) => !x.ok)) {
      log(`  #${r.idx} ${path.basename(r.dir)} — ${r.step || "?"} / ${r.reason || "?"}`);
    }
  }

  saveLedger(ledgerPath, results);
  log("");
  log(`已写入台账: ${ledgerPath}`);

  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("BATCH_FATAL:", e);
  process.exit(2);
});
