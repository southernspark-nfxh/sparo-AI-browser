/** 采集箱编辑页 6 项回读契约。纯函数，页面脚本（技能 JSON）与这里的正则解析保持同一判据。 */

export type CrawlIntent = {
  title?: string;
  weight?: string;
  stock?: string;
  variantCount?: number;
  imgShortSide?: number;
  category?: string;
};

export type CrawlFields = {
  title: string;
  weight: string;
  stocks: Array<string | null>;
  rowCount: number;
  imgShortSide: number | null;
  category: string | null;
};

export type CrawlMismatch = { field: string; expected: string; actual: string };

export function readCrawlFieldsFromHtml(html: string): CrawlFields {
  const titleTag = html.match(/<input\b[^>]*placeholder="请填写标题"[^>]*>/i);
  const title = titleTag ? squash(inputValue(titleTag[0])) : "";

  const weightTag = html.match(/<input\b[^>]*placeholder="请输入重量[^"]*"[^>]*>/i);
  const weight = weightTag ? squash(inputValue(weightTag[0])) : "";

  const rows = [...html.matchAll(/<tr\b[^>]*class="[^"]*skuDataItem_[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi)];
  const stocks = rows.map((row) => {
    const inputs = [...String(row[1] || "").matchAll(/<input\b[^>]*placeholder="请输入"[^>]*>/gi)];
    const stock = inputs[5];
    if (!stock) return null;
    return squash(inputValue(stock[0]));
  });

  const imgTag = html.match(/<span\b[^>]*class="[^"]*\bimg-size\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
  const imgShortSide = imgTag ? shortSideOf(squash(String(imgTag[1] || "").replace(/<[^>]+>/g, " "))) : null;

  return { title, weight, stocks, rowCount: rows.length, imgShortSide, category: readCategory(html) };
}

export function diffCrawlFields(intent: CrawlIntent, actual: CrawlFields): CrawlMismatch[] {
  const out: CrawlMismatch[] = [];

  const wantTitle = squash(intent.title ?? "");
  const haveTitle = squash(actual.title);
  if (wantTitle !== haveTitle) out.push({ field: "标题", expected: wantTitle, actual: haveTitle });

  const wantWeight = squash(intent.weight ?? "");
  if (wantWeight !== "" && !numbersEqual(wantWeight, actual.weight)) {
    out.push({ field: "重量", expected: wantWeight, actual: squash(actual.weight) });
  }

  if (intent.variantCount !== undefined && actual.rowCount !== intent.variantCount) {
    out.push({
      field: "变种行",
      expected: String(intent.variantCount),
      actual: actual.rowCount > 0 ? String(actual.rowCount) : "读不到",
    });
  }

  const wantStock = squash(intent.stock ?? "");
  if (wantStock !== "") {
    actual.stocks.forEach((stock, index) => {
      const field = `变种${index + 1}库存`;
      if (stock === null) {
        out.push({ field, expected: wantStock, actual: "读不到" });
      } else if (!numbersEqual(wantStock, stock)) {
        out.push({ field, expected: wantStock, actual: squash(stock) });
      }
    });
  }

  if (intent.imgShortSide !== undefined) {
    if (actual.imgShortSide === null) {
      out.push({ field: "主图短边", expected: String(intent.imgShortSide), actual: "读不到" });
    } else if (actual.imgShortSide !== intent.imgShortSide) {
      out.push({ field: "主图短边", expected: String(intent.imgShortSide), actual: String(actual.imgShortSide) });
    }
  }

  const wantCategory = squash(intent.category ?? "");
  if (wantCategory !== "") {
    if (actual.category === null) {
      out.push({ field: "分类", expected: wantCategory, actual: "读不到" });
    } else if (squash(actual.category) !== wantCategory) {
      out.push({ field: "分类", expected: wantCategory, actual: squash(actual.category) });
    }
  }

  return out;
}

export function formatCrawlMismatch(mismatches: CrawlMismatch[]): string {
  if (!mismatches.length) return "";
  const parts = mismatches.map((item) => `${item.field}(期望${item.expected}/实际${item.actual})`);
  return `回读不一致：${parts.join("、")}`;
}

/** 分类：标签文本「店小秘分类」之后最近的控件块，按 div 配平取出，避免被嵌套 div 截断。 */
function readCategory(html: string): string | null {
  const anchor = html.indexOf("店小秘分类");
  if (anchor < 0) return null;
  const classAt = html.indexOf("ant-form-item-control", anchor);
  if (classAt < 0) return null;
  const divStart = html.lastIndexOf("<div", classAt);
  if (divStart < 0) return null;
  const block = divBlockAt(html, divStart).replace(/<[^>]+>/g, " ");
  return squash(block) || null;
}

function divBlockAt(html: string, start: number): string {
  const openEnd = html.indexOf(">", start);
  if (openEnd < 0) return "";
  const tagRe = /<div\b|<\/div>/gi;
  tagRe.lastIndex = start;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html))) {
    if (match[0].toLowerCase() === "</div>") {
      depth -= 1;
      if (depth === 0) return html.slice(openEnd + 1, match.index);
    } else {
      depth += 1;
    }
  }
  return html.slice(openEnd + 1);
}

function shortSideOf(text: string): number | null {
  const found = text.match(/(\d+)\s*[xX×]\s*(\d+)/);
  if (!found) return null;
  return Math.min(Number(found[1]), Number(found[2]));
}

function inputValue(tag: string): string {
  const found = tag.match(/\bvalue="([^"]*)"/i);
  return decodeBasic(found?.[1] || "");
}

function decodeBasic(value: string): string {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function squash(value: string): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function numbersEqual(expected: string, actual: string): boolean {
  const left = expected.trim();
  const right = String(actual ?? "").trim();
  if (right === "") return left === "";
  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return left === right;
  return a === b;
}
