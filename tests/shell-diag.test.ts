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
    getAppMetrics: () => [{ type: "Tab", memory: { workingSetSize: 30 * 1024 } }],
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

describe("T72 崩溃现场", () => {
  it("记下标签、对话条数、任务状态和推送计数，取走后清零", async () => {
    const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & {
      tabs: Map<string, { id: string }>;
      chatSessions: Map<string, Array<{ role: string; text: string }>>;
      taskPool: TaskPool;
      window: { getBounds: () => { x: number; y: number; width: number; height: number } };
      lastShellUnresponsiveAt: number;
    };
    browser.tabs = new Map([
      ["user", { id: "user" }],
      ["agent-1", { id: "agent-1" }],
    ]);
    browser.chatSessions = new Map([
      ["user", [{ role: "user", text: "你好" }]],
      ["agent:jia", [{ role: "assistant", text: "在读" }, { role: "assistant", text: "还在读" }]],
    ]);
    browser.taskPool = new TaskPool();
    browser.taskPool.start({ id: "job", tabId: "agent-1", title: "跑", lane: "background", clientId: "jia" });
    browser.window = { getBounds: () => ({ x: 10, y: 20, width: 1200, height: 700 }) };
    browser.lastShellUnresponsiveAt = Date.now() - 2000;
    browser.takePushStatsLine();
    (browser as unknown as { ensurePushMeter: () => { chromeReq: number; chromeFlush: number; sidebarReq: number; sidebarBytes: number } }).ensurePushMeter();
    const meter = (browser as unknown as { pushMeter: { chromeReq: number; chromeFlush: number; sidebarReq: number; sidebarBytes: number } }).pushMeter;
    meter.chromeReq = 9;
    meter.chromeFlush = 3;
    meter.sidebarReq = 4;
    meter.sidebarBytes = 800;

    const line = browser.diagCrashContext({ reason: "crashed", exitCode: -1 });
    expect(line).toContain("reason=crashed");
    expect(line).toContain("exitCode=-1");
    expect(line).toContain("bounds=10,20,1200x700");
    expect(line).toContain("tabs=2");
    expect(line).toContain("user:1");
    expect(line).toContain("agent:jia:2");
    expect(line).toContain("running:1");
    expect(line).toContain("chromeReq=9");
    expect(line).toContain("chromeFlush=3");
    expect(line).toContain("sidebarBytes=800");
    expect(line).toContain("sinceUnresponsiveMs=");
    expect(line).not.toContain("sinceUnresponsiveMs=none");

    const pushed = browser.takePushStatsLine();
    expect(pushed).toContain("chrome req=9 flush=3");
    expect(browser.takePushStatsLine()).toContain("chrome req=0 flush=0");

    const mem = await browser.diagShellMemLine();
    expect(mem).toContain("renderers=1");
    expect(mem).toContain("rendererMb=30");
    expect(mem).toContain("private=0");
    expect(mem).toContain("note=");
  });
});
