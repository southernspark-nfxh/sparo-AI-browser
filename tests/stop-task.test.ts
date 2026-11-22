import { describe, expect, it, vi } from "vitest";

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

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SparkBrowser } from "../src/main/browser.js";
import { TaskPool } from "../src/main/agent/task-pool.js";
import { FIRST_BYTE_TIMEOUT_MS } from "../src/main/agent/free-soul.js";

describe("T73 停止卡住的任务", () => {
  it("无首字超时默认 180 秒", () => {
    expect(FIRST_BYTE_TIMEOUT_MS).toBe(180_000);
  });

  it("停止按钮和 stop_task 走同一条链路，休眠后也能停", () => {
    const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & {
      taskPool: TaskPool;
      tabs: Map<string, { id: string; agentStatus?: "done" }>;
      mcpTasks: Array<{ taskId: string; status: string; lastAssistant: string; text: string; clientId?: string }>;
      agentAbortByTask: Map<string, AbortController>;
      chatSessions: Map<string, Array<{ role: string; text: string }>>;
      pumpAgent: () => void;
      syncTaskChrome: () => void;
      pushSidebarState: () => void;
    };
    browser.taskPool = new TaskPool();
    browser.tabs = new Map([["agent-1", { id: "agent-1" }]]);
    browser.tabs.get("agent-1")!.agentStatus = undefined;
    browser.mcpTasks = [
      { taskId: "job", status: "running", lastAssistant: "", text: "读维基", clientId: "jia" },
    ];
    const controller = new AbortController();
    browser.agentAbortByTask = new Map([["job", controller]]);
    browser.chatSessions = new Map();
    browser.pumpAgent = () => undefined;
    browser.syncTaskChrome = () => undefined;
    browser.pushSidebarState = () => undefined;
    browser.taskPool.start({
      id: "job",
      tabId: "agent-1",
      title: "读维基",
      lane: "background",
      clientId: "jia",
    });
    browser.tabs.get("agent-1")!.agentStatus = undefined;
    const discarded = { ...browser.tabs.get("agent-1")!, discarded: true };
    browser.tabs.set("agent-1", discarded);

    const stopped = browser.stopAgentTask("job");
    expect(stopped.ok).toBe(true);
    expect(stopped.stopped).toEqual(["job"]);
    expect(controller.signal.aborted).toBe(true);
    expect(browser.taskPool.tasks.find((task) => task.id === "job")?.state).toBe("stopped");
    expect(browser.mcpTasks[0]?.status).toBe("stopped");
    expect(browser.chatSessions.get("agent:jia")?.some((turn) => turn.text === "已手动停止")).toBe(true);
    expect(browser.tabs.get("agent-1")?.agentStatus).toBe("done");

    const again = browser.stopAgentTask("job");
    expect(again.ok).toBe(false);
  });

  it("已经失败的页被点名停掉后变成已停止，标签还在", () => {
    const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & {
      taskPool: TaskPool;
      tabs: Map<string, { id: string; agentStatus?: "done" }>;
      mcpTasks: Array<{ taskId: string; status: string; lastAssistant: string; text: string; clientId?: string }>;
      chatSessions: Map<string, Array<{ role: string; text: string }>>;
      pumpAgent: () => void;
      syncTaskChrome: () => void;
      pushSidebarState: () => void;
    };
    browser.taskPool = new TaskPool();
    browser.tabs = new Map([["jd", { id: "jd" }]]);
    browser.mcpTasks = [
      { taskId: "job-jd", status: "failed", lastAssistant: "没有核验回执", text: "查京东", clientId: "command" },
    ];
    browser.chatSessions = new Map();
    browser.pumpAgent = () => undefined;
    browser.syncTaskChrome = () => undefined;
    browser.pushSidebarState = () => undefined;
    browser.taskPool.start({
      id: "job-jd",
      tabId: "jd",
      title: "京东-欢迎登录",
      lane: "background",
      clientId: "command",
    });
    browser.taskPool.finish("job-jd", "failed");
    const page = browser.tabs.get("jd");

    const stopped = browser.stopAgentTask("job-jd");
    expect(stopped.ok).toBe(true);
    expect(stopped.stopped).toEqual(["job-jd"]);
    expect(browser.taskPool.tasks.find((task) => task.id === "job-jd")?.state).toBe("stopped");
    expect(browser.taskPool.tasks.find((task) => task.id === "job-jd")?.step).toBe("已停止");
    expect(browser.tabs.get("jd")).toBe(page);
    expect(browser.tabs.get("jd")?.agentStatus).toBeUndefined();
    expect(browser.mcpTasks[0]?.status).toBe("stopped");
    expect(browser.chatSessions.get("agent:command")?.some((turn) => turn.text === "已手动停止")).toBe(true);

    expect(browser.stopAgentTask("job-jd").ok).toBe(false);

    browser.taskPool.start({
      id: "job-done",
      tabId: "jd",
      title: "已完成的页",
      lane: "background",
    });
    browser.taskPool.finish("job-done", "done");
    expect(browser.stopAgentTask("job-done").ok).toBe(false);
    expect(browser.taskPool.tasks.find((task) => task.id === "job-done")?.state).toBe("done");

    const html = readFileSync(join(process.cwd(), "src/renderer/shell.html"), "utf8");
    expect(html).toContain('stop.textContent = "停止"');
    expect(html).toContain("sparkShell.stopTask");
    const mcp = readFileSync(join(process.cwd(), "src/main/mcp-server.ts"), "utf8");
    expect(mcp).toContain('"stop_task"');
  });
});
