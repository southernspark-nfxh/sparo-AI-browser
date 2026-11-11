// 生成完整发布状态报告
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 1. 读取批次计划
const planPath = "D:\\文字游戏引擎和游戏设计\\故事引擎8.0\\baijiahao_schedule_plan.json";
const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
console.log("=== 批次计划 ===");
console.log(`共 ${plan.length} 篇\n`);

// 2. 读取台账（只看 ok=true 的成功）
const ledgerPath = path.join(__dirname, "..", "ledger", "2026-11.jsonl");
const ledgerRaw = fs.readFileSync(ledgerPath, "utf8").trim().split("\n");
const successes = ledgerRaw
  .map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  })
  .filter((j) => j && j.ok === true);

console.log(`台账总行数: ${ledgerRaw.length}`);
console.log(`成功条目: ${successes.length}\n`);

// 3. 检查目录里所有稿件
const rootDir = "D:\\文字游戏引擎和游戏设计\\AAA媒体矩阵自动发布\\02_发布包\\20261111_长征系列23篇";

function walkTitleFiles(dir) {
  const results = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      results.push(...walkTitleFiles(full));
    } else if (name === "title.txt") {
      results.push({
        dir: path.dirname(full),
        title: fs.readFileSync(full, "utf8").trim(),
        titleFile: full,
      });
    }
  }
  return results;
}

const allArticles = walkTitleFiles(rootDir).sort((a, b) => a.dir.localeCompare(b.dir));
console.log(`目录稿件总数: ${allArticles.length}\n`);

// 4. 读每篇的其他文件
function readArticleFiles(dir) {
  const files = { dir };
  const tpath = path.join(dir, "title.txt");
  const bpath = path.join(dir, "body.md");
  const cpath = path.join(dir, "cover.jpg");
  files.title = fs.existsSync(tpath) ? fs.readFileSync(tpath, "utf8").trim() : "[无 title.txt]";
  files.hasBody = fs.existsSync(bpath);
  files.bodyLen = files.hasBody ? fs.readFileSync(bpath, "utf8").length : 0;
  files.hasCover = fs.existsSync(cpath);
  // images 目录
  const imgDir = path.join(dir, "images");
  files.imageCount = fs.existsSync(imgDir)
    ? fs.readdirSync(imgDir).filter((n) => /\.(jpg|jpeg|png|gif|webp)$/i.test(n)).length
    : 0;
  // Day 编号
  const dayMatch = dir.match(/Day(\d)_/);
  files.day = dayMatch ? `Day${dayMatch[1]}` : "?";
  const numMatch = dir.match(/\\(\d{2})_/);
  files.num = numMatch ? numMatch[1] : "??";
  files.folderName = path.basename(dir);
  return files;
}

const enriched = allArticles.map((a) => readArticleFiles(a.dir));

// 5. 标记发布状态
// 成功列表里有两个立即发布（Day1/01 显卡降价, Day1/04 收官）+ 1 个定时（Day1/02 Token）
// 其余 20 篇全未发布
// 但台账里只有失败 — 让我用目录名来对照

// 百家号"待发布"tab 里看到的定时稿（不是长征系列，是之前的其他稿子）
// 长征系列成功的 3 篇：显卡降价(立即), 收官(立即), Token(定时16:10)
const successDirs = new Set([
  // Day1 已发的 3 篇
  path.join(rootDir, "Day1_1111", "01_显卡降价"),
  path.join(rootDir, "Day1_1111", "02_Token科普"),
  path.join(rootDir, "Day1_1111", "04_收官成绩单"),
]);

// 从批次计划里也找一下
for (const item of plan) {
  // 检查台账里是否有这篇成功的
  const dirName = path.basename(item.dir);
  const found = successes.some((s) => s.title && s.title.includes(dirName.slice(0, 10)));
  if (found) successDirs.add(item.dir);
}

// 也从台账里直接抽所有"成功"的 title
const successTitles = successes.map((s) => s.title).filter(Boolean);

function matchTitle(articleTitle) {
  return successTitles.some((t) => articleTitle && articleTitle.includes(t.slice(0, 15)));
}

const final = enriched.map((a) => {
  const dirInPlan = plan.find((p) => p.dir === a.dir);
  const isPublished = successDirs.has(a.dir) || matchTitle(a.title);
  return {
    ...a,
    status: isPublished ? "✅ 已发布" : "❌ 未发布",
    scheduled: dirInPlan ? dirInPlan.schedule : null,
    inPlan: !!dirInPlan,
  };
});

console.log("=== 发布状态汇总 ===\n");

const published = final.filter((a) => a.status === "✅ 已发布");
const unpublished = final.filter((a) => a.status === "❌ 未发布");

console.log(`✅ 已发布: ${published.length} 篇`);
published.forEach((a) => {
  console.log(`   ${a.day}/${a.num} ${a.folderName.padEnd(20)} ${a.title.slice(0, 40)}`);
});

console.log(`\n❌ 未发布: ${unpublished.length} 篇`);
unpublished.forEach((a) => {
  const sched = a.scheduled ? ` 计划:${a.scheduled}` : " 无排期";
  const missing = [];
  if (!a.hasBody) missing.push("无正文");
  if (!a.hasCover) missing.push("无封面");
  if (a.bodyLen === 0) missing.push("空正文");
  console.log(`   ${a.day}/${a.num} ${a.folderName.padEnd(20)} ${a.title.slice(0, 40)}${sched}${missing.length ? " ⚠️" + missing.join(",") : ""}`);
});

// 6. 写出 JSON 报告
const report = {
  generatedAt: new Date().toISOString(),
  summary: {
    total: final.length,
    published: published.length,
    unpublished: unpublished.length,
  },
  published: published,
  unpublished: unpublished,
};

const outPath = path.join(__dirname, "..", "..", "baijiahao_status_report.json");
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
console.log(`\n已写出 JSON 报告: ${outPath}`);
