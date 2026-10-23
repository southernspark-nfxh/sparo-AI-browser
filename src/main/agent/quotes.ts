/**
 * 侧栏引用块：划词 / 拖拽 / 笔记摘录。
 * 本地只做条数与长度校验，不判断用户想干什么。
 */

export const QUOTE_TEXT_LIMIT = 4000;
export const QUOTE_COUNT_LIMIT = 5;

export type SparoQuote = {
  text: string;
  url?: string;
  title?: string;
  siteName?: string;
  kind: "page" | "note";
  noteId?: string;
};

function cleanField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 最多 5 条，单条正文截到 4000 字。非法项丢掉。 */
export function normalizeQuotes(raw: unknown): SparoQuote[] {
  const list = Array.isArray(raw) ? raw : [];
  const quotes: SparoQuote[] = [];
  for (const item of list) {
    if (quotes.length >= QUOTE_COUNT_LIMIT) break;
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    let text = String(rec.text || "").replace(/\u0000/g, "").trim();
    if (!text) continue;
    if (text.length > QUOTE_TEXT_LIMIT) text = text.slice(0, QUOTE_TEXT_LIMIT);
    const url = cleanField(rec.url);
    const title = cleanField(rec.title);
    const siteName = cleanField(rec.siteName);
    const noteId = cleanField(rec.noteId);
    quotes.push({
      text,
      kind: rec.kind === "note" ? "note" : "page",
      ...(url ? { url } : {}),
      ...(title ? { title } : {}),
      ...(siteName ? { siteName } : {}),
      ...(noteId ? { noteId } : {}),
    });
  }
  return quotes;
}

function quoteBlockHead(quote: SparoQuote, index: number): string {
  if (quote.kind === "note") {
    const title = (quote.title || "笔记").trim() || "笔记";
    return `[笔记：${title}]`;
  }
  return `[引用 ${index + 1}]（来源：${sourceLabel(quote)}）`;
}

/** 带 noteId 的笔记引用换成全文（截到 4000）。没有 noteId 或读不到则保持摘录。 */
export function fillNoteQuote(
  quote: SparoQuote,
  loaded: { title?: string; markdown?: string } | null,
): SparoQuote {
  if (quote.kind !== "note" || !quote.noteId) return quote;
  if (!loaded) return quote;
  const title = String(loaded.title || quote.title || "笔记").trim() || "笔记";
  const body = String(loaded.markdown || "");
  const text = (body || quote.text || "").slice(0, QUOTE_TEXT_LIMIT);
  return { ...quote, title, text };
}

function sourceLabel(quote: SparoQuote): string {
  const title = (quote.title || quote.siteName || "").trim();
  const url = (quote.url || "").trim();
  return [title, url].filter(Boolean).join(" ") || "手动摘录";
}

/** 有引用时放在引用块之前。不解析用户原句。 */
export const QUOTE_PAGE_CONTRACT =
  "这一问只解释本条引用。作者、身份、风格只能源自本条引用的正文和来源标题。聊天里更早的帖子、昵称、职业不得写进回答。";

/**
 * 引用在前、用户指令在后。没有引用时原句原样返回。
 * 格式：
 * 契约
 * [引用 1]（来源：标题 URL）
 * ……
 * [用户指令] 原句
 */
export function composeQuotedPrompt(instruction: string, quotes: unknown): string {
  const clean = normalizeQuotes(quotes);
  const text = String(instruction ?? "");
  if (!clean.length) return text;
  const blocks = clean.map((quote, index) => `${quoteBlockHead(quote, index)}\n${quote.text}`);
  return `${QUOTE_PAGE_CONTRACT}\n\n${blocks.join("\n\n")}\n[用户指令] ${text}`;
}

/** 用户消息进 chatLog：原文不变，引用挂在 quotes 上。 */
export function quotedUserTurn(
  text: string,
  quotes: unknown,
  images?: string[],
): { role: "user"; text: string; images?: string[]; quotes?: SparoQuote[] } {
  const clean = normalizeQuotes(quotes);
  const pics = (images || []).filter((item) => typeof item === "string" && item);
  return {
    role: "user",
    text: text || (pics.length ? "（附图）" : ""),
    ...(pics.length ? { images: pics } : {}),
    ...(clean.length ? { quotes: clean } : {}),
  };
}
