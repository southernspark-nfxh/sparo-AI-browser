import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: class BrowserWindow {},
  WebContentsView: class WebContentsView {},
  Menu: { buildFromTemplate: () => ({ popup: () => undefined }) },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  app: {
    getPath: () => process.cwd(),
    getAppPath: () => process.cwd(),
    isReady: () => true,
    isPackaged: false,
    on: () => undefined,
    whenReady: () => Promise.resolve(),
  },
  ipcMain: { handle: () => undefined, on: () => undefined, removeHandler: () => undefined },
  session: { defaultSession: {}, fromPartition: () => ({}) },
  clipboard: { writeText: () => undefined, readText: () => "" },
  shell: { openExternal: async () => undefined, openPath: async () => "" },
  screen: {
    getPrimaryDisplay: () => ({
      workArea: { x: 0, y: 0, width: 1280, height: 800 },
      workAreaSize: { width: 1280, height: 800 },
    }),
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1280, height: 800 } }),
  },
}));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SparkBrowser } from "../src/main/browser.js";
import { TaskPool } from "../src/main/agent/task-pool.js";
import { allocateClientTab, resetMcpSessions } from "../src/main/agent/mcp-sessions.js";

describe("固定指挥室", () => {
  it("只有一个指挥室，不能关闭、休眠或当成网页占用", () => {
    const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & {
      tabs: Map<string, { id: string; kind?: "command" | "web"; title: string; url: string; view: null; lastActiveAt: number; winId?: string }>;
      activeWinId: string;
      taskPool: TaskPool;
      activeTabId: string;
    };
    browser.tabs = new Map();
    browser.activeWinId = "main";
    browser.taskPool = new TaskPool();
    browser.activeTabId = "web";
    const first = browser.ensureCommandRoom();
    const second = browser.ensureCommandRoom();
    expect(second).toBe(first);
    expect([...browser.tabs.values()].filter((tab) => tab.kind === "command")).toHaveLength(1);
    expect(browser.closeTab(first).ok).toBe(false);
    expect(browser.tabs.has(first)).toBe(true);
    expect(browser.discardTab(first)).toBe(false);
    expect(browser.listTabs().tabs.find((tab) => tab.id === first)?.discarded).toBe(false);
    expect(() => browser.viewForTab(first)).toThrow(/指挥室/);
    browser.tabs.set("web", {
      id: "web",
      kind: "web",
      title: "百度",
      url: "https://www.baidu.com",
      view: null,
      lastActiveAt: 1,
      winId: "main",
    });
    browser.taskPool.start({
      id: "job",
      tabId: "web",
      title: "读页",
      lane: "background",
      clientId: "jia",
      agentName: "甲",
    });
    const overview = browser.commandOverview();
    expect(overview.map((item) => item.tabId)).toEqual(["web"]);
    expect(overview[0]?.agentName).toBe("甲");
    expect(overview[0]?.state).toBe("running");
    expect(overview.some((item) => item.tabId === first)).toBe(false);
    const stolen = allocateClientTab({
      intent: "task",
      clientId: "yi",
      taskId: "steal",
      tabId: first,
      knownTabIds: [first, "web"],
      createAgentTab: () => "nope",
      occupancy: () => browser.pageOccupancy(first),
    });
    expect(stolen).toEqual({ ok: false, error: "tab_busy" });
    resetMcpSessions();
  });

  it("两个窗口的标签栏各自过滤，指挥室总览仍看到全部真实页面", () => {
    const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & {
      tabs: Map<string, { id: string; kind?: "command" | "web"; title: string; url: string; view: null; lastActiveAt: number; winId?: string }>;
      activeWinId: string;
      taskPool: TaskPool;
      activeTabId: string;
      chromeStateFor: (winId: string) => { tabs: Array<{ id: string }>; overview: Array<{ tabId: string }> };
    };
    browser.tabs = new Map([
      ["command-main", { id: "command-main", kind: "command", title: "指挥室", url: "", view: null, lastActiveAt: 1, winId: "main" }],
      ["web-a", { id: "web-a", kind: "web", title: "甲页", url: "https://a.example", view: null, lastActiveAt: 1, winId: "w1" }],
      ["web-b", { id: "web-b", kind: "web", title: "乙页", url: "https://b.example", view: null, lastActiveAt: 1, winId: "w2" }],
    ]);
    browser.activeWinId = "w1";
    browser.activeTabId = "web-a";
    browser.taskPool = new TaskPool();
    const state = browser.chromeStateFor("w1");
    expect(state.tabs.map((tab) => tab.id)).toEqual(["web-a"]);
    expect(state.overview.map((item) => item.tabId).sort()).toEqual(["web-a", "web-b"]);
  });

  it("壳层有指挥室总览，点击条目会切回原标签", () => {
    const html = readFileSync(join(process.cwd(), "src/renderer/shell.html"), "utf8");
    expect(html).toContain('id="commandRoom"');
    expect(html).toContain("renderCommandRoom");
    expect(html).toContain("switchTab");
  });
});
