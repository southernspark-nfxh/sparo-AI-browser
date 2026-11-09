import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
  const dir = mkdtempSync(join(tmpdir(), "sparo-roster-"));
  dirs.push(dir);
  const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & {
    chatLog: Array<{ role: string; text: string }>;
    settings: { locale: string; execMode: "step" | "auto"; llmMode?: string; apiKey?: string };
    activeTabId: string;
    taskPool: TaskPool;
    approvals: Map<string, never>;
    skillsCache: unknown[];
    recording: boolean;
    paused: boolean;
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
  browser.settings = { locale: "zh-CN", execMode: "step", llmMode: "byok", apiKey: "test-key" };
  browser.activeTabId = "user-tab";
  browser.taskPool = new TaskPool();
  browser.approvals = new Map();
  browser.skillsCache = [];
  browser.recording = false;
  browser.paused = false;
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
    return n === 1 ? "tab-jia" : "tab-yi";
  };
  browser.freeSoul = { run: () => new Promise(() => undefined) };
  return browser;
}

describe("T54 分身面板", () => {
  it("点卡片同时切页面和对话，回到用户页恢复用户历史", async () => {
    const browser = harness();
    browser.chatLog.push({ role: "user", text: "用户的话" });
    const jia = browser.submitTask("甲的话", { clientId: "jia" });
    const yi = browser.submitTask("乙的话", { clientId: "yi" });
    await new Promise((resolve) => setTimeout(resolve, 30));

    const opened = browser.focusTask(jia.taskId);
    expect(opened.ok).toBe(true);
    expect(opened.activeId).toBe("tab-jia");
    expect(opened.selectedSession).toBe("agent:jia");
    const jiaPayload = browser.getSidebarPayload() as {
      selectedSession: string;
      chat: Array<{ text: string }>;
    };
    expect(jiaPayload.selectedSession).toBe("agent:jia");
    expect(jiaPayload.chat.map((turn) => turn.text).join("\n")).toContain("甲的话");
    expect(jiaPayload.chat.map((turn) => turn.text).join("\n")).not.toContain("乙的话");
    expect(jiaPayload.chat.map((turn) => turn.text).join("\n")).not.toContain("用户的话");

    browser.switchTab("user-tab");
    browser.selectSession("user");
    const userPayload = browser.getSidebarPayload() as { selectedSession: string; chat: Array<{ text: string }> };
    expect(browser.activeTabId).toBe("user-tab");
    expect(userPayload.selectedSession).toBe("user");
    expect(userPayload.chat.map((turn) => turn.text)).toEqual(["用户的话"]);
    expect(yi.taskId).toBeTruthy();
  });

  it("侧栏有使用中名单，任务卡带名字和色条", () => {
    const html = readFileSync(join(process.cwd(), "src/renderer/shell.html"), "utf8");
    expect(html).toContain("使用中 ");
    expect(html).toContain("focusTask");
    expect(html).toContain("3px solid");
    expect(html).toContain("is-waiting_human");
  });
});
