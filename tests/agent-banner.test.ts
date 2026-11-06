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
    expect(agentBannerText({ agentName: "Agent 甲", agentSeat: 1, agentState: "running", agentRound: 3 })).toBe(
      "1号工位正在办公 · Agent 甲 · 第 3 轮 · 正在读页",
    );
    expect(agentBannerText({ agentName: "Agent 甲", agentSeat: 1, agentState: "waiting_human" })).toBe(
      "1号工位等你拍板 · Agent 甲 · 需要登录",
    );
    expect(agentBannerText({ agentName: "Agent 甲", agentSeat: 1, agentState: "queued" })).toBe(
      "1号工位排队候场 · Agent 甲",
    );
    expect(agentBannerText({ agentName: "Agent 甲", agentSeat: 1, agentState: "done" })).toBe(
      "1号工位已下班 · Agent 甲 · 页面已休眠",
    );
  });

  it("使用中行贴在侧栏滚动区顶部", () => {
    const shell = readFileSync(join(process.cwd(), "src/renderer/shell.html"), "utf8");
    const css = shell.slice(shell.indexOf(".agent-roster {"), shell.indexOf(".agent-roster[hidden]"));
    expect(css).toContain("position: sticky;");
    expect(css).toContain("top: 0;");
    expect(css).toContain("z-index: 1;");
    expect(css).toContain("background: var(--side);");
    expect(shell).toContain(".agent-roster[hidden] { display: none; }");
    expect(shell).toContain("function renderAgentRoster");
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
