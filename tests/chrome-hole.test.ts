import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: class BrowserWindow {},
  WebContentsView: class WebContentsView {},
  Menu: { buildFromTemplate: () => ({ popup: () => undefined }) },
  dialog: {},
  app: { getPath: () => process.cwd(), getAppPath: () => process.cwd(), getLocale: () => "zh-CN", isPackaged: false },
  ipcMain: { handle: () => undefined, on: () => undefined },
  session: { defaultSession: {}, fromPartition: () => ({}) },
  clipboard: { writeText: () => undefined },
  shell: { openExternal: async () => undefined, openPath: async () => "" },
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1280, height: 800 } }) },
}));

import { SparkBrowser } from "../src/main/browser.js";
import { bindWindow, makeBrowser } from "./helpers/browser-fixture.js";
import {
  CHROME_HEAL_COOLDOWN_MS,
  CHROME_HEAL_STALL_LIMIT,
  chromeCoverReason,
  pageViewCoversChrome,
  resetChromeCoverBudget,
  takeChromeCoverFix,
} from "../src/main/page-bounds.js";

type FakeView = {
  getBounds: () => { x: number; y: number; width: number; height: number };
  webContents?: { isDestroyed: () => boolean };
};
type HoleBrowser = SparkBrowser & {
  tabs: Map<string, { id: string; view?: FakeView; discarded?: boolean }>;
  activeTabId: string;
  holeBounds: { x: number; y: number; width: number; height: number } | null;
  chromeCover: { windowStart: number; fixes: number; lastFix: number };
  boundsGuard: boolean;
  overlay: string;
  window: { isDestroyed: () => boolean; isMinimized: () => boolean; isMaximized: () => boolean };
  lastActiveBounds: null;
  chromeHoleTimer: ReturnType<typeof setInterval> | null;
  applyViewBounds: (followUp?: boolean) => void;
  startChromeHoleWatch: () => void;
  assertChromeHole: () => void;
};

const timers: Array<ReturnType<typeof setInterval> | null> = [];

afterEach(() => {
  for (const timer of timers) if (timer) clearInterval(timer);
  timers.length = 0;
  vi.useRealTimers();
});

function bare(): HoleBrowser {
  // 空壳实例补成"一扇 main 窗口"：多开后的状态都按窗口存，工装不补就什么都拿不到。
  return makeBrowser().browser as unknown as HoleBrowser;
}

describe("常驻页面洞断言", () => {
  it("事件预算密集打满之后，2 秒内仍把整窗视图拉回", () => {
    vi.useFakeTimers();
    const browser = bare();
    const hole = { x: 0, y: 76, width: 900, height: 700 };
    const full = { x: 0, y: 0, width: 1400, height: 900 };
    browser.tabs = new Map([
      ["t", { id: "t", view: { getBounds: () => full, webContents: { isDestroyed: () => false } } }],
    ]);
    browser.activeTabId = "t";
    browser.holeBounds = hole;
    browser.overlay = "none";
    browser.boundsGuard = false;
    browser.lastActiveBounds = null;
    browser.chromeHoleTimer = null;
    bindWindow(browser, {
      isDestroyed: () => false,
      isMinimized: () => false,
      isMaximized: () => false,
      contentView: { children: [] as unknown[], removeChildView() {}, addChildView() {} },
      webContents: { send() {}, isDestroyed: () => false },
    });
    let state = resetChromeCoverBudget(1_000);
    for (let i = 0; i < 20; i += 1) {
      const taken = takeChromeCoverFix(state, 1_000);
      state = taken.state;
    }
    browser.chromeCover = state;
    let pulls = 0;
    browser.applyViewBounds = () => {
      pulls += 1;
    };
    browser.startChromeHoleWatch();
    timers.push(browser.chromeHoleTimer);
    vi.advanceTimersByTime(2_000);
    expect(pulls).toBeGreaterThan(0);
  });
});

describe("T57 覆盖原因", () => {
  const hole = { x: 100, y: 76, width: 800, height: 700 };

  it("五条分支和正常矩形", () => {
    expect(chromeCoverReason({ ...hole, y: 0 }, hole)).toBe("y");
    expect(chromeCoverReason({ ...hole, x: 0 }, hole)).toBe("x");
    expect(chromeCoverReason({ ...hole, width: 900 }, hole)).toBe("width");
    expect(chromeCoverReason({ x: 110, y: 76, width: 800, height: 700 }, hole)).toBe("right");
    expect(chromeCoverReason({ ...hole, height: 720 }, hole)).toBe("height");
    expect(chromeCoverReason(hole, hole)).toBeNull();
    expect(pageViewCoversChrome(hole, hole)).toBe(false);
    expect(pageViewCoversChrome({ ...hole, y: 0 }, hole)).toBe(true);
  });
});

type Rect = { x: number; y: number; width: number; height: number };

function rectView(initial: Rect) {
  const state = { ...initial, visible: true };
  const reloads: string[] = [];
  const view = {
    state,
    webContents: {
      isDestroyed: () => false,
      close: () => undefined,
      reload: () => reloads.push("reload"),
      loadURL: () => reloads.push("load"),
    },
    getBounds(): Rect {
      return { x: state.x, y: state.y, width: state.width, height: state.height };
    },
    setBounds(next: Rect) {
      state.x = next.x;
      state.y = next.y;
      state.width = next.width;
      state.height = next.height;
    },
    setVisible(visible: boolean) {
      state.visible = visible;
    },
  };
  return { view, state, reloads };
}

function hostOf(browser: HoleBrowser): Record<string, (...args: unknown[]) => unknown> {
  return browser as unknown as Record<string, (...args: unknown[]) => unknown>;
}

function armHole(browser: HoleBrowser, hole: Rect): void {
  browser.holeBounds = hole;
  browser.overlay = "none";
  browser.boundsGuard = false;
  browser.lastActiveBounds = null;
  browser.chromeHoleTimer = null;
  browser.chromeCover = resetChromeCoverBudget(Date.now());
  bindWindow(browser, {
    isDestroyed: () => false,
    isMinimized: () => false,
    isMaximized: () => false,
    getContentSize: () => [1280, 905],
    contentView: { children: [], removeChildView() {}, addChildView() {} },
    webContents: { send() {}, isDestroyed: () => false },
  } as HoleBrowser["window"] as object);
  const host = hostOf(browser);
  host.sidebarW = 340;
  host.lastGoodContent = { width: 1280, height: 905 };
  for (const name of ["wakeTab", "layout", "focusActivePage", "pushChromeState", "pushSidebarState", "listTabs"]) {
    host[name] = () => undefined;
  }
}

describe("T1 后台视图覆盖与归属", () => {
  const hole = { x: 0, y: 76, width: 680, height: 829 };
  const parked = { x: -20000, y: 0, width: 680, height: 829 };
  const full = { x: 0, y: 0, width: 1400, height: 900 };

  it("活动页正常时，屏幕内的后台页会被隐藏，几何留在页面洞里", () => {
    const browser = bare();
    armHole(browser, hole);
    const active = rectView(hole);
    const bg = rectView(full);
    const bgTab = { id: "bg", view: bg.view, agentStatus: "done" as const };
    browser.tabs = new Map([
      ["a", { id: "a", view: active.view }],
      ["bg", bgTab],
    ]);
    browser.activeTabId = "a";
    const order = [...browser.tabs.keys()].join(",");
    let applies = 0;
    browser.applyViewBounds = () => {
      applies += 1;
    };
    browser.assertChromeHole();
    expect(bg.state.visible).toBe(false);
    // 改成屏幕外会让 Chromium 丢掉上一帧，切回来就得重新排版绘制。
    expect(bg.state.x).toBe(0);
    expect(bg.state.width).toBe(940);
    expect(applies).toBe(0);
    expect(bg.reloads).toEqual([]);
    expect(browser.activeTabId).toBe("a");
    expect([...browser.tabs.keys()].join(",")).toBe(order);
    expect(bgTab.agentStatus).toBe("done");
    expect(active.state).toMatchObject(hole);
  });

  it("后台页已隐藏且几何正确时，不重排也不重复停放", () => {
    const browser = bare();
    armHole(browser, hole);
    const active = rectView(hole);
    const bg = rectView(hole);
    bg.state.visible = false;
    browser.tabs = new Map([
      ["a", { id: "a", view: active.view }],
      ["bg", { id: "bg", view: bg.view }],
    ]);
    browser.activeTabId = "a";
    let applies = 0;
    let parks = 0;
    browser.applyViewBounds = () => {
      applies += 1;
    };
    const host = hostOf(browser);
    const park = host.parkPageView.bind(browser);
    host.parkPageView = (...args: unknown[]) => {
      parks += 1;
      return park(...args);
    };
    browser.assertChromeHole();
    expect(applies).toBe(0);
    expect(parks).toBe(0);
    expect(bg.state.x).toBe(hole.x);
    expect(bg.state.visible).toBe(false);
  });

  it("后台视图触发 heal 时，after 与 stall 都属于后台标签", () => {
    const browser = bare();
    armHole(browser, hole);
    const reads = { a: 0, bg: 0 };
    const active = {
      getBounds: () => {
        reads.a += 1;
        return hole;
      },
      setBounds() {},
      setVisible() {},
      webContents: { isDestroyed: () => false },
    };
    const bg = {
      getBounds: () => {
        reads.bg += 1;
        return full;
      },
      setBounds() {},
      setVisible() {},
      webContents: { isDestroyed: () => false },
    };
    browser.tabs = new Map([
      ["a", { id: "a", view: active }],
      ["bg", { id: "bg", view: bg }],
    ]);
    browser.activeTabId = "a";
    hostOf(browser).parkPageView = () => undefined;
    hostOf(browser).onPageViewBoundsChanged(bg);
    const stalls = hostOf(browser).chromeHealStalls() as Map<string, { count: number }>;
    expect(stalls.get("bg")?.count).toBe(1);
    expect(stalls.has("a")).toBe(false);
    expect(reads.bg).toBeGreaterThanOrEqual(2);
    expect(reads.a).toBe(0);
  });

  it("正常活动页和正常停放的后台页不产生重排", () => {
    const browser = bare();
    armHole(browser, hole);
    const active = rectView(hole);
    const bg = rectView(parked);
    browser.tabs = new Map([
      ["a", { id: "a", view: active.view }],
      ["bg", { id: "bg", view: bg.view }],
    ]);
    browser.activeTabId = "a";
    let applies = 0;
    browser.applyViewBounds = () => {
      applies += 1;
    };
    browser.assertChromeHole();
    expect(applies).toBe(0);
    expect(active.state).toMatchObject(hole);
    expect(bg.state).toMatchObject({ ...parked, visible: true });
  });

  it("未登记的 child 只记诊断，不关闭也不移除", () => {
    const browser = bare();
    armHole(browser, hole);
    const active = rectView(hole);
    const close = vi.fn();
    const remove = vi.fn();
    const stranger = {
      getBounds: () => ({ x: 12, y: 18, width: 240, height: 180 }),
      webContents: { isDestroyed: () => false, close },
    };
    browser.tabs = new Map([["a", { id: "a", view: active.view }]]);
    browser.activeTabId = "a";
    (browser.window as unknown as { contentView: { children: unknown[]; removeChildView: () => void } }).contentView = {
      children: [active.view, stranger],
      removeChildView: remove,
    };
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
    try {
      browser.assertChromeHole();
    } finally {
      spy.mockRestore();
    }
    expect(lines.some((line) => line.includes("[chrome-hole] unregistered") && line.includes("count=1"))).toBe(true);
    expect(remove).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("休眠或已销毁的后台页不参与校正", () => {
    const browser = bare();
    armHole(browser, hole);
    const active = rectView(hole);
    const discarded = rectView(full);
    const dead = rectView(full);
    dead.view.webContents.isDestroyed = () => true;
    browser.tabs = new Map([
      ["a", { id: "a", view: active.view }],
      ["gone", { id: "gone", view: discarded.view, discarded: true }],
      ["dead", { id: "dead", view: dead.view }],
    ]);
    browser.activeTabId = "a";
    browser.assertChromeHole();
    expect(discarded.state.x).toBe(0);
    expect(dead.state.x).toBe(0);
  });
});

describe("T2 降频恢复", () => {
  it("冷却常量是 10 秒，三次之后才进入降频", () => {
    expect(CHROME_HEAL_COOLDOWN_MS).toBe(10_000);
    expect(CHROME_HEAL_STALL_LIMIT).toBe(3);
  });

  it("活动页盖住壳层时不进长冷却，切走后后台页仍会降频", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T02:00:00Z"));
    const browser = bare();
    const hole = { x: 0, y: 76, width: 680, height: 829 };
    const stuck = { x: 0, y: 76, width: 966, height: 829 };
    const view = {
      getBounds: () => stuck,
      setBounds() {},
      setVisible() {},
      webContents: { isDestroyed: () => false },
    };
    browser.tabs = new Map([
      ["a", { id: "a", view }],
      [
        "b",
        {
          id: "b",
          view: {
            getBounds: () => stuck,
            setBounds() {},
            setVisible() {},
            webContents: { isDestroyed: () => false },
          },
        },
      ],
    ]);
    browser.activeTabId = "a";
    armHole(browser, hole);
    const host = hostOf(browser);
    let pulls = 0;
    let holeReqs = 0;
    let remounts = 0;
    browser.applyViewBounds = () => {
      pulls += 1;
    };
    host.requestHoleReport = () => {
      holeReqs += 1;
    };
    host.remountCoveredActiveView = () => {
      remounts += 1;
      return stuck;
    };
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
    try {
      for (let i = 0; i < 3; i += 1) {
        browser.assertChromeHole();
        vi.advanceTimersByTime(2_000);
      }
      expect(pulls).toBe(3);
      expect(remounts).toBe(1);
      expect(holeReqs).toBe(1);
      browser.assertChromeHole();
      expect(pulls).toBe(4);
      expect(remounts).toBe(1);
      expect(lines.some((line) => line.includes("[chrome-hole] retry-deferred tab=a reason=width"))).toBe(true);
      expect(lines.some((line) => line.includes("before=") && line.includes("after=") && line.includes("cooldown="))).toBe(true);
      expect(lines.some((line) => line.includes("give-up"))).toBe(false);
      expect(lines.some((line) => line.includes("reason=width dw=286"))).toBe(true);
      expect(lines.some((line) => /https?:/.test(line))).toBe(false);
      browser.switchTab("b", { userAction: true });
      browser.assertChromeHole();
      expect(pulls).toBe(5);
      expect(remounts).toBe(1);
      for (let i = 0; i < 2; i += 1) {
        vi.advanceTimersByTime(2_000);
        browser.assertChromeHole();
      }
      expect(pulls).toBe(7);
      expect(remounts).toBe(2);
      browser.assertChromeHole();
      expect(pulls).toBe(7);
      vi.advanceTimersByTime(CHROME_HEAL_COOLDOWN_MS);
      browser.assertChromeHole();
      expect(pulls).toBe(8);
      expect(remounts).toBe(2);
      expect(lines.some((line) => line.includes("[chrome-hole] retry tab=b reason=width"))).toBe(true);
      host.resetChromeCoverState();
      browser.assertChromeHole();
      expect(pulls).toBe(9);
    } finally {
      spy.mockRestore();
    }
  });

  it("重挂恢复到合法洞后退出退避，同一个退避周期不第二次重挂", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T02:10:00Z"));
    const browser = bare();
    const hole = { x: 0, y: 76, width: 940, height: 829 };
    const stuck = { x: 0, y: 0, width: 1400, height: 905 };
    let current = { ...stuck };
    const view = {
      getBounds: () => ({ ...current }),
      setBounds(next: Rect) {
        current = { ...next };
      },
      setVisible() {},
      webContents: { isDestroyed: () => false },
    };
    const children: unknown[] = [view];
    let removes = 0;
    let adds = 0;
    browser.tabs = new Map([["a", { id: "a", view }]]);
    browser.activeTabId = "a";
    armHole(browser, hole);
    (browser.window as unknown as { contentView: unknown }).contentView = {
      children,
      removeChildView(child: unknown) {
        removes += 1;
        const index = children.indexOf(child);
        if (index >= 0) children.splice(index, 1);
      },
      addChildView(child: unknown) {
        adds += 1;
        children.push(child);
      },
    };
    browser.applyViewBounds = () => undefined;
    let reloads = 0;
    (view as { webContents: { reload?: () => void } }).webContents.reload = () => {
      reloads += 1;
    };
    for (let i = 0; i < 3; i += 1) {
      browser.assertChromeHole();
      vi.advanceTimersByTime(2_000);
    }
    expect(removes).toBe(1);
    expect(adds).toBe(1);
    expect(reloads).toBe(0);
    expect(current.y).toBe(76);
    expect(current.width).toBe(940);
    expect(pageViewCoversChrome(current, hole)).toBe(false);
    const removesAfter = removes;
    browser.assertChromeHole();
    vi.advanceTimersByTime(CHROME_HEAL_COOLDOWN_MS);
    browser.assertChromeHole();
    expect(removes).toBe(removesAfter);
    expect(browser.activeTabId).toBe("a");
  });

  it("同一标签在同一毫秒内不会把去抖再烧一次", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T03:00:00Z"));
    const browser = bare();
    const hole = { x: 0, y: 76, width: 680, height: 829 };
    const stuck = { x: 0, y: 0, width: 1400, height: 900 };
    const view = {
      getBounds: () => stuck,
      setBounds() {},
      setVisible() {},
      webContents: { isDestroyed: () => false },
    };
    browser.tabs = new Map([["a", { id: "a", view }]]);
    browser.activeTabId = "a";
    armHole(browser, hole);
    let pulls = 0;
    browser.applyViewBounds = () => {
      pulls += 1;
    };
    const host = hostOf(browser);
    host.onPageViewBoundsChanged(view);
    host.onPageViewBoundsChanged(view);
    expect(pulls).toBe(1);
  });

  it("同一次断言会隐藏每一个仍在屏幕内的后台页", () => {
    const browser = bare();
    const hole = { x: 0, y: 76, width: 680, height: 829 };
    armHole(browser, hole);
    const active = rectView(hole);
    const first = rectView({ x: 0, y: 0, width: 1400, height: 900 });
    const second = rectView({ x: 30, y: 0, width: 1400, height: 900 });
    browser.tabs = new Map([
      ["a", { id: "a", view: active.view }],
      ["b1", { id: "b1", view: first.view }],
      ["b2", { id: "b2", view: second.view }],
    ]);
    browser.activeTabId = "a";
    browser.applyViewBounds = () => {
      throw new Error("活动页正常时不应该重排");
    };
    browser.assertChromeHole();
    expect(first.state.x).toBe(hole.x);
    expect(second.state.x).toBe(hole.x);
    expect(first.state.visible).toBe(false);
    expect(second.state.visible).toBe(false);
    expect(browser.activeTabId).toBe("a");
  });

  it("后台覆盖只停放，不重挂也不刷新", () => {
    const browser = bare();
    const hole = { x: 0, y: 76, width: 680, height: 829 };
    armHole(browser, hole);
    const active = rectView(hole);
    const bg = rectView({ x: 0, y: 0, width: 1400, height: 900 });
    let removes = 0;
    let adds = 0;
    browser.tabs = new Map([
      ["a", { id: "a", view: active.view }],
      ["bg", { id: "bg", view: bg.view }],
    ]);
    browser.activeTabId = "a";
    (browser.window as unknown as { contentView: unknown }).contentView = {
      children: [active.view, bg.view],
      removeChildView() {
        removes += 1;
      },
      addChildView() {
        adds += 1;
      },
    };
    browser.applyViewBounds = () => {
      throw new Error("后台覆盖不应该重排活动页");
    };
    browser.assertChromeHole();
    expect(bg.state.visible).toBe(false);
    expect(bg.state.x).toBe(hole.x);
    expect(removes).toBe(0);
    expect(adds).toBe(0);
    expect(bg.reloads).toEqual([]);
  });

  it("非法页面洞不会把网页设成整窗", () => {
    const browser = bare();
    armHole(browser, { x: 0, y: 0, width: 10, height: 10 });
    const active = rectView({ x: 0, y: 0, width: 1400, height: 900 });
    const setBounds = vi.fn();
    active.view.setBounds = setBounds;
    browser.tabs = new Map([["a", { id: "a", view: active.view }]]);
    browser.activeTabId = "a";
    browser.assertChromeHole();
    expect(setBounds).not.toHaveBeenCalled();
    const fallback = hostOf(browser).pageBounds() as Rect;
    expect(fallback.y).toBe(76);
    expect(fallback.x).toBe(0);
    expect(fallback.width).toBe(1280 - 340);
    expect(fallback.height).toBe(905 - 76);
    expect(fallback.width).toBeLessThan(1280);
  });

  it("多开时，另一扇窗口里被拉成整窗的页面也会被拉回", () => {
    const browser = bare();
    const hole = { x: 0, y: 76, width: 680, height: 829 };
    armHole(browser, hole);
    const w2 = {
      isDestroyed: () => false,
      isMinimized: () => false,
      isMaximized: () => false,
      getContentSize: () => [1280, 905],
      contentView: { children: [] as unknown[], removeChildView() {}, addChildView() {} },
      webContents: { send() {}, isDestroyed: () => false },
    };
    browser.wins.set("w2", w2);
    browser.activeTabs.set("main", "a");
    browser.activeTabs.set("w2", "b");
    const host = browser as unknown as Record<string, unknown> & {
      withWin: (winId: string, fn: () => void) => void;
    };
    host.withWin("w2", () => {
      browser.holeBounds = hole;
      (browser as unknown as { sidebarW: number }).sidebarW = 340;
      (browser as unknown as { lastGoodContent: { width: number; height: number } }).lastGoodContent = {
        width: 1280,
        height: 905,
      };
    });
    const a = rectView(hole);
    const b = rectView({ x: 0, y: 0, width: 1400, height: 900 });
    browser.tabs = new Map([
      ["a", { id: "a", view: a.view, winId: "main" }],
      ["b", { id: "b", view: b.view, winId: "w2" }],
    ] as unknown as HoleBrowser["tabs"]);
    browser.assertChromeHole();
    expect(b.state).toMatchObject({ x: 0, y: 76, width: 940, height: 829 });
    expect(a.state).toMatchObject(hole);
    expect(browser.activeWinId).toBe("main");
  });
});
