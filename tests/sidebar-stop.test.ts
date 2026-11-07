import { describe, expect, it, vi } from "vitest";

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

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SparkBrowser } from "../src/main/browser.js";
import { TaskPool } from "../src/main/agent/task-pool.js";

const INTERRUPTED = "（任务被用户打断，未完成的步骤不做宣称。已做的操作以工具记录为准。）";

describe("T76 侧栏任务能停", () => {
  it("不进任务池的侧栏任务能停，排队取消，停完马上能再跑", async () => {
    const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & {
      taskPool: TaskPool;
      mcpTasks: Array<{ taskId: string; status: string; lastAssistant: string; text: string; execMode?: string }>;
      chatSessions: Map<string, Array<{ role: string; text: string }>>;
      settings: { locale: string; execMode: "auto" };
      activeTabId: string;
      pendingChat: { text: string } | null;
      chatRunning: boolean;
      freeSoul: { run: (input: { input: string }) => Promise<{ ok: boolean; text: string; interrupted?: boolean }> };
      beginCloudTaskIfNeeded: () => Promise<undefined>;
      getUrl: () => string;
      getTitle: () => string;
      pushSidebarState: () => void;
    };
    browser.taskPool = new TaskPool();
    browser.mcpTasks = [];
    browser.chatSessions = new Map();
    browser.settings = { locale: "zh-CN", execMode: "auto" };
    browser.activeTabId = "tab-user";
    browser.beginCloudTaskIfNeeded = async () => undefined;
    browser.getUrl = () => "https://example.com";
    browser.getTitle = () => "例子";
    browser.pushSidebarState = () => undefined;

    let release: (value: { ok: boolean; text: string; interrupted?: boolean }) => void = () => undefined;
    let runs = 0;
    browser.freeSoul = {
      run: () => {
        runs += 1;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    };

    expect(browser.stopAgentTask("missing").ok).toBe(false);

    const first = browser.submitTask("去采集");
    await vi.waitUntil(() => runs === 1);
    expect(browser.chatRunning).toBe(true);
    expect(browser.taskPool.tasks).toHaveLength(0);
    browser.pendingChat = { text: "排队的下一句" };

    const logs: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map((item) => String(item)).join(" "));
    };
    let stopped: { ok: boolean; stopped: string[] };
    try {
      stopped = browser.stopAgentTask(first.taskId);
    } finally {
      console.log = original;
    }

    expect(stopped.ok).toBe(true);
    expect(stopped.stopped).toEqual([first.taskId]);
    expect(browser.mcpTasks[0]?.status).toBe("failed");
    expect(browser.mcpTasks[0]?.lastAssistant).toBe("已手动停止");
    expect(browser.pendingChat).toBeNull();
    const texts = () => (browser.chatSessions.get("user") || []).map((turn) => turn.text);
    expect(texts()).toContain("已手动停止");
    expect(texts()).toContain("排队的消息也一并取消了");
    expect(logs.some((line) => line === `[task] stop ${first.taskId} state=running`)).toBe(true);

    release({ ok: true, text: INTERRUPTED, interrupted: true });
    await vi.waitUntil(() => browser.chatRunning === false);
    expect(runs).toBe(1);
    expect(texts().join("\n")).not.toContain("任务被用户打断");

    let secondInput = "";
    browser.freeSoul = {
      run: async (input) => {
        secondInput = input.input;
        runs += 1;
        return { ok: true, text: "做完了" };
      },
    };
    const again = browser.submitTask("新任务");
    await vi.waitUntil(() => secondInput === "新任务");
    await vi.waitUntil(() => browser.chatRunning === false);
    expect(runs).toBe(2);
    expect(browser.mcpTasks.find((task) => task.taskId === again.taskId)?.status).toBe("done");
    expect(texts()).toContain("做完了");
    expect(browser.taskPool.tasks).toHaveLength(0);
  });

  it("跑动中输入区有停止，空闲时藏起来", () => {
    const html = readFileSync(join(process.cwd(), "src/renderer/shell.html"), "utf8");
    expect(html).toContain('id="chatStop"');
    expect(html).toContain("function syncChatStop");
    expect(html).toContain("payload.chatRunning");
    expect(html).toContain("sparkShell.stopTask");
  });
});
