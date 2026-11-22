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
import { summarizeGroup } from "../src/main/agent/command-room.js";
import { setWaitingWriteLookup } from "../src/main/agent/tab-guard.js";
import { bindMcpWrite } from "../src/main/mcp-server.js";
import { taskSessionKey } from "../src/main/agent/session-key.js";
import type { ActiveMission } from "../src/main/agent/runtime.js";

const dirs: string[] = [];
afterEach(() => {
  setWaitingWriteLookup(() => ({ waiting: false }));
  resetMcpSessions();
  resetPageLeases();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Tab = {
  id: string;
  title: string;
  url: string;
  kind?: "web" | "command";
  view: null;
  lastActiveAt: number;
  agentStatus?: "done";
};

function harness() {
  const dir = mkdtempSync(join(tmpdir(), "sparo-review-"));
  dirs.push(dir);
  const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & {
    tabs: Map<string, Tab>;
    taskPool: TaskPool;
    settings: { locale: string; execMode: "auto"; llmMode?: string; apiKey?: string };
    approvals: Map<string, never>;
    skillsCache: unknown[];
    recording: boolean;
    paused: boolean;
    configDir: () => string;
    getUrl: (id?: string) => string;
    getTitle: (id?: string) => string;
    chatSessions: Map<string, Array<{ role: string; text: string }>>;
    freeSoul: { run: (input: { input: string; history?: Array<{ role: string; text: string }> }) => Promise<{ ok: boolean; text: string; awaitingConfirm?: boolean }> };
    beginCloudTaskIfNeeded: () => Promise<undefined>;
    pageEnv: () => { envId: string; envName: string };
    envRoster: () => [];
    layout: () => void;
    wakeTab: (id: string) => void;
  };
  browser.tabs = new Map([
    ["command-main", { id: "command-main", kind: "command", title: "指挥室", url: "", view: null, lastActiveAt: 1 }],
    ["page", { id: "page", kind: "web", title: "商品A", url: "https://dxm.example/a", view: null, lastActiveAt: 1 }],
    ["keep", { id: "keep", kind: "web", title: "留着", url: "https://example.com", view: null, lastActiveAt: 1 }],
  ]);
  browser.taskPool = new TaskPool();
  browser.settings = { locale: "zh-CN", execMode: "auto", llmMode: "byok", apiKey: "k" };
  browser.approvals = new Map();
  browser.skillsCache = [];
  browser.recording = false;
  browser.paused = false;
  browser.configDir = () => dir;
  browser.getUrl = () => "https://dxm.example/a";
  browser.getTitle = () => "商品A";
  browser.chatSessions = new Map();
  browser.activeTabId = "page";
  browser.beginCloudTaskIfNeeded = async () => undefined;
  browser.pageEnv = () => ({ envId: "", envName: "" });
  browser.envRoster = () => [];
  browser.layout = () => undefined;
  browser.wakeTab = () => undefined;
  browser.freeSoul = { run: async () => ({ ok: false, text: "不该跑到模型" }) };
  browser.taskPool.start({
    id: "job",
    tabId: "page",
    title: "商品A",
    lane: "background",
    clientId: "jia",
    agentName: "Cursor",
  });
  acquireLease({ tabId: "page", taskId: "job", clientId: "jia" });
  return browser;
}

describe("复核修复", () => {
  it("awaitingConfirm 进等待人工，不生成完成卡", async () => {
    const browser = harness();
    browser.mcpTasks = [{
      taskId: "job",
      status: "running",
      rounds: 1,
      lastAssistant: "",
      startedAt: 1,
      text: "编辑商品A",
      clientId: "jia",
    }];
    browser.freeSoul = {
      run: async () => ({ ok: true, text: "请确认发布", awaitingConfirm: true }),
    };
    await browser.runAgentTask(browser.mcpTasks[0], "jia");
    const card = browser.taskPool.tasks.find((item) => item.id === "job");
    expect(card?.state).toBe("waiting_human");
    expect(card?.resultCard).toBeUndefined();
    expect(browser.mcpTasks[0]?.status).toBe("waiting_human");
    expect(browser.mcpTasks[0]?.closeReason).toBeUndefined();
    expect(browser.tabs.get("page")?.agentStatus).not.toBe("done");
    expect(browser.commandOverview().find((item) => item.tabId === "page")?.tone).toBe("yellow");
    expect(browser.getTask("job").status).toBe("waiting_human");
  });

  it("总指挥聊天的停止句会停掉真实任务", async () => {
    const browser = harness();
    let ran = 0;
    browser.freeSoul = { run: async () => { ran += 1; return { ok: true, text: "不该执行" }; } };
    browser.activeTabId = "command-main";
    const result = await browser.handleChat("停止 商品A");
    expect(result.ok).toBe(true);
    expect(browser.taskPool.tasks.find((item) => item.id === "job")?.state).toBe("stopped");
    expect(ran).toBe(0);
    const again = await browser.handleChat("看看 不存在的页");
    expect(again.ok).toBe(false);
    expect(String(again.message)).toContain("没有找到");
  });

  it("确认关闭会先停止再真正关掉页面", () => {
    const browser = harness();
    const result = browser.commandAct({ type: "close", taskId: "job", confirmed: true });
    expect(result.ok).toBe(true);
    expect(result.message).not.toContain("请先停止");
    expect(browser.taskPool.tasks.find((item) => item.id === "job")?.state).toBe("closed");
    expect(browser.tabs.has("page")).toBe(false);
    expect(activeLeaseForTab("page")).toBeUndefined();
  });

  it("子任务都验收关闭后，父级算全部完成", () => {
    expect(summarizeGroup([
      { id: "a", tabId: "page-a", state: "closed" },
      { id: "b", tabId: "page-b", state: "closed" },
    ])).toMatchObject({ allDone: true, headline: "全部完成" });
    const browser = harness();
    browser.taskPool.start({
      id: "job-b",
      tabId: "keep",
      title: "商品B",
      lane: "background",
      clientId: "jia",
      agentName: "Cursor",
    });
    const group = browser.createTaskGroup("两件", ["job", "job-b"]);
    browser.taskPool.finish("job", "done");
    browser.taskPool.close("job");
    browser.taskPool.finish("job-b", "done");
    browser.taskPool.close("job-b");
    const view = browser.taskGroupViews().find((item) => item.groupId === group.groupId);
    expect(view?.allDone).toBe(true);
    expect(view?.headline).toBe("全部完成");
  });

  it("没有核验回执时，说完成也不出结果卡", () => {
    const browser = harness();
    browser.mcpTasks = [{
      taskId: "job",
      status: "running",
      rounds: 1,
      lastAssistant: "已经全部完成，可以验收",
      startedAt: 1,
      text: "编辑商品A",
      clientId: "jia",
    }];
    expect(browser.sealTaskOutcome("job", "done")).toBe("failed");
    browser.taskPool.finish("job", "failed");
    expect(browser.taskPool.tasks.find((item) => item.id === "job")?.resultCard).toBeUndefined();
    expect(browser.commandOverview().find((item) => item.tabId === "page")?.attention).toBeUndefined();
    expect(browser.recordVerification("job", [{ name: "保存", ok: false }]).ok).toBe(false);
    browser.taskPool.tasks.find((item) => item.id === "job")!.state = "running";
    expect(browser.sealTaskOutcome("job", "done")).toBe("failed");
    expect(browser.recordVerification("job", [{ name: "保存", ok: true }]).ok).toBe(true);
    browser.taskPool.tasks.find((item) => item.id === "job")!.state = "running";
    expect(browser.sealTaskOutcome("job", "done")).toBe("done");
    expect(browser.taskPool.tasks.find((item) => item.id === "job")?.resultCard?.summary).toContain("已经全部完成");
  });

  it("等人工时 MCP 写入口进不了 click，读页面可以", async () => {
    const browser = harness();
    browser.markWaitingHuman("job", "请确认发布");
    browser.installWriteGate();
    const writes: string[] = [];
    await expect(async () => {
      const tabId = bindMcpWrite("click", "page");
      writes.push(tabId);
    }).rejects.toThrow(/等你处理/);
    expect(writes).toEqual([]);
    expect(bindMcpWrite("get_url", "page")).toBe("page");
    const clicked = await browser.click({ selector: "#pay" }, "page");
    expect(clicked.ok).toBe(false);
    expect(clicked.message).toContain("等你处理");
    expect(clicked.message).toContain("请确认发布");
  });

  it("侧栏任务恢复时用回原句、原会话和原计划", async () => {
    const browser = harness();
    const full = "把商品标题改成夏季新款，保存后核对标题已经变了";
    const mission = {
      id: "mission-1",
      state: "running",
      goal: { intent: full, kind: "edit", deliverables: [] },
      findings: [],
      brainPlan: { steps: [{ id: "s1", label: "核对保存", status: "pending" }] },
    } as unknown as ActiveMission;
    let seenKey = "";
    browser.waitingMissions = new Map();
    browser.handleChatJob = async () => {
      seenKey = browser.sessionKey();
      return { ok: false, message: "先停一下" };
    };
    await browser.runJob(browser.taskPool.tasks[0], {
      id: "job",
      text: full,
      title: "商品A",
      mission,
    });
    expect(seenKey).toBe(taskSessionKey("page", "job"));
    expect(seenKey).not.toBe("user");
    const card = browser.taskPool.tasks.find((item) => item.id === "job");
    expect(card?.origin?.input).toBe(full);
    expect(card?.state).toBe("failed");
    browser.chatSessions.set(taskSessionKey("page", "job"), [{ role: "assistant", text: "计划：核对保存" }]);
    let seen: { input: string; history: Array<{ text: string }> } | undefined;
    let planLabel = "";
    browser.freeSoul = {
      run: async (input) => {
        seen = { input: input.input, history: input.history || [] };
        planLabel = browser.activeMission?.brainPlan?.steps?.[0]?.label || "";
        return { ok: false, text: "先停" };
      },
    };
    const resumed = browser.resumeTask("job");
    expect(resumed.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(seen?.input).toBe(full);
    expect(seen?.input).not.toBe("商品A");
    expect(seen?.history.map((turn) => turn.text).join("\n")).toContain("计划：核对保存");
    expect(planLabel).toBe("核对保存");
  });

  it("指挥室说同时改两页时，会建出父组并且子任务落在原页", async () => {
    const browser = harness();
    browser.tabs.set("page-b", {
      id: "page-b",
      kind: "web",
      title: "商品B",
      url: "https://dxm.example/b",
      view: null,
      lastActiveAt: 1,
    });
    browser.tabs.get("page")!.title = "商品A";
    browser.taskPool.tasks.splice(0, browser.taskPool.tasks.length);
    resetPageLeases();
    browser.activeTabId = "command-main";
    browser.freeSoul = { run: () => new Promise(() => undefined) };
    browser.createAgentTab = () => {
      throw new Error("已有匹配空闲页不该再开");
    };
    const result = await browser.handleChat("同时改商品A和商品B");
    expect(result.ok).toBe(true);
    const views = browser.taskGroupViews();
    expect(views).toHaveLength(1);
    const group = views[0];
    expect(group?.childTaskIds).toHaveLength(2);
    const children = group?.childTaskIds.map((id) => browser.taskPool.tasks.find((task) => task.id === id));
    expect(children?.map((task) => task?.tabId).sort()).toEqual(["page", "page-b"]);
    expect(children?.every((task) => task?.groupId === group?.groupId)).toBe(true);
    expect(browser.tabs.has(group?.groupId || "")).toBe(false);
    expect(activeLeaseForTab("page")?.taskId).toBe(children?.find((task) => task?.tabId === "page")?.id);
    expect(activeLeaseForTab("page-b")?.taskId).toBe(children?.find((task) => task?.tabId === "page-b")?.id);

    const busy = harness();
    busy.tabs.set("page-b", {
      id: "page-b",
      kind: "web",
      title: "商品B",
      url: "https://dxm.example/b",
      view: null,
      lastActiveAt: 1,
    });
    busy.tabs.get("page")!.title = "商品A";
    busy.activeTabId = "command-main";
    busy.freeSoul = { run: () => new Promise(() => undefined) };
    const denied = await busy.handleChat("同时改商品A和商品B");
    expect(denied.ok).toBe(false);
    expect(denied.message).toContain("正忙");
    expect(busy.taskGroupViews()).toEqual([]);
    expect(busy.taskPool.tasks.filter((task) => task.tabId === "page-b")).toEqual([]);
  });

  it("目标页不存在时批量句开新页，原句不交给单轮闲聊", async () => {
    const browser = harness();
    browser.taskPool.tasks.splice(0, browser.taskPool.tasks.length);
    resetPageLeases();
    browser.activeTabId = "command-main";
    const opened: string[] = [];
    browser.createAgentTab = () => {
      const id = "opened-" + opened.length;
      opened.push(id);
      browser.tabs.set(id, { id, kind: "web", title: "", url: "", view: null, lastActiveAt: 1 });
      return id;
    };
    browser.freeSoul = { run: () => new Promise(() => undefined) };
    const result = await browser.handleChat("多平台比价 iPhone 17");
    expect(result.ok).toBe(true);
    expect(String(result.message)).toContain("已拆成 2");
    expect(opened).toHaveLength(2);
    const urls = [...browser.tabs.values()].map((tab) => tab.url);
    expect(urls.some((url) => url.includes("search.jd.com/Search?keyword=iPhone%2017"))).toBe(true);
    expect(urls.some((url) => url.includes("s.taobao.com/search?q=iPhone%2017"))).toBe(true);
    expect([...browser.tabs.values()].map((tab) => tab.title).sort()).toEqual(["京东", "淘宝", "商品A", "留着", "指挥室"].sort());
    expect(browser.taskGroupViews()).toHaveLength(1);

    const fresh = harness();
    fresh.taskPool.tasks.splice(0, fresh.taskPool.tasks.length);
    resetPageLeases();
    fresh.activeTabId = "command-main";
    const openedThree: string[] = [];
    fresh.createAgentTab = () => {
      const id = "site-" + openedThree.length;
      openedThree.push(id);
      fresh.tabs.set(id, { id, kind: "web", title: "", url: "", view: null, lastActiveAt: 1 });
      return id;
    };
    fresh.freeSoul = { run: () => new Promise(() => undefined) };
    const three = await fresh.handleChat("京东淘宝 1688 都查一下 iPhone 17 价格");
    expect(three.ok).toBe(true);
    expect(String(three.message)).toContain("已拆成 3");
    expect(openedThree).toHaveLength(3);
    expect([...fresh.tabs.values()].map((tab) => tab.title).filter((title) => ["京东", "淘宝", "1688"].includes(title)).sort()).toEqual(["1688", "京东", "淘宝"]);
  });

  it("派发中途失败会停掉已派出的，不建半残组", async () => {
    const browser = harness();
    browser.taskPool.tasks.splice(0, browser.taskPool.tasks.length);
    resetPageLeases();
    browser.activeTabId = "command-main";
    browser.freeSoul = { run: () => new Promise(() => undefined) };
    browser.createAgentTab = () => {
      const id = "p" + browser.tabs.size;
      browser.tabs.set(id, { id, kind: "web", title: "", url: "", view: null, lastActiveAt: 1 });
      return id;
    };
    const real = browser.submitTask.bind(browser);
    let calls = 0;
    browser.submitTask = ((text: string, opts?: { tabId?: string; clientId?: string }) => {
      calls += 1;
      if (calls >= 2) return { taskId: "", status: "failed" as const, message: "第二页失败" };
      return real(text, opts);
    }) as typeof browser.submitTask;
    const result = await browser.handleChat("京东淘宝 1688 都查一下 iPhone 17 价格");
    expect(result.ok).toBe(false);
    expect(String(result.message)).toContain("没派上");
    expect(String(result.message)).toContain("已停止");
    expect(browser.taskGroupViews()).toEqual([]);
    expect(browser.taskPool.tasks.filter((task) => task.state === "running" || task.state === "queued")).toEqual([]);
  });

  it("部分失败时总指挥写未完成，不说全部完成", () => {
    const browser = harness();
    browser.taskPool.start({
      id: "job-b",
      tabId: "keep",
      title: "留着",
      lane: "background",
      clientId: "yi",
      agentName: "乙",
    });
    browser.createTaskGroup("比价", ["job", "job-b"]);
    browser.finishPooledTask("job", "failed");
    browser.finishPooledTask("job-b", "done");
    const text = browser.turnsFor("command").map((turn: { text: string }) => turn.text).join("\n");
    expect(text).toContain("有页面异常或未完成");
    expect(text).not.toContain("全部完成");
    expect(text.split("有页面异常或未完成").length - 1).toBe(1);
  });

  it("两个子任务先后失败，组汇总只写一条", () => {
    const browser = harness();
    browser.taskPool.start({
      id: "job-b",
      tabId: "keep",
      title: "留着",
      lane: "background",
      clientId: "yi",
      agentName: "乙",
    });
    browser.createTaskGroup("比价", ["job", "job-b"]);
    browser.finishPooledTask("job", "failed");
    expect(browser.turnsFor("command")).toEqual([]);
    browser.finishPooledTask("job-b", "failed");
    const lines = browser.turnsFor("command").map((turn: { text: string }) => turn.text);
    expect(lines.filter((line) => line.includes("有页面异常或未完成"))).toHaveLength(1);
    expect(lines[0]).toContain("有页面异常或未完成");
    expect(lines[0]).toContain("看结果：");
  });

  it("终态步骤写成已完成、已失败、已停止，不再留进行中", () => {
    const browser = harness();
    browser.tabs.set("done-page", { id: "done-page", kind: "web", title: "完成页", url: "https://example.com/done", view: null, lastActiveAt: 1 });
    browser.tabs.set("stop-page", { id: "stop-page", kind: "web", title: "停止页", url: "https://example.com/stop", view: null, lastActiveAt: 1 });
    browser.taskPool.start({ id: "done-job", tabId: "done-page", title: "做完", lane: "background", clientId: "jia", agentName: "甲" });
    browser.taskPool.start({ id: "stop-job", tabId: "stop-page", title: "停下", lane: "background", clientId: "jia", agentName: "甲" });
    browser.finishPooledTask("job", "failed");
    browser.finishPooledTask("done-job", "done");
    browser.finishPooledTask("stop-job", "stopped");
    expect(browser.taskPool.tasks.find((task) => task.id === "job")?.step).toBe("已失败");
    expect(browser.taskPool.tasks.find((task) => task.id === "done-job")?.step).toBe("已完成");
    expect(browser.taskPool.tasks.find((task) => task.id === "stop-job")?.step).toBe("已停止");
    expect(browser.pageStatusFor("page").step).toBe("已失败");
    expect(browser.pageStatusFor("done-page").step).toBe("已完成");
    expect(browser.pageStatusFor("stop-page").step).toBe("已停止");
    const listed = browser.listTabs().tabs.map((tab) => tab.pageStatus?.step || "");
    expect(listed.some((step) => step.includes("进行中"))).toBe(false);
  });

  it("没配模型时批量句带上模型 Key 的原因", async () => {
    const browser = harness();
    browser.taskPool.tasks.splice(0, browser.taskPool.tasks.length);
    resetPageLeases();
    browser.settings = { locale: "zh-CN", execMode: "auto", apiKey: "", llmMode: "byok" };
    browser.activeTabId = "command-main";
    browser.freeSoul = { run: () => new Promise(() => undefined) };
    browser.createAgentTab = () => {
      const id = "p" + browser.tabs.size;
      browser.tabs.set(id, { id, kind: "web", title: "", url: "", view: null, lastActiveAt: 1 });
      return id;
    };
    const result = await browser.handleChat("多平台比价 iPhone 17");
    expect(result.ok).toBe(false);
    expect(String(result.message)).toContain("模型 Key");
    expect(browser.taskGroupViews()).toEqual([]);
  });

  it("已有同名空闲页时批量分派不改它的地址", async () => {
    const browser = harness();
    browser.taskPool.tasks.splice(0, browser.taskPool.tasks.length);
    resetPageLeases();
    browser.tabs.get("page")!.title = "京东";
    browser.tabs.get("page")!.url = "https://www.jd.com/kept";
    browser.tabs.set("tb", { id: "tb", kind: "web", title: "淘宝", url: "https://www.taobao.com/kept", view: null, lastActiveAt: 1 });
    browser.activeTabId = "command-main";
    browser.freeSoul = { run: () => new Promise(() => undefined) };
    browser.createAgentTab = () => {
      throw new Error("已有空闲页不该导航");
    };
    const result = await browser.handleChat("多平台比价 iPhone 17");
    expect(result.ok).toBe(true);
    expect(browser.tabs.get("page")?.url).toBe("https://www.jd.com/kept");
    expect(browser.tabs.get("tb")?.url).toBe("https://www.taobao.com/kept");
  });

  it("停止进行中的后台任务后 getTask 是 stopped，四色仍是灰", async () => {
    const browser = harness();
    browser.mcpTasks = [{
      taskId: "job",
      status: "running",
      rounds: 1,
      lastAssistant: "",
      startedAt: 1,
      text: "编辑商品A",
      clientId: "jia",
    }];
    browser.freeSoul = {
      run: async () => {
        browser.stopAgentTask("job");
        return { ok: false, text: "被打断", interrupted: true };
      },
    };
    await browser.runAgentTask(browser.mcpTasks[0], "jia");
    expect(browser.mcpTasks[0]?.status).toBe("stopped");
    expect(browser.getTask("job").status).toBe("stopped");
    expect(browser.taskPool.tasks.find((task) => task.id === "job")?.state).toBe("stopped");
    expect(browser.commandOverview().find((item) => item.tabId === "page")?.tone).toBe("gray");
  });
});
