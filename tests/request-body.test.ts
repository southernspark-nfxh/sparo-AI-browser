import { describe, expect, it } from "vitest";
import { withJsonModel } from "../src/main/cloud/request-body.js";

describe("withJsonModel", () => {
  it("补上空 model，避免回落 DeepSeek 时变成 you passed .", () => {
    const out = withJsonModel(JSON.stringify({ model: "", messages: [] }), "deepseek-v4-flash");
    expect(JSON.parse(String(out))).toEqual({ model: "deepseek-v4-flash", messages: [] });
  });

  it("不覆盖已有模型名", () => {
    const out = withJsonModel(JSON.stringify({ model: "qwen-flash" }), "deepseek-v4-flash");
    expect(JSON.parse(String(out)).model).toBe("qwen-flash");
  });
});
