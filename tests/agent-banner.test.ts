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

describe("页面侧栏状态区", () => {
  it("旧横幅高度不再从页面洞里扣掉", () => {
    const holeRectWithBanner = loadFn("holeRectWithBanner") as (
      rect: { left: number; top: number; width: number; height: number },
      bannerH: number,
    ) => { x: number; y: number; width: number; height: number };
    const rect = { left: 0, top: 76, width: 900, height: 700 };
    expect(holeRectWithBanner(rect, 0)).toEqual({ x: 0, y: 76, width: 900, height: 700 });
    expect(holeRectWithBanner(rect, 32)).toEqual({ x: 0, y: 76, width: 900, height: 700 });
    expect(holeRectWithBanner({ left: 4, top: 80, width: 200, height: 100 }, 500)).toEqual({
      x: 4,
      y: 80,
      width: 200,
      height: 100,
    });
  });

  it("状态区贴在侧栏顶部，页面洞里不再放旧横幅", () => {
    const shell = readFileSync(join(process.cwd(), "src/renderer/shell.html"), "utf8");
    const hole = shell.slice(shell.indexOf('id="pageHole"'), shell.indexOf('<aside class="sidebar'));
    expect(hole).not.toContain('id="agentBanner"');
    const sideAt = shell.indexOf('<aside class="sidebar');
    const statusAt = shell.indexOf('id="pageStatus"');
    const threadAt = shell.indexOf('<div class="thread">');
    expect(statusAt).toBeGreaterThan(sideAt);
    expect(threadAt).toBeGreaterThan(statusAt);
    expect(shell.slice(sideAt, threadAt)).toContain("静止／无 Agent");
    expect(shell).toContain('.page-status[data-tone="green"]');
    expect(shell).toContain('.page-status[data-tone="red"]');
    expect(shell).toContain('.page-status[data-tone="yellow"]');
    expect(shell).toContain('.page-status[data-tone="gray"]');
    const report = shell.slice(shell.indexOf("reportHole = () =>"), shell.indexOf("if (typeof ResizeObserver"));
    expect(report).not.toContain("agentBanner");
    expect(report).not.toContain("offsetHeight");
    const chrome = shell.slice(shell.indexOf("function renderChrome"), shell.indexOf("function navigateFromBar"));
    expect(chrome).not.toContain("agentColor");
    const status = shell.slice(shell.indexOf("function renderPageStatus"), shell.indexOf("function renderCommandRoom"));
    expect(status).toContain("dataset.tone");
    expect(status).not.toContain("agentColor");
    expect(status).not.toContain("正在努力");
  });

  it("顶栏高度和网格没被改", () => {
    const browser = readFileSync(join(process.cwd(), "src/main/browser.ts"), "utf8");
    const shell = readFileSync(join(process.cwd(), "src/renderer/shell.html"), "utf8");
    expect(browser).toContain("const CHROME_H = 76;");
    expect(shell).toContain("grid-template-rows: env(titlebar-area-height, 36px) 40px 1fr;");
    expect(shell).not.toContain("insertCSS");
  });
});
