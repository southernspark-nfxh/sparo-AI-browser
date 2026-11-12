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
