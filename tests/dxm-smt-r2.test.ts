import { afterEach, describe, expect, it } from "vitest";
import { FreeSoul } from "../src/main/agent/free-soul.js";
import { loadOrder, replayOrders } from "../src/main/workflows/dxm-smt-journal.js";
import { fingerprintFromSnapshot } from "../src/main/workflows/dxm-smt-fingerprint.js";
import {
  beginPaidConfirmRun,
  decidePaidAction,
  endPaidConfirmRun,
  issuePaidConfirm,
  resetPaidConfirms,
} from "../src/main/workflows/dxm-smt-images.js";
import { resetDxmSmtRuntime, runDxmSmtWorkflow } from "../src/main/workflows/dxm-smt-listing.js";
import type { DxmSmtPort } from "../src/main/workflows/dxm-smt-listing.js";
import { basePort, editProbe, readyOrder, readySnapshot, seedReady, tempDir } from "./dxm-smt-helpers.js";

afterEach(() => {
  resetDxmSmtRuntime();
  resetPaidConfirms();
});

function dataOf(result: { data?: unknown }): Record<string, unknown> {
  return (result.data || {}) as Record<string, unknown>;
}

function toolCall(id: string, name: string, args: Record<string, unknown>) {
  return {
    content: null,
    tool_calls: [{ id, type: "function" as const, function: { name, arguments: JSON.stringify(args) } }],
  };
}

function scripted(replies: Array<{ content?: string | null; tool_calls?: unknown[] }>): typeof fetch {
  let index = 0;
  return async (_url, init) => {
    const reply = replies[index++];
    if (!reply) throw new Error(`unexpected completion ${index}`);
    void init;
    return new Response(JSON.stringify({ choices: [{ message: reply }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

function soul(
  replies: Array<{ content?: string | null; tool_calls?: unknown[] }>,
  runTool: (name: string, args: Record<string, unknown>) => Promise<{ ok: boolean; message?: string }>,
) {
  return new FreeSoul(
    { apiKey: "test", baseUrl: "https://example.test/v1", model: "m", fetchImpl: scripted(replies) },
    runTool,
  );
}

describe("R2-1 确认句柄时序", () => {
  it("两轮 Free Soul：只有下一条明确同意才带句柄执行，拒绝和模糊不调用准备", async () => {
    const dir = tempDir();
    const order = seedReady(dir);
    let images = 0;
    let clicks = 0;
    const prepares: unknown[] = [];
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
    const runTool = async (name: string, args: Record<string, unknown>) => {
      if (name === "run_workflow") {
        prepares.push(args);
        return runDxmSmtWorkflow({
          id: String(args.id),
          params: (args.params || {}) as Record<string, unknown>,
          port,
        });
      }
      return { ok: true, message: "跳过" };
    };
    const paid = { feature: "图片翻译", workOrderId: order.id, group: "main" as const, scope: "m1.jpg", fee: "1元" };
    const ask = () => soul(
      [toolCall("ask", "request_confirm", { action: "图片翻译", detail: "主图 1 元", paid })],
      runTool,
    ).run({ input: "翻译主图", url: "", title: "", locale: "zh" });

    const unanswered = await ask();
    const pendingId = String(dataOf(unanswered).confirmId || "");
    expect(unanswered.awaitingConfirm).toBe(true);
    expect(pendingId).toMatch(/^paid-/);
    expect(unanswered.text).not.toContain(pendingId);
    expect(prepares).toHaveLength(0);
    expect(decidePaidAction({
      feature: "图片翻译",
      text: "等待确认",
      workOrderId: order.id,
      group: "main",
      scope: "m1.jpg",
      fee: "1元",
      quotedFee: "1元",
      confirmId: pendingId,
      liveScope: "m1.jpg",
    }).execute).toBe(false);

    for (const input of ["不要", "再说吧"]) {
      resetPaidConfirms();
      await ask();
      const skipped = await soul([{ content: "先不动" }], runTool).run({
        input,
        url: "",
        title: "",
        locale: "zh",
      });
      expect(skipped.awaitingConfirm).not.toBe(true);
      expect(prepares).toHaveLength(0);
      expect(images).toBe(0);
    }

    resetPaidConfirms();
    const asked = await ask();
    const confirmId = String(dataOf(asked).confirmId || "");
    const agreed = await soul(
      [
        toolCall("go", "run_workflow", {
          id: "dxm_smt_prepare",
          params: { workOrderId: order.id, paidConsent: { ...paid, confirmId } },
        }),
        { content: "图片已处理" },
      ],
      runTool,
    ).run({ input: "同意", url: "", title: "", locale: "zh", execMode: "auto" });
    expect(agreed.ok).toBe(true);
    expect(images).toBe(1);
    expect(clicks).toBe(0);
    await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { workOrderId: order.id, paidConsent: { ...paid, confirmId } },
      port,
    });
    expect(images).toBe(1);
    expect(clicks).toBe(0);
  });

  it("省略句柄、换图、过期、跨轮次和跨单都不执行", async () => {
    issuePaidConfirm({ confirmId: "only", workOrderId: "wo-1", feature: "图片翻译", group: "main", scope: "m1.jpg", fee: "1元" });
    beginPaidConfirmRun("round-a");
    expect(decidePaidAction({
      feature: "图片翻译",
      workOrderId: "wo-1",
      group: "main",
      scope: "m1.jpg",
      fee: "1元",
      quotedFee: "1元",
      liveScope: "m1.jpg",
      text: "同意",
    }).execute).toBe(false);
    expect(decidePaidAction({
      feature: "图片翻译",
      confirmId: "only",
      workOrderId: "wo-1",
      group: "main",
      scope: "m1.jpg",
      fee: "1元",
      quotedFee: "1元",
      liveScope: "m2.jpg",
    }).execute).toBe(false);
    endPaidConfirmRun("round-a");
    beginPaidConfirmRun("round-b");
    expect(decidePaidAction({
      feature: "图片翻译",
      confirmId: "only",
      workOrderId: "wo-1",
      group: "main",
      scope: "m1.jpg",
      fee: "1元",
      quotedFee: "1元",
      liveScope: "m1.jpg",
    }).execute).toBe(false);

    resetPaidConfirms();
    issuePaidConfirm({
      confirmId: "old",
      workOrderId: "wo-1",
      feature: "图片翻译",
      group: "main",
      scope: "m1.jpg",
      fee: "1元",
      expiresAt: Date.now() - 1000,
    });
    beginPaidConfirmRun("round-c");
    expect(decidePaidAction({
      feature: "图片翻译",
      confirmId: "old",
      workOrderId: "wo-1",
      group: "main",
      scope: "m1.jpg",
      fee: "1元",
      quotedFee: "1元",
      liveScope: "m1.jpg",
    }).execute).toBe(false);

    resetPaidConfirms();
    issuePaidConfirm({ confirmId: "other-order", workOrderId: "wo-x", feature: "图片翻译", group: "main", scope: "m1.jpg", fee: "1元" });
    beginPaidConfirmRun("round-d");
    expect(decidePaidAction({
      feature: "图片翻译",
      confirmId: "other-order",
      workOrderId: "wo-1",
      group: "main",
      scope: "m1.jpg",
      fee: "1元",
      quotedFee: "1元",
      liveScope: "m1.jpg",
    }).execute).toBe(false);
  });
});

describe("R2-2 发布页门禁", () => {
  it("验证码、登录失效、无权限、缺项和错店都不点击，合法草稿店铺才进入 QA", async () => {
    const blockers: Array<Partial<ReturnType<typeof editProbe>>> = [
      { text: "请完成滑动验证" },
      { url: "https://www.dianxiaomi.com/login", text: "登录已失效" },
      { text: "没有权限" },
      { missingFields: ["材质"] },
      { draftShopId: "S2", shops: [{ id: "S1", name: "店铺甲" }, { id: "S2", name: "店铺乙" }] },
      { draftShopId: undefined },
    ];
    for (const patch of blockers) {
      const dir = tempDir();
      const order = seedReady(dir);
      let clicks = 0;
      await runDxmSmtWorkflow({
        id: "dxm_smt_publish",
        params: { workOrderId: order.id, draftFingerprint: order.draftFingerprint },
        port: basePort(dir, {
          readProbe: async () => ({ ...editProbe(), ...patch }),
          clickPublish: async () => {
            clicks += 1;
            return { ok: true, message: "点击", receipt: { kind: "submitted", text: "已提交" } };
          },
        }),
      });
      expect(clicks).toBe(0);
    }

    const dir = tempDir();
    const order = seedReady(dir);
    let clicks = 0;
    let reads = 0;
    const published = await runDxmSmtWorkflow({
      id: "dxm_smt_publish",
      params: { workOrderId: order.id, draftFingerprint: order.draftFingerprint },
      port: basePort(dir, {
        readFields: async () => {
          reads += 1;
          return readySnapshot();
        },
        clickPublish: async () => {
          clicks += 1;
          return { ok: true, message: "点击", receipt: { kind: "submitted", text: "已提交" } };
        },
      }),
    });
    expect(reads).toBeGreaterThan(0);
    expect(clicks).toBe(1);
    expect(dataOf(published).state).toBe("submitted_pending_review");
  });
});

describe("R2-3 状态证据必须关联本单", () => {
  it("他品提交和在线不能待审或上线，缺关联和冲突都停等", async () => {
    const dir = tempDir();
    const order = seedReady(dir);
    await runDxmSmtWorkflow({
      id: "dxm_smt_publish",
      params: { workOrderId: order.id, draftFingerprint: order.draftFingerprint },
      port: basePort(dir, {
        beforeClick: () => {
          throw new Error("停在点击前");
        },
      }),
    }).catch(() => undefined);
    resetDxmSmtRuntime();
    const foreign = await runDxmSmtWorkflow({
      id: "dxm_smt_status",
      params: { workOrderId: order.id },
      port: basePort(dir, {
        queryStatus: async () => ({
          submitRecords: [{ text: "他品已提交", productId: "P2", draftId: "D2", shopId: "S1", sourceRecordId: "R2" }],
          onlineItems: [{ productId: "P2", shopId: "S1", url: "https://www.aliexpress.com/item/2.html" }],
        }),
      }),
    });
    expect(dataOf(foreign).state).not.toBe("submitted_pending_review");
    expect(dataOf(foreign).state).not.toBe("published_online");
    expect(loadOrder(dir, order.id)?.platformProductId).toBeUndefined();

    const bare = await runDxmSmtWorkflow({
      id: "dxm_smt_status",
      params: { workOrderId: order.id },
      port: basePort(dir, { queryStatus: async () => ({ submitRecord: { text: "只有商品号", productId: "P9" }, platformProductId: "P9" }) }),
    });
    expect(dataOf(bare).state).not.toBe("submitted_pending_review");
    expect(loadOrder(dir, order.id)?.platformProductId).toBeUndefined();

    for (const submitRecord of [
      { text: "草稿冲突", productId: "P3", draftId: "D9", shopId: "S1", sourceRecordId: "R1" },
      { text: "来源冲突", productId: "P3", draftId: "D1", shopId: "S1", sourceRecordId: "R9" },
      { text: "店铺冲突", productId: "P3", draftId: "D1", shopId: "S9", sourceRecordId: "R1" },
    ]) {
      const conflicted = await runDxmSmtWorkflow({
        id: "dxm_smt_status",
        params: { workOrderId: order.id },
        port: basePort(dir, { queryStatus: async () => ({ submitRecord }) }),
      });
      expect(dataOf(conflicted).state).not.toBe("submitted_pending_review");
      expect(loadOrder(dir, order.id)?.platformProductId).toBeUndefined();
    }

    const failedOther = await runDxmSmtWorkflow({
      id: "dxm_smt_status",
      params: { workOrderId: order.id },
      port: basePort(dir, {
        queryStatus: async () => ({
          failureRecord: { text: "他品被拒", draftId: "D9", shopId: "S1", sourceRecordId: "R9" },
        }),
      }),
    });
    expect(dataOf(failedOther).state).not.toBe("failed");

    const pending = await runDxmSmtWorkflow({
      id: "dxm_smt_status",
      params: { workOrderId: order.id },
      port: basePort(dir, {
        queryStatus: async () => ({
          submitRecords: [
            { text: "最新但不是本单", productId: "P2", draftId: "D2", shopId: "S1" },
            { text: "本单已提交", productId: "P1", draftId: "D1", shopId: "S1", sourceRecordId: "R1" },
          ],
        }),
      }),
    });
    expect(dataOf(pending).state).toBe("submitted_pending_review");
    expect(loadOrder(dir, order.id)?.platformProductId).toBe("P1");
    const online = await runDxmSmtWorkflow({
      id: "dxm_smt_status",
      params: { workOrderId: order.id },
      port: basePort(dir, {
        queryStatus: async () => ({
          onlineItems: [
            { productId: "P2", shopId: "S1", url: "https://www.aliexpress.com/item/2.html" },
            { productId: "P1", shopId: "S1", url: "https://www.aliexpress.com/item/1.html" },
          ],
        }),
      }),
    });
    expect(dataOf(online).state).toBe("published_online");
  });
});

describe("R2-4 认领查重和原子建单", () => {
  it("没有查重能力时不认领", async () => {
    const dir = tempDir();
    let claims = 0;
    const result = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { sourceRecordId: "R1", shopId: "S1", shopName: "店铺甲" },
      port: basePort(dir, {
        readProbe: async () => ({ ...editProbe(), draftId: undefined }),
        claim: async () => {
          claims += 1;
          return { ok: true, draftId: "D1", shopId: "S1", recordId: "R1", message: "不应认领" };
        },
      }),
    });
    expect(claims).toBe(0);
    expect(dataOf(result).state).toBe("waiting_human");
  });

  it("认领失败即使返回草稿号，下次仍查重且不沿用该号", async () => {
    const dir = tempDir();
    let claims = 0;
    let lookups = 0;
    const port = (): DxmSmtPort => basePort(dir, {
      readProbe: async () => ({ ...editProbe(), draftId: undefined }),
      lookupDraft: async () => {
        lookups += 1;
        return { status: "absent" };
      },
      claim: async () => {
        claims += 1;
        return { ok: false, draftId: "D-bad", shopId: "S1", recordId: "R1", message: "认领失败" };
      },
    });
    const first = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { sourceRecordId: "R1", shopId: "S1", shopName: "店铺甲", claimConsent: "认领" },
      port: port(),
    });
    const id = String(dataOf(first).workOrderId);
    expect(loadOrder(dir, id)?.claimedDraftId).toBeUndefined();
    const lookupsAfterFirst = lookups;
    await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { workOrderId: id, sourceRecordId: "R1", shopId: "S1", shopName: "店铺甲" },
      port: port(),
    });
    expect(lookups).toBeGreaterThan(lookupsAfterFirst);
    expect(claims).toBe(1);
    expect(loadOrder(dir, id)?.claimedDraftId).not.toBe("D-bad");
  });

  it("同一来源和店铺并发只建一单，不同来源可以并行", async () => {
    const dir = tempDir();
    let claims = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = 0;
    const same = (source: string, shop: string, hold: boolean) => runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { sourceRecordId: source, shopId: shop, shopName: "店铺甲", claimConsent: "认领" },
      port: basePort(dir, {
        readProbe: async () => ({ ...editProbe(), draftId: undefined, recordId: source, productIds: [source], shops: [{ id: shop, name: "店铺甲" }] }),
        hold: hold ? async () => {
          entered += 1;
          await gate;
        } : undefined,
        lookupDraft: async () => ({ status: "absent" }),
        claim: async () => {
          claims += 1;
          return { ok: true, draftId: `D-${source}`, shopId: shop, recordId: source, message: "已认领" };
        },
        readFields: async () => readySnapshot(),
      }),
    });
    const first = same("R1", "S1", true);
    const second = same("R1", "S1", true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(entered).toBe(1);
    release();
    await Promise.all([first, second]);
    expect(claims).toBe(1);

    const otherDir = tempDir();
    let otherClaims = 0;
    let otherRelease: () => void = () => {};
    const otherGate = new Promise<void>((resolve) => {
      otherRelease = resolve;
    });
    let otherEntered = false;
    const left = runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { sourceRecordId: "R1", shopId: "S1", shopName: "店铺甲", claimConsent: "认领" },
      port: basePort(otherDir, {
        readProbe: async () => ({ ...editProbe(), draftId: undefined }),
        hold: () => otherGate,
        lookupDraft: async () => ({ status: "absent" }),
        claim: async () => ({ ok: true, draftId: "D1", shopId: "S1", recordId: "R1", message: "甲" }),
      }),
    });
    const right = runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { sourceRecordId: "R2", shopId: "S2", shopName: "店铺乙", claimConsent: "认领" },
      port: basePort(otherDir, {
        readProbe: async () => ({ ...editProbe(), draftId: undefined, recordId: "R2", productIds: ["R2"], shops: [{ id: "S2", name: "店铺乙" }], draftShopId: "S2" }),
        lookupDraft: async () => ({ status: "absent" }),
        claim: async () => {
          otherClaims += 1;
          otherEntered = true;
          return { ok: true, draftId: "D2", shopId: "S2", recordId: "R2", message: "乙" };
        },
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(otherEntered).toBe(true);
    expect(otherClaims).toBe(1);
    otherRelease();
    await Promise.all([left, right]);
  });

  it("认领已在平台成功但本地未落账时，恢复复用目标箱草稿", async () => {
    const dir = tempDir();
    let claims = 0;
    let phase: "absent" | "found" = "absent";
    const port = (): DxmSmtPort => basePort(dir, {
      readProbe: async () => ({ ...editProbe(), draftId: phase === "found" ? "D1" : undefined }),
      lookupDraft: async () => phase === "found" ? { status: "found" as const, draftId: "D1", shopId: "S1", recordId: "R1" } : { status: "absent" as const },
      claim: async () => {
        claims += 1;
        phase = "found";
        return { ok: true, draftId: "D1", shopId: "S1", recordId: "R1", message: "平台已认领" };
      },
      afterClaim: () => {
        throw new Error("local-crash");
      },
    });
    await expect(runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { sourceRecordId: "R1", shopId: "S1", shopName: "店铺甲", claimConsent: "认领" },
      port: port(),
    })).rejects.toThrow(/local-crash/);
    resetDxmSmtRuntime();
    await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { sourceRecordId: "R1", shopId: "S1", shopName: "店铺甲" },
      port: port(),
    });
    expect(claims).toBe(1);
    expect(loadOrder(dir, replayOrders(dir)[0]?.id || "")?.claimedDraftId).toBe("D1");
  });
});

describe("R2-5 翻译后只认最新读回", () => {
  it("旧的已验证字段、空标题和空描述都不能把 QA 补成通过", async () => {
    const dir = tempDir();
    const order = seedReady(dir);
    let reads = 0;
    const oldSnap = readySnapshot();
    oldSnap.title = "OLD";
    oldSnap.description = "OLD DESC";
    const missingField = readySnapshot();
    missingField.fields = missingField.fields.filter((field) => field.key !== "title");
    missingField.title = "NEW";
    const unverified = readySnapshot();
    unverified.fields = unverified.fields.map((field) => field.key === "title" ? { ...field, verified: false, value: "NEW" } : field);
    unverified.title = "NEW";
    const prepared = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { workOrderId: order.id },
      port: basePort(dir, {
        readFields: async () => {
          reads += 1;
          return reads === 1 ? oldSnap : missingField;
        },
      }),
    });
    expect((dataOf(prepared).qa as { result?: string }).result).not.toBe("pass");
    const oldPrint = fingerprintFromSnapshot({
      shopId: "S1",
      shopName: "店铺甲",
      title: "OLD",
      categoryId: oldSnap.categoryId,
      draftId: "D1",
      recordId: "R1",
      pageUrl: editProbe().url,
      snapshot: oldSnap,
    });
    expect(dataOf(prepared).draftFingerprint).not.toBe(oldPrint);

    const emptyDir = tempDir();
    const emptyOrder = seedReady(emptyDir);
    const emptyTitle = readySnapshot();
    emptyTitle.title = "";
    emptyTitle.description = "";
    const emptied = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { workOrderId: emptyOrder.id },
      port: basePort(emptyDir, {
        readFields: async () => emptyTitle,
      }),
    });
    expect((dataOf(emptied).qa as { result?: string }).result).not.toBe("pass");
    expect(String(emptied.message)).not.toContain("Cotton Hat");

    const falseDir = tempDir();
    const falseOrder = seedReady(falseDir);
    const falsified = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { workOrderId: falseOrder.id },
      port: basePort(falseDir, {
        readFields: async () => unverified,
      }),
    });
    expect((dataOf(falsified).qa as { result?: string }).result).not.toBe("pass");

    const okDir = tempDir();
    const okOrder = seedReady(okDir);
    const latest = readySnapshot();
    latest.title = "NEW TITLE";
    latest.fields = latest.fields.map((field) => field.key === "title" ? { ...field, value: "NEW TITLE" } : field);
    const ok = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { workOrderId: okOrder.id },
      port: basePort(okDir, { readFields: async () => latest }),
    });
    expect((dataOf(ok).qa as { result?: string }).result).toBe("pass");
    expect(dataOf(ok).state).toBe("draft_ready");
    const fresh = fingerprintFromSnapshot({
      shopId: "S1",
      shopName: "店铺甲",
      title: "NEW TITLE",
      categoryId: latest.categoryId,
      draftId: "D1",
      recordId: "R1",
      pageUrl: editProbe().url,
      snapshot: latest,
    });
    expect(dataOf(ok).draftFingerprint).toBe(fresh);
  });
});

describe("R2-6 点击后本地未落账", () => {
  it("平台已点击后崩溃，恢复只查询并按关联证据上线", async () => {
    const dir = tempDir();
    const order = seedReady(dir);
    let clicks = 0;
    await expect(runDxmSmtWorkflow({
      id: "dxm_smt_publish",
      params: { workOrderId: order.id, draftFingerprint: order.draftFingerprint },
      port: basePort(dir, {
        clickPublish: async () => {
          clicks += 1;
          return { ok: true, message: "已点", receipt: { kind: "submitted", text: "平台已接收" } };
        },
        afterClick: () => {
          throw new Error("after-click");
        },
      }),
    })).rejects.toThrow(/after-click/);
    expect(clicks).toBe(1);
    expect(loadOrder(dir, order.id)?.publish?.startedAt).toBeTruthy();
    expect(loadOrder(dir, order.id)?.receipt?.kind).not.toBe("submitted");
    resetDxmSmtRuntime();
    const pending = await runDxmSmtWorkflow({
      id: "dxm_smt_status",
      params: { workOrderId: order.id },
      port: basePort(dir, {
        queryStatus: async () => ({
          submitRecord: { text: "审核中", productId: "P1", draftId: "D1", shopId: "S1", sourceRecordId: "R1" },
        }),
        clickPublish: async () => {
          clicks += 1;
          return { ok: true, message: "又点了", receipt: { kind: "submitted", text: "已提交" } };
        },
      }),
    });
    expect(dataOf(pending).state).toBe("submitted_pending_review");
    expect(clicks).toBe(1);
    const again = await runDxmSmtWorkflow({
      id: "dxm_smt_publish",
      params: { workOrderId: order.id, draftFingerprint: order.draftFingerprint },
      port: basePort(dir, {
        queryStatus: async () => ({
          online: { productId: "P1", shopId: "S1", url: "https://www.aliexpress.com/item/1.html" },
        }),
        clickPublish: async () => {
          clicks += 1;
          return { ok: true, message: "又点了", receipt: { kind: "submitted", text: "已提交" } };
        },
      }),
    });
    expect(dataOf(again).state).toBe("published_online");
    expect(clicks).toBe(1);
  });
});

