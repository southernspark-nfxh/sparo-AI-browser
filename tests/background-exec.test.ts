import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: class BrowserWindow {},
  WebContentsView: class WebContentsView {},
  nativeImage: {
    createFromBuffer: () => ({
      isEmpty: () => false,
      getSize: () => ({ width: 8, height: 8 }),
      toPNG: () => Buffer.alloc(40, 1),
      toJPEG: () => Buffer.alloc(40, 1),
    }),
  },
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

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("后台点击与截图", () => {
  it("后台点击不聚焦，注入坐标保持期望点，并写下三件套", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sparo-click-"));
    dirs.push(dir);
    const events: Array<{ type?: string; x?: number; y?: number }> = [];
    const focus = vi.fn();
    const wc = {
      focus,
      isDestroyed: () => false,
      executeJavaScript: async (script: string) => {
        if (String(script).includes("innerText")) return 40;
        if (String(script).includes("elementFromPoint")) return { x: 1, y: 1 };
        return 0;
      },
      sendInputEvent: (event: { type?: string; x?: number; y?: number }) => {
        events.push(event);
      },
    };
    const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & {
      tabs: Map<string, { id: string; view: { webContents: typeof wc } }>;
      activeTabId: string;
      window: {
        isDestroyed: () => boolean;
        isMinimized: () => boolean;
        isVisible: () => boolean;
        isFocused: () => boolean;
        focus: ReturnType<typeof vi.fn>;
        show: ReturnType<typeof vi.fn>;
      };
      configDir: () => string;
      trustedClickAt: (x: number, y: number) => Promise<void>;
    };
    browser.tabs = new Map([["t", { id: "t", view: { webContents: wc } }]]);
    browser.activeTabId = "t";
    browser.configDir = () => dir;
    browser.window = {
      isDestroyed: () => false,
      isMinimized: () => false,
      isVisible: () => true,
      isFocused: () => false,
      focus: vi.fn(),
      show: vi.fn(),
    };
    await browser.trustedClickAt(765, 190, { tabId: "t", downDelayMs: 0 });
    const down = events.find((event) => event.type === "mouseDown");
    expect(down).toMatchObject({ x: 765, y: 190 });
    expect(events.some((event) => event.x === 1 && event.y === 1)).toBe(false);
    expect(browser.window.focus).not.toHaveBeenCalled();
    expect(browser.window.show).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
    const file = readdirSync(join(dir, "diag")).find((name) => name.startsWith("click-"));
    expect(file).toBeTruthy();
    const log = JSON.parse(readFileSync(join(dir, "diag", file || ""), "utf8")) as {
      isMinimized: boolean;
      isVisible: boolean;
      isFocused: boolean;
      expected: { x: number; y: number };
      injected: { x: number; y: number };
      landed: { x: number; y: number };
      bodyLenBefore: number;
      bodyLenAfter: number;
    };
    expect(log.isMinimized).toBe(false);
    expect(log.isVisible).toBe(true);
    expect(log.isFocused).toBe(false);
    expect(log.expected).toEqual({ x: 765, y: 190 });
    expect(log.injected).toEqual({ x: 765, y: 190 });
    expect(log.landed).toEqual({ x: 1, y: 1 });
    expect(log.bodyLenBefore).toBe(40);
    expect(log.bodyLenAfter).toBe(40);
  });

  it("窗口不可见时改走 capturePage 内核路径，不再要求把窗口亮出来", async () => {
    const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & {
      window: { show: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn> };
      captureVisiblePage: (wc: unknown, clip?: unknown) => Promise<unknown>;
    };
    browser.window = { show: vi.fn(), focus: vi.fn() };
    const wc = {
      capturePage: async () => {
        throw new Error("窗口不可见");
      },
      debugger: {
        isAttached: () => false,
        attach: async () => undefined,
        detach: () => undefined,
        sendCommand: async () => ({ data: "aGVsbG8=" }),
      },
    };
    const img = await browser.captureVisiblePage(wc as never, null);
    expect(img).toBeTruthy();
    expect(browser.window.show).not.toHaveBeenCalled();
    expect(browser.window.focus).not.toHaveBeenCalled();
  });

  it("最小化的 agent 任务用 restore 和 showInactive，结束后回到最小化", async () => {
    const calls = { restore: 0, showInactive: 0, show: 0, focus: 0, minimize: 0 };
    let minimized = true;
    const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & {
      chatLog: Array<{ role: string; text: string }>;
      settings: { locale: string; execMode: "step"; apiKey?: string };
      activeTabId: string;
      taskPool: TaskPool;
      pushSidebarState: () => void;
      beginCloudTaskIfNeeded: () => Promise<undefined>;
      getUrl: () => string;
      getTitle: () => string;
      createAgentTab: () => string;
      listTabs: () => { tabs: Array<{ id: string }> };
      configDir: () => string;
      window: {
        isDestroyed: () => boolean;
        isMinimized: () => boolean;
        isFocused: () => boolean;
        isVisible: () => boolean;
        restore: () => void;
        showInactive: () => void;
        show: () => void;
        focus: () => void;
        minimize: () => void;
      };
      freeSoul: { run: (input: { onRound?: (n: number) => void }) => Promise<{ ok: boolean; text: string }> };
    };
    browser.chatLog = [];
    browser.settings = { locale: "zh-CN", execMode: "step", apiKey: "test-key" };
    browser.activeTabId = "user";
    browser.taskPool = new TaskPool();
    browser.pushSidebarState = () => undefined;
    browser.beginCloudTaskIfNeeded = async () => undefined;
    browser.getUrl = () => "https://weibo.com";
    browser.getTitle = () => "微博";
    browser.listTabs = () => ({ tabs: [{ id: "user" }] });
    browser.createAgentTab = () => "agent";
    browser.configDir = () => tmpdir();
    browser.window = {
      isDestroyed: () => false,
      isMinimized: () => minimized,
      isFocused: () => false,
      isVisible: () => !minimized,
      restore: () => {
        calls.restore += 1;
        minimized = false;
      },
      showInactive: () => {
        calls.showInactive += 1;
      },
      show: () => {
        calls.show += 1;
      },
      focus: () => {
        calls.focus += 1;
      },
      minimize: () => {
        calls.minimize += 1;
        minimized = true;
      },
    };
    let during = "";
    browser.freeSoul = {
      run: async () => {
        during = browser.getTask("pending").window;
        return { ok: true, text: "发完了" };
      },
    };
    const submitted = browser.submitTask("发一条微博", { clientId: "bg1" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls.restore).toBe(1);
    expect(calls.showInactive).toBe(1);
    expect(calls.show).toBe(0);
    expect(calls.focus).toBe(0);
    expect(calls.minimize).toBe(1);
    expect(browser.getTask(submitted.taskId).status).toBe("done");
    expect(browser.getTask(submitted.taskId).window).toBe("minimized");
    expect(during).toBe("background");
  });
});
