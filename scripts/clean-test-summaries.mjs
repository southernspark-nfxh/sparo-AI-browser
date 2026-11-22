/**
 * 清掉测试写进任务摘要里的假记录。
 * 只打印将删除的条目。加上 --confirm 才写回文件。
 * 不要在自动化里跑。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.SPARO_CONFIG_DIR
  || (process.env.APPDATA ? join(process.env.APPDATA, "sparo-store") : "");
if (!dir) {
  console.error("找不到配置目录");
  process.exit(1);
}
const file = join(dir, "agent-task-summaries.json");
const raw = JSON.parse(readFileSync(file, "utf8"));
const tasks = Array.isArray(raw.tasks) ? raw.tasks : [];
const fakeClient = /^(jia|yi|test|ab12cd|c1|c2|c3|c4|bg1|pay1|ding)$/i;
const fakeId = /^(bad|job|job-b|done-job|stop-job|gone|wait|run)$/i;

function isTestRow(row) {
  const client = String(row.clientId || "");
  const id = String(row.taskId || "");
  const title = String(row.title || row.goal || "").trim();
  const emptyOrBad = !title || title === "坏了";
  return emptyOrBad && (fakeClient.test(client) || !id || fakeId.test(id));
}

const drop = tasks.filter(isTestRow);
const keep = tasks.filter((row) => !isTestRow(row));
console.log(`文件 ${file}`);
console.log(`将删除 ${drop.length} 条，保留 ${keep.length} 条`);
for (const row of drop) {
  console.log(`- ${row.taskId || "(空)"} | ${row.clientId || "(无 client)"} | ${row.title || row.goal || "(空标题)"} | ${row.status || ""}`);
}
if (!process.argv.includes("--confirm")) {
  console.log("这是预览。确认后加 --confirm 才会写回。");
  process.exit(0);
}
writeFileSync(file, JSON.stringify({ ...raw, tasks: keep }, null, 2), "utf8");
console.log("已写回。");
