import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function loadFn(name: string) {
  const html = readFileSync(join(process.cwd(), "src/renderer/shell.html"), "utf8");
  const start = html.indexOf(`function ${name}`);
  if (start < 0) throw new Error(`missing ${name}`);
  let depth = 0;
  for (let i = html.indexOf("{", start); i < html.length; i += 1) {
    if (html[i] === "{") depth += 1;
    else if (html[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        const src = html.slice(start, i + 1);
        return new Function(`${src}; return ${name};`)() as (...args: unknown[]) => unknown;
      }
    }
  }
  throw new Error(`unclosed ${name}`);
}

describe("T53 页面归属条", () => {
  it("横幅高度从页面洞里扣掉，隐藏时原样返回", () => {
    const holeRectWithBanner = loadFn("holeRectWithBanner") as (
      rect: { left: number; top: number; width: number; height: number },
      bannerH: number,
    ) => { x: number; y: number; width: number; height: number };
    const rect = { left: 0, top: 76, width: 900, height: 700 };
    expect(holeRectWithBanner(rect, 0)).toEqual({ x: 0, y: 76, width: 900, height: 700 });
    expect(holeRectWithBanner(rect, 32)).toEqual({ x: 0, y: 108, width: 900, height: 668 });
    expect(holeRectWithBanner({ left: 4, top: 80, width: 200, height: 100 }, 500)).toEqual({
      x: 4,
      y: 100,
      width: 200,
      height: 80,
    });
  });

  it("四种状态的横幅文案", () => {
    const agentBannerText = loadFn("agentBannerText") as (tab: Record<string, unknown>) => string;
    expect(agentBannerText({ agentName: "Agent 甲", agentState: "running", agentRound: 3 })).toBe(
      "Agent 甲 · 操作中 · 第 3 轮 · 正在读页",
    );
    expect(agentBannerText({ agentName: "Agent 甲", agentState: "waiting_human" })).toBe(
      "Agent 甲 · 等你处理 · 需要登录",
    );
    expect(
      agentBannerText({ agentName: "Agent 甲", agentState: "queued", agentStep: "排队中（第 2 位）" }),
    ).toBe("Agent 甲 · 排队中（第 2 位）");
    expect(agentBannerText({ agentName: "Agent 甲", agentState: "done" })).toBe(
      "Agent 甲 · 已完成 · 页面已休眠",
    );
  });

  it("顶栏高度和网格没被改", () => {
    const browser = readFileSync(join(process.cwd(), "src/main/browser.ts"), "utf8");
    const shell = readFileSync(join(process.cwd(), "src/renderer/shell.html"), "utf8");
    expect(browser).toContain("const CHROME_H = 76;");
    expect(shell).toContain("grid-template-rows: env(titlebar-area-height, 36px) 40px 1fr;");
    expect(shell).not.toContain("insertCSS");
    expect(shell).toContain('console.log("[banner]"');
  });
});
