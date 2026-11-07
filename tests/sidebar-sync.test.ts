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
import { applyChatFrame, type ShellChatState } from "../src/main/sidebar-sync.js";
import type { ChatTurn } from "../src/main/profile/chat-memory.js";

type FrameBrowser = {
  chatSeq: number;
  chatCursor: Map<string, number>;
  lastChatKey: string;
  chatResync: boolean;
  chatSessions: Map<string, ChatTurn[]>;
  chatFrame: (key: string, forceFull: boolean) => {
    chatSync: "full" | "delta";
    chat: ChatTurn[];
    chatBase: number;
    chatSeq: number;
  };
  pushSidebarState: () => void;
  ensurePushMeter: () => { sidebarReq: number; sidebarFlush: number };
  window: { isDestroyed: () => boolean; webContents: { isDestroyed: () => boolean } };
};

function frameBrowser(): FrameBrowser {
  const browser = Object.create(SparkBrowser.prototype) as FrameBrowser;
  browser.chatSeq = 1;
  browser.chatCursor = new Map();
  browser.lastChatKey = "";
  browser.chatResync = false;
  browser.chatSessions = new Map([["user", []]]);
  return browser;
}

describe("T74 侧栏对话增量", () => {
  it("合并窗口里追加 10 条只形成一条增量，壳层结果与全量一致", () => {
    const browser = frameBrowser();
    const book = browser.chatSessions.get("user")!;
    book.push({ role: "user", text: "开头" });
    const first = browser.chatFrame("user", false);
    expect(first.chatSync).toBe("full");

    for (let i = 0; i < 10; i++) book.push({ role: "assistant", text: `第${i}条` });
    const delta = browser.chatFrame("user", false);
    expect(delta.chatSync).toBe("delta");
    expect(delta.chat.length).toBeLessThan(10 + 1);
    expect(delta.chat).toHaveLength(10);
    expect(delta.chatBase).toBe(first.chatSeq);

    let state: ShellChatState = { key: "user", seq: 0, texts: [] };
    state = applyChatFrame(state, { selectedSession: "user", ...first }).state;
    const applied = applyChatFrame(state, { selectedSession: "user", ...delta });
    expect(applied.requestFull).toBe(false);
    expect(applied.state.texts).toEqual(book.map((turn) => turn.text));
  });

  it("换会话发全量", () => {
    const browser = frameBrowser();
    browser.chatSessions.get("user")!.push({ role: "user", text: "用户" });
    browser.chatFrame("user", false);
    browser.chatSessions.set("agent:jia", [{ role: "user", text: "甲" }]);
    const frame = browser.chatFrame("agent:jia", false);
    expect(frame.chatSync).toBe("full");
    expect(frame.chat.map((turn) => turn.text)).toEqual(["甲"]);
  });

  it("序号对不上就请求全量，不把缺口拼进本地", () => {
    const applied = applyChatFrame(
      { key: "user", seq: 1, texts: ["开头"] },
      { selectedSession: "user", chatSync: "delta", chatBase: 4, chatSeq: 5, chat: [{ text: "漏掉的" }] },
    );
    expect(applied.requestFull).toBe(true);
    expect(applied.state.texts).toEqual(["开头"]);
  });

  it("壳层重载后下一拍是全量", () => {
    const browser = frameBrowser();
    const book = browser.chatSessions.get("user")!;
    book.push({ role: "user", text: "开头" });
    browser.chatFrame("user", false);
    book.push({ role: "assistant", text: "后续" });
    const again = browser.chatFrame("user", true);
    expect(again.chatSync).toBe("full");
    expect(again.chat.map((turn) => turn.text)).toEqual(["开头", "后续"]);
  });

  it("100ms 内 10 次推送只发出一拍", () => {
    vi.useFakeTimers();
    const browser = Object.create(SparkBrowser.prototype) as FrameBrowser & { flushSidebarState: () => void };
    let flushes = 0;
    browser.flushSidebarState = () => {
      flushes += 1;
    };
    browser.window = { isDestroyed: () => false, webContents: { isDestroyed: () => false } };
    for (let i = 0; i < 10; i++) browser.pushSidebarState();
    expect(flushes).toBe(0);
    vi.advanceTimersByTime(100);
    expect(flushes).toBe(1);
    expect(browser.ensurePushMeter().sidebarReq).toBe(10);
    vi.useRealTimers();
  });

  it("壳层有增量合并和全量回补入口", () => {
    const html = readFileSync(join(process.cwd(), "src/renderer/shell.html"), "utf8");
    const preload = readFileSync(join(process.cwd(), "src/main/shell-preload.ts"), "utf8");
    expect(html).toContain("function applyChatFrame");
    expect(html).toContain("requestChatFull");
    expect(preload).toContain("spark:chat-resync");
  });
});
