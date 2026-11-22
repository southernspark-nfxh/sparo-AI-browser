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
import { TaskPool } from "../src/main/agent/task-pool.js";
import { COMMAND_SESSION_KEY, pageSessionKey, taskSessionKey } from "../src/main/agent/session-key.js";

describe("页面会话跟着当前标签", () => {
  it("切到哪一页就只看哪一页的任务，点任务卡不新开页面", () => {
    const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & {
      taskPool: TaskPool;
      tabs: Map<string, { id: string; title: string }>;
      activeTabId: string;
      chatSessions: Map<string, Array<{ role: string; text: string }>>;
      switchTab: (id: string) => void;
    };
    browser.taskPool = new TaskPool();
    (browser as unknown as { settings: { locale: string; execMode: "auto"; apiKey: string } }).settings = {
      locale: "zh-CN",
      execMode: "auto",
      apiKey: "test-key",
    };
    (browser as unknown as { approvals: Map<string, never> }).approvals = new Map();
    (browser as unknown as { skillsCache: unknown[] }).skillsCache = [];
    (browser as unknown as { recording: boolean }).recording = false;
    (browser as unknown as { paused: boolean }).paused = false;
    (browser as unknown as { configDir: () => string }).configDir = () => process.cwd();
    browser.tabs = new Map([
      ["page-a", { id: "page-a", title: "隋" }],
      ["page-b", { id: "page-b", title: "清" }],
    ]);
    browser.chatSessions = new Map([
      [taskSessionKey("page-a", "sui"), [{ role: "user", text: "隋朝导言" }]],
      [taskSessionKey("page-b", "qing"), [{ role: "user", text: "清朝导言" }]],
    ]);
    browser.taskPool.start({ id: "sui", tabId: "page-a", title: "隋", lane: "background", clientId: "ding" });
    browser.taskPool.start({ id: "qing", tabId: "page-b", title: "清", lane: "background", clientId: "ding" });
    browser.switchTab = (id: string) => {
      browser.activeTabId = id;
    };
    browser.activeTabId = "page-a";

    const first = browser.getSidebarPayload() as { selectedSession: string; chat: Array<{ text: string }> };
    expect(first.selectedSession).toBe(taskSessionKey("page-a", "sui"));
    expect(first.chat.map((turn) => turn.text).join("\n")).toContain("隋朝导言");
    expect(first.chat.map((turn) => turn.text).join("\n")).not.toContain("清朝");

    browser.activeTabId = "page-b";
    const second = browser.getSidebarPayload() as { selectedSession: string; chat: Array<{ text: string }> };
    expect(second.selectedSession).toBe(taskSessionKey("page-b", "qing"));
    expect(second.chat.map((turn) => turn.text).join("\n")).not.toContain("隋朝");

    const focused = browser.focusTask("sui");
    expect(focused.ok).toBe(true);
    expect(focused.activeId).toBe("page-a");
    expect(browser.tabs.size).toBe(2);
    expect(focused.selectedSession).toBe(taskSessionKey("page-a", "sui"));
  });

  it("任务页、空闲页和指挥室的用户输入写进各自的会话", async () => {
    const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & {
      taskPool: TaskPool;
      tabs: Map<string, { id: string; title: string; kind?: "command" | "web" }>;
      activeTabId: string;
      chatSessions: Map<string, Array<{ role: string; text: string }>>;
      pushSidebarState: () => void;
      switchTab: (id: string) => void;
    };
    browser.taskPool = new TaskPool();
    browser.tabs = new Map([
      ["job-page", { id: "job-page", title: "任务页", kind: "web" }],
      ["idle-page", { id: "idle-page", title: "空闲页", kind: "web" }],
      ["command-main", { id: "command-main", title: "指挥室", kind: "command" }],
    ]);
    browser.chatSessions = new Map();
    browser.pushSidebarState = () => undefined;
    (browser as unknown as { settings: { locale: string; execMode: "auto"; apiKey: string } }).settings = {
      locale: "zh-CN",
      execMode: "auto",
      apiKey: "test-key",
    };
    (browser as unknown as { approvals: Map<string, never> }).approvals = new Map();
    (browser as unknown as { skillsCache: unknown[] }).skillsCache = [];
    (browser as unknown as { recording: boolean }).recording = false;
    (browser as unknown as { paused: boolean }).paused = false;
    (browser as unknown as { configDir: () => string }).configDir = () => process.cwd();
    browser.switchTab = (id: string) => {
      browser.activeTabId = id;
    };
    browser.taskPool.start({ id: "job", tabId: "job-page", title: "任务", lane: "background", clientId: "ding" });
    browser.activeTabId = "job-page";
    await browser.handleChat("记在任务页");
    browser.focusTask("job");
    browser.activeTabId = "idle-page";
    await browser.handleChat("记在空闲页");
    browser.activeTabId = "command-main";
    await browser.handleChat("记在指挥室");

    const book = browser.chatSessions;
    const texts = (key: string) => (book.get(key) || []).map((turn) => turn.text).join("\n");
    expect(texts(taskSessionKey("job-page", "job"))).toContain("记在任务页");
    expect(texts(pageSessionKey("idle-page"))).toContain("记在空闲页");
    expect(texts(COMMAND_SESSION_KEY)).toContain("记在指挥室");
    expect(texts("user")).not.toContain("记在任务页");
    expect(texts("user")).not.toContain("记在空闲页");
    expect(texts("user")).not.toContain("记在指挥室");

    browser.activeTabId = "idle-page";
    const shown = browser.getSidebarPayload() as { selectedSession: string; chat: Array<{ text: string }> };
    expect(shown.selectedSession).toBe(pageSessionKey("idle-page"));
    expect(shown.chat.map((turn) => turn.text).join("\n")).toContain("记在空闲页");
    expect(shown.chat.map((turn) => turn.text).join("\n")).not.toContain("记在任务页");
  });
});
