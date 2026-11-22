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
import { acquireLease, activeLeaseForTab, resetPageLeases } from "../src/main/agent/page-lease.js";
import { resetMcpSessions } from "../src/main/agent/mcp-sessions.js";
import { COMMAND_SESSION_KEY, taskSessionKey } from "../src/main/agent/session-key.js";

const dirs: string[] = [];
afterEach(() => {
  resetMcpSessions();
  resetPageLeases();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function harness() {
  const dir = mkdtempSync(join(tmpdir(), "sparo-attention-"));
  dirs.push(dir);
  const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & {
    tabs: Map<string, { id: string; title: string; url: string; kind?: "web"; view: null; lastActiveAt: number }>;
    taskPool: TaskPool;
    settings: { locale: string; execMode: "auto"; llmMode?: string; apiKey?: string };
    approvals: Map<string, never>;
    skillsCache: unknown[];
    recording: boolean;
    paused: boolean;
    configDir: () => string;
    getUrl: () => string;
    getTitle: () => string;
    chatSessions: Map<string, Array<{ role: string; text: string }>>;
    mcpTasks: Array<{
      taskId: string;
      status: "running" | "done" | "failed";
      rounds: number;
      lastAssistant: string;
      startedAt: number;
      text: string;
      finalUrl?: string;
      reportUrl?: string;
      captures?: string[];
      clientId?: string;
    }>;
  };
  browser.tabs = new Map([
    ["page", { id: "page", title: "店小秘", url: "https://dxm.example/a", kind: "web", view: null, lastActiveAt: 1 }],
    ["other", { id: "other", title: "别的", url: "https://example.com", kind: "web", view: null, lastActiveAt: 1 }],
  ]);
  browser.taskPool = new TaskPool();
  browser.settings = { locale: "zh-CN", execMode: "auto", llmMode: "byok", apiKey: "k" };
  browser.approvals = new Map();
  browser.skillsCache = [];
  browser.recording = false;
  browser.paused = false;
  browser.configDir = () => dir;
  browser.getUrl = () => "https://dxm.example/a";
  browser.getTitle = () => "店小秘";
  browser.chatSessions = new Map();
  browser.activeTabId = "other";
  browser.mcpTasks = [
    {
      taskId: "job",
      status: "running",
      rounds: 1,
      lastAssistant: "商品已保存",
      startedAt: 1,
      text: "编辑商品",
      finalUrl: "https://dxm.example/a",
      reportUrl: "reports/a.html",
      captures: [],
      clientId: "jia",
    },
  ];
  browser.taskPool.start({
    id: "job",
    tabId: "page",
    title: "编辑商品",
    lane: "background",
    clientId: "jia",
    agentName: "Cursor",
  });
  acquireLease({ tabId: "page", taskId: "job", clientId: "jia" });
  let switched = 0;
  let focused = 0;
  browser.switchTab = () => {
    switched += 1;
    return { ok: true, message: "" };
  };
  browser.focusActivePage = () => {
    focused += 1;
  };
  return { browser, switched: () => switched, focused: () => focused };
}

describe("结果卡和双位置提醒", () => {
  it("真实完成才有结果卡和提醒，知悉不释放，验收才释放，完成时不切页", () => {
    const { browser, switched, focused } = harness();
    expect(browser.recordVerification("job", [{ name: "保存", ok: true }]).ok).toBe(true);
    expect(browser.sealTaskOutcome("job", "done")).toBe("done");
    browser.noteTaskStep("正在核对");
    browser.taskPool.finish("job", "done");
    const tab = browser.listTabs().tabs.find((item) => item.id === "page");
    const row = browser.commandOverview().find((item) => item.tabId === "page");
    expect(tab?.pageStatus?.resultCard?.summary).toBe("商品已保存");
    expect(tab?.pageStatus?.resultCard?.url).toBe("https://dxm.example/a");
    expect(tab?.pageStatus?.resultCard?.outputs).toContain("reports/a.html");
    expect(tab?.pageStatus?.resultCard?.unfinished).toEqual([]);
    expect(tab?.pageStatus?.resultCard?.needsAccept).toBe(true);
    expect(row?.summary).toBe("商品已保存");
    expect(row?.state).toBe("done");
    expect(row?.tone).toBe("gray");
    expect(tab?.pageStatus?.attention).toBe(true);
    expect(row?.attention).toBe(true);
    expect(browser.chatSessions.get(taskSessionKey("page", "job"))?.map((turn) => turn.text)).toContain("商品已保存");
    expect(browser.chatSessions.get(COMMAND_SESSION_KEY)?.filter((turn) => turn.text.startsWith("已完成"))).toHaveLength(1);
    expect(switched()).toBe(0);
    expect(focused()).toBe(0);

    expect(browser.noteTaskViewed("job", false).ok).toBe(false);
    browser.activeTabId = "other";
    expect(browser.noteTaskViewed("job", true).ok).toBe(false);
    expect(browser.commandOverview().find((item) => item.tabId === "page")?.attention).toBe(true);

    browser.activeTabId = "page";
    expect(browser.noteTaskViewed("job", true).ok).toBe(true);
    expect(browser.listTabs().tabs.find((item) => item.id === "page")?.pageStatus?.attention).toBeUndefined();
    expect(browser.commandOverview().find((item) => item.tabId === "page")?.attention).toBeUndefined();
    expect(activeLeaseForTab("page")?.taskId).toBe("job");
    expect(switched()).toBe(0);

    const accepted = browser.acceptTask("job", "keep");
    expect(accepted.ok).toBe(true);
    expect(activeLeaseForTab("page")).toBeUndefined();
  });

  it("未核验和失败、停止都不出成功结果卡，普通步骤也不清掉别人的提醒", () => {
    const { browser } = harness();
    browser.mcpTasks[0]!.lastAssistant = "只是打开了页面，没有核验";
    expect(browser.sealTaskOutcome("job", "done")).toBe("failed");
    browser.taskPool.finish("job", "failed");
    browser.recordVerification("job", [{ name: "保存", ok: true }]);
    expect(browser.sealTaskOutcome("job", "done")).toBe("failed");
    const card = browser.taskPool.tasks.find((item) => item.id === "job");
    expect(card?.state).toBe("failed");
    expect(card?.resultCard).toBeUndefined();
    expect(browser.commandOverview().find((item) => item.tabId === "page")?.attention).toBeUndefined();
    expect(browser.commandOverview().find((item) => item.tabId === "page")?.tone).toBe("red");
    expect(browser.turnsFor(COMMAND_SESSION_KEY).some((turn) => turn.text.startsWith("已完成"))).toBe(false);

    const stopped = harness();
    expect(stopped.browser.sealTaskOutcome("job", "stopped")).toBe("stopped");
    stopped.browser.taskPool.finish("job", "stopped");
    expect(stopped.browser.taskPool.tasks.find((item) => item.id === "job")?.resultCard).toBeUndefined();
    expect(stopped.browser.commandOverview().find((item) => item.tabId === "page")?.tone).toBe("gray");
  });
});
