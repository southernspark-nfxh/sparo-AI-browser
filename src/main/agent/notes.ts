/**
 * 本地笔记库：%APPDATA%\sparo-store\notes\
 * 每篇笔记 = {id}.md + {id}.meta.json
 * 索引 = notes/notes-index.json
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { storeConfigDir } from "../paths.js";

export type NoteMeta = {
  id: string;
  kind: "note";
  title: string;
  source_url: string;
  site_name?: string;
  saved_at: string;
  word_count?: number;
  summary?: string;
  highlights_refs?: string[];
  tags?: string[];
};

export type NoteIndexEntry = Pick<
  NoteMeta,
  "id" | "kind" | "title" | "source_url" | "saved_at" | "tags"
> & {
  highlight_count?: number;
};

export type NotesIndex = NoteIndexEntry[];

export type WriteNoteOpts = {
  title: string;
  source_url: string;
  site_name?: string;
  markdown: string;
  summary?: string;
  tags?: string[];
  word_count?: number;
  highlights_refs?: string[];
};

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
    /* vitest */
  }
  return storeConfigDir();
}

export function notesDir(): string {
  return join(dataDir(), "notes");
}

function indexPath(): string {
  return join(notesDir(), "notes-index.json");
}

function atomicWrite(path: string, text: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text, "utf8");
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* ignore */
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

function ensureNotesDir(): void {
  mkdirSync(notesDir(), { recursive: true });
}

function safeId(id: string): string {
  const clean = String(id || "").trim();
  if (!/^n[a-z0-9]+$/i.test(clean)) throw new Error("笔记 id 无效");
  return clean;
}

/** 生成笔记 id（简短唯一，用时间戳+4位随机）。 */
export function genNoteId(): string {
  return `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** 读 notes-index.json，不存在返回 []。 */
export function loadNotesIndex(): NotesIndex {
  const path = indexPath();
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as NotesIndex) : [];
  } catch {
    return [];
  }
}

/** 写 notes-index.json。 */
export function saveNotesIndex(index: NotesIndex): void {
  ensureNotesDir();
  atomicWrite(indexPath(), JSON.stringify(index, null, 2));
}

/** 回复卡「存为笔记」的字段：标题取用户原句前 30 字。 */
export function replyNoteFields(userText: string, reply: string, sourceUrl: string): WriteNoteOpts {
  const title = String(userText || "").trim().slice(0, 30) || "笔记";
  const markdown = String(reply || "");
  return {
    title,
    source_url: String(sourceUrl || ""),
    markdown,
    word_count: markdown.length,
  };
}

/** 写入一篇完整笔记（.md + .meta.json + 更新 index）。返回 NoteMeta。 */
export function writeNote(opts: WriteNoteOpts): NoteMeta {
  ensureNotesDir();
  const id = genNoteId();
  const saved_at = new Date().toISOString();
  const meta: NoteMeta = {
    id,
    kind: "note",
    title: String(opts.title || "未命名笔记").slice(0, 180),
    source_url: String(opts.source_url || ""),
    site_name: opts.site_name || undefined,
    saved_at,
    word_count: typeof opts.word_count === "number" ? opts.word_count : undefined,
    summary: opts.summary || undefined,
    highlights_refs: opts.highlights_refs?.length ? opts.highlights_refs : undefined,
    tags: opts.tags?.length ? opts.tags : undefined,
  };
  writeFileSync(join(notesDir(), `${id}.md`), String(opts.markdown || ""), "utf8");
  writeFileSync(join(notesDir(), `${id}.meta.json`), JSON.stringify(meta, null, 2), "utf8");
  const index = loadNotesIndex();
  index.push({
    id,
    kind: "note",
    title: meta.title,
    source_url: meta.source_url,
    saved_at,
    tags: meta.tags,
    highlight_count: meta.highlights_refs?.length || 0,
  });
  saveNotesIndex(index);
  return meta;
}

/** 列出笔记（按 saved_at 倒序）。search 匹配标题和来源 URL。 */
export function listNotes(limit?: number, tag?: string, search?: string): NoteIndexEntry[] {
  let rows = loadNotesIndex().slice();
  rows.sort((a, b) => String(b.saved_at).localeCompare(String(a.saved_at)));
  const tagNeedle = String(tag || "").trim().toLowerCase();
  if (tagNeedle) {
    rows = rows.filter((row) =>
      (row.tags || []).some((t) => String(t).toLowerCase().includes(tagNeedle)),
    );
  }
  const q = String(search || "").trim().toLowerCase();
  if (q) {
    rows = rows.filter((row) => {
      const title = String(row.title || "").toLowerCase();
      const url = String(row.source_url || "").toLowerCase();
      return title.includes(q) || url.includes(q);
    });
  }
  if (typeof limit === "number" && limit >= 0) rows = rows.slice(0, limit);
  return rows;
}

export function readNote(id: string): { meta: NoteMeta; markdown: string } | null {
  let safe: string;
  try {
    safe = safeId(id);
  } catch {
    return null;
  }
  const metaPath = join(notesDir(), `${safe}.meta.json`);
  const mdPath = join(notesDir(), `${safe}.md`);
  if (!existsSync(metaPath) || !existsSync(mdPath)) return null;
  try {
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as NoteMeta;
    const markdown = readFileSync(mdPath, "utf8");
    return { meta, markdown };
  } catch {
    return null;
  }
}

export function deleteNote(id: string): boolean {
  let safe: string;
  try {
    safe = safeId(id);
  } catch {
    return false;
  }
  const metaPath = join(notesDir(), `${safe}.meta.json`);
  const mdPath = join(notesDir(), `${safe}.md`);
  let removed = false;
  for (const path of [metaPath, mdPath]) {
    if (!existsSync(path)) continue;
    unlinkSync(path);
    removed = true;
  }
  const index = loadNotesIndex().filter((row) => row.id !== safe);
  saveNotesIndex(index);
  return removed || loadNotesIndex().every((row) => row.id !== safe);
}

type TurndownLike = {
  turndown(html: string): string;
  addRule(
    name: string,
    rule: { filter: string; replacement: (content: string) => string },
  ): void;
};

/** HTML → Markdown。`<mark>` 只保留原文。 */
export function htmlToMarkdown(html: string): string {
  const req = createRequire(import.meta.url);
  const loaded = req("turndown") as
    | (new (options?: object) => TurndownLike)
    | { default: new (options?: object) => TurndownLike };
  const Ctor = typeof loaded === "function" ? loaded : loaded.default;
  const td = new Ctor({ headingStyle: "atx", bulletListMarker: "-" });
  td.addRule("mark", {
    filter: "mark",
    replacement: (content) => content,
  });
  return td.turndown(String(html || ""));
}
