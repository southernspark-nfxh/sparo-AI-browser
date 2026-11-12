// 串行补拉昨日指标。没有实测 dataUrl 就记缺失，不猜数，不从工作台页面发请求。
import { loadProfile } from "./profile.mjs";
import { cooledDown, markFetched, upsertMetric, yesterday } from "./metrics-db.mjs";

const IDS = ["toutiao", "baijiahao", "dayu", "sohu"];

function emptyRow(platform, reason, completeness = "missing") {
  return {
    platform,
    accountId: "",
    date: yesterday(),
    articleId: "",
    impressions: null,
    reads: null,
    likes: null,
    comments: null,
    shares: null,
    collects: null,
    follows: null,
    revenue: null,
    capturedAt: new Date().toISOString(),
    completeness,
    reason,
  };
}

async function fetchOne(profile) {
  const url = profile.entry?.dataUrl || profile.dataUrl || "";
  if (!url) return emptyRow(profile.id, "数据接口未实测，规则表 dataUrl 为空");
  const sparo = await import("./sparo.mjs");
  const listed = await sparo.tabs();
  const host = profile.entry.host;
  const tab = sparo.tabRows(listed).find((item) => String(item.url || "").includes(host));
  if (!tab?.id) return emptyRow(profile.id, "登录态缺失");
  const script =
    "(() => fetch(" + JSON.stringify(url) + ").then((res) => res.text().then((body) => JSON.stringify({ status: res.status, body: body.slice(0, 500) }))).catch((err) => JSON.stringify({ status: 0, error: String(err) })))()";
  const raw = await sparo.exec(script, tab.id, host);
  const text = typeof raw === "string" ? raw : JSON.stringify(raw);
  if (/401|403|登录态缺失/.test(text)) return emptyRow(profile.id, "登录态缺失");
  return emptyRow(profile.id, "接口有地址但字段还不能映射，未把回包当成 0");
}

export async function collectAll(opts = {}) {
  const force = opts.force === true;
  const written = [];
  for (const id of IDS) {
    if (!force && !(await cooledDown(id))) {
      written.push({ platform: id, skipped: "cooldown" });
      continue;
    }
    const profile = loadProfile(id);
    const row = await fetchOne(profile);
    await upsertMetric(row);
    await markFetched(id);
    written.push(row);
  }
  return written;
}

if (process.argv[1] && process.argv[1].endsWith("collector.mjs")) {
  collectAll({ force: process.argv.includes("--force") })
    .then((rows) => {
      for (const row of rows) console.log(row.platform + " " + (row.completeness || row.skipped));
    })
    .catch((error) => {
      console.error(error?.message || error);
      process.exit(1);
    });
}
