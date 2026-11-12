// 串行补拉昨日指标。没有实测 dataUrl 就记缺失，不猜数，不从工作台页面发请求。
// 每次调用必须带 envId。GET 只打在该环境的平台标签上，不回退到没标环境的标签。
import { loadProfile } from "./profile.mjs";
import { cooledDown, linkedAccountId, listMetrics, markFetched, upsertMetric, yesterday } from "./metrics-db.mjs";

const IDS = ["toutiao", "baijiahao", "dayu", "sohu"];
const NUMBER_FIELDS = ["impressions", "reads", "likes", "comments", "shares", "collects", "follows", "revenue"];

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

function hasNumbers(row) {
  return NUMBER_FIELDS.some((key) => row?.[key] !== null && row?.[key] !== undefined && row?.[key] !== "");
}

function creatorTab(rows, profile, envId) {
  const host = profile.entry?.host || "";
  const marks = [profile.entry?.writeUrl, profile.entry?.listUrl]
    .map((url) => {
      try { return new URL(url).pathname.split("/").filter(Boolean)[0] || ""; } catch { return ""; }
    })
    .filter(Boolean);
  return (rows || []).find((item) => {
    if (String(item?.envId || "") !== String(envId || "")) return false;
    const url = String(item.url || "");
    if (!url.includes(host)) return false;
    return marks.some((mark) => url.includes("/" + mark));
  }) || null;
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

export function metricGetScript(urls) {
  return "(() => { const urls = " + JSON.stringify(urls) + ";" +
    "const out = [];" +
    "for (const url of urls) {" +
    "const x = new XMLHttpRequest();" +
    "x.open('GET', url, false);" +
    "x.withCredentials = true;" +
    "x.send(null);" +
    "out.push({ status: x.status, body: String(x.responseText || '').slice(0, 40000) });" +
    "}" +
    "return out; })()";
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
    for (const field of NUMBER_FIELDS) row[field] = null;
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
  const raw = await sparo.exec(metricGetScript(urls), tab.id, tab.expect);
  const list = unwrapExec(raw);
  if (!Array.isArray(list)) return urls.map(() => ({ status: 0, json: null }));
  return list.map((item) => {
    let json = null;
    try { json = JSON.parse(item.body || ""); } catch { json = null; }
    return { status: Number(item.status) || 0, json };
  });
}

async function fetchOne(profile, ctx) {
  const map = profile.data?.metricsMap || {};
  const sources = Array.isArray(map.sources) ? map.sources : [];
  if (!sources.length) return { ...emptyRow(profile.id, "数据接口未实测，规则表 dataUrl 为空"), attempted: false };
  const tab = creatorTab(ctx.tabs || [], profile, ctx.envId);
  if (!tab?.id) {
    return {
      ...emptyRow(profile.id, "没有找到这个环境的平台页，已停止，不会改用默认登录。"),
      skipWrite: true,
      attempted: false,
      code: "no_env_tab",
    };
  }
  tab.expect = profile.entry.host;
  const clock = ctx.clock || new Date();
  const requested = localDay(clock, -1);
  const read = ctx.readJsons || readJsons;
  const sparo = ctx.readJsons ? ctx.sparo : (ctx.sparo || await import("./sparo.mjs"));
  let ready = null;
  if (map.readyUrl) {
    const [first] = await read(sparo, tab, [map.readyUrl]);
    if (!first || first.status === 401 || first.status === 403) return { ...emptyRow(profile.id, "登录态缺失"), date: requested, attempted: true };
    if (!first || first.status !== 200) return { ...emptyRow(profile.id, "接口错误"), date: requested, attempted: true };
    ready = first.json;
  }
  const day = formatDay(getPath(ready, map.datePath)) || requested;
  const urls = sources.map((source) => fillTemplate(source.url, day));
  const loaded = await read(sparo, tab, urls);
  if (loaded.some((item) => item && (item.status === 401 || item.status === 403))) {
    return { ...emptyRow(profile.id, "登录态缺失"), date: requested, attempted: true };
  }
  if (loaded.some((item) => !item || item.status !== 200)) {
    const row = mapSnapshot(profile, { ready, sources: loaded }, clock);
    if (!hasNumbers(row)) {
      row.date = requested;
      row.completeness = "missing";
      row.reason = "接口错误";
      for (const field of NUMBER_FIELDS) row[field] = null;
    }
    return { ...row, attempted: true };
  }
  return { ...mapSnapshot(profile, { ready, sources: loaded }, clock), attempted: true };
}

function report(opts, event) {
  if (typeof opts.onProgress === "function") opts.onProgress(event);
}

async function keepExisting(file, existing, reason, accountId, envId) {
  await upsertMetric({
    ...existing,
    accountId,
    envId,
    reason,
    capturedAt: existing.capturedAt,
    completeness: existing.completeness,
  }, file);
}

export async function collectAll(opts = {}) {
  const envId = String(opts.envId || "").trim();
  if (!envId) {
    return {
      ok: false,
      code: "missing_env",
      message: "还没有选择账号环境，已停止。不会改用默认登录。",
      envId: "",
      written: [],
    };
  }
  const file = opts.file;
  const accounts = opts.accounts || {};
  const ids = Array.isArray(opts.platforms) && opts.platforms.length ? opts.platforms : IDS;
  const force = opts.force === true;
  const written = [];
  let tabs = Array.isArray(opts.tabs) ? opts.tabs : null;
  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index];
    const accountId = linkedAccountId(envId, accounts[id]);
    report(opts, { envId, platform: id, index, total: ids.length, phase: "start" });
    if (!accountId) {
      written.push({
        ok: false,
        platform: id,
        envId,
        skipped: "unlinked",
        message: "无法关联平台账号，已暂停写入",
      });
      report(opts, { envId, platform: id, index, total: ids.length, phase: "skip", message: "未关联" });
      continue;
    }
    if (!force && !(await cooledDown(id, file, 5 * 60 * 1000, envId))) {
      written.push({ platform: id, envId, accountId, skipped: "cooldown" });
      report(opts, { envId, platform: id, index, total: ids.length, phase: "skip", message: "冷却中" });
      continue;
    }
    if (!tabs) {
      const sparo = opts.sparo || await import("./sparo.mjs");
      const listed = await sparo.tabs();
      tabs = sparo.tabRows(listed);
    }
    let row;
    try {
      row = await fetchOne(loadProfile(id), { ...opts, envId, tabs });
    } catch (error) {
      written.push({
        platform: id,
        envId,
        accountId,
        skipped: "error",
        message: error instanceof Error ? error.message : "接口错误",
      });
      report(opts, { envId, platform: id, index, total: ids.length, phase: "skip", message: "接口错误" });
      continue;
    }
    row.accountId = accountId;
    row.envId = envId;
    if (row.skipWrite) {
      written.push({ ...row, skipped: row.code || "skip" });
      report(opts, { envId, platform: id, index, total: ids.length, phase: "skip", message: row.reason || "" });
      continue;
    }
    const existing = (await listMetrics(file)).find((item) =>
      item.platform === id && item.accountId === accountId && !item.articleId && item.date === row.date);
    if (existing && hasNumbers(existing) && !hasNumbers(row)) {
      const reason = /登录/.test(row.reason || "") ? "登录态缺失" : "接口错误：" + (row.reason || "这次没有拿到新数据");
      await keepExisting(file, existing, reason, accountId, envId);
      if (row.attempted) await markFetched(id, file, envId);
      written.push({
        platform: id,
        envId,
        accountId,
        skipped: "keep-snapshot",
        date: existing.date,
        message: "未获取到新数据，仍显示原时间结果",
      });
      report(opts, { envId, platform: id, index, total: ids.length, phase: "skip", message: "保留原快照" });
      continue;
    }
    const saved = await upsertMetric(row, file);
    if (!saved?.ok) {
      written.push({ platform: id, envId, accountId, skipped: saved?.code || "unlinked", message: saved?.message || "" });
      report(opts, { envId, platform: id, index, total: ids.length, phase: "skip", message: saved?.message || "" });
      continue;
    }
    if (row.attempted) await markFetched(id, file, envId);
    written.push(row);
    report(opts, { envId, platform: id, index, total: ids.length, phase: "done", completeness: row.completeness });
  }
  const wrote = written.some((item) => item.completeness && !item.skipped);
  const unlinked = written.length > 0 && written.every((item) => item.skipped === "unlinked");
  const kept = written.some((item) => item.skipped === "keep-snapshot" || item.skipped === "error");
  if (unlinked) {
    return { ok: false, code: "unlinked", message: "无法把平台账号关联到这个环境，已暂停写入。", envId, written };
  }
  if (!wrote && kept) {
    return { ok: false, code: "kept_snapshot", message: "未获取到新数据，仍显示原时间结果", envId, written };
  }
  if (!wrote && written.every((item) => item.skipped === "no_env_tab" || item.code === "no_env_tab")) {
    return { ok: false, code: "no_env_tab", message: "没有找到这个环境的平台页，已停止，不会改用默认登录。", envId, written };
  }
  return { ok: true, code: "ok", message: "", envId, written };
}

function argValue(flag) {
  const hit = process.argv.find((arg) => arg.startsWith(flag + "="));
  return hit ? hit.slice(flag.length + 1) : "";
}

if (process.argv[1] && process.argv[1].endsWith("collector.mjs")) {
  const accounts = {};
  for (const pair of argValue("--accounts").split(",").filter(Boolean)) {
    const [platform, account] = pair.split(":");
    if (platform && account) accounts[platform] = account;
  }
  collectAll({ force: process.argv.includes("--force"), envId: argValue("--env"), accounts })
    .then((result) => {
      if (!result.ok) {
        console.error(result.message);
        process.exitCode = 1;
        return;
      }
      for (const row of result.written) console.log(row.platform + " " + (row.completeness || row.skipped));
    })
    .catch((error) => {
      console.error(error?.message || error);
      process.exit(1);
    });
}
