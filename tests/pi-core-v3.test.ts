import { describe, expect, it } from "vitest";
import { looksLikeSubmitAction, submitClickNeedsGate } from "../src/main/qa/dianxiaomi-smt.js";
import { recaptureIfEmpty } from "../src/main/snapshot-retry.js";
import { retryShortContentEditable } from "../src/main/fill-retry.js";

describe("新核心点击不再走店小秘提交闸门", () => {
  it("运行中点击发布不触发闸门，旧路径仍拦确认发布", () => {
    expect(submitClickNeedsGate(true, "发布")).toBe(false);
    expect(submitClickNeedsGate(true, "确认发布")).toBe(false);
    expect(submitClickNeedsGate(false, "确认发布")).toBe(true);
    expect(looksLikeSubmitAction("确认发布")).toBe(true);
    expect(looksLikeSubmitAction("发布")).toBe(false);
  });
});

describe("空快照在工具内部重抓一次", () => {
  it("第一次 0、第二次有元素时返回第二次并注明重试", async () => {
    const seen: number[] = [];
    const waits: number[] = [];
    const { snap, retried } = await recaptureIfEmpty(
      async () => {
        seen.push(seen.length);
        if (seen.length === 1) return { url: "https://www.zhihu.com/question/1", elements: [] };
        return { url: "https://www.zhihu.com/question/1", elements: [{ ref: "e1" }, { ref: "e2" }] };
      },
      async (ms) => {
        waits.push(ms);
      },
    );
    expect(waits).toEqual([600]);
    expect(retried).toBe(true);
    expect(snap.elements).toHaveLength(2);
  });

  it("两次都是 0 时如实返回 0，空白页不重抓", async () => {
    let calls = 0;
    const empty = await recaptureIfEmpty(
      async () => {
        calls += 1;
        return { url: "https://www.zhihu.com/question/1", elements: [] as unknown[] };
      },
      async () => undefined,
    );
    expect(calls).toBe(2);
    expect(empty.retried).toBe(true);
    expect(empty.snap.elements).toHaveLength(0);

    let blankCalls = 0;
    const blank = await recaptureIfEmpty(
      async () => {
        blankCalls += 1;
        return { url: "about:blank", elements: [] as unknown[] };
      },
      async () => undefined,
    );
    expect(blankCalls).toBe(1);
    expect(blank.retried).toBe(false);
  });
});

describe("contenteditable 回读不符时重填一次", () => {
  it("第一次丢字，重试写上后算成功", async () => {
    const expected = "这是一段要发到知乎的回答正文";
    const result = await retryShortContentEditable({
      kind: "contenteditable",
      expected,
      actual: "",
      retry: async () => ({ actual: expected, tag: "DIV", contentEditable: true }),
    });
    expect(result.retried).toBe(true);
    expect(result.matched).toBe(true);
    expect(result.actual).toBe(expected);
  });

  it("重试仍是空时如实失败，并带上标签", async () => {
    const result = await retryShortContentEditable({
      kind: "contenteditable",
      expected: "这是一段要发到知乎的回答正文",
      actual: "",
      retry: async () => ({ actual: "", tag: "DIV", contentEditable: true }),
    });
    expect(result.retried).toBe(true);
    expect(result.matched).toBe(false);
    expect(result.message).toContain("tag=DIV");
    expect(result.message).toContain("contenteditable=true");
  });

  it("普通输入框不重试", async () => {
    let calls = 0;
    const result = await retryShortContentEditable({
      kind: "input",
      expected: "标题",
      actual: "",
      retry: async () => {
        calls += 1;
        return { actual: "标题" };
      },
    });
    expect(calls).toBe(0);
    expect(result.retried).toBe(false);
  });
});
