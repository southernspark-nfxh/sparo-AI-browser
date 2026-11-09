import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SMT_BOX_URL } from "../src/main/workflows/dxm-smt-box.js";
import {
  CLICK_CLAIM_CONFIRM_SCRIPT,
  CLICK_SAVE_AND_CLAIM_SCRIPT,
  READ_CLAIM_DIALOG_SCRIPT,
  planClaim,
  readClaimDialogFromHtml,
} from "../src/main/workflows/dxm-smt-claim.js";
import { replayOrders } from "../src/main/workflows/dxm-smt-journal.js";
import { runDxmSmtWorkflow } from "../src/main/workflows/dxm-smt-listing.js";
import { createLiveDxmSmtPort } from "../src/main/workflows/dxm-smt-live.js";
import { basePort, editProbe, tempDir } from "./dxm-smt-helpers.js";

const dirName = dirname(fileURLToPath(import.meta.url));
const dialogHtml = readFileSync(join(dirName, "fixtures", "dxm-smt-claim-dialog.html"), "utf8");
const crawlUrl = "https://www.dianxiaomi.com/web/productCrawl/edit?id=sample-record";
const secret = /PetLifeGlobal|Charmify|zuhae|sibae|nicae|挂腰风扇|167842582613033710|7107102/;

describe("R9B 判重激活和 live 认领", () => {
  it("判重先激活采集箱标签，读完关掉并回到原来的标签", async () => {
    const order: string[] = [];
    const port = createLiveDxmSmtPort({
      tabId: "edit",
      isPaused: () => false,
      journalDir: tempDir(),
      getUrl: () => crawlUrl,
      listTabs: () => [{ id: "edit", url: crawlUrl }, { id: "box-tab", url: SMT_BOX_URL }],
      openTab: async () => "box-tab",
      activateTab: (id) => order.push(`activate:${id}`),
      getActiveTabId: () => "edit",
      hasTab: (id) => id === "edit" || id === "box-tab",
      closeTab: (id) => order.push(`close:${id}`),
      navigate: async () => ({ ok: true }),
      execute: async (script) => {
        if (script.includes("sparo-box-list")) {
          order.push("read");
          return { ok: true, data: { result: { loaded: true, emptyRendered: true, rows: [], searchValue: "" } } };
        }
        return { ok: true, data: { result: {} } };
      },
    });
    const result = await port.lookupDraft?.({ recordId: "sample-record", shopId: "S1", tabId: "edit", title: "示例夹子风扇草稿" });
    expect(result?.status).toBe("absent");
    expect(order).toEqual(["activate:box-tab", "read", "read", "read", "close:box-tab", "activate:edit"]);
  });

  it("原标签已经不在时，关掉采集箱后不再切回去", async () => {
    const activated: string[] = [];
    const port = createLiveDxmSmtPort({
      tabId: "edit",
      isPaused: () => false,
      journalDir: tempDir(),
      getUrl: () => crawlUrl,
      listTabs: () => [],
      openTab: async () => "box-tab",
      activateTab: (id) => activated.push(id),
      getActiveTabId: () => "edit-gone",
      hasTab: (id) => id === "box-tab",
      closeTab: () => undefined,
      execute: async () => ({ ok: true, data: { result: { loaded: true, emptyRendered: true, rows: [], searchValue: "" } } }),
    });
    const result = await port.lookupDraft?.({ recordId: "sample-record", shopId: "S1", tabId: "edit" });
    expect(result?.status).toBe("absent");
    expect(activated).toEqual(["box-tab"]);
  });

  it("采集箱标签被关掉时停等，不抛异常", async () => {
    const port = createLiveDxmSmtPort({
      tabId: "edit",
      isPaused: () => false,
      journalDir: tempDir(),
      getUrl: () => crawlUrl,
      listTabs: () => [],
      openTab: async () => "box-tab",
      activateTab: () => undefined,
      getActiveTabId: () => "edit",
      hasTab: () => false,
      closeTab: () => undefined,
      execute: async () => {
        throw new Error("tab-gone");
      },
    });
    const result = await port.lookupDraft?.({ recordId: "sample-record", shopId: "S1", tabId: "edit", title: "示例" });
    expect(result?.status).toBe("unknown");
    expect(result?.reason).toContain("没有加载出来");
  });

  it("可见店铺唯一命中时只点保存并认领、该店和确定，并读回三证", async () => {
    expect(dialogHtml).not.toMatch(secret);
    const clicks: string[] = [];
    const port = createLiveDxmSmtPort({
      tabId: "edit",
      isPaused: () => false,
      journalDir: tempDir(),
      getUrl: () => crawlUrl,
      listTabs: () => [{ id: "edit", url: crawlUrl }],
      execute: async (script) => {
        if (script.includes("sparo-claim-open")) {
          clicks.push("保存并认领");
          return { ok: true, data: { result: { clicked: true } } };
        }
        if (script.includes("sparo-claim-shop")) {
          clicks.push("示例店铺A");
          return { ok: true, data: { result: { clicked: true } } };
        }
        if (script.includes("sparo-claim-confirm")) {
          clicks.push("确定");
          return { ok: true, data: { result: { clicked: true } } };
        }
        if (script.includes("sparo-claim-proof")) {
          return { ok: true, data: { result: { dialogOpen: false, draftId: "D1", shopId: "S1", recordId: "sample-record" } } };
        }
        return {
          ok: true,
          data: {
            result: {
              opened: true,
              title: "选择店铺-认领到采集箱",
              options: [
                { name: "示例店铺A", shopId: "", selected: false },
                { name: "示例店铺B", shopId: "", selected: false },
              ],
              confirmPresent: true,
              confirmText: "确定",
              cancelText: "关闭",
            },
          },
        };
      },
    });
    const claimed = await port.claim({ tabId: "edit", shopId: "S1", shopName: "示例店铺A", recordId: "sample-record" });
    expect(claimed.ok).toBe(true);
    expect(claimed.draftId).toBe("D1");
    expect(claimed.shopId).toBe("S1");
    expect(claimed.recordId).toBe("sample-record");
    expect(clicks).toEqual(["保存并认领", "示例店铺A", "确定"]);
  });

  it("目标店以外还有可见勾选时不点确定", async () => {
    const clicks: string[] = [];
    const port = createLiveDxmSmtPort({
      tabId: "edit",
      isPaused: () => false,
      journalDir: tempDir(),
      getUrl: () => crawlUrl,
      listTabs: () => [],
      execute: async (script) => {
        if (script.includes("sparo-claim-open")) {
          clicks.push("保存并认领");
          return { ok: true, data: { result: { clicked: true } } };
        }
        if (script.includes("sparo-claim-confirm")) {
          clicks.push("确定");
          return { ok: true, data: { result: { clicked: true } } };
        }
        return {
          ok: true,
          data: {
            result: {
              opened: true,
              options: [
                { name: "示例店铺A", shopId: "", selected: true },
                { name: "示例店铺B", shopId: "", selected: true },
              ],
              confirmPresent: true,
              confirmText: "确定",
              cancelText: "关闭",
            },
          },
        };
      },
    });
    const claimed = await port.claim({ tabId: "edit", shopName: "示例店铺A", recordId: "sample-record" });
    expect(claimed.ok).toBe(false);
    expect(claimed.message).toContain("其他店铺被勾选");
    expect(clicks).not.toContain("确定");
  });

  it("脚本找确定和关闭，不再找确认或取消", () => {
    const joined = `${READ_CLAIM_DIALOG_SCRIPT}\n${CLICK_SAVE_AND_CLAIM_SCRIPT}\n${CLICK_CLAIM_CONFIRM_SCRIPT}`;
    expect(joined).toContain("确定");
    expect(joined).toContain("关闭");
    expect(joined).not.toContain("确认");
    expect(joined).not.toContain("取消");
  });

  it("隐藏的默认勾选不造成其他店铺被勾选", () => {
    const read = readClaimDialogFromHtml(dialogHtml);
    expect(read.options.map((item) => item.name)).toEqual(["示例店铺A", "示例店铺B"]);
    expect(read.cancelText).toBe("关闭");
    expect(read.confirmText).toBe("确定");
    const plan = planClaim(read, { shopName: "示例店铺A" });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.clicks).toEqual(["保存并认领", "示例店铺A", "确定"]);
    expect(plan.reason).toBeUndefined();
  });

  it("没有认领原话仍零调用，写翻译保存发布选分类仍拒绝，落点检查仍在", async () => {
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
        listTabs: async () => [{ id: "edit-1", url: crawlUrl }],
        claim: async () => ({ ok: true, draftId: "D9", shopId: "S1", recordId: "R1", message: "已点确定" }),
      }),
    });
    expect(String(parked.message)).toContain("没有进入草稿编辑页");
    expect(replayOrders(dir).at(-1)?.claimedDraftId).toBe("D9");
    const port = createLiveDxmSmtPort({
      tabId: "edit",
      isPaused: () => false,
      journalDir: tempDir(),
      getUrl: () => crawlUrl,
      listTabs: () => [],
      execute: async () => ({ ok: true, data: { result: {} } }),
    });
    expect((await port.writeField("edit", "title", "示例")).ok).toBe(false);
    expect((await port.translateText("edit")).ok).toBe(false);
    expect((await port.translateImages("edit", "main", "图片翻译")).ok).toBe(false);
    expect((await port.saveDraft("edit")).ok).toBe(false);
    expect((await port.clickPublish("edit")).ok).toBe(false);
    expect((await port.selectCategory?.("edit", "1"))?.ok).toBe(false);
  });
});
