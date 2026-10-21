/**
 * 从用户原话里找出「真的存在」的本地文件路径。
 * 支持：盘符 Windows 路径、UNC、file://、引号包裹、中文与空格路径。
 */
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const WIN_PATH = /[A-Za-z]:[\\/][^\r\n\t"'<>|?*]+/g;
/** 精确到扩展名：路径后面直接粘中文（C:\a.docx帮我总结）也能截准 */
const EXT_PATH =
  /[A-Za-z]:[\\/][^\r\n\t"'<>|?*]*?\.(?:docx?|xlsx?|pptx?|pdf|txt|md|csv|json|html?|xml|log|epub|png|jpe?g|webp|gif|bmp|svg|ya?ml)/gi;
const UNC_PATH = /\\\\[^\s\\/]+[\\/][^\r\n\t"'<>|?*]+/g;
const FILE_URL = /file:\/\/\/[^\s"'<>]+/gi;

function tidy(raw: string): string {
  let s = raw.trim();
  // 去掉句尾标点（中文句号/逗号/括号等），路径里几乎不会以它们结尾
  s = s.replace(/[。，、；：！？）】」》"'`]+$/g, "");
  s = s.replace(/[.,;:)\]}]+$/g, "");
  return s.trim();
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** 路径若把后面的中文一起吞进来（正则允许空格），按空白从尾部回退到真实文件。 */
function shrinkToExisting(cand: string): string {
  if (existsSync(cand)) return cand;
  let s = cand;
  for (let guard = 0; guard < 40 && s.length > 3; guard += 1) {
    const cut = Math.max(s.lastIndexOf(" "), s.lastIndexOf("\t"));
    if (cut <= 2) break;
    s = s.slice(0, cut);
    if (existsSync(s)) return s;
  }
  return "";
}

export function detectFilePaths(text: string, limit = 4): string[] {
  const src = String(text || "");
  const found: string[] = [];
  const push = (p: string) => {
    const clean = tidy(p);
    if (!clean) return;
    if (!found.includes(clean)) found.push(clean);
  };

  for (const m of src.matchAll(FILE_URL)) {
    try {
      push(fileURLToPath(m[0]));
    } catch {
      /* 非法 file url */
    }
  }
  for (const m of src.matchAll(EXT_PATH)) {
    const hit = tidy(m[0]);
    if (existsSync(hit) && !isDir(hit)) push(hit);
  }
  for (const m of src.matchAll(WIN_PATH)) {
    const hit = shrinkToExisting(tidy(m[0]));
    if (hit && !isDir(hit)) push(hit);
    else if (hit && isDir(hit)) push(hit);
  }
  for (const m of src.matchAll(UNC_PATH)) {
    const hit = shrinkToExisting(tidy(m[0]));
    if (hit && !isDir(hit)) push(hit);
  }

  return found.filter((p) => existsSync(p)).slice(0, limit);
}

/** 路径里最后一个名字，去掉扩展名，用于产物命名。 */
export function stemOf(filePath: string): string {
  const name = filePath.split(/[\\/]/).filter(Boolean).pop() || "file";
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return stem.replace(/[\\/:*?"<>|]/g, "").slice(0, 40) || "file";
}
