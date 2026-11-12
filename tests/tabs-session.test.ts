import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadTabs, saveTabs } from "../src/main/tabs-session.js";

function dir(): string {
  return mkdtempSync(join(tmpdir(), "sparo-tabs-"));
}

describe("标签会话持久化", () => {
  it("写入后原样读回，active 与 envId 不丢", () => {
    const d = dir();
    saveTabs(d, [
      { url: "https://www.dianxiaomi.com/web/smt/edit?id=1", title: "编辑", active: true },
      { url: "https://detail.1688.com/offer/2.html", envId: "env-1" },
    ]);
    const back = loadTabs(d);
    expect(back).toHaveLength(2);
    expect(back[0]).toMatchObject({ url: "https://www.dianxiaomi.com/web/smt/edit?id=1", active: true });
    expect(back[1].envId).toBe("env-1");
    expect(back[1].active).toBe(false);
  });

  it("跳过 about:blank 和空地址", () => {
    const d = dir();
    saveTabs(d, [
      { url: "about:blank" },
      { url: "   " },
      { url: "https://example.com/a" },
    ]);
    const back = loadTabs(d);
    expect(back.map((t) => t.url)).toEqual(["https://example.com/a"]);
  });

  it("文件损坏时返回空数组，不抛错", () => {
    const d = dir();
    writeFileSync(join(d, "tabs.json"), "{not json", "utf8");
    expect(loadTabs(d)).toEqual([]);
  });

  it("带 BOM 的文件照常读回，不当成空会话", () => {
    const d = dir();
    writeFileSync(
      join(d, "tabs.json"),
      "\uFEFF" + JSON.stringify([{ url: "https://www.dianxiaomi.com/web/smt/edit?id=1", active: true }]),
      "utf8",
    );
    const back = loadTabs(d);
    expect(back).toHaveLength(1);
    expect(back[0].active).toBe(true);
  });

  it("超过上限时截断，且只保留前 cap 条", () => {
    const d = dir();
    saveTabs(
      d,
      Array.from({ length: 5 }, (_, i) => ({ url: `https://example.com/${i}` })),
      3,
    );
    const back = loadTabs(d, 3);
    expect(back).toHaveLength(3);
    expect(back[0].url).toBe("https://example.com/0");
    expect(JSON.parse(readFileSync(join(d, "tabs.json"), "utf8"))).toHaveLength(3);
  });
});
