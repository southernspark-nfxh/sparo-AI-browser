import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const cleared = vi.hoisted(() => [] as string[]);

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
  session: {
    defaultSession: {},
    fromPartition: (partition: string) => ({
      clearStorageData: async () => {
        cleared.push(partition);
      },
      clearCache: async () => undefined,
    }),
  },
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
import { createEnv, getEnv } from "../src/main/envs/store.js";

function makeBrowser(dir: string, tabs: Array<{ id: string; envId?: string }>, active: string) {
  const browser = Object.create(SparkBrowser.prototype) as SparkBrowser & Record<string, unknown>;
  browser.tabs = new Map(tabs.map((t) => [t.id, { ...t, winId: "main", url: "https://example.com" }]));
  browser.activeTabId = active;
  browser.activeWinId = "main";
  browser.readerTabId = null;
  browser.studioTabId = null;
  browser.configDir = () => dir;
  browser.wakeTab = () => undefined;
  browser.layout = () => undefined;
  browser.pushChromeState = () => undefined;
  browser.listTabs = () => ({ tabs: [], activeId: browser.activeTabId });
  return browser;
}

describe("删除环境即失效（决策点 #63）", () => {
  it("关掉环境标签、保留其他标签、删配置、清分区存储与目录", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sparo-env-del-"));
    try {
      const env = createEnv(dir, { account: { type: "other", name: "甲" } });
      const partDir = join(dir, "Partitions", `env_${env.id}`);
      mkdirSync(join(partDir, "Network"), { recursive: true });
      writeFileSync(join(partDir, "Network", "Cookies"), "cookie-bytes");
      const browser = makeBrowser(
        dir,
        [
          { id: "env-tab", envId: env.id },
          { id: "plain-tab" },
        ],
        "plain-tab",
      );

      const r = await browser.deleteEnvTool(env.id);
      expect(r.ok).toBe(true);
      expect(r.message).toContain("closed 1 env tabs");
      expect(browser.tabs.has("env-tab")).toBe(false);
      expect(browser.tabs.has("plain-tab")).toBe(true);
      expect(getEnv(dir, env.id)).toBeNull();
      expect(cleared).toContain(`persist:env_${env.id}`);
      expect(existsSync(partDir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("没有打开的环境标签时也清存储、删目录", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sparo-env-del-"));
    try {
      const env = createEnv(dir, { account: { type: "other", name: "乙" } });
      const partDir = join(dir, "Partitions", `env_${env.id}`);
      mkdirSync(partDir, { recursive: true });
      const browser = makeBrowser(dir, [{ id: "plain-tab" }], "plain-tab");

      const r = await browser.deleteEnvTool(env.id);
      expect(r.ok).toBe(true);
      expect(r.message).toContain("closed 0 env tabs");
      expect(browser.tabs.has("plain-tab")).toBe(true);
      expect(cleared).toContain(`persist:env_${env.id}`);
      expect(existsSync(partDir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("环境不存在时失败关闭，不动标签", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sparo-env-del-"));
    try {
      const browser = makeBrowser(dir, [{ id: "plain-tab" }], "plain-tab");
      const r = await browser.deleteEnvTool("nope");
      expect(r.ok).toBe(false);
      expect(browser.tabs.has("plain-tab")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
