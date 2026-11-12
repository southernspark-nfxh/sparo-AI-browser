// 指标快照。sql.js 写入 %APPDATA%/sparo-store/metrics.sqlite。
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const initSqlJs = require("sql.js");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS metrics (
  platform TEXT NOT NULL,
  accountId TEXT NOT NULL,
  date TEXT NOT NULL,
  articleId TEXT NOT NULL DEFAULT '',
  impressions INTEGER,
  reads INTEGER,
  likes INTEGER,
  comments INTEGER,
  shares INTEGER,
  collects INTEGER,
  follows INTEGER,
  revenue INTEGER,
  capturedAt TEXT,
  completeness TEXT,
  reason TEXT,
  PRIMARY KEY (platform, accountId, date, articleId)
);
CREATE TABLE IF NOT EXISTS fetch_log (
  platform TEXT PRIMARY KEY,
  at TEXT
);
`;

export function metricsPath() {
  return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "sparo-store", "metrics.sqlite");
}

async function openDb(file = metricsPath()) {
  const SQL = await initSqlJs({
    locateFile: (name) => path.join(path.dirname(require.resolve("sql.js")), "..", "dist", name),
  });
  const db = fs.existsSync(file) ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database();
  db.run(SCHEMA);
  return {
    db,
    save() {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(db.export()));
    },
  };
}

function yesterday() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
}

export async function upsertMetric(row, file = metricsPath()) {
  const store = await openDb(file);
  store.db.run(
    `INSERT INTO metrics (platform, accountId, date, articleId, impressions, reads, likes, comments, shares, collects, follows, revenue, capturedAt, completeness, reason)
     VALUES ($platform, $accountId, $date, $articleId, $impressions, $reads, $likes, $comments, $shares, $collects, $follows, $revenue, $capturedAt, $completeness, $reason)
     ON CONFLICT(platform, accountId, date, articleId) DO UPDATE SET
       impressions=excluded.impressions, reads=excluded.reads, likes=excluded.likes, comments=excluded.comments,
       shares=excluded.shares, collects=excluded.collects, follows=excluded.follows, revenue=excluded.revenue,
       capturedAt=excluded.capturedAt, completeness=excluded.completeness, reason=excluded.reason`,
    {
      $platform: row.platform,
      $accountId: row.accountId || "",
      $date: row.date,
      $articleId: row.articleId || "",
      $impressions: row.impressions ?? null,
      $reads: row.reads ?? null,
      $likes: row.likes ?? null,
      $comments: row.comments ?? null,
      $shares: row.shares ?? null,
      $collects: row.collects ?? null,
      $follows: row.follows ?? null,
      $revenue: row.revenue ?? null,
      $capturedAt: row.capturedAt || new Date().toISOString(),
      $completeness: row.completeness,
      $reason: row.reason || "",
    },
  );
  store.save();
}

export async function listMetrics(file = metricsPath()) {
  if (!fs.existsSync(file)) return [];
  const store = await openDb(file);
  const result = store.db.exec("SELECT * FROM metrics ORDER BY date, platform, articleId");
  if (!result[0]) return [];
  const cols = result[0].columns;
  return result[0].values.map((value) => Object.fromEntries(cols.map((col, index) => [col, value[index]])));
}

export async function markFetched(platform, file = metricsPath()) {
  const store = await openDb(file);
  store.db.run(
    "INSERT INTO fetch_log (platform, at) VALUES ($platform, $at) ON CONFLICT(platform) DO UPDATE SET at=excluded.at",
    { $platform: platform, $at: new Date().toISOString() },
  );
  store.save();
}

export async function cooledDown(platform, file = metricsPath(), waitMs = 5 * 60 * 1000) {
  if (!fs.existsSync(file)) return true;
  const store = await openDb(file);
  const result = store.db.exec("SELECT at FROM fetch_log WHERE platform = $platform", { $platform: platform });
  const at = result[0]?.values?.[0]?.[0];
  if (!at) return true;
  return Date.now() - Date.parse(String(at)) >= waitMs;
}

export function yuan(cents) {
  if (cents === null || cents === undefined || cents === "") return "";
  return (Number(cents) / 100).toFixed(2);
}

export function completenessText(value) {
  if (value === "unsupported") return "平台未提供";
  if (value === "missing") return "数据缺失";
  if (value === "partial") return "数据不完整";
  if (value === "full") return "完整";
  return "数据缺失";
}

export function buildViews(rows) {
  const accounts = rows.filter((row) => !row.articleId);
  const articles = rows.filter((row) => row.articleId);
  const anyPartial = accounts.some((row) => row.completeness === "partial");
  const readable = accounts.filter((row) => row.completeness === "full" && row.reads != null);
  const totalReads = readable.reduce((sum, row) => sum + Number(row.reads), 0);
  const follows = accounts.filter((row) => row.completeness === "full" && row.follows != null);
  const followSum = follows.reduce((sum, row) => sum + Number(row.follows), 0);
  const revenueRows = accounts.filter((row) => row.completeness === "full" && row.revenue != null);
  const revenueSum = revenueRows.reduce((sum, row) => sum + Number(row.revenue), 0);
  return {
    overview: {
      reads: readable.length ? totalReads + "（相加，非去重）" : "无完整阅读",
      follows: follows.length ? (followSum > 0 ? "+" + followSum : String(followSum)) : "无完整净增",
      revenue: revenueRows.length ? "¥" + yuan(revenueSum) + "（账面相加，非到账）" : "无完整收益",
      delta: anyPartial ? "" : "",
      exceptions: accounts.filter((row) => row.completeness !== "full").map((row) => row.platform + " " + completenessText(row.completeness) + (row.reason ? "：" + row.reason : "")),
    },
    trend: accounts.map((row) => ({ date: row.date, platform: row.platform, reads: row.reads, follows: row.follows, revenue: row.revenue == null ? null : yuan(row.revenue) })),
    ranking: articles.map((row) => ({ title: row.articleId, platform: row.platform, reads: row.reads, completeness: completenessText(row.completeness) })),
    compare: accounts.map((row) => ({ platform: row.platform, reads: row.reads, likes: row.likes, completeness: completenessText(row.completeness) })),
    revenueSplit: accounts.map((row) => ({
      platform: row.platform,
      text: row.completeness === "unsupported" ? "平台未提供" : row.revenue == null ? completenessText(row.completeness) : "¥" + yuan(row.revenue),
    })),
    exceptions: accounts.filter((row) => row.completeness === "missing" || row.completeness === "partial" || row.completeness === "unsupported"),
    hideDelta: anyPartial || accounts.some((row) => row.completeness !== "full"),
    capturedAt: accounts.map((row) => row.platform + " " + (row.date || "") + " " + (row.capturedAt || "")).join("；"),
  };
}

export { yesterday };
