// 评论探针：每个平台最多一次 GET。连不上或没有登录标签就记「登录态缺失」，不猜接口。
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
  const file = path.join(probeDir(), id + "-comments.json");
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

async function main() {
  let listed = null;
  let tabRows = null;
  try {
    const sparo = await import("./sparo.mjs");
    tabRows = sparo.tabRows;
    listed = await sparo.tabs();
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
    writeProbe(id, blank("不可用", "只确认了登录标签 " + (tab.url || host) + "，没有评论接口的实测回包，未发请求"));
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
