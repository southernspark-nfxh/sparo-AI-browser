import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
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
import { bindClientTab, registerClientName, resetMcpSessions } from "../src/main/agent/mcp-sessions.js";

afterEach(() => resetMcpSessions());

function browserWithTabs() {
  const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & {
    tabs: Map<string, { id: string; title: string; url: string; view: null; lastActiveAt: number; agentStatus?: "done" }>;
    activeTabId: string;
    taskPool: TaskPool;
  };
  browser.tabs = new Map([
    ["user", { id: "user", title: "用户", url: "https://user.example", view: null, lastActiveAt: 1 }],
    ["agent-1", { id: "agent-1", title: "代理页", url: "https://agent.example", view: null, lastActiveAt: 1 }],
  ]);
  browser.activeTabId = "user";
  browser.taskPool = new TaskPool();
  registerClientName("jia", "");
  bindClientTab({
    clientId: "jia",
    tabId: "agent-1",
    knownTabIds: ["user", "agent-1"],
    createAgentTab: () => "unused",
  });
  return browser;
}

describe("T52 标签归属", () => {
  it("用户标签没有 agent 字段，agent 标签随任务状态变化", () => {
    const browser = browserWithTabs();
    browser.taskPool.start({
      id: "job",
      tabId: "agent-1",
      title: "跑",
      lane: "background",
      clientId: "jia",
      agentName: "Agent 甲",
      color: "#2f6feb",
    });
    const running = browser.listTabs().tabs;
    const user = running.find((tab) => tab.id === "user");
    const agent = running.find((tab) => tab.id === "agent-1");
    expect(user?.owner).toBe("user");
    expect(user?.agentName).toBeUndefined();
    expect(user?.agentColor).toBeUndefined();
    expect(user?.agentState).toBeUndefined();
    expect(agent?.owner).toBe("agent:jia");
    expect(agent?.agentName).toBe("Agent 甲");
    expect(agent?.agentColor).toBeTruthy();
    expect(agent?.agentState).toBe("running");

    browser.taskPool.suspend("job");
    expect(browser.listTabs().tabs.find((tab) => tab.id === "agent-1")?.agentState).toBe("waiting_human");

    browser.taskPool.finish("job", "done");
    const tab = browser.tabs.get("agent-1");
    if (tab) tab.agentStatus = "done";
    expect(browser.listTabs().tabs.find((item) => item.id === "agent-1")?.agentState).toBe("done");
  });

  it("色点只写在 agent 标签的渲染分支里", () => {
    const html = readFileSync(join(process.cwd(), "src/renderer/shell.html"), "utf8");
    expect(html).toContain('tab.owner.indexOf("agent:")');
    expect(html).toContain("tab-agent-dot");
    expect(html).toContain("width:6px;height:6px");
  });
});
