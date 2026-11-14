import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

import { SparkBrowser } from "../src/main/browser.js";
import { createEnv } from "../src/main/envs/store.js";
import { currentPageEnvLine, LIST_ENVS_DESCRIPTION, systemPrompt } from "../src/main/agent/free-soul.js";

describe("当前页账号环境", () => {
  it("系统提示写明沿用当前环境，禁止退回默认登录态", () => {
    const line = currentPageEnvLine("yi", "乙");
    const prompt = systemPrompt("https://baijiahao.baidu.com", "百家号", "step", {
      envId: "yi",
      envName: "乙",
    });
    expect(line).toContain("当前页在账号环境 乙（envId=yi）");
    expect(line).toContain("navigate / run_skill 默认带 envId=yi");
    expect(line).toContain("禁止回默认登录态");
    expect(prompt).toContain(line);
    expect(systemPrompt("https://example.com", "例", "step")).not.toContain("禁止回默认登录态");
  });

  it("名册带上 id，对不上或还剩多个环境时不替用户挑", () => {
    const prompt = systemPrompt(
      "https://baijiahao.baidu.com",
      "百家号",
      "step",
      { envId: "b2", envName: "百家号2" },
      [
        { id: "a", name: "accept-env" },
        { id: "b2", name: "百家号2" },
        { id: "b3", name: "百家号三" },
      ],
    );
    expect(prompt).toContain("本机账号环境：accept-env（id=a）、百家号2（id=b2）、百家号三（id=b3）。当前页在百家号2（id=b2）。");
    expect(prompt).toContain("「3」和「三」");
    expect(prompt).toContain("禁止硬挑最接近的");
    expect(prompt).toContain("禁止新建环境");
    expect(prompt).toContain("还剩两个或更多，列出名字问用户，不要自己挑");
    expect(prompt).toContain("除当前页环境外只剩一个，就用那一个，并且不要回默认登录态");
    expect(systemPrompt("https://example.com", "例", "step")).not.toContain("本机账号环境：");
    expect(LIST_ENVS_DESCRIPTION).toContain("还剩多个就列出名字问");
    expect(LIST_ENVS_DESCRIPTION).toContain("不要回默认登录态");
  });

  it("navigate 没传 envId 时沿用工具标签自己的环境，显式参数优先", async () => {
    const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & {
      tabs: Map<string, { id: string; envId?: string }>;
      activeTabId: string;
      sidebarOwnTab: boolean;
      fallbackAgentTabId: string;
      taskStore: () => undefined;
      createEnvTab: (envId: string, url?: string) => string;
      watchPageTool: () => Promise<{ ok: boolean; message: string }>;
      repair12306QueryOnce: () => Promise<void>;
      runAgentTool: () => Promise<{ ok: boolean; message: string }>;
      runCoreTool: (name: string, args: Record<string, unknown>) => Promise<{ ok: boolean; message: string }>;
    };
    const opened: string[] = [];
    browser.tabs = new Map([["t", { id: "t", envId: "env-yi" }]]);
    browser.activeTabId = "t";
    browser.sidebarOwnTab = false;
    browser.fallbackAgentTabId = "";
    browser.taskStore = () => undefined;
    browser.createEnvTab = (envId) => {
      opened.push(envId);
      return "env-tab";
    };
    browser.watchPageTool = async () => ({ ok: true, message: "opened" });
    browser.repair12306QueryOnce = async () => undefined;
    browser.runAgentTool = async () => ({ ok: true, message: "default-login" });

    const inherited = await browser.runCoreTool("navigate", { url: "https://baijiahao.baidu.com" });
    expect(inherited.ok).toBe(true);
    expect(opened).toEqual(["env-yi"]);

    const named = await browser.runCoreTool("navigate", {
      url: "https://baijiahao.baidu.com",
      envId: "env-jia",
    });
    expect(named.ok).toBe(true);
    expect(opened).toEqual(["env-yi", "env-jia"]);

    browser.tabs = new Map([["plain", { id: "plain" }]]);
    browser.activeTabId = "plain";
    opened.length = 0;
    const plain = await browser.runCoreTool("navigate", { url: "https://baijiahao.baidu.com" });
    expect(plain.message).toBe("default-login");
    expect(opened).toEqual([]);
  });

  it("有侧栏工位时，先读眼前这一页的环境，不先切到旧工位", async () => {
    const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & {
      tabs: Map<string, { id: string; envId?: string }>;
      activeTabId: string;
      sidebarOwnTab: boolean;
      fallbackAgentTabId: string;
      taskStore: () => undefined;
      ensureSidebarWorkTab: () => string;
      createEnvTab: (envId: string) => string;
      watchPageTool: () => Promise<{ ok: boolean; message: string }>;
      repair12306QueryOnce: () => Promise<void>;
      runCoreTool: (name: string, args: Record<string, unknown>) => Promise<{ ok: boolean; message: string }>;
    };
    let shown = 0;
    const opened: string[] = [];
    browser.tabs = new Map([
      ["user-page", { id: "user-page", envId: "env-yi" }],
      ["work", { id: "work" }],
    ]);
    browser.activeTabId = "user-page";
    browser.sidebarOwnTab = true;
    browser.fallbackAgentTabId = "";
    browser.taskStore = () => undefined;
    browser.ensureSidebarWorkTab = () => {
      shown += 1;
      browser.activeTabId = "work";
      return "work";
    };
    browser.createEnvTab = (envId) => {
      opened.push(envId);
      return "env-tab";
    };
    browser.watchPageTool = async () => ({ ok: true, message: "opened" });
    browser.repair12306QueryOnce = async () => undefined;

    const result = await browser.runCoreTool("navigate", { url: "https://baijiahao.baidu.com" });
    expect(result.ok).toBe(true);
    expect(shown).toBe(0);
    expect(opened).toEqual(["env-yi"]);
    expect(browser.activeTabId).toBe("user-page");
  });
});

describe("环境页切到眼前", () => {
  it("前台切到新环境页；后台车道和最小化不切", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sparo-env-show-"));
    try {
      const env = createEnv(dir, { account: { type: "other", name: "乙" } });
      const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & Record<string, unknown>;
      const realCreate = SparkBrowser.prototype.createEnvTab;
      const realSwitch = SparkBrowser.prototype.switchTab;
      const userActions: Array<boolean | undefined> = [];
      let switches = 0;
      let workShows = 0;
      let minimized = false;
      let lane = "";
      browser.tabs = new Map([
        ["old", { id: "old", url: "https://baijiahao.baidu.com", envId: env.id, winId: "main" }],
      ]);
      browser.activeTabId = "old";
      browser.activeWinId = "main";
      browser.sidebarOwnTab = true;
      browser.fallbackAgentTabId = "";
      browser.sidebarTabShownForTurn = false;
      browser.configDir = () => dir;
      browser.taskStore = () => (lane ? { lane, tabId: "" } : undefined);
      browser.windowIsMinimized = () => minimized;
      browser.focusActor = () => ({ clientId: "sidebar", winId: "main" });
      browser.ensureSidebarWorkTab = () => {
        workShows += 1;
        browser.activeTabId = "work";
        return "work";
      };
      browser.makePageView = () => ({
        webContents: {
          loadURL: async () => undefined,
          isDestroyed: () => true,
        },
      });
      browser.pinViewBeforeMount = () => undefined;
      browser.winOf = () => ({ contentView: { addChildView() {} } });
      browser.bindPageWebContents = () => undefined;
      browser.layout = () => undefined;
      browser.resetChromeCoverState = () => undefined;
      browser.wakeTab = () => undefined;
      browser.focusActivePage = () => undefined;
      browser.pushChromeState = () => undefined;
      browser.pushSidebarState = () => undefined;
      browser.requestHoleReport = () => undefined;
      browser.watchPageTool = async () => ({ ok: true, message: "opened" });
      browser.repair12306QueryOnce = async () => undefined;
      browser.createEnvTab = function (envId: string, url?: string, opts?: { userAction?: boolean }) {
        userActions.push(opts?.userAction);
        return realCreate.call(this, envId, url, opts);
      };
      browser.switchTab = function (id: string, opts?: { userAction?: boolean }) {
        switches += 1;
        return realSwitch.call(this, id, opts);
      };

      const opened = await browser.runCoreTool("navigate", { url: "https://baijiahao.baidu.com", envId: env.id });
      expect(opened.ok).toBe(true);
      expect(workShows).toBe(0);
      expect(switches).toBe(1);
      expect(userActions).toEqual([true]);
      expect(browser.activeTabId).not.toBe("old");
      expect(browser.tabs.get(browser.activeTabId)?.envId).toBe(env.id);
      expect(browser.sidebarTabShownForTurn).toBe(true);

      const foreground = String(browser.activeTabId);
      lane = "background";
      browser.activeTabId = "old";
      switches = 0;
      userActions.length = 0;
      const background = await browser.runCoreTool("navigate", {
        url: "https://baijiahao.baidu.com",
        envId: env.id,
      });
      expect(background.ok).toBe(true);
      expect(workShows).toBe(0);
      expect(switches).toBe(1);
      expect(userActions).toEqual([undefined]);
      expect(browser.activeTabId).toBe("old");
      expect(browser.activeTabId).not.toBe(foreground);

      lane = "";
      minimized = true;
      switches = 0;
      userActions.length = 0;
      const hidden = await browser.runCoreTool("navigate", {
        url: "https://baijiahao.baidu.com",
        envId: env.id,
      });
      expect(hidden.ok).toBe(true);
      expect(userActions).toEqual([undefined]);
      expect(browser.activeTabId).toBe("old");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
