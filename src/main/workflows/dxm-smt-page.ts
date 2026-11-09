/** 只读页面识别。决策点 #35、#36、#37。 */
import type { DxmListingWorkOrder } from "./dxm-smt-contract.js";
import type { ShopBaseline } from "./dxm-smt-shops.js";

export type PageKind =
  | "crawl_list"
  | "crawl_edit"
  | "smt_box"
  | "smt_edit"
  | "submit_record"
  | "failure_record"
  | "online_list"
  | "login"
  | "captcha"
  | "forbidden"
  | "not_loaded"
  | "unknown"
  | "not_dianxiaomi";

export type PageBlocker = "not_loaded" | "login" | "captcha" | "forbidden" | "entry_changed" | "fields_missing";

export type PageProbe = {
  url: string;
  title: string;
  text: string;
  loaded: boolean;
  productIds: string[];
  shops: Array<{ id: string; name: string }>;
  recordId?: string;
  /** 采集编辑 URL 上的 id。诊断用，不覆盖 data-record-id。 */
  urlId?: string;
  draftId?: string;
  /** 当前草稿绑定的店铺。店铺列表不能代替这个读回。 */
  draftShopId?: string;
  platformProductId?: string;
  missingFields: string[];
  online: Array<{ productId: string; shopId: string; url: string }>;
  receiptText?: string;
};

export type PageClassification = {
  kind: PageKind;
  blocker?: PageBlocker;
  reason: string;
};

export type IdentityRequest = {
  sourceRecordId?: string;
  shopId?: string;
  shopName?: string;
  useCurrentEditPage?: boolean;
};

export type IdentityResolution =
  | { ok: true; recordId?: string; shopId?: string; shopName?: string; draftId?: string; note?: string }
  | { ok: false; reason: string };

export const PROBE_SCRIPT = `(() => {
  const text = ((document.body && document.body.innerText) || "").slice(0, 4000);
  const read = (name) => {
    const node = document.querySelector("[data-" + name + "]");
    return node ? node.getAttribute("data-" + name) || "" : "";
  };
  const markedProducts = [...document.querySelectorAll("[data-product-id]")].map((node) => node.getAttribute("data-product-id") || "").filter(Boolean);
  const path = location.pathname || "";
  const urlId = /\\/web\\/productCrawl\\/edit/i.test(path) ? (new URLSearchParams(location.search || "").get("id") || "") : "";
  const markedRecord = read("record-id");
  const recordId = markedRecord || urlId;
  const products = markedProducts.length ? markedProducts : (recordId ? [recordId] : []);
  const shops = [...document.querySelectorAll("[data-shop-id]")].map((node) => ({
    id: node.getAttribute("data-shop-id") || "",
    name: node.getAttribute("data-shop-name") || "",
  })).filter((shop) => shop.id);
  const online = [...document.querySelectorAll("[data-online-product-id]")].map((node) => ({
    productId: node.getAttribute("data-online-product-id") || "",
    shopId: node.getAttribute("data-online-shop-id") || "",
    url: node.getAttribute("data-online-url") || "",
  }));
  return {
    href: location.href,
    title: document.title,
    text,
    loaded: document.readyState !== "loading",
    products,
    shops,
    recordId,
    urlId,
    draftId: read("draft-id"),
    draftShopId: read("draft-shop-id"),
    platformProductId: read("platform-product-id"),
    missing: read("missing"),
    online,
  };
})()`;

export function probeFromHtml(html: string, url: string): PageProbe {
  const title = matchOne(html, /<title>([^<]*)<\/title>/i);
  const loadedAttr = matchOne(html, /data-loaded="([^"]*)"/i);
  const productIds = matchAll(html, /data-product-id="([^"]+)"/gi);
  const markedRecord = matchOne(html, /data-record-id="([^"]*)"/i);
  const urlId = crawlEditUrlId(url);
  const recordId = markedRecord || urlId;
  const shops = [...html.matchAll(/data-shop-id="([^"]+)"[^>]*data-shop-name="([^"]*)"/gi)].map((item) => ({
    id: item[1] || "",
    name: item[2] || "",
  }));
  const online = [...html.matchAll(/data-online-product-id="([^"]+)"[^>]*data-online-shop-id="([^"]*)"[^>]*data-online-url="([^"]*)"/gi)].map((item) => ({
    productId: item[1] || "",
    shopId: item[2] || "",
    url: item[3] || "",
  }));
  const missing = matchOne(html, /data-missing="([^"]*)"/i);
  const ids = productIds.length ? productIds : recordId ? [recordId] : [];
  return {
    url,
    title,
    text: html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
    loaded: loadedAttr !== "false" && html.trim().length > 0,
    productIds: ids,
    shops: dedupeShops(shops),
    recordId: recordId || undefined,
    urlId: urlId || undefined,
    draftId: matchOne(html, /data-draft-id="([^"]*)"/i) || undefined,
    draftShopId: matchOne(html, /data-draft-shop-id="([^"]*)"/i) || undefined,
    platformProductId: matchOne(html, /data-platform-product-id="([^"]*)"/i) || undefined,
    missingFields: missing ? missing.split("|").filter(Boolean) : [],
    online,
  };
}

export function classifyPage(probe: PageProbe): PageClassification {
  if (!probe.loaded) return { kind: "not_loaded", blocker: "not_loaded", reason: "页面尚未加载" };
  const host = hostname(probe.url);
  if (!host.endsWith("dianxiaomi.com")) {
    return { kind: "not_dianxiaomi", reason: "不是店小秘页面，不进入速卖通 QA" };
  }
  if (/验证码|人机验证|滑动验证/.test(probe.text)) {
    return { kind: "captcha", blocker: "captcha", reason: "出现验证码，停等用户处理" };
  }
  if (/\/login/i.test(probe.url) || /登录已失效|请登录|扫码登录/.test(probe.text)) {
    return { kind: "login", blocker: "login", reason: "登录失效，停等用户处理" };
  }
  if (/无权限|没有权限|权限不足/.test(probe.text)) {
    return { kind: "forbidden", blocker: "forbidden", reason: "没有店铺或商品权限" };
  }
  const url = probe.url || "";
  let kind: PageKind = "unknown";
  if (/\/web\/productCrawl\/dataAcquisition/i.test(url)) kind = "crawl_list";
  // 采集编辑必须是路径加 id。保存并认领按钮不能单独把别的页面判成编辑页。
  else if (/\/web\/productCrawl\/edit/i.test(url) && crawlEditUrlId(url)) kind = "crawl_edit";
  else if (/\/web\/smt\/edit/i.test(url)) kind = "smt_edit";
  else if (/\/web\/smt\/(draft|crawl|collect)/i.test(url)) kind = "smt_box";
  else if (/publishFail|失败记录/i.test(url)) kind = "failure_record";
  else if (/publishRecord|提交记录/i.test(url)) kind = "submit_record";
  else if (/\/web\/smt\/online|在线产品/i.test(url)) kind = "online_list";
  if (kind === "unknown") {
    return { kind, blocker: "entry_changed", reason: "页面入口对不上，已停等" };
  }
  if (kind === "smt_edit" && probe.missingFields.length) {
    return { kind, blocker: "fields_missing", reason: `速卖通编辑页缺少字段：${probe.missingFields.join("、")}` };
  }
  return { kind, reason: pageReason(kind) };
}

export function entersSmtQa(page: PageClassification): boolean {
  return page.kind === "smt_edit" || page.kind === "smt_box";
}

export function resolveIdentity(
  probe: PageProbe,
  request: IdentityRequest = {},
  baseline?: ShopBaseline | null,
): IdentityResolution {
  const pageShops = dedupeShops(probe.shops);
  const cached = (baseline?.shops || []).filter((shop) => shop.shopId && shop.name);
  const usingCache = pageShops.length === 0 && cached.length > 0;
  const shops = pageShops.length ? pageShops : cached.map((shop) => ({ id: shop.shopId, name: shop.name }));
  let shopId = request.shopId;
  let shopName = request.shopName;
  let note: string | undefined;
  if (!shopId && shopName) {
    const named = shops.filter((shop) => shop.name === shopName);
    if (named.length !== 1) {
      return {
        ok: false,
        reason: named.length > 1
          ? "店铺名称不唯一，已停等，不会默认第一条"
          : "指定店铺没有精确匹配，已停等，不会默认唯一店",
      };
    }
    shopId = named[0]?.id;
    shopName = named[0]?.name || shopName;
  }
  if (!shopId) {
    if (usingCache && shops.length > 1) {
      return { ok: false, reason: `店铺基线有多家店铺，请指定目标店铺：${shops.map((shop) => shop.name).join("、")}` };
    }
    if (shops.length > 1) return { ok: false, reason: "店铺不唯一，已停等，不会默认第一条" };
    if (shops.length === 1) {
      shopId = shops[0]?.id;
      shopName = shopName || shops[0]?.name;
      if (usingCache) note = "店铺基线只有一家，已默认绑定";
    } else return { ok: false, reason: missingShopReason(probe) };
  } else if (!shopName) {
    shopName = shops.find((shop) => shop.id === shopId)?.name;
  }

  const products = probe.productIds.filter(Boolean);
  let recordId = request.sourceRecordId || probe.recordId;
  if (!request.sourceRecordId && products.length > 1) {
    return { ok: false, reason: "商品不唯一，已停等，不会默认第一条" };
  }
  if (request.sourceRecordId && products.length && !products.includes(request.sourceRecordId) && probe.recordId !== request.sourceRecordId) {
    return { ok: false, reason: "指定商品不在当前页面，已停等" };
  }
  if (!recordId && products.length === 1) recordId = products[0];
  return { ok: true, recordId, shopId, shopName, draftId: probe.draftId, note };
}

/** 编辑标签关闭或地址变了就停。不刷新、不重开。决策点 #37。 */
export function editTabWritable(
  order: DxmListingWorkOrder,
  tabs: Array<{ id: string; url: string; closed?: boolean }>,
): { ok: true } | { ok: false; reason: string } {
  const editId = order.tabs.editTabId;
  if (!editId) return { ok: true };
  const tab = tabs.find((item) => item.id === editId);
  if (!tab || tab.closed) {
    return { ok: false, reason: "编辑标签已关闭，已停止写操作，不会刷新找回草稿" };
  }
  if (order.claimedDraftId && !tab.url.includes(order.claimedDraftId)) {
    return { ok: false, reason: "编辑标签地址已变，已停止写操作，不会刷新找回草稿" };
  }
  return { ok: true };
}

/** 发布只能发生在工作单绑定的那张编辑标签，并且来源、草稿、店铺和 URL 都对得上。空身份不算匹配。 */
export function publishIdentityMatches(
  order: DxmListingWorkOrder,
  executingTabId: string,
  tabs: Array<{ id: string; url: string; closed?: boolean }>,
  probe: { draftId?: string; recordId?: string; draftShopId?: string; url?: string; shops: Array<{ id: string; name: string }> },
): { ok: true } | { ok: false; reason: string } {
  const editId = order.tabs.editTabId || "";
  const draftId = order.claimedDraftId || "";
  const recordId = order.source.crawlRecordId || "";
  const shopId = order.target.shopId || "";
  if (!editId || !draftId || !recordId || !shopId) {
    return { ok: false, reason: "工作单的标签、草稿、来源或店铺不完整，已停等" };
  }
  if (!executingTabId || executingTabId !== editId) {
    return { ok: false, reason: "当前执行标签不是工作单的编辑标签，已停等，不会在新标签继续" };
  }
  const writable = editTabWritable(order, tabs);
  if (!writable.ok) return writable;
  if (!probe.draftId || probe.draftId !== draftId) {
    return { ok: false, reason: "读回草稿和认领草稿不一致，已停等" };
  }
  if (!probe.recordId || probe.recordId !== recordId) {
    return { ok: false, reason: "读回来源记录和本工作单不一致，已停等" };
  }
  if (!probe.draftShopId || probe.draftShopId !== shopId) {
    return { ok: false, reason: "当前草稿店铺和目标店铺不一致，已停等" };
  }
  if (probe.url && !probe.url.includes(draftId)) {
    return { ok: false, reason: "当前编辑地址和认领草稿不一致，已停等" };
  }
  return { ok: true };
}

function pageReason(kind: PageKind): string {
  switch (kind) {
    case "crawl_list":
      return "当前是通用采集列表";
    case "crawl_edit":
      return "当前是通用采集编辑页";
    case "smt_box":
      return "当前是速卖通采集箱";
    case "smt_edit":
      return "当前是速卖通编辑页";
    case "submit_record":
      return "当前是提交记录";
    case "failure_record":
      return "当前是发布失败记录";
    case "online_list":
      return "当前是在线商品列表";
    default:
      return "已识别页面";
  }
}

/** 采集编辑页的来源号只认路径 `/web/productCrawl/edit` 上的 id。别的页面即使带 id 也不拿来当来源。 */
export function crawlEditUrlId(url: string): string {
  try {
    const parsed = new URL(url);
    if (!/\/web\/productCrawl\/edit/i.test(parsed.pathname)) return "";
    return parsed.searchParams.get("id") || "";
  } catch {
    return "";
  }
}

function missingShopReason(probe: PageProbe): string {
  if (/\/web\/productCrawl\/edit/i.test(probe.url || "")) {
    return "页面读不到店铺，店铺基线未就绪（先跑 dxm_smt_shops）";
  }
  return "没有目标店铺，已停等";
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function matchOne(html: string, pattern: RegExp): string {
  const found = html.match(pattern);
  return found?.[1]?.trim() || "";
}

function matchAll(html: string, pattern: RegExp): string[] {
  return [...html.matchAll(pattern)].map((item) => item[1] || "").filter(Boolean);
}

function dedupeShops(shops: Array<{ id: string; name: string }>): Array<{ id: string; name: string }> {
  const seen = new Map<string, { id: string; name: string }>();
  for (const shop of shops) {
    if (!shop.id || seen.has(shop.id)) continue;
    seen.set(shop.id, shop);
  }
  return [...seen.values()];
}
