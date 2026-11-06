import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

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
import { resetMcpSessions } from "../src/main/agent/mcp-sessions.js";

const dirs: string[] = [];
afterEach(() => {
  resetMcpSessions();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type TabStub = {
  id: string;
  title: string;
  url: string;
  agentStatus?: "done";
  view: { webContents: { isDestroyed: () => boolean } };
};

function harness() {
  const dir = mkdtempSync(join(tmpdir(), "sparo-banner-"));
  dirs.push(dir);
  const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & {
    chatLog: Array<{ role: string; text: string }>;
    settings: { locale: string; execMode: "step" | "auto" };
    activeTabId: string;
    tabs: Map<string, TabStub>;
    taskPool: TaskPool;
    pushChromeState: () => void;
    pushSidebarState: () => void;
    beginCloudTaskIfNeeded: () => Promise<undefined>;
    getUrl: () => string;
    getTitle: () => string;
    createAgentTab: () => string;
    configDir: () => string;
    freeSoul: { run: () => Promise<{ ok: boolean; text: string }> };
    pumpAgent: () => void;
  };
  const dead = { webContents: { isDestroyed: () => true } };
  browser.tabs = new Map([
    ["user-tab", { id: "user-tab", title: "用户", url: "about:blank", view: dead }],
  ]);
  browser.chatLog = [];
  browser.settings = { locale: "zh-CN", execMode: "auto" };
  browser.activeTabId = "user-tab";
  browser.taskPool = new TaskPool();
  browser.pushSidebarState = () => undefined;
  browser.beginCloudTaskIfNeeded = async () => undefined;
  browser.getUrl = () => "https://example.com";
  browser.getTitle = () => "页";
  browser.configDir = () => dir;
  browser.createAgentTab = () => {
    const id = "agent-1";
    if (!browser.tabs.has(id)) {
      browser.tabs.set(id, { id, title: "任务页", url: "https://example.com", view: dead });
    }
    return id;
  };
  return browser;
}

function agentState(browser: ReturnType<typeof harness>): string | undefined {
  const listed = browser.listTabs();
  return listed.tabs.find((tab) => tab.id === "agent-1")?.agentState;
}

describe("T58 任务状态推到壳层", () => {
  it("排队、运行、完成各推一次，标签状态依次变化", async () => {
    const browser = harness();
    let release: (value: { ok: boolean; text: string }) => void = () => undefined;
    browser.freeSoul = {
      run: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    };
    let pushes = 0;
    browser.pushChromeState = () => {
      pushes += 1;
    };
    for (let i = 0; i < 3; i += 1) {
      browser.taskPool.start({ id: `fill-${i}`, tabId: "", title: "占位", lane: "background" });
    }
    const submitted = browser.submitTask("读维基", { clientId: "jia" });
    expect(submitted.status).toBe("queued");
    expect(browser.taskPool.tasks.find((task) => task.id === submitted.taskId)?.tabId).toBe("agent-1");
    expect(agentState(browser)).toBe("queued");

    browser.taskPool.finish("fill-0");
    browser.pumpAgent();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(agentState(browser)).toBe("running");

    release({ ok: true, text: "做完了" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(agentState(browser)).toBe("done");
    expect(pushes).toBeGreaterThanOrEqual(3);
  });
});

describe("T59 完成后还留着完成态", () => {
  it("结束后是 done，再派变成 running，关掉就清空", async () => {
    const browser = harness();
    let release: (value: { ok: boolean; text: string }) => void = () => undefined;
    let started: () => void = () => undefined;
    const startedP = new Promise<void>((resolve) => {
      started = resolve;
    });
    browser.freeSoul = {
      run: () => {
        started();
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    };
    browser.pushChromeState = () => undefined;
    const first = browser.submitTask("第一件", { clientId: "jia" });
    expect(first.status).toBe("running");
    await startedP;
    release({ ok: true, text: "做完了" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(agentState(browser)).toBe("done");
    const tab = browser.tabs.get("agent-1");
    expect(tab?.agentStatus).toBe("done");

    browser.freeSoul = {
      run: () => new Promise(() => undefined),
    };
    const second = browser.submitTask("第二件", { clientId: "jia" });
    expect(second.status).toBe("running");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(agentState(browser)).toBe("running");
    expect(tab?.agentStatus).toBeUndefined();

    if (tab) tab.view = undefined as unknown as TabStub["view"];
    (browser as unknown as { layout: () => void }).layout = () => undefined;
    browser.closeTab("agent-1");
    expect(tab?.agentStatus).toBeUndefined();
    expect(browser.listTabs().tabs.some((item) => item.id === "agent-1")).toBe(false);
  });
});
