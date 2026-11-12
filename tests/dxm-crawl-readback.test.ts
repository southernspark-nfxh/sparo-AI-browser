import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  diffCrawlFields,
  formatCrawlMismatch,
  readCrawlFieldsFromHtml,
  type CrawlIntent,
} from "../src/main/workflows/dxm-crawl-readback.js";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "dxm-crawl-edit-sku.html");
const html = readFileSync(fixturePath, "utf8");
const fields = readCrawlFieldsFromHtml(html);

const fullIntent: CrawlIntent = {
  title: "示例标题",
  weight: "0.05",
  stock: "2000",
  variantCount: 3,
  imgShortSide: 800,
  category: "未分类 + 管理分类",
};

describe("采集箱编辑页 6 项回读", () => {
  it("夹具解析标题、重量、3 行库存、主图短边和分类", () => {
    expect(fields.title).toBe("示例标题");
    expect(fields.weight).toBe("0.05");
    expect(fields.rowCount).toBe(3);
    expect(fields.stocks).toEqual(["2000", "2000", "2000"]);
    expect(fields.imgShortSide).toBe(800);
    expect(fields.category).toBe("未分类 + 管理分类");
  });

  it("完全匹配的意图没有差异", () => {
    expect(diffCrawlFields(fullIntent, fields)).toEqual([]);
  });

  it("重量 50 与 0.05 不相等", () => {
    const mismatches = diffCrawlFields({ ...fullIntent, weight: "50" }, fields);
    expect(mismatches.map((item) => item.field)).toContain("重量");
  });

  it("逐行库存不一致报第 2 行", () => {
    const mismatches = diffCrawlFields({ ...fullIntent, stock: "2000" }, { ...fields, stocks: ["2000", "1999", "2000"] });
    expect(mismatches.map((item) => item.field)).toContain("变种2库存");
  });

  it("没有变种行时，期望 3 行报读不到", () => {
    const bare = html.replace(/<tr\b[^>]*skuDataItem_[\s\S]*?<\/tr>/gi, "");
    const read = readCrawlFieldsFromHtml(bare);
    expect(read.rowCount).toBe(0);
    const mismatches = diffCrawlFields({ variantCount: 3 }, read);
    expect(mismatches.map((item) => item.field)).toContain("变种行");
    expect(mismatches).toContainEqual({ field: "变种行", expected: "3", actual: "读不到" });
  });

  it("分类不符报分类", () => {
    const mismatches = diffCrawlFields({ category: "示例分类" }, { ...fields, category: "未分类 + 管理分类" });
    expect(mismatches.map((item) => item.field)).toContain("分类");
  });

  it("失败文案固定格式", () => {
    const mismatches = diffCrawlFields(
      { title: "X", stock: "2000" },
      { ...fields, title: "Y", stocks: ["2000", "1999", "2000"] },
    );
    expect(formatCrawlMismatch(mismatches)).toBe("回读不一致：标题(期望X/实际Y)、变种2库存(期望2000/实际1999)");
  });
});
