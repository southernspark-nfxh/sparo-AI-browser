import {
  BrowserWindow,
  WebContentsView,
  Menu,
  dialog,
  app,
  ipcMain,
  nativeImage,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { randomBytes } from "node:crypto";
import type {
  ClickConfirm,
  FillConfirm,
  NavigateConfirm,
  PageSnapshot,
  ToolResult,
} from "../shared/types.js";
import { parseLocalIntent } from "./agent/stub.js";
import {
  DeepSeekAgentProvider,
  type AgentToolName,
} from "./agent/deepseek.js";
import {
  createSkillFromTrace,
  deleteSkill,
  listSkills,
  skillSummary,
  type Skill,
  type SkillStep,
} from "./skills/store.js";
import {
  loadSettings,
  saveSettings,
  settingsPublicView,
  type SparkSettings,
} from "./settings/store.js";
import {
  dxmGuideMessage,
  isDxmEditPage,
  listWorkflowSummaries,
  runWorkflow,
} from "./workflows/dianxiaomi.js";
import {
  QA_PROBE_SCRIPT,
  buildSmtQaReport,
  looksLikeSubmitAction,
  qaReportToToolResult,
  type QaReport,
} from "./qa/dianxiaomi-smt.js";
import {
  chromiumBookmarkPaths,
  loadSavedBookmarks,
  mergeBookmarks,
  readChromiumBookmarks,
  saveBookmarks,
  bookmarkCurrentPage,
  type BookmarkItem,
} from "./bookmarks/import-chromium.js";
import {
  CLICK_HITTEST_SCRIPT,
  DISMISS_OVERLAYS_SCRIPT,
  FILL_SCRIPT,
  FILL_SCRIPT_READ,
  FIND_FILE_INPUT_SCRIPT,
  FIND_OPTION_SCRIPT,
  FIND_TEXT_SCRIPT,
  FOCUS_SCRIPT,
  LIST_PORTALS_SCRIPT,
  PAGE_PROBE_SCRIPT,
  PAGE_TEXT_SCRIPT,
  RECORD_START_SCRIPT,
  RECORD_STOP_SCRIPT,
  SELECT_SCRIPT,
  SNAPSHOT_SCRIPT,
} from "./page-scripts.js";

function resolveAppIconPath(): string {
  const candidates = [
    // electron-vite main publicDir (resources/)
    join(__dirname, "../../resources/icon.ico"),
    join(__dirname, "../../resources/icon.png"),
    join(app.getAppPath(), "resources/icon.ico"),
    join(app.getAppPath(), "resources/icon.png"),
    join(process.resourcesPath || "", "icon.ico"),
    join(process.resourcesPath || "", "icon.png"),
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  return "";
}

function loadAppIcon(): Electron.NativeImage | undefined {
  const path = resolveAppIconPath();
  if (!path) return undefined;
  const img = nativeImage.createFromPath(path);
  return img.isEmpty() ? undefined : img;
}

const DEFAULT_URL = "https://www.google.com";
const CHROME_H = 104; // tabs 36 + omnibox 40 + bookmarks bar 28
const SIDEBAR_W = 300;

type TabInfo = {
  id: string;
  view: WebContentsView;
  title: string;
  url: string;
};

type ApprovalRequest = {
  id: string;
  action: string;
  reason: string;
  risk?: string;
  createdAt: string;
  resolve: (approved: boolean) => void;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUrl(url: string): string {
  let target = url.trim();
  if (!target) return DEFAULT_URL;
  if (!/^https?:\/\//i.test(target) && !target.startsWith("about:")) {
    target = `https://${target}`;
  }
  return target;
}

export class SparkBrowser {
  readonly window: BrowserWindow;
  /** @deprecated use active tab via pageView getter */
  private tabs = new Map<string, TabInfo>();
  private activeTabId = "";
  private shellReady = false;
  private lastSnapshot: PageSnapshot | null = null;
  private paused = false;
  private approvals = new Map<string, ApprovalRequest>();
  private lastQa: QaReport | null = null;
  private chatLog: Array<{ role: "user" | "assistant"; text: string }> = [];
  private ipcReady = false;
  private bookmarks: BookmarkItem[] = [];
  private recording = false;
  private recordingTask = "";
  private skillsCache: Skill[] = [];
  private settings!: SparkSettings;
  private deepseek: DeepSeekAgentProvider | null = null;

  /** Active page view — keeps existing tool code working. */
  private getActiveTab(): TabInfo | null {
    return this.tabs.get(this.activeTabId) ?? null;
  }

  private get pageView(): WebContentsView {
    const tab = this.getActiveTab();
    if (!tab) throw new Error("No active tab");
    return tab.view;
  }

  private configDir(): string {
    return (
      process.env.SPARO_CONFIG_DIR ||
      process.env.SPARK_CONFIG_DIR ||
      (process.platform === "win32" && process.env.APPDATA
        ? join(process.env.APPDATA, "sparo")
        : join(homedir(), ".config", "sparo"))
    );
  }

  constructor() {
    Menu.setApplicationMenu(null);
    const appIcon = loadAppIcon();
    this.window = new BrowserWindow({
      width: 1360,
      height: 900,
      title: "Sparo Agent Browser",
      backgroundColor: "#111111",
      show: false,
      autoHideMenuBar: true,
      ...(appIcon ? { icon: appIcon } : {}),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        // Sandboxed ESM preload often fails to expose contextBridge APIs.
        sandbox: false,
        preload: this.shellPreload(),
      },
    });
    this.window.setMenuBarVisibility(false);
    if (appIcon) {
      this.window.setIcon(appIcon);
    }

    this.bookmarks = loadSavedBookmarks(this.configDir());
    this.skillsCache = listSkills(this.configDir());
    this.settings = loadSettings(this.configDir());
    this.rebuildDeepSeek();
    this.window.on("resize", () => this.layout());
    this.window.once("ready-to-show", () => {
      this.layout();
      this.window.show();
      this.window.focus();
    });
    this.registerIpc();
    this.createTab(DEFAULT_URL, true);
  }

  private shellPreload(): string {
    const cjs = join(__dirname, "../preload/shell-preload.cjs");
    const mjs = join(__dirname, "../preload/shell-preload.mjs");
    return existsSync(cjs) ? cjs : mjs;
  }

  private pagePreload(): string {
    const cjs = join(__dirname, "../preload/preload.cjs");
    const mjs = join(__dirname, "../preload/preload.mjs");
    return existsSync(cjs) ? cjs : mjs;
  }

  /** Dev: Vite URL; prod: packaged renderer HTML (fallback to src). */
  private loadShell(): void {
    const file = "shell.html";
    const rendererUrl = process.env.ELECTRON_RENDERER_URL;
    if (rendererUrl) {
      void this.window.loadURL(`${rendererUrl.replace(/\/$/, "")}/${file}`);
      return;
    }
    const built = join(__dirname, `../renderer/${file}`);
    const src = join(__dirname, `../../src/renderer/${file}`);
    void this.window.loadFile(existsSync(built) ? built : src);
  }

  private navCanGoBack(wc: WebContents): boolean {
    const hist = (
      wc as WebContents & {
        navigationHistory?: { canGoBack: () => boolean };
      }
    ).navigationHistory;
    return hist ? hist.canGoBack() : wc.canGoBack();
  }

  private navCanGoForward(wc: WebContents): boolean {
    const hist = (
      wc as WebContents & {
        navigationHistory?: { canGoForward: () => boolean };
      }
    ).navigationHistory;
    return hist ? hist.canGoForward() : wc.canGoForward();
  }

  private createTab(url = DEFAULT_URL, activate = true): string {
    const id = randomBytes(4).toString("hex");
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: this.pagePreload(),
      },
    });
    const tab: TabInfo = { id, view, title: "新标签页", url };
    this.tabs.set(id, tab);
    // Activate before loadURL — navigation events may push chrome state immediately.
    if (activate) this.activeTabId = id;
    this.window.contentView.addChildView(view);

    const wc = view.webContents;
    wc.setWindowOpenHandler(({ url: openUrl }) => {
      this.createTab(openUrl, true);
      return { action: "deny" };
    });
    const sync = () => {
      tab.url = wc.getURL();
      tab.title = wc.getTitle() || tab.title;
      this.pushChromeState();
      this.pushSidebarState();
    };
    wc.on("page-title-updated", (_e, title) => {
      tab.title = title;
      this.pushChromeState();
    });
    wc.on("did-navigate", sync);
    wc.on("did-navigate-in-page", sync);
    wc.on("did-finish-load", sync);
    wc.on("did-start-loading", () => this.pushChromeState());

    void wc.loadURL(normalizeUrl(url));
    if (activate) this.switchTab(id);
    else this.layout();
    return id;
  }

  listTabs(): {
    tabs: Array<{ id: string; title: string; url: string }>;
    activeId: string;
    url: string;
    canGoBack: boolean;
    canGoForward: boolean;
  } {
    const active = this.tabs.get(this.activeTabId);
    const wc = active?.view.webContents;
    return {
      tabs: [...this.tabs.values()].map((t) => ({
        id: t.id,
        title: t.title,
        url: t.url || t.view.webContents.getURL(),
      })),
      activeId: this.activeTabId,
      url: wc?.getURL() || "",
      canGoBack: Boolean(wc && this.navCanGoBack(wc)),
      canGoForward: Boolean(wc && this.navCanGoForward(wc)),
    };
  }

  switchTab(id: string): ToolResult {
    if (!this.tabs.has(id)) return { ok: false, message: `Tab not found: ${id}` };
    this.activeTabId = id;
    this.lastSnapshot = null;
    this.layout();
    this.focusActivePage();
    this.pushChromeState();
    this.pushSidebarState();
    return { ok: true, message: `Switched to tab ${id}`, data: this.listTabs() };
  }

  newTab(url?: string): ToolResult {
    const id = this.createTab(url || DEFAULT_URL, true);
    return { ok: true, message: `Opened tab ${id}`, data: { id, ...this.listTabs() } };
  }

  closeTab(id: string): ToolResult {
    if (this.tabs.size <= 1) {
      return { ok: false, message: "Cannot close the last tab" };
    }
    const tab = this.tabs.get(id);
    if (!tab) return { ok: false, message: `Tab not found: ${id}` };
    this.window.contentView.removeChildView(tab.view);
    try {
      (tab.view.webContents as WebContents).close();
    } catch {
      /* ignore */
    }
    this.tabs.delete(id);
    if (this.activeTabId === id) {
      const next = [...this.tabs.keys()][0];
      this.activeTabId = next;
    }
    this.layout();
    this.pushChromeState();
    return { ok: true, message: `Closed tab ${id}`, data: this.listTabs() };
  }

  private layout(): void {
    const [width, height] = this.window.getContentSize();
    const pageW = Math.max(100, width - SIDEBAR_W);
    const pageH = Math.max(100, height - CHROME_H);
    const bounds = { x: 0, y: CHROME_H, width: pageW, height: pageH };

    for (const [id, tab] of this.tabs) {
      const active = id === this.activeTabId;
      tab.view.setVisible(active);
      // Only cover the center hole — shell chrome/sidebar are the BrowserWindow itself.
      tab.view.setBounds(bounds);
    }
  }

  private focusActivePage(): void {
    try {
      const tab = this.getActiveTab();
      if (!tab || tab.view.webContents.isDestroyed()) return;
      tab.view.webContents.focus();
    } catch {
      /* ignore */
    }
  }

  /** Load unified shell (address bar + sidebar) as the window page. */
  attachShell(): void {
    if (this.shellReady) return;
    this.shellReady = true;
    this.window.webContents.on("console-message", (_e, _level, message) => {
      console.log(`[shell-console] ${message}`);
    });
    this.window.webContents.on("did-finish-load", () => {
      this.pushChromeState();
      this.pushSidebarState();
      this.layout();
      void this.window.webContents
        .executeJavaScript(
          `typeof window.sparkShell === 'object' ? Object.keys(window.sparkShell) : typeof window.sparkShell`,
        )
        .then((keys) => console.log("[shell] sparkShell:", keys))
        .catch((err) => console.error("[shell] sparkShell probe failed:", err));
    });
    console.log("[shell] preload:", this.shellPreload());
    this.loadShell();
    this.layout();
  }

  /** @deprecated use attachShell */
  attachChrome(): void {
    this.attachShell();
  }

  /** @deprecated use attachShell */
  attachSidebar(): void {
    this.attachShell();
  }

  private registerIpc(): void {
    if (this.ipcReady) return;
    this.ipcReady = true;
    const handle = (channel: string, listener: (...args: any[]) => any) => {
      try {
        ipcMain.removeHandler(channel);
      } catch {
        /* ignore */
      }
      ipcMain.handle(channel, listener);
    };
    handle("spark:navigate", async (_e, url: string) =>
      this.navigate(String(url || ""), { asHuman: true }),
    );
    handle("spark:go-back", async () => this.goBack({ asHuman: true }));
    handle("spark:go-forward", async () => this.goForward({ asHuman: true }));
    handle("spark:reload", async () => this.reload({ asHuman: true }));
    handle("spark:new-tab", async (_e, url?: string) => this.newTab(url));
    handle("spark:close-tab", async (_e, id: string) => this.closeTab(String(id)));
    handle("spark:switch-tab", async (_e, id: string) => this.switchTab(String(id)));
    handle("spark:list-tabs", async () => this.listTabs());
    handle("spark:set-paused", async (_e, paused: boolean) => {
      this.setPaused(Boolean(paused));
      return { ok: true, paused: this.paused };
    });
    handle("spark:get-status", async () => this.getSidebarPayload());
    handle("spark:resolve-approval", async (_e, id: string, approved: boolean) =>
      this.resolveApproval(String(id), Boolean(approved)),
    );
    handle("spark:qa-check", async () => this.qaCheck());
    handle("spark:chat", async (_e, text: string) => this.handleChat(String(text || "")));
    handle("spark:get-settings", async () => ({
      ok: true,
      settings: settingsPublicView(this.settings),
    }));
    handle("spark:save-settings", async (_e, patch: Partial<SparkSettings>) => {
      this.settings = saveSettings(this.configDir(), patch || {});
      this.rebuildDeepSeek();
      this.pushSidebarState();
      return {
        ok: true,
        message: this.settings.deepseekApiKey
          ? "DeepSeek 已配置"
          : "已保存（未设置 API Key）",
        settings: settingsPublicView(this.settings),
      };
    });
    handle("spark:start-recording", async (_e, task?: string) =>
      this.startRecording({ task: task ? String(task) : undefined }),
    );
    handle("spark:stop-recording", async (_e, title?: string) =>
      this.stopRecording(title ? String(title) : undefined),
    );
    handle("spark:list-skills", async () => ({
      ok: true,
      skills: this.skillsCache.map(skillSummary),
      recording: this.recording,
    }));
    handle("spark:delete-skill", async (_e, id: string) => {
      const ok = deleteSkill(this.configDir(), String(id));
      this.skillsCache = listSkills(this.configDir());
      this.pushSidebarState();
      return { ok, message: ok ? `已删除妙招 ${id}` : `未找到 ${id}` };
    });
    handle("spark:bookmark-sources", async () => ({
      ok: true,
      sources: chromiumBookmarkPaths(),
      count: this.bookmarks.length,
    }));
    handle("spark:import-bookmarks", async (_e, source: string) =>
      this.importBookmarks(source === "edge" ? "edge" : "chrome"),
    );
    handle("spark:list-bookmarks", async () => this.chromeBookmarkState());
    handle("spark:open-bookmark", async (_e, url: string) => {
      await this.navigate(String(url || ""), { asHuman: true });
      return { ok: true, message: `Opened ${url}` };
    });
    handle("spark:toggle-bookmark", async () => this.toggleCurrentBookmark());
    handle("spark:bookmarks-menu", async (_e, payload?: { overflowUrls?: string[] }) => {
      this.popupBookmarksMenu(payload?.overflowUrls);
      return { ok: true };
    });
    handle("spark:clear-bookmarks", async () => {
      this.bookmarks = [];
      saveBookmarks(this.configDir(), this.bookmarks);
      this.pushChromeState();
      return { ok: true, message: "已清空书签" };
    });
  }

  /** Native popup — stays above WebContentsView (HTML dropdown was covered by the page). */
  popupBookmarksMenu(overflowUrls?: string[]): void {
    const state = this.chromeBookmarkState();
    const onBar = this.bookmarks.filter((b) => b.bar);
    const overflowSet = new Set(overflowUrls || []);
    const overflowList =
      overflowSet.size > 0
        ? onBar.filter((b) => overflowSet.has(b.url))
        : onBar;

    const bookmarkItems: MenuItemConstructorOptions[] = overflowList.map((b) => ({
      label: (b.title || b.url).slice(0, 80),
      click: () => {
        void this.navigate(b.url, { asHuman: true });
      },
    }));

    const template: MenuItemConstructorOptions[] = [
      {
        label: state.currentBookmarked ? "取消收藏当前页" : "收藏当前页面",
        click: () => {
          const r = this.toggleCurrentBookmark();
          this.window.webContents
            .executeJavaScript(
              `window.__sparkToast && window.__sparkToast(${JSON.stringify(r.message)})`,
            )
            .catch(() => undefined);
        },
      },
      { type: "separator" },
      {
        label: "从 Chrome 导入书签…",
        enabled: state.canImportChrome,
        click: () => {
          void this.importBookmarks("chrome").then((r) => {
            this.window.webContents
              .executeJavaScript(
                `window.__sparkToast && window.__sparkToast(${JSON.stringify(r.message)})`,
              )
              .catch(() => undefined);
          });
        },
      },
      {
        label: "从 Edge 导入书签…",
        enabled: state.canImportEdge,
        click: () => {
          void this.importBookmarks("edge").then((r) => {
            this.window.webContents
              .executeJavaScript(
                `window.__sparkToast && window.__sparkToast(${JSON.stringify(r.message)})`,
              )
              .catch(() => undefined);
          });
        },
      },
    ];

    if (bookmarkItems.length) {
      template.push({ type: "separator" });
      // Flat list so every overflow bookmark is one click away (no nested submenu truncation).
      if (bookmarkItems.length <= 35) {
        template.push({ label: `未显示的书签（${bookmarkItems.length}）`, enabled: false });
        template.push(...bookmarkItems);
      } else {
        // Split into chunks of 30 as submenus so Windows menu height stays usable.
        const chunk = 30;
        for (let i = 0; i < bookmarkItems.length; i += chunk) {
          const part = bookmarkItems.slice(i, i + chunk);
          template.push({
            label: `书签 ${i + 1}–${i + part.length}`,
            submenu: part,
          });
        }
      }
    }

    template.push(
      { type: "separator" },
      {
        label: "清空书签",
        enabled: state.total > 0,
        click: () => {
          this.bookmarks = [];
          saveBookmarks(this.configDir(), this.bookmarks);
          this.pushChromeState();
          this.window.webContents
            .executeJavaScript(
              `window.__sparkToast && window.__sparkToast("已清空书签")`,
            )
            .catch(() => undefined);
        },
      },
    );

    Menu.buildFromTemplate(template).popup({ window: this.window });
  }

  private chromeBookmarkState() {
    const url = this.getUrl();
    const onBar = this.bookmarks.filter((b) => b.bar);
    const sources = chromiumBookmarkPaths();
    return {
      /** All bookmarks eligible for the bar — renderer packs by available width. */
      barAll: onBar,
      total: this.bookmarks.length,
      barTotal: onBar.length,
      currentBookmarked: this.bookmarks.some((b) => b.url === url),
      sources,
      canImportChrome: Boolean(sources.find((s) => s.id === "chrome")?.exists),
      canImportEdge: Boolean(sources.find((s) => s.id === "edge")?.exists),
    };
  }

  private pushChromeState(): void {
    if (this.window.isDestroyed() || this.window.webContents.isDestroyed()) return;
    try {
      this.window.webContents.send("spark:chrome-state", {
        ...this.listTabs(),
        ...this.chromeBookmarkState(),
      });
    } catch (error) {
      console.error("[shell] pushChromeState failed:", error);
    }
  }

  private pushSidebarState(): void {
    if (this.window.isDestroyed() || this.window.webContents.isDestroyed()) return;
    try {
      this.window.webContents.send("spark:sidebar-state", this.getSidebarPayload());
    } catch (error) {
      console.error("[shell] pushSidebarState failed:", error);
    }
  }

  private getSidebarPayload() {
    return {
      paused: this.paused,
      recording: this.recording,
      recordingTask: this.recordingTask,
      url: this.getUrl(),
      title: this.getTitle(),
      approvals: [...this.approvals.values()].map((a) => ({
        id: a.id,
        action: a.action,
        reason: a.reason,
        risk: a.risk,
        createdAt: a.createdAt,
      })),
      qa: this.lastQa,
      chat: this.chatLog.slice(-40),
      skills: this.skillsCache.map(skillSummary).slice(0, 30),
      deepseek: settingsPublicView(this.settings),
      explain: {
        pause: "暂停：Agent 立刻停手，人可自由操作页面",
        approval: "审批：Agent 请求做人确认后才继续（如提交）",
        wait: "等待 wait_for：Agent 等页面元素出现，不是等人",
        skill: "妙招：录制成功操作并沉淀；对话说「开始录制 / 结束录制并保存为某某」",
        workflow:
          "Agent-First：说「登录店小蜜」会打开后台；编辑页说「处理好」全自动，做完暂停等你审",
      },
    };
  }

  async importBookmarks(source: "chrome" | "edge"): Promise<ToolResult> {
    const label = source === "chrome" ? "Chrome" : "Edge";
    try {
      const sources = chromiumBookmarkPaths();
      const found = sources.find((s) => s.id === source);
      if (!found?.exists) {
        return { ok: false, message: `未检测到本机 ${label} 书签文件` };
      }

      const prompt = await dialog.showMessageBox(this.window, {
        type: "question",
        buttons: ["取消", "导入"],
        defaultId: 1,
        cancelId: 0,
        title: "导入书签",
        message: `从 ${label} 导入书签？`,
        detail:
          "只会加入 Sparo 的书签，不会自动打开网页。\n书签栏会按宽度尽量多显示，其余在「更多」里。",
      });
      if (prompt.response !== 1) {
        return { ok: false, message: "已取消导入" };
      }

      const result = readChromiumBookmarks(source);
      if (!result.ok) {
        return { ok: false, message: result.message };
      }
      if (!result.items.length) {
        return { ok: false, message: `${label} 里没有可导入的书签` };
      }

      // Replace with this import (explicit user action), pin bookmark-bar items.
      const incoming = result.items.map((b) => ({
        ...b,
        bar: b.bar || /书签栏|收藏夹栏/i.test(b.folder),
      }));
      // If nothing marked for bar, put all on bar and let the UI pack by width.
      if (!incoming.some((b) => b.bar)) {
        for (const b of incoming) b.bar = true;
      }
      this.bookmarks = incoming;
      saveBookmarks(this.configDir(), this.bookmarks);
      this.pushChromeState();
      const onBar = this.bookmarks.filter((b) => b.bar).length;
      return {
        ok: true,
        message: `已从 ${label} 导入 ${result.items.length} 个（书签栏候选 ${onBar} 个，按宽度显示）`,
        data: this.chromeBookmarkState(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[bookmarks] import failed:", error);
      return { ok: false, message: `导入失败：${message}` };
    }
  }

  toggleCurrentBookmark(): ToolResult {
    const url = this.getUrl();
    const title = this.getTitle();
    if (!url || url === "about:blank") {
      return { ok: false, message: "请先打开一个网页再收藏" };
    }
    const before = this.bookmarks.some((b) => b.url === url);
    this.bookmarks = bookmarkCurrentPage(this.bookmarks, title, url);
    saveBookmarks(this.configDir(), this.bookmarks);
    this.pushChromeState();
    return {
      ok: true,
      message: before ? "已取消收藏" : "已加入书签栏",
      data: this.chromeBookmarkState(),
    };
  }

  getWebContents(): WebContents {
    return this.pageView.webContents;
  }

  isPaused(): boolean {
    return this.paused;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.pushSidebarState();
    this.pushChromeState();
  }

  private pushStatus(): void {
    this.pushSidebarState();
    this.pushChromeState();
  }

  private assertNotPaused(): ToolResult | null {
    if (!this.paused) return null;
    return { ok: false, message: "Agent is paused. Human has taken over." };
  }

  async requestApproval(input: {
    action: string;
    reason: string;
    risk?: string;
  }): Promise<ToolResult> {
    const blocked = this.assertNotPaused();
    if (blocked) return blocked;
    const id = randomBytes(6).toString("hex");
    const approved = await new Promise<boolean>((resolve) => {
      this.approvals.set(id, {
        id,
        action: input.action,
        reason: input.reason,
        risk: input.risk,
        createdAt: new Date().toISOString(),
        resolve,
      });
      this.pushSidebarState();
    });
    this.approvals.delete(id);
    this.pushSidebarState();
    return {
      ok: approved,
      message: approved ? `Approved: ${input.action}` : `Rejected: ${input.action}`,
      data: { id, approved, action: input.action },
    };
  }

  resolveApproval(id: string, approved: boolean): ToolResult {
    const req = this.approvals.get(id);
    if (!req) return { ok: false, message: `Approval not found: ${id}` };
    req.resolve(approved);
    return { ok: true, message: approved ? "approved" : "rejected", data: { id, approved } };
  }

  async waitFor(input: {
    selector?: string;
    text?: string;
    ref?: string;
    timeoutMs?: number;
  }): Promise<ToolResult> {
    const blocked = this.assertNotPaused();
    if (blocked) return blocked;
    const timeoutMs = input.timeoutMs ?? 15_000;
    const started = Date.now();
    const wc = this.pageView.webContents;
    while (Date.now() - started < timeoutMs) {
      const hit = (await wc.executeJavaScript(
        `(() => {
          const ref = ${JSON.stringify(input.ref ?? null)};
          const selector = ${JSON.stringify(input.selector ?? null)};
          const text = ${JSON.stringify(input.text ?? null)};
          let el = null;
          if (ref) el = document.querySelector('[data-spark-ref="' + CSS.escape(ref) + '"]');
          if (!el && selector) { try { el = document.querySelector(selector); } catch (_) {} }
          if (!el && text) {
            el = Array.from(document.querySelectorAll('a,button,span,div,input,label,li')).find((n) => {
              const t = (n.innerText || n.textContent || '').trim();
              const r = n.getBoundingClientRect();
              return t.includes(text) && r.width > 0 && r.height > 0;
            }) || null;
          }
          if (!el) return { ok: false };
          const r = el.getBoundingClientRect();
          return { ok: r.width > 0 && r.height > 0, tag: el.tagName, text: (el.innerText||'').trim().slice(0,60) };
        })()`,
        true,
      )) as { ok: boolean; tag?: string; text?: string };
      if (hit?.ok) {
        return {
          ok: true,
          message: `wait_for ok after ${Date.now() - started}ms`,
          data: { ...hit, waitedMs: Date.now() - started },
        };
      }
      await sleep(200);
    }
    return {
      ok: false,
      message: `wait_for timeout after ${timeoutMs}ms`,
      data: input,
    };
  }

  async qaCheck(): Promise<ToolResult> {
    try {
      const probe = (await this.pageView.webContents.executeJavaScript(
        QA_PROBE_SCRIPT,
        true,
      )) as Record<string, unknown>;
      const report = buildSmtQaReport({
        url: String(probe.url || this.getUrl()),
        title: String(probe.title || this.getTitle()),
        ...probe,
      });
      this.lastQa = report;
      this.pushSidebarState();
      return qaReportToToolResult(report);
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async qaGate(): Promise<ToolResult> {
    const report = await this.qaCheck();
    if (!report.ok) {
      return {
        ok: false,
        message: `QA gate blocked submit: ${report.message}`,
        data: report.data,
      };
    }
    return {
      ok: true,
      message: "QA gate passed",
      data: report.data,
    };
  }

  private rebuildDeepSeek(): void {
    if (!this.settings.deepseekApiKey) {
      this.deepseek = null;
      return;
    }
    const cfg = {
      apiKey: this.settings.deepseekApiKey,
      baseUrl: this.settings.deepseekBaseUrl || "https://api.deepseek.com",
      model: this.settings.deepseekModel || "deepseek-v4-flash",
    };
    if (this.deepseek) {
      this.deepseek.updateConfig(cfg);
    } else {
      this.deepseek = new DeepSeekAgentProvider(cfg, (name, args) =>
        this.runAgentTool(name, args),
      );
    }
  }

  private async runAgentTool(
    name: AgentToolName,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    switch (name) {
      case "navigate":
        return this.navigate(String(args.url || ""), { asHuman: true });
      case "get_url":
        return { ok: true, message: this.getUrl(), data: { url: this.getUrl() } };
      case "get_title":
        return {
          ok: true,
          message: this.getTitle(),
          data: { title: this.getTitle() },
        };
      case "snapshot":
        return this.snapshot(
          args.selector ? String(args.selector) : undefined,
        );
      case "click":
        return this.click({
          selector: args.selector ? String(args.selector) : undefined,
          ref: args.ref ? String(args.ref) : undefined,
        });
      case "fill":
        return this.fill(
          {
            selector: args.selector ? String(args.selector) : undefined,
            ref: args.ref ? String(args.ref) : undefined,
          },
          String(args.value ?? ""),
        );
      case "qa_check":
        return this.qaCheck();
      case "click_text":
        return this.clickText(String(args.text || ""), {
          withinPortal: Boolean(args.withinPortal),
          caret: Boolean(args.caret),
        });
      case "menu_click":
        return this.menuClick(String(args.trigger || ""), String(args.item || ""));
      case "dismiss_overlays":
        return this.dismissOverlays();
      case "list_workflows":
        return {
          ok: true,
          message: `workflows: ${listWorkflowSummaries().length}`,
          data: { workflows: listWorkflowSummaries() },
        };
      case "run_workflow":
        return runWorkflow(this, String(args.id || ""));
      case "pause":
        this.setPaused(true);
        return { ok: true, message: "Agent paused" };
      case "resume":
        this.setPaused(false);
        return { ok: true, message: "Agent resumed" };
      case "start_recording":
        return this.startRecording({
          task: args.task ? String(args.task) : undefined,
        });
      case "stop_recording":
        return this.stopRecording(args.title ? String(args.title) : undefined);
      case "list_skills":
        return this.listSkillsTool();
      default:
        return { ok: false, message: `unsupported tool: ${name}` };
    }
  }

  listSkillsTool(): ToolResult {
    this.skillsCache = listSkills(this.configDir());
    return {
      ok: true,
      message: `skills: ${this.skillsCache.length}`,
      data: {
        skills: this.skillsCache.map(skillSummary),
        recording: this.recording,
      },
    };
  }

  /** Fill 店小蜜 / SMT product title on edit page. */
  async setDxmProductTitle(title: string): Promise<ToolResult> {
    const url = this.getUrl();
    if (!isDxmEditPage(url)) {
      return {
        ok: false,
        message:
          `当前不在商品编辑页（${url}）。请打开速卖通或采集箱编辑页，再说「改标题为 ${title}」。`,
      };
    }
    const value = title.trim();
    if (!value) return { ok: false, message: "标题不能为空" };
    if (/^(中文|汉语|英文|英语|Chinese|English)$/i.test(value)) {
      return this.translateDxmTitle(/英|English/i.test(value) ? "en" : "zh");
    }

    try {
      const marked = await this.execute(`(() => {
        const candidates = Array.from(document.querySelectorAll('input,textarea'));
        const el = candidates.find((node) => {
          const ph = ((node.getAttribute('placeholder') || '') + (node.getAttribute('aria-label') || '')).trim();
          const name = (node.getAttribute('name') || '') + (node.className || '');
          const r = node.getBoundingClientRect();
          if (r.width < 80 || r.height < 10) return false;
          return /标题|Title|subject/i.test(ph + name) || (ph.includes('请输入') && r.width > 300);
        }) || candidates.find((node) => {
          const r = node.getBoundingClientRect();
          return node.tagName === 'INPUT' && r.width > 400 && r.top > 80 && r.top < 400;
        });
        if (!el) return { ok: false };
        el.setAttribute('data-spark-ref', 'dxm-title');
        el.focus();
        return { ok: true, before: String(el.value || '').slice(0, 80) };
      })()`);
      const okMark = (marked.data?.result as { ok?: boolean } | undefined)?.ok;
      if (!okMark) {
        return { ok: false, message: "未找到标题输入框，请确认在产品信息编辑区" };
      }
      const filled = await this.fill({ ref: "dxm-title" }, value);
      if (!filled.ok) return filled;
      return { ok: true, message: `标题已改为：${value}` };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 「改标题为英文/中文」= 翻译语言，不是把标题写成「英文」两个字。
   * 英文：点页面「一键翻译」；中文：提示用真实文案或说明平台通常无一键回译。
   */
  async translateDxmTitle(lang: "zh" | "en"): Promise<ToolResult> {
    const url = this.getUrl();
    if (!isDxmEditPage(url)) {
      return {
        ok: false,
        message: `当前不在商品编辑页（${url}）。请先打开采集/速卖通编辑页。`,
      };
    }

    if (lang === "zh") {
      return {
        ok: false,
        message:
          "「改标题为中文」是指把标题翻译成中文，不是把标题改成「中文」两个字。\n" +
          "采集页通常用「一键翻译」把中文译成英文。若要改成具体中文文案，请说：改标题为 你的完整标题",
      };
    }

    // lang === en → click 一键翻译
    const clicked = await this.clickText("一键翻译");
    if (!clicked.ok) {
      const alt = await this.execute(`(() => {
        const btn = Array.from(document.querySelectorAll('button,a,span')).find(el => {
          const t = (el.innerText || '').trim();
          const r = el.getBoundingClientRect();
          return t === '一键翻译' && r.width > 20 && r.height > 10;
        });
        if (!btn) return { ok: false };
        btn.click();
        return { ok: true };
      })()`);
      if (!(alt.data?.result as { ok?: boolean } | undefined)?.ok) {
        return {
          ok: false,
          message: "未找到「一键翻译」按钮。也可说：改标题为 你的英文完整标题",
        };
      }
    }
    return {
      ok: true,
      message:
        "已点击「一键翻译」（标题等字段会按店小蜜规则译成英文）。请稍等页面刷新；若弹窗确认请点确定。",
    };
  }

  async handleChat(text: string): Promise<ToolResult> {
    this.chatLog.push({ role: "user", text });
    this.pushSidebarState();
    const action = parseLocalIntent(text);
    let reply = "";
    if (action.type === "reply") {
      reply = action.text;
    } else if (action.type === "pause") {
      this.setPaused(action.paused);
      reply = action.paused ? "已暂停，人可接管。" : "已恢复 Agent 操控。";
    } else if (action.type === "navigate") {
      const nav = await this.navigate(action.url, { asHuman: true });
      if (!nav.ok) {
        reply = nav.message;
      } else if (action.after === "dxm_arrived") {
        reply = "已打开店小蜜。若未登录请先登录；然后点开商品编辑页，说「处理好这个商品」。";
      } else if (action.after === "dxm_crawl") {
        reply = "已打开采集箱。点进商品编辑页后说「处理好」或「继续」。";
      } else {
        reply = nav.message;
      }
    } else if (action.type === "dxm_guide") {
      reply = dxmGuideMessage(this.getUrl(), action.mode);
    } else if (action.type === "set_title") {
      reply = (await this.setDxmProductTitle(action.title)).message;
    } else if (action.type === "translate_title") {
      reply = (await this.translateDxmTitle(action.lang)).message;
    } else if (action.type === "qa") {
      const qa = await this.qaCheck();
      reply = qa.message;
    } else if (action.type === "workflow") {
      const label =
        action.id === "dxm_autopilot" ? "Autopilot（全自动，完成后暂停等你审）" : action.id;
      this.chatLog.push({
        role: "assistant",
        text: `正在执行「${label}」…`,
      });
      this.pushSidebarState();
      const r = await runWorkflow(this, action.id);
      reply = r.message;
      this.pushSidebarState(); // reflect pause after autopilot
    } else if (action.type === "record_start") {
      const r = await this.startRecording({ task: action.task });
      reply = r.ok
        ? `开始录制${action.task ? `「${action.task}」` : ""}。请在页面上操作，完成后说「结束录制并保存为某某」。`
        : `无法开始录制：${r.message}`;
    } else if (action.type === "record_stop") {
      const r = await this.stopRecording(action.title);
      reply = r.message;
    } else if (action.type === "list_skills") {
      this.skillsCache = listSkills(this.configDir());
      if (!this.skillsCache.length) {
        reply = "还没有妙招。可以说「开始录制」演示一遍，再「结束录制并保存为改尺寸」。";
      } else {
        reply =
          `已有 ${this.skillsCache.length} 个妙招：\n` +
          this.skillsCache
            .slice(0, 12)
            .map((s, i) => `${i + 1}. ${s.title}（${s.stepCount} 步）`)
            .join("\n");
      }
    } else if (action.type === "run") {
      const map =
        action.script === "dxm-resize"
          ? "dxm_resize_800"
          : action.script === "dxm-translate"
            ? "dxm_translate_zh_en"
            : "";
      if (map) {
        const r = await runWorkflow(this, map);
        reply = r.message;
      } else {
        reply = `未知脚本 ${action.script}`;
      }
    } else if (action.type === "llm") {
      if (!this.deepseek) {
        reply =
          "未配置 DeepSeek API Key。请在侧栏「DeepSeek」保存 Key（platform.deepseek.com），" +
          "或设置环境变量 DEEPSEEK_API_KEY。\n" +
          dxmGuideMessage(this.getUrl(), "help");
      } else {
        try {
          const url = this.getUrl();
          const dxmCtx =
            /店小[蜜秘]|dianxiaomi|速卖通|改标题|改尺寸|图片翻译/i.test(action.text) ||
            /dianxiaomi\.com/i.test(url);
          const prompt = dxmCtx
            ? `【执行优先】当前 URL：${url}\n动手，不要讲功能清单。要登录/打开店小蜜就 navigate 到 https://www.dianxiaomi.com/web/home；要上品/上架/处理好且在编辑页就 run_workflow(dxm_full_listing)；不在编辑页就 navigate 到 https://www.dianxiaomi.com/web/productCrawl 并短说一句让用户点进编辑页。\n用户说：${action.text}`
            : action.text;
          reply = await this.deepseek.chat(prompt, {
            url,
            title: this.getTitle(),
          });
        } catch (error) {
          reply =
            "DeepSeek 调用失败：" +
            (error instanceof Error ? error.message : String(error));
        }
      }
    } else {
      reply = "未识别指令。";
    }
    this.chatLog.push({ role: "assistant", text: reply });
    this.pushSidebarState();
    return { ok: true, message: reply, data: { action, chat: this.chatLog.slice(-20) } };
  }

  private async probe(): Promise<{ url: string; title: string; bodyLen: number }> {
    const wc = this.pageView.webContents;
    try {
      const fromPage = (await wc.executeJavaScript(PAGE_PROBE_SCRIPT, true)) as {
        url: string;
        title: string;
        bodyLen: number;
      };
      return {
        url: fromPage.url || wc.getURL(),
        title: fromPage.title || wc.getTitle(),
        bodyLen: fromPage.bodyLen ?? 0,
      };
    } catch {
      return { url: wc.getURL(), title: wc.getTitle(), bodyLen: 0 };
    }
  }

  /** Read visible page text for hard verification (e.g. Weibo timeline). */
  async pageText(): Promise<ToolResult & { data?: { text: string; length: number } }> {
    try {
      const data = (await this.pageView.webContents.executeJavaScript(
        PAGE_TEXT_SCRIPT,
        true,
      )) as { text: string; length: number };
      return {
        ok: true,
        message: `page_text ${data.length} chars`,
        data,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * P0: run arbitrary JS in the page, always return JSON-serializable result.
   * Use for CKEditor APIs, React internals, modal probing, etc.
   */
  async execute(
    script: string,
  ): Promise<ToolResult & { data?: { result: unknown; error?: string } }> {
    const blocked = this.assertNotPaused();
    if (blocked) {
      return blocked as ToolResult & {
        data?: { result: unknown; error?: string };
      };
    }
    if (!script || !script.trim()) {
      return { ok: false, message: "execute requires a non-empty script" };
    }

    try {
      const wrapped = `(() => {
        try {
          const __r = (0, eval)(${JSON.stringify(script)});
          let safe;
          try {
            safe = JSON.parse(JSON.stringify(__r === undefined ? null : __r));
          } catch (_) {
            safe = String(__r);
          }
          return { ok: true, result: safe };
        } catch (e) {
          return {
            ok: false,
            result: null,
            error: String(e && e.message ? e.message : e),
          };
        }
      })()`;
      const data = (await this.pageView.webContents.executeJavaScript(
        wrapped,
        true,
      )) as { ok: boolean; result: unknown; error?: string };
      return {
        ok: data.ok,
        message: data.ok
          ? "execute ok"
          : `execute failed: ${data.error || "unknown"}`,
        data: { result: data.result, error: data.error },
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * P1: select native <select> or combobox option by visible text/value.
   */
  async select(
    target: { ref?: string; selector?: string },
    value: string,
  ): Promise<ToolResult> {
    const blocked = this.assertNotPaused();
    if (blocked) return blocked;
    if (!target.ref && !target.selector) {
      return { ok: false, message: "select requires ref or selector" };
    }
    if (!value) {
      return { ok: false, message: "select requires value" };
    }

    try {
      const wc = this.pageView.webContents;
      const opened = (await wc.executeJavaScript(
        `(${SELECT_SCRIPT})(${JSON.stringify(target.ref ?? null)}, ${JSON.stringify(target.selector ?? null)}, ${JSON.stringify(value)})`,
        true,
      )) as {
        ok: boolean;
        matched?: boolean;
        message?: string;
        method?: string;
        actual?: string;
        label?: string;
        needsOptionClick?: boolean;
        openPoint?: { x: number; y: number };
        options?: string[];
        candidates?: string[];
      };

      if (!opened.ok) {
        return { ok: false, message: opened.message || "select failed", data: opened };
      }

      // Native <select> done in-page
      if (opened.matched && opened.method === "native-select") {
        this.pushStatus();
        return {
          ok: true,
          message: opened.message || `Selected ${opened.label || value}`,
          data: opened,
        };
      }

      // Combobox: trusted click to open, then find + click option
      if (opened.openPoint) {
        await this.trustedClickAt(opened.openPoint.x, opened.openPoint.y);
        await sleep(350);
      }

      const opt = (await wc.executeJavaScript(
        `(${FIND_OPTION_SCRIPT})(${JSON.stringify(value)})`,
        true,
      )) as {
        ok: boolean;
        message?: string;
        label?: string;
        x?: number;
        y?: number;
        candidates?: string[];
      };

      if (!opt.ok || opt.x == null || opt.y == null) {
        return {
          ok: false,
          message: opt.message || "Option not found after opening combobox",
          data: opt,
        };
      }

      await this.trustedClickAt(opt.x, opt.y);
      await sleep(200);
      this.lastSnapshot = null;
      this.pushStatus();
      return {
        ok: true,
        message: `Selected option: ${opt.label || value}`,
        data: { ...opt, method: "combobox-trusted-click" },
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * P1: set files on <input type=file> via CDP DOM.setFileInputFiles.
   */
  async upload(
    target: { ref?: string; selector?: string },
    files: string[],
  ): Promise<ToolResult> {
    const blocked = this.assertNotPaused();
    if (blocked) return blocked;
    if (!files.length) {
      return { ok: false, message: "upload requires at least one file path" };
    }

    const absFiles = files.map((f) => resolvePath(f));
    for (const f of absFiles) {
      if (!existsSync(f)) {
        return { ok: false, message: `File not found: ${f}` };
      }
    }

    const wc = this.pageView.webContents;
    try {
      const found = (await wc.executeJavaScript(
        `(${FIND_FILE_INPUT_SCRIPT})(${JSON.stringify(target.ref ?? null)}, ${JSON.stringify(target.selector ?? null)})`,
        true,
      )) as {
        ok: boolean;
        message?: string;
        id?: string;
        selector?: string;
        multiple?: boolean;
        accept?: string;
      };

      if (!found.ok || !found.selector) {
        return { ok: false, message: found.message || "No file input found", data: found };
      }

      const attached = wc.debugger.isAttached();
      if (!attached) {
        wc.debugger.attach("1.3");
      }
      try {
        await wc.debugger.sendCommand("DOM.enable");
        const doc = (await wc.debugger.sendCommand("DOM.getDocument", {
          depth: 0,
        })) as { root: { nodeId: number } };
        const q = (await wc.debugger.sendCommand("DOM.querySelector", {
          nodeId: doc.root.nodeId,
          selector: found.selector,
        })) as { nodeId: number };
        if (!q.nodeId) {
          return {
            ok: false,
            message: `CDP could not find file input: ${found.selector}`,
            data: found,
          };
        }
        await wc.debugger.sendCommand("DOM.setFileInputFiles", {
          nodeId: q.nodeId,
          files: absFiles,
        });
      } finally {
        if (!attached) {
          try {
            wc.debugger.detach();
          } catch {
            /* ignore */
          }
        }
      }

      this.lastSnapshot = null;
      this.pushStatus();
      return {
        ok: true,
        message: `Uploaded ${absFiles.length} file(s) → ${found.selector}`,
        data: { files: absFiles, input: found },
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async trustedClickAt(
    x: number,
    y: number,
    opts?: { hoverOnly?: boolean },
  ): Promise<void> {
    const wc = this.pageView.webContents;
    this.window.focus();
    wc.focus();
    const cx = Math.round(x);
    const cy = Math.round(y);
    wc.sendInputEvent({ type: "mouseMove", x: cx, y: cy } as Electron.MouseInputEvent);
    if (opts?.hoverOnly) return;
    wc.sendInputEvent({
      type: "mouseDown",
      x: cx,
      y: cy,
      button: "left",
      clickCount: 1,
    } as Electron.MouseInputEvent);
    wc.sendInputEvent({
      type: "mouseUp",
      x: cx,
      y: cy,
      button: "left",
      clickCount: 1,
    } as Electron.MouseInputEvent);
  }

  /** Click by visible text — trusted mouse. Use withinPortal for menu items. */
  async clickText(
    text: string,
    opts?: { exact?: boolean; withinPortal?: boolean; caret?: boolean },
  ): Promise<ToolResult> {
    const blocked = this.assertNotPaused();
    if (blocked) return blocked;
    try {
      const wc = this.pageView.webContents;
      const found = (await wc.executeJavaScript(
        `(${FIND_TEXT_SCRIPT})(${JSON.stringify(text)}, ${JSON.stringify(Boolean(opts?.exact))}, ${JSON.stringify(Boolean(opts?.withinPortal))})`,
        true,
      )) as {
        ok: boolean;
        message?: string;
        x?: number;
        y?: number;
        w?: number;
        text?: string;
        inPortal?: boolean;
        ref?: string;
      };
      if (!found.ok || found.x == null || found.y == null) {
        return {
          ok: false,
          message: found.message || `text not found: ${text}`,
          data: found,
        };
      }
      let x = Math.round(found.x);
      const y = Math.round(found.y);
      if (opts?.caret && found.w && found.w > 24) {
        x = Math.round(found.x + found.w / 2 - 8);
      }
      await this.trustedClickAt(x, y, { hoverOnly: true });
      await sleep(60);
      await this.trustedClickAt(x, y);
      await sleep(350);
      const portals = await wc.executeJavaScript(LIST_PORTALS_SCRIPT, true);
      this.lastSnapshot = null;
      return {
        ok: true,
        message: `click_text 「${found.text || text}」 @ ${x},${y}`,
        data: { ...found, clickPoint: { x, y }, portals },
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Open dropdown by trigger text, then click portal menu item. */
  async menuClick(trigger: string, item: string): Promise<ToolResult> {
    const blocked = this.assertNotPaused();
    if (blocked) return blocked;
    const open = await this.clickText(trigger, { exact: false });
    if (!open.ok) {
      return {
        ok: false,
        message: `menu trigger failed: ${open.message}`,
        data: open.data,
      };
    }

    const wc = this.pageView.webContents;
    let portals = (open.data as { portals?: { count?: number } })?.portals;
    const deadline = Date.now() + 2_000;
    while (
      Date.now() < deadline &&
      !(portals && typeof portals === "object" && (portals as { count?: number }).count)
    ) {
      await sleep(150);
      portals = await wc.executeJavaScript(LIST_PORTALS_SCRIPT, true);
    }

    let pick = await this.clickText(item, { exact: false, withinPortal: true });
    if (!pick.ok) {
      pick = await this.clickText(item, { exact: false, withinPortal: false });
    }
    if (!pick.ok) {
      return {
        ok: false,
        message: `menu item not found after open: ${item}`,
        data: { open, portals, pick },
      };
    }
    await sleep(500);
    return {
      ok: true,
      message: `menu_click 「${trigger}」→「${item}」`,
      data: { open, portals, pick },
    };
  }

  async dismissOverlays(): Promise<ToolResult> {
    try {
      const data = await this.pageView.webContents.executeJavaScript(
        DISMISS_OVERLAYS_SCRIPT,
        true,
      );
      this.lastSnapshot = null;
      return { ok: true, message: "dismiss_overlays", data };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async listPortals(): Promise<ToolResult> {
    try {
      const data = await this.pageView.webContents.executeJavaScript(
        LIST_PORTALS_SCRIPT,
        true,
      );
      return { ok: true, message: "list_portals", data };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async startRecording(meta?: {
    platform?: string;
    task?: string;
  }): Promise<ToolResult> {
    try {
      const data = await this.pageView.webContents.executeJavaScript(
        `(${RECORD_START_SCRIPT})(${JSON.stringify(meta || {})})`,
        true,
      );
      this.recording = true;
      this.recordingTask = meta?.task || "";
      this.pushSidebarState();
      return {
        ok: true,
        message: meta?.task ? `recording started: ${meta.task}` : "recording started",
        data,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async stopRecording(title?: string): Promise<ToolResult> {
    try {
      const data = (await this.pageView.webContents.executeJavaScript(
        RECORD_STOP_SCRIPT,
        true,
      )) as {
        ok: boolean;
        platform?: string;
        task?: string;
        url?: string;
        steps?: SkillStep[];
        message?: string;
      };
      this.recording = false;
      const taskName = title || data?.task || this.recordingTask || "";
      this.recordingTask = "";
      if (!data?.ok) {
        this.pushSidebarState();
        return { ok: false, message: data?.message || "当前没有在录制", data };
      }
      const configDir = this.configDir();
      const traceDir = join(configDir, "traces");
      mkdirSync(traceDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const platform = data.platform || "spark";
      const task = taskName || data.task || "task";
      const file = join(traceDir, `${platform}_${task}_${stamp}.trace.json`);
      writeFileSync(file, JSON.stringify(data, null, 2), "utf8");

      const skillTitle =
        taskName ||
        data.task ||
        `妙招 ${new Date().toLocaleString("zh-CN", { hour12: false })}`;
      const skill = createSkillFromTrace({
        configDir,
        title: skillTitle,
        steps: data.steps || [],
        url: data.url || this.getUrl(),
        platform: data.platform,
        task: skillTitle,
        traceFile: file,
        source: "taught",
      });
      this.skillsCache = listSkills(configDir);
      this.pushSidebarState();
      return {
        ok: true,
        message: `已保存妙招「${skill.title}」（${skill.stepCount} 步）`,
        data: {
          ...data,
          file,
          stepCount: skill.stepCount,
          skill: skillSummary(skill),
        },
      };
    } catch (error) {
      this.recording = false;
      this.recordingTask = "";
      this.pushSidebarState();
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async containsText(needle: string): Promise<ToolResult & { data?: { found: boolean; needle: string } }> {
    const page = await this.pageText();
    if (!page.ok || !page.data) {
      return { ok: false, message: page.message };
    }
    const found = page.data.text.includes(needle);
    return {
      ok: found,
      message: found ? `页面正文包含：${needle}` : `页面正文未找到：${needle}`,
      data: { found, needle },
    };
  }

  /**
   * P0: navigate always returns confirmed url/title after load settles.
   * Uses did-finish-load when available; also polls URL for SPA soft navigations.
   */
  async navigate(
    url: string,
    opts?: { asHuman?: boolean },
  ): Promise<NavigateConfirm | ToolResult> {
    if (!opts?.asHuman) {
      const blocked = this.assertNotPaused();
      if (blocked) return blocked;
    }

    const target = normalizeUrl(url);
    if (!target || target === DEFAULT_URL && !url.trim()) {
      return { ok: false, message: "navigate requires url" };
    }

    const started = Date.now();
    const wc = this.pageView.webContents;

    try {
      const loadPromise = new Promise<"ok" | "fail">((resolve) => {
        const onFinish = () => {
          cleanup();
          resolve("ok");
        };
        const onFail = (
          _e: Electron.Event,
          _code: number,
          _desc: string,
          _url: string,
          isMainFrame: boolean,
        ) => {
          if (!isMainFrame) return;
          cleanup();
          resolve("fail");
        };
        const cleanup = () => {
          wc.removeListener("did-finish-load", onFinish);
          wc.removeListener("did-fail-load", onFail);
        };
        wc.once("did-finish-load", onFinish);
        wc.on("did-fail-load", onFail);
      });

      await wc.loadURL(target);

      // Wait for finish, fail, or timeout — then always probe final state.
      await Promise.race([
        loadPromise,
        sleep(12_000).then(() => "timeout" as const),
      ]);

      // SPA soft settle: wait until URL leaves about:blank or matches host, max 3s more
      const deadline = Date.now() + 3_000;
      while (Date.now() < deadline) {
        const u = wc.getURL();
        if (u && u !== "about:blank") break;
        await sleep(100);
      }
      await sleep(200);

      const probe = await this.probe();
      this.lastSnapshot = null;
      this.pushStatus();

      let requestedHost = "";
      try {
        requestedHost = new URL(target).hostname.replace(/^www\./, "");
      } catch {
        requestedHost = "";
      }
      let actualHost = "";
      try {
        actualHost = new URL(probe.url).hostname.replace(/^www\./, "");
      } catch {
        actualHost = "";
      }
      const hostOk =
        !requestedHost ||
        !actualHost ||
        actualHost === requestedHost ||
        actualHost.endsWith("." + requestedHost) ||
        requestedHost.endsWith("." + actualHost) ||
        // soft: weibo.com vs m.weibo.cn etc.
        actualHost.replace(/\./g, "").includes(requestedHost.split(".")[0] || "___");
      const ok =
        Boolean(probe.url) &&
        probe.url !== "about:blank" &&
        hostOk &&
        !/^chrome-error:|data:text\/html/i.test(probe.url);

      return {
        ok,
        message: ok
          ? `已打开 ${probe.url}，页面标题：${probe.title || "(无标题)"}`
          : `导航未到目标（要去 ${target}，现在还在 ${probe.url || "空白页"}，标题：${probe.title || "无"}）`,
        data: {
          requestedUrl: target,
          url: probe.url,
          title: probe.title,
          confirmed: ok,
          loadMs: Date.now() - started,
        },
      };
    } catch (error) {
      const probe = await this.probe().catch(() => ({
        url: wc.getURL(),
        title: wc.getTitle(),
        bodyLen: 0,
      }));
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        data: {
          requestedUrl: target,
          url: probe.url,
          title: probe.title,
          confirmed: true as const,
          loadMs: Date.now() - started,
        },
      };
    }
  }

  async snapshot(selector?: string): Promise<ToolResult & { data?: PageSnapshot }> {
    try {
      const wc = this.pageView.webContents;
      const raw = (await wc.executeJavaScript(SNAPSHOT_SCRIPT, true)) as PageSnapshot;
      let elements = raw.elements;
      if (selector) {
        elements = elements.filter(
          (el) =>
            el.selector.includes(selector) ||
            el.name.includes(selector) ||
            el.ref === selector ||
            (el.placeholder || "").includes(selector),
        );
      }
      this.lastSnapshot = { ...raw, elements };
      this.pushStatus();
      return {
        ok: true,
        message: `Snapshot: ${elements.length} interactive elements @ ${raw.url}`,
        data: this.lastSnapshot,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * P0: click returns before/after page evidence (url/title/dom size).
   * Uses real mouse sendInputEvent at element center (trusted) — required by React/Weibo.
   */
  async click(target: {
    ref?: string;
    selector?: string;
    /** Prefer caret (right edge) click for split dropdown buttons */
    caret?: boolean;
  }): Promise<ClickConfirm | ToolResult> {
    const blocked = this.assertNotPaused();
    if (blocked) return blocked;
    if (!target.ref && !target.selector) {
      return { ok: false, message: "click requires ref or selector" };
    }

    try {
      const before = await this.probe();
      const wc = this.pageView.webContents;

      const hit = (await wc.executeJavaScript(
        `(${CLICK_HITTEST_SCRIPT})(${JSON.stringify(target.ref ?? null)}, ${JSON.stringify(target.selector ?? null)})`,
        true,
      )) as {
        ok: boolean;
        message?: string;
        target?: string;
        disabled?: boolean;
        x?: number;
        y?: number;
        width?: number;
        height?: number;
        isDropdownTrigger?: boolean;
      };

      if (!hit.ok || hit.x == null || hit.y == null) {
        return {
          ok: false,
          message: hit.message || "Element not found for click",
          data: {
            target: target.ref || target.selector || "",
            before,
            after: before,
            urlChanged: false,
            titleChanged: false,
            domChanged: false,
            changed: false,
            disabled: Boolean(hit.disabled),
          },
        };
      }

      if (hit.disabled) {
        return {
          ok: false,
          message:
            "Click target is disabled (React state likely empty — fill did not stick)",
          data: {
            target: String(hit.target || ""),
            before,
            after: before,
            urlChanged: false,
            titleChanged: false,
            domChanged: false,
            changed: false,
            disabled: true,
          },
        };
      }

      // Submit/save clicks must pass QA + human approval
      const label = (await wc.executeJavaScript(
        `(() => {
          const ref = ${JSON.stringify(target.ref ?? null)};
          const selector = ${JSON.stringify(target.selector ?? null)};
          let el = ref ? document.querySelector('[data-spark-ref="' + CSS.escape(ref) + '"]') : null;
          if (!el && selector) { try { el = document.querySelector(selector); } catch(_){} }
          return el ? ((el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().slice(0, 80)) : '';
        })()`,
        true,
      ).catch(() => "")) as string;
      if (looksLikeSubmitAction(label || String(hit.target || ""))) {
        const gate = await this.qaGate();
        if (!gate.ok) return gate as ToolResult;
        const appr = await this.requestApproval({
          action: "submit",
          reason: `即将点击提交类按钮：${label || hit.target}`,
          risk: "high",
        });
        if (!appr.ok) return appr;
      }

      // Trusted mouse only (no synthetic DOM click backup — that double-toggles Ant Design Dropdown)
      let x = Math.round(hit.x);
      const y = Math.round(hit.y);
      if (target.caret && hit.width && hit.width > 24) {
        x = Math.round(hit.x + hit.width / 2 - 8);
      }
      await this.trustedClickAt(x, y, { hoverOnly: true });
      await sleep(80);
      await this.trustedClickAt(x, y);

      let portals: unknown = null;
      if (hit.isDropdownTrigger || target.caret) {
        const portalDeadline = Date.now() + 1_500;
        while (Date.now() < portalDeadline) {
          await sleep(120);
          portals = await wc.executeJavaScript(LIST_PORTALS_SCRIPT, true);
          if (
            portals &&
            typeof portals === "object" &&
            ((portals as { count?: number }).count || 0) > 0
          ) {
            break;
          }
        }
      } else {
        await sleep(200);
        portals = await wc
          .executeJavaScript(LIST_PORTALS_SCRIPT, true)
          .catch(() => null);
      }

      const deadline = Date.now() + 2_000;
      let after = before;
      while (Date.now() < deadline) {
        await sleep(150);
        after = await this.probe();
        if (
          after.url !== before.url ||
          after.title !== before.title ||
          Math.abs(after.bodyLen - before.bodyLen) > 20
        ) {
          break;
        }
        if (
          portals &&
          typeof portals === "object" &&
          ((portals as { count?: number }).count || 0) > 0
        ) {
          break;
        }
      }
      after = await this.probe();

      const urlChanged = after.url !== before.url;
      const titleChanged = after.title !== before.title;
      const domChanged = Math.abs(after.bodyLen - before.bodyLen) > 20;
      const portalOpened =
        !!portals &&
        typeof portals === "object" &&
        ((portals as { count?: number }).count || 0) > 0;
      const changed = urlChanged || titleChanged || domChanged || portalOpened;

      this.lastSnapshot = null;
      this.pushStatus();

      return {
        ok: true,
        message: portalOpened
          ? `已真实点击 ${hit.target}，Portal 菜单已打开`
          : changed
            ? `已真实点击 ${hit.target}，页面已变化 → ${after.url}`
            : `已真实点击 ${hit.target}（trusted mouse @ ${x},${y}）；短时未见 URL/标题变化`,
        data: {
          target: String(hit.target || target.ref || target.selector),
          before,
          after,
          urlChanged,
          titleChanged,
          domChanged,
          changed,
          clickPoint: { x, y },
          isDropdownTrigger: Boolean(hit.isDropdownTrigger),
          portals,
        },
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * P0: fill reads back actual value and reports matched.
   * Uses React-aware DOM fill first; if sticky check fails or for textareas,
   * falls back to real keyboard typing via sendInputEvent.
   */
  async fill(
    target: { ref?: string; selector?: string },
    value: string,
  ): Promise<FillConfirm | ToolResult> {
    const blocked = this.assertNotPaused();
    if (blocked) return blocked;
    if (!target.ref && !target.selector) {
      return { ok: false, message: "fill requires ref or selector" };
    }

    try {
      const wc = this.pageView.webContents;

      // Focus target first (do not full-click — that may hit wrong controls)
      await wc.executeJavaScript(
        `(${FOCUS_SCRIPT})(${JSON.stringify(target.ref ?? null)}, ${JSON.stringify(target.selector ?? null)})`,
        true,
      ).catch(() => undefined);

      // React-aware script fill (includes _valueTracker reset)
      let result = (await wc.executeJavaScript(
        `(${FILL_SCRIPT})(${JSON.stringify(target.ref ?? null)}, ${JSON.stringify(target.selector ?? null)}, ${JSON.stringify(value)})`,
        true,
      )) as {
        ok: boolean;
        message: string;
        expected: string;
        actual: string;
        matched: boolean;
        kind: FillConfirm["data"]["kind"];
        target: string;
        method?: string;
      };

      // Keyboard fallback — most reliable for React/Weibo
      if (!result.matched) {
        await this.typeWithKeyboard(value);
        await sleep(200);
        const actual = (await wc.executeJavaScript(
          `(${FILL_SCRIPT_READ})(${JSON.stringify(target.ref ?? null)}, ${JSON.stringify(target.selector ?? null)})`,
          true,
        )) as string;
        result = {
          ok: actual === value,
          message:
            actual === value
              ? `已键盘输入并回读确认 ${actual.length} 字`
              : `键盘输入后仍不匹配 expected=${value.length} actual=${actual.length}`,
          expected: value,
          actual,
          matched: actual === value,
          kind: result.kind,
          target: result.target,
          method: "sendInputEvent-keyboard",
        };
      } else {
        // Even when DOM matched, force a keyboard nudge for React state on textarea
        // by selecting-all and retyping if kind is textarea — Weibo needs this.
        if (result.kind === "textarea" || result.kind === "input") {
          await this.typeWithKeyboard(value);
          await sleep(150);
          const actual = (await wc.executeJavaScript(
            `(${FILL_SCRIPT_READ})(${JSON.stringify(target.ref ?? null)}, ${JSON.stringify(target.selector ?? null)})`,
            true,
          )) as string;
          if (actual === value) {
            result = {
              ...result,
              actual,
              matched: true,
              ok: true,
              method: `${result.method}+keyboard`,
              message: `已填入并回读确认 ${actual.length} 字（${result.method}+keyboard）`,
            };
          }
        }
      }

      this.pushStatus();
      return {
        ok: result.matched,
        message: result.matched
          ? `已填入并回读确认 ${result.actual.length} 字（${result.method || result.kind}）`
          : result.message,
        data: {
          target: result.target,
          expected: result.expected,
          actual: result.actual,
          matched: result.matched,
          kind: result.kind,
          method: result.method,
        },
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Send a single key (Enter/Escape/…) via trusted keyboard events. */
  async pressKey(key: string): Promise<ToolResult> {
    const blocked = this.assertNotPaused();
    if (blocked) return blocked;
    try {
      const wc = this.pageView.webContents;
      this.window.focus();
      wc.focus();
      const keyCode = key === "Enter" || key === "Return" ? "Return" : key === "Escape" ? "Escape" : key;
      wc.sendInputEvent({ type: "keyDown", keyCode } as Electron.KeyboardInputEvent);
      wc.sendInputEvent({ type: "char", keyCode: key === "Enter" ? "\r" : key } as Electron.KeyboardInputEvent);
      wc.sendInputEvent({ type: "keyUp", keyCode } as Electron.KeyboardInputEvent);
      await sleep(120);
      return { ok: true, message: `pressKey ${key}` };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Type text as real key events into the focused element. */
  private async typeWithKeyboard(value: string): Promise<void> {
    const wc = this.pageView.webContents;
    this.window.focus();
    wc.focus();

    // Select all + delete
    wc.sendInputEvent({
      type: "keyDown",
      keyCode: "A",
      modifiers: ["control"],
    } as Electron.KeyboardInputEvent);
    wc.sendInputEvent({
      type: "keyUp",
      keyCode: "A",
      modifiers: ["control"],
    } as Electron.KeyboardInputEvent);
    await sleep(30);
    wc.sendInputEvent({ type: "keyDown", keyCode: "Backspace" } as Electron.KeyboardInputEvent);
    wc.sendInputEvent({ type: "keyUp", keyCode: "Backspace" } as Electron.KeyboardInputEvent);
    await sleep(30);

    for (const ch of value) {
      wc.sendInputEvent({ type: "char", keyCode: ch } as Electron.KeyboardInputEvent);
      await sleep(8);
    }
  }

  async reload(opts?: { asHuman?: boolean }): Promise<ToolResult> {
    if (!opts?.asHuman) {
      const blocked = this.assertNotPaused();
      if (blocked) return blocked;
    }
    this.pageView.webContents.reload();
    this.lastSnapshot = null;
    await sleep(800);
    const probe = await this.probe();
    this.pushStatus();
    return {
      ok: true,
      message: `Reloaded → ${probe.url}`,
      data: probe,
    };
  }

  async goBack(opts?: { asHuman?: boolean }): Promise<ToolResult> {
    if (!opts?.asHuman) {
      const blocked = this.assertNotPaused();
      if (blocked) return blocked;
    }
    if (!this.navCanGoBack(this.pageView.webContents)) {
      return { ok: false, message: "Cannot go back" };
    }
    const before = await this.probe();
    this.pageView.webContents.goBack();
    this.lastSnapshot = null;
    await sleep(800);
    const after = await this.probe();
    this.pushStatus();
    return {
      ok: after.url !== before.url,
      message: `Back → ${after.url}`,
      data: { before, after },
    };
  }

  async goForward(opts?: { asHuman?: boolean }): Promise<ToolResult> {
    if (!opts?.asHuman) {
      const blocked = this.assertNotPaused();
      if (blocked) return blocked;
    }
    if (!this.navCanGoForward(this.pageView.webContents)) {
      return { ok: false, message: "Cannot go forward" };
    }
    const before = await this.probe();
    this.pageView.webContents.goForward();
    this.lastSnapshot = null;
    await sleep(800);
    const after = await this.probe();
    this.pushStatus();
    return {
      ok: after.url !== before.url,
      message: `Forward → ${after.url}`,
      data: { before, after },
    };
  }

  getUrl(): string {
    const tab = this.getActiveTab();
    if (!tab) return "";
    try {
      return tab.view.webContents.getURL() || tab.url || "";
    } catch {
      return tab.url || "";
    }
  }

  getTitle(): string {
    const tab = this.getActiveTab();
    if (!tab) return "";
    try {
      return tab.view.webContents.getTitle() || tab.title || "";
    } catch {
      return tab.title || "";
    }
  }
}

let singleton: SparkBrowser | null = null;

export function getBrowser(): SparkBrowser {
  if (!singleton) {
    throw new Error("SparkBrowser not initialized");
  }
  return singleton;
}

export function createBrowser(): SparkBrowser {
  if (singleton) return singleton;
  singleton = new SparkBrowser();
  return singleton;
}

export function whenAppReady(): Promise<void> {
  if (app.isReady()) return Promise.resolve();
  return app.whenReady();
}
