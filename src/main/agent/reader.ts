/**
 * 阅读模式：从当前页面提取正文，并写成可打开的阅读标签。
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { BrowserWindow, WebContents, WebContentsView } from "electron";
import { readingReportHtml, writeHtmlReport, type ChatDoc } from "./report-html.js";
import type { ReaderPrefs } from "../settings/store.js";
import type { ReaderResult } from "./reader-types.js";

export type { ReaderResult } from "./reader-types.js";

const cache = new Map<string, ReaderResult>();

export function rememberReaderResult(result: ReaderResult): void {
  if (result.url) cache.set(result.url, result);
}

export function cachedReaderResult(url: string): ReaderResult | undefined {
  return cache.get(url);
}

function activePage(mainWin: BrowserWindow): WebContents {
  const kids = (mainWin.contentView?.children || []) as WebContentsView[];
  const pages = kids.filter((view) => view?.webContents && !view.webContents.isDestroyed());
  const visible = pages.find((view) => {
    try {
      return view.getVisible();
    } catch {
      return false;
    }
  });
  const wc = (visible || pages[pages.length - 1])?.webContents;
  if (!wc) throw new Error("没有可阅读的页面");
  return wc;
}

let readabilitySourceCache: string | null = null;

function readabilitySource(): string {
  if (readabilitySourceCache) return readabilitySourceCache;
  const req = createRequire(import.meta.url);
  const file = req.resolve("@mozilla/readability/Readability.js");
  readabilitySourceCache = readFileSync(file, "utf8");
  return readabilitySourceCache;
}

function extractScript(): string {
  return [
    "(() => {",
    "var module = undefined;",
    "var exports = undefined;",
    readabilitySource(),
    "var Ctor = typeof Readability === 'function' ? Readability : null;",
    "function fallback() {",
    "  var nodes = Array.prototype.slice.call(document.body.querySelectorAll('p, h1, h2, h3, li, article'));",
    "  var visible = nodes.filter(function (el) {",
    "    try { return el.getClientRects().length > 0; } catch (e) { return false; }",
    "  });",
    "  var html = '<article>' + (visible.length ? visible.map(function (el) { return el.outerHTML; }).join('') : document.body.innerHTML) + '</article>';",
    "  return { title: document.title || '阅读', contentHtml: html, textContent: document.body.innerText || '', siteName: '', url: location.href, degraded: true };",
    "}",
    "try {",
    "  if (!document.body) return null;",
    "  if (Ctor) {",
    "    var parsed = new Ctor(document.cloneNode(true)).parse();",
    "    if (parsed && parsed.content) {",
    "      return { title: parsed.title || document.title || '阅读', contentHtml: parsed.content, textContent: parsed.textContent || '', siteName: parsed.siteName || '', url: location.href, degraded: false };",
    "    }",
    "  }",
    "} catch (err) {}",
    "return fallback();",
    "})()",
  ].join("\n");
}

/** 用 Mozilla Readability 从当前页面提取正文。提取失败则降级为可见段落。 */
export async function extractReadable(mainWin: BrowserWindow): Promise<ReaderResult> {
  const wc = activePage(mainWin);
  const url = wc.getURL() || "";
  if (!url || url.startsWith("about:") || url.startsWith("chrome:")) {
    throw new Error("当前页不能进入阅读模式");
  }
  const raw = (await wc.executeJavaScript(extractScript(), true)) as ReaderResult | null;
  if (!raw || !raw.contentHtml) throw new Error("没能提取正文");
  const result: ReaderResult = {
    title: String(raw.title || "阅读").slice(0, 180),
    contentHtml: String(raw.contentHtml || ""),
    textContent: String(raw.textContent || ""),
    siteName: raw.siteName ? String(raw.siteName) : undefined,
    url: String(raw.url || url),
    degraded: Boolean(raw.degraded),
  };
  rememberReaderResult(result);
  return result;
}

export type OpenReaderOptions = {
  configDir: string;
  prefs: ReaderPrefs;
  openFile: (absPath: string) => void;
};

/** 新开一个阅读模式标签页。调用方负责用现有新标签逻辑打开文件。 */
export async function openReaderModeTab(
  _mainWin: BrowserWindow,
  result: ReaderResult,
  opts: OpenReaderOptions,
): Promise<ChatDoc> {
  const html = readingReportHtml({
    title: result.title,
    body: result.contentHtml,
    eyebrow: result.siteName || "SPARO 阅读模式",
    reader: {
      sourceUrl: result.url,
      siteName: result.siteName,
      textContent: result.textContent,
      companionOn: opts.prefs.aiCompanionOn,
      theme: opts.prefs.theme,
      fontSize: opts.prefs.fontSize,
    },
  });
  const doc = writeHtmlReport(opts.configDir, `reader-${Date.now()}`, html, {
    title: result.title,
    kind: "read",
  });
  opts.openFile(doc.path);
  return doc;
}
