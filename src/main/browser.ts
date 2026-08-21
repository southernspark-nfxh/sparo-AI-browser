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
  SnapshotElement,
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
  seedBundledSkills,
  skillSummary,
  type Skill,
  type SkillStep,
} from "./skills/store.js";
import {
  matchSkills,
  runSkill,
  skillCatalog,
  resolveSkill,
} from "./skills/runner.js";
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
  DEFAULT_SESSION_SITES,
  loadSessions,
  saveSessionsFile,
  type SessionSite,
} from "./sessions/store.js";
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
  XHS_ADD_TOPICS_SCRIPT,
  XHS_CLICK_PUBLISH_SCRIPT,
  XHS_ENSURE_EDITOR_SCRIPT,
  XHS_INJECT_COMPOSE_SCRIPT,
  XHS_INJECT_PUBLISH_SCRIPT,
  XHS_LAYOUT_NEXT_SCRIPT,
  XHS_PAGE_STAGE_SCRIPT,
  XHS_PICK_COVER_SCRIPT,
  XHS_SCROLL_BOTTOM_SCRIPT,
  ANALYZE_PAGE_SCRIPT,
} from "./page-scripts.js";
import { executePrimitivesOnBrowser } from "./analyzer/execute-primitives.js";
import type { AnalyzedPage } from "./analyzer/types.js";
import { runCsDraft, runCsScan } from "./cs/service.js";
import type { CsDraftData, CsScanData } from "./cs/types.js";
import {
  FRAME_COLLECT_SCRIPT,
  FRAME_FILL_SCRIPT,
  FRAME_FIND_TEXT_SCRIPT,
  FRAME_HIT_SCRIPT,
  FRAME_WAIT_SCRIPT,
  cdpEvaluate,
  cdpCall,
  cdpUtf8Expr,
  listChildFrames,
  matchFrameOffsets,
  parseCrossFrameRef,
  prefixFrameElements,
  withDebugger,
  type CdpFrameInfo,
  type IframeMeta,
} from "./cdp-frames.js";
import { isMojibake, softFillMatch, sleep } from "./browser-helpers.js";
import { attachPageContextMenu } from "./page-context-menu.js";

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

/** Drop approvals older than SPARO_APPROVAL_MAX_AGE_MS (default 10min). */
function pruneStaleApprovals(
  map: Map<string, ApprovalRequest>,
  maxAgeMs = Number(process.env.SPARO_APPROVAL_MAX_AGE_MS || 600_000),
): number {
  if (!(maxAgeMs > 0)) return 0;
  const now = Date.now();
  let n = 0;
  for (const [id, req] of map) {
    const created = Date.parse(req.createdAt);
    if (!Number.isFinite(created) || now - created <= maxAgeMs) continue;
    try {
      req.resolve(false);
    } catch {
      /* ignore */
    }
    map.delete(id);
    n += 1;
  }
  return n;
}

function normalizeUrl(url: string): string {
  let target = url.trim();
  if (!target) return DEFAULT_URL;
  if (/^(https?:|file:|data:|about:)/i.test(target)) return target;
  target = `https://${target}`;
  return target;
}

export class SparkBrowser {
  readonly window: BrowserWindow;
  /** @deprecated use active tab via pageView getter */
  private tabs = new Map<string, TabInfo>();
  private activeTabId = "";
  private shellReady = false;
  private lastSnapshot: PageSnapshot | null = null;
  /** Cross-origin CDP frames from last snapshot (x{i}.* refs) */
  private cdpFrames: CdpFrameInfo[] = [];
  private paused = false;
  private approvals = new Map<string, ApprovalRequest>();
  private lastQa: QaReport | null = null;
  private chatLog: Array<{ role: "user" | "assistant"; text: string }> = [];
  private ipcReady = false;
  private bookmarks: BookmarkItem[] = [];
  private recording = false;
  private recordingTask = "";
  private lastCs: CsDraftData | CsScanData | null = null;
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

  /** Config + cookie + strategy cache root (%APPDATA%/sparo). */
  configDir(): string {
    return (
      process.env.SPARO_CONFIG_DIR ||
      process.env.SPARK_CONFIG_DIR ||
      (process.platform === "win32" && process.env.APPDATA
        ? join(process.env.APPDATA, "sparo")
        : join(homedir(), ".config", "sparo"))
    );
  }

  /** @deprecated use configDir() */
  getConfigDir(): string {
    return this.configDir();
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
    seedBundledSkills(this.configDir());
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
    attachPageContextMenu(wc, {
      openInNewTab: (openUrl) => {
        this.createTab(openUrl, true);
      },
    });
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
    wc.on("did-finish-load", () => {
      sync();
      if (this.recording && this.activeTabId === id) {
        void wc
          .executeJavaScript(
            `(${RECORD_START_SCRIPT})(${JSON.stringify({
              platform: "spark",
              task: this.recordingTask || undefined,
            })})`,
            true,
          )
          .catch(() => undefined);
      }
    });
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
    handle("spark:cs-scan", async () => this.csScan());
    handle("spark:cs-draft", async (_e, opts?: { draft?: string; fill?: boolean }) =>
      this.csDraftReply(opts || {}),
    );
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
        message: this.settings.apiKey || this.settings.deepseekApiKey
          ? "API 已配置"
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
    pruneStaleApprovals(this.approvals);
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
      cs: this.lastCs
        ? "intent" in this.lastCs && (this.lastCs as CsDraftData).intent
          ? {
              mode: "draft",
              intent: (this.lastCs as CsDraftData).intent,
              draft: (this.lastCs as CsDraftData).draft,
              source: (this.lastCs as CsDraftData).source,
              filled: (this.lastCs as CsDraftData).filled,
              sendBlocked: true,
              looksLikeChat: (this.lastCs as CsDraftData).scan?.looksLikeChat,
              score: (this.lastCs as CsDraftData).scan?.score,
            }
          : {
              mode: "scan",
              looksLikeChat: (this.lastCs as CsScanData).looksLikeChat,
              score: (this.lastCs as CsScanData).score,
              msgCount: (this.lastCs as CsScanData).messages?.length || 0,
              lastCustomerText: (this.lastCs as CsScanData).lastCustomerText,
            }
        : null,
      explain: {
        pause: "暂停：Agent 立刻停手，人可自由操作页面",
        approval: "审批：Agent 请求做人确认后才继续（如提交）",
        wait: "等待 wait_for：Agent 等页面元素出现，不是等人",
        skill: "妙招：录制成功操作并沉淀；对话说「开始录制 / 结束录制并保存为某某」",
        cs: "客服半自动：扫描会话 → AI/模板草稿填入输入框 → 人点发送（永不自动发送）",
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

  /**
   * Flush Chromium cookies to disk and write sessions.json metadata
   * (cookie names/counts only — never values). Used so agents reopen sites logged-in.
   */
  async saveSessions(siteIds?: string[]): Promise<ToolResult> {
    try {
      const ses = this.pageView.webContents.session;
      await ses.cookies.flushStore();
      const all = await ses.cookies.get({});
      const want = new Set(
        (siteIds?.length ? siteIds : DEFAULT_SESSION_SITES.map((s) => s.id)).map(String),
      );
      const sites: SessionSite[] = [];
      const now = new Date().toISOString();
      for (const base of DEFAULT_SESSION_SITES) {
        if (!want.has(base.id)) continue;
        const matched = all.filter((c) => {
          const dom = String(c.domain || "").replace(/^\./, "").toLowerCase();
          return base.domains.some((d) => {
            const host = d.replace(/^\./, "").toLowerCase();
            return dom === host || dom.endsWith("." + host) || host.endsWith("." + dom);
          });
        });
        const names = [...new Set(matched.map((c) => c.name))].sort();
        sites.push({
          ...base,
          cookieCount: matched.length,
          cookieNames: names.slice(0, 40),
          verifiedAt: matched.length > 0 ? now : undefined,
          note:
            matched.length > 0
              ? `${base.note || ""} · 已保存登录 Cookie`.trim()
              : `${base.note || ""} · 未检测到 Cookie（可能未登录）`.trim(),
        });
      }

      // Ensure bookmarks for logged-in homes (add only — never toggle-remove)
      for (const s of sites) {
        if ((s.cookieCount || 0) < 1) continue;
        const homeBase = s.homeUrl.split("?")[0] || s.homeUrl;
        const exists = this.bookmarks.some(
          (b) => b.url === s.homeUrl || (b.url || "").startsWith(homeBase),
        );
        if (!exists) {
          this.bookmarks = [
            {
              id: randomBytes(4).toString("hex"),
              title: s.title,
              url: s.homeUrl,
              folder: "书签栏",
              bar: true,
              source: "manual",
            },
            ...this.bookmarks,
          ];
        } else {
          this.bookmarks = this.bookmarks.map((b) =>
            b.url === s.homeUrl || (b.url || "").startsWith(homeBase)
              ? { ...b, bar: true, title: s.title || b.title }
              : b,
          );
        }
      }
      saveBookmarks(this.configDir(), this.bookmarks);
      this.pushChromeState();

      const file = {
        updatedAt: now,
        userDataHint: this.configDir(),
        sites: (() => {
          const prev = loadSessions(this.configDir()).sites;
          const byId = new Map(prev.map((s) => [s.id, s]));
          for (const s of sites) byId.set(s.id, s);
          // keep defaults for any missing
          for (const d of DEFAULT_SESSION_SITES) {
            if (!byId.has(d.id)) byId.set(d.id, { ...d });
          }
          return DEFAULT_SESSION_SITES.map((d) => byId.get(d.id)!);
        })(),
      };
      saveSessionsFile(this.configDir(), file);

      const loggedIn = sites.filter((s) => (s.cookieCount || 0) > 0).map((s) => s.title);
      const missing = sites.filter((s) => (s.cookieCount || 0) < 1).map((s) => s.title);
      return {
        ok: loggedIn.length > 0,
        message:
          loggedIn.length > 0
            ? `已落盘登录态：${loggedIn.join("、")}${missing.length ? `；未检测到：${missing.join("、")}` : ""}`
            : `未检测到登录 Cookie（${missing.join("、") || "无"}）`,
        data: file,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  listSessions(): ToolResult {
    const file = loadSessions(this.configDir());
    return {
      ok: true,
      message: `sessions ${file.sites.length}`,
      data: file,
    };
  }

  /**
   * Universal page analyzer — classify fields/buttons + required markers (红星).
   * Stamps data-spark-ref for subsequent execute_primitives.
   */
  async analyzePage(): Promise<ToolResult & { data?: AnalyzedPage }> {
    try {
      const data = (await this.pageView.webContents.executeJavaScript(
        ANALYZE_PAGE_SCRIPT,
        true,
      )) as AnalyzedPage;
      if (!data?.ok) {
        return { ok: false, message: "analyze_page failed", data };
      }
      return {
        ok: true,
        message: `analyze_page ${data.page_type} · fields=${data.field_count} · required=${data.required_fields?.length || 0}`,
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
   * Map payload keys → analyzed fields → fill/click/upload with mini-QA + strategy learning.
   */
  async executePrimitives(input: {
    payload: Record<string, unknown>;
    url?: string;
    includeOptional?: boolean;
    maxAttempts?: number;
  }): Promise<ToolResult> {
    if (input.url) {
      const nav = await this.navigate(input.url);
      if (!nav.ok) return nav;
    }
    return executePrimitivesOnBrowser(this, input);
  }

  /** Expose settings for CS draft LLM (same object Chat uses). */
  getSettings(): SparkSettings {
    return this.settings;
  }

  /**
   * Semi-auto CS: scan any page for chat-like UI + recent messages.
   * Does not send.
   */
  async csScan(): Promise<ToolResult & { data?: CsScanData }> {
    const res = await runCsScan({
      pageView: this.pageView,
      assertNotPaused: () => this.assertNotPaused(),
      fill: (t, v) => this.fill(t, v),
      getSettings: () => this.settings,
    });
    if (res.data) this.lastCs = res.data;
    this.pushSidebarState();
    return res;
  }

  /**
   * Semi-auto CS: classify intent → draft → fill composer.
   * Never clicks 发送 — human confirms on page.
   */
  async csDraftReply(input?: {
    draft?: string;
    fill?: boolean;
    preferLlm?: boolean;
  }): Promise<ToolResult & { data?: CsDraftData }> {
    const res = await runCsDraft(
      {
        pageView: this.pageView,
        assertNotPaused: () => this.assertNotPaused(),
        fill: (t, v) => this.fill(t, v),
        getSettings: () => this.settings,
      },
      input || {},
    );
    if (res.data) this.lastCs = res.data;
    this.pushSidebarState();
    return res;
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
    timeoutMs?: number;
  }): Promise<ToolResult> {
    const blocked = this.assertNotPaused();
    if (blocked) return blocked;
    pruneStaleApprovals(this.approvals);
    const id = randomBytes(6).toString("hex");
    const timeoutMs =
      input.timeoutMs ??
      Number(process.env.SPARO_APPROVAL_TIMEOUT_MS || 300_000);
    let settled = false;
    const approved = await new Promise<boolean | "timeout">((resolve) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              if (settled) return;
              settled = true;
              resolve("timeout");
            }, timeoutMs)
          : null;
      this.approvals.set(id, {
        id,
        action: input.action,
        reason: input.reason,
        risk: input.risk,
        createdAt: new Date().toISOString(),
        resolve: (ok: boolean) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          resolve(ok);
        },
      });
      this.pushSidebarState();
    });
    this.approvals.delete(id);
    this.pushSidebarState();
    if (approved === "timeout") {
      await this.dismissOverlays().catch(() => undefined);
      this.lastSnapshot = null;
      return {
        ok: false,
        message: `Approval timeout (${Math.round(timeoutMs / 1000)}s): ${input.action}`,
        data: { id, approved: false, approval: "timeout", action: input.action },
      };
    }
    if (!approved) {
      await this.dismissOverlays().catch(() => undefined);
      this.lastSnapshot = null;
      return {
        ok: false,
        message: `Rejected: ${input.action}`,
        data: { id, approved: false, approval: "rejected", action: input.action },
      };
    }
    return {
      ok: true,
      message: `Approved: ${input.action}`,
      data: { id, approved: true, approval: "granted", action: input.action },
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
    all?: boolean;
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
          const requireAll = ${JSON.stringify(Boolean(input.all))};
          function visible(el) {
            if (!el) return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          }
          let el = null;
          if (ref) el = document.querySelector('[data-spark-ref="' + CSS.escape(ref) + '"]');
          if (!el && selector) {
            try {
              const nodes = Array.from(document.querySelectorAll(selector));
              if (requireAll && selector.includes(',')) {
                const parts = selector.split(',').map((s) => s.trim()).filter(Boolean);
                const ok = parts.every((part) => {
                  try {
                    return Array.from(document.querySelectorAll(part)).some(visible);
                  } catch (_) { return false; }
                });
                if (ok) {
                  el = nodes.find(visible) || document.querySelector(parts[0]);
                  return { ok: true, tag: el && el.tagName, text: el && (el.innerText||el.getAttribute('placeholder')||'').trim().slice(0,60), all: true };
                }
                return { ok: false };
              }
              el = nodes.find(visible) || null;
            } catch (_) {}
          }
          if (!el && text) {
            el = Array.from(document.querySelectorAll('a,button,span,div,input,label,li,textarea,[contenteditable=true]')).find((n) => {
              const t = (n.innerText || n.textContent || n.getAttribute('placeholder') || '').trim();
              return t.includes(text) && visible(n);
            }) || null;
          }
          if (!el) return { ok: false };
          return { ok: visible(el), tag: el.tagName, text: (el.innerText||el.getAttribute('placeholder')||'').trim().slice(0,60) };
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
      const tryCdpFrames =
        (input.ref && /^x(\d+)\.(.+)$/i.test(input.ref)) ||
        Boolean(input.selector) ||
        Boolean(input.text);
      if (tryCdpFrames) {
        try {
          const parsed = parseCrossFrameRef(input.ref);
          const localRef = parsed?.localRef ?? (input.ref && !/^x\d+\./i.test(input.ref) ? input.ref : null);
          const cdpHit = await withDebugger(wc, async (send) => {
            let frames = await listChildFrames(send);
            if (parsed && parsed.frameIndex >= 0 && parsed.frameIndex < frames.length) {
              const preferred = frames[parsed.frameIndex];
              frames = [
                preferred,
                ...frames.filter((_, i) => i !== parsed.frameIndex),
              ];
            }
            for (const frame of frames.slice(0, 8)) {
              try {
                const found = await cdpCall<{
                  ok: boolean;
                  tag?: string;
                  text?: string;
                  all?: boolean;
                }>(send, frame.frameId, FRAME_WAIT_SCRIPT, [
                  localRef,
                  input.selector ?? null,
                  input.text ?? null,
                  Boolean(input.all),
                ]);
                if (found?.ok) {
                  return {
                    ...found,
                    frameId: frame.frameId,
                    frameUrl: frame.url,
                    via: "cdp" as const,
                  };
                }
              } catch {
                /* try next frame */
              }
            }
            return null;
          });
          if (cdpHit?.ok) {
            return {
              ok: true,
              message: `wait_for ok (cdp) after ${Date.now() - started}ms`,
              data: { ...cdpHit, waitedMs: Date.now() - started },
            };
          }
        } catch {
          /* continue polling */
        }
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
    const apiKey = (this.settings.apiKey || this.settings.deepseekApiKey || "").trim();
    if (!apiKey) {
      this.deepseek = null;
      return;
    }
    const cfg = {
      apiKey,
      baseUrl:
        (this.settings.baseUrl || this.settings.deepseekBaseUrl || "").trim().replace(/\/$/, "") ||
        "https://api.deepseek.com",
      model:
        (this.settings.model || this.settings.deepseekModel || "").trim() ||
        "deepseek-v4-flash",
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
      case "get_skill":
        return this.getSkillTool(String(args.id || args.query || ""));
      case "match_skill":
        return this.matchSkillTool(String(args.query || args.id || ""));
      case "run_skill":
        return this.runSkillTool({
          id: args.id ? String(args.id) : undefined,
          query: args.query ? String(args.query) : undefined,
          params:
            args.params && typeof args.params === "object"
              ? (args.params as Record<string, unknown>)
              : undefined,
          dryRun: Boolean(args.dryRun),
        });
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
        tip: "Intent match: match_skill(query) → run_skill({id|query, params}). Prefer run_skill for 小红书/发文 flows.",
      },
    };
  }

  getSkillTool(idOrQuery: string): ToolResult {
    this.skillsCache = listSkills(this.configDir());
    const skill = resolveSkill(this.configDir(), idOrQuery);
    if (!skill) {
      return {
        ok: false,
        message: `skill not found: ${idOrQuery}`,
        data: { suggestions: matchSkills(this.configDir(), idOrQuery, 5) },
      };
    }
    return {
      ok: true,
      message: `skill: ${skill.title}`,
      data: { skill },
    };
  }

  matchSkillTool(query: string): ToolResult {
    const matches = matchSkills(this.configDir(), query, 8);
    return {
      ok: true,
      message: matches.length
        ? `best: ${matches[0].title} (${matches[0].score})`
        : "no skill matched",
      data: { query, matches },
    };
  }

  async runSkillTool(input: {
    id?: string;
    query?: string;
    params?: Record<string, unknown>;
    dryRun?: boolean;
  }): Promise<ToolResult> {
    this.skillsCache = listSkills(this.configDir());
    return runSkill(this, this.configDir(), input);
  }

  sparoInfoTool(): ToolResult {
    this.skillsCache = listSkills(this.configDir());
    const skills = skillCatalog(this.configDir());
    return {
      ok: true,
      message: "sparo_info",
      data: {
        name: "sparo",
        what: "Sparo Agent Browser — local Electron Chromium controlled via MCP. Shared window with the human.",
        product: {
          en: "Sparo Agent Browser",
          tagline: "The browser built for AI agents — humans stay in control.",
          zh: "Sparo 人机同窗浏览器",
          zh_tagline: "AI 驾驭网页，你驾驭 AI",
        },
        fast_path: [
          "Publishing: read docs/PUBLISHING.md — run_skill or xhs_inject_* (never loop fill).",
          "Xiaohongshu: run_skill({ query:'发小红书', params:{ title, body, summary, topics } }).",
          "Or: xhs_ensure_editor → xhs_inject_compose → xhs_layout_next → xhs_inject_publish → pause.",
          "Unknown forms: run_skill({ query:'通用填表', params:{ payload:{ 标题, 正文, … } } }) OR analyze_page → execute_primitives.",
          "Do NOT loop fill/click on multi-field forms — use execute_primitives.",
          "Customer service (any site, semi-auto): cs_scan → cs_draft_reply (fills composer; NEVER auto-send).",
          "Detect only: xhs_page_stage. Auth: %APPDATA%/sparo/mcp-auth.json · GET /health · /tools",
          "Playbook: docs/HERMES-PLAYBOOK.md",
        ],
        skills,
        skill_tools: [
          "list_skills",
          "match_skill",
          "get_skill",
          "run_skill",
          "analyze_page",
          "execute_primitives",
          "cs_scan",
          "cs_draft_reply",
          "xhs_page_stage",
          "xhs_inject_compose",
          "xhs_inject_publish",
          "xhs_layout_next",
          "xhs_ensure_editor",
        ],
        core_tools: [
          "navigate",
          "analyze_page",
          "execute_primitives",
          "cs_scan",
          "cs_draft_reply",
          "xhs_page_stage",
          "xhs_inject_compose",
          "xhs_layout_next",
          "xhs_inject_publish",
          "run_skill",
          "click_text",
          "pause",
          "diagnose",
        ],
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
        reply = "还没有妙招。可以说「开始录制」演示一遍，再「结束录制并保存为某某」。";
      } else {
        reply =
          `已有 ${this.skillsCache.length} 个妙招：\n` +
          this.skillsCache
            .slice(0, 12)
            .map((s, i) => `${i + 1}. ${s.title}（${s.stepCount} 步）`)
            .join("\n") +
          "\n\n直接说「发小红书」或「运行妙招 小红书发布」即可自动执行。";
      }
    } else if (action.type === "run_skill") {
      const label = action.id || action.query;
      this.chatLog.push({
        role: "assistant",
        text: `正在按妙招「${label}」执行…`,
      });
      this.pushSidebarState();
      const r = await this.runSkillTool({
        id: action.id,
        query: action.query,
      });
      reply = r.message;
      this.pushSidebarState();
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
          "也可直接说「发小红书」自动跑妙招，或连接 MCP Agent。\n" +
          dxmGuideMessage(this.getUrl(), "help");
      } else {
        try {
          const url = this.getUrl();
          this.skillsCache = listSkills(this.configDir());
          const catalog = skillCatalog(this.configDir())
            .slice(0, 8)
            .map((s) => `- ${s.id}: ${s.title}`)
            .join("\n");
          const dxmCtx =
            /店小[蜜秘]|dianxiaomi|速卖通|改标题|改尺寸|图片翻译/i.test(action.text) ||
            /dianxiaomi\.com/i.test(url);
          const skillHint =
            `【妙招优先】若用户要发小红书/长文/已知流程，立刻 run_skill（可用 query 或 id），不要逐步瞎点。目录：\n${catalog || "(无)"}`;
          const prompt = dxmCtx
            ? `【执行优先】当前 URL：${url}\n${skillHint}\n动手，不要讲功能清单。要登录/打开店小蜜就 navigate 到 https://www.dianxiaomi.com/web/home；要上品/上架/处理好且在编辑页就 run_workflow(dxm_full_listing)；不在编辑页就 navigate 到 https://www.dianxiaomi.com/web/productCrawl 并短说一句让用户点进编辑页。\n用户说：${action.text}`
            : `${skillHint}\n当前页：${url}\n用户说：${action.text}`;
          reply = await this.deepseek.chat(prompt, {
            url,
            title: this.getTitle(),
            skills: catalog,
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
      const wc = this.pageView.webContents;
      const data = (await wc.executeJavaScript(
        PAGE_TEXT_SCRIPT,
        true,
      )) as { text: string; length: number };
      let text = data.text || "";
      // Append cross-origin iframe text via CDP
      try {
        const extras = await withDebugger(wc, async (send) => {
          const frames = await listChildFrames(send);
          const parts: string[] = [];
          for (const f of frames.slice(0, 8)) {
            try {
              const chunk = await cdpEvaluate<{ text?: string }>(
                send,
                f.frameId,
                `(() => ({ text: String((document.body && document.body.innerText) || '').slice(0, 20000) }))()`,
              );
              if (chunk?.text) parts.push(chunk.text);
            } catch {
              /* skip frame */
            }
          }
          return parts;
        });
        if (extras.length) {
          text = [text, ...extras].filter(Boolean).join("\n\n---iframe---\n\n");
        }
      } catch {
        /* CDP optional */
      }
      return {
        ok: true,
        message: `page_text ${text.length} chars`,
        data: { text: text.slice(0, 80000), length: text.length },
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
   * Optional frame: CDP frame index from snapshot (x0 → frame 0) or frameId string.
   */
  async execute(
    script: string,
    opts?: { frame?: number | string },
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
      if (opts?.frame !== undefined && opts.frame !== null && opts.frame !== "") {
        const wc = this.pageView.webContents;
        const result = await withDebugger(wc, async (send) => {
          let frameId: string | undefined;
          if (typeof opts.frame === "number") {
            frameId = this.cdpFrames[opts.frame]?.frameId;
          } else if (typeof opts.frame === "string") {
            if (/^\d+$/.test(opts.frame)) {
              frameId = this.cdpFrames[Number(opts.frame)]?.frameId;
            } else if (/^x\d+$/i.test(opts.frame)) {
              frameId = this.cdpFrames[parseInt(opts.frame.slice(1), 10)]?.frameId;
            } else {
              frameId = opts.frame;
            }
          }
          if (!frameId) {
            const frames = await listChildFrames(send);
            if (typeof opts.frame === "number") frameId = frames[opts.frame]?.frameId;
            else if (typeof opts.frame === "string" && /^\d+$/.test(opts.frame)) {
              frameId = frames[Number(opts.frame)]?.frameId;
            }
          }
          if (!frameId) {
            throw new Error(
              `Unknown frame ${String(opts.frame)} — run snapshot first (use x* refs / frame index)`,
            );
          }
          const expression = `(() => {
            try {
              const __src = ${cdpUtf8Expr(script)};
              const __r = (0, eval)(__src);
              let safe;
              try { safe = JSON.parse(JSON.stringify(__r === undefined ? null : __r)); }
              catch (_) { safe = String(__r); }
              return { ok: true, result: safe };
            } catch (e) {
              return { ok: false, result: null, error: String(e && e.message ? e.message : e) };
            }
          })()`;
          return cdpEvaluate<{ ok: boolean; result: unknown; error?: string }>(
            send,
            frameId,
            expression,
          );
        });
        return {
          ok: Boolean(result?.ok),
          message: result?.ok
            ? "execute ok (cdp frame)"
            : `execute failed: ${result?.error || "unknown"}`,
          data: { result: result?.result, error: result?.error },
        };
      }

      const wrapped = `(() => {
        try {
          const __src = ${cdpUtf8Expr(script)};
          const __r = (0, eval)(__src);
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
        `(() => {
          const __v = ${cdpUtf8Expr(value)};
          return (${SELECT_SCRIPT})(${JSON.stringify(target.ref ?? null)}, ${JSON.stringify(target.selector ?? null)}, __v);
        })()`,
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
        `(() => {
          const __v = ${cdpUtf8Expr(value)};
          return (${FIND_OPTION_SCRIPT})(__v);
        })()`,
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
    opts?: {
      hoverOnly?: boolean;
      doubleClick?: boolean;
      button?: "left" | "right" | "middle";
      downDelayMs?: number;
    },
  ): Promise<void> {
    const wc = this.pageView.webContents;
    this.window.focus();
    wc.focus();
    const cx = Math.round(x);
    const cy = Math.round(y);
    const button = opts?.button || "left";
    const clickCount = opts?.doubleClick ? 2 : 1;
    const downDelayMs = opts?.downDelayMs ?? 30;
    wc.sendInputEvent({ type: "mouseMove", x: cx, y: cy } as Electron.MouseInputEvent);
    if (opts?.hoverOnly) return;
    wc.sendInputEvent({
      type: "mouseDown",
      x: cx,
      y: cy,
      button,
      clickCount,
    } as Electron.MouseInputEvent);
    if (downDelayMs > 0) await sleep(downDelayMs);
    wc.sendInputEvent({
      type: "mouseUp",
      x: cx,
      y: cy,
      button,
      clickCount,
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

      let hit = found;
      // Fallback: search cross-origin frames via CDP
      if (!hit.ok) {
        try {
          const cdpHit = await withDebugger(wc, async (send) => {
            let frames = this.cdpFrames;
            if (!frames.length) {
              const childFrames = await listChildFrames(send);
              const meta = (await wc.executeJavaScript(
                `(() => Array.from(document.querySelectorAll('iframe')).map((iframe, i) => {
                  const box = iframe.getBoundingClientRect();
                  let sameOrigin = false;
                  try { sameOrigin = !!(iframe.contentDocument && iframe.contentDocument.documentElement); } catch (_) {}
                  return { index: i, src: iframe.src || '', sameOrigin, x: box.x, y: box.y, w: box.width, h: box.height };
                }))()`,
                true,
              )) as IframeMeta[];
              frames = matchFrameOffsets(childFrames, meta);
              this.cdpFrames = frames;
            }
            let best: {
              ok: boolean;
              x: number;
              y: number;
              w?: number;
              text?: string;
              message?: string;
            } | null = null;
            for (const frame of frames) {
              try {
                const local = await cdpCall<{
                  ok: boolean;
                  x?: number;
                  y?: number;
                  w?: number;
                  text?: string;
                  message?: string;
                }>(send, frame.frameId, FRAME_FIND_TEXT_SCRIPT, [
                  text,
                  Boolean(opts?.exact),
                ]);
                if (local?.ok && local.x != null && local.y != null) {
                  best = {
                    ok: true,
                    x: local.x + frame.offsetX,
                    y: local.y + frame.offsetY,
                    w: local.w,
                    text: local.text,
                  };
                  break;
                }
              } catch {
                /* next frame */
              }
            }
            return best;
          });
          if (cdpHit?.ok) {
            hit = cdpHit;
          }
        } catch {
          /* ignore CDP fallback errors */
        }
      }

      if (!hit.ok || hit.x == null || hit.y == null) {
        return {
          ok: false,
          message: hit.message || `text not found: ${text}`,
          data: hit,
        };
      }
      let x = Math.round(hit.x);
      const y = Math.round(hit.y);
      if (opts?.caret && hit.w && hit.w > 24) {
        x = Math.round(hit.x + hit.w / 2 - 8);
      }
      await this.trustedClickAt(x, y, { hoverOnly: true });
      await sleep(60);
      await this.trustedClickAt(x, y);
      await sleep(350);
      const portals = await wc.executeJavaScript(LIST_PORTALS_SCRIPT, true);
      this.lastSnapshot = null;
      return {
        ok: true,
        message: `click_text 「${hit.text || text}」 @ ${x},${y}`,
        data: { ...hit, clickPoint: { x, y }, portals },
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

  /** Scroll long-form editor so 下一步 is on-screen. */
  async xhsScrollBottom(): Promise<ToolResult> {
    try {
      const data = await this.pageView.webContents.executeJavaScript(
        XHS_SCROLL_BOTTOM_SCRIPT,
        true,
      );
      return { ok: true, message: "scrolled to bottom", data };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Xiaohongshu topic chips via overlay suggestions. */
  async xhsAddTopics(topics: string[]): Promise<ToolResult> {
    try {
      const run = this.pageView.webContents.executeJavaScript(
        `(${XHS_ADD_TOPICS_SCRIPT})(${JSON.stringify(topics)})`,
        true,
      );
      const data = (await Promise.race([
        run,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("xhs_add_topics timeout 35s")), 35000),
        ),
      ])) as { ok?: boolean; results?: unknown };
      return {
        ok: Boolean(data?.ok),
        message: data?.ok ? "topics added" : "topics partially failed",
        data,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** AI: detect stage only — chooser | compose | publish. */
  async xhsPageStage(): Promise<ToolResult> {
    try {
      const data = await this.pageView.webContents.executeJavaScript(
        XHS_PAGE_STAGE_SCRIPT,
        true,
      );
      return {
        ok: true,
        message: `stage=${(data as { stage?: string })?.stage || "unknown"}`,
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
   * Atomic title+body inject (once). Prefer this over fill loops.
   * Content is passed as JSON args — AI must not type into the page.
   */
  async xhsInjectCompose(input: {
    title?: string;
    body?: string;
    force?: boolean;
  }): Promise<ToolResult> {
    try {
      let title = input.title || "";
      let body = input.body || "";
      if ((!title || !body) && input) {
        /* keep empty — skill runner fills from params/md */
      }
      const run = this.pageView.webContents.executeJavaScript(
        `(${XHS_INJECT_COMPOSE_SCRIPT})(${JSON.stringify({
          title,
          body,
          force: input.force !== false,
        })})`,
        true,
      );
      const data = (await Promise.race([
        run,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("inject_compose timeout 20s")), 20000),
        ),
      ])) as {
        ok?: boolean;
        message?: string;
        titleLen?: number;
        bodyLen?: number;
        skipped?: boolean;
      };
      if (!data?.ok) {
        const diag = await this.diagnose("inject-compose-fail");
        return {
          ok: false,
          message: data?.message || "inject_compose failed",
          data: { ...data, diagnose: diag.data },
        };
      }
      return {
        ok: true,
        message: data.skipped
          ? data.message || "inject_compose skipped"
          : `inject_compose title=${data.titleLen || 0} body=${data.bodyLen || 0}`,
        data,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Atomic publish-page summary + topics inject. */
  async xhsInjectPublish(input: {
    summary?: string;
    topics?: string[];
  }): Promise<ToolResult> {
    try {
      const run = this.pageView.webContents.executeJavaScript(
        `(${XHS_INJECT_PUBLISH_SCRIPT})(${JSON.stringify({
          summary: input.summary || "",
          topics: input.topics || [],
        })})`,
        true,
      );
      const data = (await Promise.race([
        run,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("inject_publish timeout 40s")), 40000),
        ),
      ])) as { ok?: boolean; message?: string };
      return {
        ok: Boolean(data?.ok),
        message: data?.message || (data?.ok ? "inject_publish ok" : "inject_publish failed"),
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
   * One-shot: 一键排版 → wait template panel → pick template → 下一步 → publish page.
   * Layout generation often takes 10–20s; do not click_text「下一步」immediately.
   */
  async xhsLayoutNext(input?: {
    template?: string;
    timeoutMs?: number;
  }): Promise<ToolResult> {
    try {
      const data = (await this.pageView.webContents.executeJavaScript(
        `(${XHS_LAYOUT_NEXT_SCRIPT})(${JSON.stringify({
          template: input?.template || "简约基础",
          timeoutMs: input?.timeoutMs || 32000,
        })})`,
        true,
      )) as { ok?: boolean; message?: string; stage?: string; log?: string[] };
      return {
        ok: Boolean(data?.ok),
        message: data?.message || (data?.ok ? "layout_next ok" : "layout_next failed"),
        data,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async xhsPickCover(): Promise<ToolResult> {
    try {
      const data = (await this.pageView.webContents.executeJavaScript(
        XHS_PICK_COVER_SCRIPT,
        true,
      )) as { ok?: boolean; message?: string; count?: number };
      return {
        ok: Boolean(data?.ok),
        message: data?.ok
          ? `cover picked (${data.count || 0})`
          : data?.message || "cover pick failed",
        data,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Click content-area 发布, not sidebar 发布笔记. */
  async xhsClickPublish(): Promise<ToolResult> {
    try {
      const data = (await this.pageView.webContents.executeJavaScript(
        XHS_CLICK_PUBLISH_SCRIPT,
        true,
      )) as { ok?: boolean; message?: string };
      return {
        ok: Boolean(data?.ok),
        message: data?.ok ? "clicked 发布" : data?.message || "publish click failed",
        data,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** 写长文 → 新的创作 → 空白创作 until editors visible. */
  async xhsEnsureEditor(): Promise<ToolResult> {
    try {
      const data = (await this.pageView.webContents.executeJavaScript(
        XHS_ENSURE_EDITOR_SCRIPT,
        true,
      )) as { ok?: boolean; already?: boolean; log?: string[]; sample?: string; url?: string };
      if (!data?.ok) {
        const diag = await this.diagnose("xhs-ensure-editor-fail");
        return {
          ok: false,
          message: "未能进入长文编辑器（可能需点「空白创作」）",
          data: { ...data, diagnose: diag.data },
        };
      }
      return {
        ok: true,
        message: data.already ? "editor already open" : "editor ready",
        data,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async screenshot(label?: string): Promise<ToolResult> {
    try {
      const wc = this.pageView.webContents;
      const img = await wc.capturePage();
      const dir = join(this.configDir(), "diag");
      mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const safe = String(label || "shot")
        .replace(/[\\/:*?"<>|]/g, "_")
        .slice(0, 40);
      const file = join(dir, `${safe}-${stamp}.png`);
      writeFileSync(file, img.toPNG());
      return {
        ok: true,
        message: `screenshot saved`,
        data: { file, url: this.getUrl(), title: this.getTitle() },
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async diagnose(label?: string): Promise<ToolResult> {
    const page = await this.pageText();
    const shot = await this.screenshot(label || "diagnose");
    const text =
      page.ok && page.data && typeof (page.data as { text?: string }).text === "string"
        ? (page.data as { text: string }).text.slice(0, 1200)
        : "";
    return {
      ok: true,
      message: `diagnose ${label || ""}`.trim(),
      data: {
        url: this.getUrl(),
        title: this.getTitle(),
        pageText: text,
        screenshot: shot.data,
        screenshotOk: shot.ok,
        screenshotMessage: shot.message,
      },
    };
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
      let data: {
        ok: boolean;
        platform?: string;
        task?: string;
        url?: string;
        steps?: SkillStep[];
        message?: string;
      };
      try {
        data = (await this.pageView.webContents.executeJavaScript(
          RECORD_STOP_SCRIPT,
          true,
        )) as typeof data;
      } catch (pageErr) {
        this.recording = false;
        this.recordingTask = "";
        this.pushSidebarState();
        return {
          ok: false,
          message:
            "结束录制失败（页面可能已刷新）：" +
            (pageErr instanceof Error ? pageErr.message : String(pageErr)),
        };
      }
      this.recording = false;
      const taskName = title || data?.task || this.recordingTask || "";
      this.recordingTask = "";
      if (!data?.ok) {
        this.pushSidebarState();
        return {
          ok: false,
          message:
            data?.message === "not recording"
              ? "页面录制状态已丢失（可能刷新过），已停止。请重新「开始录制」。"
              : data?.message || "当前没有在录制",
          data,
        };
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
      const raw = (await wc.executeJavaScript(SNAPSHOT_SCRIPT, true)) as PageSnapshot & {
        iframeMeta?: IframeMeta[];
      };
      let elements = raw.elements || [];
      const iframeMeta = raw.iframeMeta || [];

      try {
        const merged = await withDebugger(wc, async (send) => {
          const childFrames = await listChildFrames(send);
          const mapped = matchFrameOffsets(childFrames, iframeMeta);
          const needCdp = mapped.filter((f) => {
            const meta = iframeMeta.find(
              (m) =>
                Math.abs(m.x - f.offsetX) < 2 && Math.abs(m.y - f.offsetY) < 2,
            );
            return !meta?.sameOrigin;
          });
          const targets = needCdp.length ? needCdp : mapped;
          this.cdpFrames = targets;
          const extra: typeof elements = [];
          for (const frame of targets) {
            try {
              const collected = await cdpEvaluate<{
                elements?: Array<SnapshotElement & { ref: string }>;
              }>(send, frame.frameId, FRAME_COLLECT_SCRIPT);
              if (collected?.elements?.length) {
                extra.push(...prefixFrameElements(frame, collected.elements));
              }
            } catch {
              /* frame not evaluable */
            }
          }
          return extra;
        });
        if (merged.length) elements = elements.concat(merged);
      } catch {
        this.cdpFrames = [];
      }

      if (selector) {
        elements = elements.filter(
          (el) =>
            el.selector.includes(selector) ||
            el.name.includes(selector) ||
            el.ref === selector ||
            (el.placeholder || "").includes(selector),
        );
      }
      this.lastSnapshot = {
        ...raw,
        elements,
        iframeCount: iframeMeta.length || raw.iframeCount,
      };
      this.pushStatus();
      return {
        ok: true,
        message:
          `Snapshot: ${elements.length} interactive elements @ ${raw.url}` +
          (this.cdpFrames.length ? ` (${this.cdpFrames.length} CDP frames)` : ""),
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

      let hit = (await wc.executeJavaScript(
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

      const cross = parseCrossFrameRef(target.ref);
      if ((!hit.ok || hit.x == null) && cross) {
        const frame = this.cdpFrames[cross.frameIndex];
        if (frame) {
          try {
            const cdpHit = await withDebugger(wc, async (send) => {
              const local = await cdpCall<{
                ok: boolean;
                x?: number;
                y?: number;
                width?: number;
                height?: number;
                disabled?: boolean;
                message?: string;
              }>(send, frame.frameId, FRAME_HIT_SCRIPT, [
                cross.localRef,
                target.selector ?? null,
              ]);
              if (!local?.ok || local.x == null || local.y == null) return local;
              return {
                ...local,
                ok: true,
                x: local.x + frame.offsetX,
                y: local.y + frame.offsetY,
              };
            });
            if (cdpHit?.ok && cdpHit.x != null) {
              hit = cdpHit as typeof hit;
            }
          } catch {
            /* keep original miss */
          }
        }
      }

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
   * Unicode: never embed raw CJK in injected JS source (use cdpUtf8Expr / callFunctionOn).
   * Do NOT re-type with char events after a successful DOM fill — that caused Mojibake on Windows.
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

    const FIX = "fill-unicode-v2";

    try {
      const wc = this.pageView.webContents;

      const cross = parseCrossFrameRef(target.ref);
      if (cross) {
        const frame = this.cdpFrames[cross.frameIndex];
        if (!frame) {
          return {
            ok: false,
            message: `Unknown CDP frame x${cross.frameIndex} — run snapshot first [${FIX}]`,
          };
        }
        const filled = await withDebugger(wc, async (send) => {
          const local = await cdpCall<{
            ok: boolean;
            x?: number;
            y?: number;
          }>(send, frame.frameId, FRAME_HIT_SCRIPT, [
            cross.localRef,
            target.selector ?? null,
          ]);
          if (local?.ok && local.x != null && local.y != null) {
            await this.trustedClickAt(
              local.x + frame.offsetX,
              local.y + frame.offsetY,
            );
            await sleep(80);
          }
          return cdpCall<{
            ok: boolean;
            matched?: boolean;
            value?: string;
            message?: string;
          }>(send, frame.frameId, FRAME_FILL_SCRIPT, [
            cross.localRef,
            target.selector ?? null,
            value,
          ]);
        });
        this.lastSnapshot = null;
        const actual = filled?.value || "";
        const matched =
          Boolean(filled?.ok && filled.matched) && !isMojibake(value, actual);
        return {
          ok: matched,
          message: matched
            ? `已填入并回读确认 ${actual.length} 字（cdp-frame · ${FIX}）`
            : filled?.message || `CDP fill failed / mojibake [${FIX}]`,
          data: {
            target: target.ref || "",
            expected: value,
            actual,
            matched,
            kind: "input" as const,
            method: `cdp-frame:${FIX}`,
          },
        };
      }

      await wc
        .executeJavaScript(
          `(${FOCUS_SCRIPT})(${JSON.stringify(target.ref ?? null)}, ${JSON.stringify(target.selector ?? null)})`,
          true,
        )
        .catch(() => undefined);

      // Value as base64→TextDecoder only (ASCII in the script source).
      let result = (await wc.executeJavaScript(
        `(() => {
          const __v = ${cdpUtf8Expr(value)};
          return (${FILL_SCRIPT})(${JSON.stringify(target.ref ?? null)}, ${JSON.stringify(target.selector ?? null)}, __v);
        })()`,
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

      if (result.matched && isMojibake(value, result.actual)) {
        result = { ...result, matched: false, ok: false, message: `mojibake detected [${FIX}]` };
      }
      if (!result.matched && softFillMatch(value, result.actual || "")) {
        result = {
          ...result,
          matched: true,
          ok: true,
          message: `已填入并软确认 ${result.actual.length} 字（${result.method || result.kind} · ${FIX}）`,
        };
      }

      // Fallback: CDP Input.insertText (true Unicode), not per-char sendInputEvent
      if (!result.matched) {
        await this.insertTextUnicode(value);
        await sleep(200);
        let actual = (await wc.executeJavaScript(
          `(${FILL_SCRIPT_READ})(${JSON.stringify(target.ref ?? null)}, ${JSON.stringify(target.selector ?? null)})`,
          true,
        )) as string;
        let matched = softFillMatch(value, actual);
        // Last resort: focus visible selector + execCommand insertText (Pi-proven on XHS)
        if (!matched || !actual) {
          const fb = (await wc.executeJavaScript(
            `(() => {
              const __v = ${cdpUtf8Expr(value)};
              const sel = ${JSON.stringify(target.selector ?? null)};
              const ref = ${JSON.stringify(target.ref ?? null)};
              let el = null;
              if (ref) el = document.querySelector('[data-spark-ref="' + CSS.escape(ref) + '"]');
              if (!el && sel) {
                el = Array.from(document.querySelectorAll(sel)).find((n) => {
                  const b = n.getBoundingClientRect();
                  return b.width > 0 && b.height > 0;
                }) || document.querySelector(sel);
              }
              if (!el) return { ok: false, actual: '', message: 'no visible target' };
              const nested = el.querySelector('[contenteditable="true"],[contenteditable=""]');
              if (nested) el = nested;
              el.focus();
              try {
                const selApi = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(el);
                selApi && selApi.removeAllRanges();
                selApi && selApi.addRange(range);
                document.execCommand('delete', false, undefined);
              } catch (_) {}
              const ok = document.execCommand('insertText', false, __v);
              if (!ok && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
                const win = window;
                const proto = el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
                const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                if (setter) setter.call(el, __v); else el.value = __v;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              }
              const actualNow = (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
                ? String(el.value || '')
                : String(el.innerText || el.textContent || '').trim();
              return { ok: actualNow.length > 0, actual: actualNow, method: 'execCommand-insertText-fallback' };
            })()`,
            true,
          )) as { ok?: boolean; actual?: string; method?: string; message?: string };
          actual = fb?.actual || actual || "";
          matched = softFillMatch(value, actual);
          result = {
            ok: matched,
            message: matched
              ? `已 execCommand 填入并软确认 ${actual.length} 字（${FIX}+fallback）`
              : `fill fallback failed expected=${value.length} actual=${actual.length} [${FIX}]`,
            expected: value,
            actual,
            matched,
            kind: result.kind,
            target: result.target,
            method: fb?.method || `Input.insertText:${FIX}`,
          };
        } else {
          result = {
            ok: matched,
            message: matched
              ? `已 Input.insertText 并回读确认 ${actual.length} 字（${FIX}）`
              : `insertText 后仍不匹配 expected=${value.length} actual=${actual.length} [${FIX}]`,
            expected: value,
            actual,
            matched,
            kind: result.kind,
            target: result.target,
            method: `Input.insertText:${FIX}`,
          };
        }
      }

      this.pushStatus();
      this.lastSnapshot = null;
      return {
        ok: result.matched,
        message: result.matched
          ? `已填入并回读确认 ${result.actual.length} 字（${result.method || result.kind} · ${FIX}）`
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

  /** Insert Unicode text via CDP Input.insertText (avoids char-event Mojibake). */
  private async insertTextUnicode(text: string): Promise<void> {
    const wc = this.pageView.webContents;
    this.window.focus();
    wc.focus();
    await withDebugger(wc, async (send) => {
      await send("Input.insertText", { text });
    });
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
    // Prefer CDP Input.insertText for Unicode (Chinese). Per-char sendInputEvent
    // has caused Mojibake on some Windows/Electron paths.
    if (/[^\u0000-\u007f]/.test(value)) {
      await this.insertTextUnicode(value);
      return;
    }
    const wc = this.pageView.webContents;
    this.window.focus();
    wc.focus();

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
