import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DxmListingWorkOrder } from "../src/main/workflows/dxm-smt-contract.js";
import { createWorkOrder } from "../src/main/workflows/dxm-smt-contract.js";
import { fingerprintFromSnapshot } from "../src/main/workflows/dxm-smt-fingerprint.js";
import type { FieldSnapshot } from "../src/main/workflows/dxm-smt-fields.js";
import { saveOrder } from "../src/main/workflows/dxm-smt-journal.js";
import type { PageProbe } from "../src/main/workflows/dxm-smt-page.js";
import type { DxmSmtPort } from "../src/main/workflows/dxm-smt-listing.js";

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "dxm-smt-"));
}

export function readySnapshot(): FieldSnapshot {
  return {
    categoryId: "cat-hat",
    title: "Cotton Hat",
    currency: "USD",
    fields: [
      { key: "title", group: "基本信息", required: true, value: "Cotton Hat", verified: true, provenance: "readback" },
      { key: "price", group: "价格库存", required: true, value: "10", verified: true, provenance: "source", business: true },
      { key: "stock", group: "价格库存", required: true, value: "5", verified: true, provenance: "source", business: true },
      { key: "freightTemplate", group: "模板", required: true, value: "默认运费", verified: true, provenance: "source", business: true },
      { key: "brand", group: "合规信息", required: true, value: "Nike", verified: true, provenance: "source", business: true },
    ],
    skus: [{ specs: { 颜色: "红" }, price: "10", stock: "5" }],
    images: {
      main: [{ src: "m1.jpg", status: "verified" }],
      variant: [{ src: "v1.jpg", status: "verified" }],
      description: [{ src: "d1.jpg", status: "verified" }],
    },
    description: "A cotton hat for daily wear",
    freightTemplate: "默认运费",
    brand: "Nike",
    qualification: "已有资质",
    weight: "0.2",
    size: "10 x 20",
  };
}

export function editProbe(): PageProbe {
  return {
    url: "https://www.dianxiaomi.com/web/smt/edit?id=D1",
    title: "速卖通编辑",
    text: "速卖通编辑 Cotton Hat",
    loaded: true,
    productIds: ["R1"],
    shops: [{ id: "S1", name: "店铺甲" }],
    recordId: "R1",
    draftId: "D1",
    draftShopId: "S1",
    missingFields: [],
    online: [],
  };
}

export function readyOrder(snapshot: FieldSnapshot = readySnapshot()): DxmListingWorkOrder {
  const fingerprint = fingerprintFromSnapshot({
    shopId: "S1",
    shopName: "店铺甲",
    title: snapshot.title,
    categoryId: snapshot.categoryId,
    draftId: "D1",
    recordId: "R1",
    pageUrl: "https://www.dianxiaomi.com/web/smt/edit?id=D1",
    snapshot,
  });
  return createWorkOrder({
    id: "wo-1",
    state: "draft_ready",
    source: { crawlRecordId: "R1", productId: "R1", titleSnapshot: snapshot.title },
    target: { platform: "aliexpress", shopId: "S1", shopNameSnapshot: "店铺甲" },
    claimedDraftId: "D1",
    tabs: { sourceTabId: "source-1", editTabId: "edit-1" },
    draftFingerprint: fingerprint,
    qa: { result: "pass", checkedAt: 1, draftFingerprint: fingerprint },
    fields: {
      title: { value: snapshot.title, provenance: "readback", verified: true },
      price: { value: "10", provenance: "source", verified: true },
    },
  });
}

export function seedReady(dir: string, order: DxmListingWorkOrder = readyOrder()): DxmListingWorkOrder {
  saveOrder(dir, order);
  return order;
}

export function basePort(dir: string, over: Partial<DxmSmtPort> = {}): DxmSmtPort {
  const snapshot = readySnapshot();
  return {
    tabId: "edit-1",
    sourceTabId: "source-1",
    journalDir: dir,
    readProbe: async () => editProbe(),
    listTabs: async () => [
      { id: "source-1", url: "https://detail.1688.com/offer/1.html" },
      { id: "edit-1", url: "https://www.dianxiaomi.com/web/smt/edit?id=D1" },
    ],
    claim: async () => {
      throw new Error("不应认领");
    },
    readFields: async () => snapshot,
    writeField: async () => ({ ok: true, readback: "" }),
    translateText: async () => ({ ok: true, verified: true }),
    translateImages: async () => ({ ok: true, verified: true }),
    dismissPopups: async (_tabId, imageBusy) => ({ cancelled: imageBusy ? false : true }),
    saveDraft: async () => ({ ok: true, message: "已保存草稿" }),
    clickPublish: async () => {
      throw new Error("不应发布");
    },
    queryStatus: async () => ({}),
    selectCategory: async () => ({ ok: true, message: "已选择分类" }),
    ...over,
  };
}
