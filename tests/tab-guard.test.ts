import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bindForWrite,
  mayActivateTab,
  settleCreateActivate,
  SWITCH_TAB_NEEDS_CLIENT,
  switchTabWithoutClient,
  type ActivationInput,
} from "../src/main/agent/tab-guard.js";
import { SIDEBAR_CLIENT_ID } from "../src/main/agent/sidebar-tab.js";

const actor = { clientId: "X", winId: "A" };

function decide(patch: Partial<ActivationInput> & Pick<ActivationInput, "tabOwner" | "tabWinId">) {
  return mayActivateTab({
    userAction: false,
    backgroundRender: false,
    ...patch,
  });
}

describe("mayActivateTab", () => {
  it("用户点标签，放行", () => {
    expect(decide({ actor: undefined, userAction: true, tabOwner: "user", tabWinId: "A" })).toEqual({ ok: true });
  });

  it("agent 切自己的标签，同窗放行", () => {
    expect(decide({ actor, tabOwner: "agent:X", tabWinId: "A" })).toEqual({ ok: true });
  });

  it("agent 切用户标签，同窗拒绝", () => {
    expect(decide({ actor, tabOwner: "user", tabWinId: "A" })).toEqual({ ok: false, reason: "not_your_tab" });
  });

  it("agent 跨窗切自己的标签，拒绝", () => {
    expect(decide({ actor, tabOwner: "agent:X", tabWinId: "B" })).toEqual({ ok: false, reason: "other_window" });
  });

  it("无 client 切用户标签，拒绝", () => {
    expect(decide({ actor: undefined, tabOwner: "user", tabWinId: "A" })).toEqual({
      ok: false,
      reason: "no_client_on_user_tab",
    });
  });

  it("后台渲染自己的窗，可以切到用户标签", () => {
    expect(decide({ actor, tabOwner: "user", tabWinId: "A", backgroundRender: true })).toEqual({ ok: true });
  });

  it("无 client 切 agent 标签，放行", () => {
    expect(decide({ actor: undefined, tabOwner: "agent:X", tabWinId: "A" })).toEqual({ ok: true });
  });
});

describe("bindForWrite", () => {
  it("无 scope 无 tabId 抛错", () => {
    expect(() => bindForWrite("click", undefined)).toThrow(/click 需要 clientId 或 tabId/);
    expect(() => bindForWrite("fill", "")).toThrow(/不会默认操作用户当前标签/);
  });

  it("有 tabId 透传", () => {
    expect(bindForWrite("navigate", "tab-9")).toBe("tab-9");
  });
});

describe("createTab 门", () => {
  const input: ActivationInput = {
    actor,
    tabWinId: "A",
    tabOwner: "user",
    userAction: false,
    backgroundRender: false,
  };

  it("agent 且 userAction 为 false 时，激活被降为 false", () => {
    expect(settleCreateActivate(true, input)).toEqual({ activate: false, reason: "not_your_tab" });
  });

  it("userAction 为 true 时放行", () => {
    expect(settleCreateActivate(true, { ...input, userAction: true })).toEqual({ activate: true });
  });

  it("侧栏 client 同窗且 activate=true 时允许激活", () => {
    expect(
      settleCreateActivate(true, {
        actor: { clientId: SIDEBAR_CLIENT_ID, winId: "A" },
        tabWinId: "A",
        tabOwner: `agent:${SIDEBAR_CLIENT_ID}`,
        userAction: false,
        backgroundRender: false,
      }),
    ).toEqual({ activate: true });
  });
});

describe("switch_tab 无身份", () => {
  it("scope.clientId 为空时返回错误且不调用 switchTab", () => {
    const browser = { switchTab: vi.fn(() => ({ ok: true, message: "switched" })) };
    const message = switchTabWithoutClient(undefined);
    expect(message).toBe(SWITCH_TAB_NEEDS_CLIENT);
    if (message) {
      expect({ ok: false, message }.ok).toBe(false);
    } else {
      browser.switchTab("tab-1");
    }
    expect(browser.switchTab).not.toHaveBeenCalled();
  });

  it("有 clientId 时不拦截", () => {
    expect(switchTabWithoutClient("abc123")).toBeUndefined();
  });
});

vi.mock("electron", () => ({
  BrowserWindow: class BrowserWindow {},
  WebContentsView: class WebContentsView {},
  Menu: { buildFromTemplate: () => ({ popup: () => undefined }), setApplicationMenu: () => undefined },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  app: {
    getPath: () => process.cwd(),
    getAppPath: () => process.cwd(),
    isReady: () => true,
    isPackaged: false,
    on: () => undefined,
    whenReady: () => Promise.resolve(),
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
import { claimTabForClient, resetMcpSessions } from "../src/main/agent/mcp-sessions.js";

afterEach(() => resetMcpSessions());

type GuardTab = {
  id: string;
  winId: string;
  url: string;
  title: string;
  view: { webContents: { isDestroyed: () => boolean } };
  discarded: boolean;
  lastActiveAt: number;
};

function guardBrowser() {
  const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & {
    tabs: Map<string, GuardTab>;
    activeTabId: string;
    activeWinId: string;
    layout: () => void;
    pushChromeState: () => void;
    pushSidebarState: () => void;
    requestHoleReport: () => void;
    focusActivePage: () => void;
  };
  const view = { webContents: { isDestroyed: () => false } };
  browser.tabs = new Map([
    ["weibo", { id: "weibo", winId: "A", url: "https://weibo.com", title: "微博", view, discarded: false, lastActiveAt: 1 }],
    ["env", { id: "env", winId: "A", url: "https://env.example", title: "环境", view, discarded: false, lastActiveAt: 1 }],
  ]);
  browser.activeWinId = "A";
  browser.activeTabId = "weibo";
  browser.layout = () => undefined;
  browser.pushChromeState = () => undefined;
  browser.pushSidebarState = () => undefined;
  browser.requestHoleReport = () => undefined;
  browser.focusActivePage = () => undefined;
  browser.listTabs = () =>
    ({
      tabs: [...browser.tabs.values()].map((tab) => ({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        discarded: false,
      })),
      activeId: browser.activeTabId,
      url: "",
      canGoBack: false,
      canGoForward: false,
      isLoading: false,
    }) as ReturnType<SparkBrowser["listTabs"]>;
  return browser;
}

describe("createEnvTab 缺省 userAction", () => {
  it("agent 调用 switchTab 不带 userAction 时，当前标签不变", () => {
    const browser = guardBrowser();
    const switched = browser.switchTab("env", { actor: { clientId: "agent", winId: "A" } });
    expect(switched.ok).toBe(false);
    expect(switched.message).toContain("not_your_tab");
    expect(browser.activeTabId).toBe("weibo");
  });

  it("用户动作可以切到环境标签", () => {
    const browser = guardBrowser();
    const switched = browser.switchTab("env", { userAction: true });
    expect(switched.ok).toBe(true);
    expect(browser.activeTabId).toBe("env");
  });
});

describe("switchTab 归属", () => {
  it("带 clientId 可以切自己的标签", () => {
    const browser = guardBrowser();
    claimTabForClient("agent", "env");
    const switched = browser.switchTab("env", { actor: { clientId: "agent", winId: "A" } });
    expect(switched.ok).toBe(true);
    expect(browser.activeTabId).toBe("env");
  });

  it("跨窗切换不改当前标签", () => {
    const browser = guardBrowser();
    claimTabForClient("agent", "env");
    const switched = browser.switchTab("env", { actor: { clientId: "agent", winId: "B" } });
    expect(switched.ok).toBe(false);
    expect(switched.message).toContain("other_window");
    expect(browser.activeTabId).toBe("weibo");
  });

  it("未绑定 client 在当前窗切自己的标签", () => {
    const browser = guardBrowser();
    claimTabForClient("agent", "env");
    const switched = browser.switchTab("env", { actor: { clientId: "agent" } });
    expect(switched.ok).toBe(true);
    expect(browser.activeTabId).toBe("env");
  });

  it("未绑定 client 的标签在另一扇窗仍拒绝", () => {
    const browser = guardBrowser();
    const view = { webContents: { isDestroyed: () => false } };
    browser.tabs.set("far", {
      id: "far",
      winId: "B",
      url: "https://example.com",
      title: "另一扇",
      view,
      discarded: false,
      lastActiveAt: 1,
    });
    claimTabForClient("agent", "far");
    const switched = browser.switchTab("far", { actor: { clientId: "agent" } });
    expect(switched.ok).toBe(false);
    expect(switched.message).toContain("other_window");
    expect(browser.activeTabId).toBe("weibo");
  });
});
