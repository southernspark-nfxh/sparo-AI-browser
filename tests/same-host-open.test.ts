import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: class BrowserWindow {},
  WebContentsView: class WebContentsView {},
  Menu: { buildFromTemplate: () => ({ popup: () => undefined }) },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  app: { getPath: () => process.cwd(), getAppPath: () => process.cwd(), isReady: () => true, isPackaged: false, on: () => undefined, whenReady: () => Promise.resolve(), getAppMetrics: () => [] },
  ipcMain: { handle: () => undefined, on: () => undefined },
  session: { defaultSession: {}, fromPartition: () => ({}) },
  clipboard: { writeText: () => undefined, readText: () => "" },
  shell: { openExternal: async () => undefined },
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1280, height: 800 }, workAreaSize: { width: 1280, height: 800 } }) },
}));

import { decideSameHostOpen, SparkBrowser } from "../src/main/browser.js";

const home = "https://baijiahao.baidu.com/builder/rc/home";

describe("同站开页守卫", () => {
  it("new_tab 同站第三次被拒绝，用户自己的页不算", () => {
    const tabs = [
      { id: "user", url: home, agentOwned: false },
      { id: "a", url: home, agentOwned: true },
    ];
    expect(decideSameHostOpen("new_tab", home, tabs).action).toBe("allow");
    tabs.push({ id: "b", url: "https://baijiahao.baidu.com/", agentOwned: true });
    const refused = decideSameHostOpen("new_tab", "https://baijiahao.baidu.com/builder/rc/content", tabs);
    expect(refused.action).toBe("refuse");
    if (refused.action === "refuse") expect(refused.message).toContain("已经开了 2 个百家号标签");
  });

  it("已有同站标签时 navigate 切回去", () => {
    const decision = decideSameHostOpen("navigate", home, [
      { id: "a", url: "https://baijiahao.baidu.com/", agentOwned: true },
    ]);
    expect(decision).toEqual({ action: "switch", tabId: "a" });
  });

  it("连续三次 new_tab 同站，第三次被工具入口拦住", async () => {
    const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & {
      tabs: Map<string, { id: string; url: string; agentOwned: boolean; kind: "web"; title: string; view: null; lastActiveAt: number }>;
      activeTabId: string;
    };
    browser.tabs = new Map();
    browser.activeTabId = "stay";
    browser.createTab = ((url: string) => {
      const id = "t" + (browser.tabs.size + 1);
      browser.tabs.set(id, { id, url, agentOwned: true, kind: "web", title: url, view: null, lastActiveAt: 1 });
      return id;
    }) as SparkBrowser["createTab"];
    const switched: string[] = [];
    browser.switchTab = ((id: string) => {
      switched.push(id);
      return { ok: true, message: "" };
    }) as SparkBrowser["switchTab"];
    const first = await browser.runCoreTool("new_tab", { url: home });
    const second = await browser.runCoreTool("new_tab", { url: "https://baijiahao.baidu.com/" });
    const third = await browser.runCoreTool("new_tab", { url: "https://baijiahao.baidu.com/builder/rc/content" });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(third.ok).toBe(false);
    expect(third.message).toContain("已经开了 2 个百家号标签");
    expect(browser.tabs.size).toBe(2);
    browser.navigate = (async (_url: string, opts?: { tabId?: string }) => ({ ok: true, message: "切过去了", data: opts })) as SparkBrowser["navigate"];
    const moved = await browser.runCoreTool("navigate", { url: home });
    expect(switched.at(-1)).toBe("t2");
    expect(moved.ok).toBe(true);
    expect(browser.tabs.size).toBe(2);
  });
});
