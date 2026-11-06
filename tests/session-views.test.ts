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
import { TaskPool } from "../src/main/agent/task-pool.js";
import { registerClientName, resetMcpSessions } from "../src/main/agent/mcp-sessions.js";

afterEach(() => resetMcpSessions());

describe("T61 使用中只列当前", () => {
  it("三个都结束并关标签后只剩用户，还有一个在跑就留两个", () => {
    const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & {
      chatSessions: Map<string, Array<{ role: string; text: string }>>;
      tabs: Map<string, { id: string }>;
      taskPool: TaskPool;
      selectedSession: string;
      sessionViews: () => Array<{ key: string }>;
    };
    browser.chatSessions = new Map([
      ["user", []],
      ["agent:a", [{ role: "assistant", text: "甲" }]],
      ["agent:b", [{ role: "assistant", text: "乙" }]],
      ["agent:c", [{ role: "assistant", text: "丙" }]],
    ]);
    browser.tabs = new Map();
    browser.taskPool = new TaskPool();
    browser.selectedSession = "agent:b";
    registerClientName("a", "验收甲");
    registerClientName("b", "验收乙");
    registerClientName("c", "验收丙");

    expect(browser.sessionViews().map((item) => item.key)).toEqual(["user"]);
    expect(browser.selectedSession).toBe("user");
    expect(browser.chatSessions.has("agent:a")).toBe(false);
    expect(browser.chatSessions.has("agent:b")).toBe(false);
    expect(browser.chatSessions.has("agent:c")).toBe(false);

    browser.chatSessions.set("agent:a", []);
    browser.chatSessions.set("agent:b", []);
    browser.chatSessions.set("agent:c", []);
    browser.taskPool.start({
      id: "job",
      tabId: "",
      title: "还在跑",
      lane: "background",
      clientId: "b",
    });
    expect(browser.sessionViews().map((item) => item.key)).toEqual(["user", "agent:b"]);
  });
});
