import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  activeTabUrlFrom,
  runSkill,
  type SkillBrowser,
} from "../src/main/skills/runner.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "sparo-skill-params-"));
}

function seedSkill(
  dir: string,
  params: Record<string, unknown>,
  steps: Array<Record<string, unknown>> = [
    { id: "open-edit", tool: "navigate", args: { url: "{{editUrl}}" } },
  ],
): void {
  mkdirSync(join(dir, "skills"), { recursive: true });
  writeFileSync(
    join(dir, "skills", "dxm-params-test.json"),
    JSON.stringify({
      id: "dxm-params-test",
      title: "参数默认值测试",
      intent: "测试",
      source: "seeded",
      createdAt: "2026-11-12T00:00:00.000Z",
      updatedAt: "2026-11-12T00:00:00.000Z",
      steps,
      stepCount: steps.length,
      stats: { success: 0, fail: 0 },
      enabled: true,
      params,
    }),
  );
}

function stubBrowser(over: Partial<SkillBrowser> = {}): {
  browser: SkillBrowser;
  visited: string[];
} {
  const visited: string[] = [];
  const browser = {
    getUrl: () => "",
    navigate: async (url: string) => {
      visited.push(url);
      return { ok: true, message: url };
    },
    snapshot: async () => ({ ok: true, message: "", data: { elements: [] } }),
    click: async () => ({ ok: true, message: "" }),
    fill: async () => ({ ok: true, message: "" }),
    clickText: async () => ({ ok: true, message: "" }),
    waitFor: async () => ({ ok: true, message: "" }),
    pageText: async () => ({ ok: true, message: "", data: { text: "" } }),
    setPaused: () => {},
    ...over,
  } as unknown as SkillBrowser;
  return { browser, visited };
}

describe("dxm-crawl-prep 参数默认值", () => {
  it("显式传 editUrl 时不被默认值覆盖", async () => {
    const dir = tempDir();
    seedSkill(dir, {
      editUrl: { type: "string", required: true, default: "https://x/y" },
    });
    const { browser, visited } = stubBrowser();
    const r = await runSkill(browser, dir, {
      id: "dxm-params-test",
      params: { editUrl: "https://real/edit" },
    });
    expect(r.ok).toBe(true);
    expect(visited).toEqual(["https://real/edit"]);
  });

  it("没传 editUrl 时用 params.editUrl.default", async () => {
    const dir = tempDir();
    seedSkill(dir, {
      editUrl: { type: "string", required: true, default: "https://x/y" },
    });
    const { browser, visited } = stubBrowser();
    const r = await runSkill(browser, dir, { id: "dxm-params-test" });
    expect(r.ok).toBe(true);
    expect(visited).toEqual(["https://x/y"]);
  });

  it("{{__activeTabUrl}} 拿不到活动标签时保持字面量", async () => {
    const dir = tempDir();
    seedSkill(dir, {
      editUrl: { type: "string", required: true, default: "{{__activeTabUrl}}" },
    });
    const { browser, visited } = stubBrowser({
      listTabs: () => ({ tabs: [], activeId: "" }),
    });
    const r = await runSkill(browser, dir, { id: "dxm-params-test" });
    expect(r.ok).toBe(true);
    expect(visited).toEqual(["{{__activeTabUrl}}"]);
    expect(activeTabUrlFrom([], "")).toBeNull();
    expect(activeTabUrlFrom([{ id: "a", url: "about:blank" }], "a")).toBeNull();
  });

  it("{{__activeTabUrl}} 解析成当前活动标签页 URL", async () => {
    const dir = tempDir();
    seedSkill(dir, {
      editUrl: { type: "string", required: true, default: "{{__activeTabUrl}}" },
    });
    const { browser, visited } = stubBrowser({
      listTabs: () => ({
        tabs: [
          { id: "t1", url: "https://www.dianxiaomi.com/web/crawl/edit?id=1" },
          { id: "t2", url: "https://detail.1688.com/offer/1.html" },
        ],
        activeId: "t1",
      }),
    });
    const r = await runSkill(browser, dir, { id: "dxm-params-test" });
    expect(r.ok).toBe(true);
    expect(visited).toEqual(["https://www.dianxiaomi.com/web/crawl/edit?id=1"]);
  });

  it("未声明的 {{foo}} 仍保持字面量", async () => {
    const dir = tempDir();
    seedSkill(dir, {}, [
      { id: "open", tool: "navigate", args: { url: "{{foo}}" } },
    ]);
    const { browser, visited } = stubBrowser();
    const r = await runSkill(browser, dir, { id: "dxm-params-test" });
    expect(r.ok).toBe(true);
    expect(visited).toEqual(["{{foo}}"]);
  });
});
