import { describe, expect, it, vi } from "vitest";
import { laneFor, laneForText } from "../src/main/agent/task-class.js";
import { TaskPool } from "../src/main/agent/task-pool.js";

vi.mock("electron", () => ({
  BrowserWindow: class BrowserWindow {},
  WebContentsView: class WebContentsView {},
  Menu: { buildFromTemplate: () => ({ popup: () => undefined }) },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  app: {
    getPath: () => process.cwd(),
    getAppPath: () => process.cwd(),
    isReady: () => true,
    isPackaged: false,
    on: () => undefined,
    whenReady: () => Promise.resolve(),
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

describe("laneFor", () => {
  it("查表：前台 kind 与拿不准的都是 foreground", () => {
    expect(laneFor("fill_form")).toBe("foreground");
    expect(laneFor("one_click_reply")).toBe("foreground");
    expect(laneFor("feishu")).toBe("foreground");
    expect(laneFor("print")).toBe("foreground");
    expect(laneFor("page")).toBe("foreground");
    expect(laneFor("chat")).toBe("foreground");
    expect(laneFor("waiting_human")).toBe("foreground");
    expect(laneFor("not-a-real-kind")).toBe("foreground");
  });

  it("查表：调研、比价、出差、检索是 background", () => {
    expect(laneFor("compare_shop")).toBe("background");
    expect(laneFor("research")).toBe("background");
    expect(laneFor("trip_plan")).toBe("background");
    expect(laneFor("travel_search")).toBe("background");
    expect(laneFor("search_read")).toBe("background");
    expect(laneFor("mission")).toBe("background");
  });

  it("前台 cap 压过后台 kind", () => {
    expect(laneFor("research", { cap: "fill_form" })).toBe("foreground");
    expect(laneFor("chat", { cap: "search_read" })).toBe("background");
  });

  it("验收口令按现有路由分类", () => {
    expect(laneForText("戴森吹风机 在淘宝和京东比价")).toBe("background");
    expect(laneForText("下周一从上海去广州出差两天 机票酒店")).toBe("background");
    expect(laneForText("帮我回一下当前页评论")).toBe("foreground");
    expect(laneForText("总结当前页")).toBe("foreground");
    expect(laneForText("随便聊聊今天心情")).toBe("foreground");
  });
});

describe("TaskPool", () => {
  it("池上限 3，第 4 个排队", () => {
    const pool = new TaskPool();
    for (let i = 0; i < 3; i += 1) {
      pool.start({ id: `r${i}`, tabId: `t${i}`, title: `跑${i}`, lane: "background" });
    }
    expect(pool.canStartBackground()).toBe(false);
    const queued = pool.enqueue({ id: "q1", tabId: "", title: "第四个", lane: "background" });
    expect(queued.state).toBe("queued");
    expect(queued.step).toBe("排队中（第 1 位）");
    expect(pool.runningBackground()).toBe(3);
  });

  it("前台互斥，不挡住后台名额", () => {
    const pool = new TaskPool();
    expect(pool.tryStartForeground()).toBe(true);
    expect(pool.tryStartForeground()).toBe(false);
    expect(pool.canStartBackground()).toBe(true);
    pool.start({ id: "b1", tabId: "bg", title: "调研", lane: "background" });
    expect(pool.runningBackground()).toBe(1);
    pool.releaseForeground();
    expect(pool.tryStartForeground()).toBe(true);
  });

  it("waiting_human 不占名额，腾出的位子给队首", () => {
    const pool = new TaskPool();
    pool.start({ id: "a", tabId: "1", title: "a", lane: "background" });
    pool.start({ id: "b", tabId: "2", title: "b", lane: "background" });
    pool.start({ id: "c", tabId: "3", title: "c", lane: "background" });
    pool.enqueue({ id: "d", tabId: "", title: "d", lane: "background" });
    pool.suspend("a");
    expect(pool.runningBackground()).toBe(2);
    expect(pool.canStartBackground()).toBe(true);
    const card = pool.tasks.find((task) => task.id === "a");
    expect(card?.state).toBe("waiting_human");
    expect(card?.step).toBe("等你处理");
    const next = pool.promoteNext();
    expect(next?.id).toBe("d");
    expect(next?.state).toBe("running");
    expect(pool.runningBackground()).toBe(3);
  });

  it("完成后释放名额并唤起队首", () => {
    const pool = new TaskPool();
    pool.start({ id: "a", tabId: "1", title: "a", lane: "background" });
    pool.start({ id: "b", tabId: "2", title: "b", lane: "background" });
    pool.start({ id: "c", tabId: "3", title: "c", lane: "background" });
    pool.enqueue({ id: "d", tabId: "", title: "d", lane: "background" });
    pool.enqueue({ id: "e", tabId: "", title: "e", lane: "background" });
    expect(pool.tasks.find((task) => task.id === "e")?.step).toBe("排队中（第 2 位）");
    const finished = pool.finish("b");
    expect(finished?.state).toBe("done");
    expect(finished?.step).toBe("完成");
    expect(pool.runningBackground()).toBe(2);
    const next = pool.promoteNext();
    expect(next?.id).toBe("d");
    expect(pool.runningBackground()).toBe(3);
    expect(pool.tasks.find((task) => task.id === "e")?.step).toBe("排队中（第 1 位）");
  });
});

describe("后台标签不抢当前页", () => {
  it("createAgentTab 不改 activeTabId，也不 switchTab", () => {
    const browser = Object.create(SparkBrowser.prototype) as {
      activeTabId: string;
      createTab: (url: string, activate?: boolean) => string;
      createAgentTab: (url?: string) => string;
      switchTab: (id: string) => void;
    };
    browser.activeTabId = "user-tab";
    browser.switchTab = () => {
      throw new Error("background must not switchTab");
    };
    browser.createTab = (_url, activate) => {
      expect(activate).toBe(false);
      return "bg-tab";
    };
    expect(browser.createAgentTab()).toBe("bg-tab");
    expect(browser.activeTabId).toBe("user-tab");
  });
});
