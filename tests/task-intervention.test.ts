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
  const dir = mkdtempSync(join(tmpdir(), "sparo-intervention-"));
  dirs.push(dir);
  const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & {
    tabs: Map<string, { id: string; title: string; url: string; view: null; lastActiveAt: number; agentStatus?: "done" }>;
    taskPool: TaskPool;
    settings: { locale: string; execMode: "auto" | "step"; llmMode?: string; apiKey?: string };
    approvals: Map<string, never>;
    skillsCache: unknown[];
    recording: boolean;
    paused: boolean;
    configDir: () => string;
    getUrl: (id?: string) => string;
    getTitle: (id?: string) => string;
    chatSessions: Map<string, Array<{ role: string; text: string }>>;
    freeSoul: { run: (input: { input: string }) => Promise<{ ok: boolean; text: string }> };
    beginCloudTaskIfNeeded: () => Promise<undefined>;
    pageEnv: () => { envId: string; envName: string };
    envRoster: () => [];
    pumpAgent: () => void;
    createAgentTab: () => string;
  };
  browser.tabs = new Map([
    ["page", { id: "page", title: "店小秘", url: "https://dxm.example/a", view: null, lastActiveAt: 1 }],
  ]);
  browser.taskPool = new TaskPool();
  browser.settings = { locale: "zh-CN", execMode: "auto", llmMode: "byok", apiKey: "test-key" };
  browser.approvals = new Map();
  browser.skillsCache = [];
  browser.recording = false;
  browser.paused = false;
  browser.configDir = () => dir;
  browser.getUrl = () => "https://dxm.example/a";
  browser.getTitle = () => "店小秘";
  browser.chatSessions = new Map();
  browser.activeTabId = "page";
  browser.beginCloudTaskIfNeeded = async () => undefined;
  browser.pageEnv = () => ({ envId: "", envName: "" });
  browser.envRoster = () => [];
  browser.pumpAgent = () => undefined;
  let created = 0;
  browser.createAgentTab = () => {
    created += 1;
    return "fresh-page";
  };
  browser.freeSoul = { run: () => new Promise(() => undefined) };
  browser.taskPool.start({
    id: "job",
    tabId: "page",
    title: "编辑商品 A",
    lane: "background",
    clientId: "jia",
    agentName: "Cursor",
  });
  acquireLease({ tabId: "page", taskId: "job", clientId: "jia" });
  return { browser, created: () => created };
}

function commandTexts(browser: SparkBrowser & { chatSessions: Map<string, Array<{ role: string; text: string }>> }) {
  return (browser.chatSessions.get(COMMAND_SESSION_KEY) || []).map((turn) => turn.text);
}

describe("人工、异常和原页恢复", () => {
  it("等待人工时三处都是黄色，原因一致，总指挥只加一条，自动动作被拦住", async () => {
    const { browser, created } = harness();
    browser.markWaitingHuman("job", "请确认发布，不要代付款");
    browser.markWaitingHuman("job", "请确认发布，不要代付款");
    const tab = browser.listTabs().tabs.find((item) => item.id === "page");
    const row = browser.commandOverview().find((item) => item.tabId === "page");
    browser.activeTabId = "page";
    const side = browser.getSidebarPayload(false, true) as { pageStatus?: { state: string; tone: string; summary: string } };
    expect(tab?.pageStatus?.state).toBe("waiting_human");
    expect(tab?.pageStatus?.tone).toBe("yellow");
    expect(tab?.pageStatus?.summary).toContain("请确认发布");
    expect(row?.tone).toBe("yellow");
    expect(row?.summary).toBe(tab?.pageStatus?.summary);
    expect(side.pageStatus?.tone).toBe("yellow");
    expect(side.pageStatus?.summary).toBe(tab?.pageStatus?.summary);
    expect(commandTexts(browser).filter((text) => text.includes("需要人工"))).toEqual(["需要人工：请确认发布，不要代付款"]);
    const pageKey = taskSessionKey("page", "job");
    expect(browser.chatSessions.get(pageKey)?.some((turn) => turn.text.includes("请确认发布"))).toBe(true);

    const blocked = await browser.runAgentTool("navigate", { url: "https://pay.example/checkout" });
    expect(blocked.ok).toBe(false);
    expect(blocked.message).toContain("等你处理");
    const read = await browser.runAgentTool("get_url", {});
    expect(read.ok).toBe(true);
    expect(created()).toBe(0);
    expect(activeLeaseForTab("page")?.taskId).toBe("job");
  });

  it("恢复走原执行器，不新开页；跑不起来就变红色，不能报完成", async () => {
    const { browser, created } = harness();
    browser.taskPool.finish("job", "failed");
    let seen = "";
    browser.freeSoul = {
      run: (input) => {
        seen = input.input;
        return new Promise(() => undefined);
      },
    };
    const first = browser.resumeTask("job");
    expect(first.ok).toBe(true);
    expect(first.tabId).toBe("page");
    expect(browser.taskPool.tasks.find((item) => item.id === "job")?.state).toBe("running");
    const again = browser.resumeTask("job");
    expect(again.ok).toBe(false);
    expect(browser.taskPool.tasks.filter((item) => item.tabId === "page")).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(seen).toBe("编辑商品 A");
    expect(created()).toBe(0);
    expect(browser.taskPool.tasks.find((item) => item.id === "job")?.clientId).toBe("jia");
    expect(browser.taskPool.tasks.find((item) => item.id === "job")?.tabId).toBe("page");
    expect(activeLeaseForTab("page")?.clientId).toBe("jia");

    browser.taskPool.finish("job", "stopped");
    browser.freeSoul = {
      run: async () => {
        throw new Error("原页恢复不了");
      },
    };
    const resumed = browser.resumeTask("job");
    expect(resumed.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 40));
    const card = browser.taskPool.tasks.find((item) => item.id === "job");
    expect(card?.state).toBe("failed");
    expect(card?.state).not.toBe("done");
    expect(card?.tabId).toBe("page");
    expect(activeLeaseForTab("page")?.taskId).toBe("job");
    expect(created()).toBe(0);
  });

  it("异常留下步骤、尝试和建议，同一条不重复刷总指挥；停止不会被迟到的完成盖掉", () => {
    const { browser } = harness();
    browser.noteTaskFailure("job", {
      step: "卡在保存",
      tried: "点了保存",
      advice: "请看当前页报错",
      message: "保存没有返回",
    });
    browser.noteTaskFailure("job", {
      step: "卡在保存",
      tried: "又点了一次",
      message: "保存没有返回",
    });
    browser.taskPool.finish("job", "failed");
    const card = browser.taskPool.tasks.find((item) => item.id === "job");
    expect(card?.state).toBe("failed");
    expect(card?.failureStep).toBe("卡在保存");
    expect(card?.step).toBe("卡在保存");
    expect(card?.attempts).toEqual(["点了保存", "又点了一次"]);
    expect(card?.advice).toContain("当前页");
    expect(commandTexts(browser).filter((text) => text.includes("任务异常"))).toHaveLength(1);
    const row = browser.commandOverview().find((item) => item.tabId === "page");
    expect(row?.tone).toBe("red");
    expect(row?.step).toBe("卡在保存");
    expect(row?.summary).toContain("保存没有返回");
    expect(activeLeaseForTab("page")?.taskId).toBe("job");
    expect(browser.chatSessions.get(taskSessionKey("page", "job"))).toBeUndefined();

    browser.taskPool.finish("job", "done");
    expect(browser.taskPool.tasks.find((item) => item.id === "job")?.state).toBe("failed");

    const { browser: stopped } = harness();
    stopped.stopAgentTask("job");
    stopped.taskPool.finish("job", "done");
    expect(stopped.taskPool.tasks.find((item) => item.id === "job")?.state).toBe("stopped");
    const tone = stopped.commandOverview().find((item) => item.tabId === "page")?.tone;
    expect(tone).toBe("gray");
    expect(activeLeaseForTab("page")?.taskId).toBe("job");
    const ended = stopped.closeTask("job", "keep");
    expect(ended.ok).toBe(true);
    expect(activeLeaseForTab("page")).toBeUndefined();
  });
});
