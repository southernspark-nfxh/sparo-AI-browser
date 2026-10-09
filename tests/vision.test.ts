import { describe, expect, it } from "vitest";
import {
  buildUserContent,
  flattenVisionContent,
  isVisionModel,
  isUsableCaptureBuffer,
  parseScreenshotInput,
  sanitizeImageDataUrls,
  validClip,
  wantsPageShot,
  VISION_FALLBACK_HINT,
} from "../src/main/agent/vision.js";

describe("vision helpers", () => {
  it("认常见视觉模型，放过纯文本 DeepSeek", () => {
    expect(isVisionModel("gpt-4o")).toBe(true);
    expect(isVisionModel("claude-3-5-sonnet")).toBe(true);
    expect(isVisionModel("qwen-vl-max")).toBe(true);
    expect(isVisionModel("deepseek-v4-flash")).toBe(false);
    expect(isVisionModel("deepseek-chat")).toBe(false);
  });

  it("只收 data URL 图片，最多 3 张", () => {
    const ok = "data:image/png;base64,iVBORw0KGgo=";
    expect(sanitizeImageDataUrls([ok, "http://evil", ok, ok, ok])).toHaveLength(3);
    expect(sanitizeImageDataUrls(["not-an-image"])).toEqual([]);
  });

  it("有图时拼多模态，无视觉模型则降级", () => {
    const parts = buildUserContent("这是什么", ["data:image/png;base64,xx"]);
    expect(Array.isArray(parts)).toBe(true);
    expect(flattenVisionContent(parts, true)).toEqual(parts);
    expect(String(flattenVisionContent(parts, false))).toContain("附图已省略");
    expect(VISION_FALLBACK_HINT).toMatch(/GPT-4o/);
  });

  it("截图参数兼容旧的 label 字符串", () => {
    expect(parseScreenshotInput("diag")).toEqual({ label: "diag" });
    expect(validClip({ x: 1.2, y: 3, width: 40, height: 20 })).toEqual({
      x: 1,
      y: 3,
      width: 40,
      height: 20,
    });
    expect(validClip({ x: 0, y: 0, width: 0, height: 10 })).toBeNull();
  });

  it("认侧栏「截个图看看」", () => {
    expect(wantsPageShot("截个图看看现在页面长什么样")).toBe(true);
    expect(wantsPageShot("在1688买T恤")).toBe(false);
  });

  it("空截图缓冲不能当成功", () => {
    expect(isUsableCaptureBuffer(Buffer.alloc(0))).toBe(false);
    expect(isUsableCaptureBuffer(Buffer.alloc(8))).toBe(false);
    expect(isUsableCaptureBuffer(Buffer.alloc(64))).toBe(true);
  });
});
