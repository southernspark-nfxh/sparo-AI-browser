/** 采集箱列表接口契约。只解析和判定，不接 lookupDraft。字段路径按附录 C（2026-11-10）。 */
import { decideBoxLookup, type BoxRow } from "./dxm-smt-box.js";
import type { DraftLookup } from "./dxm-smt-listing.js";

/** 附录 C：同源相对路径。空字符串时脚本不发请求。 */
export const BOX_API_ENDPOINT = "/api/smtProduct/pageList.json";
export const BOX_API_BUDGET_MS = 20_000;
export const BOX_API_PAGE_SIZE = 100;

export type BoxApiQuery = {
  title?: string;
  shopId?: string;
  page?: number;
  pageSize?: number;
  draftsOnly?: boolean;
};

export type BoxApiPage = {
  total: number;
  rows: BoxRow[];
  echoTitle: string;
  httpOk: boolean;
  shapeOk: boolean;
  timedOut?: boolean;
};

const BLANK_PAGE: BoxApiPage = {
  total: 0,
  rows: [],
  echoTitle: "",
  httpOk: false,
  shapeOk: false,
};

/** 附录 C 表单。searchType 只用 0。searchValue 先 trim，服务端不 trim。 */
export function buildBoxListBody(query: BoxApiQuery): string {
  const params = new URLSearchParams();
  params.set("pageNo", String(query.page ?? 1));
  params.set("pageSize", String(query.pageSize ?? BOX_API_PAGE_SIZE));
  params.set("total", "0");
  params.set("searchType", "0");
  params.set("searchValue", (query.title ?? "").trim());
  params.set("shopId", (query.shopId ?? "").trim() || "-1");
  params.set("dxmState", "draft");
  params.set("dxmOfflineState", "");
  return params.toString();
}

/**
 * 页面上下文里只取 status / ok / json。
 * 空端点直接失败。单页 8 秒超时，中止或网络失败都不猜结果。
 */
export function boxApiScript(query: BoxApiQuery): string {
  const request = {
    endpoint: BOX_API_ENDPOINT,
    body: buildBoxListBody(query),
  };
  return `(() => {
  const request = ${JSON.stringify(request)};
  const failed = { status: 0, ok: false, json: null };
  if (!request.endpoint) return failed;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  return fetch(request.endpoint, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: request.body,
    signal: controller.signal
  }).then((response) => {
    return response.json().then((json) => ({ status: response.status, ok: response.ok, json })).catch(() => ({ status: response.status, ok: false, json: null }));
  }).catch(() => failed).finally(() => clearTimeout(timer));
})()`;
}

/** 只认附录 C：code、data.page.totalSize、data.page.list[].subject、data.productParam.searchValue。 */
export function parseBoxApiPage(raw: unknown): BoxApiPage {
  try {
    if (!raw || typeof raw !== "object") return { ...BLANK_PAGE };
    const envelope = raw as { status?: unknown; ok?: unknown; json?: unknown };
    const httpOk = envelope.ok === true && envelope.status === 200;
    const body = envelope.json;
    if (!body || typeof body !== "object" || Array.isArray(body)) return { ...BLANK_PAGE, httpOk };
    const record = body as { code?: unknown; data?: unknown };
    if (record.code !== 0) return { ...BLANK_PAGE, httpOk };
    const data = record.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return { ...BLANK_PAGE, httpOk };
    const dataRecord = data as { page?: unknown; productParam?: unknown };
    const page = dataRecord.page;
    if (!page || typeof page !== "object" || Array.isArray(page)) return { ...BLANK_PAGE, httpOk };
    const pageRecord = page as { totalSize?: unknown; list?: unknown };
    const total = pageRecord.totalSize;
    if (typeof total !== "number" || !Number.isInteger(total) || total < 0) return { ...BLANK_PAGE, httpOk };
    if (!Array.isArray(pageRecord.list)) return { ...BLANK_PAGE, httpOk };
    if (pageRecord.list.length > total) return { ...BLANK_PAGE, httpOk };
    const rows: BoxRow[] = [];
    for (const item of pageRecord.list) {
      if (!item || typeof item !== "object") return { ...BLANK_PAGE, httpOk };
      const row = item as { subject?: unknown; productId?: unknown };
      if (typeof row.subject !== "string" || row.subject.trim() === "") return { ...BLANK_PAGE, httpOk };
      rows.push({ title: row.subject, productId: typeof row.productId === "string" ? row.productId : "" });
    }
    const param = dataRecord.productParam;
    const searchValue = param && typeof param === "object" && !Array.isArray(param)
      ? (param as { searchValue?: unknown }).searchValue
      : undefined;
    return {
      total,
      rows,
      echoTitle: typeof searchValue === "string" ? searchValue : "",
      httpOk,
      shapeOk: true,
    };
  } catch {
    return { ...BLANK_PAGE };
  }
}

export function boxApiPageCount(total: number, pageSize = BOX_API_PAGE_SIZE): number {
  if (!Number.isInteger(total) || total <= 0) return 1;
  const size = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : BOX_API_PAGE_SIZE;
  return Math.ceil(total / size);
}

function unknown(reason: string): DraftLookup {
  return { status: "unknown", reason };
}

/** 回显查询词，或本页 total 小于已知全量，才算服务端认了标题参数。 */
export function boxApiFilterProven(page: BoxApiPage, title: string, catalogTotal?: number): boolean {
  const wanted = title.trim();
  if (!wanted) return true;
  if (page.echoTitle.trim() === wanted) return true;
  return typeof catalogTotal === "number" && Number.isFinite(catalogTotal) && page.total < catalogTotal;
}

/** 翻完的页才能交给 decideBoxLookup。覆盖不够、过滤没证明、HTTP 或结构失败都停 unknown。 */
export function boxApiVerdict(
  pages: BoxApiPage[],
  query: BoxApiQuery = {},
  options: { catalogTotal?: number; fullScan?: boolean } = {},
): DraftLookup {
  if (!pages.length) return unknown("采集箱接口没有返回页面，无法判重");
  for (const page of pages) {
    if (!page.httpOk) return unknown("采集箱接口没有返回 200，无法判重");
    if (!page.shapeOk) return unknown("采集箱接口结构对不上，无法判重");
  }
  const total = pages[0]?.total ?? 0;
  if (pages.some((page) => page.total !== total)) return unknown("采集箱接口页码对不上，无法判重");
  const rows = pages.flatMap((page) => page.rows);
  if (rows.length < total) return unknown("采集箱接口没有翻完，无法判重");
  const title = (query.title || "").trim();
  const first = pages[0];
  if (title && !options.fullScan && first && !boxApiFilterProven(first, title, options.catalogTotal)) {
    return unknown("标题过滤没有回显，不能据此判重");
  }
  return decideBoxLookup({ loaded: true, rows, title: query.title });
}

async function loadPage(
  query: BoxApiQuery,
  fetchPage: (query: BoxApiQuery) => Promise<unknown>,
  deadline: number,
): Promise<BoxApiPage> {
  if (Date.now() > deadline) return { ...BLANK_PAGE, timedOut: true };
  try {
    return parseBoxApiPage(await fetchPage(query));
  } catch {
    return { ...BLANK_PAGE };
  }
}

function pageFailure(page: BoxApiPage, turned: boolean): DraftLookup {
  if (page.timedOut) return unknown("采集箱接口预算内没读完，无法判重");
  if (!page.httpOk) return unknown(turned ? "采集箱接口翻页中断，无法判重" : "采集箱接口没有返回 200，无法判重");
  return unknown(turned ? "采集箱接口翻页中断，无法判重" : "采集箱接口结构对不上，无法判重");
}

/** 离线翻页。过滤没被证明时改读全量，再做标题精确比对。不访问真实接口。 */
export async function collectBoxApiVerdict(
  query: BoxApiQuery,
  fetchPage: (query: BoxApiQuery) => Promise<unknown>,
): Promise<DraftLookup> {
  const pageSize = query.pageSize && query.pageSize > 0 ? query.pageSize : BOX_API_PAGE_SIZE;
  const deadline = Date.now() + BOX_API_BUDGET_MS;
  const title = (query.title || "").trim();
  const first = await loadPage({ ...query, page: 1, pageSize }, fetchPage, deadline);
  if (!first.httpOk || !first.shapeOk) return pageFailure(first, false);
  if (title && !boxApiFilterProven(first, title)) {
    const scanned = await readPages({ ...query, title: "" }, fetchPage, pageSize, deadline);
    if (!scanned.ok) return scanned.lookup;
    return boxApiVerdict(scanned.pages, query, { fullScan: true });
  }
  const covered = await readPages({ ...query, pageSize }, fetchPage, pageSize, deadline, first);
  if (!covered.ok) return covered.lookup;
  return boxApiVerdict(covered.pages, query);
}

async function readPages(
  query: BoxApiQuery,
  fetchPage: (query: BoxApiQuery) => Promise<unknown>,
  pageSize: number,
  deadline: number,
  first?: BoxApiPage,
): Promise<{ ok: true; pages: BoxApiPage[] } | { ok: false; lookup: DraftLookup }> {
  const pages: BoxApiPage[] = [];
  const opening = first ?? await loadPage({ ...query, page: 1, pageSize }, fetchPage, deadline);
  if (!opening.httpOk || !opening.shapeOk) return { ok: false, lookup: pageFailure(opening, Boolean(first)) };
  pages.push(opening);
  const needed = boxApiPageCount(opening.total, pageSize);
  for (let page = 2; page <= needed; page += 1) {
    const next = await loadPage({ ...query, page, pageSize }, fetchPage, deadline);
    if (!next.httpOk || !next.shapeOk) return { ok: false, lookup: pageFailure(next, true) };
    if (next.total !== opening.total) return { ok: false, lookup: unknown("采集箱接口页码对不上，无法判重") };
    pages.push(next);
  }
  const read = pages.reduce((sum, page) => sum + page.rows.length, 0);
  if (read < opening.total) return { ok: false, lookup: unknown("采集箱接口没有翻完，无法判重") };
  return { ok: true, pages };
}
