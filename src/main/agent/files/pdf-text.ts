/**
 * PDF 取字（零依赖）：解压内容流，按 Tj/TJ 提文本，ToUnicode 映射 CID。
 * 只求可用：扫描版 PDF（纯图片）提取不到字是正常的。
 */
import { inflateRawSync, inflateSync } from "node:zlib";

function hexToUtf16(hex: string): string {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  let out = "";
  for (let i = 0; i + 1 < clean.length; i += 4) {
    const code = parseInt(clean.slice(i, i + 4), 16);
    if (!Number.isNaN(code) && code !== 0) out += String.fromCharCode(code);
  }
  if (!out && clean.length) {
    const code = parseInt(clean, 16);
    if (!Number.isNaN(code)) out = String.fromCharCode(code);
  }
  return out;
}

/** 解析 ToUnicode CMap：hex code → 文本 */
function parseCMap(text: string, map: Map<string, string>): void {
  const bfchar = /beginbfchar([\s\S]*?)endbfchar/g;
  let m: RegExpExecArray | null;
  while ((m = bfchar.exec(text))) {
    const pair = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
    let p: RegExpExecArray | null;
    while ((p = pair.exec(m[1]))) map.set(p[1].toUpperCase(), hexToUtf16(p[2]));
  }
  const bfrange = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((m = bfrange.exec(text))) {
    const row = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]+)>|\[([^\]]*)\])/g;
    let r: RegExpExecArray | null;
    while ((r = row.exec(m[1]))) {
      const start = parseInt(r[1], 16);
      const end = parseInt(r[2], 16);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 65535) continue;
      const width = r[1].length;
      if (r[3]) {
        const base = hexToUtf16(r[3]);
        const first = base.charCodeAt(0) || 0;
        for (let i = 0; i <= end - start; i += 1) {
          map.set((start + i).toString(16).toUpperCase().padStart(width, "0"), String.fromCharCode(first + i));
        }
      } else if (r[4]) {
        const items = r[4].match(/<([0-9a-fA-F]+)>/g) || [];
        items.forEach((it, i) => {
          const hex = it.replace(/[<>]/g, "");
          map.set((start + i).toString(16).toUpperCase().padStart(width, "0"), hexToUtf16(hex));
        });
      }
    }
  }
}

function unescapePdfLiteral(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = raw[i + 1];
    if (next == null) break;
    if (next === "n") out += "\n";
    else if (next === "r") out += "\r";
    else if (next === "t") out += "\t";
    else if (next === "b") out += "\b";
    else if (next === "f") out += "\f";
    else if (next === "(" || next === ")" || next === "\\") out += next;
    else if (/[0-7]/.test(next)) {
      const oct = raw.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)?.[0] || next;
      out += String.fromCharCode(parseInt(oct, 8));
      i += oct.length - 1;
    } else if (next === "\n" || next === "\r") {
      /* 续行 */
      if (next === "\r" && raw[i + 2] === "\n") i += 1;
    } else out += next;
    i += 1;
  }
  return out;
}

function decodeHexString(hex: string, cmap: Map<string, string>): string {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  if (!clean) return "";
  if (cmap.size) {
    let out = "";
    const width = cmap.keys().next().value?.length || 4;
    for (let i = 0; i + width <= clean.length; i += width) {
      const code = clean.slice(i, i + width).toUpperCase();
      out += cmap.get(code) ?? "";
    }
    if (out) return out;
  }
  return hexToUtf16(clean);
}

const RE_TOKEN =
  /\((?:\\(?:\r\n|[\s\S])|[^\\)])*\)|<[0-9A-Fa-f\s]+>|\bBT\b|\bET\b|\bTj\b|\bTJ\b|\bT\*\b|\bTd\b|\bTD\b|\bTm\b|\bTf\b|\bTc\b|\bTw\b|\bTz\b|\bTL\b|'|"|\[|\]|[-+]?\d*\.?\d+/g;

/** 从已解压的内容流提文本 */
function textFromContent(content: string, cmap: Map<string, string>): string {
  let out = "";
  const operands: Array<{ kind: "str" | "arr" | "num"; text?: string; list?: string[]; num?: number }> = [];
  let lastY: number | null = null;
  let lastX: number | null = null;
  const newline = () => {
    if (!out || out.endsWith("\n")) return;
    out += "\n";
  };
  const tokenize = (src: string): string[] => {
    const arr: string[] = [];
    const re = new RegExp(RE_TOKEN.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) arr.push(m[0]);
    return arr;
  };
  for (const tok of tokenize(content)) {
    if (tok.startsWith("(")) {
      operands.push({ kind: "str", text: unescapePdfLiteral(tok.slice(1, -1)) });
      continue;
    }
    if (tok.startsWith("<") && !tok.startsWith("<<")) {
      operands.push({ kind: "str", text: decodeHexString(tok.slice(1, -1), cmap) });
      continue;
    }
    if (tok === "[") {
      operands.push({ kind: "arr", list: [] });
      continue;
    }
    if (tok === "]") {
      const arr = operands.filter((o) => o.kind === "arr").pop();
      if (arr) {
        operands.length = 0;
        operands.push(arr);
      }
      continue;
    }
    if (tok === "Tj") {
      const s = operands.filter((o) => o.kind === "str").pop();
      if (s?.text) out += s.text;
      operands.length = 0;
      continue;
    }
    if (tok === "TJ") {
      const arr = operands.filter((o) => o.kind === "arr").pop();
      if (arr?.list) out += arr.list.join("");
      operands.length = 0;
      continue;
    }
    if (tok === "'" || tok === '"') {
      const s = operands.filter((o) => o.kind === "str").pop();
      newline();
      if (s?.text) out += s.text;
      operands.length = 0;
      continue;
    }
    if (tok === "T*") {
      newline();
      operands.length = 0;
      continue;
    }
    if (tok === "Td" || tok === "TD") {
      const nums = operands.filter((o) => o.kind === "num").map((o) => o.num ?? 0);
      const y = nums[nums.length - 1];
      const x = nums[nums.length - 2];
      if (y != null && Math.abs(y) > 0.5) newline();
      if (Math.abs(y ?? 0) <= 0.5 && x != null && Math.abs(x) > 40) out += " ";
      operands.length = 0;
      continue;
    }
    if (tok === "Tm") {
      const nums = operands.filter((o) => o.kind === "num").map((o) => o.num ?? 0);
      const x = nums[nums.length - 2];
      const y = nums[nums.length - 1];
      if (y != null && lastY != null && Math.abs(y - lastY) > 1) newline();
      else if (x != null && lastX != null && lastY != null && Math.abs(y - lastY) <= 1 && x - lastX > 40) out += " ";
      lastY = y ?? lastY;
      lastX = x ?? lastX;
      operands.length = 0;
      continue;
    }
    if (tok === "ET") {
      newline();
      operands.length = 0;
      continue;
    }
    if (tok === "BT") {
      newline();
      operands.length = 0;
      continue;
    }
    if (tok === "Tf" || tok === "Tc" || tok === "Tw" || tok === "Tz" || tok === "TL") {
      operands.length = 0;
      continue;
    }
    if (/^[-+]?\d*\.?\d+$/.test(tok)) {
      operands.push({ kind: "num", num: Number(tok) });
      // 数组里的数字只用来做字距，不参与拼接
      const arr = operands.find((o) => o.kind === "arr");
      if (arr) operands.length = operands.indexOf(arr) + 1;
      continue;
    }
  }
  return out;
}

function streamChunks(s: string): Buffer[] {
  const chunks: Buffer[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(s)) && guard < 2000) {
    guard += 1;
    const start = m.index + m[0].length;
    const end = s.indexOf("endstream", start);
    if (end < 0) break;
    const raw = Buffer.from(s.slice(start, end), "latin1");
    let done = false;
    for (const fn of [inflateSync, inflateRawSync]) {
      try {
        chunks.push(fn(raw));
        done = true;
        break;
      } catch {
        /* 不是这个压缩格式，继续试 */
      }
    }
    // 未压缩的内容流（小 PDF / 手写 PDF）：直接当内容用
    if (!done && /\bBT\b|\bTj\b|\bTJ\b/.test(s.slice(start, start + 4000))) chunks.push(raw);
    re.lastIndex = end + 9;
  }
  return chunks;
}

export function extractPdfText(buf: Buffer): string {
  const s = buf.toString("latin1");
  const streams = streamChunks(s);
  const decoded: string[] = [];
  const cmap = new Map<string, string>();
  for (const chunk of streams) {
    const text = chunk.toString("latin1");
    if (/beginbfchar|beginbfrange/.test(text)) parseCMap(text, cmap);
    decoded.push(text);
  }
  const parts: string[] = [];
  for (const text of decoded) {
    if (!/\bBT\b/.test(text)) continue;
    const got = textFromContent(text, cmap);
    if (got.trim()) parts.push(got);
  }
  return parts
    .join("\n")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .trim();
}
