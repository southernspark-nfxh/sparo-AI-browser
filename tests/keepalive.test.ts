import { describe, expect, it, vi } from "vitest";

/**
 * Electron 的最小化 / restore / flashFrame 在 vitest 里没有真窗口。
 * 这里只锁 makePageView 的节流参数，以及「后台不抢屏、前台只拉回一次」的分支。
 * 窗口最小化全程不弹、完成时任务栏闪烁，靠开发窗人测。
 */

const createdViews = vi.hoisted(() => ({
  list: [] as Array<{ webPreferences?: { backgroundThrottling?: boolean } }>,
}));

vi.mock("electron", () => ({
  BrowserWindow: class BrowserWindow {},
  WebContentsView: class WebContentsView {
    webContents = {
      setUserAgent: () => undefined,
      setBackgroundThrottling: () => undefined,
      on: () => undefined,
      isDestroyed: () => false,
    };
    constructor(opts?: { webPreferences?: { backgroundThrottling?: boolean } }) {
      createdViews.list.push(opts || {});
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

type KeepBrowser = SparkBrowser & {
  makePageView: (envId?: string, opts?: { agentOwned?: boolean }) => { webContents: { setBackgroundThrottling: (on: boolean) => void } };
  createTab: (url: string, activate?: boolean, opts?: { agentOwned?: boolean }) => string;
  bindPageWebContents: (tab: { id: string; agentOwned?: boolean; view: { webContents: { setBackgroundThrottling: (on: boolean) => void; setUserAgent: () => void; setWindowOpenHandler: () => void; on: () => void; isDestroyed: () => boolean } }; url: string; title: string; lastActiveAt: number }) => void;
  settings: { locale: string };
  createAgentTab: (url?: string) => string;
  chatRunning: boolean;
  activeMission?: { state?: string; goal?: { kind?: string } };
  coPresenceRestored: boolean;
  lastNotifiedChat: number;
  taskbarFlashing: boolean;
  didPlaceWindow: boolean;
  chatLog: Array<{ role: string; text: string }>;
  window: {
    isDestroyed: () => boolean;
    isMinimized: () => boolean;
    isFocused: () => boolean;
    focus: ReturnType<typeof vi.fn>;
    flashFrame: (on: boolean) => void;
    webContents: { isDestroyed: () => boolean; setBackgroundThrottling: (on: boolean) => void };
  };
  syncShellKeepalive: () => void;
  setShellBackgroundThrottling: (throttle: boolean) => void;
  noteSidebarMessages: () => void;
  maybeRestoreForCoPresence: (actionType?: string, userAsk?: string) => void;
  restoreForCoPresence: () => void;
  ensureWindowVisible: (recenter?: boolean) => void;
  focusPageForInput: (wc: { focus: () => void }) => void;
  agentTasksRunning: () => boolean;
};

function bare(): KeepBrowser {
  return Object.create(SparkBrowser.prototype) as KeepBrowser;
}

describe("makePageView throttling", () => {
  it("turns background throttling off only for agent-owned views", () => {
    createdViews.list.length = 0;
    const browser = bare();
    browser.makePageView(undefined, { agentOwned: true });
    browser.makePageView();
    browser.makePageView(undefined, { agentOwned: false });
    expect(createdViews.list.map((v) => v.webPreferences?.backgroundThrottling)).toEqual([
      false,
      true,
      true,
    ]);
  });

  it("createAgentTab asks for an unthrottled background tab", () => {
    const browser = bare();
    const calls: Array<{ url: string; activate: boolean | undefined; agentOwned?: boolean }> = [];
    browser.createTab = (url, activate, opts) => {
      calls.push({ url, activate, agentOwned: opts?.agentOwned });
      return "bg-1";
    };
    expect(browser.createAgentTab("https://example.com/job")).toBe("bg-1");
    expect(calls[0]).toEqual({
      url: "https://example.com/job",
      activate: false,
      agentOwned: true,
    });
  });

  it("bindPageWebContents keeps user tabs throttled and agent tabs live", () => {
    const browser = bare();
    browser.settings = { locale: "zh-CN" };
    const flags: boolean[] = [];
    const wc = {
      setBackgroundThrottling: (on: boolean) => flags.push(on),
      setUserAgent: () => undefined,
      setWindowOpenHandler: () => undefined,
      on: () => undefined,
      isDestroyed: () => false,
    };
    browser.bindPageWebContents({
      id: "user",
      view: { webContents: wc },
      url: "https://example.com",
      title: "user",
      lastActiveAt: 1,
    });
    browser.bindPageWebContents({
      id: "agent",
      agentOwned: true,
      view: { webContents: wc },
      url: "https://example.com/job",
      title: "job",
      lastActiveAt: 1,
    });
    expect(flags).toEqual([true, false]);
  });
});

describe("background tasks do not steal the window", () => {
  function shell() {
    const browser = bare();
    const throttle: boolean[] = [];
    const flashes: boolean[] = [];
    const restores: number[] = [];
    let minimized = true;
    let focused = false;
    browser.chatRunning = false;
    browser.activeMission = undefined;
    browser.coPresenceRestored = false;
    browser.lastNotifiedChat = -1;
    browser.taskbarFlashing = false;
    browser.didPlaceWindow = true;
    browser.chatLog = [];
    browser.window = {
      isDestroyed: () => false,
      isMinimized: () => minimized,
      isFocused: () => focused,
      focus: vi.fn(),
      flashFrame: (on: boolean) => flashes.push(on),
      webContents: {
        isDestroyed: () => false,
        setBackgroundThrottling: (on: boolean) => throttle.push(on),
      },
    };
    browser.ensureWindowVisible = () => {
      restores.push(1);
    };
    return {
      browser,
      throttle,
      flashes,
      restores,
      setMinimized: (on: boolean) => {
        minimized = on;
      },
      setFocused: (on: boolean) => {
        focused = on;
      },
    };
  }

  it("holds shell throttling only while a task runs minimized", () => {
    const { browser, throttle } = shell();
    browser.syncShellKeepalive();
    expect(throttle.at(-1)).toBe(true);
    browser.chatRunning = true;
    browser.syncShellKeepalive();
    expect(throttle.at(-1)).toBe(false);
    browser.chatRunning = false;
    browser.activeMission = { state: "running", goal: { kind: "research" } };
    browser.syncShellKeepalive();
    expect(browser.agentTasksRunning()).toBe(true);
    expect(throttle.at(-1)).toBe(false);
  });

  it("flashes the taskbar for a new sidebar line and does not restore", () => {
    const { browser, flashes, restores } = shell();
    browser.chatLog = [{ role: "assistant", text: "已有" }];
    browser.noteSidebarMessages();
    expect(flashes).toEqual([]);
    browser.chatLog.push({ role: "assistant", text: "手册好了" });
    browser.noteSidebarMessages();
    expect(flashes).toEqual([true]);
    expect(restores).toEqual([]);
  });

  it("restores once for a reply and never for a research ask", () => {
    const { browser, restores } = shell();
    browser.maybeRestoreForCoPresence(undefined, "对比三款轻薄本，出一份报告");
    expect(restores).toEqual([]);
    browser.maybeRestoreForCoPresence(undefined, "帮我回当前页评论");
    browser.maybeRestoreForCoPresence("one_click_reply", "帮我回当前页评论");
    expect(restores).toEqual([1]);
  });

  it("does not focus a minimized window from the click path", () => {
    const { browser } = shell();
    const wc = { focus: vi.fn() };
    browser.focusPageForInput(wc);
    expect(browser.window.focus).not.toHaveBeenCalled();
    expect(wc.focus).not.toHaveBeenCalled();
  });
});
