// 串行补拉昨日指标。没有实测 dataUrl 就记缺失，不猜数，不从工作台页面发请求。
import { loadProfile } from "./profile.mjs";
import { cooledDown, listMetrics, markFetched, upsertMetric, yesterday } from "./metrics-db.mjs";

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

function localDay(clock, offset = 0) {
  const date = new Date(clock);
  date.setDate(date.getDate() + offset);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return date.getFullYear() + "-" + month + "-" + day;
}

export function formatDay(value) {
  const text = String(value ?? "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{8}$/.test(text)) return text.slice(0, 4) + "-" + text.slice(4, 6) + "-" + text.slice(6, 8);
  return "";
}

function fillTemplate(url, day) {
  return String(url || "").replaceAll("{date}", day).replaceAll("{ymd}", day.replaceAll("-", ""));
}

function getPath(value, path) {
  let current = value;
  for (const part of String(path || "").split(".")) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function toInt(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.trunc(number);
}

function yuanToCents(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(number * 100);
}

function creatorTab(rows, profile) {
  const host = profile.entry?.host || "";
  const marks = [profile.entry?.writeUrl, profile.entry?.listUrl]
    .map((url) => {
      try { return new URL(url).pathname.split("/").filter(Boolean)[0] || ""; } catch { return ""; }
    })
    .filter(Boolean);
  return rows.find((item) => {
    const url = String(item.url || "");
    if (!url.includes(host)) return false;
    return marks.some((mark) => url.includes("/" + mark));
  });
}

function unwrapExec(raw) {
  let value = raw;
  for (let i = 0; i < 4; i++) {
    if (typeof value === "string") {
      try { value = JSON.parse(value); } catch { return null; }
    }
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object" && Array.isArray(value.result)) return value.result;
    if (value && typeof value === "object" && value.data) { value = value.data; continue; }
    if (value && typeof value === "object" && value.result) { value = value.result; continue; }
    return null;
  }
  return null;
}

export function mapSnapshot(profile, pack, clock = new Date()) {
  const map = profile.data?.metricsMap || {};
  const sources = Array.isArray(map.sources) ? map.sources : [];
  const row = emptyRow(profile.id, "");
  const requested = localDay(clock, -1);
  let date = formatDay(getPath(pack.ready, map.datePath));
  const missing = [];
  for (let index = 0; index < sources.length; index++) {
    const source = sources[index];
    const payload = pack.sources[index];
    if (!payload || payload.status !== 200 || !payload.json) {
      missing.push(source.fields ? Object.keys(source.fields).join("/") : "source");
      continue;
    }
    const found = formatDay(getPath(payload.json, source.datePath));
    if (found && date && found !== date) {
      missing.push(Object.keys(source.fields || {}).join("/") + "日期不一致");
      continue;
    }
    if (!date && found) date = found;
    if (source.dateEquals) {
      const same = formatDay(getPath(payload.json, source.dateEquals)) || String(getPath(payload.json, source.dateEquals) || "");
      if (date && same && same !== date) {
        missing.push("收益日期不一致");
        continue;
      }
    }
    if (source.when === "yesterday" && date && date !== requested) {
      missing.push("收益不是统计日");
      continue;
    }
    for (const [field, path] of Object.entries(source.fields || {})) {
      const raw = getPath(payload.json, path);
      row[field] = source.unit?.[field] === "yuan" ? yuanToCents(raw) : toInt(raw);
      if (row[field] === null) missing.push(field);
    }
  }
  for (const field of map.unsupported || []) row[field] = null;
  if (!date) {
    for (const field of ["impressions", "reads", "likes", "comments", "shares", "collects", "follows", "revenue"]) row[field] = null;
    row.completeness = "missing";
    row.reason = "回包里没有数据日期，没有把数字落成昨天";
    return row;
  }
  row.date = date;
  const unsupported = map.unsupported || [];
  if (missing.length) {
    row.completeness = "partial";
    row.reason = "有字段没对上：" + missing.join("、");
    return row;
  }
  if (unsupported.length) {
    row.completeness = "partial";
    row.reason = "这次回包没有：" + unsupported.join("、") + "。空着，不写成 0";
    return row;
  }
  row.completeness = "full";
  row.reason = "";
  return row;
}

async function readJsons(sparo, tab, urls) {
  const script =
    "(() => { const urls = " + JSON.stringify(urls) + ";" +
    "const out = [];" +
    "for (const url of urls) {" +
    "const x = new XMLHttpRequest();" +
    "x.open('GET', url, false);" +
    "x.withCredentials = true;" +
    "x.send(null);" +
    "out.push({ status: x.status, body: String(x.responseText || '').slice(0, 40000) });" +
    "}" +
    "return out; })()";
  const raw = await sparo.exec(script, tab.id, tab.expect);
  const list = unwrapExec(raw);
  if (!Array.isArray(list)) return urls.map(() => ({ status: 0, json: null }));
  return list.map((item) => {
    let json = null;
    try { json = JSON.parse(item.body || ""); } catch { json = null; }
    return { status: Number(item.status) || 0, json };
  });
}

async function fetchOne(profile) {
  const map = profile.data?.metricsMap || {};
  const sources = Array.isArray(map.sources) ? map.sources : [];
  if (!sources.length) return emptyRow(profile.id, "数据接口未实测，规则表 dataUrl 为空");
  const sparo = await import("./sparo.mjs");
  const listed = await sparo.tabs();
  const tab = creatorTab(sparo.tabRows(listed), profile);
  if (!tab?.id) return emptyRow(profile.id, "登录态缺失");
  tab.expect = profile.entry.host;
  const clock = new Date();
  const requested = localDay(clock, -1);
  let ready = null;
  if (map.readyUrl) {
    const [first] = await readJsons(sparo, tab, [map.readyUrl]);
    if (first.status === 401 || first.status === 403) return emptyRow(profile.id, "登录态缺失");
    ready = first.json;
  }
  const day = formatDay(getPath(ready, map.datePath)) || requested;
  const urls = sources.map((source) => fillTemplate(source.url, day));
  const loaded = await readJsons(sparo, tab, urls);
  if (loaded.some((item) => item.status === 401 || item.status === 403)) return emptyRow(profile.id, "登录态缺失");
  return mapSnapshot(profile, { ready, sources: loaded }, clock);
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
    if (row.completeness === "missing" && /登录态缺失/.test(row.reason || "")) {
      const kept = (await listMetrics()).find((item) => item.platform === id && !item.articleId && item.completeness !== "missing");
      if (kept) {
        written.push({ platform: id, skipped: "keep-snapshot", date: kept.date });
        continue;
      }
    }
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
