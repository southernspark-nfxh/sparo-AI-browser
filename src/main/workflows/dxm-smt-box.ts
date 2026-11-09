/** 速卖通采集箱只读判重。只打开列表、读行、填搜索框和点搜索。不点行内操作。 */
import type { DraftLookup } from "./dxm-smt-listing.js";

export const SMT_BOX_URL = "https://www.dianxiaomi.com/web/smt/smtProductList/draft";

/** 判重轮询总预算。采样间隔仍是 400ms，两次一致后再隔 800ms 做确认读。 */
export const BOX_POLL_BUDGET_MS = 30_000;
export const BOX_POLL_INTERVAL_MS = 400;
export const BOX_SETTLE_CONFIRM_MS = 800;

export type BoxRow = {
  title: string;
  productId: string;
};

export type BoxListRead = {
  loaded: boolean;
  /** 行数为 0，且真空结构已渲染。空表节点常驻，不能单用它。 */
  emptyRendered: boolean;
  rows: BoxRow[];
  searchValue: string;
};

/** 只读 vxe 表体。行数决定有没有数据；「暂无数据」和空表节点都不单独当加载完成。 */
export const READ_BOX_SCRIPT = `(() => {
  const newline = String.fromCharCode(10);
  const rowNodes = [...document.querySelectorAll("tr.vxe-body--row")];
  const rows = rowNodes.map((row) => {
    const cells = [...row.querySelectorAll("td")];
    const titleCell = cells[2];
    const lines = titleCell ? (titleCell.innerText || "").split(newline).map((line) => line.trim()).filter(Boolean) : [];
    const title = lines.find((line) => !(line.charAt(0) === "「" && line.charAt(line.length - 1) === "」")) || "";
    const idMatch = (row.innerText || "").match(/\\d{7,}/);
    return { title, productId: idMatch ? idMatch[0] : "" };
  }).filter((row) => row.title);
  const vacuumNode = document.querySelector(".vxe-table--empty-content .empty-container");
  let vacuum = false;
  if (vacuumNode && rows.length === 0) {
    const style = window.getComputedStyle(vacuumNode);
    vacuum = style.display !== "none" && style.visibility !== "hidden";
  }
  const search = [...document.querySelectorAll("input.ant-input")].find((el) => !el.closest("tr") && !el.closest(".vxe-table") && !el.closest(".vxe-grid"));
  return {
    marker: "sparo-box-list",
    loaded: rows.length > 0 || vacuum,
    emptyRendered: vacuum,
    rows,
    searchValue: search ? (search.value || "") : "",
  };
})()`;

/** 只填表格外第一个搜索框，并点第一个「搜索」。缺一就不填、不点。 */
export function boxSearchScript(title: string): string {
  return `(() => {
    const title = ${JSON.stringify(title)};
    const inputs = [...document.querySelectorAll("input.ant-input")].filter((el) => !el.closest("tr") && !el.closest(".vxe-table") && !el.closest(".vxe-grid"));
    const input = inputs[0];
    const buttons = [...document.querySelectorAll("button")].filter((el) => (el.innerText || "").trim() === "搜索" && !el.closest("tr"));
    const button = buttons[0];
    if (!input || !button) return { marker: "sparo-box-search", filled: false, clicked: false };
    const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
    if (proto && proto.set) proto.set.call(input, title);
    else input.value = title;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    button.click();
    return { marker: "sparo-box-search", filled: true, clicked: true };
  })()`;
}

function htmlText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ");
}

function titleFromCell(html: string): string {
  const lines = htmlText(html).split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.find((line) => !(line.startsWith("「") && line.endsWith("」"))) || "";
}

export function boxListFromHtml(html: string): BoxListRead {
  const rows = [...html.matchAll(/<tr\b[^>]*class="[^"]*vxe-body--row[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap((match) => {
    const row = match[1] || "";
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1] || "");
    const title = titleFromCell(cells[2] || "");
    const productId = htmlText(row).match(/\d{7,}/)?.[0] || "";
    if (!title) return [];
    return [{ title, productId }];
  });
  const emptyRendered = rows.length === 0 && /class="[^"]*empty-container[^"]*"/.test(html);
  const searchValue = /<input\b[^>]*class="[^"]*ant-input[^"]*"[^>]*value="([^"]*)"/i.exec(html)?.[1] || "";
  return {
    loaded: rows.length > 0 || emptyRendered,
    emptyRendered,
    rows,
    searchValue,
  };
}

/**
 * 有行就是加载完成。没行时，只有真空结构算完成。
 * `.vxe-table--empty-block` 常驻，不算。全文「暂无数据」也不算。
 */
export function assessBoxLoad(input: { rowCount: number; emptyRendered: boolean }): "ready" | "loading" {
  if (input.rowCount > 0 || input.emptyRendered) return "ready";
  return "loading";
}

/** 轮询样本里没有一次加载完成，就停等，不把占位态判成没有草稿。 */
export function boxPollExhausted(samples: Array<"ready" | "loading">): DraftLookup {
  if (samples.some((sample) => sample === "ready")) {
    return { status: "unknown", reason: "采集箱还有一次读到了表体，不能把整段轮询当成没加载" };
  }
  return { status: "unknown", reason: "采集箱列表没有加载出来，无法判重" };
}

export function lookupFromLoad(input: { rowCount: number; emptyRendered: boolean; rows: BoxRow[]; title?: string }): DraftLookup {
  if (assessBoxLoad(input) !== "ready") {
    return { status: "unknown", reason: "采集箱列表没有加载出来，无法判重" };
  }
  return decideBoxLookup({ loaded: true, rows: input.rows, title: input.title });
}

/** 搜索框或按钮对不上就两个都不要做，不换别的框。 */
export function boxSearchAttempt(found: { input: boolean; button: boolean }): { filled: boolean; clicked: boolean } {
  if (!found.input || !found.button) return { filled: false, clicked: false };
  return { filled: true, clicked: true };
}

/** 稳定窗只比这四项。行数相同即可，不比标题正文。 */
export function sameBoxRead(a: BoxListRead, b: BoxListRead): boolean {
  return a.loaded === b.loaded
    && a.rows.length === b.rows.length
    && a.emptyRendered === b.emptyRendered
    && a.searchValue === b.searchValue;
}

export type BoxWindow = {
  previous?: BoxListRead;
  streak: number;
  sawLoaded: boolean;
};

/** 连续两次全等后，下一次等待改为确认间隔。只有 loaded 的第三次一致才采纳。 */
export function advanceBoxWindow(
  window: BoxWindow,
  sample: BoxListRead,
): { window: BoxWindow; stable: boolean; waitMs: number } {
  const sawLoaded = window.sawLoaded || sample.loaded;
  const streak = window.previous && sameBoxRead(window.previous, sample) ? window.streak + 1 : 1;
  const stable = sample.loaded && streak >= 3;
  const waitMs = !stable && sample.loaded && streak === 2 ? BOX_SETTLE_CONFIRM_MS : BOX_POLL_INTERVAL_MS;
  return { window: { previous: sample, streak, sawLoaded }, stable, waitMs };
}

/** 标题只能当线索。对上一条或多条都停等人看，第一版不产生 found。 */
export function decideBoxLookup(input: { loaded: boolean; rows: BoxRow[]; title?: string }): DraftLookup {
  if (!input.loaded) return { status: "unknown", reason: "采集箱列表没有加载出来，无法判重" };
  if (!input.rows.length) return { status: "absent" };
  const title = (input.title || "").trim();
  if (!title) return { status: "unknown", reason: "编辑页读不到标题，无法判重" };
  const matched = input.rows.filter((row) => row.title.trim() === title);
  if (!matched.length) return { status: "absent" };
  return {
    status: "ambiguous",
    reason: `标题精确匹配 ${matched.length} 条（未按店铺过滤），请人工确认是否同源草稿`,
  };
}
