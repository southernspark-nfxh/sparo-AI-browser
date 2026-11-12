// 数据探针：每个平台最多一次 GET。连不上或没有登录标签就记「登录态缺失」，不猜接口。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadProfile } from "./profile.mjs";

const IDS = ["toutiao", "baijiahao", "dayu", "sohu"];

function probeDir() {
  const dir = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "sparo-store", "probe");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeProbe(id, body) {
  const file = path.join(probeDir(), id + "-data.json");
  fs.writeFileSync(file, JSON.stringify({ ...body, capturedAt: new Date().toISOString() }, null, 2));
  console.log(id + " " + body.status + " -> " + file);
}

function creatorTab(rows, profile) {
  let marks = [];
  try {
    marks = [profile.entry.writeUrl, profile.entry.listUrl]
      .map((url) => new URL(url).pathname.split("/").filter(Boolean)[0] || "")
      .filter(Boolean);
  } catch {
    marks = [];
  }
  return rows.find((item) => {
    const url = String(item.url || "");
    if (!url.includes(profile.entry.host)) return false;
    return marks.some((mark) => url.includes("/" + mark));
  });
}

function blank(status, reason) {
  return {
    url: "",
    status,
    keys: [],
    sample: null,
    delay: "单次快照无法判定",
    pageLimit: "单次快照无法判定",
    reason,
  };
}

const READ_SCRIPT =
  "(() => {" +
  "const entries = performance.getEntriesByType('resource')" +
  ".filter((entry) => entry.initiatorType === 'xmlhttprequest' || entry.initiatorType === 'fetch')" +
  ".map((entry) => entry.name)" +
  ".slice(-12);" +
  "return JSON.stringify({ href: location.href, entries });" +
  "})()";

function parseExec(raw) {
  if (!raw || typeof raw !== "string") return null;
  const text = raw.trim();
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && (parsed.href || parsed.entries)) return parsed;
    const inner = parsed?.result || parsed?.data || parsed?.value;
    if (typeof inner === "string") return JSON.parse(inner);
    if (inner && typeof inner === "object") return inner;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
    }
  }
  return null;
}

async function main() {
  let listed = null;
  let exec = null;
  let tabRows = null;
  try {
    const sparo = await import("./sparo.mjs");
    tabRows = sparo.tabRows;
    listed = await sparo.tabs();
    exec = sparo.exec;
  } catch (error) {
    for (const id of IDS) writeProbe(id, blank("登录态缺失", String(error.message || error)));
    return;
  }
  const rows = tabRows(listed);
  for (const id of IDS) {
    const profile = loadProfile(id);
    const host = profile.entry.host;
    const tab = creatorTab(rows, profile);
    if (!tab?.id) {
      writeProbe(id, blank("登录态缺失", "没有打开 " + host + " 的创作者后台标签"));
      continue;
    }
    let raw = "";
    try {
      raw = await exec(READ_SCRIPT, tab.id, host);
    } catch (error) {
      writeProbe(id, blank("登录态缺失", String(error.message || error)));
      continue;
    }
    const seen = parseExec(typeof raw === "string" ? raw : JSON.stringify(raw));
    if (!seen?.href) {
      writeProbe(id, blank("不可用", "读到了标签，但没有读到地址：" + String(raw).slice(0, 180)));
      continue;
    }
    writeProbe(id, {
      url: "",
      pageUrl: seen.href,
      status: "不可用",
      keys: [],
      sample: { observedRequests: seen.entries || [] },
      delay: "单次快照无法判定",
      pageLimit: "单次快照无法判定",
      reason: "当前标签没有可确认的数据接口，未额外发请求，避免猜地址",
    });
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
