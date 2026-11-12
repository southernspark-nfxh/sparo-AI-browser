import { afterEach, describe, expect, it, vi } from "vitest";

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
import { ownerForTab, registerClientName, resetMcpSessions } from "../src/main/agent/mcp-sessions.js";
import { sidebarStaysOnUserTab } from "../src/main/agent/sidebar-tab.js";

type Tab = {
  id: string;
  url: string;
  title: string;
  discarded?: boolean;
  agentStatus?: "done";
};

type Harness = SparkBrowser & {
  tabs: Map<string, Tab>;
  activeTabId: string;
  settings: { locale: string; execMode: "auto" };
  freeSoul: { run: () => Promise<{ ok: boolean; text: string }> };
  beginCloudTaskIfNeeded: () => Promise<undefined>;
  pushSidebarState: () => void;
  pushChromeState: () => void;
  layout: () => void;
  discardTab: (id: string) => boolean;
  createAgentTab: () => string;
  navigate: (url: string, opts?: { tabId?: string }) => Promise<{ ok: boolean; message: string }>;
  pageText: (tabId?: string) => Promise<{ ok: boolean; message: string; data?: { text: string; length: number } }>;
};

function harness(): Harness & { created: () => number; navTabs: string[]; pageTabs: string[] } {
  const browser = Object.create(SparkBrowser.prototype) as Harness & {
    created: () => number;
    navTabs: string[];
    pageTabs: string[];
  };
  const tabs = new Map<string, Tab>([
    ["tab-a", { id: "tab-a", url: "https://www.baidu.com", title: "百度一下" }],
  ]);
  browser.tabs = tabs;
  browser.activeTabId = "tab-a";
  browser.settings = { locale: "zh-CN", execMode: "auto" };
  browser.beginCloudTaskIfNeeded = async () => undefined;
  browser.pushSidebarState = () => undefined;
  browser.pushChromeState = () => undefined;
  browser.layout = () => undefined;
  browser.discardTab = (id: string) => {
    const tab = tabs.get(id);
    if (tab) tab.discarded = true;
    return true;
  };
  const navTabs: string[] = [];
  const pageTabs: string[] = [];
  let created = 0;
  browser.createAgentTab = () => {
    created += 1;
    if (!tabs.has("tab-b")) tabs.set("tab-b", { id: "tab-b", url: "about:blank", title: "新标签" });
    return "tab-b";
  };
  browser.navigate = async (url: string, opts?: { tabId?: string }) => {
    navTabs.push(opts?.tabId || "");
    const tab = tabs.get(opts?.tabId || "");
    if (tab) tab.url = url;
    return { ok: true, message: "opened" };
  };
  browser.pageTabs = pageTabs;
  browser.created = () => created;
  browser.navTabs = navTabs;
  browser.pageTabs = pageTabs;
  return browser;
}

describe("T78 侧栏开站不征用当前标签", () => {
  afterEach(() => {
    resetMcpSessions();
  });

  it("没指当前页时，开站走侧栏标签并摆到眼前，用户页地址不动", async () => {
    const browser = harness();
    let during: ReturnType<SparkBrowser["listTabs"]> | undefined;
    browser.freeSoul = {
      run: async () => {
        await browser.runAgentTool("navigate", { url: "https://zh.wikipedia.org/wiki/唐朝" });
        during = browser.listTabs();
        return { ok: true, text: "汇报完了" };
      },
    };

    await browser.handleChat("打开维基百科唐朝条目逐节汇报");

    expect(browser.created()).toBe(1);
    expect(browser.activeTabId).toBe("tab-b");
    expect(browser.tabs.get("tab-a")?.url).toBe("https://www.baidu.com");
    expect(browser.navTabs).toEqual(["tab-b"]);
    expect(ownerForTab("tab-b")).toBe("agent:sidebar");
    expect(ownerForTab("tab-a")).toBe("user");
    const working = during?.tabs.find((tab) => tab.id === "tab-b");
    expect(working?.agentName).toBe("侧栏");
    expect(working?.agentSeat).toBe(0);
    expect(working?.agentState).toBe("running");
    expect(during?.activeId).toBe("tab-b");
    const user = during?.tabs.find((tab) => tab.id === "tab-a");
    expect(user?.agentName).toBeUndefined();
    expect(user?.owner).toBe("user");

    const done = browser.listTabs().tabs.find((tab) => tab.id === "tab-b");
    // 工位就在人眼前，收工后不挂「已下班」角标，也不再休眠它。
    expect(done?.agentStatus).toBeUndefined();
    expect(done?.agentState).toBe("idle");

    browser.freeSoul = {
      run: async () => {
        await browser.runAgentTool("navigate", { url: "https://zh.wikipedia.org/wiki/宋朝" });
        return { ok: true, text: "下一句也汇报完了" };
      },
    };
    await browser.handleChat("再打开宋朝条目");
    expect(browser.created()).toBe(1);
    expect(browser.navTabs.at(-1)).toBe("tab-b");
    expect(browser.activeTabId).toBe("tab-b");
    expect(browser.tabs.get("tab-a")?.url).toBe("https://www.baidu.com");

    const other = registerClientName("job-1");
    expect(other.seat).toBe(1);
    expect(other.name).toBe("Agent 甲");
  });

  it("划词和读当前页不新建标签", async () => {
    const browser = harness();
    browser.pageText = async (tabId?: string) => {
      browser.pageTabs.push(tabId || "");
      return { ok: true, message: "page_text", data: { text: "正文", length: 2 } };
    };
    browser.freeSoul = {
      run: async () => {
        await browser.runAgentTool("page_text", {});
        return { ok: true, text: "解释完了" };
      },
    };
    await browser.handleChat("这段在说什么", undefined, [{ text: "选中的句子", kind: "page" }]);
    expect(browser.created()).toBe(0);
    expect(browser.pageTabs).toEqual(["tab-a"]);
    expect(browser.tabs.has("tab-b")).toBe(false);

    await browser.handleChat("总结当前页");
    expect(browser.created()).toBe(0);
    expect(browser.pageTabs).toEqual(["tab-a", "tab-a"]);
    expect(browser.activeTabId).toBe("tab-a");
  });

  it("page_text 不传 tabId 仍读用户当前标签", async () => {
    const browser = harness();
    delete (browser as unknown as { pageText?: unknown }).pageText;
    const seen: string[] = [];
    browser.viewForTab = (id: string) => {
      seen.push(id);
      return {
        webContents: {
          executeJavaScript: async () => ({ text: "百度一下", length: 4 }),
        },
      } as never;
    };
    const result = await browser.pageText();
    expect(seen[0]).toBe("tab-a");
    expect(result.ok).toBe(true);
  });

  it("MCP 作用域里的标签不被侧栏工位抢走", async () => {
    const browser = harness();
    (browser as unknown as { freeSoulRunning: boolean }).freeSoulRunning = true;
    (browser as unknown as { sidebarOwnTab: boolean }).sidebarOwnTab = true;
    (browser as unknown as { taskScope: { getStore: () => { tabId: string } } }).taskScope = {
      getStore: () => ({ tabId: "tab-mcp" }),
    };
    await browser.runAgentTool("navigate", { url: "https://example.com/agent" });
    expect(browser.created()).toBe(0);
    expect(browser.navTabs).toEqual(["tab-mcp"]);
    expect(browser.activeTabId).toBe("tab-a");
  });

  it("没点名当前页才离开用户标签", () => {
    expect(sidebarStaysOnUserTab("打开维基百科唐朝条目", [])).toBe(false);
    expect(sidebarStaysOnUserTab("总结当前页", [])).toBe(true);
    expect(sidebarStaysOnUserTab("填这页的表", [])).toBe(true);
    expect(sidebarStaysOnUserTab("帮我看看", [{ text: "划词" }])).toBe(true);
  });
});
