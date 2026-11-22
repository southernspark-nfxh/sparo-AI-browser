import { afterEach, describe, expect, it, vi } from "vitest";

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
import { allocateClientTab, ownerForTab, resetMcpSessions } from "../src/main/agent/mcp-sessions.js";
import { activeLeaseForTab } from "../src/main/agent/page-lease.js";

afterEach(() => resetMcpSessions());

describe("任务终态保留", () => {
  it("停止之后，迟到的完成或失败不能改写", () => {
    const pool = new TaskPool();
    pool.start({ id: "a", tabId: "page", title: "a", lane: "background", clientId: "jia" });
    pool.finish("a", "stopped");
    pool.finish("a", "done");
    pool.finish("a", "failed");
    const kept = pool.tasks.filter((task) => task.id === "a");
    expect(kept).toHaveLength(1);
    expect(kept[0]?.state).toBe("stopped");
    expect(kept[0]?.step).toBe("已停止");
  });
});

describe("验收、结束和关闭保护", () => {
  function browser() {
    const box = Object.create(SparkBrowser.prototype) as SparkBrowser & {
      taskPool: TaskPool;
      tabs: Map<string, { id: string; agentStatus?: "done"; holdHuman?: boolean; view?: undefined }>;
      activeTabId: string;
      activeWinId: string;
      win: { contentView: { removeChildView: () => void } };
      layout: () => void;
      pushChromeState: () => void;
      pushSidebarState: () => void;
      syncTaskChrome: () => void;
      wakeTab: () => void;
    };
    box.taskPool = new TaskPool();
    box.tabs = new Map([
      ["user", { id: "user" }],
      ["page", { id: "page", agentStatus: "done" as const, agentOwned: true }],
    ]);
    box.activeTabId = "user";
    box.activeWinId = "main";
    (box as unknown as { _wins: Map<string, { contentView: { removeChildView: () => void } }> })._wins = new Map([
      ["main", { contentView: { removeChildView() {} } }],
    ]);
    box.layout = () => undefined;
    box.pushChromeState = () => undefined;
    box.pushSidebarState = () => undefined;
    box.syncTaskChrome = () => undefined;
    box.wakeTab = () => undefined;
    return box;
  }

  function lease(taskId: string) {
    return allocateClientTab({
      intent: "task",
      clientId: "jia",
      taskId,
      tabId: "page",
      knownTabIds: ["user", "page"],
      createAgentTab: () => "nope",
    });
  }

  it("完成后租约还在，验收保留页面后才允许别人显式使用", () => {
    const box = browser();
    expect(lease("job").ok).toBe(true);
    box.taskPool.start({ id: "job", tabId: "page", title: "做完", lane: "background", clientId: "jia" });
    box.taskPool.finish("job", "done");
    const stolen = allocateClientTab({
      intent: "task",
      clientId: "yi",
      taskId: "other",
      tabId: "page",
      knownTabIds: ["user", "page"],
      createAgentTab: () => "nope",
    });
    expect(stolen).toEqual({ ok: false, error: "tab_busy" });
    box.taskPool.finish("job", "failed");
    expect(box.taskPool.tasks.find((task) => task.id === "job")?.state).toBe("done");
    const accepted = box.acceptTask("job", "keep");
    expect(accepted.ok).toBe(true);
    expect(activeLeaseForTab("page")).toBeUndefined();
    expect(ownerForTab("page")).toBe("user");
    expect(box.tabs.has("page")).toBe(true);
    expect(box.tabs.get("page")?.agentStatus).toBeUndefined();
    const again = box.acceptTask("job", "close");
    expect(again.already).toBe(true);
    expect(box.tabs.has("page")).toBe(true);
    expect(box.tabs.get("page")?.agentOwned).toBeUndefined();
    const reused = allocateClientTab({
      intent: "task",
      clientId: "yi",
      taskId: "next",
      tabId: "page",
      knownTabIds: ["user", "page"],
      createAgentTab: () => "nope",
      occupancy: (id) => box.pageOccupancy(id),
    });
    expect(reused.ok && reused.tabId).toBe("page");
    expect(ownerForTab("page")).toBe("agent:yi");
  });

  it("失败和停止不能验收，明确结束后才释放，运行中不能直接关页", () => {
    const box = browser();
    expect(lease("bad").ok).toBe(true);
    box.taskPool.start({ id: "bad", tabId: "page", title: "坏了", lane: "background", clientId: "jia" });
    expect(box.closeTab("page").ok).toBe(false);
    expect(box.tabs.has("page")).toBe(true);
    expect(activeLeaseForTab("page")?.taskId).toBe("bad");
    box.taskPool.finish("bad", "failed");
    expect(box.acceptTask("bad").ok).toBe(false);
    const resumed = box.resumeTask("bad");
    expect(resumed.ok).toBe(true);
    expect(resumed.tabId).toBe("page");
    expect(box.taskPool.tasks.find((task) => task.id === "bad")?.state).toBe("running");
    box.taskPool.finish("bad", "stopped");
    const ended = box.closeTask("bad", "close");
    expect(ended.ok).toBe(true);
    expect(box.tabs.has("page")).toBe(false);
    expect(activeLeaseForTab("page")).toBeUndefined();
    expect(box.taskPool.tasks.find((task) => task.id === "bad")?.state).toBe("closed");
    const repeated = box.closeTask("bad", "close");
    expect(repeated.already).toBe(true);
  });
});
