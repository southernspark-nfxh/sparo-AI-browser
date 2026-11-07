import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkOrder } from "../src/main/workflows/dxm-smt-contract.js";
import { fingerprintFromSnapshot } from "../src/main/workflows/dxm-smt-fingerprint.js";
import { commitOrder, loadOrder, replayOrders, saveOrder } from "../src/main/workflows/dxm-smt-journal.js";
import {
  consumePaidConfirm,
  decidePaidAction,
  issuePaidConfirm,
  resetPaidConfirms,
} from "../src/main/workflows/dxm-smt-images.js";
import { resetDxmSmtRuntime, runDxmSmtWorkflow } from "../src/main/workflows/dxm-smt-listing.js";
import type { DxmSmtPort } from "../src/main/workflows/dxm-smt-listing.js";
import { resolveIdentity } from "../src/main/workflows/dxm-smt-page.js";
import { basePort, editProbe, readyOrder, readySnapshot, seedReady, tempDir } from "./dxm-smt-helpers.js";

afterEach(() => {
  resetDxmSmtRuntime();
  resetPaidConfirms();
});

function dataOf(result: { data?: unknown }): Record<string, unknown> {
  return (result.data || {}) as Record<string, unknown>;
}

function ticket(over: Partial<{ confirmId: string; workOrderId: string; feature: "图片翻译" | "图片白底"; scope: string; fee: string }> = {}) {
  const issued = {
    confirmId: over.confirmId || "confirm-1",
    workOrderId: over.workOrderId || "wo-1",
    feature: over.feature || "图片翻译",
    scope: over.scope || "主图",
    fee: over.fee || "1元",
  };
  issuePaidConfirm(issued);
  return issued;
}

describe("R1-1 收费确认句柄", () => {
  it("未确认、空文本、等待确认、任意文本和自报同意都不执行", () => {
    for (const text of [undefined, "", "等待确认", "随便写一句", "用户已同意", "同意这次图片白底"]) {
      expect(decidePaidAction({ feature: "图片翻译", text, workOrderId: "wo-1", scope: "主图", fee: "1元", quotedFee: "1元" }).execute).toBe(false);
    }
  });

  it("工作单、功能、范围或费用变化后不执行，合法句柄只执行一次且不能发布", async () => {
    const dir = tempDir();
    const order = seedReady(dir);
    const issued = ticket({ workOrderId: order.id });
    let images = 0;
    let clicks = 0;
    const port = basePort(dir, {
      quotedFee: "1元",
      translateImages: async () => {
        images += 1;
        return { ok: true, verified: true };
      },
      clickPublish: async () => {
        clicks += 1;
        return { ok: true, message: "不应发布", receipt: { kind: "submitted", text: "已提交" } };
      },
    });
    const params = { workOrderId: order.id, paidConsent: { confirmId: issued.confirmId, feature: issued.feature, scope: issued.scope, fee: issued.fee } };
    await runDxmSmtWorkflow({ id: "dxm_smt_prepare", params, port });
    expect(images).toBe(1);
    expect(clicks).toBe(0);
    await runDxmSmtWorkflow({ id: "dxm_smt_prepare", params, port });
    expect(images).toBe(1);

    resetPaidConfirms();
    ticket({ workOrderId: "wo-other", confirmId: "confirm-other" });
    let other = 0;
    await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { workOrderId: order.id, paidConsent: { confirmId: "confirm-other", feature: "图片翻译", scope: "主图", fee: "1元" } },
      port: basePort(dir, { quotedFee: "1元", translateImages: async () => { other += 1; return { ok: true, verified: true }; } }),
    });
    expect(other).toBe(0);

    resetPaidConfirms();
    ticket({ workOrderId: order.id, confirmId: "confirm-scope", scope: "主图" });
    let scoped = 0;
    await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { workOrderId: order.id, paidConsent: { confirmId: "confirm-scope", feature: "图片翻译", scope: "变种图", fee: "1元" } },
      port: basePort(dir, { quotedFee: "1元", translateImages: async () => { scoped += 1; return { ok: true, verified: true }; } }),
    });
    expect(scoped).toBe(0);

    resetPaidConfirms();
    ticket({ workOrderId: order.id, confirmId: "confirm-fee" });
    let priced = 0;
    await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { workOrderId: order.id, paidConsent: { confirmId: "confirm-fee", feature: "图片翻译", scope: "主图", fee: "1元" } },
      port: basePort(dir, { quotedFee: "2元", translateImages: async () => { priced += 1; return { ok: true, verified: true }; } }),
    });
    expect(priced).toBe(0);
    expect(readFileSync(join(process.cwd(), "src/main/agent/free-soul.ts"), "utf8")).toContain("registerPaidConfirmFromArgs");
    consumePaidConfirm("missing");
  });
});

describe("R1-2 发布身份绑定", () => {
  it("换标签、换草稿、来源或店铺对不上都不点击", async () => {
    const dir = tempDir();
    const order = seedReady(dir);
    let clicks = 0;
    const publish = (over: Partial<DxmSmtPort>) => runDxmSmtWorkflow({
      id: "dxm_smt_publish",
      params: { workOrderId: order.id, draftFingerprint: order.draftFingerprint },
      port: basePort(dir, {
        clickPublish: async () => {
          clicks += 1;
          return { ok: true, message: "点击", receipt: { kind: "submitted", text: "已提交" } };
        },
        ...over,
      }),
    });
    await publish({ tabId: "edit-2" });
    await publish({ readProbe: async () => ({ ...editProbe(), draftId: "D2" }) });
    await publish({ readProbe: async () => ({ ...editProbe(), recordId: "R9" }) });
    await publish({
      listTabs: async () => [{ id: "edit-1", url: "https://www.dianxiaomi.com/web/smt/edit?id=OTHER" }],
    });
    expect(clicks).toBe(0);
  });

  it("认领返回错误店铺时不写字段", async () => {
    const dir = tempDir();
    let writes = 0;
    const result = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { sourceRecordId: "R1", shopId: "S1", shopName: "店铺甲" },
      port: basePort(dir, {
        readProbe: async () => ({ ...editProbe(), draftId: undefined }),
        lookupDraft: async () => ({ status: "absent" }),
        claim: async () => ({ ok: true, draftId: "D9", shopId: "S9", shopName: "另一店铺", message: "认领到了别的店" }),
        writeField: async () => {
          writes += 1;
          return { ok: true, readback: "x" };
        },
      }),
    });
    expect(writes).toBe(0);
    expect(String(result.message)).toMatch(/店铺/);
    expect(["editing", "draft_ready", "saved_draft", "published_online"]).not.toContain(dataOf(result).state);
  });

  it("指定店铺名称没有精确匹配时不默认唯一店", () => {
    const probe = editProbe();
    const missed = resolveIdentity(probe, { shopName: "不存在的店", sourceRecordId: "R1" });
    expect(missed.ok).toBe(false);
    if (!missed.ok) expect(missed.reason).toMatch(/精确匹配|不会默认/);
  });
});

describe("R1-3 指纹与点击前 QA", () => {
  it("动态字段、描述、SKU、模板和图片状态变化都会改变指纹；无变化保持不变", () => {
    const snapshot = readySnapshot();
    const base = {
      shopId: "S1",
      shopName: "店铺甲",
      title: snapshot.title,
      categoryId: snapshot.categoryId,
      draftId: "D1",
      recordId: "R1",
      pageUrl: "https://www.dianxiaomi.com/web/smt/edit?id=D1",
      snapshot,
    };
    const first = fingerprintFromSnapshot(base);
    expect(fingerprintFromSnapshot(base)).toBe(first);
    const material = structuredClone(snapshot);
    material.fields = [...material.fields, { key: "材质", group: "属性", required: true, value: "棉", verified: true }];
    expect(fingerprintFromSnapshot({ ...base, snapshot: material })).not.toBe(first);
    const described = structuredClone(snapshot);
    described.description = "新的描述";
    expect(fingerprintFromSnapshot({ ...base, snapshot: described })).not.toBe(first);
    const sku = structuredClone(snapshot);
    sku.skus = [{ specs: { 颜色: "蓝" }, price: "10", stock: "5" }];
    expect(fingerprintFromSnapshot({ ...base, snapshot: sku })).not.toBe(first);
    const template = structuredClone(snapshot);
    template.freightTemplate = "另一模板";
    expect(fingerprintFromSnapshot({ ...base, snapshot: template })).not.toBe(first);
    const failedImage = structuredClone(snapshot);
    failedImage.images = { ...failedImage.images, main: [{ src: "m1.jpg", status: "failed" }] };
    expect(fingerprintFromSnapshot({ ...base, snapshot: failedImage })).not.toBe(first);
  });

  it("图片状态变失败、新必填项或未读回时，即使值没变也不发布", async () => {
    const dir = tempDir();
    const order = seedReady(dir);
    let clicks = 0;
    const attempt = (readFields: DxmSmtPort["readFields"], fingerprint = order.draftFingerprint) => runDxmSmtWorkflow({
      id: "dxm_smt_publish",
      params: { workOrderId: order.id, draftFingerprint: fingerprint },
      port: basePort(dir, {
        readFields,
        clickPublish: async () => {
          clicks += 1;
          return { ok: true, message: "点击", receipt: { kind: "submitted", text: "已提交" } };
        },
      }),
    });
    const failed = readySnapshot();
    failed.images = { ...failed.images, main: [{ src: "m1.jpg", status: "failed" }] };
    await attempt(async () => failed);
    const required = readySnapshot();
    required.fields = [...required.fields, { key: "材质", group: "属性", required: true, value: "", verified: false }];
    await attempt(async () => required, fingerprintFromSnapshot({
      shopId: "S1",
      shopName: "店铺甲",
      title: required.title,
      categoryId: required.categoryId,
      draftId: "D1",
      recordId: "R1",
      pageUrl: "https://www.dianxiaomi.com/web/smt/edit?id=D1",
      snapshot: required,
    }));
    const unverified = readySnapshot();
    unverified.fields = unverified.fields.map((field) => field.key === "title" ? { ...field, verified: false } : field);
    await attempt(async () => unverified);
    expect(clicks).toBe(0);
  });
});

describe("R1-4 同单串行与旧快照", () => {
  it("prepare 持锁时 publish 不能点击，结束后只点击一次且不被旧快照盖回", async () => {
    const dir = tempDir();
    const order = seedReady(dir);
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const held = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let clicks = 0;
    const port = basePort(dir, {
      hold: () => {
        entered();
        return gate;
      },
      clickPublish: async () => {
        clicks += 1;
        return { ok: true, message: "点击", receipt: { kind: "submitted", text: "已提交平台", productId: "P1" } };
      },
    });
    const preparing = runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { workOrderId: order.id, sourceRecordId: "R1", shopId: "S1" },
      port,
    });
    await held;
    const publishing = runDxmSmtWorkflow({
      id: "dxm_smt_publish",
      params: { workOrderId: order.id, draftFingerprint: order.draftFingerprint },
      port,
    });
    await Promise.resolve();
    expect(clicks).toBe(0);
    release();
    await preparing;
    await publishing;
    expect(clicks).toBe(1);
    const saved = loadOrder(dir, order.id);
    expect(saved?.state).toBe("submitted_pending_review");
    expect(saved?.publish?.clickedAt).toBeTruthy();
  });

  it("旧 revision 不能覆盖较新的发布尝试，status 写回也不能覆盖更新的回执", async () => {
    const dir = tempDir();
    const order = seedReady(dir);
    const first = commitOrder(dir, { ...order, publish: { startedAt: 10, fingerprint: order.draftFingerprint || "", shopId: "S1" } }, order.revision ?? 0);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const stale = commitOrder(dir, { ...order, publish: undefined, receipt: undefined, state: "draft_ready" }, 0);
    expect(stale.ok).toBe(false);
    expect(loadOrder(dir, order.id)?.publish?.startedAt).toBe(10);

    const pending = commitOrder(dir, {
      ...first.order,
      state: "submitted_pending_review",
      platformProductId: "P1",
      receipt: { kind: "submitted", text: "新回执", productId: "P1" },
      publish: { ...first.order.publish!, resolved: true },
    }, first.order.revision ?? 0);
    expect(pending.ok).toBe(true);
    const status = await runDxmSmtWorkflow({
      id: "dxm_smt_status",
      params: { workOrderId: order.id },
      port: basePort(dir, {
        queryStatus: async (current) => {
          const latest = loadOrder(dir, current.id);
          if (latest) {
            commitOrder(dir, {
              ...latest,
              receipt: { kind: "submitted", text: "更新的回执", productId: "P1" },
              publish: latest.publish ? { ...latest.publish, clickedAt: 99 } : undefined,
            }, latest.revision ?? 0);
          }
          return {};
        },
      }),
    });
    expect(loadOrder(dir, order.id)?.receipt?.text).toBe("更新的回执");
    expect(String(dataOf(status).state)).not.toBe("draft_ready");
    expect(loadOrder(dir, order.id)?.publish?.clickedAt).toBe(99);
  });

  it("不同工作单可以同时进入发布点击", async () => {
    const dir = tempDir();
    const first = seedReady(dir);
    const second = readyOrder();
    second.id = "wo-2";
    saveOrder(dir, second);
    let pending = 0;
    let opened: () => void = () => {};
    const both = new Promise<void>((resolve) => { opened = resolve; });
    const release: Array<() => void> = [];
    const portFor = (id: string) => basePort(dir, {
      clickPublish: () => new Promise((resolve) => {
        pending += 1;
        if (pending === 2) opened();
        release.push(() => resolve({ ok: true, message: id, receipt: { kind: "submitted", text: "已提交" } }));
      }),
    });
    const left = runDxmSmtWorkflow({
      id: "dxm_smt_publish",
      params: { workOrderId: first.id, draftFingerprint: first.draftFingerprint },
      port: portFor(first.id),
    });
    const right = runDxmSmtWorkflow({
      id: "dxm_smt_publish",
      params: { workOrderId: second.id, draftFingerprint: second.draftFingerprint },
      port: portFor(second.id),
    });
    await Promise.race([
      both,
      new Promise((_, reject) => setTimeout(() => reject(new Error("两个工作单没有并行进入点击")), 1000)),
    ]);
    expect(pending).toBe(2);
    release.forEach((done) => done());
    await Promise.all([left, right]);
  });
});

describe("R1-5 崩溃恢复、拒绝后修复和上线迁移", () => {
  it("无预填平台 ID：提交记录给 ID，待审后再按同 ID 上线", async () => {
    const dir = tempDir();
    const order = seedReady(dir);
    expect(order.platformProductId).toBeUndefined();
    let clicks = 0;
    const published = await runDxmSmtWorkflow({
      id: "dxm_smt_publish",
      params: { workOrderId: order.id, draftFingerprint: order.draftFingerprint },
      port: basePort(dir, {
        clickPublish: async () => {
          clicks += 1;
          return { ok: true, message: "点击", receipt: { kind: "submitted", text: "已提交平台" } };
        },
      }),
    });
    expect(dataOf(published).state).toBe("submitted_pending_review");
    expect(loadOrder(dir, order.id)?.platformProductId).toBeUndefined();
    const pending = await runDxmSmtWorkflow({
      id: "dxm_smt_status",
      params: { workOrderId: order.id },
      port: basePort(dir, { queryStatus: async () => ({ submitRecord: { text: "审核中", productId: "P1" } }) }),
    });
    expect(dataOf(pending).state).toBe("submitted_pending_review");
    expect(loadOrder(dir, order.id)?.platformProductId).toBe("P1");
    const online = await runDxmSmtWorkflow({
      id: "dxm_smt_status",
      params: { workOrderId: order.id },
      port: basePort(dir, {
        queryStatus: async () => ({ online: { productId: "P1", shopId: "S1", url: "https://www.aliexpress.com/item/1001.html" } }),
      }),
    });
    expect(dataOf(online).state).toBe("published_online");
    expect(clicks).toBe(1);
  });

  it("点击后崩溃，查询可以关成待审或上线，期间不重复点击", async () => {
    const dir = tempDir();
    const order = seedReady(dir);
    let clicks = 0;
    await expect(runDxmSmtWorkflow({
      id: "dxm_smt_publish",
      params: { workOrderId: order.id, draftFingerprint: order.draftFingerprint },
      port: basePort(dir, {
        beforeClick: () => { throw new Error("crash"); },
        clickPublish: async () => {
          clicks += 1;
          return { ok: true, message: "点击", receipt: { kind: "submitted", text: "已提交" } };
        },
      }),
    })).rejects.toThrow(/crash/);
    resetDxmSmtRuntime();
    const pending = await runDxmSmtWorkflow({
      id: "dxm_smt_status",
      params: { workOrderId: order.id },
      port: basePort(dir, {
        queryStatus: async () => ({ submitRecord: { text: "审核中", productId: "P8" } }),
        clickPublish: async () => {
          clicks += 1;
          return { ok: true, message: "又点了", receipt: { kind: "submitted", text: "已提交" } };
        },
      }),
    });
    expect(clicks).toBe(0);
    expect(dataOf(pending).state).toBe("submitted_pending_review");
    const online = await runDxmSmtWorkflow({
      id: "dxm_smt_status",
      params: { workOrderId: order.id },
      port: basePort(dir, {
        queryStatus: async () => ({ online: { productId: "P8", shopId: "S1", url: "https://www.aliexpress.com/item/8.html" } }),
      }),
    });
    expect(dataOf(online).state).toBe("published_online");
    expect(clicks).toBe(0);
  });

  it("平台拒绝后重新准备会使旧指纹失效", async () => {
    const dir = tempDir();
    const order = seedReady(dir);
    const oldFingerprint = order.draftFingerprint || "";
    let clicks = 0;
    let reads = 0;
    await runDxmSmtWorkflow({
      id: "dxm_smt_publish",
      params: { workOrderId: order.id, draftFingerprint: oldFingerprint },
      port: basePort(dir, {
        clickPublish: async () => {
          clicks += 1;
          return { ok: true, message: "被拒", receipt: { kind: "rejected", text: "类目资质缺失：品牌资质" } };
        },
      }),
    });
    const changed = readySnapshot();
    changed.description = "已补充说明";
    const prepared = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { workOrderId: order.id, sourceRecordId: "R1", shopId: "S1" },
      port: basePort(dir, {
        readFields: async () => {
          reads += 1;
          return changed;
        },
      }),
    });
    expect(reads).toBeGreaterThan(0);
    expect(dataOf(prepared).state).toBe("draft_ready");
    const saved = loadOrder(dir, order.id);
    expect(saved?.draftFingerprint).not.toBe(oldFingerprint);
    const again = await runDxmSmtWorkflow({
      id: "dxm_smt_publish",
      params: { workOrderId: order.id, draftFingerprint: oldFingerprint },
      port: basePort(dir, {
        readFields: async () => changed,
        clickPublish: async () => {
          clicks += 1;
          return { ok: true, message: "点击", receipt: { kind: "submitted", text: "已提交" } };
        },
      }),
    });
    expect(clicks).toBe(1);
    expect(dataOf(again).refused).toBe(true);
  });

  it("其他商品的在线记录不能使本单上线", async () => {
    const dir = tempDir();
    const order = seedReady(dir);
    await runDxmSmtWorkflow({
      id: "dxm_smt_publish",
      params: { workOrderId: order.id, draftFingerprint: order.draftFingerprint },
      port: basePort(dir, {
        clickPublish: async () => ({ ok: true, message: "点击", receipt: { kind: "submitted", text: "已提交平台" } }),
      }),
    });
    const foreign = await runDxmSmtWorkflow({
      id: "dxm_smt_status",
      params: { workOrderId: order.id },
      port: basePort(dir, {
        queryStatus: async () => ({ online: { productId: "OTHER", shopId: "S1", url: "https://www.aliexpress.com/item/other.html" } }),
      }),
    });
    expect(dataOf(foreign).state).not.toBe("published_online");
  });

  it("E11 缺资质补完后从断点续跑，不重新认领", async () => {
    const dir = tempDir();
    let claims = 0;
    const bare = readySnapshot();
    bare.brand = undefined;
    bare.fields = bare.fields.map((field) => field.key === "brand" ? { ...field, value: "", verified: false } : field);
    const first = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { sourceRecordId: "R1", shopId: "S1", shopName: "店铺甲" },
      port: basePort(dir, {
        readFields: async () => bare,
        claim: async () => {
          claims += 1;
          return { ok: true, draftId: "D2", shopId: "S1", message: "不应认领" };
        },
      }),
    });
    expect(dataOf(first).state).toBe("waiting_human");
    expect(String(first.message)).toMatch(/资质/);
    const second = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { workOrderId: String(dataOf(first).workOrderId), sourceRecordId: "R1", shopId: "S1" },
      port: basePort(dir, {
        readFields: async () => readySnapshot(),
        claim: async () => {
          claims += 1;
          return { ok: true, draftId: "D3", shopId: "S1", message: "又认领" };
        },
      }),
    });
    expect(claims).toBe(0);
    expect(dataOf(second).state).toBe("draft_ready");
  });
});

describe("R1-6 认领幂等、证据和来源", () => {
  it("认领落账前崩溃，恢复时复用目标箱草稿，不重复认领", async () => {
    const dir = tempDir();
    const seed = createWorkOrder({
      id: "wo-claim",
      state: "observed",
      source: { crawlRecordId: "R1", productId: "R1" },
      target: { platform: "aliexpress", shopId: "S1", shopNameSnapshot: "店铺甲" },
    });
    saveOrder(dir, seed);
    let claims = 0;
    let phase: "absent" | "found" = "absent";
    const port = (): DxmSmtPort => basePort(dir, {
      readProbe: async () => ({ ...editProbe(), draftId: undefined }),
      lookupDraft: async () => phase === "found"
        ? { status: "found", draftId: "D1", shopId: "S1" }
        : { status: "absent" },
      claim: async () => {
        claims += 1;
        phase = "found";
        throw new Error("ledger");
      },
    });
    await expect(runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { workOrderId: seed.id, sourceRecordId: "R1", shopId: "S1", shopName: "店铺甲" },
      port: port(),
    })).rejects.toThrow(/ledger/);
    resetDxmSmtRuntime();
    await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { workOrderId: seed.id, sourceRecordId: "R1", shopId: "S1", shopName: "店铺甲" },
      port: port(),
    });
    expect(claims).toBe(1);
    expect(loadOrder(dir, seed.id)?.claimedDraftId).toBe("D1");
  });

  it("多个同源未关工作单停等，不新建", async () => {
    const dir = tempDir();
    for (const id of ["wo-a", "wo-b"]) {
      saveOrder(dir, createWorkOrder({
        id,
        state: "claimed",
        claimedDraftId: id,
        source: { crawlRecordId: "R1" },
        target: { platform: "aliexpress", shopId: "S1" },
      }));
    }
    const result = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { sourceRecordId: "R1", shopId: "S1" },
      port: basePort(dir),
    });
    expect(dataOf(result).state).toBe("waiting_human");
    expect(dataOf(result).ambiguous).toBe(true);
    expect(replayOrders(dir)).toHaveLength(2);
  });

  it("副作用有三层证据，失败不标已验证，suggestion 不会改成 readback", async () => {
    const dir = tempDir();
    const result = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: {
        sourceRecordId: "R1",
        shopId: "S1",
        shopName: "店铺甲",
        categoryId: "cat-hat",
        writes: [{ key: "title", value: "Cotton Hat", provenance: "suggestion" }],
        saveDraft: true,
      },
      port: basePort(dir, {
        readProbe: async () => ({ ...editProbe(), draftId: undefined }),
        lookupDraft: async () => ({ status: "absent" }),
        claim: async () => ({ ok: true, draftId: "D1", shopId: "S1", shopName: "店铺甲", message: "已认领" }),
        readFields: async () => {
          const snapshot = readySnapshot();
          snapshot.categoryId = "old-cat";
          return snapshot;
        },
        selectCategory: async () => ({ ok: false, message: "分类失败" }),
        writeField: async () => ({ ok: true, readback: "没写上" }),
        saveDraft: async () => ({ ok: true, message: "已保存", readback: "草稿还在" }),
      }),
    });
    expect(dataOf(result).state).not.toBe("published_online");
    const failedCategory = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: {
        workOrderId: "wo-evidence",
        sourceRecordId: "R1",
        shopId: "S1",
        writes: [{ key: "title", value: "Cotton Hat", provenance: "suggestion" }],
      },
      port: basePort(dir, {
        readProbe: async () => ({ ...editProbe(), draftId: "D1" }),
        readFields: async () => readySnapshot(),
        writeField: async () => ({ ok: true, readback: "没写上" }),
      }),
    });
    const saved = replayOrders(dir).find((item) => item.id === dataOf(failedCategory).workOrderId);
    const write = saved?.evidence.find((item) => item.action === "write_field");
    expect(write && "observed" in write && "changed" in write && "verified" in write).toBe(true);
    expect(write?.verified).toBe(false);
    expect(saved?.fields.title?.provenance).toBe("suggestion");
    expect(saved?.fields.title?.provenance).not.toBe("readback");
    expect(result.ok).toBe(true);
  });
});

describe("R1-7 文字翻译和分类", () => {
  it("文字翻译和图片翻译分开记录，任一失败不能抵另一项", async () => {
    const dir = tempDir();
    const order = seedReady(dir);
    const issued = ticket({ workOrderId: order.id });
    let texts = 0;
    let images = 0;
    const failedText = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: {
        workOrderId: order.id,
        paidConsent: { confirmId: issued.confirmId, feature: "图片翻译", scope: "主图", fee: "1元" },
      },
      port: basePort(dir, {
        quotedFee: "1元",
        translateText: async () => {
          texts += 1;
          return { ok: false, verified: false };
        },
        translateImages: async () => {
          images += 1;
          return { ok: true, verified: true };
        },
      }),
    });
    expect(texts).toBe(1);
    expect(images).toBe(1);
    expect(dataOf(failedText).qa && (dataOf(failedText).qa as { result?: string }).result).not.toBe("pass");
    expect(String(failedText.message)).toMatch(/文字翻译失败/);
    expect(String(failedText.message)).not.toMatch(/未发起/);
    const saved = loadOrder(dir, order.id);
    expect(saved?.evidence.some((item) => item.action === "translate_text")).toBe(true);
    expect(saved?.evidence.some((item) => item.action === "translate_images")).toBe(true);
  });

  it("文字翻译读回为空时 QA 不通过，成功时摘要写已读回", async () => {
    const dir = tempDir();
    const empty = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { sourceRecordId: "R1", shopId: "S1", shopName: "店铺甲" },
      port: basePort(dir, {
        translateText: async () => ({ ok: true, verified: true }),
        readFields: async () => ({ ...readySnapshot(), title: "" }),
      }),
    });
    expect((dataOf(empty).qa as { result?: string }).result).not.toBe("pass");
    const okDir = tempDir();
    const ok = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { sourceRecordId: "R1", shopId: "S1", shopName: "店铺甲" },
      port: basePort(okDir),
    });
    expect(String(ok.message)).toMatch(/文字翻译已读回/);
    expect((dataOf(ok).qa as { result?: string }).result).toBe("pass");
  });

  it("分类失败或读回不一致时不再写字段", async () => {
    const dir = tempDir();
    let writes = 0;
    const failed = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { sourceRecordId: "R1", shopId: "S1", categoryId: "cat-new" },
      port: basePort(dir, {
        readFields: async () => readySnapshot(),
        selectCategory: async () => ({ ok: false, message: "分类失败" }),
        writeField: async () => {
          writes += 1;
          return { ok: true, readback: "x" };
        },
      }),
    });
    expect(writes).toBe(0);
    expect(String(failed.message)).toMatch(/分类/);
    const mismatch = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { sourceRecordId: "R9", shopId: "S1", shopName: "店铺甲", categoryId: "cat-new" },
      port: basePort(dir, {
        readProbe: async () => ({ ...editProbe(), recordId: "R9", productIds: ["R9"], draftId: "D9" }),
        listTabs: async () => [{ id: "edit-1", url: "https://www.dianxiaomi.com/web/smt/edit?id=D9" }],
        readFields: async () => ({ ...readySnapshot(), categoryId: "still-old" }),
        selectCategory: async () => ({ ok: true, message: "已点" }),
        writeField: async () => {
          writes += 1;
          return { ok: true, readback: "x" };
        },
      }),
    });
    expect(writes).toBe(0);
    expect(String(mismatch.message)).toMatch(/分类/);
  });
});
