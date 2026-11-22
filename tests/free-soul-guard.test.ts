import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

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
import { FreeSoul } from "../src/main/agent/free-soul.js";
import { TaskPool } from "../src/main/agent/task-pool.js";
import { appendMissionEvent, recoveryLine, replayMissions, sidebarOffersRecovery } from "../src/main/agent/mission-journal.js";
import type { ActiveMission } from "../src/main/agent/runtime.js";
import { questionFor } from "../src/main/learning/help.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "sparo-core-"));
  dirs.push(dir);
  return dir;
}

type Harness = SparkBrowser & {
  freeSoulRunning: boolean;
  chatLog: Array<{ role: string; text: string }>;
  fallbackHelpAsk: ReturnType<typeof questionFor> | null;
  recentLearned: unknown[];
  paused: boolean;
  settings: { locale: string };
  tabs: Map<string, unknown>;
  activeTabId: string;
  pendingRecovery: unknown;
  taskPool: TaskPool;
  configDir: () => string;
  pushSidebarState: () => void;
  pushChromeState: () => void;
  setPaused: (paused: boolean) => void;
};

function harness(): Harness {
  const browser = Object.create(SparkBrowser.prototype) as Harness;
  const page = {
    isDestroyed: () => false,
    getURL: () => "https://weibo.com/u/1",
    getTitle: () => "汪海林",
  };
  browser.tabs = new Map([
    ["t", { id: "t", url: page.getURL(), title: page.getTitle(), view: { webContents: page } }],
  ]);
  browser.activeTabId = "t";
  browser.chatLog = [];
  browser.fallbackHelpAsk = null;
  browser.recentLearned = [];
  browser.paused = false;
  browser.freeSoulRunning = false;
  browser.pendingRecovery = null;
  browser.settings = { locale: "zh-CN" };
  browser.pushSidebarState = () => undefined;
  browser.pushChromeState = () => undefined;
  browser.configDir = () => tmp();
  return browser;
}

function click(browser: Harness) {
  return browser.watchPageTool("click", { ref: "send" }, async () => ({ ok: true, message: "点了但页面没变" }), "t");
}

describe("新核心运行时旧学习系统不插话", () => {
  it("连续 3 次同指纹点击且页面不变时，不写 chatLog、不产生 helpAsk", async () => {
    const browser = harness();
    browser.freeSoulRunning = true;
    const before = browser.chatLog.length;
    await click(browser);
    await click(browser);
    await click(browser);
    expect(browser.chatLog).toHaveLength(before);
    expect(browser.fallbackHelpAsk).toBeNull();
  });

  it("helpAsk 已经开着时，第一次点击不说「好，先继续」，也不暂停", async () => {
    const browser = harness();
    browser.freeSoulRunning = true;
    browser.paused = true;
    browser.fallbackHelpAsk = questionFor(
      { kind: "dead_click", host: "weibo.com", target: "send", count: 2 },
      true,
    );
    let pauses = 0;
    browser.setPaused = () => {
      pauses += 1;
    };
    await click(browser);
    expect(browser.chatLog.map((turn) => turn.text).join("")).not.toContain("好，先继续");
    expect(pauses).toBe(0);
    expect(browser.paused).toBe(true);
    expect(browser.fallbackHelpAsk).not.toBeNull();
  });

  it("新核心没在跑时，连点无变化仍会开口", async () => {
    const browser = harness();
    browser.freeSoulRunning = false;
    await click(browser);
    await click(browser);
    expect(browser.chatLog.some((turn) => turn.text.includes("点了没反应"))).toBe(true);
    expect(browser.fallbackHelpAsk).not.toBeNull();
  });
});

describe("运行中的新一句不叠到忙页", () => {
  it("运行中第二条消息不打断，也不续跑", async () => {
    let calls = 0;
    let releaseFirst: (value: Response) => void = () => undefined;
    const fetchImpl: typeof fetch = () =>
      new Promise((resolve) => {
        calls += 1;
        if (calls === 1) {
          releaseFirst = resolve;
          return;
        }
        resolve(new Response(JSON.stringify({ choices: [{ message: { content: "不该跑第二条" } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      });
    const browser = harness();
    (browser as unknown as { freeSoul: FreeSoul }).freeSoul = new FreeSoul(
      {
        apiKey: "test",
        baseUrl: "https://example.test/v1",
        model: "test-model",
        fetchImpl,
      },
      async () => ({ ok: true, message: "不会执行" }),
    );
    const first = browser.handleChat("先打开微博");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await browser.handleChat("改去看标题");
    expect(second.ok).toBe(false);
    expect(second.message).toContain("还有任务在进行");
    expect(calls).toBe(1);
    releaseFirst(new Response(JSON.stringify({ choices: [{ message: { content: "第一句还在做。" } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    const finished = await first;
    expect(finished.ok).toBe(true);
    expect(finished.message).toContain("第一句还在做");
    expect(finished.message).not.toContain("任务被用户打断");
    const texts = browser.chatLog.map((turn) => turn.text);
    expect(texts.some((text) => text.includes("改去看标题"))).toBe(true);
    expect(texts.some((text) => text.includes("还有任务在进行"))).toBe(true);
    expect(texts.join("\n")).not.toContain("不该跑第二条");
  });

  it("眼前这一页已有进行中的任务时，新的一句不另开", async () => {
    const browser = harness();
    browser.taskPool = new TaskPool();
    browser.taskPool.start({ id: "job", tabId: "t", title: "天气", lane: "background" });
    let runs = 0;
    (browser as unknown as { freeSoul: { run: () => Promise<{ ok: boolean; text: string }> } }).freeSoul = {
      run: async () => {
        runs += 1;
        return { ok: true, text: "不该跑" };
      },
    };
    const second = await browser.handleChat("另外再把标题写一行");
    expect(second.ok).toBe(false);
    expect(second.message).toContain("还有任务在进行");
    expect(runs).toBe(0);
    expect(browser.taskPool.tasks.find((task) => task.id === "job")?.state).toBe("running");
  });
});

describe("未关任务的只读恢复预览", () => {
  it("重启回放时展示目标、步骤和页面，不改日志文件", () => {
    const root = tmp();
    const mission: ActiveMission = {
      id: "old-1",
      raw: "搜明天临汾到北京的火车",
      goal: {
        raw: "搜明天临汾到北京的火车",
        intent: "临汾到北京火车",
        kind: "trip",
        deliverables: [],
        known: { origin: "临汾" },
        unknown: [],
        decision: "act",
        approach: "",
      },
      plan: [],
      findings: [],
      state: "running",
      brainPlan: {
        createdAt: 1,
        steps: [
          { id: "a", label: "查车票", cap: "train_search", covers: ["trains"], status: "running" },
        ],
      },
    };
    appendMissionEvent({ t: 1, op: "open", mission }, root);
    appendMissionEvent({
      t: 2,
      op: "turn",
      id: "old-1",
      state: "running",
      plan: mission.brainPlan,
      findings: [{ step: mission.brainPlan!.steps[0], text: "还没查到", url: "https://kyfw.12306.cn", ok: false }],
    }, root);
    const restored = replayMissions(root);
    expect(restored).toHaveLength(1);
    const oldLine = recoveryLine(restored[0]);
    expect(oldLine).toContain("继续？");
    expect(oldLine).toContain("未关任务");
    expect(oldLine).toContain("临汾到北京");
    expect(oldLine).toContain("查车票");
    expect(oldLine).toContain("https://kyfw.12306.cn");
    expect(sidebarOffersRecovery()).toBe(true);

    const browser = harness();
    browser.configDir = () => root;
    browser.chatLog = [];
    const beforeFile = readFileSync(join(root, "missions.jsonl"), "utf8");
    (browser as unknown as { offerMissionRecovery(): void }).offerMissionRecovery();
    expect(browser.chatLog.length).toBe(1);
    expect(String(browser.chatLog[0]?.text || "")).toContain("未关任务");
    expect(browser.pendingRecovery).toBeTruthy();
    expect(readFileSync(join(root, "missions.jsonl"), "utf8")).toBe(beforeFile);
  });
});

describe("执行中的新消息不排队", () => {
  it("运行中的后两句被拒绝，结束后不自动接着跑", async () => {
    const browser = harness();
    const ran: string[] = [];
    let releaseFirst: (value: { ok: boolean; text: string }) => void = () => undefined;
    const firstGate = new Promise<{ ok: boolean; text: string }>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    (browser as unknown as { freeSoul: { run: (input: { input: string }) => Promise<{ ok: boolean; text: string }> } }).freeSoul = {
      run: async (input) => {
        calls += 1;
        ran.push(input.input);
        if (calls === 1) return firstGate;
        return { ok: true, text: "第二轮完" };
      },
    };
    (browser as unknown as { beginCloudTaskIfNeeded: () => Promise<undefined> }).beginCloudTaskIfNeeded = async () => undefined;
    (browser as unknown as { getUrl: () => string }).getUrl = () => "https://www.zhihu.com";
    (browser as unknown as { getTitle: () => string }).getTitle = () => "知乎";

    const first = browser.handleChat("写回答");
    await vi.waitFor(() => expect(ran).toEqual(["写回答"]));
    const second = await browser.handleChat("继续");
    const third = await browser.handleChat("改去微博");
    expect(second.ok).toBe(false);
    expect(third.ok).toBe(false);
    expect(second.message).toContain("还有任务在进行");
    releaseFirst({ ok: true, text: "第一轮完" });
    await first;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(ran).toEqual(["写回答"]);
    const texts = browser.chatLog.map((turn) => turn.text);
    expect(texts).toContain("写回答");
    expect(texts).toContain("继续");
    expect(texts).toContain("改去微博");
    expect(texts.filter((text) => text.includes("还有任务在进行"))).toHaveLength(2);
    expect(texts.join("")).not.toContain("第二轮完");
  });
});
