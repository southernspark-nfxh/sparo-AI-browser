import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    getAppMetrics: () => [
      { type: "Browser", memory: { workingSetSize: 800 * 1024 } },
      { type: "Tab", memory: { workingSetSize: 256 * 1024 } },
      { type: "Tab", memory: { workingSetSize: 256 * 1024 } },
      { type: "GPU", memory: { workingSetSize: 64 * 1024 } },
    ],
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

import { SparkBrowser, formatTabMemoryBoard } from "../src/main/browser.js";
import { loadSettings } from "../src/main/settings/store.js";

type TabRow = {
  id: string;
  view: { webContents: ReturnType<typeof fakeWc> } | null;
  url: string;
  title: string;
  discarded?: boolean;
  lastActiveAt: number;
  agentStatus?: "done";
  holdHuman?: boolean;
};

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), "sparo-mem-"));
  dirs.push(d);
  return d;
}

function fakeWc(id: string, url: string) {
  return {
    id,
    loadURL: vi.fn(async () => undefined),
    getURL: () => url,
    getTitle: () => id,
    isDestroyed: () => false,
    isCurrentlyAudible: () => false,
    canGoBack: () => false,
    canGoForward: () => false,
    close: () => undefined,
    isLoading: () => false,
    on: () => undefined,
    once: () => undefined,
  };
}

function harness() {
  const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & {
    tabs: Map<string, TabRow>;
    activeTabId: string;
    agentTabId: string;
    activeMission?: { state?: string };
    readerTabId: string | null;
    settings: { locale: string; memorySaver?: boolean; memorySaverIdleMinutes?: number };
    window: { contentView: { removeChildView: () => void } };
    layout: () => void;
    pushChromeState: () => void;
    pushSidebarState: () => void;
    focusActivePage: () => void;
    createTab: (url: string, activate?: boolean) => string;
    configDir: () => string;
  };
  browser.tabs = new Map();
  browser.activeTabId = "active";
  browser.agentTabId = "";
  browser.activeMission = undefined;
  browser.readerTabId = null;
  browser.settings = { locale: "zh", memorySaver: true, memorySaverIdleMinutes: 5 };
  browser.window = { contentView: { removeChildView: () => undefined } };
  browser.layout = () => undefined;
  browser.pushChromeState = () => undefined;
  browser.pushSidebarState = () => undefined;
  browser.focusActivePage = () => undefined;
  browser.configDir = () => tmpDir();
  const active = fakeWc("active", "https://active.example/");
  const job = fakeWc("job", "https://job.example/");
  browser.tabs.set("active", {
    id: "active",
    view: { webContents: active },
    url: "https://active.example/",
    title: "active",
    discarded: false,
    lastActiveAt: Date.now(),
  });
  browser.tabs.set("job", {
    id: "job",
    view: { webContents: job },
    url: "https://job.example/",
    title: "job",
    discarded: false,
    lastActiveAt: Date.now(),
  });
  return { browser, job };
}

describe("releaseAgentTab", () => {
  it("discards a finished background tab and marks it done", () => {
    const { browser } = harness();
    browser.releaseAgentTab("job");
    const tab = browser.tabs.get("job");
    expect(tab?.discarded).toBe(true);
    expect(tab?.view).toBeNull();
    expect(tab?.agentStatus).toBe("done");
    expect(browser.tabs.has("job")).toBe(true);
    expect(browser.activeTabId).toBe("active");
  });

  it("does not discard a tab that is waiting_human", () => {
    const { browser, job } = harness();
    browser.agentTabId = "job";
    browser.activeMission = { state: "waiting_human" };
    browser.releaseAgentTab("job");
    const tab = browser.tabs.get("job");
    expect(tab?.discarded).toBeFalsy();
    expect(tab?.view?.webContents).toBe(job);
    expect(tab?.agentStatus).toBeUndefined();
  });

  it("does not discard when the tab itself is held for a human", () => {
    const { browser } = harness();
    const tab = browser.tabs.get("job");
    if (!tab) throw new Error("missing job");
    tab.holdHuman = true;
    browser.releaseAgentTab("job");
    expect(tab.discarded).toBeFalsy();
    expect(tab.view).not.toBeNull();
  });

  it("leaves the tab the user is looking at awake", () => {
    const { browser } = harness();
    browser.releaseAgentTab("active");
    const tab = browser.tabs.get("active");
    expect(tab?.discarded).toBeFalsy();
    expect(tab?.view).not.toBeNull();
  });
});

describe("reader tab reuse", () => {
  function reports(browser: ReturnType<typeof harness>["browser"]) {
    const dir = tmpDir();
    const reportsDir = join(dir, "reports");
    mkdirSync(reportsDir, { recursive: true });
    browser.configDir = () => dir;
    const a = join(reportsDir, "a.html");
    const b = join(reportsDir, "b.html");
    writeFileSync(a, "<p>a</p>");
    writeFileSync(b, "<p>b</p>");
    let n = 0;
    browser.createTab = (url: string) => {
      n += 1;
      const id = `reader-${n}`;
      browser.tabs.set(id, {
        id,
        view: { webContents: fakeWc(id, url) },
        url,
        title: id,
        discarded: false,
        lastActiveAt: Date.now(),
      });
      browser.activeTabId = id;
      return id;
    };
    browser.switchTab = ((id: string) => {
      browser.activeTabId = id;
      return { ok: true, message: "switched" };
    }) as SparkBrowser["switchTab"];
    return { a, b, created: () => n };
  }

  it("reuses one reader tab for a second report", () => {
    const { browser } = harness();
    const { a, b, created } = reports(browser);
    const first = browser.openReport(a);
    const second = browser.openReport(b);
    const firstId = (first.data as { id?: string }).id;
    const secondId = (second.data as { id?: string; reused?: boolean }).id;
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(secondId).toBe(firstId);
    expect((second.data as { reused?: boolean }).reused).toBe(true);
    expect(created()).toBe(1);
    expect(browser.readerTabId).toBe(firstId);
    const tab = browser.tabs.get(String(firstId));
    expect(tab?.view?.webContents.loadURL).toHaveBeenCalled();
  });

  it("opens a new reader tab after the user closes the old one", () => {
    const { browser } = harness();
    const { a, b, created } = reports(browser);
    const first = browser.openReport(a);
    const id = String((first.data as { id?: string }).id);
    browser.closeTab(id);
    expect(browser.readerTabId).toBeNull();
    const second = browser.openReport(b);
    expect((second.data as { id?: string }).id).not.toBe(id);
    expect((second.data as { reused?: boolean }).reused).toBe(false);
    expect(created()).toBe(2);
  });

  it("does not reuse the reader tab for a manually opened page", () => {
    const { browser } = harness();
    const { a, created } = reports(browser);
    const report = browser.openReport(a);
    const readerId = (report.data as { id?: string }).id;
    const manual = browser.newTab("https://example.com/research");
    expect((manual.data as { id?: string }).id).not.toBe(readerId);
    expect(browser.readerTabId).toBe(readerId);
    expect(created()).toBe(2);
  });
});

describe("autoDiscardIdleTabs default", () => {
  it("sleeps after the 5 minute default and still honors an explicit 2", () => {
    const { browser } = harness();
    browser.settings.memorySaverIdleMinutes = 0;
    const tab = browser.tabs.get("job");
    if (!tab) throw new Error("missing job");
    tab.lastActiveAt = Date.now() - 4 * 60_000;
    (browser as unknown as { autoDiscardIdleTabs: () => void }).autoDiscardIdleTabs();
    expect(tab.discarded).toBeFalsy();
    tab.lastActiveAt = Date.now() - 6 * 60_000;
    (browser as unknown as { autoDiscardIdleTabs: () => void }).autoDiscardIdleTabs();
    expect(tab.discarded).toBe(true);

    const again = harness();
    again.browser.settings.memorySaverIdleMinutes = 2;
    const other = again.browser.tabs.get("job");
    if (!other) throw new Error("missing job");
    other.lastActiveAt = Date.now() - 90_000;
    (again.browser as unknown as { autoDiscardIdleTabs: () => void }).autoDiscardIdleTabs();
    expect(other.discarded).toBeFalsy();
    other.lastActiveAt = Date.now() - 3 * 60_000;
    (again.browser as unknown as { autoDiscardIdleTabs: () => void }).autoDiscardIdleTabs();
    expect(other.discarded).toBe(true);
  });
});

describe("memory saver defaults", () => {
  it("turns memory saver on at 5 minutes for a new install", () => {
    const dir = tmpDir();
    const fresh = loadSettings(dir);
    expect(fresh.memorySaver).toBe(true);
    expect(fresh.memorySaverIdleMinutes).toBe(5);
    expect(formatTabMemoryBoard("zh", 2, 512)).toBe("2 个标签进程 · 约 512 MB");
  });

  it("does not rewrite an existing settings.json that turned memory saver off", () => {
    const dir = tmpDir();
    const raw = JSON.stringify({ memorySaver: false, memorySaverIdleMinutes: 2, locale: "zh" });
    writeFileSync(join(dir, "settings.json"), raw);
    const loaded = loadSettings(dir);
    expect(loaded.memorySaver).toBe(false);
    expect(loaded.memorySaverIdleMinutes).toBe(2);
    expect(readFileSync(join(dir, "settings.json"), "utf8")).toBe(raw);
  });

  it("summarizes tab renderer processes", () => {
    const { browser } = harness();
    expect(browser.memoryBoardLine()).toBe("2 个标签进程 · 约 512 MB");
  });
});
