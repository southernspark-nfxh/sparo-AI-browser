import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
import { TaskPool } from "../src/main/agent/task-pool.js";
import { resetPageLeases } from "../src/main/agent/page-lease.js";
import { resetMcpSessions } from "../src/main/agent/mcp-sessions.js";

const dirs: string[] = [];
afterEach(() => {
  resetMcpSessions();
  resetPageLeases();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("两个 Agent 同时派任务", () => {
  it("不同页各开一页，同页返回 tab_busy，两扇窗总览一致", () => {
    const dir = mkdtempSync(join(tmpdir(), "sparo-combo-"));
    dirs.push(dir);
    const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & {
      tabs: Map<string, { id: string; title: string; url: string; kind?: "web" | "command"; view: null; lastActiveAt: number; winId: string }>;
      taskPool: TaskPool;
      settings: { locale: string; apiKey: string };
      configDir: () => string;
      activeWinId: string;
    };
    browser.tabs = new Map([
      ["user", { id: "user", title: "我的页", url: "https://example.com", kind: "web", view: null, lastActiveAt: 1, winId: "main" }],
      ["idle", { id: "idle", title: "空页", url: "https://shop.example/idle", kind: "web", view: null, lastActiveAt: 1, winId: "main" }],
      ["command-main", { id: "command-main", title: "指挥室", url: "", kind: "command", view: null, lastActiveAt: 1, winId: "main" }],
      ["command-w2", { id: "command-w2", title: "指挥室", url: "", kind: "command", view: null, lastActiveAt: 1, winId: "w2" }],
    ]);
    browser.taskPool = new TaskPool();
    browser.settings = { locale: "zh-CN", apiKey: "k" };
    browser.configDir = () => dir;
    browser.activeWinId = "main";
    browser.activeTabId = "user";
    let opened = 0;
    browser.createAgentTab = (_url?: string, _activate = false, clientId = "") => {
      opened += 1;
      const id = `opened-${clientId}-${opened}`;
      browser.tabs.set(id, {
        id,
        title: `${clientId}的页`,
        url: "https://shop.example/item",
        kind: "web",
        view: null,
        lastActiveAt: opened,
        winId: "main",
      });
      return id;
    };
    browser.runAgentTask = () => new Promise(() => undefined);
    const switched: string[] = [];
    browser.switchTab = (id: string) => {
      switched.push(id);
      return { ok: true, message: "" };
    };

    const jia = browser.submitTask("改商品甲", { clientId: "jia" });
    const yi = browser.submitTask("改商品乙", { clientId: "yi" });
    const jiaAgain = browser.submitTask("改商品甲的第二单", { clientId: "jia" });
    const jiaPage = browser.taskPool.tasks.find((task) => task.id === jia.taskId);
    const yiPage = browser.taskPool.tasks.find((task) => task.id === yi.taskId);
    const jiaSecond = browser.taskPool.tasks.find((task) => task.id === jiaAgain.taskId);
    expect(jia.status).toBe("running");
    expect(yi.status).toBe("running");
    expect(jiaAgain.status).toBe("running");
    expect(jiaPage?.tabId).toBeTruthy();
    expect(yiPage?.tabId).toBeTruthy();
    expect(jiaSecond?.tabId).toBeTruthy();
    expect(new Set([jiaPage?.tabId, yiPage?.tabId, jiaSecond?.tabId]).size).toBe(3);
    expect(jiaPage?.clientId).toBe("jia");
    expect(yiPage?.clientId).toBe("yi");
    expect(jiaSecond?.clientId).toBe("jia");
    expect(opened).toBe(3);

    const clash = browser.submitTask("乙来抢甲的页", { clientId: "yi", tabId: jiaPage?.tabId });
    expect(clash).toMatchObject({ status: "failed", error: "tab_busy" });
    expect(browser.taskPool.tasks.filter((task) => task.tabId === jiaPage?.tabId && task.state !== "closed")).toHaveLength(1);

    const taken = browser.submitTask("用空页", { clientId: "bing", tabId: "idle" });
    expect(taken.status).toBe("queued");
    expect(browser.taskPool.tasks.find((task) => task.id === taken.taskId)?.tabId).toBe("idle");
    expect(opened).toBe(3);
    const clashIdle = browser.submitTask("再占空页", { clientId: "jia", tabId: "idle" });
    expect(clashIdle).toMatchObject({ status: "failed", error: "tab_busy" });

    const main = browser.chromeStateFor("main").overview;
    const side = browser.chromeStateFor("w2").overview;
    expect(main.map((row) => `${row.tabId}:${row.taskId}:${row.tone}`)).toEqual(
      side.map((row) => `${row.tabId}:${row.taskId}:${row.tone}`),
    );
    const liveTabs = new Set(browser.taskPool.tasks.filter((task) => task.state !== "closed").map((task) => task.tabId));
    expect(liveTabs.size).toBe(browser.taskPool.tasks.filter((task) => task.state !== "closed").length);
    for (const tabId of liveTabs) {
      const row = main.find((item) => item.tabId === tabId);
      const listed = browser.listTabs().tabs.find((tab) => tab.id === tabId)?.pageStatus;
      expect(row?.tone).toBe("green");
      expect(row?.taskId).toBe(listed?.taskId);
      expect(row?.tone).toBe(listed?.tone);
      expect(row?.agentName).toBe(listed?.agentName);
    }
    expect(browser.activeTabId).toBe("user");
    expect(switched).toEqual([]);
  });
});
