import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { listCaptures } from "../captures.js";

export type LedgerClose = "done" | "blocked" | "interrupted";

export function ledgerCloseReason(result: {
  ok: boolean;
  interrupted?: boolean;
  awaitingConfirm?: boolean;
}): LedgerClose | undefined {
  if (result.interrupted) return "interrupted";
  if (result.awaitingConfirm) return "blocked";
  if (result.ok) return "done";
  return undefined;
}

export function capturesSince(configDir: string, startedAt: number): string[] {
  try {
    return listCaptures(configDir, 100)
      .filter((item) => Date.parse(item.time) >= startedAt)
      .map((item) => item.file.split(/[/\\]/).pop() || item.file);
  } catch {
    return [];
  }
}

export function reportSince(configDir: string, startedAt: number): string | undefined {
  const dir = join(configDir, "reports");
  if (!existsSync(dir)) return undefined;
  let best: { file: string; mtime: number } | undefined;
  for (const name of readdirSync(dir)) {
    if (!/\.html?$/i.test(name)) continue;
    const file = join(dir, name);
    const mtime = statSync(file).mtimeMs;
    if (mtime + 5 >= startedAt && (!best || mtime > best.mtime)) best = { file, mtime };
  }
  return best ? pathToFileURL(best.file).href : undefined;
}
