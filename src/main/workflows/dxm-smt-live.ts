/** 浏览器适配器。认领、写字段、翻译、保存、发布继续停等。标题和变种区只读。 */
import {
  CLICK_CLAIM_CONFIRM_SCRIPT,
  CLICK_SAVE_AND_CLAIM_SCRIPT,
  READ_CLAIM_DIALOG_SCRIPT,
  READ_CLAIM_PROOF_SCRIPT,
  claimDialogIssue,
  claimSelectorsReady,
  clickClaimShopScript,
  extraCheckedIssue,
  pickClaimShop,
  type ClaimDialogRead,
} from "./dxm-smt-claim.js";
import { parsePriceCell, type FieldSnapshot, type SkuRow } from "./dxm-smt-fields.js";
import type { DxmSmtPort } from "./dxm-smt-listing.js";
import { PROBE_SCRIPT, crawlEditUrlId, type PageProbe } from "./dxm-smt-page.js";
import { READ_SHOPS_SCRIPT, SMT_AUTH_URL, assessShopRows, type RawShopRow, type ShopRead } from "./dxm-smt-shops.js";
import {
  BOX_POLL_BUDGET_MS,
  READ_BOX_SCRIPT,
  SMT_BOX_URL,
  advanceBoxWindow,
  boxPollExhausted,
  boxSearchScript,
  decideBoxLookup,
  type BoxListRead,
  type BoxRow,
  type BoxWindow,
} from "./dxm-smt-box.js";
import type { DraftLookup } from "./dxm-smt-listing.js";
import { BOX_API_PAGE_SIZE, boxApiScript, collectBoxApiVerdict, type BoxApiQuery } from "./dxm-smt-api.js";

const SKU_HEAD = ["颜色", "尺寸", "SKU", "货源价格(CNY)", "折扣价", "价格(USD)", "促销价", "库存", "包裹尺寸", "包裹重量"];

/** 只读标题输入和变种信息网格。不点保存、保存并认领、一键翻译。描述 iframe 本轮不进。 */
export const READ_FIELDS_SCRIPT = `(() => {
  const titleInput = document.querySelector('input[placeholder="请填写标题"]');
  const title = titleInput ? (titleInput.value || "") : "";
  const label = [...document.querySelectorAll("div")].find((el) => el.childElementCount === 0 && (el.textContent || "").trim() === "变种信息");
  const grid = label ? label.nextElementSibling : null;
  const rows = grid
    ? [...grid.children].map((row) => [...row.querySelectorAll(".cell")].map((cell) => (cell.textContent || "").trim()))
    : [];
  return { title, rows, hasVariant: Boolean(label), descriptionNote: "iframe 待基线" };
})()`;

type ExecuteResult = { ok: boolean; data?: { result?: unknown } };

export type DxmSmtLiveSurface = {
  tabId: string;
  signal?: AbortSignal;
  isPaused: () => boolean;
  journalDir: string;
  execute: (script: string, tabId?: string) => Promise<ExecuteResult>;
  getUrl: (tabId?: string) => string;
  listTabs: () => Array<{ id: string; url: string }>;
  /** 当前标签不是采集编辑页时，才允许在这个标签上打开授权页。 */
  navigate?: (url: string, tabId: string) => Promise<{ ok: boolean; message?: string }>;
  /** 当前标签是采集编辑页时，必须走这里，读完再关掉。 */
  openTab?: (url: string) => Promise<string>;
  closeTab?: (tabId: string) => Promise<void> | void;
  /** 只改活动标签和布局，不抢窗口焦点，不闪任务栏。 */
  activateTab?: (tabId: string) => void;
  getActiveTabId?: () => string | undefined;
  /** 标签还在不在。没提供时不把测试桩误判成已关闭。 */
  hasTab?: (tabId: string) => boolean;
};

export function createLiveDxmSmtPort(surface: DxmSmtLiveSurface): DxmSmtPort {
  return {
    tabId: surface.tabId,
    signal: surface.signal,
    isPaused: surface.isPaused,
    journalDir: surface.journalDir,
    readProbe: async (tabId) => readProbe(surface, tabId),
    listTabs: async () => surface.listTabs(),
    claim: async (input) => claimDraft(surface, input),
    readFields: async (tabId) => readFields(surface, tabId),
    writeField: async () => ({ ok: false, readback: "" }),
    translateText: async () => ({ ok: false, verified: false }),
    translateImages: async () => ({ ok: false, verified: false }),
    dismissPopups: async (_tabId, imageBusy) => ({ cancelled: !imageBusy && false }),
    saveDraft: async () => ({ ok: false, message: "保存入口没有已核对标记，已停等" }),
    clickPublish: async () => ({ ok: false, message: "发布入口没有已核对标记，已停等，不会点击" }),
    queryStatus: async () => ({}),
    selectCategory: async () => ({ ok: false, message: "分类控件没有已核对标记，已停等" }),
    lookupDraft: (input) => lookupDraft(surface, input),
    readShops: () => readShops(surface),
  };
}

async function readProbe(surface: DxmSmtLiveSurface, tabId: string): Promise<PageProbe> {
  const empty = blankProbe(surface.getUrl(tabId));
  try {
    const result = await surface.execute(PROBE_SCRIPT, tabId);
    const raw = result.data?.result;
    if (!raw || typeof raw !== "object") return { ...empty, loaded: false };
    const row = raw as Record<string, unknown>;
    const shops = Array.isArray(row.shops)
      ? row.shops.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const shop = item as { id?: string; name?: string };
          return shop.id ? [{ id: String(shop.id), name: String(shop.name || "") }] : [];
        })
      : [];
    const urlId = text(row.urlId);
    const recordId = text(row.recordId) || urlId;
    const productIds = Array.isArray(row.products) ? row.products.map((item) => String(item)).filter(Boolean) : [];
    return {
      url: String(row.href || empty.url),
      title: String(row.title || ""),
      text: String(row.text || ""),
      loaded: row.loaded !== false,
      productIds: productIds.length ? productIds : recordId ? [recordId] : [],
      shops,
      recordId,
      urlId,
      draftId: text(row.draftId),
      draftShopId: text(row.draftShopId),
      platformProductId: text(row.platformProductId),
      missingFields: (text(row.missing) || "").split("|").filter(Boolean),
      online: [],
    };
  } catch {
    return { ...empty, loaded: false };
  }
}

type SourcedLookup = DraftLookup & { source: "api" | "dom" };

function apiFetcher(surface: DxmSmtLiveSurface, tabId: string) {
  return async (query: BoxApiQuery) => {
    const out = await surface.execute(boxApiScript(query), tabId);
    return out.data?.result;
  };
}

function onDianxiaomi(url: string): boolean {
  try {
    return new URL(url).hostname === "www.dianxiaomi.com";
  } catch {
    return false;
  }
}

async function lookupViaApi(
  surface: DxmSmtLiveSurface,
  input: { recordId?: string; shopId?: string; tabId: string; title?: string },
  title: string,
  home: string,
  note: { reason: string },
): Promise<SourcedLookup | undefined> {
  if (!title) return undefined;
  const tabId = input.tabId || home;
  if (!onDianxiaomi(surface.getUrl(tabId))) return undefined;
  try {
    const verdict = await collectBoxApiVerdict(
      { title, pageSize: BOX_API_PAGE_SIZE },
      apiFetcher(surface, tabId),
    );
    if (verdict.status === "absent" || verdict.status === "ambiguous") return { ...verdict, source: "api" };
    note.reason = verdict.reason || "采集箱接口没有判出来，无法判重";
    return undefined;
  } catch {
    note.reason = "采集箱接口没有返回 200，无法判重";
    return undefined;
  }
}

async function lookupViaDom(
  surface: DxmSmtLiveSurface,
  input: { recordId?: string; shopId?: string; tabId: string; title?: string },
  title: string,
): Promise<DraftLookup> {
  const home = input.tabId || surface.tabId;
  const editing = Boolean(crawlEditUrlId(surface.getUrl(home)));
  let tabId = home;
  let opened = "";
  if (editing) {
    if (!surface.openTab) return { status: "unknown", reason: "编辑页不会被导航，缺少新标签入口" };
    opened = await surface.openTab(SMT_BOX_URL);
    if (!opened || opened === home) return { status: "unknown", reason: "新标签没有打开，编辑页不会被导航" };
    tabId = opened;
  } else if (surface.navigate) {
    const nav = await surface.navigate(SMT_BOX_URL, home);
    if (!nav.ok) return { status: "unknown", reason: nav.message || "采集箱没有打开，无法判重" };
  } else {
    return { status: "unknown", reason: "没有打开采集箱的入口，无法判重" };
  }
  let prevActive = "";
  try {
    if (opened && surface.activateTab) {
      prevActive = surface.getActiveTabId?.() || "";
      surface.activateTab(opened);
    }
    if (opened && surface.hasTab && !surface.hasTab(opened)) {
      return { status: "unknown", reason: "采集箱列表没有加载出来，无法判重" };
    }
    const first = await pollBox(surface, tabId);
    if (!first.settled) return first.gaveUp;
    if (!first.read.loaded || (!first.read.rows.length && !first.read.emptyRendered)) {
      return { status: "unknown", reason: "采集箱列表没有加载出来，无法判重" };
    }
    if (!first.read.rows.length) return { status: "absent" };
    if (!title) return { status: "unknown", reason: "编辑页读不到标题，无法判重" };
    return await searchBox(surface, tabId, title);
  } catch {
    return { status: "unknown", reason: "采集箱列表没有加载出来，无法判重" };
  } finally {
    if (opened) {
      try {
        await surface.closeTab?.(opened);
      } catch {
        /* 采集箱标签已经不在 */
      }
      if (prevActive && (!surface.hasTab || surface.hasTab(prevActive))) {
        try {
          surface.activateTab?.(prevActive);
        } catch {
          /* 原标签已经不在 */
        }
      }
    }
  }
}

async function lookupDraft(
  surface: DxmSmtLiveSurface,
  input: { recordId?: string; shopId?: string; tabId: string; title?: string },
): Promise<DraftLookup> {
  if (surface.isPaused()) return { status: "unknown", reason: "任务已暂停，无法判重" };
  if (!input.recordId || !input.shopId) return { status: "unknown", reason: "来源或店铺不完整，无法判重" };
  const title = (input.title || "").trim();
  const home = input.tabId || surface.tabId;
  const apiNote = { reason: "" };
  const viaApi = await lookupViaApi(surface, input, title, home, apiNote);
  if (viaApi) return viaApi as DraftLookup;
  const viaDom = await lookupViaDom(surface, input, title);
  if (apiNote.reason && viaDom.status === "unknown") {
    const reason = `接口：${apiNote.reason}；页面：${viaDom.reason || ""}`;
    return { status: "unknown", reason: reason.length <= 200 ? reason : reason.slice(0, 200), source: "dom" } as DraftLookup;
  }
  return { ...viaDom, source: "dom" } as DraftLookup;
}

async function claimDraft(
  surface: DxmSmtLiveSurface,
  input: { recordId?: string; shopId?: string; shopName?: string; tabId: string },
): Promise<{
  ok: boolean;
  draftId?: string;
  shopId?: string;
  shopName?: string;
  recordId?: string;
  message: string;
  blocker?: "auth" | "entry" | "timeout" | "not_found";
}> {
  if (!claimSelectorsReady()) return refused("认领入口没有已核对标记，已停等");
  const tabId = input.tabId || surface.tabId;
  if (!crawlEditUrlId(surface.getUrl(tabId))) {
    return { ok: false, blocker: "entry", message: "当前页不是采集编辑页，已停等，没有点保存并认领" };
  }
  if (surface.isPaused()) return { ok: false, blocker: "entry", message: "认领前已暂停，已停等" };
  try {
    console.info("[dxm-smt] claim click 保存并认领");
    const opened = await surface.execute(CLICK_SAVE_AND_CLAIM_SCRIPT, tabId);
    const openResult = opened.data?.result as { clicked?: boolean } | undefined;
    if (!openResult?.clicked) {
      return { ok: false, blocker: "entry", message: "当前页没有找到保存并认领按钮，已停等" };
    }
    const dialog = await pollClaimDialog(surface, tabId);
    if (!dialog?.opened) return { ok: false, blocker: "entry", message: "点保存并认领后没有出现认领弹窗，已停等" };
    const issue = claimDialogIssue(dialog);
    if (issue) return { ok: false, blocker: "entry", message: issue };
    const picked = pickClaimShop(dialog.options, { shopId: input.shopId, shopName: input.shopName });
    if (!picked.ok) return { ok: false, blocker: "entry", message: picked.reason };
    const extra = extraCheckedIssue(dialog.options, picked.shop);
    if (extra) return { ok: false, blocker: "entry", message: extra };
    if (!picked.shop.selected) {
      const shopClick = await surface.execute(clickClaimShopScript(picked.shop.name), tabId);
      const shopResult = shopClick.data?.result as { clicked?: boolean; already?: boolean } | undefined;
      if (!shopResult?.clicked && !shopResult?.already) {
        return { ok: false, blocker: "entry", message: "认领弹窗没有点到目标店铺，已停等" };
      }
    }
    console.info("[dxm-smt] claim click 确定");
    const confirmed = await surface.execute(CLICK_CLAIM_CONFIRM_SCRIPT, tabId);
    const confirmResult = confirmed.data?.result as { clicked?: boolean } | undefined;
    if (!confirmResult?.clicked) return { ok: false, blocker: "entry", message: "认领弹窗找不到确定按钮，已停等" };
    const proof = await pollClaimProof(surface, tabId);
    if (proof?.dialogOpen && proof.error) return { ok: false, blocker: "entry", message: proof.error };
    if (!proof?.draftId || !proof.shopId || !proof.recordId) {
      const message = proof?.dialogOpen
        ? "点确定后认领弹窗没有结束，已停等"
        : proof?.draftId
          ? "认领后读回不到草稿，不得进入编辑完成"
          : "认领已提交，但没有进入草稿编辑页，已停等";
      return { ok: false, blocker: "timeout", message };
    }
    return {
      ok: true,
      draftId: proof.draftId,
      shopId: proof.shopId,
      shopName: input.shopName || picked.shop.name,
      recordId: proof.recordId,
      message: "已认领",
    };
  } catch {
    return { ok: false, blocker: "entry", message: "认领中断，已停等，没有重试" };
  }
}

async function pollClaimDialog(surface: DxmSmtLiveSurface, tabId: string): Promise<ClaimDialogRead | undefined> {
  const deadline = Date.now() + 10_000;
  let last: ClaimDialogRead | undefined;
  while (Date.now() <= deadline) {
    if (surface.signal?.aborted) return last;
    if (surface.hasTab && !surface.hasTab(tabId)) return last;
    try {
      const result = await surface.execute(READ_CLAIM_DIALOG_SCRIPT, tabId);
      last = mapClaimDialog(result.data?.result);
      if (last.opened) return last;
    } catch {
      last = undefined;
    }
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return last;
}

function mapClaimDialog(value: unknown): ClaimDialogRead {
  const empty: ClaimDialogRead = {
    opened: false,
    title: "",
    options: [],
    selected: "",
    confirmPresent: false,
    confirmText: "",
    cancelText: "",
    error: "",
  };
  if (!value || typeof value !== "object") return empty;
  const raw = value as Partial<ClaimDialogRead> & { options?: unknown };
  const options = Array.isArray(raw.options)
    ? raw.options.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as { name?: unknown; shopId?: unknown; selected?: unknown };
        const name = typeof row.name === "string" ? row.name.trim() : "";
        if (!name) return [];
        return [{ name, shopId: typeof row.shopId === "string" ? row.shopId : "", selected: row.selected === true }];
      })
    : [];
  return {
    opened: raw.opened === true,
    title: typeof raw.title === "string" ? raw.title : "",
    options,
    selected: typeof raw.selected === "string" ? raw.selected : "",
    confirmPresent: raw.confirmPresent === true,
    confirmText: typeof raw.confirmText === "string" ? raw.confirmText : "",
    cancelText: typeof raw.cancelText === "string" ? raw.cancelText : "",
    error: typeof raw.error === "string" ? raw.error : "",
  };
}

async function pollClaimProof(
  surface: DxmSmtLiveSurface,
  tabId: string,
): Promise<{ dialogOpen: boolean; error: string; draftId: string; shopId: string; recordId: string } | undefined> {
  const deadline = Date.now() + 10_000;
  let last: { dialogOpen: boolean; error: string; draftId: string; shopId: string; recordId: string } | undefined;
  while (Date.now() <= deadline) {
    if (surface.signal?.aborted) return last;
    if (surface.hasTab && !surface.hasTab(tabId)) return last;
    try {
      const result = await surface.execute(READ_CLAIM_PROOF_SCRIPT, tabId);
      last = mapClaimProof(result.data?.result);
      if (last.dialogOpen && last.error) return last;
      if (last.draftId && last.shopId && last.recordId && !last.dialogOpen) return last;
    } catch {
      last = undefined;
    }
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return last;
}

function mapClaimProof(value: unknown): { dialogOpen: boolean; error: string; draftId: string; shopId: string; recordId: string } {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    dialogOpen: raw.dialogOpen === true,
    error: typeof raw.error === "string" ? raw.error : "",
    draftId: typeof raw.draftId === "string" ? raw.draftId : "",
    shopId: typeof raw.shopId === "string" ? raw.shopId : "",
    recordId: typeof raw.recordId === "string" ? raw.recordId : "",
  };
}

async function searchBox(surface: DxmSmtLiveSurface, tabId: string, title: string): Promise<DraftLookup> {
  if (surface.navigate) {
    const nav = await surface.navigate(`${SMT_BOX_URL}?title=${encodeURIComponent(title)}`, tabId);
    if (nav.ok) {
      const viaUrl = await pollBox(surface, tabId);
      if (
        viaUrl.settled
        && viaUrl.read.loaded
        && viaUrl.read.searchValue.trim() === title
        && (viaUrl.read.rows.length > 0 || viaUrl.read.emptyRendered)
      ) {
        return decideBoxLookup({ loaded: true, rows: viaUrl.read.rows, title });
      }
    }
  }
  const searched = await surface.execute(boxSearchScript(title), tabId);
  const outcome = searchOutcome(searched.data?.result);
  if (outcome.filled === false || outcome.clicked === false) {
    return { status: "unknown", reason: "采集箱搜索框或搜索按钮对不上，已停等，没有改别的输入框" };
  }
  const viaClick = await pollBox(surface, tabId);
  if (!viaClick.settled) return viaClick.gaveUp;
  if (!viaClick.read.loaded || (!viaClick.read.rows.length && !viaClick.read.emptyRendered)) {
    return { status: "unknown", reason: "采集箱搜索没有加载出来，无法判重" };
  }
  return decideBoxLookup({ loaded: true, rows: viaClick.read.rows, title });
}

export type BoxPollResult = {
  settled: boolean;
  read: BoxListRead;
  gaveUp: DraftLookup;
};

const EMPTY_BOX: BoxListRead = { loaded: false, emptyRendered: false, rows: [], searchValue: "" };

/** 三次一致的 loaded 样本才返回。预算用尽时不把未稳定的表体当成 absent。 */
export async function pollBox(surface: DxmSmtLiveSurface, tabId: string): Promise<BoxPollResult> {
  const deadline = Date.now() + BOX_POLL_BUDGET_MS;
    let last = EMPTY_BOX;
    let window: BoxWindow = { streak: 0, sawLoaded: false };
    while (Date.now() <= deadline) {
      if (surface.signal?.aborted) return unfinished(window, last);
      if (surface.hasTab && !surface.hasTab(tabId)) return unfinished(window, last);
      try {
        const result = await surface.execute(READ_BOX_SCRIPT, tabId);
        last = mapBox(result.data?.result);
      } catch {
        last = EMPTY_BOX;
      }
      const step = advanceBoxWindow(window, last);
      window = step.window;
      if (step.stable) return { settled: true, read: last, gaveUp: boxPollExhausted(["ready"]) };
      if (surface.hasTab && !surface.hasTab(tabId)) return unfinished(window, last);
      if (Date.now() >= deadline || Date.now() + step.waitMs > deadline) break;
      await new Promise((resolve) => setTimeout(resolve, step.waitMs));
  }
  return unfinished(window, last);
}

function unfinished(window: BoxWindow, read: BoxListRead): BoxPollResult {
  return {
    settled: false,
    read,
    gaveUp: boxPollExhausted(window.sawLoaded ? ["ready"] : ["loading"]),
  };
}

function mapBox(value: unknown): BoxListRead {
  if (!value || typeof value !== "object") return { loaded: false, emptyRendered: false, rows: [], searchValue: "" };
  const raw = value as { loaded?: unknown; emptyRendered?: unknown; rows?: unknown; searchValue?: unknown };
  const rows = Array.isArray(raw.rows) ? raw.rows.flatMap((item) => boxRow(item)) : [];
  const emptyRendered = raw.emptyRendered === true && rows.length === 0;
  return {
    loaded: raw.loaded === true || emptyRendered,
    emptyRendered,
    rows,
    searchValue: typeof raw.searchValue === "string" ? raw.searchValue : "",
  };
}

function searchOutcome(value: unknown): { filled?: boolean; clicked?: boolean } {
  if (!value || typeof value !== "object") return {};
  const raw = value as { filled?: unknown; clicked?: unknown };
  return {
    filled: typeof raw.filled === "boolean" ? raw.filled : undefined,
    clicked: typeof raw.clicked === "boolean" ? raw.clicked : undefined,
  };
}

function boxRow(value: unknown): BoxRow[] {
  if (!value || typeof value !== "object") return [];
  const row = value as Partial<BoxRow>;
  const title = typeof row.title === "string" ? row.title.trim() : "";
  if (!title) return [];
  return [{ title, productId: typeof row.productId === "string" ? row.productId.trim() : "" }];
}

async function readShops(surface: DxmSmtLiveSurface): Promise<ShopRead> {
  if (surface.isPaused()) return { shops: [], badRows: 0, reason: "任务已暂停，没有读取店铺" };
  const home = surface.tabId;
  const editing = Boolean(crawlEditUrlId(surface.getUrl(home)));
  let tabId = home;
  let opened = "";
  if (editing) {
    if (!surface.openTab) return { shops: [], badRows: 0, reason: "编辑页不会被导航，缺少新标签入口" };
    opened = await surface.openTab(SMT_AUTH_URL);
    if (!opened || opened === home) return { shops: [], badRows: 0, reason: "新标签没有打开，编辑页不会被导航" };
    tabId = opened;
  } else if (surface.navigate) {
    const nav = await surface.navigate(SMT_AUTH_URL, home);
    if (!nav.ok) return { shops: [], badRows: 0, reason: nav.message || "授权页没有打开" };
  } else {
    return { shops: [], badRows: 0, reason: "没有打开授权页的入口" };
  }
  try {
    return await pollShopTable(surface, tabId);
  } finally {
    if (opened) await surface.closeTab?.(opened);
  }
}

async function pollShopTable(surface: DxmSmtLiveSurface, tabId: string): Promise<ShopRead> {
  const deadline = Date.now() + 10_000;
  let last: ShopRead = { shops: [], badRows: 0, reason: "授权页未加载出店铺表格" };
  while (Date.now() <= deadline) {
    if (surface.signal?.aborted) return { shops: [], badRows: 0, reason: "读取店铺已取消" };
    try {
      const result = await surface.execute(READ_SHOPS_SCRIPT, tabId);
      const raw = result.data?.result;
      const row = raw && typeof raw === "object" ? raw as { tableFound?: unknown; rows?: unknown } : {};
      const rows = Array.isArray(row.rows) ? row.rows.flatMap((item) => rawShopRow(item)) : [];
      last = assessShopRows(rows, row.tableFound === true);
      if (row.tableFound === true) return last;
    } catch {
      last = { shops: [], badRows: 0, reason: "授权页未加载出店铺表格" };
    }
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return last;
}

function rawShopRow(value: unknown): RawShopRow[] {
  if (!value || typeof value !== "object") return [];
  const row = value as Partial<RawShopRow>;
  return [{
    rowid: typeof row.rowid === "string" ? row.rowid : "",
    name: typeof row.name === "string" ? row.name : "",
    aliId: typeof row.aliId === "string" ? row.aliId : "",
    third: typeof row.third === "string" ? row.third : "",
    authTime: typeof row.authTime === "string" ? row.authTime : "",
  }];
}

async function readFields(surface: DxmSmtLiveSurface, tabId: string): Promise<FieldSnapshot> {
  try {
    const result = await surface.execute(READ_FIELDS_SCRIPT, tabId);
    const raw = result.data?.result;
    if (!raw || typeof raw !== "object") return fieldsFromRows("", [], false);
    const row = raw as { title?: unknown; rows?: unknown; hasVariant?: unknown };
    const rows = Array.isArray(row.rows)
      ? row.rows.flatMap((item) => (Array.isArray(item) ? [item.map((cell) => String(cell ?? ""))] : []))
      : [];
    const title = typeof row.title === "string" ? row.title : "";
    return fieldsFromRows(title, rows, row.hasVariant === true);
  } catch {
    return fieldsFromRows("", [], false);
  }
}

/** 测试和离线夹具走这里。列头对不上或没有行时返回空 SKU，并写明原因。 */
export function readFieldsFromHtml(html: string): FieldSnapshot {
  const titleTag = html.match(/<input\b[^>]*placeholder="请填写标题"[^>]*>/i);
  const title = titleTag ? inputValue(titleTag[0]) : "";
  const hasVariant = />\s*变种信息\s*</.test(html);
  const rows = [...html.matchAll(/<div class="sku-row">([\s\S]*?)<\/div>/gi)].map((row) =>
    [...String(row[1] || "").matchAll(/<span class="cell">([^<]*)<\/span>/gi)].map((cell) => decodeBasic(cell[1] || "")),
  );
  return fieldsFromRows(title, rows, hasVariant);
}

export function fieldsFromRows(title: string, rows: string[][], hasVariant: boolean): FieldSnapshot {
  const blank = (skuReadReason: string): FieldSnapshot => ({
    title: title || undefined,
    fields: [],
    skus: [],
    images: { main: [], variant: [], description: [] },
    descriptionNote: "iframe 待基线",
    skuReadReason,
  });
  if (!hasVariant || rows.length === 0) return blank("读不到变种信息，不猜");
  const head = rows[0] || [];
  if (SKU_HEAD.some((name, index) => head[index] !== name)) return blank("变种信息列头对不上，不猜");
  const body = rows.slice(1);
  if (!body.length) return blank("变种信息读不到行，不猜");
  const skus: SkuRow[] = body.map((cells) => ({
    specs: { 颜色: cells[0] || "", 尺寸: cells[1] || "" },
    price: parsePriceCell(cells[5] || ""),
    rawPrice: (cells[5] || "").trim(),
    stock: parsePriceCell(cells[7] || ""),
  }));
  return {
    title: title || undefined,
    fields: [],
    skus,
    images: { main: [], variant: [], description: [] },
    descriptionNote: "iframe 待基线",
  };
}

function blankProbe(url: string): PageProbe {
  return {
    url,
    title: "",
    text: "",
    loaded: false,
    productIds: [],
    shops: [],
    missingFields: [],
    online: [],
  };
}

function refused(message: string): { ok: false; message: string; blocker: "entry" } {
  return { ok: false, message, blocker: "entry" };
}

function text(value: unknown): string | undefined {
  const next = typeof value === "string" ? value.trim() : "";
  return next || undefined;
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
