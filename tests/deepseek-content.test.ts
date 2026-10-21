import { describe, expect, it } from "vitest";
import { contentText } from "../src/main/agent/deepseek.js";

describe("deepseek contentText", () => {
  it("字符串照旧 trim，数组只拼 text 段", () => {
    expect(contentText("  你好  ")).toBe("你好");
    expect(contentText([{ type: "text", text: "你好" }])).toBe("你好");
    expect(
      contentText([
        { type: "text", text: "第一段" },
        { type: "image_url", image_url: { url: "data:image/png;base64,xx" } },
        { type: "text", text: "第二段" },
      ]),
    ).toBe("第一段\n第二段");
    expect(contentText(null)).toBe("");
    expect(contentText(undefined)).toBe("");
  });
});
