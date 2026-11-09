import { afterEach, describe, expect, it } from "vitest";
import { fingerprintFromSnapshot } from "../src/main/workflows/dxm-smt-fingerprint.js";
import { skuContinuityIssues } from "../src/main/workflows/dxm-smt-fields.js";
import { loadOrder, replayOrders } from "../src/main/workflows/dxm-smt-journal.js";
import { beginPaidConfirmRun, issuePaidConfirm, resetPaidConfirms } from "../src/main/workflows/dxm-smt-images.js";
import { resetDxmSmtRuntime, runDxmSmtWorkflow } from "../src/main/workflows/dxm-smt-listing.js";
import type { DxmSmtPort } from "../src/main/workflows/dxm-smt-listing.js";
import { evaluateQa } from "../src/main/workflows/dxm-smt-qa.js";
import { basePort, editProbe, readySnapshot, seedReady, tempDir } from "./dxm-smt-helpers.js";

afterEach(() => {
  resetDxmSmtRuntime();
  resetPaidConfirms();
});

function dataOf(result: { data?: unknown }): Record<string, unknown> {
  return (result.data || {}) as Record<string, unknown>;
}

function qaResult(result: { data?: unknown }): string {
  return String((dataOf(result).qa as { result?: string } | undefined)?.result || "");
}

describe("R3-1 同身份只能有一张未关单", () => {
  it("当前页不传来源和店铺，并发只认领一次", async () => {
    const dir = tempDir();
    let claims = 0;
    let entered = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = () => runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { claimConsent: "认领" },
      port: basePort(dir, {
        readProbe: async () => ({ ...editProbe(), draftId: undefined }),
        hold: async () => {
          entered += 1;
          await gate;
        },
        lookupDraft: async () => ({ status: "absent" }),
        claim: async () => {
          claims += 1;
          return { ok: true, draftId: "D1", shopId: "S1", recordId: "R1", message: "已认领" };
        },
      }),
    });
    const left = run();
    const right = run();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(entered).toBe(1);
    release();
    await Promise.all([left, right]);
    expect(claims).toBe(1);
    expect(replayOrders(dir).filter((order) => order.state !== "published_online")).toHaveLength(1);
  });

  it("两个新工作单号同一来源同一店铺，只建一单并只认领一次", async () => {
    const dir = tempDir();
    let claims = 0;
    let entered = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = (workOrderId: string) => runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { workOrderId, sourceRecordId: "R1", shopId: "S1", shopName: "店铺甲", claimConsent: "认领" },
      port: basePort(dir, {
        readProbe: async () => ({ ...editProbe(), draftId: undefined }),
        hold: async () => {
          entered += 1;
          await gate;
        },
        lookupDraft: async () => ({ status: "absent" }),
        claim: async () => {
          claims += 1;
          return { ok: true, draftId: "D1", shopId: "S1", recordId: "R1", message: "已认领" };
        },
      }),
    });
    const left = run("wo-a");
    const right = run("wo-b");
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(entered).toBe(1);
    release();
    await Promise.all([left, right]);
    expect(claims).toBe(1);
    const open = replayOrders(dir).filter((order) => order.state !== "published_online");
    expect(open).toHaveLength(1);
    expect(open[0]?.claimedDraftId).toBe("D1");
  });
});

describe("R3-2 草稿必须同时对上草稿号、店铺和来源", () => {
  it("当前草稿是别的店时不写字段也不翻译", async () => {
    const dir = tempDir();
    let writes = 0;
    let texts = 0;
    const result = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { sourceRecordId: "R1", shopId: "S1", shopName: "店铺甲" },
      port: basePort(dir, {
        readProbe: async () => ({
          ...editProbe(),
          draftId: "D1",
          draftShopId: "S2",
          shops: [{ id: "S1", name: "店铺甲" }, { id: "S2", name: "店铺乙" }],
        }),
        writeField: async () => {
          writes += 1;
          return { ok: true, readback: "不该写" };
        },
        translateText: async () => {
          texts += 1;
          return { ok: true, verified: true };
        },
      }),
    });
    expect(writes).toBe(0);
    expect(texts).toBe(0);
    expect(dataOf(result).state).toBe("waiting_human");
    expect(replayOrders(dir)[0]?.claimedDraftId).toBeUndefined();
    expect(String(result.message)).toMatch(/店铺|来源/);
  });

  it("查到的草稿缺店铺或缺来源时不认领", async () => {
    const dir = tempDir();
    let claims = 0;
    const result = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { sourceRecordId: "R1", shopId: "S1" },
      port: basePort(dir, {
        readProbe: async () => ({ ...editProbe(), draftId: undefined }),
        lookupDraft: async () => ({ status: "found", draftId: "D1" }),
        claim: async () => {
          claims += 1;
          return { ok: true, draftId: "D-bad", shopId: "S1", recordId: "R1", message: "不应认领" };
        },
      }),
    });
    expect(claims).toBe(0);
    expect(dataOf(result).state).toBe("waiting_human");
    expect(replayOrders(dir)[0]?.claimedDraftId).toBeUndefined();
    expect(String(result.message)).toMatch(/缺少/);
  });
});

describe("R3-3 翻译后 SKU 不能变空或丢关键值", () => {
  it("原本有 SKU，读回为空、丢规格、丢价格或丢库存都不能通过，也不能发布", async () => {
    expect(skuContinuityIssues([], [])).toEqual([]);
    const before = readySnapshot().skus;
    expect(skuContinuityIssues(before, [])).toContain("SKU 读回为空");
    expect(skuContinuityIssues(before, [{ specs: { 颜色: "蓝" }, price: "10", stock: "5" }])).toContain("规格丢失");
    expect(skuContinuityIssues(before, [{ specs: { 颜色: "红" }, price: "", stock: "5" }])).toContain("价格变化");
    expect(skuContinuityIssues(before, [{ specs: { 颜色: "红" }, price: "10", stock: "" }])).toContain("库存变化");
    const blocked = evaluateQa({
      identityOk: true,
      fields: readySnapshot().fields,
      images: readySnapshot().images,
      missing: [],
      skuProblems: ["SKU 读回为空"],
    });
    expect(blocked.result).not.toBe("pass");
    expect(blocked.missing.some((item) => item.field === "SKU")).toBe(true);

    const dir = tempDir();
    const order = seedReady(dir);
    let reads = 0;
    let clicks = 0;
    const emptied = readySnapshot();
    emptied.skus = [];
    const port = (): DxmSmtPort => basePort(dir, {
      readFields: async () => {
        reads += 1;
        return reads === 1 ? readySnapshot() : emptied;
      },
      clickPublish: async () => {
        clicks += 1;
        return { ok: true, message: "不应发布", receipt: { kind: "submitted", text: "已提交" } };
      },
    });
    const prepared = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { workOrderId: order.id },
      port: port(),
    });
    expect(qaResult(prepared)).not.toBe("pass");
    expect(dataOf(prepared).state).toBe("waiting_human");
    expect(String(prepared.message)).toMatch(/SKU/);
    await runDxmSmtWorkflow({
      id: "dxm_smt_publish",
      params: { workOrderId: order.id, draftFingerprint: String(dataOf(prepared).draftFingerprint || "missing") },
      port: port(),
    });
    expect(clicks).toBe(0);
  });
});

describe("R3-4 最新读回决定值和验证状态", () => {
  it("旧字段未验证，最新读回已验证时 QA 通过并采用新值", async () => {
    const dir = tempDir();
    const order = seedReady(dir);
    let reads = 0;
    const stale = readySnapshot();
    stale.fields = stale.fields.map((field) => field.key === "title" ? { ...field, value: "OLD", verified: false } : field);
    stale.title = "OLD";
    const live = readySnapshot();
    live.title = "NEW TITLE";
    live.fields = live.fields.map((field) => field.key === "title" ? { ...field, value: "NEW TITLE", verified: true } : field);
    const result = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { workOrderId: order.id },
      port: basePort(dir, {
        readFields: async () => {
          reads += 1;
          return reads === 1 ? stale : live;
        },
      }),
    });
    expect(qaResult(result)).toBe("pass");
    expect(dataOf(result).state).toBe("draft_ready");
    const saved = loadOrder(dir, order.id);
    expect(saved?.fields.title?.value).toBe("NEW TITLE");
    expect(saved?.fields.title?.verified).toBe(true);
    const fresh = fingerprintFromSnapshot({
      shopId: "S1",
      shopName: "店铺甲",
      title: "NEW TITLE",
      categoryId: live.categoryId,
      draftId: "D1",
      recordId: "R1",
      pageUrl: editProbe().url,
      snapshot: live,
    });
    expect(dataOf(result).draftFingerprint).toBe(fresh);
  });
});

describe("R3-5 收费确认显式带图片组和 src 摘要", () => {
  it("变种图和描述图带 group 与 src 摘要才执行，缺组或组不一致不执行", async () => {
    const dir = tempDir();
    const order = seedReady(dir);
    let seen: string[] = [];
    const port = (): DxmSmtPort => basePort(dir, {
      quotedFee: "1元",
      translateImages: async (_tab, group) => {
        seen.push(group);
        return { ok: true, verified: true };
      },
    });
    issuePaidConfirm({
      confirmId: "variant-1",
      workOrderId: order.id,
      feature: "图片翻译",
      group: "variant",
      scope: "v1.jpg",
      fee: "1元",
    });
    beginPaidConfirmRun();
    await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: {
        workOrderId: order.id,
        paidConsent: { confirmId: "variant-1", feature: "图片翻译", group: "variant", srcDigest: "v1.jpg", fee: "1元" },
      },
      port: port(),
    });
    expect(seen).toEqual(["variant"]);

    resetPaidConfirms();
    resetDxmSmtRuntime();
    seen = [];
    issuePaidConfirm({
      confirmId: "desc-1",
      workOrderId: order.id,
      feature: "图片白底",
      group: "description",
      scope: "d1.jpg",
      fee: "1元",
    });
    beginPaidConfirmRun();
    await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: {
        workOrderId: order.id,
        paidConsent: { confirmId: "desc-1", feature: "图片白底", group: "description", srcDigest: "d1.jpg", fee: "1元" },
      },
      port: port(),
    });
    expect(seen).toEqual(["description"]);

    resetPaidConfirms();
    resetDxmSmtRuntime();
    seen = [];
    issuePaidConfirm({
      confirmId: "mismatch",
      workOrderId: order.id,
      feature: "图片翻译",
      group: "main",
      scope: "v1.jpg",
      fee: "1元",
    });
    beginPaidConfirmRun();
    await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: {
        workOrderId: order.id,
        paidConsent: { confirmId: "mismatch", feature: "图片翻译", group: "main", srcDigest: "v1.jpg", fee: "1元" },
      },
      port: port(),
    });
    expect(seen).toEqual([]);

    resetPaidConfirms();
    resetDxmSmtRuntime();
    seen = [];
    issuePaidConfirm({
      confirmId: "bare-src",
      workOrderId: order.id,
      feature: "图片翻译",
      group: "variant",
      scope: "v1.jpg",
      fee: "1元",
    });
    beginPaidConfirmRun();
    await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: {
        workOrderId: order.id,
        paidConsent: { confirmId: "bare-src", feature: "图片翻译", scope: "v1.jpg", fee: "1元" },
      },
      port: port(),
    });
    expect(seen).toEqual([]);
  });
});

describe("R3-6 查重异常落断点", () => {
  it("lookupDraft 拒绝或超时时停等，不认领，并留下原因", async () => {
    for (const failure of [
      { run: () => Promise.reject(new Error("timeout")), reason: /timeout/ },
      { run: () => Promise.reject("lookup-down"), reason: /lookup-down/ },
    ]) {
      resetDxmSmtRuntime();
      const dir = tempDir();
      let claims = 0;
      const result = await runDxmSmtWorkflow({
        id: "dxm_smt_prepare",
        params: { sourceRecordId: "R1", shopId: "S1" },
        port: basePort(dir, {
          readProbe: async () => ({ ...editProbe(), draftId: undefined }),
          lookupDraft: failure.run,
          claim: async () => {
            claims += 1;
            return { ok: true, draftId: "D1", shopId: "S1", recordId: "R1", message: "不应认领" };
          },
        }),
      });
      expect(claims).toBe(0);
      expect(dataOf(result).state).toBe("waiting_human");
      const checkpoint = dataOf(result).checkpoint as { reason?: string; nextAction?: string; reliableState?: string } | undefined;
      expect(checkpoint?.reliableState).toBeTruthy();
      expect(checkpoint?.nextAction).toBeTruthy();
      expect(String(checkpoint?.reason || "")).toMatch(failure.reason);
      expect(loadOrder(dir, String(dataOf(result).workOrderId))?.state).toBe("waiting_human");
    }
  });
});

describe("R3 复审：探针失败不能无锁建单", () => {
  it("首次探针失败、随后恢复时，并发请求不建单也不认领", async () => {
    const dir = tempDir();
    let reads = 0;
    let claims = 0;
    const run = (workOrderId: string) => runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { workOrderId },
      port: basePort(dir, {
        readProbe: async () => {
          reads += 1;
          if (reads <= 2) throw new Error("probe down");
          return { ...editProbe(), draftId: undefined };
        },
        lookupDraft: async () => ({ status: "absent" }),
        claim: async () => {
          claims += 1;
          return { ok: true, draftId: "D1", shopId: "S1", recordId: "R1", message: "不应认领" };
        },
      }),
    });
    const [left, right] = await Promise.all([run("wo-a"), run("wo-b")]);
    expect(claims).toBe(0);
    expect(replayOrders(dir)).toHaveLength(0);
    expect(dataOf(left).state).toBe("waiting_human");
    expect(dataOf(right).state).toBe("waiting_human");
    expect(`${left.message}\n${right.message}`).toMatch(/探针失败/);
  });

  it("身份不完整时停等，不建单", async () => {
    const dir = tempDir();
    let claims = 0;
    const result = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: {},
      port: basePort(dir, {
        readProbe: async () => ({
          ...editProbe(),
          draftId: undefined,
          shops: [{ id: "S1", name: "店铺甲" }, { id: "S2", name: "店铺乙" }],
        }),
        claim: async () => {
          claims += 1;
          return { ok: true, draftId: "D1", shopId: "S1", recordId: "R1", message: "不应认领" };
        },
      }),
    });
    expect(claims).toBe(0);
    expect(replayOrders(dir)).toHaveLength(0);
    expect(dataOf(result).state).toBe("waiting_human");
  });
});

describe("R3 复审：已认领草稿必须由当前页读回", () => {
  it("页面没有草稿号时，不用工作单里的身份继续写和翻译", async () => {
    const dir = tempDir();
    const order = seedReady(dir);
    let writes = 0;
    let texts = 0;
    const result = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { workOrderId: order.id },
      port: basePort(dir, {
        readProbe: async () => ({ ...editProbe(), draftId: undefined }),
        writeField: async () => {
          writes += 1;
          return { ok: true, readback: "不该写" };
        },
        translateText: async () => {
          texts += 1;
          return { ok: true, verified: true };
        },
      }),
    });
    expect(writes).toBe(0);
    expect(texts).toBe(0);
    expect(dataOf(result).state).toBe("waiting_human");
    expect(String(result.message)).toMatch(/读回/);
    expect(loadOrder(dir, order.id)?.claimedDraftId).toBe("D1");
  });
});

describe("R3 复审：SKU 改值和新增行不能通过", () => {
  it("价格库存被改掉或新增一行时 QA 不通过，发布点击数为 0", async () => {
    const before = readySnapshot().skus;
    expect(skuContinuityIssues(before, [{ specs: { 颜色: "红" }, price: "999", stock: "0" }])).toEqual(["价格变化", "库存变化"]);
    expect(skuContinuityIssues(before, [
      { specs: { 颜色: "红" }, price: "10", stock: "5" },
      { specs: { 颜色: "蓝" }, price: "8", stock: "1" },
    ])).toContain("新增 SKU 行");

    const dir = tempDir();
    const order = seedReady(dir);
    let reads = 0;
    let clicks = 0;
    const changed = readySnapshot();
    changed.skus = [{ specs: { 颜色: "红" }, price: "999", stock: "0" }];
    const added = readySnapshot();
    added.skus = [
      { specs: { 颜色: "红" }, price: "10", stock: "5" },
      { specs: { 颜色: "蓝" }, price: "8", stock: "1" },
    ];
    const port = (snap: ReturnType<typeof readySnapshot>): DxmSmtPort => basePort(dir, {
      readFields: async () => {
        reads += 1;
        return reads === 1 ? readySnapshot() : snap;
      },
      clickPublish: async () => {
        clicks += 1;
        return { ok: true, message: "不应发布", receipt: { kind: "submitted", text: "已提交" } };
      },
    });
    const priced = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { workOrderId: order.id },
      port: port(changed),
    });
    expect(qaResult(priced)).not.toBe("pass");
    await runDxmSmtWorkflow({
      id: "dxm_smt_publish",
      params: { workOrderId: order.id, draftFingerprint: String(dataOf(priced).draftFingerprint || "missing") },
      port: port(changed),
    });
    expect(clicks).toBe(0);

    const dir2 = tempDir();
    const order2 = seedReady(dir2);
    reads = 0;
    const extra = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { workOrderId: order2.id },
      port: basePort(dir2, {
        readFields: async () => {
          reads += 1;
          return reads === 1 ? readySnapshot() : added;
        },
        clickPublish: async () => {
          clicks += 1;
          return { ok: true, message: "不应发布", receipt: { kind: "submitted", text: "已提交" } };
        },
      }),
    });
    expect(qaResult(extra)).not.toBe("pass");
    expect(String(extra.message)).toMatch(/SKU/);
    expect(clicks).toBe(0);
  });
});
