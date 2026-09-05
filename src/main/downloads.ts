import { existsSync } from "node:fs";
import { basename, extname, join } from "node:path";

export function sanitizeDownloadName(filename: string): string {
  const raw = String(filename || "download").trim() || "download";
  const cleaned = raw.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 180);
  return cleaned || "download";
}

/** Prefer `file (1).pdf` over overwriting an existing download. */
export function uniqueDownloadPath(
  dir: string,
  filename: string,
  exists: (p: string) => boolean = existsSync,
): string {
  const safe = sanitizeDownloadName(filename);
  const first = join(dir, safe);
  if (!exists(first)) return first;
  const ext = extname(safe);
  const base = basename(safe, ext) || "download";
  let n = 1;
  while (exists(join(dir, `${base} (${n})${ext}`))) n += 1;
  return join(dir, `${base} (${n})${ext}`);
}
