import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { allocateClientTab, claimTabForClient, registerClientName, resetMcpSessions } from "../src/main/agent/mcp-sessions.js";

const dirs: string[] = [];
afterEach(() => {
  resetMcpSessions();
  resetPageLeases();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function box(dir: string) {
  const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & Record<string, never> & {
    tabs: Map<string, { id: string; title: string; url: string; envId?: string; winId?: string; kind?: "web"; view: null; discarded?: boolean; lastActiveAt: number; holdHuman?: boolean; agentStatus?: "done" }>;
    taskPool: TaskPool;
    configDir: () => string;
    settings: { locale: string; execMode: "auto"; apiKey?: string };
    freeSoulRuns: number;
  };
  browser.tabs = new Map();
  browser.taskPool = new TaskPool();
  browser.configDir = () => dir;
  browser.settings = { locale: "zh-CN", execMode: "auto", apiKey: "k" };
  browser.freeSoulRuns = 0;
  browser.freeSoul = { run: async () => { browser.freeSoulRuns += 1; return { ok: true, text: "不该自动跑" }; } };
  browser.createAgentTab = () => {
    throw new Error("恢复不该新开页");
  };
  return browser;
}

describe("重启恢复", () => {
  it("排队和进行中变成失败并写明要原任务恢复，不自动执行", () => {
    const dir = mkdtempSync(join(tmpdir(), "sparo-recover-"));
    dirs.push(dir);
    const first = box(dir);
    first.tabs.set("page", { id: "page", title: "商品", url: "https://dxm.example/a", kind: "web", view: null, lastActiveAt: 1 });
    first.taskPool.start({ id: "run", tabId: "page", title: "进行中的", lane: "background", clientId: "jia", agentName: "Cursor" });
    first.taskPool.enqueue({ id: "wait", tabId: "page", title: "排队的", lane: "background", clientId: "jia", agentName: "Cursor" });
    acquireLease({ tabId: "page", taskId: "run", clientId: "jia" });
    first.persistWorkState();

    const next = box(dir);
    next.tabs.set("page", { id: "page", title: "商品", url: "https://dxm.example/a", kind: "web", view: null, lastActiveAt: 1 });
    next.restoreWorkState();
    const running = next.taskPool.tasks.find((task) => task.id === "run");
    const queued = next.taskPool.tasks.find((task) => task.id === "wait");
    expect(running?.state).toBe("failed");
    expect(queued?.state).toBe("failed");
    expect(running?.lastLine).toBe("应用中断，需原任务恢复");
    expect(queued?.lastLine).toBe("应用中断，需原任务恢复");
    expect(next.commandOverview().find((row) => row.taskId === "run")?.tone).toBe("red");
    expect(next.freeSoulRuns).toBe(0);
    expect(running?.tabId).toBe("page");
  });

  it("等人的任务重启后仍等人工，不调用执行器", () => {
    const dir = mkdtempSync(join(tmpdir(), "sparo-recover-human-"));
    dirs.push(dir);
    const first = box(dir);
    first.tabs.set("page", { id: "page", title: "商品", url: "https://dxm.example/a", envId: "shop-a", kind: "web", view: null, lastActiveAt: 1 });
    first.taskPool.start({ id: "ask", tabId: "page", title: "等人", lane: "background", clientId: "jia", agentName: "Cursor" });
    first.markWaitingHuman("ask", "请确认发布");
    first.persistWorkState();

    const next = box(dir);
    next.restoreWorkState();
    const task = next.taskPool.tasks.find((item) => item.id === "ask");
    expect(task?.state).toBe("waiting_human");
    expect(task?.humanReason).toBe("请确认发布");
    expect(task?.tabId).toBe("page");
    expect(next.tabs.get("page")?.holdHuman).toBe(true);
    expect(next.tabs.get("page")?.envId).toBe("shop-a");
    expect(next.commandOverview().find((row) => row.tabId === "page")?.tone).toBe("yellow");
    expect(next.freeSoulRuns).toBe(0);
  });

  it("原页恢复不了时不改派 tabId，别人也拿不走这个 id", () => {
    const dir = mkdtempSync(join(tmpdir(), "sparo-recover-miss-"));
    dirs.push(dir);
    const first = box(dir);
    first.taskPool.start({ id: "gone", tabId: "missing-page", title: "丢了", lane: "background", clientId: "jia", agentName: "Cursor" });
    acquireLease({ tabId: "missing-page", taskId: "gone", clientId: "jia", envId: "env-a" });
    first.persistWorkState();
    resetPageLeases();

    const next = box(dir);
    next.restoreWorkState();
    const task = next.taskPool.tasks.find((item) => item.id === "gone");
    expect(task?.tabId).toBe("missing-page");
    expect(task?.state).toBe("failed");
    expect(task?.lastLine).toBe("原页面恢复不了，没有改派到别的页");
    expect(next.commandOverview().find((row) => row.taskId === "gone")?.tone).toBe("red");
    expect(next.tabs.has("missing-page")).toBe(false);
    expect(next.tabs.size).toBe(0);
    const stolen = allocateClientTab({
      intent: "task",
      clientId: "yi",
      taskId: "other",
      tabId: "missing-page",
      knownTabIds: ["missing-page"],
      createAgentTab: () => {
        throw new Error("不该改派");
      },
      occupancy: () => ({ openTask: false, agentOwned: false }),
    });
    expect(stolen).toEqual({ ok: false, error: "tab_busy" });
  });

  it("再次恢复不新建父组和结果卡", () => {
    const dir = mkdtempSync(join(tmpdir(), "sparo-recover-once-"));
    dirs.push(dir);
    const first = box(dir);
    first.tabs.set("page", { id: "page", title: "商品", url: "https://dxm.example/a", kind: "web", view: null, lastActiveAt: 1 });
    first.taskPool.start({ id: "done-job", tabId: "page", title: "做完", lane: "background", clientId: "jia", agentName: "Cursor" });
    first.recordVerification("done-job", [{ name: "保存", ok: true }]);
    const flashes: boolean[] = [];
    first.window = {
      isDestroyed: () => false,
      isMinimized: () => true,
      isFocused: () => false,
      flashFrame: (on: boolean) => flashes.push(on),
    } as unknown as SparkBrowser["window"];
    expect(first.sealTaskOutcome("done-job", "done")).toBe("done");
    first.taskPool.finish("done-job", "done");
    const group = first.createTaskGroup("一组", ["done-job"]);
    first.persistWorkState();
    expect(flashes).toContain(true);

    const next = box(dir);
    next.tabs.set("page", { id: "page", title: "商品", url: "https://dxm.example/a", kind: "web", view: null, lastActiveAt: 1 });
    next.restoreWorkState();
    const card = next.taskPool.tasks.find((task) => task.id === "done-job")?.resultCard;
    next.restoreWorkState();
    const again = next.taskPool.tasks.filter((task) => task.id === "done-job");
    expect(again).toHaveLength(1);
    expect(again[0]?.resultCard).toBe(card);
    expect(next.taskGroupViews().filter((item) => item.groupId === group.groupId)).toHaveLength(1);
    expect(next.freeSoulRuns).toBe(0);
  });

  it("休眠不放租约和提醒，空闲页不显示别人的名字，结束清提醒", () => {
    const dir = mkdtempSync(join(tmpdir(), "sparo-recover-keep-"));
    dirs.push(dir);
    const browser = box(dir);
    browser.tabs.set("idle", { id: "idle", title: "空页", url: "https://example.com", kind: "web", view: null, lastActiveAt: 1 });
    browser.tabs.set("page", { id: "page", title: "商品", url: "https://dxm.example/a", kind: "web", view: null, lastActiveAt: 1 });
    registerClientName("jia", "Cursor");
    claimTabForClient("jia", "idle");
    browser.activeTabId = "idle";
    expect(browser.listTabs().tabs.find((tab) => tab.id === "idle")?.pageStatus?.agentName).toBe("");
    browser.taskPool.start({ id: "job", tabId: "page", title: "商品", lane: "background", clientId: "jia", agentName: "Cursor" });
    acquireLease({ tabId: "page", taskId: "job", clientId: "jia" });
    browser.markWaitingHuman("job", "请确认");
    browser.taskAttention.set("page\njob", { tabId: "page", taskId: "job", acked: false });
    browser.activeTabId = "idle";
    expect(browser.discardTab("page")).toBe(true);
    expect(browser.tabs.get("page")?.discarded).toBe(true);
    expect(browser.tabs.get("page")?.holdHuman).toBe(true);
    expect(activeLeaseForTab("page")?.taskId).toBe("job");
    expect(browser.taskPool.tasks.find((task) => task.id === "job")?.tabId).toBe("page");
    expect(browser.pageStatusFor("page").attention).toBe(true);
    browser.taskPool.finish("job", "stopped");
    browser.closeTask("job", "keep");
    expect(browser.pageStatusFor("page").attention).toBeUndefined();
  });

  it("页面关掉后再恢复，不出现已关页的提醒", () => {
    const dir = mkdtempSync(join(tmpdir(), "sparo-recover-closed-attn-"));
    dirs.push(dir);
    const first = box(dir);
    first.window = { isDestroyed: () => true } as unknown as SparkBrowser["window"];
    first.tabs.set("keep", { id: "keep", title: "留下", url: "https://example.com", kind: "web", view: null, lastActiveAt: 1 });
    first.tabs.set("page", { id: "page", title: "商品", url: "https://dxm.example/a", kind: "web", view: null, lastActiveAt: 1 });
    first.tabs.set("other", { id: "other", title: "另一页", url: "https://dxm.example/b", kind: "web", view: null, lastActiveAt: 1 });
    first.activeTabId = "keep";
    first.taskPool.start({ id: "gone", tabId: "page", title: "已关", lane: "background", clientId: "jia", agentName: "Cursor" });
    first.recordVerification("gone", [{ name: "保存", ok: true }]);
    expect(first.sealTaskOutcome("gone", "done")).toBe("done");
    first.taskPool.finish("gone", "done");
    first.taskPool.start({ id: "stay", tabId: "other", title: "还在", lane: "background", clientId: "jia", agentName: "Cursor" });
    first.recordVerification("stay", [{ name: "保存", ok: true }]);
    expect(first.sealTaskOutcome("stay", "done")).toBe("done");
    first.taskPool.finish("stay", "done");
    expect(first.taskAttention.get("page\ngone")?.acked).toBe(false);
    expect(first.destroyTab("page").ok).toBe(true);
    expect(first.taskAttention.has("page\ngone")).toBe(false);
    expect(first.taskAttention.get("other\nstay")?.acked).toBe(false);
    first.persistWorkState();

    const next = box(dir);
    next.tabs.set("keep", { id: "keep", title: "留下", url: "https://example.com", kind: "web", view: null, lastActiveAt: 1 });
    next.tabs.set("other", { id: "other", title: "另一页", url: "https://dxm.example/b", kind: "web", view: null, lastActiveAt: 1 });
    next.restoreWorkState();
    expect(next.taskAttention.has("page\ngone")).toBe(false);
    expect(next.commandOverview().find((row) => row.taskId === "gone")?.attention).toBeUndefined();
    expect(next.pageStatusFor("other").attention).toBe(true);
  });

  it("账号对不上时不改派、不打开另一环境的页，任务仍以红色留在总览", () => {
    const dir = mkdtempSync(join(tmpdir(), "sparo-recover-env-"));
    dirs.push(dir);
    const first = box(dir);
    first.taskPool.start({ id: "gone", tabId: "page", title: "甲店", lane: "background", clientId: "jia", agentName: "Cursor" });
    acquireLease({ tabId: "page", taskId: "gone", clientId: "jia", envId: "env-a" });
    first.persistWorkState();
    resetPageLeases();

    const next = box(dir);
    next.tabs.set("page", { id: "page", title: "乙店", url: "https://other.example/b", envId: "env-b", kind: "web", view: null, lastActiveAt: 1 });
    const switched: string[] = [];
    next.switchTab = (id: string) => {
      switched.push(id);
      return { ok: true, message: "" };
    };
    next.pushSidebarState = () => undefined;
    next.restoreWorkState();
    const task = next.taskPool.tasks.find((item) => item.id === "gone");
    expect(task?.tabId).toBe("page");
    expect(task?.state).toBe("failed");
    expect(task?.lastLine).toBe("原页面恢复不了，没有改派到别的页");
    expect(next.tabs.size).toBe(1);
    expect(next.tabs.get("page")?.envId).toBe("env-b");
    expect(next.pageStatusFor("page").taskId).toBe("");
    expect(next.commandOverview().find((row) => row.taskId === "gone")?.tone).toBe("red");
    expect(next.focusTask("gone").ok).toBe(true);
    expect(switched).toEqual([]);
    expect(next.freeSoulRuns).toBe(0);
    const stolen = allocateClientTab({
      intent: "task",
      clientId: "yi",
      taskId: "other",
      tabId: "page",
      knownTabIds: ["page"],
      createAgentTab: () => {
        throw new Error("不该改派");
      },
      occupancy: () => ({ openTask: false, agentOwned: false }),
    });
    expect(stolen).toEqual({ ok: false, error: "tab_busy" });
  });

  it("已完成、已停止、已失败保持原样，已读提醒不复活，未读还在", () => {
    const dir = mkdtempSync(join(tmpdir(), "sparo-recover-keepstate-"));
    dirs.push(dir);
    const first = box(dir);
    first.tabs.set("page", { id: "page", title: "商品", url: "https://dxm.example/a", kind: "web", view: null, lastActiveAt: 1 });
    first.tabs.set("read-page", { id: "read-page", title: "看过", url: "https://dxm.example/read", kind: "web", view: null, lastActiveAt: 1 });
    first.tabs.set("fresh-page", { id: "fresh-page", title: "没看", url: "https://dxm.example/fresh", kind: "web", view: null, lastActiveAt: 1 });
    first.taskPool.start({ id: "stop", tabId: "page", title: "停了", lane: "background", clientId: "jia", agentName: "Cursor" });
    first.taskPool.finish("stop", "stopped");
    const stopped = first.taskPool.tasks.find((task) => task.id === "stop");
    if (stopped) stopped.lastLine = "人停了";
    first.taskPool.start({ id: "bad", tabId: "page", title: "坏了", lane: "background", clientId: "jia", agentName: "Cursor" });
    first.taskPool.finish("bad", "failed");
    const failed = first.taskPool.tasks.find((task) => task.id === "bad");
    if (failed) failed.lastLine = "保存失败";
    first.taskPool.start({ id: "read", tabId: "read-page", title: "看过", lane: "background", clientId: "jia", agentName: "Cursor" });
    first.recordVerification("read", [{ name: "保存", ok: true }]);
    first.sealTaskOutcome("read", "done");
    first.taskPool.finish("read", "done");
    first.ackTask("read");
    first.taskPool.start({ id: "fresh", tabId: "fresh-page", title: "没看", lane: "background", clientId: "jia", agentName: "Cursor" });
    first.recordVerification("fresh", [{ name: "保存", ok: true }]);
    first.sealTaskOutcome("fresh", "done");
    first.taskPool.finish("fresh", "done");
    first.persistWorkState();

    const next = box(dir);
    next.tabs.set("page", { id: "page", title: "商品", url: "https://dxm.example/a", kind: "web", view: null, lastActiveAt: 1 });
    next.tabs.set("read-page", { id: "read-page", title: "看过", url: "https://dxm.example/read", kind: "web", view: null, lastActiveAt: 1 });
    next.tabs.set("fresh-page", { id: "fresh-page", title: "没看", url: "https://dxm.example/fresh", kind: "web", view: null, lastActiveAt: 1 });
    next.restoreWorkState();
    expect(next.taskPool.tasks.find((task) => task.id === "stop")?.state).toBe("stopped");
    expect(next.taskPool.tasks.find((task) => task.id === "stop")?.lastLine).toBe("人停了");
    expect(next.taskPool.tasks.find((task) => task.id === "bad")?.state).toBe("failed");
    expect(next.taskPool.tasks.find((task) => task.id === "bad")?.lastLine).toBe("保存失败");
    expect(next.pageStatusFor("fresh-page").attention).toBe(true);
    expect(next.pageStatusFor("read-page").attention).toBeUndefined();
    expect(next.chromeStateFor("main").overview.find((row) => row.tabId === "fresh-page")?.attention).toBe(true);
    expect(next.chromeStateFor("w2").overview.find((row) => row.tabId === "fresh-page")?.attention).toBe(true);
    expect(next.freeSoulRuns).toBe(0);
  });

  it("恢复不删旧聊天，也不把旧摘要当成新任务", () => {
    const dir = mkdtempSync(join(tmpdir(), "sparo-recover-legacy-"));
    dirs.push(dir);
    const chat = join(dir, "chat-memory.json");
    writeFileSync(chat, JSON.stringify([{ role: "user", text: "昨天的话" }]), "utf8");
    writeFileSync(
      join(dir, "agent-task-summaries.json"),
      JSON.stringify({ tasks: [{ taskId: "old", goal: "旧任务", status: "done", lastStep: "完成", at: 1, clientId: "jia" }] }),
      "utf8",
    );
    const browser = box(dir);
    browser.tabs.set("page", { id: "page", title: "商品", url: "https://dxm.example/a", kind: "web", view: null, lastActiveAt: 1 });
    browser.taskPool.start({ id: "now", tabId: "page", title: "现在", lane: "background", clientId: "jia", agentName: "Cursor" });
    browser.persistWorkState();
    const next = box(dir);
    next.tabs.set("page", { id: "page", title: "商品", url: "https://dxm.example/a", kind: "web", view: null, lastActiveAt: 1 });
    next.restoreWorkState();
    expect(readFileSync(chat, "utf8")).toContain("昨天的话");
    expect(readFileSync(join(dir, "agent-task-summaries.bak.json"), "utf8")).toContain("旧任务");
    const saved = JSON.parse(readFileSync(join(dir, "agent-task-summaries.json"), "utf8")) as { tasks: Array<{ taskId: string; schema?: number }> };
    expect(saved.tasks.some((row) => row.taskId === "old" && row.schema !== 1)).toBe(true);
    expect(next.taskPool.tasks.map((task) => task.id)).toEqual(["now"]);
    expect(next.taskPool.tasks.find((task) => task.id === "now")?.state).toBe("failed");
    expect(next.freeSoulRuns).toBe(0);
  });

  it("唤醒仍打开原来的地址，对话和租约不动", () => {
    const dir = mkdtempSync(join(tmpdir(), "sparo-recover-wake-"));
    dirs.push(dir);
    const browser = box(dir);
    browser.tabs.set("idle", { id: "idle", title: "空页", url: "https://example.com", kind: "web", view: null, lastActiveAt: 1 });
    browser.tabs.set("page", { id: "page", title: "商品", url: "https://dxm.example/a", kind: "web", view: null, lastActiveAt: 1 });
    browser.taskPool.start({ id: "job", tabId: "page", title: "商品", lane: "background", clientId: "jia", agentName: "Cursor" });
    acquireLease({ tabId: "page", taskId: "job", clientId: "jia" });
    browser.appendChat("task:page:job", "原来的话");
    browser.activeTabId = "idle";
    expect(browser.discardTab("page")).toBe(true);
    const loaded: string[] = [];
    browser.makePageView = () =>
      ({
        webContents: {
          loadURL: (url: string) => {
            loaded.push(url);
            return Promise.resolve();
          },
          once: () => undefined,
          isDestroyed: () => false,
        },
      }) as unknown as ReturnType<SparkBrowser["makePageView"]>;
    browser.pinViewBeforeMount = () => undefined;
    browser.bindPageWebContents = () => undefined;
    browser.layout = () => undefined;
    browser.window = { contentView: { addChildView: () => undefined }, isDestroyed: () => false } as unknown as SparkBrowser["window"];
    browser.viewForTab("page");
    expect(browser.tabs.get("page")?.id).toBe("page");
    expect(loaded.some((url) => url.includes("dxm.example/a"))).toBe(true);
    expect(browser.turnsFor("task:page:job").map((turn) => turn.text)).toEqual(["原来的话"]);
    expect(activeLeaseForTab("page")?.taskId).toBe("job");
    expect(browser.taskPool.tasks.find((task) => task.id === "job")?.state).toBe("running");
  });

  it("关掉窗口或删掉账号环境后，没有还在跑的无页任务", () => {
    const dir = mkdtempSync(join(tmpdir(), "sparo-recover-close-"));
    dirs.push(dir);
    const browser = box(dir);
    browser.window = { isDestroyed: () => true } as unknown as SparkBrowser["window"];
    browser.shellBornAt = new Map();
    browser.shellBeatAt = new Map();
    browser.shellFocusAt = new Map();
    browser.shellRestartAt = new Map();
    browser.shellRestarting = new Set();
    browser.tabs.set("stay", { id: "stay", title: "留下", url: "https://example.com", winId: "main", kind: "web", view: null, lastActiveAt: 1 });
    browser.tabs.set("gone", { id: "gone", title: "副窗", url: "https://dxm.example/a", winId: "w2", kind: "web", view: null, lastActiveAt: 1 });
    browser.taskPool.start({ id: "side", tabId: "gone", title: "副窗任务", lane: "background", clientId: "jia", agentName: "Cursor" });
    browser.taskPool.start({ id: "main-job", tabId: "stay", title: "主窗任务", lane: "background", clientId: "jia", agentName: "Cursor" });
    browser.closeWindow("w2");
    expect(browser.tabs.has("gone")).toBe(false);
    expect(browser.tabs.has("stay")).toBe(true);
    expect(browser.taskPool.tasks.find((task) => task.id === "side")?.state).toBe("stopped");
    expect(browser.taskPool.tasks.find((task) => task.id === "main-job")?.state).toBe("running");

    const env = browser.createEnvTool({ account: { name: "乙店", homeUrl: "https://shop.example" } });
    const envId = String((env.data as { id?: string }).id || "");
    browser.tabs.set("shop", { id: "shop", title: "乙店", url: "https://shop.example", envId, kind: "web", view: null, lastActiveAt: 1 });
    browser.taskPool.start({ id: "shop-job", tabId: "shop", title: "乙店任务", lane: "background", clientId: "yi", agentName: "Cursor" });
    browser.activeTabId = "stay";
    return browser.deleteEnvFully(envId).then((result) => {
      expect(browser.tabs.has("shop")).toBe(false);
      expect(browser.taskPool.tasks.find((task) => task.id === "shop-job")?.state).not.toBe("running");
      expect(browser.taskPool.tasks.find((task) => task.id === "shop-job")?.state).not.toBe("queued");
      expect(browser.taskPool.tasks.find((task) => task.id === "main-job")?.state).toBe("running");
      expect(result.ok).toBe(false);
    });
  });
});
