import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createLiveDxmSmtPort } from "../src/main/workflows/dxm-smt-live.js";
import { tempDir } from "./dxm-smt-helpers.js";

const dirName = dirname(fileURLToPath(import.meta.url));
const crawlUrl = "https://www.dianxiaomi.com/web/productCrawl/edit?id=sample-record";
const otherUrl = "https://example.com/web/productCrawl/edit?id=sample-record";
const wanted = "示例夹子风扇草稿";
const secret = /PetLifeGlobal|Charmify|zuhae|sibae|nicae|挂腰风扇|167842582613033710|7107102/;

function apiResult(json: unknown, status = 200, ok = status === 200) {
  return { ok: true, data: { result: { status, ok, json } } };
}

function pageJson(total: number, subjects: string[], searchValue: string) {
  return {
    code: 0,
    data: {
      page: {
        list: subjects.map((subject) => ({ subject, productId: null })),
        totalSize: total,
        pageNo: 1,
        pageSize: 100,
        totalPage: 1,
      },
      productParam: { searchValue },
    },
  };
}

function emptyBox() {
  return { ok: true, data: { result: { loaded: true, emptyRendered: true, rows: [], searchValue: "" } } };
}

describe("R11 Part B 接口判重与页面降级", () => {
  it("接口判没有草稿时不打开标签", async () => {
    const counts = { open: 0, activate: 0, navigate: 0, close: 0 };
    const scripts: string[] = [];
    const port = createLiveDxmSmtPort({
      tabId: "edit",
      isPaused: () => false,
      journalDir: tempDir(),
      getUrl: () => crawlUrl,
      listTabs: () => [{ id: "edit", url: crawlUrl }],
      openTab: async () => {
        counts.open += 1;
        return "box-tab";
      },
      activateTab: () => {
        counts.activate += 1;
      },
      navigate: async () => {
        counts.navigate += 1;
        return { ok: true };
      },
      closeTab: () => {
        counts.close += 1;
      },
      execute: async (script) => {
        scripts.push(script);
        expect(script).toContain("pageList.json");
        expect(script).toContain("shopId=-1");
        expect(script).not.toContain("9001");
        return apiResult(pageJson(0, [], wanted));
      },
    });
    const result = await port.lookupDraft?.({
      recordId: "sample-record",
      shopId: "9001",
      tabId: "edit",
      title: `  ${wanted}  `,
    });
    expect(result?.status).toBe("absent");
    expect(JSON.parse(JSON.stringify(result)).source).toBe("api");
    expect(counts).toEqual({ open: 0, activate: 0, navigate: 0, close: 0 });
    expect(scripts).toHaveLength(1);
    expect(JSON.stringify(scripts)).not.toMatch(secret);
  });

  it("接口标题精确命中时停 ambiguous，仍不打开标签", async () => {
    const counts = { open: 0, activate: 0 };
    const port = createLiveDxmSmtPort({
      tabId: "edit",
      isPaused: () => false,
      journalDir: tempDir(),
      getUrl: () => crawlUrl,
      listTabs: () => [],
      openTab: async () => {
        counts.open += 1;
        return "box-tab";
      },
      activateTab: () => {
        counts.activate += 1;
      },
      execute: async () => apiResult(pageJson(1, [wanted], wanted)),
    });
    const result = await port.lookupDraft?.({
      recordId: "sample-record",
      shopId: "S1",
      tabId: "edit",
      title: wanted,
    });
    expect(result?.status).toBe("ambiguous");
    expect(result?.status).not.toBe("found");
    expect(result?.reason).toContain("标题精确匹配");
    expect(JSON.parse(JSON.stringify(result)).source).toBe("api");
    expect(counts).toEqual({ open: 0, activate: 0 });
  });

  it("接口 404 时只降级一次页面路径，结论与页面单独读取一致", async () => {
    let opened = 0;
    const port = createLiveDxmSmtPort({
      tabId: "edit",
      isPaused: () => false,
      journalDir: tempDir(),
      getUrl: () => crawlUrl,
      listTabs: () => [{ id: "edit", url: crawlUrl }],
      openTab: async () => {
        opened += 1;
        return "box-tab";
      },
      closeTab: () => undefined,
      execute: async (script) => {
        if (script.includes("pageList.json")) return apiResult(null, 404, false);
        return emptyBox();
      },
    });
    const result = await port.lookupDraft?.({
      recordId: "sample-record",
      shopId: "S1",
      tabId: "edit",
      title: wanted,
    });
    expect(opened).toBe(1);
    expect(result?.status).toBe("absent");
    expect(result?.reason ?? "").not.toContain("接口：");
    expect(JSON.parse(JSON.stringify(result)).source).toBe("dom");
  });

  it("接口和页面都判不清时，原因分成两段且不带 absent", async () => {
    const port = createLiveDxmSmtPort({
      tabId: "edit",
      isPaused: () => false,
      journalDir: tempDir(),
      getUrl: () => crawlUrl,
      listTabs: () => [],
      openTab: async () => "box-tab",
      closeTab: () => undefined,
      hasTab: () => false,
      execute: async () => apiResult(null, 404, false),
    });
    const result = await port.lookupDraft?.({
      recordId: "sample-record",
      shopId: "S1",
      tabId: "edit",
      title: wanted,
    });
    expect(result?.status).toBe("unknown");
    expect(result?.reason).toContain("接口：");
    expect(result?.reason).toContain("页面：");
    expect(result?.reason ?? "").not.toMatch(/absent|没有草稿/);
    expect((result?.reason ?? "").length).toBeLessThanOrEqual(200);
    expect(JSON.parse(JSON.stringify(result)).source).toBe("dom");
  });

  it("不是店小秘域名时不发列表接口", async () => {
    const scripts: string[] = [];
    let opened = 0;
    const port = createLiveDxmSmtPort({
      tabId: "edit",
      isPaused: () => false,
      journalDir: tempDir(),
      getUrl: () => otherUrl,
      listTabs: () => [],
      openTab: async () => {
        opened += 1;
        return "box-tab";
      },
      closeTab: () => undefined,
      execute: async (script) => {
        scripts.push(script);
        return emptyBox();
      },
    });
    const result = await port.lookupDraft?.({
      recordId: "sample-record",
      shopId: "S1",
      tabId: "edit",
      title: wanted,
    });
    expect(opened).toBe(1);
    expect(scripts.some((script) => script.includes("pageList.json"))).toBe(false);
    expect(result?.status).toBe("absent");
    expect(JSON.parse(JSON.stringify(result)).source).toBe("dom");
  });

  it("暂停或缺来源、缺店铺时不碰页面", async () => {
    const calls = { execute: 0, open: 0, activate: 0, navigate: 0, close: 0, getUrl: 0 };
    const surface = {
      tabId: "edit",
      isPaused: () => true,
      journalDir: tempDir(),
      getUrl: () => {
        calls.getUrl += 1;
        return crawlUrl;
      },
      listTabs: () => [],
      execute: async () => {
        calls.execute += 1;
        return emptyBox();
      },
      openTab: async () => {
        calls.open += 1;
        return "box-tab";
      },
      activateTab: () => {
        calls.activate += 1;
      },
      navigate: async () => {
        calls.navigate += 1;
        return { ok: true };
      },
      closeTab: () => {
        calls.close += 1;
      },
    };
    const paused = await createLiveDxmSmtPort(surface).lookupDraft?.({
      recordId: "sample-record",
      shopId: "S1",
      tabId: "edit",
      title: wanted,
    });
    expect(paused).toEqual({ status: "unknown", reason: "任务已暂停，无法判重" });
    const missingRecord = await createLiveDxmSmtPort({ ...surface, isPaused: () => false }).lookupDraft?.({
      shopId: "S1",
      tabId: "edit",
      title: wanted,
    });
    const missingShop = await createLiveDxmSmtPort({ ...surface, isPaused: () => false }).lookupDraft?.({
      recordId: "sample-record",
      tabId: "edit",
      title: wanted,
    });
    expect(missingRecord).toEqual({ status: "unknown", reason: "来源或店铺不完整，无法判重" });
    expect(missingShop).toEqual({ status: "unknown", reason: "来源或店铺不完整，无法判重" });
    expect(calls).toEqual({ execute: 0, open: 0, activate: 0, navigate: 0, close: 0, getUrl: 0 });
  });

  it("标题是空白时不发接口，页面说明读不到标题", async () => {
    const scripts: string[] = [];
    const port = createLiveDxmSmtPort({
      tabId: "edit",
      isPaused: () => false,
      journalDir: tempDir(),
      getUrl: () => crawlUrl,
      listTabs: () => [],
      openTab: async () => "box-tab",
      closeTab: () => undefined,
      execute: async (script) => {
        scripts.push(script);
        return {
          ok: true,
          data: { result: { loaded: true, emptyRendered: false, rows: [{ title: wanted, productId: "3000001" }], searchValue: "" } },
        };
      },
    });
    const result = await port.lookupDraft?.({
      recordId: "sample-record",
      shopId: "S1",
      tabId: "edit",
      title: "   ",
    });
    expect(scripts.some((script) => script.includes("pageList.json"))).toBe(false);
    expect(result?.status).toBe("unknown");
    expect(result?.reason).toBe("编辑页读不到标题，无法判重");
  });

  it("既有判重测试文件里的原断言还在", () => {
    const root = join(dirName);
    const r7 = readFileSync(join(root, "dxm-smt-r7.test.ts"), "utf8");
    const r9b = readFileSync(join(root, "dxm-smt-r9b.test.ts"), "utf8");
    const r10 = readFileSync(join(root, "dxm-smt-r10.test.ts"), "utf8");
    const r11 = readFileSync(join(root, "dxm-smt-r11.test.ts"), "utf8");
    expect(r7).toContain('["edit", "box-tab", "box-tab", "box-tab"]');
    expect(r7).toContain("标题精确匹配 1 条");
    expect(r9b).toContain('["activate:box-tab", "read", "read", "read", "close:box-tab", "activate:edit"]');
    expect(r10).toContain("domReads");
    expect(r10).toContain("apiCalls");
    expect(r10).toContain("接口：");
    expect(r10).toContain("boxPollExhausted([\"ready\"]).reason");
    expect(r11).toContain("shapeOk");
  });
});
