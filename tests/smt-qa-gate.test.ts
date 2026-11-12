import { describe, expect, it } from "vitest";
import { buildSmtQaReport } from "../src/main/qa/dianxiaomi-smt.js";

const url = "https://www.dianxiaomi.com/web/smt/edit?id=220114600887277928";

function cards(checkedCount: number, width = 800) {
  return Array.from({ length: 18 }, (_, i) => ({
    checked: i < checkedCount,
    textW: width,
    textH: width,
    naturalWidth: width,
  }));
}

function report(patch: Record<string, unknown>) {
  return buildSmtQaReport({
    url,
    title: "编辑",
    titleValue: "Christmas Stocking Ornament",
    titleCjk: 0,
    titleLetters: 27,
    categoryText: "产品分类 Christmas Pendant",
    attrCjk: 0,
    dutyChecked: true,
    imageCards: cards(6),
    errorCount: 0,
    errorTexts: [],
    emptyPrice: 0,
    emptyStock: 0,
    priceTotal: 29,
    stockTotal: 29,
    ...patch,
  });
}

describe("速卖通保存前检查", () => {
  it("合格页通过，整页里的 4000 尺寸文案不参与判断", () => {
    const result = report({ dimSamples: ["800 X 800", "4000 x 4000"] });
    expect(result.ok).toBe(true);
    expect(result.items.find((item) => item.id === "image_size")?.status).toBe("pass");
  });

  it("当前这页的原稿应当失败在标题、张数、属性和关税", () => {
    const result = report({
      titleValue: "跨境圣诞袜圣诞树装饰",
      titleCjk: 11,
      titleLetters: 0,
      attrCjk: 92,
      dutyChecked: false,
      imageCards: cards(5),
      errorCount: 1,
      errorTexts: ["请选择报价是否含关税！"],
    });
    expect(result.ok).toBe(false);
    const byId = Object.fromEntries(result.items.map((item) => [item.id, item]));
    expect(byId.title?.detail).toContain("标题仍含中文");
    expect(byId.images_selected?.detail).toContain("选用了 5 张");
    expect(byId.attr_zh?.status).toBe("fail");
    expect(byId.form_errors?.detail).toContain("报价是否含关税未选");
    expect(byId.image_size?.status).toBe("pass");
    expect(result.summary).not.toContain("标题为空");
  });

  it("标题框没读到值时才说标题为空", () => {
    const result = report({ titleValue: "", titleCjk: 0, titleLetters: 0 });
    expect(result.items.find((item) => item.id === "title")?.detail).toBe("标题为空");
  });
});
