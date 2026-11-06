/**
 * T68 save_doc：把文字落成本地文档。模型手里的写文件工具，只写文本。
 * 不打开文件、不置前不夺焦；不覆盖已存在文件。
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import type { ToolResult } from "../shared/types.js";

const BODY_LIMIT = 2 * 1024 * 1024;
const FORMATS = new Set(["md", "txt", "html"]);
const SYSTEM_DIRS = /^\\\\|[\\/](windows|program files|program files \(x86\)|system32)[\\/]/i;

function cleanStem(title: string): string {
  return (
    title
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 40)
      .replace(/^[.-]+|[.-]+$/g, "") || "doc"
  );
}

export function saveDoc(
  configDir: string,
  args: Record<string, unknown>,
): ToolResult {
  const title = String(args.title || "").trim().slice(0, 80);
  if (!title) return { ok: false, message: "缺少 title。请补上文档标题后重试一次。" };
  const body = typeof args.body === "string" ? args.body : "";
  if (!body.trim()) return { ok: false, message: "缺少 body。请补上文档正文后重试一次。" };
  if (body.length > BODY_LIMIT) {
    return { ok: false, message: `正文超过 ${BODY_LIMIT} 字上限，请精简后再存。` };
  }
  const format = String(args.format || "md").toLowerCase();
  if (!FORMATS.has(format)) {
    return { ok: false, message: `只支持 md / txt / html，不支持 ${format}。` };
  }

  let path: string;
  const wanted = String(args.path || "").trim();
  if (wanted) {
    if (!/^[a-z]:[\\/]/i.test(wanted)) {
      return { ok: false, message: "path 必须是绝对路径，例如 D:\\笔记\\清单.md。" };
    }
    if (SYSTEM_DIRS.test(wanted)) {
      return { ok: false, message: "不能写入系统目录。" };
    }
    const ext = extname(wanted).replace(".", "").toLowerCase();
    if (!FORMATS.has(ext)) {
      return { ok: false, message: `只支持 md / txt / html 文件，${ext || "无扩展名"} 不行。` };
    }
    const parent = dirname(wanted);
    if (!existsSync(parent)) {
      return { ok: false, message: `目录不存在：${parent}。请确认路径后再存。` };
    }
    path = wanted;
  } else {
    const dir = join(configDir, "docs");
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    path = join(dir, `${stamp}-${cleanStem(title)}.${format}`);
  }
  if (existsSync(path)) {
    return { ok: false, message: `文件已存在，不覆盖：${path}。请换个文件名或路径。` };
  }
  writeFileSync(path, body, "utf8");
  return { ok: true, message: `已存到 ${path}`, data: { path } };
}
