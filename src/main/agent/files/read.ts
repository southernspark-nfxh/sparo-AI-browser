/**
 * 读本地文档 → 纯文本。零第三方依赖：txt/md/csv/json/html/docx/xlsx/pptx/pdf/图片。
 */
import { readFileSync, statSync, readdirSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { readZip } from "./zip.js";
import { extractPdfText } from "./pdf-text.js";

export type DocKind =
  | "text"
  | "markdown"
  | "csv"
  | "json"
  | "html"
  | "docx"
  | "xlsx"
  | "pptx"
  | "pdf"
  | "image"
  | "unknown";

export type LocalDoc = {
  ok: boolean;
  path: string;
  name: string;
  kind: DocKind;
  text: string;
  bytes: number;
  truncated: boolean;
  message?: string;
};

const MAX_BYTES = 24 * 1024 * 1024;
const MAX_CHARS = 120000;

const TEXT_EXT: Record<string, DocKind> = {
  ".txt": "text",
  ".log": "text",
  ".md": "markdown",
  ".markdown": "markdown",
  ".csv": "csv",
  ".tsv": "csv",
  ".json": "json",
  ".html": "html",
  ".htm": "html",
  ".xml": "text",
  ".yml": "text",
  ".yaml": "text",
  ".ini": "text",
  ".conf": "text",
  ".srt": "text",
};

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);

function decodeText(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return clean(buf.toString("utf16le"));
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf);
    swapped.swap16();
    return clean(swapped.toString("utf16le"));
  }
  const utf8 = buf.toString("utf8");
  // UTF-8 解出来出现大量替换符 = 不是 utf8（多半是 GBK）
  const bad = (utf8.match(/\ufffd/g) || []).length;
  if (bad > Math.max(3, utf8.length * 0.01)) {
    try {
      return clean(new TextDecoder("gbk").decode(buf));
    } catch {
      return clean(utf8);
    }
  }
  return clean(utf8);
}

function clean(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

function xmlText(xml: string): string {
  return xml
    .replace(/<w:tab\b[^>]*\/>/g, "\t")
    .replace(/<w:br\b[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<\/a:p>/g, "\n")
    .replace(/<\/w:tr>/g, "\n")
    .replace(/<\/w:tc>/g, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

function readDocx(zip: Map<string, Buffer>): string {
  const main = zip.get("word/document.xml");
  if (!main) return "";
  return xmlText(main.toString("utf8")).trim();
}

function readPptx(zip: Map<string, Buffer>): string {
  const slides = [...zip.keys()]
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => (Number(a.match(/(\d+)\.xml$/)?.[1] || 0)) - (Number(b.match(/(\d+)\.xml$/)?.[1] || 0)));
  const out: string[] = [];
  slides.forEach((key, i) => {
    const text = xmlText(zip.get(key)!.toString("utf8")).trim();
    if (text) out.push(`## 第 ${i + 1} 页\n${text}`);
  });
  return out.join("\n\n");
}

function colName(idx: number): string {
  let n = idx;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function readXlsx(zip: Map<string, Buffer>): string {
  // 共享字符串：<si> 里可能只有 <t>，也可能有多个 <r><t>
  const sharedRaw = zip.get("xl/sharedStrings.xml")?.toString("utf8") || "";
  const shared: string[] = [];
  for (const si of sharedRaw.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)) {
    const parts = [...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]);
    shared.push(
      parts
        .join("")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&"),
    );
  }
  const wb = zip.get("xl/workbook.xml")?.toString("utf8") || "";
  const sheetNames = [...wb.matchAll(/<sheet[^>]*name="([^"]*)"/g)].map((m) => m[1]);
  const sheets = [...zip.keys()]
    .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)?.[1] || 0) - Number(b.match(/(\d+)\.xml$/)?.[1] || 0));
  const out: string[] = [];
  sheets.forEach((key, si) => {
    const xml = zip.get(key)!.toString("utf8");
    const rows: string[] = [];
    for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attrs = c[1];
        const body = c[2];
        const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
        const type = /t="([^"]+)"/.exec(attrs)?.[1];
        let val = "";
        if (type === "inlineStr") {
          val = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join("");
        } else {
          const v = /<v[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
          val = type === "s" ? shared[Number(v)] ?? "" : v;
        }
        val = val
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&amp;/g, "&")
          .replace(/\s+/g, " ")
          .trim();
        if (ref) {
          const idx = ref.split("").reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
          while (cells.length < idx) cells.push("");
        }
        cells.push(val);
      }
      if (cells.some((x) => x)) rows.push(cells.join(" | "));
    }
    const title = sheetNames[si] ? `## 工作表：${sheetNames[si]}` : `## 工作表 ${si + 1}`;
    out.push(`${title}\n${rows.slice(0, 400).join("\n")}`);
  });
  return out.join("\n\n");
}

function htmlToText(src: string): string {
  return clean(
    src
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/t[dh]>/gi, "\t")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&"),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function kindOf(ext: string): DocKind {
  if (TEXT_EXT[ext]) return TEXT_EXT[ext];
  if (IMAGE_EXT.has(ext)) return "image";
  if (ext === ".docx") return "docx";
  if (ext === ".xlsx" || ext === ".xlsm") return "xlsx";
  if (ext === ".pptx") return "pptx";
  if (ext === ".pdf") return "pdf";
  if (ext === ".doc" || ext === ".xls" || ext === ".ppt") return "unknown";
  return "unknown";
}

export function readLocalDoc(filePath: string): LocalDoc {
  const name = basename(filePath);
  const ext = extname(filePath).toLowerCase();
  const kind = kindOf(ext);
  const base: LocalDoc = {
    ok: false,
    path: filePath,
    name,
    kind,
    text: "",
    bytes: 0,
    truncated: false,
  };
  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    return { ...base, message: "文件不在了" };
  }
  if (stat.isDirectory()) {
    try {
      const names = readdirSync(filePath).slice(0, 200);
      return {
        ...base,
        ok: true,
        kind: "text",
        bytes: 0,
        text: `（文件夹）${filePath}\n` + names.join("\n"),
      };
    } catch {
      return { ...base, message: "读不了这个文件夹" };
    }
  }
  if (stat.size > MAX_BYTES) {
    return { ...base, bytes: stat.size, message: `文件太大（${Math.round(stat.size / 1048576)}MB），先拆分或压缩。` };
  }
  let buf: Buffer;
  try {
    buf = readFileSync(filePath);
  } catch (err) {
    return { ...base, bytes: stat.size, message: err instanceof Error ? err.message : "读取失败" };
  }

  let text = "";
  let message: string | undefined;
  try {
    if (kind === "docx") text = readDocx(readZip(buf));
    else if (kind === "pptx") text = readPptx(readZip(buf));
    else if (kind === "xlsx") text = readXlsx(readZip(buf));
    else if (kind === "pdf") text = extractPdfText(buf);
    else if (kind === "html") text = htmlToText(decodeText(buf));
    else if (kind === "image") {
      return { ...base, ok: true, bytes: buf.length, message: "这是图片，交给识图来看。" };
    } else text = decodeText(buf);
  } catch (err) {
    message = `解析失败：${err instanceof Error ? err.message : String(err)}`;
  }

  if (kind === "unknown" && !text) {
    message = message || "这个格式还读不了（支持 txt/md/csv/json/html/docx/xlsx/pptx/pdf/图片）。";
  }
  const truncated = text.length > MAX_CHARS;
  return {
    ...base,
    ok: Boolean(text.trim()),
    bytes: buf.length,
    text: truncated ? text.slice(0, MAX_CHARS) : text,
    truncated,
    message: text.trim() ? (truncated ? "内容较长，只取了前 12 万字。" : undefined) : message,
  };
}

/** 目录里挑一个能读的文件（用户只给了文件夹时） */
export function firstReadableIn(dir: string): string | null {
  try {
    const names = readdirSync(dir);
    const rank = (n: string) => {
      const k = kindOf(extname(n).toLowerCase());
      return k === "unknown" || k === "image" ? 1 : 0;
    };
    const ok = names.filter((n) => rank(n) === 0).sort();
    return ok[0] ? join(dir, ok[0]) : null;
  } catch {
    return null;
  }
}
