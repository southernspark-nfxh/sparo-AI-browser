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
import { listActiveLeases, resetPageLeases } from "../src/main/agent/page-lease.js";
import { resetMcpSessions } from "../src/main/agent/mcp-sessions.js";
import { COMMAND_SESSION_KEY, taskSessionKey } from "../src/main/agent/session-key.js";
import { summarizeGroup } from "../src/main/agent/command-room.js";

afterEach(() => {
  resetMcpSessions();
  resetPageLeases();
});

function harness() {
  const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & {
    tabs: Map<string, { id: string; title: string; url: string; kind?: "web" | "command"; view: null; lastActiveAt: number }>;
    taskPool: TaskPool;
    chatSessions: Map<string, Array<{ role: string; text: string }>>;
  };
  browser.tabs = new Map([
    ["command-main", { id: "command-main", kind: "command", title: "指挥室", url: "", view: null, lastActiveAt: 1 }],
    ["page-a", { id: "page-a", kind: "web", title: "店小秘", url: "https://a.example", view: null, lastActiveAt: 1 }],
    ["page-b", { id: "page-b", kind: "web", title: "店小秘", url: "https://b.example", view: null, lastActiveAt: 1 }],
  ]);
  browser.taskPool = new TaskPool();
  browser.chatSessions = new Map();
  browser.activeTabId = "command-main";
  browser.taskPool.start({ id: "job-a", tabId: "page-a", title: "商品 A", lane: "background", clientId: "jia", agentName: "Cursor" });
  browser.taskPool.start({ id: "job-b", tabId: "page-b", title: "商品 B", lane: "background", clientId: "jia", agentName: "Cursor" });
  let switched = 0;
  browser.switchTab = () => {
    switched += 1;
    return { ok: true, message: "" };
  };
  browser.focusTask = (taskId: string) => {
    const task = browser.taskPool.tasks.find((item) => item.id === taskId);
    return { ok: Boolean(task), message: "已回到原页面", activeId: task?.tabId, selectedSession: task ? taskSessionKey(task.tabId, task.id) : "" };
  };
  return { browser, switched: () => switched };
}

describe("跨页父任务", () => {
  it("父级不占网页，子任务各留各的页，失败时不能说全部完成", () => {
    const { browser, switched } = harness();
    const before = listActiveLeases().length;
    const group = browser.createTaskGroup("两个商品", ["job-a", "job-b"]);
    expect(listActiveLeases().length).toBe(before);
    expect(group.childTaskIds).toEqual(["job-a", "job-b"]);
    expect(browser.taskPool.tasks.every((task) => task.groupId === group.groupId)).toBe(true);

    browser.taskPool.finish("job-a", "done");
    browser.taskPool.tasks.find((task) => task.id === "job-a")!.resultCard = {
      status: "done",
      summary: "A 已保存",
      tabId: "page-a",
      url: "https://a.example",
      outputs: [],
      unfinished: [],
      needsAccept: true,
      finishedAt: 1,
    };
    browser.taskPool.finish("job-b", "failed");
    const view = browser.taskGroupViews().find((item) => item.groupId === group.groupId);
    expect(view?.allDone).toBe(false);
    expect(view?.headline).toContain("未完成");
    expect(view?.children.map((child) => child.tabId)).toEqual(["page-a", "page-b"]);
    expect(summarizeGroup([{ id: "1", tabId: "page-a", state: "done" }, { id: "2", tabId: "page-b", state: "waiting_human" }]).allDone).toBe(false);

    const ambiguous = browser.commandAct({ type: "focus", title: "店小秘" });
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) expect(ambiguous.code).toBe("ambiguous");
    expect(switched()).toBe(0);

    const opened = browser.focusTask("job-a");
    expect(opened.activeId).toBe("page-a");
    expect(opened.selectedSession).toBe(taskSessionKey("page-a", "job-a"));
    expect(browser.tabs.has("page-a")).toBe(true);
    expect(browser.chatSessions.get(COMMAND_SESSION_KEY) || []).toEqual([]);
  });

  it("子任务步骤不进总指挥，全部完成才算整体完成", () => {
    const { browser } = harness();
    browser.taskScope = { getStore: () => ({ tabId: "page-a", lane: "background", chatKey: taskSessionKey("page-a", "job-a") }) };
    browser.noteTaskStep("正在编辑标题");
    expect(browser.chatSessions.get(COMMAND_SESSION_KEY) || []).toEqual([]);
    expect(browser.taskPool.tasks.find((task) => task.id === "job-a")?.step).toContain("正在编辑标题");

    browser.taskPool.finish("job-a", "done");
    browser.taskPool.finish("job-b", "done");
    const group = browser.createTaskGroup("都做完", ["job-a", "job-b"]);
    const view = browser.taskGroupViews().find((item) => item.groupId === group.groupId);
    expect(view?.allDone).toBe(true);
    expect(view?.headline).toBe("全部完成");
  });
});
