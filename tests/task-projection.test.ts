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
import { claimTabForClient, registerClientName, resetMcpSessions } from "../src/main/agent/mcp-sessions.js";
import { concreteStep, projectPageSnapshot, type PageTaskFact } from "../src/main/agent/task-state.js";

const dirs: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  resetMcpSessions();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fact(patch: Partial<PageTaskFact> & Pick<PageTaskFact, "id" | "tabId" | "state">): PageTaskFact {
  return { step: "", agentName: "Cursor", ...patch };
}

describe("页面状态投影", () => {
  it("别的页的任务不会借租约串过来，红黄压过绿，名字不决定颜色", () => {
    const leaked = projectPageSnapshot({
      tabId: "tab-a",
      ownerClientId: "jia",
      ownerName: "Cursor",
      lease: { clientId: "jia", taskId: "other" },
      tasks: [fact({ id: "other", tabId: "tab-b", state: "running", step: "正在编辑另一个商品" })],
    });
    expect(leaked.state).toBe("idle");
    expect(leaked.tone).toBe("gray");
    expect(leaked.label).toBe("静止／无 Agent");
    expect(leaked.step).toBe("静止／无 Agent");
    expect(leaked.step).not.toContain("另一个");

    const blocked = projectPageSnapshot({
      tabId: "tab-a",
      tasks: [
        fact({ id: "go", tabId: "tab-a", state: "running", step: "正在读取" }),
        fact({ id: "bad", tabId: "tab-a", state: "failed", step: "卡在保存", agentName: "Trae" }),
      ],
    });
    expect(blocked.state).toBe("failed");
    expect(blocked.tone).toBe("red");
    expect(blocked.step).toBe("卡在保存");
    expect(blocked.agentName).toBe("Trae");

    const waiting = projectPageSnapshot({
      tabId: "tab-a",
      tasks: [
        fact({ id: "go", tabId: "tab-a", state: "running", step: "正在读取", agentName: "Cursor" }),
        fact({ id: "ask", tabId: "tab-a", state: "waiting_human", step: "等你确认发布", lastLine: "要不要发出去" }),
      ],
    });
    expect(waiting.state).toBe("waiting_human");
    expect(waiting.tone).toBe("yellow");
    expect(waiting.summary).toContain("要不要发出去");

    const named = ["Cursor", "Trae"].map((agentName) =>
      projectPageSnapshot({
        tabId: "tab-a",
        tasks: [fact({ id: agentName, tabId: "tab-a", state: "running", step: "正在读取", agentName })],
      }),
    );
    expect(named[0]?.tone).toBe("green");
    expect(named[1]?.tone).toBe(named[0]?.tone);
    expect(projectPageSnapshot({ tabId: "idle", tasks: [] }).tone).toBe("gray");
    expect(projectPageSnapshot({
      tabId: "done",
      tasks: [fact({ id: "d", tabId: "done", state: "done", step: "完成" })],
    }).tone).toBe("gray");
    expect(projectPageSnapshot({
      tabId: "stop",
      tasks: [fact({ id: "s", tabId: "stop", state: "stopped", step: "已停止" })],
    }).tone).toBe("gray");
    const interrupted = projectPageSnapshot({
      tabId: "jd",
      tasks: [],
      ownerClientId: "sidebar",
      markedStopped: true,
      markedDone: true,
    });
    expect(interrupted.state).toBe("stopped");
    expect(interrupted.label).toBe("已停止·待结束");
    expect(concreteStep("running", "正在努力")).toBe("等待下一步");
    expect(concreteStep("queued", "")).toBe("排队中");
    expect(concreteStep("running", "正在读取商品")).toBe("正在读取商品");
  });
});

type TabStub = {
  id: string;
  title: string;
  url: string;
  kind?: "command" | "web";
  view: null;
  lastActiveAt: number;
};

function harness() {
  const dir = mkdtempSync(join(tmpdir(), "sparo-projection-"));
  dirs.push(dir);
  const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & {
    tabs: Map<string, TabStub>;
    taskPool: TaskPool;
    settings: { locale: string; execMode: "step" | "auto"; llmMode?: string; apiKey?: string };
    approvals: Map<string, never>;
    skillsCache: unknown[];
    recording: boolean;
    paused: boolean;
    configDir: () => string;
    getUrl: (id?: string) => string;
    getTitle: (id?: string) => string;
    taskScope: { getStore: () => { tabId: string; lane: "background"; chatKey: string } };
    chatSessions: Map<string, Array<{ role: string; text: string }>>;
  };
  browser.tabs = new Map([
    ["command-main", { id: "command-main", kind: "command", title: "指挥室", url: "", view: null, lastActiveAt: 1 }],
    ["user", { id: "user", kind: "web", title: "百度", url: "https://baidu.com", view: null, lastActiveAt: 1 }],
    ["tab-a", { id: "tab-a", kind: "web", title: "店小秘商品 A", url: "https://dxm.example/a", view: null, lastActiveAt: 1 }],
    ["tab-b", { id: "tab-b", kind: "web", title: "店小秘商品 B", url: "https://dxm.example/b", view: null, lastActiveAt: 1 }],
    ["tab-c", { id: "tab-c", kind: "web", title: "空页", url: "https://dxm.example/c", view: null, lastActiveAt: 1 }],
  ]);
  browser.taskPool = new TaskPool();
  browser.settings = { locale: "zh-CN", execMode: "step", llmMode: "byok", apiKey: "test-key" };
  browser.approvals = new Map();
  browser.skillsCache = [];
  browser.recording = false;
  browser.paused = false;
  browser.configDir = () => dir;
  browser.getUrl = () => "https://dxm.example/a";
  browser.getTitle = () => "店小秘商品 A";
  browser.activeTabId = "tab-a";
  let scopeTab = "tab-a";
  browser.taskScope = {
    getStore: () => ({ tabId: scopeTab, lane: "background", chatKey: "task" }),
  };
  browser.chatSessions = new Map([["command", [{ role: "assistant", text: "总指挥原话" }]]]);
  registerClientName("jia", "Cursor");
  claimTabForClient("jia", "tab-c");
  return {
    browser,
    setScope(tabId: string) {
      scopeTab = tabId;
    },
  };
}

function core(snap: { agentName?: string; state?: string; tone?: string; step?: string; updatedAt?: number } | undefined) {
  return {
    agentName: snap?.agentName || "",
    state: snap?.state || "",
    tone: snap?.tone || "",
    step: snap?.step || "",
    updatedAt: snap?.updatedAt || 0,
  };
}

describe("三处状态同源", () => {
  it("同一页的标签、侧栏和指挥室一致，同 Agent 的另一页不会串步骤", () => {
    const { browser } = harness();
    browser.taskPool.start({
      id: "job-a",
      tabId: "tab-a",
      title: "商品 A",
      lane: "background",
      clientId: "jia",
      agentName: "Cursor",
      color: "#ff00aa",
    });
    browser.taskPool.start({
      id: "job-b",
      tabId: "tab-b",
      title: "商品 B",
      lane: "background",
      clientId: "jia",
      agentName: "Cursor",
      color: "#00aaff",
    });
    const taskA = browser.taskPool.tasks.find((item) => item.id === "job-a");
    const taskB = browser.taskPool.tasks.find((item) => item.id === "job-b");
    if (!taskA || !taskB) throw new Error("任务没建起来");
    taskA.step = "正在编辑商品";
    taskA.updatedAt = 1_700_000_000_000;
    taskB.step = "正在编辑另一个商品";
    taskB.updatedAt = 1_700_000_000_100;

    browser.activeTabId = "user";
    const userSide = browser.getSidebarPayload(false, true) as { pageStatus?: { state: string; label: string; agentName: string } };
    const userTab = browser.listTabs().tabs.find((tab) => tab.id === "user");
    const userRow = browser.commandOverview().find((row) => row.tabId === "user");
    expect(userSide.pageStatus?.state).toBe("idle");
    expect(userSide.pageStatus?.label).toBe("静止／无 Agent");
    expect(userSide.pageStatus?.agentName).toBe("");
    expect(core(userTab?.pageStatus)).toEqual(core(userRow));
    expect(core(userSide.pageStatus)).toEqual(core(userRow));
    expect(userTab?.agentState).toBeUndefined();

    browser.activeTabId = "tab-a";
    const side = browser.getSidebarPayload(false, true) as { pageStatus?: { agentName: string; state: string; tone: string; step: string; updatedAt: number } };
    const tab = browser.listTabs().tabs.find((item) => item.id === "tab-a");
    const row = browser.commandOverview().find((item) => item.tabId === "tab-a");
    const other = browser.commandOverview().find((item) => item.tabId === "tab-b");
    const idleOwned = browser.commandOverview().find((item) => item.tabId === "tab-c");
    expect(core(tab?.pageStatus)).toEqual(core(row));
    expect(core(side.pageStatus)).toEqual(core(row));
    expect(row?.tone).toBe("green");
    expect(row?.agentName).toBe("Cursor");
    expect(row?.step).toBe("正在编辑商品");
    expect(other?.step).toBe("正在编辑另一个商品");
    expect(other?.tone).toBe("green");
    expect(other?.step).not.toBe(row?.step);
    expect(idleOwned?.state).toBe("idle");
    expect(idleOwned?.step).toBe("静止／无 Agent");
    expect(idleOwned?.step).not.toContain("正在编辑");
    expect(browser.commandOverview().some((item) => item.tabId === "command-main")).toBe(false);
    expect(tab?.pageStatus?.tone).not.toBe("#ff00aa");
  });

  it("普通步骤只改本页，不写总指挥，100ms 合并保留终态且状态立刻推", () => {
    vi.useFakeTimers();
    const { browser, setScope } = harness();
    browser.taskPool.start({
      id: "job-a",
      tabId: "tab-a",
      title: "商品 A",
      lane: "background",
      clientId: "jia",
      agentName: "Cursor",
    });
    browser.taskPool.start({
      id: "job-b",
      tabId: "tab-b",
      title: "商品 B",
      lane: "background",
      clientId: "jia",
      agentName: "Cursor",
    });
    const taskB = browser.taskPool.tasks.find((item) => item.id === "job-b");
    if (taskB) {
      taskB.step = "正在编辑另一个商品";
      taskB.updatedAt = 50;
    }
    const seen: string[] = [];
    const fakeWin = {
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false, send() {} },
    };
    browser.window = fakeWin as unknown as SparkBrowser["window"];
    browser.liveWins = () => [["main", fakeWin]] as unknown as ReturnType<SparkBrowser["liveWins"]>;
    browser.flushChromeState = () => {
      const left = browser.pageStatusFor("tab-a");
      const right = browser.pageStatusFor("tab-b");
      seen.push(`${left.state}:${left.step}|${right.state}:${right.step}`);
    };
    browser.flushSidebarState = () => undefined;
    let switched = 0;
    let focused = 0;
    browser.switchTab = () => {
      switched += 1;
      return { ok: true, message: "" };
    };
    browser.focusActivePage = () => {
      focused += 1;
    };

    setScope("tab-a");
    browser.noteTaskStep("正在努力");
    browser.noteTaskStep("正在上传");
    expect(seen).toEqual([]);
    expect(browser.chatSessions.get("command")?.map((turn) => turn.text)).toEqual(["总指挥原话"]);
    expect(browser.taskPool.tasks.find((item) => item.id === "job-b")?.step).toBe("正在编辑另一个商品");

    vi.advanceTimersByTime(100);
    expect(seen).toEqual(["running:正在上传|running:正在编辑另一个商品"]);
    expect(seen[0]).not.toContain("正在努力");
    expect(switched).toBe(0);
    expect(focused).toBe(0);

    browser.taskPool.finish("job-a", "failed");
    browser.syncTaskChrome();
    expect(seen.at(-1)).toBe("failed:失败|running:正在编辑另一个商品");
    const before = seen.length;
    vi.advanceTimersByTime(200);
    expect(seen.length).toBe(before);
    expect(seen.at(-1)?.startsWith("failed:")).toBe(true);
    expect(switched).toBe(0);
    expect(focused).toBe(0);
  });
});
