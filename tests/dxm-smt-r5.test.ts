import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parsePriceCell, skuContinuityIssues } from "../src/main/workflows/dxm-smt-fields.js";
import { createLiveDxmSmtPort, readFieldsFromHtml } from "../src/main/workflows/dxm-smt-live.js";
import { classifyPage, probeFromHtml, resolveIdentity } from "../src/main/workflows/dxm-smt-page.js";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "dxm-crawl-edit.html");
const html = readFileSync(fixturePath, "utf8");
const crawlUrl = "https://www.dianxiaomi.com/web/productCrawl/edit?id=sample-record";

describe("R5-1 采集编辑页探针", () => {
  it("没有 data 标记时，recordId 来自 URL，页面是采集编辑，缺店铺就停等", () => {
    expect(html).not.toMatch(/data-record-id|data-shop-id|data-draft-id|jiuyecc|挂腰风扇/);
    const probe = probeFromHtml(html, crawlUrl);
    expect(probe.recordId).toBe("sample-record");
    expect(probe.urlId).toBe("sample-record");
    expect(probe.shops).toEqual([]);
    expect(classifyPage(probe).kind).toBe("crawl_edit");
    const identity = resolveIdentity(probe);
    expect(identity.ok).toBe(false);
    if (!identity.ok) {
      expect(identity.reason).toBe("页面读不到店铺，店铺基线未就绪（先跑 dxm_smt_shops）");
    }
  });

  it("data-record-id 仍优先于 URL，保存并认领按钮不能单独决定页面类型", () => {
    const marked = `<div data-record-id="MARKED"></div>${html}`;
    const probe = probeFromHtml(marked, crawlUrl);
    expect(probe.recordId).toBe("MARKED");
    expect(probe.urlId).toBe("sample-record");
    const buttonOnly = classifyPage(probeFromHtml("<button>保存并认领</button>", "https://www.dianxiaomi.com/web/home"));
    expect(buttonOnly.kind).not.toBe("crawl_edit");
  });
});

describe("R5-2 标题和 SKU 读回", () => {
  it("parsePriceCell 剥离单位，空和非数字返回空", () => {
    expect(parsePriceCell("1.75 USD")).toBe("1.75");
    expect(parsePriceCell("1.75")).toBe("1.75");
    expect(parsePriceCell("")).toBe("");
    expect(parsePriceCell("   ")).toBe("");
    expect(parsePriceCell("abc")).toBe("");
  });

  it("真实变种区读回 8 行，价格剥离，库存为空，描述标成 iframe 待基线", () => {
    const fields = readFieldsFromHtml(html);
    expect(fields.title).toBe("示例标题");
    expect(fields.skus).toHaveLength(8);
    expect(fields.skus[0]).toMatchObject({
      specs: { 颜色: "色A", 尺寸: "S" },
      price: "1.75",
      rawPrice: "1.75 USD",
      stock: "",
    });
    expect(fields.skus.every((row) => row.price === "1.75" && row.stock === "")).toBe(true);
    expect(fields.descriptionNote).toBe("iframe 待基线");
    expect(fields.description).toBeUndefined();
  });

  it("变种区没有行时不猜，SKU 连续性仍报读回为空", () => {
    const bare = html.replace(/<div class="sku-row">[\s\S]*<\/div>\s*(?=<button)/, "");
    const fields = readFieldsFromHtml(bare);
    expect(fields.skus).toEqual([]);
    expect(fields.skuReadReason).toMatch(/不猜|读不到/);
    expect(skuContinuityIssues([{ specs: { 颜色: "色A", 尺寸: "S" }, price: "1.75", stock: "1" }], fields.skus)).toContain("SKU 读回为空");
  });

  it("价格比较用剥离后的值，规格仍按原文", () => {
    const issues = skuContinuityIssues(
      [{ specs: { 颜色: "色A" }, price: "1.75 USD", stock: "" }],
      [{ specs: { 颜色: "色A" }, price: "1.75", stock: "" }],
    );
    expect(issues).not.toContain("价格变化");
    const changed = skuContinuityIssues(
      [{ specs: { 颜色: "色A" }, price: "1.75 USD", stock: "" }],
      [{ specs: { 颜色: "色B" }, price: "1.75", stock: "" }],
    );
    expect(changed).toContain("规格丢失");
  });
});

describe("R5 停等边界", () => {
  it("认领、保存、发布仍然停等，不会去点保存并认领", async () => {
    const port = createLiveDxmSmtPort({
      tabId: "tab",
      isPaused: () => false,
      journalDir: "",
      execute: async () => ({ ok: true, data: { result: {} } }),
      getUrl: () => crawlUrl,
      listTabs: () => [],
    });
    const claim = await port.claim({ tabId: "tab", recordId: "sample-record", shopId: "shop" });
    const save = await port.saveDraft("tab");
    const publish = await port.clickPublish("tab");
    expect(claim.ok).toBe(false);
    expect(save.ok).toBe(false);
    expect(publish.ok).toBe(false);
    expect(publish.message || "").toMatch(/停等|不会点击/);
  });
});
