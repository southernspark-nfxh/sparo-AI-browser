import { describe, expect, it } from "vitest";
import { parseRewriteVerdict, rewriteVerdictPrompt } from "../src/main/agent/kernel/read-rewrite.js";

describe("阅读页改写判定", () => {
  it("只认模型回答的 rewrite，其余一律开单", () => {
    expect(parseRewriteVerdict("rewrite")).toBe("rewrite");
    expect(parseRewriteVerdict("Rewrite.")).toBe("rewrite");
    expect(parseRewriteVerdict("open")).toBe("open");
    expect(parseRewriteVerdict("")).toBe("open");
    expect(parseRewriteVerdict("需要去微博采集")).toBe("open");
    expect(parseRewriteVerdict("把最近3天微博逐条复制下来")).toBe("open");
  });

  it("提示词把用户原话整句交给模型，不在本地列改写词", () => {
    const prompt = rewriteVerdictPrompt("把 tombkeeper 最近 3 天的微博逐条复制下来", "画像");
    expect(prompt).toContain("把 tombkeeper 最近 3 天的微博逐条复制下来");
    expect(prompt).toContain("只回答一个词");
    expect(prompt).not.toMatch(/缩短\|换个标题\|润色/);
  });
});
