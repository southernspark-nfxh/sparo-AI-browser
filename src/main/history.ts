import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type HistoryItem = {
  url: string;
  title: string;
  ts: string;
};

const CAP = 200;

function historyPath(configDir: string): string {
  return join(configDir, "history.json");
}

export function normalizeHistoryUrl(url: string): string {
  const u = String(url || "").trim();
  if (!u || u === "about:blank") return "";
  try {
    const parsed = new URL(u);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return u;
  }
}

export function pushHistory(items: HistoryItem[], next: HistoryItem, cap = CAP): HistoryItem[] {
  const url = normalizeHistoryUrl(next.url);
  if (!url) return items.slice(-cap);
  const rest = items.filter((h) => normalizeHistoryUrl(h.url) !== url);
  return [...rest, { url, title: next.title || url, ts: next.ts }].slice(-cap);
}

export function loadHistory(configDir: string): HistoryItem[] {
  const p = historyPath(configDir);
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((h): h is HistoryItem => Boolean(h && typeof h === "object" && typeof (h as HistoryItem).url === "string"))
      .slice(-CAP);
  } catch {
    return [];
  }
}

export function saveHistory(configDir: string, items: HistoryItem[]): void {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(historyPath(configDir), JSON.stringify(items.slice(-CAP), null, 2), "utf8");
}

export function recordVisit(configDir: string, url: string, title: string): HistoryItem[] {
  const items = pushHistory(loadHistory(configDir), {
    url,
    title,
    ts: new Date().toISOString(),
  });
  saveHistory(configDir, items);
  return items;
}

export function clearHistory(configDir: string): void {
  saveHistory(configDir, []);
}
