import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

export type BookmarkItem = {
  id: string;
  title: string;
  url: string;
  folder: string;
  /** Show on bookmarks bar (like Chrome 书签栏) */
  bar: boolean;
  source: "chrome" | "edge" | "manual";
};

type ChromiumNode = {
  type?: string;
  name?: string;
  url?: string;
  children?: ChromiumNode[];
};

function localAppData(): string {
  return process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
}

function newId(): string {
  return randomBytes(4).toString("hex");
}

export function chromiumBookmarkPaths(): Array<{
  id: "chrome" | "edge";
  label: string;
  path: string;
  exists: boolean;
}> {
  const base = localAppData();
  const candidates = [
    {
      id: "chrome" as const,
      label: "Chrome",
      path: join(base, "Google", "Chrome", "User Data", "Default", "Bookmarks"),
    },
    {
      id: "edge" as const,
      label: "Edge",
      path: join(base, "Microsoft", "Edge", "User Data", "Default", "Bookmarks"),
    },
  ];
  return candidates.map((c) => ({ ...c, exists: existsSync(c.path) }));
}

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // Chrome/Edge may lock the file briefly — copy then read
    const tmp = join(tmpdir(), `spark-bm-${randomBytes(4).toString("hex")}.json`);
    copyFileSync(path, tmp);
    try {
      return JSON.parse(readFileSync(tmp, "utf8"));
    } finally {
      try {
        unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
  }
}

function walk(
  node: ChromiumNode | undefined,
  folder: string,
  onBar: boolean,
  source: "chrome" | "edge",
  out: BookmarkItem[],
): void {
  if (!node) return;
  const isUrl =
    node.type === "url" ||
    (!!node.url && !node.children && node.type !== "folder");
  if (isUrl && node.url) {
    if (!/^https?:\/\//i.test(node.url) && !node.url.startsWith("file:")) return;
    out.push({
      id: newId(),
      title: (node.name || node.url).trim() || node.url,
      url: node.url,
      folder,
      bar: onBar,
      source,
    });
    return;
  }
  if (node.children?.length) {
    const name = node.name || folder;
    const next =
      folder && node.name && node.type === "folder"
        ? `${folder} / ${node.name}`
        : name;
    for (const child of node.children) {
      walk(child, next, onBar, source, out);
    }
  }
}

export function readChromiumBookmarks(
  source: "chrome" | "edge",
): { ok: boolean; message: string; items: BookmarkItem[] } {
  const entry = chromiumBookmarkPaths().find((p) => p.id === source);
  if (!entry) return { ok: false, message: "未知来源", items: [] };
  if (!entry.exists) {
    return {
      ok: false,
      message: `未找到 ${entry.label} 书签（请确认已安装并登录过）`,
      items: [],
    };
  }
  try {
    const raw = readJsonFile(entry.path) as {
      roots?: Record<string, ChromiumNode>;
    };
    const items: BookmarkItem[] = [];
    const roots = raw.roots || {};
    for (const [key, root] of Object.entries(roots)) {
      const onBar = key === "bookmark_bar";
      const folder =
        key === "bookmark_bar"
          ? "书签栏"
          : key === "other"
            ? "其他书签"
            : key === "synced"
              ? "已同步"
              : key;
      walk(root, folder, onBar, source, items);
    }
    return {
      ok: true,
      message: `已从 ${entry.label} 导入 ${items.length} 个书签`,
      items,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      items: [],
    };
  }
}

export function sparkBookmarksPath(configDir: string): string {
  return join(configDir, "bookmarks.json");
}

export function loadSavedBookmarks(configDir: string): BookmarkItem[] {
  const p = sparkBookmarksPath(configDir);
  if (!existsSync(p)) return [];
  try {
    const data = JSON.parse(readFileSync(p, "utf8")) as { items?: BookmarkItem[] };
    return (data.items || [])
      .map((b) => {
        const folder = String(b.folder || "");
        const bar =
          typeof b.bar === "boolean"
            ? b.bar
            : /书签栏|收藏夹栏|bookmarks?\s*bar/i.test(folder);
        return {
          ...b,
          id: b.id || newId(),
          title: b.title || b.url,
          url: b.url,
          folder: folder || "其他书签",
          bar,
          source: b.source || "manual",
        };
      })
      .filter((b) => Boolean(b.url));
  } catch {
    return [];
  }
}

export function saveBookmarks(configDir: string, items: BookmarkItem[]): void {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    sparkBookmarksPath(configDir),
    JSON.stringify({ items, updatedAt: new Date().toISOString() }, null, 2),
    "utf8",
  );
}

export function mergeBookmarks(
  existing: BookmarkItem[],
  incoming: BookmarkItem[],
): BookmarkItem[] {
  const map = new Map<string, BookmarkItem>();
  for (const b of existing) map.set(b.url, b);
  for (const b of incoming) {
    const prev = map.get(b.url);
    map.set(b.url, prev ? { ...b, id: prev.id } : b);
  }
  return [...map.values()];
}

export function bookmarkCurrentPage(
  items: BookmarkItem[],
  title: string,
  url: string,
): BookmarkItem[] {
  if (!url || url === "about:blank") return items;
  const existing = items.find((b) => b.url === url);
  if (existing) {
    return items.filter((b) => b.url !== url);
  }
  return [
    {
      id: newId(),
      title: title || url,
      url,
      folder: "书签栏",
      bar: true,
      source: "manual",
    },
    ...items,
  ];
}
