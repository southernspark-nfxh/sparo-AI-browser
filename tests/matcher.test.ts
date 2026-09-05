import { describe, expect, it } from "vitest";
import { bestFieldMatch, matchScore, normalizeLabel } from "../src/main/analyzer/match.js";
import { shouldRotateToken } from "../src/main/mcp-security.js";

describe("normalizeLabel / matchScore", () => {
  it("normalizes punctuation and filler", () => {
    expect(normalizeLabel("填写标题：")).toBe("标题");
  });

  it("matches 标题 to title field", () => {
    expect(matchScore("标题", "笔记标题", "填写标题", "title", "text_input")).toBeGreaterThanOrEqual(
      80,
    );
  });

  it("bestFieldMatch picks richest score", () => {
    const fields = [
      { label: "搜索", placeholder: "", name: "wd", ref: "e1", primitive: "text_input" },
      { label: "标题", placeholder: "填写标题", name: "title", ref: "e2", primitive: "text_input" },
    ];
    const hit = bestFieldMatch("标题", fields);
    expect(hit?.field.ref).toBe("e2");
  });

  it("does not map End time onto a USD number box", () => {
    const fields = [
      { label: "Daily budget", placeholder: "USD", name: "budget", ref: "e1", primitive: "number_input" },
      { label: "End time", placeholder: "", name: "", ref: "e2", primitive: "date_picker_button" },
    ];
    const hit = bestFieldMatch("End time", fields);
    expect(hit?.field.ref).toBe("e2");
    expect(hit?.field.primitive).toBe("date_picker_button");
    expect(bestFieldMatch("End time", [fields[0]!])).toBeNull();
  });
});

describe("shouldRotateToken", () => {
  it("respects ttl", () => {
    expect(shouldRotateToken(Date.now() - 10_000, 5)).toBe(true);
    expect(shouldRotateToken(Date.now() - 1_000, 60)).toBe(false);
    expect(shouldRotateToken(Date.now(), 0)).toBe(false);
  });
});
