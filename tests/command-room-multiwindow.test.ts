import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
import { resetPageLeases } from "../src/main/agent/page-lease.js";
import { resetMcpSessions } from "../src/main/agent/mcp-sessions.js";
import { taskSessionKey } from "../src/main/agent/session-key.js";

const dirs: string[] = [];
afterEach(() => {
  resetMcpSessions();
  resetPageLeases();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("多窗口指挥室", () => {
  it("两扇窗看到同一总览，副窗正在看的页可以知悉提醒", () => {
    const dir = mkdtempSync(join(tmpdir(), "sparo-multiwin-"));
    dirs.push(dir);
    const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & Record<string, never> & {
      tabs: Map<string, { id: string; title: string; url: string; winId: string; kind?: "web" | "command"; view: null; lastActiveAt: number }>;
      taskPool: TaskPool;
      configDir: () => string;
    };
    browser.tabs = new Map([
      ["command-main", { id: "command-main", title: "指挥室", url: "", winId: "main", kind: "command", view: null, lastActiveAt: 1 }],
      ["command-w2", { id: "command-w2", title: "指挥室", url: "", winId: "w2", kind: "command", view: null, lastActiveAt: 1 }],
      ["page", { id: "page", title: "商品", url: "https://dxm.example/a", winId: "w2", kind: "web", view: null, lastActiveAt: 1 }],
      ["other", { id: "other", title: "别的", url: "https://example.com", winId: "main", kind: "web", view: null, lastActiveAt: 1 }],
    ]);
    browser.taskPool = new TaskPool();
    browser.configDir = () => dir;
    browser.activeWinId = "main";
    browser.activeTabId = "other";
    browser.activeTabs.set("w2", "page");
    browser.taskPool.start({ id: "job", tabId: "page", title: "商品", lane: "background", clientId: "jia", agentName: "Cursor" });
    browser.recordVerification("job", [{ name: "保存", ok: true }]);
    browser.sealTaskOutcome("job", "done");
    browser.taskPool.finish("job", "done");
    const main = browser.chromeStateFor("main");
    const side = browser.chromeStateFor("w2");
    expect(main.overview.map((row) => row.tabId).sort()).toEqual(side.overview.map((row) => row.tabId).sort());
    expect(main.overview.find((row) => row.tabId === "page")?.attention).toBe(true);
    expect(side.overview.find((row) => row.tabId === "page")?.attention).toBe(true);
    expect(main.tabs.map((tab) => tab.id)).not.toContain("page");
    expect(side.tabs.map((tab) => tab.id)).toContain("page");
    expect(browser.noteTaskViewed("job", true).ok).toBe(true);
    expect(browser.chromeStateFor("main").overview.find((row) => row.tabId === "page")?.attention).toBeUndefined();
    expect(browser.chromeStateFor("w2").overview.find((row) => row.tabId === "page")?.attention).toBeUndefined();
    expect(browser.sessionKeyForTab("command-main")).toBe("command");
    expect(browser.sessionKeyForTab("command-w2")).toBe("command");
    browser.appendChat("command", "总指挥只说一次");
    const shared = browser.turnsFor("command").map((turn: { text: string }) => turn.text);
    expect(shared.filter((text: string) => text === "总指挥只说一次")).toEqual(["总指挥只说一次"]);
    expect(shared.some((text: string) => text.includes("已完成"))).toBe(true);
    expect(browser.sessionKeyForTab("page")).not.toBe(browser.sessionKeyForTab("other"));
    const sent: Array<{ id: string; overview: Array<{ tabId: string }> }> = [];
    const focused: string[] = [];
    const fakeWin = (id: string) => ({
      isDestroyed: () => false,
      focus: () => focused.push(id),
      show: () => focused.push("show"),
      webContents: {
        isDestroyed: () => false,
        send: (_channel: string, payload: { overview: Array<{ tabId: string }> }) => sent.push({ id, overview: payload.overview }),
      },
    });
    browser.wins.set("main", fakeWin("main"));
    browser.wins.set("w2", fakeWin("w2"));
    browser.chromeBookmarkState = () => ({});
    browser.memoryBoardLine = () => "";
    browser.flushChromeState();
    expect(sent.map((item) => item.id).sort()).toEqual(["main", "w2"]);
    expect(sent[0]?.overview.map((row) => row.tabId).sort()).toEqual(sent[1]?.overview.map((row) => row.tabId).sort());
    expect(focused).toEqual([]);
  });

  it("降级推送按各窗口自己的会话，副窗口不接到总指挥", () => {
    const dir = mkdtempSync(join(tmpdir(), "sparo-fallback-"));
    dirs.push(dir);
    const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & {
      tabs: Map<string, { id: string; title: string; url: string; winId: string; kind?: "web" | "command"; view: null; lastActiveAt: number }>;
      taskPool: TaskPool;
      configDir: () => string;
      settings: { locale: string };
    };
    browser.tabs = new Map([
      ["command-main", { id: "command-main", title: "指挥室", url: "", winId: "main", kind: "command", view: null, lastActiveAt: 1 }],
      ["page", { id: "page", title: "商品", url: "https://dxm.example/a", winId: "w2", kind: "web", view: null, lastActiveAt: 1 }],
    ]);
    browser.taskPool = new TaskPool();
    browser.configDir = () => dir;
    browser.settings = { locale: "zh-CN" };
    browser.activeWinId = "main";
    browser.activeTabId = "command-main";
    browser.activeTabs.set("main", "command-main");
    browser.activeTabs.set("w2", "page");
    browser.taskPool.start({ id: "job", tabId: "page", title: "商品", lane: "background", clientId: "jia", agentName: "Cursor" });
    browser.appendChat("command", "总指挥的话");
    browser.appendChat(taskSessionKey("page", "job"), "页面自己的话");
    browser.getSidebarPayload = () => {
      throw new Error("payload 坏了");
    };
    const sent: Array<{ id: string; selectedSession?: string; chat?: Array<{ text: string }> }> = [];
    const fakeWin = (id: string) => ({
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: (_channel: string, payload: { selectedSession?: string; chat?: Array<{ text: string }> }) => {
          sent.push({ id, selectedSession: payload.selectedSession, chat: payload.chat });
        },
      },
    });
    browser.wins.set("main", fakeWin("main"));
    browser.wins.set("w2", fakeWin("w2"));
    browser.flushSidebarState();
    const side = sent.find((item) => item.id === "w2");
    const texts = (side?.chat || []).map((turn) => turn.text).join("\n");
    expect(side?.selectedSession).toBe(taskSessionKey("page", "job"));
    expect(texts).toContain("页面自己的话");
    expect(texts).not.toContain("总指挥的话");
  });

  it("点指挥室提醒会调用知悉", () => {
    const html = readFileSync(join(process.cwd(), "src/renderer/shell.html"), "utf8");
    const start = html.indexOf("function workbenchTone");
    const end = html.indexOf("function renderChrome");
    const acked: string[] = [];
    const focused: string[] = [];
    const room = {
      hidden: false,
      firstChild: null as unknown,
      children: [] as Array<{ dataset: Record<string, string>; click: () => void }>,
      removeChild() {},
      appendChild(child: { dataset: Record<string, string>; click: () => void }) {
        room.children.push(child);
      },
    };
    const document = {
      createElement() {
        const el = {
          type: "",
          className: "",
          textContent: "",
          dataset: {} as Record<string, string>,
          style: {},
          hidden: false,
          value: "",
          children: [] as Array<{ dataset: Record<string, string>; className: string; click: () => void; children: unknown[] }>,
          click: () => undefined,
          appendChild(child: { dataset: Record<string, string>; className: string; click: () => void; children: unknown[] }) {
            el.children.push(child);
            return child;
          },
          append() {},
          addEventListener(_type: string, fn: () => void) {
            el.click = fn;
          },
        };
        return el;
      },
      getElementById() {
        return room;
      },
    };
    const chromeState = {
      tabs: [{ id: "command-main", kind: "command" }],
      activeId: "command-main",
      overview: [{ tabId: "page", taskId: "job", title: "商品", attention: true, tone: "gray" }],
      groups: [],
    };
    const switched: string[] = [];
    const render = new Function(
      "document",
      "window",
      "chromeState",
      `${html.slice(start, end)}
       return renderCommandRoom;`,
    )(document, { sparkShell: {
      ackTask(id: string) { acked.push(id); },
      focusTask(id: string) { focused.push(id); },
      switchTab(id: string) { switched.push(id); },
    } }, chromeState);
    render();
    const walk = (nodes: Array<{ dataset?: Record<string, string>; className?: string; click: () => void; children?: unknown[] }>): Array<{ dataset?: Record<string, string>; className?: string; click: () => void; children?: unknown[] }> => {
      const found: Array<{ dataset?: Record<string, string>; className?: string; click: () => void; children?: unknown[] }> = [];
      for (const node of nodes || []) {
        found.push(node);
        found.push(...walk((node.children || []) as Array<{ dataset?: Record<string, string>; className?: string; click: () => void; children?: unknown[] }>));
      }
      return found;
    };
    const nodes = walk(room.children as Array<{ dataset?: Record<string, string>; className?: string; click: () => void; children?: unknown[] }>);
    const card = nodes.find((item) => item.dataset && item.dataset.tab === "page");
    card?.click();
    expect(switched).toEqual(["page"]);
    expect(acked).toEqual([]);
    const note = nodes.find((item) => item.className === "wb-note");
    note?.click();
    expect(acked).toEqual(["job"]);
    expect(focused).toEqual(["job"]);
  });

  it("点标签上的提醒也会调用知悉", () => {
    const html = readFileSync(join(process.cwd(), "src/renderer/shell.html"), "utf8");
    const mark = html.lastIndexOf("window.sparkShell.ackTask(taskId)");
    const start = html.lastIndexOf("el.onclick = () => {", mark);
    const end = html.indexOf("el.addEventListener(\"auxclick\"", mark);
    const acked: string[] = [];
    const switched: string[] = [];
    const tab = { id: "page", pageStatus: { attention: true, taskId: "job" } };
    const click = new Function(
      "el",
      "tab",
      "window",
      `${html.slice(start, end)}`,
    );
    const el = { onclick: () => undefined };
    click(el, tab, { sparkShell: { ackTask: (id: string) => acked.push(id), switchTab: (id: string) => switched.push(id) } });
    el.onclick();
    expect(acked).toEqual(["job"]);
    expect(switched).toEqual(["page"]);
  });
});
