// Sparo MCP 客户端（JSON-RPC over HTTP）
// 用法：
//   node sparo.mjs tabs
//   node sparo.mjs text <tabId>
//   node sparo.mjs exec <脚本文件> <tabId>
//   node sparo.mjs click <selector> <tabId>
//   node sparo.mjs upload <selector> <本地文件> <tabId>
// 作为库：
//   import { connect, call, tabs, useTab, exec, click, press, uploadFile, select, clickText, menuClick, nav, sleep } from "./sparo.mjs";
// 页面动作带 tabId，执行前核对 location.href。发布流程会临时 switch_tab 让编辑页完成布局，结束再切回，不调用 window.focus、restore，也不闪任务栏。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function readAuthFile() {
  const file = path.join(process.env.APPDATA || "", "sparo-store", "mcp-auth.json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function resolveAuth() {
  let file = null;
  try {
    file = readAuthFile();
  } catch {
    file = null;
  }
  const fromEnv = process.env.SPARO_TOKEN || "";
  if (!fromEnv && !file?.token) {
    throw new Error("没有 token：设置 SPARO_TOKEN，或提供 %APPDATA%\\sparo-store\\mcp-auth.json");
  }
  return {
    source: fromEnv ? "SPARO_TOKEN" : "mcp-auth.json",
    token: fromEnv || file.token,
    endpoint: process.env.SPARO_MCP || file?.endpoint || "http://127.0.0.1:3921/mcp",
  };
}

let authCache = null;
function auth() {
  if (!authCache) authCache = resolveAuth();
  return authCache;
}

let sessionId = null;
function stableClientId() {
  const fromEnv = String(process.env.SPARO_CLIENT || "").trim();
  return fromEnv || "social-media-publish";
}
let clientId = stableClientId();
let idSeq = 1;
let pin = null;
let toolProps = null;

export function authSource() {
  return auth().source;
}

function parseBody(text, ctype) {
  if ((ctype || "").includes("text/event-stream") || text.startsWith("event:") || text.startsWith("data:")) {
    const datas = text.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).filter(Boolean);
    try { return JSON.parse(datas[datas.length - 1]); } catch { return { raw: text }; }
  }
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function rpc(method, params, isNotify = false) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: "Bearer " + auth().token,
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  headers["x-sparo-client"] = clientId;
  const body = { jsonrpc: "2.0", method };
  if (!isNotify) body.id = idSeq++;
  if (params !== undefined) body.params = params;
  const res = await fetch(auth().endpoint, { method: "POST", headers, body: JSON.stringify(body) });
  const sid = res.headers.get("mcp-session-id");
  if (sid) sessionId = sid;
  return parseBody(await res.text(), res.headers.get("content-type"));
}

const clientName = stableClientId();

let connected = false;
export async function connect() {
  if (connected) return;
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: clientName, version: "2.1.0" },
  });
  await rpc("notifications/initialized", undefined, true);
  connected = true;
}

export async function call(name, args = {}) {
  await connect();
  const r = await rpc("tools/call", { name, arguments: args });
  return (r?.result?.content || []).map((c) => c.text || "").join("\n");
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hostOf(url) {
  try { return new URL(url).host; } catch { return ""; }
}

function hrefMatches(href, expect) {
  if (!expect) return true;
  return String(href || "").includes(String(expect));
}

function urlFromPayload(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const text = value.trim();
    if (/^https?:\/\//i.test(text)) return text;
    const found = text.match(/https?:\/\/[^\s"]+/);
    return found ? found[0] : "";
  }
  if (typeof value === "object") {
    return (
      urlFromPayload(value.url) ||
      urlFromPayload(value.href) ||
      urlFromPayload(value.data) ||
      urlFromPayload(value.result)
    );
  }
  return "";
}

async function readHrefOnce(tabId) {
  const raw = await call("get_url", { tabId });
  const direct = urlFromPayload(raw);
  if (direct) return direct;
  try {
    return urlFromPayload(JSON.parse(raw));
  } catch {
    return "";
  }
}

async function readHref(tabId) {
  let href = "";
  for (let i = 0; i < 3; i++) {
    href = await readHrefOnce(tabId);
    if (href) return href;
    if (i < 2) await sleep(200);
  }
  return "";
}

/** 空地址是 URL_UNREAD，读到了但不是目标才是 MISMATCH。 */
export function classifyHref(href, want) {
  if (!href) return "URL_UNREAD";
  if (want && !hrefMatches(href, want)) return "MISMATCH:" + href;
  return "";
}

export function clientIdentity() {
  return stableClientId();
}

export async function sessionStamp() {
  await connect();
  const id = stableClientId();
  clientId = id;
  return {
    clientId: id,
    owner: "agent:" + id,
    name: id,
  };
}

/**
 * 动作发出去之前核对目标标签的地址。
 * 读不到返回 URL_UNREAD；读到了但不是目标返回 MISMATCH。调用方不得再发这个动作。
 */
async function gate(tabId, expect) {
  const id = tabId || pin?.tabId;
  if (!id) return "URL_UNREAD";
  const href = await readHref(id);
  const want = expect || pin?.expect || "";
  const mark = classifyHref(href, want);
  if (mark) return mark;
  return { tabId: id, href };
}

async function loadToolProps() {
  if (toolProps) return toolProps;
  await connect();
  const listed = await rpc("tools/list");
  toolProps = new Map();
  for (const tool of listed?.result?.tools || []) {
    toolProps.set(tool.name, tool?.inputSchema?.properties || {});
  }
  return toolProps;
}

/** 服务端参数表里没有 tabId 时，调用会落到活动标签。这种情况停手，不发动作。 */
async function gateTool(name, tabId, expect) {
  const gated = await gate(tabId, expect);
  if (typeof gated === "string") return gated;
  const props = await loadToolProps();
  if (!Object.prototype.hasOwnProperty.call(props.get(name) || {}, "tabId")) {
    return "MISMATCH:SERVER_NO_TABID:" + name;
  }
  return gated;
}

// 只记住目标标签和它当前的 host。不切标签、不抢焦点。
export async function useTab(id, expect) {
  const href = await readHref(id);
  const want = expect || hostOf(href);
  const mark = classifyHref(href, expect || "");
  if (mark) return mark;
  pin = { tabId: id, expect: want };
  return id;
}

export async function exec(script, tabId, expect) {
  const gated = await gateTool("execute", tabId, expect);
  if (typeof gated === "string") { console.error(`[DEBUG exec] gated blocked: ${gated}`); return gated; }
  const result = await call("execute", { script, tabId: gated.tabId });
  console.error(`[DEBUG exec] tabId=${gated.tabId} result=`, JSON.stringify(result)?.slice(0, 300));
  return result;
}

export async function click(selector, tabId, expect) {
  const gated = await gateTool("click", tabId, expect);
  if (typeof gated === "string") return gated;
  const args = { tabId: gated.tabId };
  if (selector && typeof selector === "object") {
    if (selector.ref) args.ref = selector.ref;
    if (selector.selector) args.selector = selector.selector;
    if (selector.caret) args.caret = true;
  } else {
    args.selector = selector;
  }
  return call("click", args);
}

export async function clickText(text, tabId, expect) {
  const extra = tabId && typeof tabId === "object" ? tabId : null;
  const gated = await gateTool("click_text", extra ? extra.tabId : tabId, extra ? extra.expect : expect);
  if (typeof gated === "string") return gated;
  const args = { text, tabId: gated.tabId };
  if (extra?.exact != null) args.exact = extra.exact;
  if (extra?.withinPortal != null) args.withinPortal = extra.withinPortal;
  if (extra?.caret != null) args.caret = extra.caret;
  return call("click_text", args);
}

// press 的参数只有 key 和 tabId。
export async function press(key, tabId, expect) {
  const gated = await gateTool("press", tabId, expect);
  if (typeof gated === "string") return gated;
  return call("press", { key, tabId: gated.tabId });
}

export async function uploadFile(selector, file, tabId, expect) {
  const gated = await gateTool("upload", tabId, expect);
  if (typeof gated === "string") return gated;
  const picked = selector && typeof selector === "object" ? selector : { selector };
  const args = { files: [file], tabId: gated.tabId };
  if (picked.ref) args.ref = picked.ref;
  if (picked.selector) args.selector = picked.selector;
  return call("upload", args);
}

export async function select(target, value, tabId, expect) {
  const gated = await gateTool("select", tabId, expect);
  if (typeof gated === "string") return gated;
  const picked = target && typeof target === "object" ? target : { selector: target };
  return call("select", { ref: picked.ref, selector: picked.selector, value, tabId: gated.tabId });
}

export async function menuClick(trigger, item, tabId, expect) {
  const gated = await gateTool("menu_click", tabId, expect);
  if (typeof gated === "string") return gated;
  return call("menu_click", { trigger, item, tabId: gated.tabId });
}

export function tabRows(listed) {
  if (Array.isArray(listed)) return listed;
  return Array.isArray(listed?.tabs) ? listed.tabs : [];
}

export function activeIdOf(listed) {
  if (Array.isArray(listed)) return String(listed.activeId || "");
  return String(listed?.activeId || "");
}

export async function tabs() {
  const raw = await call("list_tabs");
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const data = parsed?.data || parsed?.result || parsed || {};
  const list = data.tabs || parsed?.tabs || [];
  return {
    tabs: Array.isArray(list) ? list : [],
    activeId: String(data.activeId || parsed?.activeId || ""),
  };
}

/** 只切换活动标签。不调用 window.focus，不 restore，不闪任务栏。 */
export async function switchTab(id) {
  if (!id) return "NO_TAB";
  return call("switch_tab", { id });
}

export async function hasTool(name) {
  await connect();
  const listed = await rpc("tools/list");
  const tools = listed?.result?.tools || [];
  return tools.some((tool) => tool && tool.name === name);
}

/** 申请主进程后台渲染。当前进程没有这个工具时 missing，不假装已经恢复窗口。 */
export async function ensureRender(tabId) {
  if (!(await hasTool("ensure_render"))) return { missing: true, ok: false };
  const raw = await call("ensure_render", tabId ? { tabId } : {});
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (parsed && parsed.ok === false) return { missing: false, ok: false, detail: parsed };
  return { missing: false, ok: true, detail: parsed || raw };
}

/** 归还这一次后台渲染。没申请过就不要调用。 */
export async function releaseRender() {
  if (!(await hasTool("ensure_render"))) return { missing: true, ok: true };
  return call("ensure_render", { release: true });
}

export async function nav(url, tabId) {
  if (!tabId) {
    const before = new Set(tabRows(await tabs()).map((tab) => tab.id));
    const raw = await call("navigate", { url });
    const after = tabRows(await tabs());
    const created = after.find((tab) => !before.has(tab.id));
    const href = created?.id ? await readHref(created.id) : "";
    if (created?.id) pin = { tabId: created.id, expect: hostOf(href) || hostOf(url) };
    return JSON.stringify({ opened: raw, tabId: created?.id || "", href });
  }
  const gated = await gate(tabId);
  if (typeof gated === "string") return gated;
  const raw = await call("navigate", { url, tabId: gated.tabId });
  pin = { tabId: gated.tabId, expect: hostOf(url) };
  return raw;
}

// ---------------- CLI ----------------
const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  const [, , cmd, ...rest] = process.argv;
  const run = async () => {
    switch (cmd) {
      case "tabs": {
        const listed = await tabs();
        console.log("activeId", listed.activeId || "");
        console.table(tabRows(listed).map((t) => ({ id: t.id, active: t.id === listed.activeId, title: (t.title || "").slice(0, 28), url: (t.url || "").slice(0, 70) })));
        break;
      }
      case "text": {
        if (!rest[0]) throw new Error("用法：node sparo.mjs text <tabId>");
        const gated = await useTab(rest[0]);
        if (String(gated).startsWith("MISMATCH")) {
          console.log(gated);
          break;
        }
        console.log(await call("page_text", { tabId: rest[0] }));
        break;
      }
      case "exec": {
        const file = rest[0];
        if (!file || !rest[1]) throw new Error("用法：node sparo.mjs exec <脚本文件> <tabId>");
        console.log(await exec(fs.readFileSync(file, "utf8"), rest[1]));
        break;
      }
      case "click": {
        if (!rest[0] || !rest[1]) throw new Error("用法：node sparo.mjs click <selector> <tabId>");
        console.log(await click(rest[0], rest[1]));
        break;
      }
      case "upload": {
        if (!rest[0] || !rest[1] || !rest[2]) throw new Error("用法：node sparo.mjs upload <selector> <文件> <tabId>");
        console.log(await uploadFile(rest[0], path.resolve(rest[1]), rest[2]));
        break;
      }
      case "auth":
        console.log(authSource());
        break;
      default:
        console.log("命令：tabs | auth | text <tabId> | exec <file> <tabId> | click <selector> <tabId> | upload <selector> <file> <tabId>");
    }
  };
  run().catch((e) => {
    console.error("ERROR:", e.message);
    process.exit(1);
  });
}
