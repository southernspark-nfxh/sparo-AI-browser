import { afterEach, describe, expect, it } from "vitest";
import { createWorkOrder } from "../src/main/workflows/dxm-smt-contract.js";
import { fingerprintFromSnapshot } from "../src/main/workflows/dxm-smt-fingerprint.js";
import { replayOrders, saveOrder } from "../src/main/workflows/dxm-smt-journal.js";
import { resetDxmSmtRuntime, runDxmSmtWorkflow } from "../src/main/workflows/dxm-smt-listing.js";
import type { DxmSmtPort } from "../src/main/workflows/dxm-smt-listing.js";
import { basePort, editProbe, readyOrder, readySnapshot, seedReady, tempDir } from "./dxm-smt-helpers.js";

afterEach(() => {
  resetDxmSmtRuntime();
});

function dataOf(result: { data?: unknown }): Record<string, unknown> {
  return (result.data || {}) as Record<string, unknown>;
}

function publishPort(dir: string, over: Partial<DxmSmtPort> = {}): DxmSmtPort {
  return basePort(dir, {
    clickPublish: async () => ({ ok: true, message: "已点击", receipt: { kind: "submitted", text: "已提交平台" } }),
    ...over,
  });
}

describe("T8 发布、回执与防重复", () => {
  it("未准备、指纹不符或店铺改变时拒绝发布", async () => {
    const dir = tempDir();
    const order = seedReady(dir);
    let clicks = 0;
    const port = publishPort(dir, {
      clickPublish: async () => {
        clicks += 1;
        return { ok: true, message: "点击", receipt: { kind: "submitted", text: "已提交" } };
      },
    });
    const unprepared = createWorkOrder({ id: "wo-new", state: "observed", target: { platform: "aliexpress", shopId: "S1" } });
    saveOrder(dir, unprepared);
    const bare = await runDxmSmtWorkflow({
      id: "dxm_smt_publish",
      params: { workOrderId: "wo-new", draftFingerprint: "none" },
      port,
    });
    expect(dataOf(bare).refused).toBe(true);
    expect(clicks).toBe(0);

    const mismatch = await runDxmSmtWorkflow({
      id: "dxm_smt_publish",
      params: { workOrderId: order.id, draftFingerprint: "other-fingerprint" },
      port,
    });
    expect(dataOf(mismatch).refused).toBe(true);
    expect(clicks).toBe(0);

    const moved = await runDxmSmtWorkflow({
      id: "dxm_smt_publish",
      params: { workOrderId: order.id, draftFingerprint: order.draftFingerprint },
      port: publishPort(dir, {
        readProbe: async () => ({ ...editProbe(), shops: [{ id: "S9", name: "另一店铺" }] }),
        clickPublish: async () => {
          clicks += 1;
          return { ok: true, message: "点击", receipt: { kind: "submitted", text: "已提交" } };
        },
      }),
    });
    expect(dataOf(moved).refused).toBe(true);
    expect(clicks).toBe(0);
  });

  it("本地确认布尔值不能代替指纹门", async () => {
    const dir = tempDir();
    const order = seedReady(dir);
    let clicks = 0;
    const result = await runDxmSmtWorkflow({
      id: "dxm_smt_publish",
      params: { workOrderId: order.id, draftFingerprint: "wrong", confirmed: true },
      port: publishPort(dir, {
        clickPublish: async () => {
          clicks += 1;
          return { ok: true, message: "点击", receipt: { kind: "submitted", text: "已提交" } };
        },
      }),
    });
    expect(clicks).toBe(0);
    expect(dataOf(result).refused).toBe(true);
  });

  it("点击前崩溃恢复后不二次点击", async () => {
    const dir = tempDir();
    const order = seedReady(dir);
    let clicks = 0;
    await expect(runDxmSmtWorkflow({
      id: "dxm_smt_publish",
      params: { workOrderId: order.id, draftFingerprint: order.draftFingerprint },
      port: publishPort(dir, {
        beforeClick: () => {
          throw new Error("crash");
        },
        clickPublish: async () => {
          clicks += 1;
          return { ok: true, message: "点击", receipt: { kind: "submitted", text: "已提交" } };
        },
      }),
    })).rejects.toThrow(/crash/);
    expect(clicks).toBe(0);
    resetDxmSmtRuntime();
    const again = await runDxmSmtWorkflow({
      id: "dxm_smt_publish",
      params: { workOrderId: order.id, draftFingerprint: order.draftFingerprint },
      port: publishPort(dir, {
        clickPublish: async () => {
          clicks += 1;
          return { ok: true, message: "点击", receipt: { kind: "submitted", text: "已提交" } };
        },
      }),
    });
    expect(clicks).toBe(0);
    expect(dataOf(again).state).toBe("waiting_human");
    expect(String(again.message)).toMatch(/未知|查询/);
  });

  it("待审、结果未知和已上线重复发布都不再次提交", async () => {
    const dir = tempDir();
    const order = seedReady(dir);
    let clicks = 0;
    const first = await runDxmSmtWorkflow({
      id: "dxm_smt_publish",
      params: { workOrderId: order.id, draftFingerprint: order.draftFingerprint },
      port: publishPort(dir, {
        clickPublish: async () => {
          clicks += 1;
          return { ok: true, message: "点击", receipt: { kind: "submitted", text: "已提交平台" } };
        },
      }),
    });
    expect(clicks).toBe(1);
    expect(dataOf(first).state).toBe("submitted_pending_review");
    expect(String(first.message)).toContain("已提交，平台处理中，尚未上线");
    const second = await runDxmSmtWorkflow({
      id: "dxm_smt_publish",
      params: { workOrderId: order.id, draftFingerprint: order.draftFingerprint },
      port: publishPort(dir, {
        clickPublish: async () => {
          clicks += 1;
          return { ok: true, message: "点击", receipt: { kind: "submitted", text: "已提交平台" } };
        },
      }),
    });
    expect(clicks).toBe(1);
    expect(dataOf(second).state).toBe("submitted_pending_review");

    const unknown = readyOrder();
    unknown.id = "wo-unknown";
    unknown.publish = { startedAt: 1, fingerprint: unknown.draftFingerprint || "", shopId: "S1" };
    saveOrder(dir, unknown);
    const unknownResult = await runDxmSmtWorkflow({
      id: "dxm_smt_publish",
      params: { workOrderId: unknown.id, draftFingerprint: unknown.draftFingerprint },
      port: publishPort(dir, {
        clickPublish: async () => {
          clicks += 1;
          return { ok: true, message: "点击", receipt: { kind: "submitted", text: "已提交" } };
        },
      }),
    });
    expect(dataOf(unknownResult).state).toBe("waiting_human");

    const online = readyOrder();
    online.id = "wo-online";
    online.state = "published_online";
    online.receipt = { kind: "online", productId: "P1", url: "https://www.aliexpress.com/item/1.html" };
    saveOrder(dir, online);
    await runDxmSmtWorkflow({
      id: "dxm_smt_publish",
      params: { workOrderId: online.id, draftFingerprint: online.draftFingerprint },
      port: publishPort(dir, {
        clickPublish: async () => {
          clicks += 1;
          return { ok: true, message: "点击", receipt: { kind: "online", productId: "P1", url: "https://x" } };
        },
      }),
    });
    expect(clicks).toBe(1);
  });

  it("同一工作单并发发布只产生一次点击", async () => {
    const dir = tempDir();
    const order = seedReady(dir);
    let clicks = 0;
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const port = publishPort(dir, {
      clickPublish: () => new Promise((resolve) => {
        clicks += 1;
        entered();
        release = () => resolve({ ok: true, message: "点击", receipt: { kind: "submitted", text: "已提交平台" } });
      }),
    });
    const first = runDxmSmtWorkflow({
      id: "dxm_smt_publish",
      params: { workOrderId: order.id, draftFingerprint: order.draftFingerprint },
      port,
    });
    await started;
    const second = await runDxmSmtWorkflow({
      id: "dxm_smt_publish",
      params: { workOrderId: order.id, draftFingerprint: order.draftFingerprint },
      port,
    });
    expect(clicks).toBe(1);
    expect(String(second.message)).toMatch(/正在进行|当前尝试/);
    release();
    await first;
    expect(clicks).toBe(1);
  });

  it("平台拒绝后保留原文，旧指纹不能直接重发", async () => {
    const dir = tempDir();
    const order = seedReady(dir);
    let clicks = 0;
    const rejected = await runDxmSmtWorkflow({
      id: "dxm_smt_publish",
      params: { workOrderId: order.id, draftFingerprint: order.draftFingerprint },
      port: publishPort(dir, {
        clickPublish: async () => {
          clicks += 1;
          return {
            ok: true,
            message: "被拒",
            receipt: { kind: "rejected", text: "类目资质缺失：品牌资质", productId: "P1" },
          };
        },
      }),
    });
    expect(dataOf(rejected).state).toBe("failed");
    expect(String(rejected.message)).toContain("类目资质缺失：品牌资质");
    const again = await runDxmSmtWorkflow({
      id: "dxm_smt_publish",
      params: { workOrderId: order.id, draftFingerprint: order.draftFingerprint },
      port: publishPort(dir, {
        clickPublish: async () => {
          clicks += 1;
          return { ok: true, message: "点击", receipt: { kind: "submitted", text: "已提交" } };
        },
      }),
    });
    expect(clicks).toBe(1);
    expect(dataOf(again).refused).toBe(true);
  });

  it("提交回执只进入待审；只有本商品本店铺的在线读回才能上线", async () => {
    const dir = tempDir();
    const order = seedReady(dir);
    const submitted = await runDxmSmtWorkflow({
      id: "dxm_smt_publish",
      params: { workOrderId: order.id, draftFingerprint: order.draftFingerprint },
      port: publishPort(dir),
    });
    expect(dataOf(submitted).state).toBe("submitted_pending_review");

    const unrelated = await runDxmSmtWorkflow({
      id: "dxm_smt_status",
      params: { workOrderId: order.id },
      port: publishPort(dir, {
        queryStatus: async () => ({
          submitRecord: { text: "审核中", productId: "P1" },
          online: { productId: "OTHER", shopId: "S1", url: "https://www.aliexpress.com/item/other.html" },
        }),
      }),
    });
    expect(dataOf(unrelated).state).toBe("submitted_pending_review");

    const empty = await runDxmSmtWorkflow({
      id: "dxm_smt_status",
      params: { workOrderId: order.id },
      port: publishPort(dir, { queryStatus: async () => ({}) }),
    });
    expect(dataOf(empty).state).toBe("submitted_pending_review");
    expect(String(empty.message)).toMatch(/不推断/);

    const online = await runDxmSmtWorkflow({
      id: "dxm_smt_status",
      params: { workOrderId: order.id },
      port: publishPort(dir, {
        queryStatus: async () => ({
          submitRecord: { text: "审核中", productId: "P1" },
          platformProductId: "P1",
          online: { productId: "P1", shopId: "S1", url: "https://www.aliexpress.com/item/1001.html" },
        }),
      }),
    });
    expect(dataOf(online).state).toBe("published_online");
    const saved = replayOrders(dir).find((item) => item.id === order.id);
    expect(saved?.receipt?.kind).toBe("online");
    expect(saved?.receipt?.url).toContain("1001");
  });

  it("发布点击后超时先查重，不把超时写成失败或成功", async () => {
    const dir = tempDir();
    const order = seedReady(dir);
    let clicks = 0;
    const timeout = await runDxmSmtWorkflow({
      id: "dxm_smt_publish",
      params: { workOrderId: order.id, draftFingerprint: order.draftFingerprint },
      port: publishPort(dir, {
        clickPublish: async () => {
          clicks += 1;
          return { ok: true, message: "超时，没有回执" };
        },
      }),
    });
    expect(clicks).toBe(1);
    expect(dataOf(timeout).state).toBe("waiting_human");
    expect(String(timeout.message)).toMatch(/未知/);
    const fingerprint = fingerprintFromSnapshot({
      shopId: "S1",
      shopName: "店铺甲",
      title: readySnapshot().title,
      categoryId: readySnapshot().categoryId,
      draftId: "D1",
      recordId: "R1",
      pageUrl: "https://www.dianxiaomi.com/web/smt/edit?id=D1",
      snapshot: readySnapshot(),
    });
    expect(order.draftFingerprint).toBe(fingerprint);
    const retry = await runDxmSmtWorkflow({
      id: "dxm_smt_publish",
      params: { workOrderId: order.id, draftFingerprint: order.draftFingerprint },
      port: publishPort(dir, {
        clickPublish: async () => {
          clicks += 1;
          return { ok: true, message: "又点了", receipt: { kind: "submitted", text: "已提交" } };
        },
      }),
    });
    expect(clicks).toBe(1);
    expect(dataOf(retry).state).toBe("waiting_human");
  });
});
