/** 速卖通店铺授权页只读。不点击重新授权、修改、更多。 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const DXM_SMT_SHOPS_FILE = "dxm-smt-shops.json";
export const SMT_AUTH_URL = "https://www.dianxiaomi.com/web/system/authorization/platform";

export type ShopInfo = {
  shopId: string;
  name: string;
  aliId: string;
  currency: string;
  semiAuth: string;
  authTime: string;
};

export type ShopBaseline = {
  fetchedAt: string;
  shops: ShopInfo[];
};

export type ShopRead = {
  shops: ShopInfo[];
  badRows: number;
  reason?: string;
};

export type RawShopRow = {
  rowid: string;
  name: string;
  aliId: string;
  third: string;
  authTime: string;
};

/** 只读授权页表格。列位置按第 1 到第 4 个单元格，不靠 colid。 */
export const READ_SHOPS_SCRIPT = `(() => {
  const table = document.querySelector(".vxe-table--body-wrapper table.vxe-table--body");
  const rowNodes = table ? [...table.querySelectorAll("tbody tr.vxe-body--row")] : [];
  const rows = rowNodes.map((row) => {
    const cells = [...row.children].filter((el) => el.tagName === "TD");
    const nameNode = cells[0] && cells[0].querySelector(".vxe-cell > div");
    const aliNode = cells[1] && cells[1].querySelector("span.vxe-cell--label");
    const timeNode = cells[3] && cells[3].querySelector("span.vxe-cell--label");
    const third = cells[2] ? (cells[2].innerText || "") : "";
    return {
      rowid: row.getAttribute("rowid") || "",
      name: nameNode ? (nameNode.textContent || "").trim() : "",
      aliId: aliNode ? (aliNode.textContent || "").trim() : "",
      third: third.replace(/\\s+/g, " ").trim(),
      authTime: timeNode ? (timeNode.textContent || "").trim() : "",
    };
  });
  return { tableFound: Boolean(table), rows };
})()`;

export function parseShopTable(html: string): ShopRead {
  const tableFound = /class="[^"]*vxe-table--body[^"]*"/.test(html) || /vxe-body--row/.test(html);
  if (!tableFound) return { shops: [], badRows: 0, reason: "授权页未加载出店铺表格" };
  const rows = [...html.matchAll(/<tr\b[^>]*class="[^"]*vxe-body--row[^"]*"[^>]*>[\s\S]*?<\/tr>/gi)].map((match) =>
    rawFromRow(match[0] || ""),
  );
  return assessShopRows(rows, true);
}

export function assessShopRows(rows: RawShopRow[], tableFound: boolean): ShopRead {
  if (!tableFound) return { shops: [], badRows: 0, reason: "授权页未加载出店铺表格" };
  if (!rows.length) return { shops: [], badRows: 0, reason: "已授权店铺为 0" };
  const shops: ShopInfo[] = [];
  let badRows = 0;
  for (const row of rows) {
    const shopId = row.rowid.trim();
    const name = row.name.trim();
    const aliId = row.aliId.trim();
    if (!shopId || !name || !/^cn\d+/.test(aliId)) {
      badRows += 1;
      continue;
    }
    const plain = row.third.replace(/\s+/g, " ").trim();
    shops.push({
      shopId,
      name,
      aliId,
      currency: /店铺币种\s*[:：]\s*([A-Za-z]{3})/.exec(plain)?.[1] || "",
      semiAuth: /半\/全托管\s*[:：]\s*(\S+)/.exec(plain)?.[1] || "",
      authTime: row.authTime.trim(),
    });
  }
  if (!shops.length) return { shops: [], badRows, reason: "店铺行全部作废" };
  return { shops, badRows };
}

export function saveShopBaseline(dir: string, shops: ShopInfo[], now = new Date()): ShopBaseline {
  const baseline: ShopBaseline = { fetchedAt: now.toISOString(), shops };
  writeFileSync(shopsFile(dir), `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  return baseline;
}

export function loadShopBaseline(dir: string): ShopBaseline | null {
  const path = shopsFile(dir);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { fetchedAt?: unknown; shops?: unknown };
    if (!parsed || !Array.isArray(parsed.shops)) return null;
    const shops = parsed.shops.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Partial<ShopInfo>;
      if (!row.shopId || !row.name) return [];
      return [{
        shopId: String(row.shopId),
        name: String(row.name),
        aliId: String(row.aliId || ""),
        currency: String(row.currency || ""),
        semiAuth: String(row.semiAuth || ""),
        authTime: String(row.authTime || ""),
      }];
    });
    return { fetchedAt: typeof parsed.fetchedAt === "string" ? parsed.fetchedAt : "", shops };
  } catch {
    return null;
  }
}

function shopsFile(dir: string): string {
  return join(dir, DXM_SMT_SHOPS_FILE);
}

function rawFromRow(rowHtml: string): RawShopRow {
  const open = rowHtml.match(/^<tr\b[^>]*>/i)?.[0] || "";
  const rowid = /(?:^|\s)rowid="([^"]*)"/i.exec(open)?.[1] || "";
  const cells = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((item) => item[1] || "");
  return {
    rowid,
    name: cellDiv(cells[0] || ""),
    aliId: cellLabel(cells[1] || ""),
    third: (cells[2] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    authTime: cellLabel(cells[3] || ""),
  };
}

function cellDiv(html: string): string {
  return decodeBasic(/<div class="vxe-cell">\s*<div>([^<]*)<\/div>/i.exec(html)?.[1] || "");
}

function cellLabel(html: string): string {
  return decodeBasic(/<span class="vxe-cell--label">([^<]*)<\/span>/i.exec(html)?.[1] || "");
}

function decodeBasic(value: string): string {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}
