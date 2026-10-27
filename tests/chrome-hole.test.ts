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
import { resetChromeCoverBudget, takeChromeCoverFix } from "../src/main/page-bounds.js";

type HoleBrowser = SparkBrowser & {
  tabs: Map<string, { id: string; view?: { getBounds: () => { x: number; y: number; width: number; height: number } }; discarded?: boolean }>;
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
  return Object.create(SparkBrowser.prototype) as HoleBrowser;
}

describe("常驻页面洞断言", () => {
  it("事件预算密集打满之后，2 秒内仍把整窗视图拉回", () => {
    vi.useFakeTimers();
    const browser = bare();
    const hole = { x: 0, y: 76, width: 900, height: 700 };
    const full = { x: 0, y: 0, width: 1400, height: 900 };
    browser.tabs = new Map([["t", { id: "t", view: { getBounds: () => full } }]]);
    browser.activeTabId = "t";
    browser.holeBounds = hole;
    browser.overlay = "none";
    browser.boundsGuard = false;
    browser.lastActiveBounds = null;
    browser.chromeHoleTimer = null;
    browser.window = {
      isDestroyed: () => false,
      isMinimized: () => false,
      isMaximized: () => false,
    };
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
