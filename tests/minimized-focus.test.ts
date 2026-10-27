import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 最小化三条路径必须真的走进壳层：采集按键、出报告、网页 window.open。
 * 只断言 coPresenceMayRestore 的返回值盖不住 did-create-window 和出报告切标签。
 */

type FocusCalls = {
  restore: number;
  show: number;
  focus: number;
  shellFocus: number;
  pageFocus: number;
  childShow: number;
  childFocus: number;
  childHide: number;
};

const calls: FocusCalls = {
  restore: 0,
  show: 0,
  focus: 0,
  shellFocus: 0,
  pageFocus: 0,
  childShow: 0,
  childFocus: 0,
  childHide: 0,
};

type FakeWc = {
  handlers: Record<string, Array<(...args: unknown[]) => void>>;
  openHandler?: (details: { url: string }) => { action: string };
  focus: () => void;
  on: (event: string, fn: (...args: unknown[]) => void) => void;
  isDestroyed: () => boolean;
  isFocused: () => boolean;
  isLoading: () => boolean;
  getURL: () => string;
  getTitle: () => string;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  setUserAgent: () => void;
  setBackgroundThrottling: () => void;
  loadURL: () => Promise<void>;
  send: () => void;
  sendInputEvent: () => void;
  setWindowOpenHandler: (fn: (details: { url: string }) => { action: string }) => void;
  executeJavaScript: () => Promise<unknown>;
  navigationHistory: { canGoBack: () => boolean; canGoForward: () => boolean };
};

function makeWc(countPageFocus: boolean): FakeWc {
  const handlers: FakeWc["handlers"] = {};
  const wc: FakeWc = {
    handlers,
    focus: () => {
      if (countPageFocus) calls.pageFocus += 1;
      else calls.shellFocus += 1;
    },
    on: (event, fn) => {
      (handlers[event] ||= []).push(fn);
    },
    isDestroyed: () => false,
    isFocused: () => false,
    isLoading: () => false,
    getURL: () => "https://example.com/",
    getTitle: () => "page",
    canGoBack: () => false,
    canGoForward: () => false,
    setUserAgent: () => undefined,
    setBackgroundThrottling: () => undefined,
    loadURL: async () => undefined,
    send: () => undefined,
    sendInputEvent: () => undefined,
    setWindowOpenHandler: (fn) => {
      wc.openHandler = fn;
    },
    executeJavaScript: async () => undefined,
    navigationHistory: { canGoBack: () => false, canGoForward: () => false },
  };
  return wc;
}

vi.mock("electron", () => ({
  BrowserWindow: class BrowserWindow {},
  WebContentsView: class WebContentsView {
    webContents = makeWc(true);
    setBounds() {}
    setVisible() {}
    on() {}
    getBounds() {
      return { x: 0, y: 76, width: 900, height: 700 };
    }
  },
  Menu: { buildFromTemplate: () => ({ popup: () => undefined }), setApplicationMenu: () => undefined },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  app: {
    getPath: () => process.cwd(),
    getAppPath: () => process.cwd(),
    isReady: () => true,
    isPackaged: false,
    on: () => undefined,
    whenReady: () => Promise.resolve(),
    getLocale: () => "zh-CN",
    getAppMetrics: () => [],
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

type MiniBrowser = SparkBrowser & {
  tabs: Map<string, { id: string; view?: { webContents: FakeWc }; url?: string; title?: string; lastActiveAt?: number; discarded?: boolean; agentOwned?: boolean }>;
  activeTabId: string;
  window: {
    isDestroyed: () => boolean;
    isMinimized: () => boolean;
    isFocused: () => boolean;
    isVisible: () => boolean;
    restore: () => void;
    show: () => void;
    focus: () => void;
    flashFrame: () => void;
    getContentSize: () => [number, number];
    getBounds: () => { x: number; y: number; width: number; height: number };
    webContents: FakeWc;
    contentView: { children: unknown[]; addChildView: (view: unknown) => void; removeChildView: () => void };
  };
  settings: { locale: string };
  paused: boolean;
  sidebarW: number;
  overlay: string;
  lastGoodContent: { width: number; height: number };
  chromeGuardTimers: ReturnType<typeof setTimeout>[];
  readerTabId: string | null;
  pressKey: (key: string, tabId?: string) => Promise<{ ok: boolean; message?: string }>;
  focusPageForInput: (wc: { focus: () => void }) => void;
  focusShell: () => void;
  focusOmnibox: () => void;
  openInReaderTab: (fileUrl: string) => { ok: boolean };
  bindPageWebContents: (tab: { id: string; view: { webContents: FakeWc }; url: string; title: string; agentOwned?: boolean }) => void;
  pushChromeState: () => void;
  pushSidebarState: () => void;
};

function zeroed(): FocusCalls {
  return {
    restore: 0,
    show: 0,
    focus: 0,
    shellFocus: 0,
    pageFocus: 0,
    childShow: 0,
    childFocus: 0,
    childHide: 0,
  };
}

function bare(minimized: boolean): MiniBrowser {
  Object.assign(calls, zeroed());
  const browser = Object.create(SparkBrowser.prototype) as MiniBrowser;
  const shellWc = makeWc(false);
  browser.tabs = new Map();
  browser.activeTabId = "";
  browser.paused = false;
  browser.settings = { locale: "zh-CN" };
  browser.sidebarW = 360;
  browser.overlay = "none";
  browser.lastGoodContent = { width: 1280, height: 800 };
  browser.chromeGuardTimers = [];
  browser.readerTabId = null;
  browser.pushChromeState = () => undefined;
  browser.pushSidebarState = () => undefined;
  browser.window = {
    isDestroyed: () => false,
    isMinimized: () => minimized,
    isFocused: () => !minimized,
    isVisible: () => !minimized,
    restore: () => {
      calls.restore += 1;
    },
    show: () => {
      calls.show += 1;
    },
    focus: () => {
      calls.focus += 1;
    },
    flashFrame: () => undefined,
    getContentSize: () => (minimized ? [0, 0] : [1280, 800]),
    getBounds: () => ({ x: 0, y: 0, width: 1280, height: 800 }),
    webContents: shellWc,
    contentView: {
      children: [],
      addChildView(view) {
        this.children.push(view);
      },
      removeChildView() {},
    },
  };
  return browser;
}

function stopGuards(browser: MiniBrowser): void {
  for (const timer of browser.chromeGuardTimers || []) clearTimeout(timer);
  browser.chromeGuardTimers = [];
}

function expectNoSteal(): void {
  expect(calls.restore).toBe(0);
  expect(calls.show).toBe(0);
  expect(calls.focus).toBe(0);
  expect(calls.shellFocus).toBe(0);
  expect(calls.pageFocus).toBe(0);
  expect(calls.childShow).toBe(0);
  expect(calls.childFocus).toBe(0);
}

describe("最小化时采集、出报告、网页弹窗都不抢焦点", () => {
  const browsers: MiniBrowser[] = [];
  afterEach(() => {
    for (const browser of browsers) stopGuards(browser);
    browsers.length = 0;
  });

  it("采集按键不 restore / focus", async () => {
    const browser = bare(true);
    browsers.push(browser);
    const page = makeWc(true);
    browser.tabs.set("t", { id: "t", view: { webContents: page }, url: "https://weibo.com/", title: "微博", lastActiveAt: Date.now() });
    browser.activeTabId = "t";
    browser.focusPageForInput(page);
    const pressed = await browser.pressKey("Enter", "t");
    expect(pressed.ok).toBe(true);
    browser.focusShell();
    browser.focusOmnibox();
    expectNoSteal();
  });

  it("出报告只切阅读标签，不 restore / focus", () => {
    const browser = bare(true);
    browsers.push(browser);
    const opened = browser.openInReaderTab("file:///C:/reports/goal.html");
    expect(opened.ok).toBe(true);
    expect(browser.readerTabId).toBeTruthy();
    expectNoSteal();
  });

  it("网页 window.open 在最小化时挂起，不 show / focus", () => {
    const browser = bare(true);
    browsers.push(browser);
    const page = makeWc(true);
    const tab = { id: "p", view: { webContents: page, on() {} }, url: "https://weibo.com/", title: "微博", agentOwned: true };
    browser.tabs.set("p", tab);
    browser.activeTabId = "p";
    browser.bindPageWebContents(tab);
    const decision = page.openHandler?.({ url: "https://weibo.com/ajax/statuses/popup" });
    expect(decision).toEqual({ action: "deny" });
    const child = {
      setMenuBarVisibility() {},
      hide() {
        calls.childHide += 1;
      },
      show() {
        calls.childShow += 1;
      },
      focus() {
        calls.childFocus += 1;
      },
      webContents: { setUserAgent() {}, focus() { calls.childFocus += 1; } },
    };
    for (const fn of page.handlers["did-create-window"] || []) fn(child);
    expect(calls.childHide).toBe(1);
    expectNoSteal();
  });
});
