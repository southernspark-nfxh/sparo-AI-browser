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
import { applyChatFrame, consumeChatEcho, type ShellChatState } from "../src/main/sidebar-sync.js";
import type { ChatTurn } from "../src/main/profile/chat-memory.js";

type FrameBrowser = {
  chatSeq: number;
  chatCursor: Map<string, number>;
  lastChatKey: string;
  chatResync: boolean;
  chatSessions: Map<string, ChatTurn[]>;
  chatFrame: (key: string, forceFull: boolean, readOnly?: boolean) => {
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

  it("重同步后下一拍是全量，再下一拍回到增量", () => {
    const browser = frameBrowser();
    const book = browser.chatSessions.get("user")!;
    book.push({ role: "user", text: "开头" });
    browser.chatResync = true;
    const full = browser.chatFrame("user", false);
    expect(full.chatSync).toBe("full");
    expect(full.why).toBe("resync");
    book.push({ role: "assistant", text: "下一句" });
    const delta = browser.chatFrame("user", false);
    expect(delta.chatSync).toBe("delta");
    expect(delta.chat.map((turn) => turn.text)).toEqual(["下一句"]);
    book.push({ role: "assistant", text: "再一句" });
    const again = browser.chatFrame("user", false);
    expect(again.chatSync).toBe("delta");
    expect(again.why).toBe("delta");
    expect(again.chat.map((turn) => turn.text)).toEqual(["再一句"]);
    const applied = applyChatFrame(
      { key: "user", seq: full.chatSeq, texts: full.chat.map((turn) => turn.text || "") },
      { selectedSession: "user", ...delta },
    );
    expect(applied.requestFull).toBe(false);
  });

  it("旧序号更大时不再把整段窗口当成每一拍", () => {
    const browser = frameBrowser();
    const book = browser.chatSessions.get("user")!;
    book.push({ role: "assistant", text: "旧", seq: 49 });
    book.push({ role: "assistant", text: "末尾", seq: 12 });
    browser.chatSeq = 1;
    browser.chatResync = true;
    const full = browser.chatFrame("user", false);
    expect(full.chatSync).toBe("full");
    expect(full.chatSeq).toBe(49);
    book.push({ role: "assistant", text: "新的一轮" });
    const delta = browser.chatFrame("user", false);
    expect(delta.chatSync).toBe("delta");
    expect(delta.why).toBe("delta");
    expect(delta.chat.map((turn) => turn.text)).toEqual(["新的一轮"]);
    expect(JSON.stringify(delta.chat).length).toBeLessThan(JSON.stringify(full.chat).length);
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

  it("没有 chatSync 时不动对话，全量缺 chat 时请求全量且不清空", () => {
    const state: ShellChatState = { key: "user", seq: 2, texts: ["还在"] };
    const ignored = applyChatFrame(state, { selectedSession: "user" });
    expect(ignored.requestFull).toBe(false);
    expect(ignored.state).toBe(state);
    const missing = applyChatFrame(state, { selectedSession: "user", chatSync: "full", chatSeq: 4 });
    expect(missing.requestFull).toBe(true);
    expect(missing.state.texts).toEqual(["还在"]);
    const cleared = applyChatFrame(state, { selectedSession: "user", chatSync: "full", chat: [], chatSeq: 0 });
    expect(cleared.requestFull).toBe(false);
    expect(cleared.state.texts).toEqual([]);
  });

  it("只读对话帧不推进游标，也不改原对话的序号", () => {
    const browser = frameBrowser();
    const book = browser.chatSessions.get("user")!;
    book.push({ role: "user", text: "未编号" });
    browser.chatResync = true;
    const seqBefore = browser.chatSeq;
    const peeked = browser.chatFrame("user", false, true);
    expect(peeked.chatSync).toBe("full");
    expect(peeked.chat.map((turn) => turn.text)).toEqual(["未编号"]);
    expect(book[0].seq).toBeUndefined();
    expect(browser.chatCursor.has("user")).toBe(false);
    expect(browser.chatSeq).toBe(seqBefore);
    expect(browser.chatResync).toBe(true);
  });

  it("连发两句相同的话，只吃掉已经出现在正式对话里的那条回显", () => {
    const echoes = [
      { id: "1", text: "同样" },
      { id: "2", text: "同样" },
    ];
    const prev = [{ role: "user", text: "同样" }];
    const next = [
      { role: "user", text: "同样" },
      { role: "user", text: "同样" },
    ];
    expect(consumeChatEcho(prev, next, echoes)).toEqual([{ id: "2", text: "同样" }]);
  });

  it("壳层坏帧不清空，并保留角色和附件", () => {
    const html = readFileSync(join(process.cwd(), "src/renderer/shell.html"), "utf8");
    const start = html.indexOf("function applyChatFrame");
    const end = html.indexOf("function applySidebar");
    const src = html.slice(start, end);
    const shell = new Function(`${src}\nreturn { applyChatFrame, consumeChatEcho };`)() as {
      applyChatFrame: (
        state: { key: string; seq: number; texts: Array<{ role?: string; text?: string; images?: string[] }> },
        frame: { selectedSession?: string; chatSync?: string; chat?: unknown; chatSeq?: number },
      ) => { requestFull: boolean; state: { texts: Array<{ role?: string; text?: string; images?: string[] }> } };
      consumeChatEcho: typeof consumeChatEcho;
    };
    const state = { key: "user", seq: 3, texts: [{ role: "user", text: "还在" }] };
    const ignored = shell.applyChatFrame(state, { selectedSession: "other" });
    expect(ignored.requestFull).toBe(false);
    expect(ignored.state.texts).toEqual(state.texts);
    const missing = shell.applyChatFrame(state, { chatSync: "full", chatSeq: 9 });
    expect(missing.requestFull).toBe(true);
    expect(missing.state.texts).toEqual([{ role: "user", text: "还在" }]);
    const kept = shell.applyChatFrame(state, {
      chatSync: "full",
      chatSeq: 4,
      chat: [{ role: "assistant", text: "新", images: ["a.png"] }],
    });
    expect(kept.requestFull).toBe(false);
    expect(kept.state.texts).toEqual([{ role: "assistant", text: "新", images: ["a.png"] }]);
    const echoes = [
      { id: "1", text: "同样" },
      { id: "2", text: "同样" },
    ];
    expect(
      shell.consumeChatEcho([{ role: "user", text: "同样" }], [{ role: "user", text: "同样" }, { role: "user", text: "同样" }], echoes),
    ).toEqual([{ id: "2", text: "同样" }]);
  });
});
