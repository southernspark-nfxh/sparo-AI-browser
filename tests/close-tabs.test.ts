import { describe, expect, it } from "vitest";
import { pickTabsToClose } from "../src/main/close-tabs.js";

const tabs = [
  { id: "a", url: "https://www.toutiao.com/a1", title: "今日头条" },
  { id: "b", url: "https://www.toutiao.com/a2", title: "另一条" },
  { id: "c", url: "https://example.com/", title: "其他站" },
  { id: "studio", url: "https://www.toutiao.com/studio", title: "工作台" },
  { id: "reader", url: "file:///report.html", title: "阅读" },
];

describe("pickTabsToClose", () => {
  it("match 命中的页全部关掉，包括当前页", () => {
    const picked = pickTabsToClose({
      tabs,
      activeId: "a",
      studioId: "studio",
      readerId: "reader",
      match: "toutiao",
      batch: true,
    });
    expect(picked.ok).toBe(true);
    if (!picked.ok) return;
    expect(picked.ids).toEqual(["a", "b"]);
  });

  it("keepActive 为 true 时留着当前页", () => {
    const picked = pickTabsToClose({
      tabs,
      activeId: "a",
      match: "toutiao",
      batch: true,
      keepActive: true,
    });
    expect(picked.ok).toBe(true);
    if (!picked.ok) return;
    expect(picked.ids).toEqual(["b", "studio"]);
  });

  it("批量关闭跳过工作台和阅读页", () => {
    const picked = pickTabsToClose({
      tabs,
      activeId: "c",
      studioId: "studio",
      readerId: "reader",
      match: "toutiao",
      batch: true,
    });
    expect(picked.ok).toBe(true);
    if (!picked.ok) return;
    expect(picked.ids).toEqual(["a", "b"]);
  });

  it("不带 match 的批量关闭直接失败", () => {
    const picked = pickTabsToClose({ tabs, activeId: "c", batch: true });
    expect(picked.ok).toBe(false);
    if (picked.ok) return;
    expect(picked.message).toContain("match");
  });

  it("单个 match 只关第一个", () => {
    const picked = pickTabsToClose({ tabs, activeId: "c", match: "toutiao", batch: false });
    expect(picked.ok).toBe(true);
    if (!picked.ok) return;
    expect(picked.ids).toEqual(["a"]);
  });
});
