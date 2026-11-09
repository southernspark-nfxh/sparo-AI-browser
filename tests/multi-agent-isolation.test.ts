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
import { loadChatMemory } from "../src/main/profile/chat-memory.js";

const dirs: string[] = [];
afterEach(() => {
  resetMcpSessions();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function harness(existingDir?: string) {
  const dir = existingDir || mkdtempSync(join(tmpdir(), "sparo-iso-"));
  if (!existingDir) dirs.push(dir);
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
    getUrl: (tabId?: string) => string;
    getTitle: () => string;
    createAgentTab: () => string;
    listTabs: () => { tabs: Array<{ id: string }> };
    switchTab: (id: string) => void;
    configDir: () => string;
    window: {
      isDestroyed: () => boolean;
      isMinimized: () => boolean;
      webContents: {
        isDestroyed: () => boolean;
        send: () => void;
        setBackgroundThrottling: () => void;
      };
    };
    freeSoul: {
      run: (input: { input: string }) => Promise<{ ok: boolean; text: string }>;
    };
  };
  browser.chatLog = [];
  browser.settings = { locale: "zh-CN", execMode: "step", llmMode: "byok", apiKey: "test-key" };
  browser.approvals = new Map();
  browser.skillsCache = [];
  browser.recording = false;
  browser.paused = false;
  browser.activeTabId = "user-tab";
  browser.taskPool = new TaskPool();
  browser.pushSidebarState = () => undefined;
  browser.beginCloudTaskIfNeeded = async () => undefined;
  browser.getUrl = () => "https://example.com";
  browser.getTitle = () => "页";
  browser.listTabs = () => ({ tabs: [{ id: "user-tab" }] });
  browser.configDir = () => dir;
  browser.switchTab = (id: string) => {
    browser.activeTabId = id;
  };
  return browser;
}

describe("T47 后台 agent 任务作用域", () => {
  it("两个 client 并发时各自的 agentTabId 恒定，互不覆盖，结束后仍停在用户标签", async () => {
    const browser = harness();
    let seq = 0;
    browser.createAgentTab = () => {
      seq += 1;
      const id = seq === 1 ? "tab-jia" : "tab-yi";
      browser.activeTabId = id;
      return id;
    };
    const seen: Record<string, string[]> = { 甲: [], 乙: [] };
    let entered = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    browser.freeSoul = {
      run: async (input) => {
        const who = input.input.startsWith("甲") ? "甲" : "乙";
        const read = () => String((browser as unknown as { agentTabId: string }).agentTabId);
        seen[who].push(read());
        entered += 1;
        if (entered >= 2) release();
        await gate;
        seen[who].push(read());
        await Promise.resolve();
        seen[who].push(read());
        return { ok: true, text: "做完了" };
      },
    };

    browser.submitTask("甲去发帖", { clientId: "jia" });
    browser.submitTask("乙去采集", { clientId: "yi" });
    await gate;
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(seen["甲"].length).toBeGreaterThan(0);
    expect(seen["乙"].length).toBeGreaterThan(0);
    expect(new Set(seen["甲"])).toEqual(new Set(["tab-jia"]));
    expect(new Set(seen["乙"])).toEqual(new Set(["tab-yi"]));
    expect(seen["甲"].some((id) => seen["乙"].includes(id))).toBe(false);
    expect(browser.activeTabId).toBe("user-tab");
  });
});

describe("T48 对话按会话隔离", () => {
  it("甲乙互不可见，切换 selectedSession 后侧栏只显示那一份", async () => {
    const browser = harness();
    browser.approvals = new Map();
    browser.skillsCache = [];
    browser.recording = false;
    browser.paused = false;
    let seq = 0;
    const tabs = new Map<string, { id: string }>();
    (browser as unknown as { tabs: typeof tabs }).tabs = tabs;
    browser.createAgentTab = () => {
      seq += 1;
      const id = seq === 1 ? "tab-jia" : "tab-yi";
      tabs.set(id, { id });
      return id;
    };
    browser.chatLog.push({ role: "user", text: "用户的话" });
    browser.freeSoul = { run: async () => ({ ok: true, text: "做完了" }) };
    browser.submitTask("甲的话", { clientId: "jia" });
    browser.submitTask("乙的话", { clientId: "yi" });
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(browser.chatLog.map((turn) => turn.text)).toEqual(["用户的话"]);
    browser.selectSession("agent:jia");
    const jia = browser.getSidebarPayload() as { selectedSession: string; chat: Array<{ text: string }> };
    expect(jia.selectedSession).toBe("agent:jia");
    expect(jia.chat.map((turn) => turn.text).join("\n")).toContain("甲的话");
    expect(jia.chat.map((turn) => turn.text).join("\n")).not.toContain("乙的话");
    expect(jia.chat.map((turn) => turn.text).join("\n")).not.toContain("用户的话");

    browser.selectSession("agent:yi");
    const yi = browser.getSidebarPayload() as { chat: Array<{ text: string }> };
    expect(yi.chat.map((turn) => turn.text).join("\n")).toContain("乙的话");
    expect(yi.chat.map((turn) => turn.text).join("\n")).not.toContain("甲的话");
  });

  it("重启只恢复 user 会话，agent 会话不落盘", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sparo-chat-"));
    dirs.push(dir);
    const browser = harness(dir);
    browser.window = {
      isDestroyed: () => false,
      isMinimized: () => false,
      webContents: {
        isDestroyed: () => false,
        send: () => undefined,
        setBackgroundThrottling: () => undefined,
      },
    };
    browser.createAgentTab = () => "tab-jia";
    browser.chatLog.push({ role: "user", text: "留下的" });
    browser.freeSoul = { run: async () => ({ ok: true, text: "甲做完" }) };
    browser.submitTask("甲的话", { clientId: "jia" });
    await new Promise((resolve) => setTimeout(resolve, 40));
    browser.pushSidebarState = SparkBrowser.prototype.pushSidebarState;
    browser.pushSidebarState();
    await new Promise((resolve) => setTimeout(resolve, 900));

    const next = harness(dir);
    next.chatLog = loadChatMemory(dir);
    expect(next.chatLog.map((turn) => turn.text)).toContain("留下的");
    expect(next.chatLog.map((turn) => turn.text).join("\n")).not.toContain("甲的话");
    expect(next.chatLog.map((turn) => turn.text).join("\n")).not.toContain("甲做完");
  });
});
