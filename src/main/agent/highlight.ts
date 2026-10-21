/**
 * 高亮数据按 URL 持久化到 %APPDATA%\sparo-store\highlights.json。
 */
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { storeConfigDir } from "../paths.js";

export type Highlight = {
  chunkId: string;
  color: "yellow" | "green" | "blue" | "red";
  text: string;
  note?: string;
  aiSummary?: string;
  createdAt: string;
};

/** highlights.json 整体结构：key = URL，value = 该 URL 的高亮数组 */
export type HighlightsStore = Record<string, Highlight[]>;

const HIGHLIGHTS_FILE = "highlights.json";

function dataDir(): string {
  const env = process.env.SPARO_CONFIG_DIR || process.env.SPARK_CONFIG_DIR;
  if (env) return env;
  try {
    const req = createRequire(import.meta.url);
    const electron = req("electron") as {
      app?: { isReady: () => boolean; getPath: (name: string) => string };
    };
    if (electron.app?.isReady()) return electron.app.getPath("userData");
  } catch {
    /* vitest / 非 Electron */
  }
  return storeConfigDir();
}

function storePath(): string {
  return join(dataDir(), HIGHLIGHTS_FILE);
}

function atomicWrite(path: string, text: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text, "utf8");
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* 目标不存在 */
  }
  try {
    renameSync(tmp, path);
  } catch {
    writeFileSync(path, text, "utf8");
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

/** 读 highlights.json，不存在或损坏返回空对象。 */
export function loadHighlights(): HighlightsStore {
  const path = storePath();
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as HighlightsStore;
  } catch {
    return {};
  }
}

/** 写 highlights.json（覆盖式写入，先写 .tmp 再替换）。 */
export function saveHighlights(store: HighlightsStore): void {
  atomicWrite(storePath(), JSON.stringify(store, null, 2));
}

/** 取某 URL 的高亮数组（没有返回 []）。 */
export function getHighlightsForUrl(store: HighlightsStore, url: string): Highlight[] {
  const list = store[url];
  return Array.isArray(list) ? list : [];
}

export function upsertHighlightsForUrl(url: string, highlights: Highlight[]): HighlightsStore {
  const store = loadHighlights();
  store[url] = highlights;
  saveHighlights(store);
  return store;
}
