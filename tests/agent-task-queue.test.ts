import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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
import { resetMcpSessions } from "../src/main/agent/mcp-sessions.js";

const dirs: string[] = [];
afterEach(() => {
  resetMcpSessions();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function harness() {
  const dir = mkdtempSync(join(tmpdir(), "sparo-queue-"));
  dirs.push(dir);
  const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & {
    chatLog: Array<{ role: string; text: string }>;
    settings: { locale: string; execMode: "step" | "auto" };
    activeTabId: string;
    taskPool: TaskPool;
    pushSidebarState: () => void;
    beginCloudTaskIfNeeded: () => Promise<undefined>;
    getUrl: () => string;
    getTitle: () => string;
    createAgentTab: () => string;
    listTabs: () => { tabs: Array<{ id: string }> };
    switchTab: (id: string) => void;
    configDir: () => string;
    freeSoul: { run: () => Promise<{ ok: boolean; text: string }> };
  };
  browser.chatLog = [];
  browser.settings = { locale: "zh-CN", execMode: "step" };
  browser.activeTabId = "user-tab";
  browser.taskPool = new TaskPool();
  browser.pushSidebarState = () => undefined;
  browser.beginCloudTaskIfNeeded = async () => undefined;
  browser.getUrl = () => "https://example.com";
  browser.getTitle = () => "页";
  browser.listTabs = () => ({ tabs: [{ id: "user-tab" }] });
  browser.switchTab = (id: string) => {
    browser.activeTabId = id;
  };
  browser.configDir = () => dir;
  let n = 0;
  browser.createAgentTab = () => {
    n += 1;
    return `agent-${n}`;
  };
  return browser;
}

describe("T50 agent 任务排队与归属", () => {
  it("第 4 个排队，前一个完成后自动跑完", async () => {
    const browser = harness();
    const gates: Array<() => void> = [];
    browser.freeSoul = {
      run: () =>
        new Promise((resolve) => {
          gates.push(() => resolve({ ok: true, text: "做完了" }));
        }),
    };
    const submitted = ["c1", "c2", "c3", "c4"].map((id, index) =>
      browser.submitTask(`任务${index + 1}`, { clientId: id }),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(submitted.map((item) => item.status)).toEqual(["running", "running", "running", "queued"]);
    expect(browser.getTask(submitted[3].taskId).status).toBe("queued");
    expect(gates).toHaveLength(3);

    gates[0]();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(browser.getTask(submitted[0].taskId).status).toBe("done");
    expect(browser.getTask(submitted[3].taskId).status).toBe("running");
    expect(gates).toHaveLength(4);

    gates[3]();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(browser.getTask(submitted[3].taskId).status).toBe("done");
  });

  it("乙不能查甲的任务", async () => {
    const browser = harness();
    browser.freeSoul = { run: () => new Promise(() => undefined) };
    const jia = browser.submitTask("甲的任务", { clientId: "jia" });
    browser.submitTask("乙的任务", { clientId: "yi" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(browser.getTask(jia.taskId, "yi").status).toBe("unknown");
    expect(browser.getTask(jia.taskId, "yi").lastAssistant).toBe("");
    expect(browser.getTask(jia.taskId, "jia").status).toBe("running");
  });

  it("waiting_human 不占并发名额", () => {
    const pool = new TaskPool();
    pool.start({ id: "w", tabId: "t", title: "等", lane: "background" });
    pool.suspend("w");
    expect(pool.runningBackground()).toBe(0);
    expect(pool.canStartBackground()).toBe(true);
    pool.start({ id: "a", tabId: "t", title: "跑", lane: "background" });
    pool.start({ id: "b", tabId: "t", title: "跑", lane: "background" });
    pool.start({ id: "c", tabId: "t", title: "跑", lane: "background" });
    expect(pool.runningBackground()).toBe(3);
    expect(pool.canStartBackground()).toBe(false);
    expect(pool.tasks.find((task) => task.id === "w")?.state).toBe("waiting_human");
  });
});
