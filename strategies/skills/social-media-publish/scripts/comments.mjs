// 评论只读。回复只允许头条和百家，而且只在规则表写了 commentUrl 之后才填平台输入框。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadProfile } from "./profile.mjs";

export const REPLY_PLATFORMS = ["toutiao", "baijiahao"];
export const MIN_GAP_MS = 20 * 1000;
export const HOUR_CAP = 30;

const IDS = ["toutiao", "baijiahao", "dayu", "sohu"];
export const COMMENT_PLATFORMS = IDS;
const PLATFORM_NAME = { toutiao: "头条号", baijiahao: "百家号", dayu: "大鱼号", sohu: "搜狐号" };
const MISSING_ENV = "还没有选择账号环境，已停止。不会改用默认登录。";

export function defaultCommentStoreDir() {
  const dir = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "sparo-store");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function storeDir() {
  return defaultCommentStoreDir();
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

function clock(ms) {
  const date = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds());
}

export function allowReply(stamps, now = Date.now()) {
  const recent = (stamps || []).filter((stamp) => typeof stamp === "number" && now - stamp >= 0 && now - stamp < 60 * 60 * 1000);
  if (recent.length >= HOUR_CAP) {
    const retryAt = Math.min(...recent) + 60 * 60 * 1000;
    return { ok: false, reason: "每小时不超过 30 条，" + clock(retryAt) + " 后再试", retryAt };
  }
  const last = recent.length ? Math.max(...recent) : 0;
  if (last && now - last < MIN_GAP_MS) {
    const retryAt = last + MIN_GAP_MS;
    return { ok: false, reason: "单条至少间隔 20 秒，" + clock(retryAt) + " 后再试", retryAt };
  }
  return { ok: true, retryAt: 0 };
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

function creatorTab(rows, profile, envId) {
  const host = profile.entry?.host || "";
  const marks = [profile.entry?.writeUrl, profile.entry?.listUrl]
    .map((url) => {
      try { return new URL(url).pathname.split("/").filter(Boolean)[0] || ""; } catch { return ""; }
    })
    .filter(Boolean);
  const candidates = (rows || []).filter((item) => {
    const url = String(item.url || "");
    if (!url.includes(host)) return false;
    return marks.some((mark) => url.includes("/" + mark));
  });
  const matched = candidates.filter((item) => String(item?.envId || "").trim() === envId);
  if (matched.length === 1) return { ok: true, tab: matched[0] };
  if (matched.length > 1) {
    return {
      ok: false,
      code: "ambiguous_env_tab",
      message: "这个环境的平台页不唯一，已停止，不会读取或写入评论。",
    };
  }
  return {
    ok: false,
    code: candidates.length ? "env_mismatch" : "no_env_tab",
    message: "没有找到明确属于这个环境的唯一平台页，已停止，不会改用默认登录。",
  };
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

export async function listComments(options = {}) {
  const envId = String(options.envId || "").trim();
  if (!envId) {
    return {
      ok: false,
      code: "missing_env",
      message: MISSING_ENV,
      envId: "",
      boards: [],
    };
  }
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
    const found = creatorTab(rows, profile, envId);
    if (!found.ok || !found.tab?.id) {
      board.code = found.code || "no_env_tab";
      board.reason = found.message || "没有找到明确属于这个环境的唯一平台页，已停止，不会改用默认登录。";
      board.canReply = false;
      boards.push(board);
      continue;
    }
    const tab = found.tab;
    board.envId = envId;
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

function cachePath(dir) {
  return path.join(dir, "comment-cache.json");
}

function legacyDraftPath(dir) {
  return path.join(dir, "comment-drafts.json");
}

function normalizeRecord(raw, migrating) {
  const envId = typeof raw?.envId === "string" ? raw.envId.trim() : "";
  const association = envId ? "linked" : "unlinked";
  return {
    envId,
    platform: String(raw?.platform || ""),
    commentId: String(raw?.commentId || ""),
    author: String(raw?.author || ""),
    content: String(raw?.content || ""),
    title: String(raw?.title || ""),
    articleId: String(raw?.articleId || ""),
    createdAt: String(raw?.createdAt || ""),
    draftText: String(raw?.draftText || ""),
    pendingReply: migrating ? "" : String(raw?.pendingReply || ""),
    replied: migrating ? false : raw?.replied === true,
    association,
    linkLabel: association === "unlinked" ? "未关联" : "",
  };
}

function normalizeDraft(raw) {
  const envId = typeof raw?.envId === "string" ? raw.envId.trim() : "";
  const association = envId ? "linked" : "unlinked";
  return {
    envId,
    platform: String(raw?.platform || ""),
    commentId: String(raw?.commentId || ""),
    text: String(raw?.text || ""),
    stamps: Array.isArray(raw?.stamps) ? raw.stamps.filter((stamp) => typeof stamp === "number") : [],
    association,
    linkLabel: association === "unlinked" ? "未关联" : "",
    updatedAt: String(raw?.updatedAt || ""),
  };
}

function collectRecords(raw, into) {
  const rows = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.records)
      ? raw.records
      : Array.isArray(raw?.comments)
        ? raw.comments
        : Array.isArray(raw?.items)
          ? raw.items
          : [];
  for (const row of rows) into.push(normalizeRecord(row, true));
}

export function migrateCommentCache(cacheRaw, draftsRaw) {
  const records = [];
  const drafts = [];
  collectRecords(cacheRaw, records);
  if (draftsRaw && typeof draftsRaw === "object" && !Array.isArray(draftsRaw)) {
    if (draftsRaw.version === 2 && Array.isArray(draftsRaw.drafts)) {
      for (const row of draftsRaw.drafts) drafts.push(normalizeDraft(row));
    } else {
      for (const [key, value] of Object.entries(draftsRaw)) {
        if (["version", "records", "drafts", "comments", "items", "notes", "legacyMerged"].includes(key)) continue;
        if (!value || typeof value !== "object") continue;
        drafts.push(normalizeDraft({ ...value, platform: value.platform || key }));
      }
    }
  }
  return { version: 2, legacyMerged: true, records, drafts, notes: Array.isArray(cacheRaw?.notes) ? cacheRaw.notes : [] };
}

export function readCommentStore(dir) {
  const raw = readJson(cachePath(dir), null);
  if (raw && raw.version === 2 && Array.isArray(raw.records) && Array.isArray(raw.drafts)) {
    return {
      version: 2,
      legacyMerged: Boolean(raw.legacyMerged),
      records: raw.records.map((item) => normalizeRecord(item, false)),
      drafts: raw.drafts.map((item) => normalizeDraft(item)),
      notes: Array.isArray(raw.notes) ? raw.notes : [],
    };
  }
  return migrateCommentCache(raw, readJson(legacyDraftPath(dir), null));
}

export function writeCommentStore(dir, store) {
  fs.mkdirSync(dir, { recursive: true });
  const next = {
    version: 2,
    legacyMerged: store.legacyMerged !== false,
    records: (store.records || []).map((item) => normalizeRecord(item, false)),
    drafts: (store.drafts || []).map((item) => normalizeDraft(item)),
    notes: store.notes || [],
  };
  fs.writeFileSync(cachePath(dir), JSON.stringify(next, null, 2));
  return next;
}

export function loadCommentStore(dir) {
  const file = cachePath(dir);
  const raw = readJson(file, null);
  const ready = raw && raw.version === 2;
  const store = readCommentStore(dir);
  if (!ready) writeCommentStore(dir, store);
  return ready ? readCommentStore(dir) : store;
}

export function listCachedComments(dir, envId) {
  const id = String(envId || "").trim();
  if (!id) return [];
  return readCommentStore(dir).records.filter((item) => item.association === "linked" && item.envId === id);
}

function scopedStamps(dir, envId, platform) {
  return readCommentStore(dir).drafts
    .filter((item) => item.association === "linked" && item.envId === envId && item.platform === platform)
    .flatMap((item) => item.stamps || []);
}

function legacyStamps(dir, platform) {
  const row = readJson(legacyDraftPath(dir), {})[platform];
  return Array.isArray(row?.stamps) ? row.stamps.filter((stamp) => typeof stamp === "number") : [];
}

function replySeen(item, text) {
  if (!text) return false;
  const chunks = [];
  if (Array.isArray(item?.replies)) chunks.push(...item.replies.map((part) => String(part)));
  if (item?.replyText) chunks.push(String(item.replyText));
  return chunks.some((chunk) => chunk.includes(text));
}

export function reconcileWithGet(dir, envId, platform, fetched) {
  const id = String(envId || "").trim();
  if (!id) return { ok: false, code: "missing_env", message: MISSING_ENV, envId: "", records: [] };
  const store = readCommentStore(dir);
  const incoming = Array.isArray(fetched) ? fetched : [];
  const kept = store.records.filter((item) => !(item.envId === id && item.platform === platform && item.association === "linked"));
  const next = incoming.map((item) => {
    const commentId = String(item.commentId || "");
    const prev = store.records.find((row) => row.envId === id && row.platform === platform && row.commentId === commentId);
    const pending = prev?.pendingReply || "";
    const seen = Boolean(pending) && replySeen(item, pending);
    return normalizeRecord({
      platform,
      commentId,
      author: item.author || prev?.author || "",
      content: item.content || prev?.content || "",
      title: item.title || prev?.title || "",
      articleId: item.articleId || prev?.articleId || "",
      createdAt: item.createdAt || prev?.createdAt || "",
      envId: id,
      draftText: prev?.draftText || "",
      pendingReply: seen ? "" : pending,
      replied: Boolean(seen),
      association: "linked",
    }, false);
  });
  for (const prev of store.records) {
    if (prev.envId === id && prev.platform === platform && prev.association === "linked" && prev.pendingReply && !next.some((item) => item.commentId === prev.commentId)) {
      next.push({ ...prev, replied: false });
    }
  }
  store.records = kept.concat(next);
  store.notes = (store.notes || []).filter((note) => !(note.envId === id && note.platform === platform));
  writeCommentStore(dir, store);
  return { ok: true, code: "ok", message: "", envId: id, records: next };
}

export function saveReplyDraft(platform, text, meta = {}) {
  const envId = String(meta.envId || "").trim();
  const dir = meta.storeDir || storeDir();
  const commentId = String(meta.commentId || "");
  if (!envId) {
    const file = legacyDraftPath(dir);
    fs.mkdirSync(dir, { recursive: true });
    const all = readJson(file, {});
    const prev = all[platform] || { text: "", stamps: [] };
    all[platform] = { text, stamps: prev.stamps || [], updatedAt: new Date().toISOString() };
    fs.writeFileSync(file, JSON.stringify(all, null, 2));
    return { ...all[platform], association: "unlinked", linkLabel: "未关联", envId: "" };
  }
  const store = readCommentStore(dir);
  const prev = store.drafts.find((item) => item.association === "linked" && item.envId === envId && item.platform === platform && item.commentId === commentId)
    || store.drafts.find((item) => item.association === "linked" && item.envId === envId && item.platform === platform && !item.commentId);
  const draft = normalizeDraft({
    envId,
    platform,
    commentId,
    text,
    stamps: prev?.stamps || [],
    updatedAt: new Date().toISOString(),
  });
  store.drafts = store.drafts.filter((item) => item !== prev);
  store.drafts.push(draft);
  const record = store.records.find((item) => item.association === "linked" && item.envId === envId && item.platform === platform && item.commentId === commentId);
  if (record) record.draftText = text;
  writeCommentStore(dir, store);
  return draft;
}

export function noteReplyAttempt(platform, now = Date.now(), meta = {}) {
  const envId = String(meta.envId || "").trim();
  const dir = meta.storeDir || storeDir();
  const commentId = String(meta.commentId || "");
  if (!envId) {
    const file = legacyDraftPath(dir);
    fs.mkdirSync(dir, { recursive: true });
    const all = readJson(file, {});
    const prev = all[platform] || { text: "", stamps: [] };
    const gate = allowReply(prev.stamps || [], now);
    if (!gate.ok) return gate;
    prev.stamps = [...(prev.stamps || []), now];
    all[platform] = prev;
    fs.writeFileSync(file, JSON.stringify(all, null, 2));
    return { ok: true };
  }
  const store = readCommentStore(dir);
  const stamps = store.drafts
    .filter((item) => item.association === "linked" && item.envId === envId && item.platform === platform)
    .flatMap((item) => item.stamps || []);
  const gate = allowReply(stamps, now);
  if (!gate.ok) return gate;
  let draft = store.drafts.find((item) => item.association === "linked" && item.envId === envId && item.platform === platform && item.commentId === commentId);
  if (!draft) {
    draft = normalizeDraft({ envId, platform, commentId, text: meta.text || "", stamps: [], updatedAt: new Date().toISOString() });
    store.drafts.push(draft);
  }
  draft.stamps = [...(draft.stamps || []), now];
  writeCommentStore(dir, store);
  return { ok: true };
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

export function buildReplyFillScript(page, selector, text, snippet, commentId) {
  return "(() => {" +
    "const captcha = document.querySelector(\"iframe[src*='captcha'], iframe[src*='verify'], .geetest_panel, .captcha, [class*='captcha-'], #captcha\");" +
    "if (captcha) { const style = getComputedStyle(captcha); if (style && style.display !== 'none' && style.visibility !== 'hidden') return { captcha: true, ok: false, reason: '验证码', n: 0 }; }" +
    "if (!location.href.includes(" + JSON.stringify(page) + ")) return { ok: false, reason: '页面不匹配', n: 0 };" +
    "const nodes = Array.from(document.querySelectorAll(" + JSON.stringify(selector) + "));" +
    "const hit = [];" +
    "for (const el of nodes) {" +
    "const style = getComputedStyle(el);" +
    "if (style.display === 'none' || style.visibility === 'hidden') continue;" +
    "let own = false; let p = el;" +
    "const snip = " + JSON.stringify(snippet) + ";" +
    "const cid = " + JSON.stringify(String(commentId || "")) + ";" +
    "for (let i = 0; i < 16 && p; i++) {" +
    "const t = (p.innerText || '').replace(/\\s+/g, ' ');" +
    "const hitText = (cid && t.includes(cid)) || (snip && t.includes(snip));" +
    "if (hitText) { const replies = (t.match(/回复/g) || []).length; if (replies <= 4) own = true; break; }" +
    "p = p.parentElement;" +
    "}" +
    "if (own) hit.push(el);" +
    "}" +
    "if (hit.length !== 1) return { ok: false, reason: hit.length ? '定位不唯一' : '回复框未打开', n: hit.length };" +
    "const el = hit[0];" +
    "const proto = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');" +
    "if (proto && proto.set) proto.set.call(el, " + JSON.stringify(text) + "); else el.value = " + JSON.stringify(text) + ";" +
    "el.dispatchEvent(new Event('input', { bubbles: true }));" +
    "const readback = el.value;" +
    "return { ok: readback === " + JSON.stringify(text) + ", value: readback, readback: readback, n: 1 };" +
    "})()";
}

export function judgeReplyTarget(probe, text) {
  if (!probe) {
    return { ok: false, filled: false, replied: false, code: "reply_box_closed", message: "回复框未打开，已停止。草稿还留着。" };
  }
  if (probe.captcha || probe.reason === "验证码") {
    return { ok: false, filled: false, replied: false, code: "captcha", message: "遇到验证码，已停止。请在平台页面手动处理，草稿还留着。" };
  }
  if (probe.reason === "环境不匹配") {
    return { ok: false, filled: false, replied: false, code: "env_mismatch", message: "回复框不属于当前环境，已停止。不会改用默认登录。" };
  }
  const count = Number(probe.n ?? 0);
  if (probe.reason === "定位不唯一" || count > 1) {
    return { ok: false, filled: false, replied: false, code: "reply_target_ambiguous", message: "回复目标不唯一，已停止，没有填进其他输入框。草稿还留着。" };
  }
  const readback = probe.readback !== undefined ? probe.readback : probe.value;
  if (probe.ok === true && readback === text && (probe.n === undefined || count === 1)) {
    return {
      ok: false,
      filled: true,
      replied: false,
      code: "filled_pending_get",
      message: "已经填进这条评论打开的回复框，并读回一致。请到平台页面发送。下一次读取评论之前，不会标成已回复。",
    };
  }
  if (probe.reason === "回复框未打开" || probe.reason === "页面不匹配" || count === 0 || probe.ok === false) {
    return { ok: false, filled: false, replied: false, code: "reply_box_closed", message: "回复框未打开，已停止。草稿还留着。" };
  }
  return { ok: false, filled: false, replied: false, code: "fill_failed", message: "没有确认写进这条评论的回复框，草稿还留着。" };
}

export function resolveReplyTab(rows, platform, envId) {
  const id = String(envId || "").trim();
  if (!id) return { ok: false, code: "missing_env", reason: "环境不匹配", message: MISSING_ENV, n: 0 };
  let page = "";
  let host = "";
  try {
    const profile = loadProfile(platform);
    page = profile.data?.metricsMap?.comment?.page || "";
    host = profile.entry?.host || "";
  } catch {
    page = "";
  }
  if (!page || !host) return { ok: false, code: "reply_box_closed", reason: "回复框未打开", message: "回复框未打开，已停止。草稿还留着。", n: 0 };
  const samePage = (item) => {
    const url = String(item?.url || "");
    return url.includes(host) && url.includes(page);
  };
  const candidates = (rows || []).filter((item) => samePage(item));
  const matched = candidates.filter((item) => String(item?.envId || "").trim() === id);
  if (!matched.length && candidates.length) {
    return { ok: false, code: "env_mismatch", reason: "环境不匹配", message: "回复框不属于当前环境，已停止。不会改用默认登录。", n: candidates.length };
  }
  if (matched.length !== 1) {
    const ambiguous = matched.length > 1;
    return {
      ok: false,
      code: ambiguous ? "reply_target_ambiguous" : "reply_box_closed",
      reason: ambiguous ? "定位不唯一" : "回复框未打开",
      message: ambiguous ? "回复目标不唯一，已停止，没有填进其他输入框。草稿还留着。" : "回复框未打开，已停止。草稿还留着。",
      n: matched.length,
    };
  }
  return { ok: true, tab: matched[0], n: 1 };
}

let commentLock = null;
let lockSeq = 0;

export function resetCommentLock() {
  commentLock = null;
  lockSeq += 1;
}

function claimCommentLock(envId, platform) {
  if (commentLock) {
    const name = PLATFORM_NAME[commentLock.platform] || commentLock.platform;
    const same = commentLock.platform === platform && commentLock.envId === envId;
    return {
      ok: false,
      code: "busy_platform",
      message: same
        ? "这个平台的评论页正在处理，不能同时再开一次。"
        : "正在处理" + name + "的评论，不能同时操作另一个平台。请等这一次结束。",
      envId,
      replied: false,
    };
  }
  lockSeq += 1;
  commentLock = { envId, platform, token: lockSeq };
  return { ok: true, token: lockSeq };
}

function releaseCommentLock(token) {
  if (commentLock && commentLock.token === token) commentLock = null;
}

function stopped(code, message, envId) {
  return { ok: false, code, message, envId: envId || "", kept: true, replied: false };
}

function markPending(dir, envId, platform, commentId, text) {
  const store = readCommentStore(dir);
  const record = store.records.find((item) => item.association === "linked" && item.envId === envId && item.platform === platform && item.commentId === commentId);
  if (!record) return;
  record.pendingReply = text;
  record.draftText = text;
  record.replied = false;
  writeCommentStore(dir, store);
}

export async function fillOpenReply(platform, text, comment = {}) {
  if (comment.batch || Array.isArray(comment.commentId)) {
    return stopped("batch_rejected", "不会自动批量回复。", comment.envId || "");
  }
  if (!canReply(platform)) return stopped("readonly", "只读，回复未开", comment.envId || "");
  const body = String(text || "").trim();
  const envId = String(comment.envId || "").trim();
  if (!body) return stopped("empty", "回复草稿是空的，没有填写。", envId);
  const dir = comment.storeDir || storeDir();
  const now = comment.now || Date.now();
  const stamps = envId ? scopedStamps(dir, envId, platform) : legacyStamps(dir, platform);
  const gate = allowReply(stamps, now);
  if (!gate.ok) return { ok: false, kept: true, code: "rate_limit", message: gate.reason, retryAt: gate.retryAt, envId, replied: false };
  if (!envId) return stopped("missing_env", MISSING_ENV, "");
  const claimed = claimCommentLock(envId, platform);
  if (!claimed.ok) return { ...claimed, kept: true };
  try {
    let probe = null;
    if (typeof comment.probe === "function") {
      probe = await comment.probe({ envId, platform, commentId: String(comment.commentId || ""), text: body });
    } else if (comment.probe) {
      probe = await comment.probe;
    } else if (typeof comment.listTabs === "function") {
      const found = resolveReplyTab(await comment.listTabs(), platform, envId);
      if (!found.ok) return { ...found, ok: false, kept: true, replied: false, envId };
      if (typeof comment.exec !== "function") return stopped("reply_box_closed", "回复框未打开，已停止。草稿还留着。", envId);
      const selector = replySelector(platform);
      const profile = loadProfile(platform);
      const page = profile.data?.metricsMap?.comment?.page || "";
      const snippet = String(comment.content || "").replace(/\s+/g, " ").trim().slice(0, 16);
      const raw = await comment.exec(buildReplyFillScript(page, selector, body, snippet, comment.commentId || ""), String(found.tab.id || ""));
      probe = pageResult(raw);
    } else {
      return stopped("reply_box_closed", "回复框未打开，已停止。没有拿到当前环境已打开的评论页。", envId);
    }
    const judged = judgeReplyTarget(probe, body);
    if (!judged.filled) return { ...judged, kept: true, envId };
    const noted = noteReplyAttempt(platform, now, { envId, storeDir: dir, commentId: comment.commentId || "", text: body });
    if (!noted.ok) return { ok: false, kept: true, code: "rate_limit", message: noted.reason, retryAt: noted.retryAt, envId, replied: false };
    markPending(dir, envId, platform, String(comment.commentId || ""), body);
    return { ...judged, kept: true, envId, replied: false, focusPlatform: platform };
  } catch {
    return stopped("fill_failed", "没有写进回复框，草稿还留着。", envId);
  } finally {
    releaseCommentLock(claimed.token);
  }
}

export async function listCommentsForEnv(envId, options = {}) {
  const id = String(envId || "").trim();
  if (!id) return { ok: false, code: "missing_env", message: MISSING_ENV, envId: "", boards: [] };
  const listed = Array.isArray(options.boards) ? options.boards : await listComments({ envId: id });
  if (!Array.isArray(listed)) return listed;
  const boards = listed;
  if (options.storeDir) {
    for (const board of boards) {
      if (!board?.open || String(board?.envId || "").trim() !== id) continue;
      if (board.reason && board.reason !== "列表为空") {
        const store = readCommentStore(options.storeDir);
        store.notes = (store.notes || []).filter((note) => !(note.envId === id && note.platform === board.platform));
        store.notes.push({ envId: id, platform: board.platform, reason: board.reason });
        writeCommentStore(options.storeDir, store);
        continue;
      }
      reconcileWithGet(options.storeDir, id, board.platform, board.comments || []);
    }
  }
  return { ok: true, code: "ok", message: "", envId: id, boards };
}
