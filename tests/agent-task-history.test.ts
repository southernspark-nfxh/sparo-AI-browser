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
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1280, height: 800 } }),
    getAllDisplays: () => [],
    on: () => undefined,
    removeListener: () => undefined,
  },
  powerMonitor: { on: () => undefined, removeListener: () => undefined },
}));

import { SparkBrowser } from "../src/main/browser.js";
import { TaskPool } from "../src/main/agent/task-pool.js";
import { agentClientFromScope, resetMcpSessions } from "../src/main/agent/mcp-sessions.js";
import type { ChatTurn } from "../src/main/profile/chat-memory.js";

const dirs: string[] = [];
afterEach(() => {
  resetMcpSessions();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Hist = { role: string; text: string };

function harness() {
  const dir = mkdtempSync(join(tmpdir(), "sparo-t82-"));
  dirs.push(dir);
  const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & {
    settings: { locale: string; execMode: "auto"; llmMode: string; apiKey: string };
    activeTabId: string;
    taskPool: TaskPool;
    approvals: Map<string, never>;
    skillsCache: unknown[];
    recording: boolean;
    paused: boolean;
    tabs: Map<string, { id: string }>;
    pushSidebarState: () => void;
    getUrl: () => string;
    getTitle: () => string;
    createAgentTab: () => string;
    listTabs: () => { tabs: Array<{ id: string }> };
    switchTab: (id: string) => void;
    configDir: () => string;
    freeSoul: {
      run: (input: { input: string; history: Hist[]; onSidebar?: (text: string) => void }) => Promise<{ ok: boolean; text: string }>;
    };
    chatBook: () => Map<string, ChatTurn[]>;
    pruneDeadAgentChats: () => void;
    selectedSession: string;
  };
  browser.settings = { locale: "zh-CN", execMode: "auto", llmMode: "byok", apiKey: "test-key" };
  browser.approvals = new Map();
  browser.skillsCache = [];
  browser.recording = false;
  browser.paused = false;
  browser.activeTabId = "user-tab";
  browser.taskPool = new TaskPool();
  browser.tabs = new Map([["user-tab", { id: "user-tab" }]]);
  browser.pushSidebarState = () => undefined;
  browser.getUrl = () => "https://example.com";
  browser.getTitle = () => "页";
  browser.configDir = () => dir;
  browser.listTabs = () => ({ tabs: [...browser.tabs.values()] });
  browser.switchTab = (id: string) => {
    browser.activeTabId = id;
  };
  let n = 0;
  browser.createAgentTab = () => {
    n += 1;
    const id = `agent-tab-${n}`;
    browser.tabs.set(id, { id });
    browser.activeTabId = id;
    return id;
  };
  return browser;
}

function book(browser: ReturnType<typeof harness>): Map<string, ChatTurn[]> {
  return browser.chatBook();
}

async function waitIdle(browser: ReturnType<typeof harness>): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (!browser.taskPool.tasks.some((task) => task.state === "running" || task.state === "queued")) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("任务没有结束");
}

describe("T82 同 client 并行任务不共享进行中的对话", () => {
  it("隋朝和清朝同时跑时，history 互不包含对方指令", async () => {
    const browser = harness();
    const seen: Array<{ text: string; history: Hist[] }> = [];
    let releaseSui: () => void = () => undefined;
    let releaseQing: () => void = () => undefined;
    const suiHold = new Promise<void>((resolve) => {
      releaseSui = resolve;
    });
    const qingHold = new Promise<void>((resolve) => {
      releaseQing = resolve;
    });
    let suiEntered: () => void = () => undefined;
    let qingEntered: () => void = () => undefined;
    const suiIn = new Promise<void>((resolve) => {
      suiEntered = resolve;
    });
    const qingIn = new Promise<void>((resolve) => {
      qingEntered = resolve;
    });
    browser.freeSoul = {
      run: async (input) => {
        seen.push({
          text: input.input,
          history: input.history.map((turn) => ({ role: turn.role, text: turn.text })),
        });
        if (input.input.includes("隋朝")) {
          suiEntered();
          await suiHold;
          return { ok: true, text: "隋朝导言写好了" };
        }
        qingEntered();
        await qingHold;
        return { ok: true, text: "清朝导言写好了" };
      },
    };

    const sui = browser.submitTask("写一段隋朝导言", { clientId: "ding" });
    await suiIn;
    const qing = browser.submitTask("写一段清朝导言", { clientId: "ding" });
    await qingIn;

    const suiHist = seen.find((item) => item.text.includes("隋朝"))!.history.map((turn) => turn.text).join("\n");
    const qingHist = seen.find((item) => item.text.includes("清朝"))!.history.map((turn) => turn.text).join("\n");
    expect(suiHist).not.toContain("清朝");
    expect(qingHist).not.toContain("隋朝");

    browser.selectSession("agent:ding");
    const side = browser.getSidebarPayload() as { chat: Array<{ text: string }> };
    const shown = side.chat.map((turn) => turn.text).join("\n");
    expect(shown).toContain("写一段隋朝导言");
    expect(shown).toContain("写一段清朝导言");
    expect(book(browser).has(`agent:ding/${sui.taskId}`)).toBe(true);
    expect(book(browser).has(`agent:ding/${qing.taskId}`)).toBe(true);

    releaseSui();
    releaseQing();
    await waitIdle(browser);
    expect(book(browser).has(`agent:ding/${sui.taskId}`)).toBe(false);
    expect(book(browser).has(`agent:ding/${qing.taskId}`)).toBe(false);
  });

  it("串行的下一句带上前一句的问答", async () => {
    const browser = harness();
    const histories: Hist[][] = [];
    browser.freeSoul = {
      run: async (input) => {
        histories.push(input.history.map((turn) => ({ role: turn.role, text: turn.text })));
        return { ok: true, text: input.input.includes("隋朝") ? "隋朝导言写好了" : "清朝导言写好了" };
      },
    };
    browser.submitTask("写一段隋朝导言", { clientId: "ding" });
    await waitIdle(browser);
    browser.submitTask("写一段清朝导言", { clientId: "ding" });
    await waitIdle(browser);
    const second = histories[1].map((turn) => turn.text).join("\n");
    expect(second).toContain("写一段隋朝导言");
    expect(second).toContain("隋朝导言写好了");
    expect(histories[0].map((turn) => turn.text).join("\n")).not.toContain("清朝");
  });

  it("两边都结束后，第三句看得到两份问答，跑的时候没有互吸", async () => {
    const browser = harness();
    const during: string[] = [];
    let releaseSui: () => void = () => undefined;
    let releaseQing: () => void = () => undefined;
    const suiHold = new Promise<void>((resolve) => {
      releaseSui = resolve;
    });
    const qingHold = new Promise<void>((resolve) => {
      releaseQing = resolve;
    });
    let suiEntered: () => void = () => undefined;
    let qingEntered: () => void = () => undefined;
    const suiIn = new Promise<void>((resolve) => {
      suiEntered = resolve;
    });
    const qingIn = new Promise<void>((resolve) => {
      qingEntered = resolve;
    });
    browser.freeSoul = {
      run: async (input) => {
        during.push(input.history.map((turn) => turn.text).join("\n"));
        if (input.input.includes("隋朝")) {
          suiEntered();
          await suiHold;
          return { ok: true, text: "隋朝导言写好了" };
        }
        qingEntered();
        await qingHold;
        return { ok: true, text: "清朝导言写好了" };
      },
    };
    browser.submitTask("写一段隋朝导言", { clientId: "ding" });
    await suiIn;
    browser.submitTask("写一段清朝导言", { clientId: "ding" });
    await qingIn;
    expect(during[0]).not.toContain("清朝");
    expect(during[1]).not.toContain("隋朝");
    releaseSui();
    releaseQing();
    await waitIdle(browser);

    let third: Hist[] = [];
    browser.freeSoul = {
      run: async (input) => {
        third = input.history.map((turn) => ({ role: turn.role, text: turn.text }));
        return { ok: true, text: "明朝也写了" };
      },
    };
    browser.submitTask("接着写明朝", { clientId: "ding" });
    await waitIdle(browser);
    const text = third.map((turn) => turn.text).join("\n");
    expect(text).toContain("写一段隋朝导言");
    expect(text).toContain("隋朝导言写好了");
    expect(text).toContain("写一段清朝导言");
    expect(text).toContain("清朝导言写好了");
  });

  it("client 卷里活任务标过的轮不进新任务的种子，拷贝不共享引用", async () => {
    const browser = harness();
    book(browser).set("agent:ding", [{ role: "user", text: "前朝问答" }]);
    let releaseSui: () => void = () => undefined;
    const suiHold = new Promise<void>((resolve) => {
      releaseSui = resolve;
    });
    let suiEntered: () => void = () => undefined;
    const suiIn = new Promise<void>((resolve) => {
      suiEntered = resolve;
    });
    let qingHistory: Hist[] = [];
    let qingEntered: () => void = () => undefined;
    const qingIn = new Promise<void>((resolve) => {
      qingEntered = resolve;
    });
    browser.freeSoul = {
      run: async (input) => {
        if (input.input.includes("隋朝")) {
          suiEntered();
          await suiHold;
          return { ok: true, text: "隋朝导言写好了" };
        }
        qingHistory = input.history.map((turn) => ({ role: turn.role, text: turn.text }));
        qingEntered();
        return { ok: true, text: "清朝导言写好了" };
      },
    };
    const sui = browser.submitTask("写一段隋朝导言", { clientId: "ding" });
    await suiIn;
    const clientTurns = book(browser).get("agent:ding") || [];
    const seeded = book(browser).get(`agent:ding/${sui.taskId}`) || [];
    expect(seeded[0]).not.toBe(clientTurns[0]);
    expect(seeded[0]?.task).toBeUndefined();
    clientTurns.push({ role: "assistant", text: "隋朝中间轮", task: sui.taskId });
    browser.submitTask("写一段清朝导言", { clientId: "ding" });
    await qingIn;
    releaseSui();
    await waitIdle(browser);
    const text = qingHistory.map((turn) => turn.text).join("\n");
    expect(text).toContain("前朝问答");
    expect(text).not.toContain("隋朝");
    expect(text).not.toContain("隋朝中间轮");
  });

  it("任务卷结束后清掉；client 卷在没有活任务也没有标签时清掉，并复位选中会话", async () => {
    const browser = harness();
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => undefined;
    const inside = new Promise<void>((resolve) => {
      entered = resolve;
    });
    browser.freeSoul = {
      run: async () => {
        entered();
        await hold;
        return { ok: true, text: "隋朝导言写好了" };
      },
    };
    const sui = browser.submitTask("写一段隋朝导言", { clientId: "ding" });
    await inside;
    const taskKey = `agent:ding/${sui.taskId}`;
    browser.selectedSession = taskKey;
    browser.pruneDeadAgentChats();
    expect(book(browser).has(taskKey)).toBe(true);
    expect(browser.selectedSession).toBe(taskKey);
    release();
    await waitIdle(browser);
    expect(book(browser).has(taskKey)).toBe(false);

    browser.selectedSession = "agent:ding";
    browser.pruneDeadAgentChats();
    expect(book(browser).has("agent:ding")).toBe(true);
    expect(browser.selectedSession).toBe("agent:ding");

    browser.tabs = new Map();
    browser.pruneDeadAgentChats();
    expect(book(browser).has("agent:ding")).toBe(false);
    expect(browser.selectedSession).toBe("user");
  });

  it("client 卷最多留 60 轮", async () => {
    const browser = harness();
    browser.freeSoul = {
      run: async (input) => {
        for (let i = 0; i < 70; i += 1) input.onSidebar?.(`第${i}轮`);
        return { ok: true, text: "收尾" };
      },
    };
    browser.submitTask("写一段隋朝导言", { clientId: "ding" });
    await waitIdle(browser);
    const turns = book(browser).get("agent:ding") || [];
    expect(turns.length).toBe(60);
    expect(turns[turns.length - 1]?.text).toBe("收尾");
    expect(turns.every((turn) => turn.task)).toBe(true);
  });
});

describe("agentClientFromScope", () => {
  it("任务卷 key 只返回 clientId", () => {
    expect(agentClientFromScope("agent:ab12cd/ef3456")).toBe("ab12cd");
    expect(agentClientFromScope(undefined, "agent:ab12cd/ef3456")).toBe("ab12cd");
    expect(agentClientFromScope("agent:jia")).toBe("jia");
    expect(agentClientFromScope("user")).toBe("");
  });
});
