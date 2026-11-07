/** 浏览器适配器。没有已核对标记时只读页面，写操作停等。真实选择器待基线。 */
import type { FieldSnapshot } from "./dxm-smt-fields.js";
import type { DxmSmtPort } from "./dxm-smt-listing.js";
import { PROBE_SCRIPT, type PageProbe } from "./dxm-smt-page.js";

type ExecuteResult = { ok: boolean; data?: { result?: unknown } };

export type DxmSmtLiveSurface = {
  tabId: string;
  signal?: AbortSignal;
  isPaused: () => boolean;
  journalDir: string;
  execute: (script: string, tabId?: string) => Promise<ExecuteResult>;
  getUrl: (tabId?: string) => string;
  listTabs: () => Array<{ id: string; url: string }>;
};

export function createLiveDxmSmtPort(surface: DxmSmtLiveSurface): DxmSmtPort {
  return {
    tabId: surface.tabId,
    signal: surface.signal,
    isPaused: surface.isPaused,
    journalDir: surface.journalDir,
    readProbe: async (tabId) => readProbe(surface, tabId),
    listTabs: async () => surface.listTabs(),
    claim: async () => refused("认领入口没有已核对标记，已停等"),
    readFields: async (tabId) => readFields(surface, tabId),
    writeField: async () => ({ ok: false, readback: "" }),
    translateText: async () => ({ ok: false, verified: false }),
    translateImages: async () => ({ ok: false, verified: false }),
    dismissPopups: async (_tabId, imageBusy) => ({ cancelled: !imageBusy && false }),
    saveDraft: async () => ({ ok: false, message: "保存入口没有已核对标记，已停等" }),
    clickPublish: async () => ({ ok: false, message: "发布入口没有已核对标记，已停等，不会点击" }),
    queryStatus: async () => ({}),
    selectCategory: async () => ({ ok: false, message: "分类控件没有已核对标记，已停等" }),
    lookupDraft: async () => ({ status: "unknown" }),
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
    const productIds = Array.isArray(row.products) ? row.products.map((item) => String(item)).filter(Boolean) : [];
    return {
      url: String(row.href || empty.url),
      title: String(row.title || ""),
      text: String(row.text || ""),
      loaded: row.loaded !== false,
      productIds,
      shops,
      recordId: text(row.recordId),
      draftId: text(row.draftId),
      platformProductId: text(row.platformProductId),
      missingFields: (text(row.missing) || "").split("|").filter(Boolean),
      online: [],
    };
  } catch {
    return { ...empty, loaded: false };
  }
}

async function readFields(surface: DxmSmtLiveSurface, tabId: string): Promise<FieldSnapshot> {
  const probe = await readProbe(surface, tabId);
  return {
    title: probe.title,
    fields: [],
    skus: [],
    images: { main: [], variant: [], description: [] },
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
