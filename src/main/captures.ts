import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** 单张网页图片上限。截图不走这条，仍受库容限制。 */
export const CAPTURE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** 素材库总量。超过后新存报满，不自动删。 */
export const CAPTURE_LIBRARY_MAX_BYTES = 500 * 1024 * 1024;
export const CAPTURE_RUN_LIMIT = 20;

export const RUN_CAPTURE_FULL =
  "本任务素材已满 20 张，不再保存。已有文件都还在，不会自动删除。";
export const LIBRARY_CAPTURE_FULL =
  "素材库已满 500MB，不再保存。已有文件都还在，不会自动删除。";

export const CAPTURE_PROMPT =
  "任务中需要留档或后续引用的页面状态、网页图片，用 save_shot / save_image 存进本机素材库；之后要在微博、贴吧等站贴图时，用 set_file 把素材路径放进该站的文件选择框。素材只存本机，不进聊天记录。";

export type CaptureKind = "shot" | "image";

export type CaptureRecord = {
  file: string;
  kind: CaptureKind;
  src?: string;
  url: string;
  title: string;
  time: string;
};

export type SaveCaptureResult =
  | { ok: true; file: string; url: string; title: string; src?: string }
  | { ok: false; message: string };

export function capturesDir(configDir: string): string {
  return join(configDir, "captures");
}

export function libraryBytes(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const name of readdirSync(dir)) {
    try {
      const st = statSync(join(dir, name));
      if (st.isFile()) total += st.size;
    } catch {
      /* 读不到的文件不计入，也不删 */
    }
  }
  return total;
}

function imageExt(contentType: string): string | null {
  const mime = contentType.split(";")[0].trim().toLowerCase();
  if (!mime.startsWith("image/")) return null;
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "image/png") return "png";
  const sub = mime.slice("image/".length).replace(/[^a-z0-9]/g, "");
  if (!sub || sub.length > 8) return null;
  return sub;
}

function readIndex(dir: string): CaptureRecord[] | { message: string } {
  const file = join(dir, "index.json");
  if (!existsSync(file)) return [];
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(raw)) return { message: "素材清单损坏，这次没有保存。" };
    return raw as CaptureRecord[];
  } catch {
    return { message: "素材清单读不出，这次没有保存。" };
  }
}

function safeLabel(label: string | undefined, fallback: string): string {
  const cleaned = String(label || fallback)
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "-")
    .slice(0, 40);
  return cleaned || fallback;
}

function commitCapture(input: {
  configDir: string;
  kind: CaptureKind;
  label?: string;
  bytes: Buffer;
  ext: string;
  src?: string;
  url: string;
  title: string;
  libraryCapBytes?: number;
}): SaveCaptureResult {
  const cap = input.libraryCapBytes ?? CAPTURE_LIBRARY_MAX_BYTES;
  const dir = capturesDir(input.configDir);
  mkdirSync(dir, { recursive: true });
  const used = libraryBytes(dir);
  if (used > cap || used + input.bytes.length > cap) {
    return { ok: false, message: LIBRARY_CAPTURE_FULL };
  }
  const index = readIndex(dir);
  if (!Array.isArray(index)) return { ok: false, message: index.message };

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const label = safeLabel(input.label, input.kind === "shot" ? "shot" : "image");
  let file = join(dir, `${label}-${stamp}.${input.ext}`);
  let n = 2;
  while (existsSync(file)) {
    file = join(dir, `${label}-${stamp}-${n}.${input.ext}`);
    n += 1;
  }
  const record: CaptureRecord = {
    file,
    kind: input.kind,
    ...(input.src ? { src: input.src } : {}),
    url: input.url,
    title: input.title,
    time: new Date().toISOString(),
  };
  writeFileSync(file, input.bytes);
  index.push(record);
  writeFileSync(join(dir, "index.json"), JSON.stringify(index, null, 2), "utf8");
  return {
    ok: true,
    file,
    url: input.url,
    title: input.title,
    ...(input.src ? { src: input.src } : {}),
  };
}

export function saveShotBytes(input: {
  configDir: string;
  label?: string;
  bytes: Buffer;
  ext: "png" | "jpg";
  url: string;
  title: string;
  libraryCapBytes?: number;
}): SaveCaptureResult {
  return commitCapture({ ...input, kind: "shot" });
}

export function saveImageBytes(input: {
  configDir: string;
  contentType: string;
  bytes: Buffer;
  label?: string;
  src?: string;
  url: string;
  title: string;
  libraryCapBytes?: number;
}): SaveCaptureResult {
  const ext = imageExt(input.contentType);
  if (!ext) {
    const shown = input.contentType.split(";")[0].trim() || "无类型";
    return { ok: false, message: `不是图片（${shown}），没有保存。` };
  }
  if (input.bytes.length > CAPTURE_IMAGE_MAX_BYTES) {
    return { ok: false, message: "这张图超过 10MB，没有保存。" };
  }
  return commitCapture({
    configDir: input.configDir,
    kind: "image",
    label: input.label,
    bytes: input.bytes,
    ext,
    src: input.src,
    url: input.url,
    title: input.title,
    libraryCapBytes: input.libraryCapBytes,
  });
}

export function listCaptures(configDir: string, limit = 20): CaptureRecord[] {
  const index = readIndex(capturesDir(configDir));
  if (!Array.isArray(index)) return [];
  const recent = index.slice(-Math.max(0, limit));
  return recent.reverse();
}

/** 在页面里 fetch，带上该页 cookie 和 referer。不读取、不回传 cookie 本身。 */
export function fetchImagePageScript(): string {
  return `async (input) => {
    let src = String((input && input.src) || "").trim();
    const selector = String((input && input.selector) || "").trim();
    if (selector) {
      const el = document.querySelector(selector);
      if (!el) return { ok: false, message: "找不到元素：" + selector };
      const img = el.tagName === "IMG" ? el : el.querySelector("img");
      if (!img) return { ok: false, message: "这个元素不是图片：" + selector };
      src = img.currentSrc || img.src || "";
    }
    if (!src) return { ok: false, message: "没有图片地址。" };
    let res;
    try {
      res = await fetch(src, { credentials: "include" });
    } catch (error) {
      const detail = error && error.message ? error.message : String(error);
      return { ok: false, message: "页面里取不到这张图：" + detail };
    }
    const contentType = String(res.headers.get("content-type") || "").split(";")[0].trim();
    if (!contentType.toLowerCase().startsWith("image/")) {
      return { ok: false, message: "不是图片（" + (contentType || "无类型") + "），没有保存。", contentType };
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > ${CAPTURE_IMAGE_MAX_BYTES}) {
      return { ok: false, message: "这张图超过 10MB，没有保存。", byteLength: buf.byteLength };
    }
    const bytes = new Uint8Array(buf);
    let binary = "";
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
    }
    return { ok: true, contentType, byteLength: buf.byteLength, base64: btoa(binary), src };
  }`;
}
