/**
 * 识图：检测视觉模型、附图降级、侧栏/MCP 图片清洗。
 */
export type ScreenshotOpts = {
  label?: string;
  selector?: string;
  clip?: { x: number; y: number; width: number; height: number };
  fullPage?: boolean;
  format?: "png" | "jpeg";
  quality?: number;
  includeBase64?: boolean;
};

export type ImagePart = {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string; detail?: "low" | "high" | "auto" };
};

const VISION_MARKERS = [
  "gpt-4o",
  "gpt-4.1",
  "gpt-4-vision",
  "gpt-4-turbo",
  "claude-3",
  "claude-3.5",
  "claude-3.7",
  "claude-4",
  "gemini-1.5",
  "gemini-2",
  "gemini-pro-vision",
  "qwen-vl",
  "qwen2-vl",
  "qwen2.5-vl",
  "deepseek-vl",
  "glm-4v",
  "llm-vision",
];

export const VISION_FALLBACK_HINT =
  "[附图已省略。当前模型不支持识图，建议换成 GPT-4o / Claude 3.5 / Gemini 1.5 / Qwen-VL]";

export function isVisionModel(model: string): boolean {
  const m = String(model || "").toLowerCase();
  if (!m) return false;
  return VISION_MARKERS.some((x) => m.includes(x));
}

export function wantsPageShot(text: string): boolean {
  const t = String(text || "").trim();
  return /截个图|截图看看|页面长什么样|这一页长什么样|看看现在页面|看一下这页|页面长啥样/.test(t);
}

export function sanitizeImageDataUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const s = String(item || "").trim();
    if (!/^data:image\/(png|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i.test(s)) continue;
    if (s.length > 3_500_000) continue;
    out.push(s.replace(/\s+/g, ""));
    if (out.length >= 3) break;
  }
  return out;
}

/** 空缓冲或过小的 PNG/JPEG 不能当截图成功。 */
export function isUsableCaptureBuffer(buf?: Buffer | null): boolean {
  return Boolean(buf && buf.length >= 32);
}

export function parseScreenshotInput(input?: string | ScreenshotOpts): ScreenshotOpts {
  if (typeof input === "string") return { label: input };
  return { ...(input || {}) };
}

export function validClip(
  clip?: ScreenshotOpts["clip"],
): { x: number; y: number; width: number; height: number } | null {
  if (!clip) return null;
  const x = Number(clip.x);
  const y = Number(clip.y);
  const width = Number(clip.width);
  const height = Number(clip.height);
  if (![x, y, width, height].every((n) => Number.isFinite(n))) return null;
  if (width < 2 || height < 2) return null;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

export function buildUserContent(text: string, images: string[]): string | ImagePart[] {
  const body = String(text || "").trim() || "请看附图，用中文说明。";
  if (!images.length) return body;
  return [
    { type: "text", text: body },
    ...images.map((url) => ({
      type: "image_url" as const,
      image_url: { url, detail: "auto" as const },
    })),
  ];
}

export function flattenVisionContent(content: unknown, vision: boolean): string | ImagePart[] {
  if (!Array.isArray(content)) return typeof content === "string" ? content : "";
  if (vision) return content as ImagePart[];
  const texts = (content as ImagePart[])
    .map((c) => (c?.type === "text" ? c.text : VISION_FALLBACK_HINT))
    .filter(Boolean);
  return texts.join("\n") || VISION_FALLBACK_HINT;
}
