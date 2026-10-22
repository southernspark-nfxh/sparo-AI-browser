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

import { SparkBrowser } from "../src/main/browser.js";
import { createToolHandlers } from "../src/main/tools/index.js";

type FakeWc = {
  id: string;
  loadURL: ReturnType<typeof vi.fn>;
  executeJavaScript: ReturnType<typeof vi.fn>;
  getURL: () => string;
  getTitle: () => string;
  isDestroyed: () => boolean;
  isLoading: () => boolean;
  stop: () => void;
  once: (event: string, fn: () => void) => void;
  on: () => void;
  removeListener: () => void;
  debugger: {
    isAttached: () => boolean;
    attach: () => void;
    detach: () => void;
    sendCommand: () => Promise<unknown>;
  };
};

function fakeWc(id: string, url: string): FakeWc {
  return {
    id,
    loadURL: vi.fn(async () => undefined),
    executeJavaScript: vi.fn(async () => ({
      ok: false,
      matched: false,
      message: "miss",
      expected: "",
      actual: "",
      kind: "input",
      target: "",
      url,
      title: id,
      bodyLen: 8,
      elements: [],
      iframeCount: 0,
    })),
    getURL: () => url,
    getTitle: () => id,
    isDestroyed: () => false,
    isLoading: () => false,
    stop: () => undefined,
    once: (event, fn) => {
      if (event === "did-finish-load") queueMicrotask(fn);
    },
    on: () => undefined,
    removeListener: () => undefined,
    debugger: {
      isAttached: () => false,
      attach: () => {
        throw new Error("no debugger");
      },
      detach: () => undefined,
      sendCommand: async () => ({}),
    },
  };
}

function harness() {
  const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & {
    tabs: Map<string, { id: string; view: { webContents: FakeWc } | null; discarded?: boolean; url: string; title: string }>;
    activeTabId: string;
    agentTabId: string;
    paused: boolean;
    helpAsk: null;
    recentLearned: unknown[];
    learnedTold: Set<string>;
    chatLog: unknown[];
    settings: { locale: string };
    cdpFrames: unknown[];
    lastSnapshot: null;
    wakeTab: (id: string) => void;
    createTab: (url: string, activate?: boolean) => string;
    pushStatus: () => void;
    pushSidebarState: () => void;
  };
  const activeWc = fakeWc("active", "https://active.example/");
  const jobWc = fakeWc("job", "https://job.example/");
  browser.tabs = new Map();
  browser.activeTabId = "active";
  browser.agentTabId = "job";
  browser.paused = false;
  browser.helpAsk = null;
  browser.recentLearned = [];
  browser.learnedTold = new Set();
  browser.chatLog = [];
  browser.settings = { locale: "zh-CN" };
  browser.cdpFrames = [];
  browser.lastSnapshot = null;
  browser.pushStatus = () => undefined;
  browser.pushSidebarState = () => undefined;
  browser.tabs.set("active", {
    id: "active",
    view: { webContents: activeWc },
    url: "https://active.example/",
    title: "active",
    discarded: false,
  });
  browser.tabs.set("job", {
    id: "job",
    view: { webContents: jobWc },
    url: "https://job.example/",
    title: "job",
    discarded: false,
  });
  return { browser, activeWc, jobWc };
}

describe("viewForTab", () => {
  it("returns the named tab view", () => {
    const { browser, jobWc } = harness();
    const view = browser.viewForTab("job");
    expect(view.webContents).toBe(jobWc);
  });

  it("wakes a discarded tab and returns the restored view", () => {
    const { browser } = harness();
    const restored = { webContents: fakeWc("restored", "https://sleep.example/") };
    const tab = browser.tabs.get("job");
    if (!tab) throw new Error("missing job tab");
    tab.view = null;
    tab.discarded = true;
    const woke: string[] = [];
    browser.wakeTab = (id: string) => {
      woke.push(id);
      const row = browser.tabs.get(id);
      if (!row) return;
      row.view = restored;
      row.discarded = false;
    };
    expect(browser.viewForTab("job").webContents).toBe(restored.webContents);
    expect(woke).toEqual(["job"]);
    expect(browser.activeTabId).toBe("active");
  });

  it("throws when the tab does not exist", () => {
    const { browser } = harness();
    expect(() => browser.viewForTab("missing")).toThrow(/Tab not found: missing/);
  });
});

describe("createAgentTab", () => {
  it("opens a background tab and leaves activeTabId alone", () => {
    const { browser } = harness();
    const calls: Array<{ url: string; activate: boolean | undefined }> = [];
    browser.createTab = (url: string, activate?: boolean) => {
      calls.push({ url, activate });
      return "bg-1";
    };
    expect(browser.createAgentTab("https://example.com/job")).toBe("bg-1");
    expect(browser.createAgentTab("  ")).toBe("bg-1");
    expect(calls[0]).toEqual({ url: "https://example.com/job", activate: false });
    expect(calls[1]?.activate).toBe(false);
    expect(calls[1]?.url).toBe("https://www.baidu.com");
    expect(browser.activeTabId).toBe("active");
  });
});

describe("tools address the given tab", () => {
  it("navigate, click, fill and snapshot use tabId instead of the active tab", async () => {
    const { browser, activeWc, jobWc } = harness();
    const tools = createToolHandlers(browser);
    const nav = await tools.navigate("https://job.example/path", "job");
    expect(nav.ok).toBe(true);
    expect(jobWc.loadURL).toHaveBeenCalled();
    expect(activeWc.loadURL).not.toHaveBeenCalled();

    const clicked = await tools.click({ ref: "e1" }, "job");
    expect(clicked.ok).toBe(false);
    expect(jobWc.executeJavaScript).toHaveBeenCalled();
    expect(activeWc.executeJavaScript).not.toHaveBeenCalled();

    const filled = await tools.fill({ ref: "e1" }, "北京", "job");
    expect(filled.ok).toBe(false);
    expect(String(filled.message || "")).not.toMatch(/active/);

    const shot = await tools.snapshot(undefined, "job");
    expect(shot.ok).toBe(true);
    expect(activeWc.executeJavaScript).not.toHaveBeenCalled();
  });

  it("navigate without tabId stays on the active tab", async () => {
    const { browser, activeWc, jobWc } = harness();
    const tools = createToolHandlers(browser);
    const nav = await tools.navigate("https://active.example/home");
    expect(nav.ok).toBe(true);
    expect(activeWc.loadURL).toHaveBeenCalled();
    expect(jobWc.loadURL).not.toHaveBeenCalled();
  });
});
