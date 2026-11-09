import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { boxListFromHtml, boxSearchScript, decideBoxLookup, SMT_BOX_URL } from "../src/main/workflows/dxm-smt-box.js";
import { replayOrders } from "../src/main/workflows/dxm-smt-journal.js";
import { runDxmSmtWorkflow } from "../src/main/workflows/dxm-smt-listing.js";
import { createLiveDxmSmtPort } from "../src/main/workflows/dxm-smt-live.js";
import { tempDir } from "./dxm-smt-helpers.js";

const dirName = dirname(fileURLToPath(import.meta.url));
const emptyHtml = readFileSync(join(dirName, "fixtures", "dxm-smt-box-vxe-empty.html"), "utf8");
const rowsHtml = readFileSync(join(dirName, "fixtures", "dxm-smt-box-vxe-rows.html"), "utf8");
const crawlUrl = "https://www.dianxiaomi.com/web/productCrawl/edit?id=sample-record";
const secret = /PetLifeGlobal|Charmify|zuhae|sibae|nicae|挂腰风扇|167842582613033710/;

const twoRows = [
  { title: "示例夹子风扇草稿", productId: "1000001" },
  { title: "示例另一草稿", productId: "1000002" },
];

function liveSurface(over: Record<string, unknown> = {}) {
  return {
    tabId: "edit",
    isPaused: () => false,
    journalDir: tempDir(),
    getUrl: (tabId?: string) => (tabId === "box-tab" ? SMT_BOX_URL : crawlUrl),
    listTabs: () => [{ id: "edit", url: crawlUrl }],
    execute: async () => ({ ok: true, data: { result: {} } }),
    navigate: async () => ({ ok: true }),
    openTab: async () => "box-tab",
    closeTab: async () => undefined,
    ...over,
  };
}

describe("R7 判重真读采集箱", () => {
  it("采集箱 0 行视为没有同源草稿", () => {
    expect(emptyHtml).not.toMatch(secret);
    expect(rowsHtml).not.toMatch(secret);
    const parsed = boxListFromHtml(emptyHtml);
    expect(parsed.loaded).toBe(true);
    expect(parsed.rows).toEqual([]);
    expect(decideBoxLookup({ loaded: true, rows: parsed.rows, title: "示例夹子风扇草稿" }).status).toBe("absent");
    expect(boxListFromHtml(rowsHtml).rows).toEqual(twoRows);
  });

  it("有草稿但标题精确搜索没有对上时，判重通过", async () => {
    const navigated: string[] = [];
    const searches: string[] = [];
    let phase = "list";
    const port = createLiveDxmSmtPort(liveSurface({
      journalDir: tempDir(),
      navigate: async (url: string, tabId: string) => {
        navigated.push(`${tabId} ${url}`);
        phase = "url";
        return { ok: true };
      },
      execute: async (script: string, tabId?: string) => {
        if (script.includes("sparo-box-search")) {
          searches.push(tabId || "");
          expect(script).not.toMatch(/创建产品|批量操作|快捷操作|保存并认领/);
          phase = "clicked";
          return { ok: true, data: { result: { clicked: true } } };
        }
        const searchValue = phase === "clicked" ? "不存在的标题" : "";
        return { ok: true, data: { result: { marker: "sparo-box-list", loaded: true, rows: twoRows, searchValue } } };
      },
    }));
    const result = await port.lookupDraft?.({
      recordId: "sample-record",
      shopId: "9001",
      tabId: "edit",
      title: "不存在的标题",
    });
    expect(result?.status).toBe("absent");
    expect(navigated).toEqual([`box-tab ${SMT_BOX_URL}?title=${encodeURIComponent("不存在的标题")}`]);
    expect(searches).toEqual(["box-tab"]);
    expect(boxSearchScript("不存在的标题")).toContain("sparo-box-search");
  });

  it("标题精确对上就停等人确认，不记成已找到", async () => {
    let reads = 0;
    const searches: string[] = [];
    const port = createLiveDxmSmtPort(liveSurface({
      execute: async (script: string, tabId?: string) => {
        if (script.includes("sparo-box-search")) {
          searches.push(tabId || "");
          return { ok: true, data: { result: { clicked: true } } };
        }
        reads += 1;
        if (reads === 1) {
          return { ok: true, data: { result: { marker: "sparo-box-list", loaded: true, rows: twoRows, searchValue: "" } } };
        }
        return {
          ok: true,
          data: { result: { marker: "sparo-box-list", loaded: true, rows: [twoRows[0]], searchValue: "示例夹子风扇草稿" } },
        };
      },
    }));
    const result = await port.lookupDraft?.({
      recordId: "sample-record",
      shopId: "9001",
      tabId: "edit",
      title: "示例夹子风扇草稿",
    });
    expect(result?.status).toBe("ambiguous");
    expect(result?.status).not.toBe("found");
    expect(result?.reason).toContain("标题精确匹配 1 条");
    expect(searches).toEqual([]);
  });

  it("编辑页读不到标题时停等，并说明原因", async () => {
    const closed: string[] = [];
    const port = createLiveDxmSmtPort(liveSurface({
      closeTab: async (tabId: string) => {
        closed.push(tabId);
      },
      execute: async () => ({
        ok: true,
        data: { result: { marker: "sparo-box-list", loaded: true, rows: twoRows, searchValue: "" } },
      }),
    }));
    const result = await port.lookupDraft?.({
      recordId: "sample-record",
      shopId: "9001",
      tabId: "edit",
      title: "",
    });
    expect(result?.status).toBe("unknown");
    expect(result?.reason).toBe("编辑页读不到标题，无法判重");
    expect(closed).toEqual(["box-tab"]);
  });

  it("当前标签是采集编辑页时，判重另开标签，不导航编辑页", async () => {
    const navigated: string[] = [];
    const opened: string[] = [];
    const closed: string[] = [];
    const executed: string[] = [];
    const port = createLiveDxmSmtPort(liveSurface({
      navigate: async (url: string, tabId: string) => {
        navigated.push(`${tabId} ${url}`);
        return { ok: true };
      },
      openTab: async (url: string) => {
        opened.push(url);
        return "box-tab";
      },
      closeTab: async (tabId: string) => {
        closed.push(tabId);
      },
      execute: async (script: string, tabId?: string) => {
        executed.push(tabId || "");
        expect(script).toContain("sparo-box-list");
        return { ok: true, data: { result: { marker: "sparo-box-list", loaded: true, emptyRendered: true, rows: [], searchValue: "" } } };
      },
    }));
    const result = await port.lookupDraft?.({
      recordId: "sample-record",
      shopId: "9001",
      tabId: "edit",
      title: "示例夹子风扇草稿",
    });
    expect(result?.status).toBe("absent");
    expect(opened).toEqual([SMT_BOX_URL]);
    expect(closed).toEqual(["box-tab"]);
    expect(navigated).toEqual([]);
    expect(executed).toEqual(["box-tab", "box-tab", "box-tab"]);
  });

  it("判重通过后点一次保存并认领，弹窗没打开就不点确定", async () => {
    const dir = tempDir();
    const scripts: string[] = [];
    const port = createLiveDxmSmtPort({
      tabId: "edit",
      isPaused: () => false,
      journalDir: dir,
      getUrl: () => crawlUrl,
      listTabs: () => [{ id: "edit", url: crawlUrl }],
      openTab: async () => "box-tab",
      closeTab: async () => undefined,
      navigate: async () => ({ ok: true }),
      execute: async (script: string) => {
        scripts.push(script);
        if (script.includes("sparo-box-list")) {
          return { ok: true, data: { result: { marker: "sparo-box-list", loaded: true, emptyRendered: true, rows: [], searchValue: "" } } };
        }
        if (script.includes("请填写标题")) {
          return { ok: true, data: { result: { title: "示例夹子风扇草稿", rows: [], hasVariant: true } } };
        }
        return {
          ok: true,
          data: {
            result: {
              href: crawlUrl,
              title: "采集编辑",
              text: "变种信息",
              loaded: true,
              products: ["sample-record"],
              shops: [{ id: "9001", name: "示例店铺A" }],
              recordId: "sample-record",
              urlId: "sample-record",
              draftId: "",
              missing: "",
              online: [],
            },
          },
        };
      },
    });
    const result = await runDxmSmtWorkflow({
      id: "dxm_smt_prepare",
      params: { shopName: "示例店铺A", claimConsent: "认领这条" },
      port,
    });
    expect(String(result.message)).toContain("保存并认领");
    expect(String(result.message)).not.toContain("无法判重");
    expect(scripts.filter((script) => script.includes("sparo-claim-open"))).toHaveLength(1);
    expect(scripts.some((script) => script.includes("sparo-claim-confirm"))).toBe(false);
    expect(replayOrders(dir)[0]?.claimedDraftId).toBeUndefined();
  });

  it("认领、保存、发布和写字段仍然拒绝", async () => {
    const port = createLiveDxmSmtPort(liveSurface());
    const claim = await port.claim({ tabId: "edit", recordId: "sample-record", shopId: "9001" });
    const save = await port.saveDraft("edit");
    const publish = await port.clickPublish("edit");
    const write = await port.writeField("edit", "title", "示例");
    expect(claim.ok).toBe(false);
    expect(save.ok).toBe(false);
    expect(publish.ok).toBe(false);
    expect(write.ok).toBe(false);
    expect(publish.message).toMatch(/停等|不会点击/);
  });
});
