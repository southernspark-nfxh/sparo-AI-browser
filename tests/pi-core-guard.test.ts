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
import { PiAgentCore } from "../src/main/agent/pi-core.js";
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
  piCoreRunning: boolean;
  chatLog: Array<{ role: string; text: string }>;
  fallbackHelpAsk: ReturnType<typeof questionFor> | null;
  recentLearned: unknown[];
  paused: boolean;
  settings: { locale: string };
  tabs: Map<string, unknown>;
  activeTabId: string;
  pendingRecovery: unknown;
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
  browser.piCoreRunning = false;
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
    browser.piCoreRunning = true;
    const before = browser.chatLog.length;
    await click(browser);
    await click(browser);
    await click(browser);
    expect(browser.chatLog).toHaveLength(before);
    expect(browser.fallbackHelpAsk).toBeNull();
  });

  it("helpAsk 已经开着时，第一次点击不说「好，先继续」，也不暂停", async () => {
    const browser = harness();
    browser.piCoreRunning = true;
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
    browser.piCoreRunning = false;
    await click(browser);
    await click(browser);
    expect(browser.chatLog.some((turn) => turn.text.includes("点了没反应"))).toBe(true);
    expect(browser.fallbackHelpAsk).not.toBeNull();
  });
});

describe("运行中的新消息打断当前执行", () => {
  it("运行中第二条消息触发 abort 且 pendingChat 续跑", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = (_url, init) =>
      new Promise((resolve, reject) => {
        calls += 1;
        if (calls === 1) {
          const fail = () => {
            const error = new Error("The operation was aborted");
            error.name = "AbortError";
            reject(error);
          };
          if (init?.signal?.aborted) fail();
          else init?.signal?.addEventListener("abort", fail, { once: true });
          return;
        }
        resolve(new Response(JSON.stringify({ choices: [{ message: { content: "改去看标题。" } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      });
    const browser = harness();
    (browser as unknown as { piCore: PiAgentCore }).piCore = new PiAgentCore(
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
    expect(second.ok).toBe(true);
    expect(second.message).toContain("已记下");
    const interrupted = await first;
    expect(interrupted.ok).toBe(true);
    expect(interrupted.message).toContain("任务被用户打断");
    expect(interrupted.message).not.toContain("执行失败");
    await new Promise((resolve) => setTimeout(resolve, 30));
    const texts = browser.chatLog.map((turn) => turn.text);
    expect(texts.some((text) => text.includes("改去看标题"))).toBe(true);
    expect(texts.some((text) => text.includes("任务被用户打断"))).toBe(true);
    expect((browser as unknown as { pendingChat: unknown }).pendingChat).toBeNull();
  });
});

describe("旧工作单不再向侧栏开口", () => {
  it("重启回放时不追加继续问句，已有问句和日志原样留着", () => {
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
    expect(sidebarOffersRecovery()).toBe(false);

    const browser = harness();
    browser.configDir = () => root;
    browser.chatLog = [{ role: "assistant", text: oldLine }];
    const beforeFile = readFileSync(join(root, "missions.jsonl"), "utf8");
    (browser as unknown as { offerMissionRecovery(): void }).offerMissionRecovery();
    expect(browser.chatLog).toEqual([{ role: "assistant", text: oldLine }]);
    expect(browser.pendingRecovery).toBeNull();
    expect(readFileSync(join(root, "missions.jsonl"), "utf8")).toBe(beforeFile);
  });
});

describe("执行中的新消息排队", () => {
  it("两条都留在聊天里，结束后只自动跑最新一条", async () => {
    const browser = harness();
    const ran: string[] = [];
    let releaseFirst: (value: { ok: boolean; text: string }) => void = () => undefined;
    const firstGate = new Promise<{ ok: boolean; text: string }>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    (browser as unknown as { piCore: { run: (input: { input: string }) => Promise<{ ok: boolean; text: string }> } }).piCore = {
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
    await browser.handleChat("继续");
    await browser.handleChat("改去微博");
    expect(browser.chatLog.map((turn) => turn.text)).toEqual(["写回答", "继续", "改去微博"]);
    releaseFirst({ ok: true, text: "第一轮完" });
    await first;
    await vi.waitFor(() => expect(ran).toEqual(["写回答", "改去微博"]));
    expect(browser.chatLog.filter((turn) => turn.text === "继续")).toHaveLength(1);
    expect(browser.chatLog.filter((turn) => turn.text === "改去微博")).toHaveLength(1);
    expect(browser.chatLog.map((turn) => turn.text).join("")).not.toContain("上一个任务还在执行");
  });
});
