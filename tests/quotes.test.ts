import { describe, expect, it } from "vitest";
import {
  QUOTE_COUNT_LIMIT,
  QUOTE_TEXT_LIMIT,
  composeQuotedPrompt,
  normalizeQuotes,
  QUOTE_PAGE_CONTRACT,
  quotedUserTurn,
} from "../src/main/agent/quotes.js";

describe("composeQuotedPrompt", () => {
  it("puts quotes before the instruction", () => {
    const prompt = composeQuotedPrompt("用三句话解释给小学生听", [
      {
        text: "海平面在上升。",
        title: "气候新闻",
        url: "https://news.example/a",
        kind: "page",
      },
    ]);
    expect(prompt.startsWith(QUOTE_PAGE_CONTRACT)).toBe(true);
    expect(prompt.indexOf(QUOTE_PAGE_CONTRACT)).toBeLessThan(prompt.indexOf("[引用 1]"));
    expect(prompt).toContain("[引用 1]（来源：气候新闻 https://news.example/a）");
    expect(prompt).toContain("海平面在上升。");
    expect(prompt.endsWith("[用户指令] 用三句话解释给小学生听")).toBe(true);
    expect(prompt.indexOf("[引用 1]")).toBeLessThan(prompt.indexOf("[用户指令]"));
  });

  it("keeps the original sentence when there is no quote", () => {
    expect(composeQuotedPrompt("翻译成英文", [])).toBe("翻译成英文");
    expect(composeQuotedPrompt("翻译成英文", undefined)).toBe("翻译成英文");
    expect(composeQuotedPrompt("  原文不变  ", [{ text: "  ", kind: "page" }])).toBe("  原文不变  ");
  });

  it("truncates each quote and keeps at most five", () => {
    const long = "字".repeat(QUOTE_TEXT_LIMIT + 25);
    const many = Array.from({ length: 7 }, (_, i) => ({
      text: i === 0 ? long : `摘录${i}`,
      title: `来源${i}`,
      kind: "page" as const,
    }));
    const clean = normalizeQuotes(many);
    expect(clean).toHaveLength(QUOTE_COUNT_LIMIT);
    expect(clean[0].text).toHaveLength(QUOTE_TEXT_LIMIT);
    expect(clean[0].text.endsWith("字")).toBe(true);
    const prompt = composeQuotedPrompt("翻译成英文", many);
    expect(prompt).toContain("[引用 5]");
    expect(prompt).not.toContain("[引用 6]");
    expect(prompt).not.toContain("字".repeat(QUOTE_TEXT_LIMIT + 1));
    expect(prompt.endsWith("[用户指令] 翻译成英文")).toBe(true);
  });

  it("labels a quote with no source as a manual excerpt", () => {
    expect(composeQuotedPrompt("看看", [{ text: "随手摘的", kind: "page" }])).toContain(
      "[引用 1]（来源：手动摘录）\n随手摘的",
    );
  });
});

describe("quoted user turn", () => {
  it("stores quotes on the chat log item without rewriting the text", () => {
    const log = [];
    log.push(
      quotedUserTurn("用三句话解释给小学生听", [
        { text: "海平面在上升。", url: "https://news.example/a", title: "气候新闻", kind: "page" },
      ]),
    );
    expect(log).toHaveLength(1);
    expect(log[0].role).toBe("user");
    expect(log[0].text).toBe("用三句话解释给小学生听");
    expect(log[0].quotes).toEqual([
      {
        text: "海平面在上升。",
        url: "https://news.example/a",
        title: "气候新闻",
        kind: "page",
      },
    ]);
  });

  it("omits quotes when the payload is empty", () => {
    const turn = quotedUserTurn("下一句没有引用", []);
    expect(turn.text).toBe("下一句没有引用");
    expect(turn.quotes).toBeUndefined();
  });
});
