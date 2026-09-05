import { describe, expect, it } from "vitest";
import { classifyIntent } from "../src/main/cs/intent.js";
import { templateDraft } from "../src/main/cs/draft.js";

describe("classifyIntent", () => {
  it("detects price inquiry", () => {
    const r = classifyIntent([], "这个多少钱？");
    expect(r.intent).toBe("price");
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it("detects discount", () => {
    const r = classifyIntent([], "能不能便宜点再优惠一点");
    expect(r.intent).toBe("discount");
  });

  it("detects after_sale", () => {
    const r = classifyIntent([], "东西坏了要退款");
    expect(r.intent).toBe("after_sale");
  });

  it("treats comment questions as inquiry", () => {
    const r = classifyIntent([], "求教程，怎么一键回复留言？");
    expect(r.intent).toBe("inquiry");
  });
});

describe("templateDraft", () => {
  it("returns non-empty Chinese draft", () => {
    const intent = classifyIntent([], "有现货吗");
    const d = templateDraft(intent);
    expect(d.length).toBeGreaterThan(8);
  });
});
