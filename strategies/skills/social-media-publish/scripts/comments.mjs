// 评论只读。回复只允许头条和百家，而且只在规则表写了 commentUrl 之后才填平台输入框。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadProfile } from "./profile.mjs";

export const REPLY_PLATFORMS = ["toutiao", "baijiahao"];
export const MIN_GAP_MS = 20 * 1000;
export const HOUR_CAP = 30;

const IDS = ["toutiao", "baijiahao", "dayu", "sohu"];

function storeDir() {
  const dir = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "sparo-store");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

export function canReply(platform) {
  return REPLY_PLATFORMS.includes(platform);
}

export function replyLabel(platform) {
  return canReply(platform) ? "回复" : "只读，回复未开";
}

export function allowReply(stamps, now = Date.now()) {
  const recent = stamps.filter((stamp) => now - stamp < 60 * 60 * 1000);
  if (recent.length >= HOUR_CAP) return { ok: false, reason: "每小时不超过 30 条" };
  const last = recent.length ? Math.max(...recent) : 0;
  if (last && now - last < MIN_GAP_MS) return { ok: false, reason: "单条至少间隔 20 秒" };
  return { ok: true };
}

function getPath(value, path) {
  let current = value;
  for (const part of String(path || "").split(".")) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function showTime(value) {
  const number = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d{10}$/.test(value)
      ? Number(value)
      : null;
  if (number && number > 1e9 && number < 1e11) {
    const date = new Date(number * 1000);
    const pad = (n) => String(n).padStart(2, "0");
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + " " + pad(date.getHours()) + ":" + pad(date.getMinutes());
  }
  return value == null ? "" : String(value);
}

export function mapCommentList(profile, payload) {
  const spec = profile.data?.metricsMap?.comment;
  if (!spec) return [];
  const list = getPath(payload, spec.list);
  if (!Array.isArray(list)) return [];
  return list.slice(0, 20).map((item) => ({
    platform: profile.id,
    commentId: String(getPath(item, spec.id) ?? ""),
    author: String(getPath(item, spec.author) ?? ""),
    content: String(getPath(item, spec.text) ?? ""),
    articleId: String(getPath(item, spec.articleId) ?? ""),
    title: String(getPath(item, spec.title) ?? ""),
    createdAt: showTime(getPath(item, spec.time)),
  })).filter((item) => item.commentId || item.content);
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

async function readCommentJson(sparo, tab, url) {
  const script =
    "(() => { const x = new XMLHttpRequest(); x.open('GET', " + JSON.stringify(url) + ", false); x.withCredentials = true; x.send(null); return { status: x.status, body: String(x.responseText || '').slice(0, 80000) }; })()";
  const raw = await sparo.exec(script, tab.id, tab.expect);
  let value = raw;
  for (let i = 0; i < 4; i++) {
    if (typeof value === "string") {
      try { value = JSON.parse(value); } catch { return null; }
    }
    if (value && typeof value === "object" && value.status && value.body !== undefined) return value;
    if (value && typeof value === "object" && value.data) { value = value.data; continue; }
    if (value && typeof value === "object" && value.result) { value = value.result; continue; }
    return null;
  }
  return null;
}

export async function listComments() {
  const boards = [];
  let sparo = null;
  let rows = [];
  for (const id of IDS) {
    const profile = loadProfile(id);
    const url = profile.entry?.commentUrl || "";
    const board = {
      platform: id,
      name: profile.name,
      open: Boolean(url),
      canReply: canReply(id),
      label: replyLabel(id),
      comments: [],
      reason: url ? "" : "评论接口未实测",
    };
    if (!url || !canReply(id)) {
      boards.push(board);
      continue;
    }
    if (!sparo) {
      sparo = await import("./sparo.mjs");
      rows = sparo.tabRows(await sparo.tabs());
    }
    const tab = creatorTab(rows, profile);
    if (!tab?.id) {
      board.reason = "登录态缺失";
      boards.push(board);
      continue;
    }
    tab.expect = profile.entry.host;
    const got = await readCommentJson(sparo, tab, url);
    if (!got || got.status === 401 || got.status === 403) {
      board.reason = "登录态缺失";
      boards.push(board);
      continue;
    }
    let json = null;
    try { json = JSON.parse(got.body || ""); } catch { json = null; }
    if (!json) {
      board.reason = "评论回包不是 JSON";
    } else {
      board.comments = mapCommentList(profile, json);
      board.reason = board.comments.length ? "" : "列表为空";
    }
    boards.push(board);
  }
  return boards;
}

export function listCommentStatus() {
  return IDS.map((id) => {
    const profile = loadProfile(id);
    const url = profile.entry?.commentUrl || "";
    return {
      platform: id,
      name: profile.name,
      open: Boolean(url),
      canReply: canReply(id),
      label: replyLabel(id),
      comments: [],
      reason: url ? "" : "评论接口未实测",
    };
  });
}

export function saveReplyDraft(platform, text) {
  const file = path.join(storeDir(), "comment-drafts.json");
  const all = readJson(file, {});
  const key = platform;
  const prev = all[key] || { text: "", stamps: [] };
  all[key] = { text, stamps: prev.stamps || [], updatedAt: new Date().toISOString() };
  fs.writeFileSync(file, JSON.stringify(all, null, 2));
  return all[key];
}

function pageResult(raw) {
  let value = raw;
  for (let i = 0; i < 5; i++) {
    if (typeof value === "string") {
      try { value = JSON.parse(value); } catch { return null; }
    }
    if (!value || typeof value !== "object") return null;
    if (value.data && Object.prototype.hasOwnProperty.call(value.data, "result")) {
      value = value.data.result;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(value, "result") && value.value === undefined && value.reason === undefined && value.status === undefined) {
      value = value.result;
      continue;
    }
    return value;
  }
  return null;
}

export function replySelector(platform) {
  try {
    const profile = loadProfile(platform);
    return String(profile.data?.metricsMap?.replySelector || "");
  } catch {
    return "";
  }
}

export async function fillOpenReply(platform, text, comment = {}) {
  const selector = replySelector(platform);
  const profile = loadProfile(platform);
  const page = profile.data?.metricsMap?.comment?.page || "";
  if (!selector || !page) {
    return { ok: false, kept: true, message: "回复草稿已留在本机。评论框选择器还没实测，没有往平台页面填写。" };
  }
  const stamps = readJson(path.join(storeDir(), "comment-drafts.json"), {})[platform]?.stamps || [];
  const gate = allowReply(stamps, Date.now());
  if (!gate.ok) return { ok: false, kept: true, message: gate.reason };
  const sparo = await import("./sparo.mjs");
  const listed = await sparo.tabs();
  const tab = sparo.tabRows(listed).find((item) => String(item.url || "").includes(profile.entry.host) && String(item.url || "").includes(page));
  if (!tab?.id) {
    return { ok: false, kept: true, message: "回复草稿已留在本机。评论页没打开，没有填写。" };
  }
  await sparo.switchTab(tab.id);
  const snippet = String(comment.content || "").replace(/\s+/g, " ").trim().slice(0, 16);
  const script =
    "(() => {" +
    "if (!location.href.includes(" + JSON.stringify(page) + ")) return { ok: false, reason: '页面不匹配' };" +
    "const nodes = Array.from(document.querySelectorAll(" + JSON.stringify(selector) + "));" +
    "const hit = [];" +
    "for (const el of nodes) {" +
    "const style = getComputedStyle(el);" +
    "if (style.display === 'none' || style.visibility === 'hidden') continue;" +
    "let own = false; let p = el;" +
    "const snip = " + JSON.stringify(snippet) + ";" +
    "const cid = " + JSON.stringify(String(comment.commentId || "")) + ";" +
    "for (let i = 0; i < 16 && p; i++) {" +
    "const t = (p.innerText || '').replace(/\\s+/g, ' ');" +
    "const hitText = (cid && t.includes(cid)) || (snip && t.includes(snip));" +
    "if (hitText) {" +
    "const replies = (t.match(/回复/g) || []).length;" +
    "if (replies <= 4) own = true;" +
    "break;" +
    "}" +
    "p = p.parentElement;" +
    "}" +
    "if (own) hit.push(el);" +
    "}" +
    "if (hit.length !== 1) return { ok: false, reason: hit.length ? '定位不唯一' : '回复框未打开', n: hit.length };" +
    "const el = hit[0];" +
    "const proto = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');" +
    "if (proto && proto.set) proto.set.call(el, " + JSON.stringify(text) + "); else el.value = " + JSON.stringify(text) + ";" +
    "el.dispatchEvent(new Event('input', { bubbles: true }));" +
    "return { ok: el.value === " + JSON.stringify(text) + ", value: el.value };" +
    "})()";
  try {
    const raw = await sparo.exec(script, tab.id, profile.entry.host);
    const pageBack = pageResult(raw);
    if (!pageBack || pageBack.ok !== true || pageBack.value !== text) {
      const reason = pageBack?.reason === "页面不匹配" || pageBack?.reason === "定位不唯一" || pageBack?.reason === "回复框未打开"
        ? pageBack.reason
        : "回复框未打开";
      return { ok: false, kept: true, message: "回复草稿已留在本机。" + reason + "，没有往别的输入框填写。" };
    }
    const noted = noteReplyAttempt(platform, Date.now());
    if (!noted.ok) return { ok: false, kept: true, message: noted.reason };
    return { ok: false, kept: true, filled: true, message: "已经写进这条评论打开的回复框，并读回一致。发送要你在平台页面上点。" };
  } catch {
    return { ok: false, kept: true, message: "回复草稿已留在本机。往页面填写时没有成功。" };
  }
}

export function noteReplyAttempt(platform, now = Date.now()) {
  const file = path.join(storeDir(), "comment-drafts.json");
  const all = readJson(file, {});
  const prev = all[platform] || { text: "", stamps: [] };
  const gate = allowReply(prev.stamps || [], now);
  if (!gate.ok) return gate;
  prev.stamps = [...(prev.stamps || []), now];
  all[platform] = prev;
  fs.writeFileSync(file, JSON.stringify(all, null, 2));
  return { ok: true };
}
