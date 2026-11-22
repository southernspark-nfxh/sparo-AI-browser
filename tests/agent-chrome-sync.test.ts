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
import { activeLeaseForTab } from "../src/main/agent/page-lease.js";

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
    settings: { locale: string; execMode: "step" | "auto"; apiKey?: string };
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
  browser.settings = { locale: "zh-CN", execMode: "auto", apiKey: "test-key" };
  browser.activeTabId = "user-tab";
  browser.taskPool = new TaskPool();
  browser.pushSidebarState = () => undefined;
  browser.beginCloudTaskIfNeeded = async () => undefined;
  browser.getUrl = () => "https://example.com";
  browser.getTitle = () => "页";
  browser.configDir = () => dir;
  let seq = 0;
  browser.createAgentTab = () => {
    seq += 1;
    const id = `agent-${seq}`;
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

function sameProjection(browser: ReturnType<typeof harness>, id: string) {
  const tab = browser.listTabs().tabs.find((item) => item.id === id);
  const row = browser.commandOverview().find((item) => item.tabId === id);
  expect(tab?.pageStatus?.state).toBe(row?.state);
  expect(tab?.pageStatus?.tone).toBe(row?.tone);
  expect(tab?.pageStatus?.step).toBe(row?.step);
  expect(tab?.pageStatus?.agentName).toBe(row?.agentName);
  expect(tab?.pageStatus?.updatedAt).toBe(row?.updatedAt);
  return tab?.pageStatus;
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
    expect(activeLeaseForTab("agent-1")?.clientId).toBe("jia");
    expect(agentState(browser)).toBe("queued");
    expect(sameProjection(browser, "agent-1")?.tone).toBe("green");

    browser.taskPool.finish("fill-0");
    browser.pumpAgent();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(agentState(browser)).toBe("running");
    expect(sameProjection(browser, "agent-1")?.tone).toBe("green");

    release({
      ok: true,
      text: "做完了",
      verification: { ok: true, items: [{ name: "结果", ok: true }] },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(agentState(browser)).toBe("done");
    expect(sameProjection(browser, "agent-1")?.tone).toBe("gray");
    expect(pushes).toBeGreaterThanOrEqual(3);
  });
});

describe("T59 完成后还留着完成态", () => {
  it("待验收时新任务另开页，原页租约仍在", async () => {
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
    expect(browser.tabs.get("agent-1")?.agentStatus).toBe("done");
    expect(activeLeaseForTab("agent-1")?.clientId).toBe("jia");

    browser.freeSoul = {
      run: () => new Promise(() => undefined),
    };
    const second = browser.submitTask("第二件", { clientId: "jia" });
    expect(second.status).toBe("running");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const secondTab = browser.taskPool.tasks.find((task) => task.id === second.taskId)?.tabId;
    expect(secondTab).toBe("agent-2");
    expect(activeLeaseForTab("agent-1")).toBeTruthy();
    expect(activeLeaseForTab("agent-2")?.taskId).toBe(second.taskId);
    expect(browser.activeTabId).toBe("user-tab");
    expect(browser.tabs.get("agent-1")?.agentStatus).toBe("done");
  });
});
