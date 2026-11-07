import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatFillFailure, formatLane, formatLearnSwallow } from "../src/main/agent/parallel-log.js";

describe("T75 并行取证日志", () => {
  it("填表失败日志带上标签、是否前台、是否有焦点", () => {
    expect(
      formatFillFailure({
        tab: "tab-b",
        active: false,
        focused: false,
        method: "Input.insertText:fill-unicode-v2",
        matched: false,
      }),
    ).toBe("[fill] tab=tab-b active=false focused=false method=Input.insertText:fill-unicode-v2 matched=false");
  });

  it("车道日志分开记分类结果和实际走的路", () => {
    expect(
      formatLane({
        path: "sidebar",
        classified: "foreground",
        applied: "chat",
        chatRunning: false,
        freeSoulRunning: true,
        active: "tab-c",
        agentTab: "tab-c",
      }),
    ).toBe(
      "[lane] path=sidebar classified=foreground applied=chat chatRunning=false freeSoulRunning=true active=tab-c agentTab=tab-c",
    );
  });

  it("学习门禁早退单独记，不假装工具做成了", () => {
    expect(formatLearnSwallow("answerLearning")).toBe("[learn] swallowed answerLearning while freeSoulRunning");
  });

  it("填表失败、车道和门禁都接到了主进程", () => {
    const source = readFileSync(join(process.cwd(), "src/main/browser.ts"), "utf8");
    expect(source).toContain("logFillFailure");
    expect(source).toContain('formatLearnSwallow("answerLearning")');
    expect(source).toContain('applied: "chat"');
    expect(source).toContain('applied: "background"');
  });
});
