import { existsSync, statSync } from "node:fs";

/** 只核对路径和大小。不读文件内容。 */
export function inspectUploadPath(
  filePath: string,
): { ok: true; path: string; sizeMB: number } | { ok: false; message: string } {
  const path = String(filePath || "").trim();
  if (!path) return { ok: false, message: "set_file 需要本地文件路径" };
  if (!existsSync(path)) return { ok: false, message: `文件不存在：${path}` };
  let size = 0;
  try {
    size = statSync(path).size;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `文件不存在：${path}（${detail}）` };
  }
  const sizeMB = Math.round((size / (1024 * 1024)) * 10) / 10;
  return { ok: true, path, sizeMB };
}
