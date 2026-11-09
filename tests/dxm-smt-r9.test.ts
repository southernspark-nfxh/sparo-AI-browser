import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assessBoxLoad,
  boxListFromHtml,
  boxPollExhausted,
  boxSearchScript,
  lookupFromLoad,
} from "../src/main/workflows/dxm-smt-box.js";
import {
  READ_CLAIM_DIALOG_SCRIPT,
  SMT_CLAIM_TEXT,
  claimSelectorsReady,
  planClaim,
} from "../src/main/workflows/dxm-smt-claim.js";
import { bindTabs, createWorkOrder } from "../src/main/workflows/dxm-smt-contract.js";
import { replayOrders, saveOrder } from "../src/main/workflows/dxm-smt-journal.js";
import { runDxmSmtWorkflow } from "../src/main/workflows/dxm-smt-listing.js";
import { createLiveDxmSmtPort } from "../src/main/workflows/dxm-smt-live.js";
import { basePort, editProbe, tempDir } from "./dxm-smt-helpers.js";

const dirName = dirname(fileURLToPath(import.meta.url));
const secret = /PetLifeGlobal|Charmify|zuhae|sibae|nicae|挂腰风扇|167842582613033710|7107102/;
const rowsHtml = readFileSync(join(dirName, "fixtures", "dxm-smt-box-vxe-rows.html"), "utf8");
const emptyHtml = readFileSync(join(dirName, "fixtures", "dxm-smt-box-vxe-empty.html"), "utf8");
const loadingHtml = readFileSync(join(dirName, "fixtures", "dxm-smt-box-vxe-loading.html"), "utf8");

function crawlProbe(recordId: string) {
  return {
    ...editProbe(),
    url: `https://www.dianxiaomi.com/web/productCrawl/edit?id=${recordId}`,
    recordId,
    productIds: [recordId],
    draftId: undefined,
    draftShopId: undefined,
    shops: [{ id: "S1", name: "店铺甲" }],
  };
}

describe("R9 判重占位态、改绑和认领复选", () => {
  it("表体已渲染且标题精确对上一条时停等，原因含 1 条", () => {
    expect(rowsHtml).not.toMatch(secret);
    const parsed = boxListFromHtml(rowsHtml);
    expect(parsed.loaded).toBe(true);
    expect(parsed.emptyRendered).toBe(false);
    expect(parsed.rows).toEqual([
      { title: "示例夹子风扇草稿", productId: "1000001" },
      { title: "示例另一草稿", productId: "1000002" },
    ]);
    expect(assessBoxLoad({ rowCount: parsed.rows.length, emptyRendered: false })).toBe("ready");
    const looked = lookupFromLoad({
      rowCount: parsed.rows.length,
      emptyRendered: false,
      rows: parsed.rows,
      title: "示例夹子风扇草稿",
    });
    expect(looked.status).toBe("ambiguous");
    expect(looked.reason).toContain("1 条");
    expect(looked.reason).toContain("请人工确认是否同源草稿");
  });

  it("行数为 0 且真空结构已渲染才是没有草稿", () => {
    expect(emptyHtml).not.toMatch(secret);
    const parsed = boxListFromHtml(emptyHtml);
    expect(parsed.loaded).toBe(true);
    expect(parsed.emptyRendered).toBe(true);
    expect(parsed.rows).toEqual([]);
    const looked = lookupFromLoad({
      rowCount: 0,
      emptyRendered: true,
      rows: parsed.rows,
      title: "示例夹子风扇草稿",
    });
    expect(looked.status).toBe("absent");
  });

  it("只有占位文本或常驻空表节点时不判 absent，轮询耗尽后说没有加载出来", () => {
    expect(loadingHtml).toContain("暂无数据");
    expect(loadingHtml).toContain("vxe-table--empty-block");
    expect(loadingHtml).not.toMatch(secret);
    const parsed = boxListFromHtml(loadingHtml);
    expect(parsed.loaded).toBe(false);
    expect(parsed.emptyRendered).toBe(false);
    expect(parsed.rows).toEqual([]);
    expect(assessBoxLoad({ rowCount: 0, emptyRendered: false })).toBe("loading");
    const looked = lookupFromLoad({ rowCount: 0, emptyRendered: false, rows: [], title: "示例夹子风扇草稿" });
    expect(looked.status).toBe("unknown");
    expect(looked.reason).toContain("没有加载出来");
    const exhausted = boxPollExhausted(["loading", "loading", "loading"]);
    expect(exhausted.status).toBe("unknown");
    expect(exhausted.reason).toContain("没有加载出来");
  });

  it("搜索框或按钮对不上时两个都不做", () => {
    const script = boxSearchScript("示例夹子风扇草稿");
    expect(script).toContain("input.ant-input");
    expect(script).toContain("inputs[0]");
    expect(script).toContain("buttons[0]");
    expect(script).toContain("filled: false, clicked: false");
    expect(script).not.toContain("vxe-input");
    expect(script).not.toContain("length - 1");
    expect(script).not.toMatch(/创建产品|保存并认领/);
  });

  it("同一来源记录的采集编辑页会改绑并落账", async () => {
    const kept = bindTabs(createWorkOrder({ tabs: { editTabId: "old-edit" } }), { editTabId: "edit-1" });
    expect(kept.tabs.editTabId).toBe("old-edit");
    const dir = tempDir();
    const order = createWorkOrder({
      id: "wo-rebind",
      source: { crawlRecordId: "sample-record" },
      target: { platform: "aliexpress", shopId: "S1", shopNameSnapshot: "店铺甲" },
      tabs: { editTabId: "old-edit" },
    });
    saveOrder(dir, order);
    let claims = 0;
    const result = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { workOrderId: order.id, sourceRecordId: "sample-record", shopId: "S1", shopName: "店铺甲", claimConsent: "认领" },
      port: basePort(dir, {
        readProbe: async () => crawlProbe("sample-record"),
        lookupDraft: async () => ({ status: "absent" }),
        claim: async () => {
          claims += 1;
          return { ok: false, blocker: "entry", message: "认领入口没有已核对标记，已停等" };
        },
      }),
    });
    const saved = replayOrders(dir).find((item) => item.id === order.id);
    expect(saved?.tabs.editTabId).toBe("edit-1");
    expect(saved?.evidence.some((item) => item.action === "tab_rebound" && JSON.stringify(item.changed).includes("同记录编辑页，改绑当前标签"))).toBe(true);
    expect(String(result.message)).not.toContain("不是工作单的编辑标签");
    expect(claims).toBe(1);
  });

  it("不同记录、非编辑页或探针失败都不改绑", async () => {
    const dir = tempDir();
    const order = createWorkOrder({
      id: "wo-keep-tab",
      source: { crawlRecordId: "sample-record" },
      target: { platform: "aliexpress", shopId: "S1", shopNameSnapshot: "店铺甲" },
      tabs: { editTabId: "old-edit" },
    });
    saveOrder(dir, order);
    const run = (readProbe: () => Promise<ReturnType<typeof crawlProbe>>) => runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { workOrderId: order.id, sourceRecordId: "sample-record", shopId: "S1", claimConsent: "认领" },
      port: basePort(dir, {
        readProbe,
        claim: async () => ({ ok: true, draftId: "D1", shopId: "S1", recordId: "sample-record", message: "不应认领" }),
      }),
    });
    const other = await run(async () => crawlProbe("other-record"));
    const notEdit = await run(async () => editProbe());
    const broken = await run(async () => {
      throw new Error("probe-down");
    });
    for (const result of [other, notEdit, broken]) {
      expect(String(result.message)).toContain("不是工作单的编辑标签");
    }
    expect(replayOrders(dir).filter((item) => item.id === order.id).every((item) => item.tabs.editTabId === "old-edit")).toBe(true);
    expect(replayOrders(dir).some((item) => item.evidence.some((entry) => entry.action === "tab_rebound"))).toBe(false);
  });

  it("没有其他勾选时，计划只点保存并认领、目标店和确定", () => {
    const plan = planClaim({
      opened: true,
      title: SMT_CLAIM_TEXT.dialogTitle,
      options: [
        { name: "示例店铺A", shopId: "9001", selected: false },
        { name: "示例店铺B", shopId: "9002", selected: false },
      ],
      selected: "",
      confirmPresent: true,
      confirmText: "确定",
      cancelText: "",
      error: "",
    }, { shopId: "9001" });
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.clicks).toEqual(["保存并认领", "示例店铺A", "确定"]);
    const already = planClaim({
      opened: true,
      title: SMT_CLAIM_TEXT.dialogTitle,
      options: [{ name: "示例店铺A", shopId: "9001", selected: true }],
      selected: "9001",
      confirmPresent: true,
      confirmText: "确定",
      cancelText: "",
      error: "",
    }, { shopId: "9001" });
    expect(already.ok).toBe(true);
    if (already.ok) expect(already.clicks).toEqual(["保存并认领", "确定"]);
  });

  it("目标店以外还有勾选时不点确定", () => {
    const plan = planClaim({
      opened: true,
      title: SMT_CLAIM_TEXT.dialogTitle,
      options: [
        { name: "示例店铺A", shopId: "9001", selected: true },
        { name: "示例店铺B", shopId: "9002", selected: true },
      ],
      selected: "9001",
      confirmPresent: true,
      confirmText: "确定",
      cancelText: "",
      error: "",
    }, { shopId: "9001" });
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.reason).toContain("其他店铺被勾选");
      expect(plan.reason).toContain("已选 2");
      expect(plan.clicks).not.toContain("确定");
    }
  });

  it("确认按钮常量是确定，只读脚本不再找确认", () => {
    expect(SMT_CLAIM_TEXT.confirm).toBe("确定");
    expect(SMT_CLAIM_TEXT.dialogTitle).toBe("选择店铺-认领到采集箱");
    expect(READ_CLAIM_DIALOG_SCRIPT).toContain("确定");
    expect(READ_CLAIM_DIALOG_SCRIPT).not.toContain("确认");
    expect(READ_CLAIM_DIALOG_SCRIPT).not.toContain(".click(");
  });

  it("没有认领原话仍零调用，写翻译保存发布选分类仍拒绝，落点检查仍在", async () => {
    expect(claimSelectorsReady()).toBe(true);
    const dir = tempDir();
    let claims = 0;
    const refused = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { sourceRecordId: "R1", shopId: "S1" },
      port: basePort(dir, {
        readProbe: async () => ({ ...editProbe(), draftId: undefined }),
        lookupDraft: async () => ({ status: "absent" }),
        claim: async () => {
          claims += 1;
          return { ok: true, draftId: "D1", shopId: "S1", recordId: "R1", message: "不应执行" };
        },
      }),
    });
    expect(claims).toBe(0);
    expect(String(refused.message)).toContain("认领需要你当场确认");
    const parked = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { sourceRecordId: "R1", shopId: "S1", claimConsent: "认领" },
      port: basePort(dir, {
        readProbe: async () => ({ ...editProbe(), draftId: undefined }),
        lookupDraft: async () => ({ status: "absent" }),
        listTabs: async () => [{ id: "edit-1", url: "https://www.dianxiaomi.com/web/productCrawl/edit?id=R1" }],
        claim: async () => ({ ok: true, draftId: "D9", shopId: "S1", recordId: "R1", message: "已点确定" }),
      }),
    });
    expect(String(parked.message)).toContain("没有进入草稿编辑页");
    expect(replayOrders(dir).at(-1)?.claimedDraftId).toBe("D9");
    const port = createLiveDxmSmtPort({
      tabId: "edit",
      isPaused: () => false,
      journalDir: tempDir(),
      getUrl: () => "https://www.dianxiaomi.com/web/productCrawl/edit?id=sample-record",
      listTabs: () => [],
      execute: async () => ({ ok: true, data: { result: {} } }),
    });
    expect((await port.claim({ tabId: "edit", shopId: "9001" })).ok).toBe(false);
    expect((await port.writeField("edit", "title", "示例")).ok).toBe(false);
    expect((await port.translateText("edit")).ok).toBe(false);
    expect((await port.translateImages("edit", "main", "图片翻译")).ok).toBe(false);
    expect((await port.saveDraft("edit")).ok).toBe(false);
    expect((await port.clickPublish("edit")).ok).toBe(false);
    expect((await port.selectCategory?.("edit", "1"))?.ok).toBe(false);
  });
});
