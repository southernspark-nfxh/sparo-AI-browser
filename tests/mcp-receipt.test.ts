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
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1280, height: 800 } }),
    getAllDisplays: () => [],
    on: () => undefined,
    removeListener: () => undefined,
  },
  powerMonitor: { on: () => undefined, removeListener: () => undefined },
}));

import { SparkBrowser } from "../src/main/browser.js";
import { TaskPool } from "../src/main/agent/task-pool.js";
import { writeRateLimitResponse } from "../src/main/mcp-security.js";

describe("T81 MCP 回执要看得见", () => {
  it("限流响应体能解析出 rate_limited", () => {
    let status = 0;
    let headers: Record<string, string | number> = {};
    let body = "";
    const res = {
      headersSent: false,
      writeHead(code: number, next: Record<string, string | number>) {
        status = code;
        headers = next;
        this.headersSent = true;
      },
      end(chunk?: string) {
        body = chunk || "";
      },
    };
    writeRateLimitResponse(res as never, 250);
    expect(status).toBe(429);
    expect(headers["Retry-After"]).toBe("1");
    expect(body.length).toBeGreaterThan(0);
    const parsed = JSON.parse(body) as { error: { code: number; message: string; data: string } };
    expect(parsed.error.data).toBe("rate_limited");
    expect(parsed.error.message).toBe("Too Many Requests");
    expect(parsed.error.code).toBe(-32029);
  });

  it("没配模型时 submit 直接拒绝，不建任务", () => {
    const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & {
      settings: { apiKey: string; provider: string; llmMode: string };
      taskPool: TaskPool;
      mcpTasks: unknown[];
      tabs: Map<string, unknown>;
      activeTabId: string;
      createAgentTab: () => string;
    };
    browser.settings = { apiKey: "", provider: "deepseek", llmMode: "byok" };
    browser.taskPool = new TaskPool();
    browser.mcpTasks = [];
    browser.tabs = new Map();
    browser.activeTabId = "user";
    let created = 0;
    browser.createAgentTab = () => {
      created += 1;
      return "tab-x";
    };
    const result = browser.submitTask("元朝导言", { clientId: "ding" });
    expect(result.status).toBe("failed");
    expect(result.error).toBe("no-model");
    expect(result.message).toBe("还没配置模型 Key，请在侧栏设置里填写");
    expect(browser.mcpTasks).toHaveLength(0);
    expect(browser.taskPool.tasks).toHaveLength(0);
    expect(created).toBe(0);
  });

  it("模型调用抛错后任务落到 failed", async () => {
    const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & {
      settings: { locale: string; execMode: "auto"; apiKey: string };
      taskPool: TaskPool;
      mcpTasks: Array<{ taskId: string; status: string; lastAssistant: string; rounds: number; startedAt: number; text: string; clientId?: string }>;
      tabs: Map<string, { id: string; url: string; title: string }>;
      activeTabId: string;
      freeSoul: { run: () => Promise<{ ok: boolean; text: string }> };
      pushSidebarState: () => void;
    };
    browser.settings = { locale: "zh-CN", execMode: "auto", apiKey: "sk-test" };
    browser.taskPool = new TaskPool();
    browser.tabs = new Map([["tab-a", { id: "tab-a", url: "https://example.com", title: "例子" }]]);
    browser.activeTabId = "user";
    browser.pushSidebarState = () => undefined;
    browser.freeSoul = {
      run: async () => {
        throw new Error("模型挂了");
      },
    };
    const task = {
      taskId: "job-1",
      status: "running" as const,
      rounds: 0,
      lastAssistant: "",
      startedAt: Date.now(),
      text: "明朝导言",
      clientId: "ding",
    };
    browser.mcpTasks = [task];
    browser.taskPool.start({
      id: "job-1",
      tabId: "tab-a",
      title: "明朝",
      lane: "background",
      clientId: "ding",
      agentName: "丁",
      color: "#000",
    });
    await browser.runAgentTask(task, "ding");
    expect(task.status).toBe("failed");
    expect(task.lastAssistant).toContain("模型挂了");
  });
});
