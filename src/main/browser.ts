import {
  BrowserWindow,
  WebContentsView,
  Menu,
  dialog,
  app,
  ipcMain,
  session,
  clipboard,
  shell,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import type {
  ClickConfirm,
  FillConfirm,
  NavigateConfirm,
  PageSnapshot,
  SnapshotElement,
  ToolResult,
} from "../shared/types.js";
import { parseLocalIntent, type ChatAction } from "./agent/stub.js";
import { planUserGoal, shouldAskPlanner } from "./agent/planner.js";
import { missionProgress, missionSynthesizePrompt, type Mission } from "./agent/mission.js";
import {
  chromeUserAgent,
  oauthPopupWindowOptions,
  shouldAllowOauthPopup,
} from "./oauth-popups.js";
import {
  connectAgent,
  connectedStatus,
  copyForAgent,
  type AgentTarget,
} from "./agent-connect.js";
import { isContinueHint, readPageInstruction, sameSite } from "./agent/intent-router.js";
import {
  alreadyOnFeishuTask,
  FEISHU_MESSENGER_URL,
  feishuUrl,
  isFeishuLoginUrl,
  type FeishuTask,
} from "./agent/feishu.js";
import {
  ctripHotelListUrl,
  flightFallbackUrl,
  lifeProgress,
  resolveCtripHotelCity,
  isFlightResultUrl,
  shouldFallbackFlight,
  travelListState,
  travelReadPrompt,
  travelResultUrl,
  type TravelQuery,
} from "./agent/travel.js";
import {
  expandTripPlan,
  tripPlanProgress,
  tripSynthesizePrompt,
  type TripPlan,
} from "./agent/trip-plan.js";
import {
  loadProfile,
  profileBriefFor,
  recordVisit,
  saveIdentity,
  clearProfile,
  upsertDetectedAccount,
} from "./profile/store.js";
import {
  recordVisit as recordHistoryVisit,
  loadHistory,
  clearHistory,
} from "./history.js";
import { uniqueDownloadPath } from "./downloads.js";
import { loadChatMemory, saveChatMemory, clearChatMemory, type ChatTurn } from "./profile/chat-memory.js";
import {
  flightHintFromText,
  formatFlightLinks,
  formatHotelLinks,
  readingReportHtml,
  tripReportHtml,
  writeHtmlReport,
  type FlightLink,
  type HotelLink,
} from "./agent/report-html.js";
import {
  cloneEnv,
  createEnv,
  deleteEnv as deleteEnvConfig,
  getEnv,
  listEnvs,
  saveEnv,
} from "./envs/store.js";
import { isProxyAvailable, start as startEnvProxy, stop as stopEnvProxy, stopAll as stopAllEnvProxy } from "./envs/singbox-runner.js";
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
import { tx } from "../shared/i18n.js";
import { storeConfigDir } from "./paths.js";
import {
  loadSettings,
  saveSettings,
  settingsPublicView,
  type SparkSettings,
} from "./settings/store.js";
import { chatCompletionsUrl } from "./settings/llm-url.js";
import { accountUrl, cloudApiBase, isMsftChannel } from "./cloud/config.js";
import {
  clearTokens,
  fetchMe,
  loadTokens,
  sendLoginCode,
  verifyLogin,
  type QuotaSnap,
} from "./cloud/auth.js";
import { assertAndStartTask, settleCloudTask } from "./cloud/quota.js";
import { cloudFetch, hasCloudSession } from "./cloud/session.js";
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
  FIELD_VALUE_SCRIPT,
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
  CALENDAR_INSPECT_SCRIPT,
  SET_SPIN_SCRIPT,
  EXTRACT_HOTEL_LINKS_SCRIPT,
  FIND_DEST_INPUT_SCRIPT,
  PICK_SUGGEST_SCRIPT,
  FEISHU_STAGE_SCRIPT,
  FEISHU_OPEN_CHAT_SCRIPT,
  FEISHU_INJECT_TEXT_SCRIPT,
} from "./page-scripts.js";
import { executePrimitivesOnBrowser } from "./analyzer/execute-primitives.js";
import type { AnalyzedPage } from "./analyzer/types.js";
import {
  datetimeCommitted,
  parseDatetimeValue,
  twoDigit,
} from "./analyzer/datetime.js";
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

/**
 * Best-effort selectors for the logged-in user's display name on each site.
 * A stale or wrong selector is harmless — detection just yields nothing.
 */
const ACCOUNT_USERNAME_SELECTOR: Record<string, string> = {
  weibo: '[class*="gn_name"] , a[href*="/profile"] , .woo-box-row',
  zhihu: '.AppHeader-userInfo .AppHeader-userName, .ProfileHeader-name',
  xiaohongshu: '.user-info .name, .side-bar .user-name',
};

function accountSiteForHost(host: string): string | undefined {
  for (const s of DEFAULT_SESSION_SITES) {
    for (const d of s.domains) {
      const dh = d.replace(/^\./, "").toLowerCase();
      if (host === dh || host.endsWith("." + dh) || dh.endsWith("." + host)) return s.id;
    }
  }
  return undefined;
}

function resolveAppIconPath(): string {
  const candidates = [
    join(__dirname, "../../resources/icon.ico"),
    join(__dirname, "../../resources/icon.png"),
    join(process.cwd(), "resources/icon.ico"),
    join(process.cwd(), "resources/icon.png"),
    join(app.getAppPath(), "resources/icon.ico"),
    join(app.getAppPath(), "resources/icon.png"),
    join(__dirname, "../../src/renderer/icon.png"),
    join(process.resourcesPath || "", "icon.ico"),
    join(process.resourcesPath || "", "icon.png"),
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  return "";
}

const DEFAULT_URL = "https://www.google.com";
const CHROME_H = 104; // tabs 36 + omnibox 40 + bookmarks bar 28
const SIDEBAR_W = 312;

type TabInfo = {
  id: string;
  view: WebContentsView | null;
  title: string;
  url: string;
  envId?: string;
  discarded?: boolean;
  lastActiveAt: number;
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
  const extracted = url.match(/https?:\/\/[^\s\u4e00-\u9fff<>"'）)】\]]+/i);
  let target = (extracted ? extracted[0] : url).trim();
  target = target.replace(/[.,，。、；;!?？]+$/g, "");
  if (!target) return DEFAULT_URL;
  if (/^(https?:|file:|data:|about:)/i.test(target)) return target;
  if (/[\s\u4e00-\u9fff]/.test(target)) {
    target = target.split(/[\s\u4e00-\u9fff]/)[0] || target;
  }
  if (!target) return DEFAULT_URL;
  return `https://${target}`;
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
  private chatLog: ChatTurn[] = [];
  private chatRunning = false;
  private chatQueue: string[] = [];
  private ipcReady = false;
  private bookmarks: BookmarkItem[] = [];
  private recording = false;
  private recordingTask = "";
  private lastCs: CsDraftData | CsScanData | null = null;
  private lastFeishuTask: FeishuTask | null = null;
  private skillsCache: Skill[] = [];
  private settings!: SparkSettings;
  private deepseek: DeepSeekAgentProvider | null = null;
  private llmRuntime: "byok" | "cloud" = "byok";
  private cloudTaskId: string | undefined;
  private cloudQuota: QuotaSnap | null = null;
  private lastCloudRefuse = "";
  private memoryTimer: ReturnType<typeof setInterval> | null = null;
  private holeBounds: { x: number; y: number; width: number; height: number } | null = null;
  private overlay: "none" | "history" = "none";
  private findOpen = false;
  private lastClosed: { url: string; envId?: string } | null = null;
  private lastDownloadPath = "";
  private downloadSessions = new WeakSet<Electron.Session>();

  /** Active page view — keeps existing tool code working. */
  private getActiveTab(): TabInfo | null {
    return this.tabs.get(this.activeTabId) ?? null;
  }

  private get pageView(): WebContentsView {
    const tab = this.getActiveTab();
    if (!tab) throw new Error("No active tab");
    if (!tab.view || tab.discarded) this.wakeTab(tab.id);
    if (!tab.view) throw new Error("No active tab view");
    return tab.view;
  }

  /** Config + cookie + strategy cache root (%APPDATA%/sparo-store). */
  configDir(): string {
    return storeConfigDir();
  }

  /** @deprecated use configDir() */
  getConfigDir(): string {
    return this.configDir();
  }

  constructor() {
    Menu.setApplicationMenu(null);
    const iconPath = resolveAppIconPath();
    this.window = new BrowserWindow({
      width: 1360,
      height: 900,
      minWidth: 800,
      minHeight: 560,
      title: "Sparo",
      backgroundColor: "#f3f0ec",
      show: true,
      autoHideMenuBar: true,
      titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
      ...(process.platform === "darwin"
        ? {}
        : {
            titleBarOverlay: {
              color: "#eeeae6",
              symbolColor: "#1c1a18",
              height: 36,
            },
          }),
      ...(iconPath ? { icon: iconPath } : {}),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        // Sandboxed ESM preload often fails to expose contextBridge APIs.
        sandbox: false,
        preload: this.shellPreload(),
      },
    });
    this.window.setMenuBarVisibility(false);
    this.attachChromeShortcuts(this.window.webContents);
    this.attachDownloads(session.defaultSession);
    this.window.webContents.on("context-menu", (_e, params) => {
      const template: MenuItemConstructorOptions[] = [];
      if (params.selectionText) {
        template.push({ role: "copy" });
      }
      template.push({ role: "selectAll" });
      Menu.buildFromTemplate(template).popup({ window: this.window });
    });
    if (iconPath) {
      this.window.setIcon(iconPath);
    }

    this.bookmarks = loadSavedBookmarks(this.configDir());
    seedBundledSkills(this.configDir());
    this.skillsCache = listSkills(this.configDir());
    this.settings = loadSettings(this.configDir(), app.getLocale());
    this.rebuildDeepSeek();
    void this.refreshCloudQuota().then(() => this.pushSidebarState());
    this.chatLog = loadChatMemory(this.configDir());
    this.window.on("resize", () => this.layout());
    this.window.on("maximize", () => this.layout());
    this.window.on("unmaximize", () => this.layout());
    this.window.on("enter-full-screen", () => this.layout());
    this.window.on("leave-full-screen", () => this.layout());
    this.window.once("ready-to-show", () => this.presentWindow());
    this.window.webContents.once("did-finish-load", () => this.presentWindow());
    this.window.webContents.on("did-fail-load", (_e, code, desc, url) => {
      console.error("[shell] did-fail-load", code, desc, url);
      this.presentWindow();
    });
    setTimeout(() => this.presentWindow(), 800);
    this.registerIpc();
    this.createTab(DEFAULT_URL, true);
    this.memoryTimer = setInterval(() => this.autoDiscardIdleTabs(), 30_000);
    this.window.on("closed", () => {
      if (this.memoryTimer) {
        clearInterval(this.memoryTimer);
        this.memoryTimer = null;
      }
    });
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

  private makePageView(envId?: string): WebContentsView {
    const prefs = {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: true,
      preload: this.pagePreload(),
    };
    if (!envId) {
      const view = new WebContentsView({ webPreferences: prefs });
      view.webContents.setUserAgent(chromeUserAgent());
      return view;
    }
    const env = getEnv(this.configDir(), envId);
    if (!env) throw new Error(`环境 ${envId} 不存在`);
    const partition = `persist:env_${envId}`;
    const envSession = session.fromPartition(partition);
    this.attachDownloads(envSession);
    if (env.fingerprint.userAgent) {
      envSession.setUserAgent(env.fingerprint.userAgent);
    }
    const proxy = startEnvProxy(env);
    if (proxy.ok && proxy.mode === "proxy") {
      envSession.setProxy({
        proxyRules: `socks5://127.0.0.1:${proxy.localPort}`,
        proxyBypassRules: "<-loopback>",
      });
    }
    const view = new WebContentsView({
      session: envSession,
      webPreferences: prefs,
    } as unknown as Electron.WebContentsViewConstructorOptions);
    if (!env.fingerprint.userAgent) {
      view.webContents.setUserAgent(chromeUserAgent());
    }
    return view;
  }

  private bindPageWebContents(tab: TabInfo): void {
    const view = tab.view;
    if (!view) return;
    const wc = view.webContents;
    const id = tab.id;
    try {
      wc.setBackgroundThrottling(true);
    } catch {
      /* older Electron */
    }
    attachPageContextMenu(wc, {
      openInNewTab: (openUrl) => {
        if (tab.envId) this.createEnvTab(tab.envId, openUrl);
        else this.createTab(openUrl, true);
      },
      t: (key) => tx(this.settings.locale, key),
      canGoBack: () => this.navCanGoBack(wc),
      canGoForward: () => this.navCanGoForward(wc),
      goBack: () => void this.goBack({ asHuman: true }),
      goForward: () => void this.goForward({ asHuman: true }),
      reload: () => void this.reload({ asHuman: true }),
      print: () => this.printPage(),
      find: () => this.openFind(),
    });
    this.attachChromeShortcuts(wc);
    wc.setUserAgent(chromeUserAgent());
    wc.on("did-create-window", (child) => {
      try {
        child.setMenuBarVisibility(false);
        child.webContents.setUserAgent(chromeUserAgent());
        child.show();
        child.focus();
      } catch {
        /* ignore */
      }
    });
    wc.setWindowOpenHandler((details) => {
      if (shouldAllowOauthPopup(details)) {
        return {
          action: "allow",
          overrideBrowserWindowOptions: oauthPopupWindowOptions(),
        };
      }
      const openUrl = details.url;
      if (openUrl && openUrl !== "about:blank") {
        if (tab.envId) this.createEnvTab(tab.envId, openUrl);
        else this.createTab(openUrl, true);
      }
      return { action: "deny" };
    });
    const sync = () => {
      if (wc.isDestroyed()) return;
      tab.url = wc.getURL() || tab.url;
      tab.title = wc.getTitle() || tab.title;
      this.pushChromeState();
      this.pushSidebarState();
    };
    wc.on("page-title-updated", (_e, title) => {
      tab.title = title;
      this.pushChromeState();
    });
    wc.on("did-navigate", (_e, navUrl) => {
      sync();
      this.noteNavigation(String(navUrl || ""));
    });
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
    wc.on("did-stop-loading", () => this.pushChromeState());
    wc.on("found-in-page", (_e, result) => {
      try {
        this.window.webContents.send("spark:find-result", {
          active: result.activeMatchOrdinal,
          total: result.matches,
        });
      } catch {
        /* ignore */
      }
    });
  }

  /**
   * Destroy an inactive tab's Chromium renderer. Title/URL stay; click the tab to reload.
   * This is the only way to actually free ~150–250MB per heavy page (YouTube Studio, etc.).
   */
  discardTab(id: string): boolean {
    const tab = this.tabs.get(id);
    if (!tab || tab.discarded || id === this.activeTabId) return false;
    const view = tab.view;
    if (!view) {
      tab.discarded = true;
      return true;
    }
    const wc = view.webContents;
    try {
      if (!wc.isDestroyed() && wc.isCurrentlyAudible()) return false;
      if (!wc.isDestroyed()) {
        tab.url = wc.getURL() || tab.url;
        tab.title = wc.getTitle() || tab.title;
      }
    } catch {
      /* ignore */
    }
    try {
      this.window.contentView.removeChildView(view);
    } catch {
      /* ignore */
    }
    try {
      if (!wc.isDestroyed()) wc.close();
    } catch {
      /* ignore */
    }
    tab.view = null;
    tab.discarded = true;
    return true;
  }

  private wakeTab(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab) return;
    if (tab.view && !tab.discarded) return;
    if (tab.view) {
      tab.discarded = false;
      return;
    }
    try {
      const view = this.makePageView(tab.envId);
      tab.view = view;
      this.window.contentView.addChildView(view);
      this.bindPageWebContents(tab);
      tab.discarded = false;
      tab.lastActiveAt = Date.now();
      this.layout();
      void view.webContents.loadURL(normalizeUrl(tab.url || DEFAULT_URL));
    } catch (err) {
      console.error("[sparo] wakeTab failed:", err);
    }
  }

  /** Sleep every background tab now. Playing audio is skipped. */
  discardInactiveTabs(): ToolResult {
    let n = 0;
    for (const id of [...this.tabs.keys()]) {
      if (this.discardTab(id)) n += 1;
    }
    this.layout();
    this.pushChromeState();
    return {
      ok: true,
      message:
        n > 0
          ? tx(this.settings.locale, "mem.slept", { n })
          : tx(this.settings.locale, "mem.none"),
      data: { discarded: n, ...this.listTabs() },
    };
  }

  private autoDiscardIdleTabs(): void {
    if (!this.settings?.memorySaver) return;
    if (this.tabs.size <= 1) return;
    const idleMs = (this.settings.memorySaverIdleMinutes || 2) * 60_000;
    const now = Date.now();
    let n = 0;
    for (const [id, tab] of this.tabs) {
      if (id === this.activeTabId || tab.discarded) continue;
      if (now - (tab.lastActiveAt || 0) < idleMs) continue;
      if (this.discardTab(id)) n += 1;
    }
    if (n > 0) {
      this.layout();
      this.pushChromeState();
    }
  }

  private createTab(url = DEFAULT_URL, activate = true): string {
    const id = randomBytes(4).toString("hex");
    const view = this.makePageView();
    const tab: TabInfo = {
      id,
      view,
      title: tx(this.settings.locale, "tab.new"),
      url,
      lastActiveAt: Date.now(),
    };
    this.tabs.set(id, tab);
    if (activate) this.activeTabId = id;
    this.window.contentView.addChildView(view);
    this.bindPageWebContents(tab);
    this.layout();
    void view.webContents.loadURL(normalizeUrl(url));
    if (activate) this.switchTab(id);
    else this.layout();
    return id;
  }

  /**
   * Open a tab inside an account environment: its own Chromium partition
   * (cookies/localStorage isolated), the env's UA, and the env's sing-box
   * proxy if one is running. Fingerprint JS injection is P1, not here.
   */
  createEnvTab(envId: string, url = DEFAULT_URL): string {
    const env = getEnv(this.configDir(), envId);
    if (!env) throw new Error(`环境 ${envId} 不存在`);
    const id = randomBytes(4).toString("hex");
    const view = this.makePageView(envId);
    const tab: TabInfo = {
      id,
      view,
      title: env.account.name,
      url,
      envId,
      lastActiveAt: Date.now(),
    };
    this.tabs.set(id, tab);
    this.window.contentView.addChildView(view);
    this.bindPageWebContents(tab);
    this.layout();
    void view.webContents.loadURL(normalizeUrl(url));
    this.switchTab(id);
    return id;
  }

  listTabs(): {
    tabs: Array<{ id: string; title: string; url: string; discarded?: boolean }>;
    activeId: string;
    url: string;
    canGoBack: boolean;
    canGoForward: boolean;
    isLoading: boolean;
  } {
    const active = this.tabs.get(this.activeTabId);
    const wc = active?.view?.webContents;
    const wcLive = wc && !wc.isDestroyed() ? wc : undefined;
    return {
      tabs: [...this.tabs.values()].map((t) => ({
        id: t.id,
        title: t.title,
        url:
          t.url ||
          (t.view && !t.view.webContents.isDestroyed() ? t.view.webContents.getURL() : ""),
        discarded: Boolean(t.discarded || !t.view),
      })),
      activeId: this.activeTabId,
      url: wcLive ? wcLive.getURL() : active?.url || "",
      canGoBack: Boolean(wcLive && this.navCanGoBack(wcLive)),
      canGoForward: Boolean(wcLive && this.navCanGoForward(wcLive)),
      isLoading: Boolean(wcLive && wcLive.isLoading()),
    };
  }

  switchTab(id: string): ToolResult {
    if (!this.tabs.has(id)) return { ok: false, message: `Tab not found: ${id}` };
    this.wakeTab(id);
    this.activeTabId = id;
    const tab = this.tabs.get(id);
    if (tab) tab.lastActiveAt = Date.now();
    this.lastSnapshot = null;
    this.layout();
    this.focusActivePage();
    this.pushChromeState();
    this.pushSidebarState();
    return { ok: true, message: `Switched to tab ${id}`, data: this.listTabs() };
  }

  openReport(filePath: string): ToolResult {
    const reports = resolvePath(join(this.configDir(), "reports"));
    const abs = resolvePath(filePath);
    if (!abs.toLowerCase().startsWith(reports.toLowerCase())) {
      return { ok: false, message: "文档路径无效" };
    }
    if (!existsSync(abs)) {
      return { ok: false, message: "文档已经不在了" };
    }
    return this.newTab(pathToFileURL(abs).href);
  }

  newTab(url?: string): ToolResult {
    const id = this.createTab(url || DEFAULT_URL, true);
    return { ok: true, message: `Opened tab ${id}`, data: { id, ...this.listTabs() } };
  }

  closeTab(id: string): ToolResult {
    const tab = this.tabs.get(id);
    if (!tab) return { ok: false, message: `Tab not found: ${id}` };
    let closedUrl = tab.url || "about:blank";
    try {
      const live = tab.view?.webContents;
      if (live && !live.isDestroyed()) closedUrl = live.getURL() || closedUrl;
    } catch {
      /* ignore */
    }
    this.lastClosed = { url: closedUrl, envId: tab.envId };
    if (this.tabs.size <= 1) {
      this.createTab("about:blank", true);
    }
    if (tab.view) {
      try {
        this.window.contentView.removeChildView(tab.view);
      } catch {
        /* ignore */
      }
      try {
        const wc = tab.view.webContents;
        if (!wc.isDestroyed()) wc.close();
      } catch {
        /* ignore */
      }
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

  /** First show only. Later calls must not center() — that fights the user dragging the window. */
  private didPlaceWindow = false;
  presentWindow(): void {
    if (this.window.isDestroyed()) return;
    try {
      const iconPath = resolveAppIconPath();
      if (iconPath) this.window.setIcon(iconPath);
      this.layout();
      if (this.window.isMinimized()) this.window.restore();
      if (!this.didPlaceWindow) {
        this.window.center();
        this.didPlaceWindow = true;
      }
      this.window.show();
      this.window.focus();
    } catch (error) {
      console.error("[shell] presentWindow failed:", error);
    }
  }

  private attachChromeShortcuts(wc: WebContents): void {
    wc.on("before-input-event", (event, input) => {
      if (this.handleChromeShortcut(input)) event.preventDefault();
    });
  }

  private handleChromeShortcut(input: Electron.Input): boolean {
    if (input.type !== "keyDown") return false;
    const key = String(input.key || "").toLowerCase();
    const ctrl = Boolean(input.control || input.meta);
    const shift = Boolean(input.shift);
    const alt = Boolean(input.alt);

    if (ctrl && !alt && !shift && key === "t") {
      this.newTab();
      return true;
    }
    if (ctrl && shift && !alt && key === "t") {
      this.reopenLastTab();
      return true;
    }
    if (ctrl && !alt && !shift && (key === "w" || key === "f4")) {
      this.closeTab(this.activeTabId);
      return true;
    }
    if ((ctrl && !alt && !shift && key === "l") || key === "f6" || (alt && !ctrl && key === "d")) {
      this.focusOmnibox();
      return true;
    }
    if (ctrl && !alt && !shift && key === "f") {
      this.openFind();
      return true;
    }
    if (key === "f3" || (ctrl && !alt && !shift && key === "g")) {
      this.window.webContents.send("spark:find-again", { forward: !shift });
      return true;
    }
    if (ctrl && shift && key === "g") {
      this.window.webContents.send("spark:find-again", { forward: false });
      return true;
    }
    if (ctrl && !alt && !shift && key === "p") {
      this.printPage();
      return true;
    }
    if (ctrl && !alt && !shift && key === "h") {
      this.toggleHistory();
      return true;
    }
    if (ctrl && !alt && !shift && key === "j") {
      this.showLastDownload();
      return true;
    }
    if (ctrl && !alt && !shift && key === "r") {
      void this.reload({ asHuman: true });
      return true;
    }
    if (ctrl && shift && key === "r") {
      void this.reload({ asHuman: true, ignoreCache: true });
      return true;
    }
    if (key === "f5") {
      void this.reload({ asHuman: true });
      return true;
    }
    if (alt && !ctrl && key === "arrowleft") {
      void this.goBack({ asHuman: true });
      return true;
    }
    if (alt && !ctrl && key === "arrowright") {
      void this.goForward({ asHuman: true });
      return true;
    }
    if (ctrl && key === "tab") {
      this.cycleTab(shift ? -1 : 1);
      return true;
    }
    if (ctrl && !alt && !shift && key === "pagedown") {
      this.cycleTab(1);
      return true;
    }
    if (ctrl && !alt && !shift && key === "pageup") {
      this.cycleTab(-1);
      return true;
    }
    if (ctrl && !alt && !shift && /^[1-8]$/.test(key)) {
      this.switchTabByIndex(Number(key) - 1);
      return true;
    }
    if (ctrl && !alt && !shift && key === "9") {
      this.switchTabByIndex(this.tabs.size - 1);
      return true;
    }
    if (ctrl && !alt && (key === "+" || key === "=" || key === "add")) {
      this.adjustZoom(0.1);
      return true;
    }
    if (ctrl && !alt && (key === "-" || key === "subtract")) {
      this.adjustZoom(-0.1);
      return true;
    }
    if (ctrl && !alt && !shift && key === "0") {
      this.setZoomFactor(1);
      return true;
    }
    if (key === "f11") {
      this.window.setFullScreen(!this.window.isFullScreen());
      return true;
    }
    if (key === "f12") {
      this.togglePageDevTools();
      return true;
    }
    if (ctrl && !alt && !shift && key === "d") {
      this.toggleCurrentBookmark();
      return true;
    }
    if (key === "escape") {
      if (this.handleEscape()) return true;
    }
    return false;
  }

  private cycleTab(delta: number): void {
    const ids = [...this.tabs.keys()];
    if (ids.length < 2) return;
    const i = Math.max(0, ids.indexOf(this.activeTabId));
    const next = ids[(i + delta + ids.length) % ids.length];
    if (next) this.switchTab(next);
  }

  private switchTabByIndex(index: number): void {
    const ids = [...this.tabs.keys()];
    const id = ids[Math.min(Math.max(0, index), ids.length - 1)];
    if (id) this.switchTab(id);
  }

  private focusOmnibox(): void {
    try {
      this.window.webContents.focus();
      void this.window.webContents.executeJavaScript(
        `(() => { const el = document.getElementById("url"); if (!el) return; el.focus(); el.select(); })()`,
      );
    } catch {
      /* ignore */
    }
  }

  private adjustZoom(delta: number): void {
    const wc = this.pageView?.webContents;
    if (!wc || wc.isDestroyed()) return;
    const next = Math.min(3, Math.max(0.3, wc.getZoomFactor() + delta));
    wc.setZoomFactor(next);
  }

  private setZoomFactor(factor: number): void {
    const wc = this.pageView?.webContents;
    if (!wc || wc.isDestroyed()) return;
    wc.setZoomFactor(factor);
  }

  private togglePageDevTools(): void {
    const wc = this.pageView?.webContents;
    if (!wc || wc.isDestroyed()) return;
    if (wc.isDevToolsOpened()) wc.closeDevTools();
    else wc.openDevTools({ mode: "detach" });
  }

  toggleMaximize(): ToolResult {
    if (this.window.isMaximized()) this.window.unmaximize();
    else this.window.maximize();
    return { ok: true, message: this.window.isMaximized() ? "maximized" : "restored" };
  }

  private attachDownloads(ses: Electron.Session): void {
    if (this.downloadSessions.has(ses)) return;
    this.downloadSessions.add(ses);
    ses.on("will-download", (_e, item) => {
      const dest = uniqueDownloadPath(app.getPath("downloads"), item.getFilename());
      item.setSavePath(dest);
      this.sendToast(tx(this.settings.locale, "download.start", { name: item.getFilename() }));
      item.on("done", (_ev, state) => {
        if (state === "completed") {
          this.lastDownloadPath = dest;
          this.sendToast(tx(this.settings.locale, "download.done", { name: item.getFilename() }), dest);
        } else if (state !== "cancelled") {
          this.sendToast(tx(this.settings.locale, "download.fail", { name: item.getFilename() }));
        }
        this.pushChromeState();
      });
    });
  }

  private sendToast(text: string, path?: string): void {
    if (this.window.isDestroyed() || this.window.webContents.isDestroyed()) return;
    try {
      this.window.webContents.send("spark:toast", { text, path: path || "" });
    } catch {
      /* ignore */
    }
  }

  private livePage(): WebContents | null {
    const tab = this.getActiveTab();
    const wc = tab?.view?.webContents;
    if (!wc || wc.isDestroyed()) return null;
    return wc;
  }

  private handleEscape(): boolean {
    if (this.overlay === "history") {
      this.closeHistory();
      return true;
    }
    if (this.findOpen) {
      this.stopFind();
      return true;
    }
    const wc = this.livePage();
    if (wc?.isLoading()) {
      wc.stop();
      return true;
    }
    if (this.window.isFullScreen()) {
      this.window.setFullScreen(false);
      return true;
    }
    return false;
  }

  openFind(): void {
    if (this.overlay === "history") this.closeHistory();
    this.findOpen = true;
    try {
      this.window.webContents.focus();
      this.window.webContents.send("spark:open-find");
    } catch {
      /* ignore */
    }
  }

  findInPage(query: string, opts?: { forward?: boolean; findNext?: boolean }): void {
    const wc = this.livePage();
    if (!wc) return;
    const q = String(query || "");
    if (!q) {
      wc.stopFindInPage("clearSelection");
      return;
    }
    wc.findInPage(q, {
      forward: opts?.forward !== false,
      findNext: Boolean(opts?.findNext),
    });
  }

  stopFind(): void {
    this.findOpen = false;
    const wc = this.livePage();
    try {
      wc?.stopFindInPage("clearSelection");
    } catch {
      /* ignore */
    }
    try {
      this.window.webContents.send("spark:close-find");
    } catch {
      /* ignore */
    }
  }

  printPage(): void {
    if (this.overlay === "history") this.closeHistory();
    const wc = this.livePage();
    if (!wc) return;
    wc.print({});
  }

  stopLoading(): ToolResult {
    const wc = this.livePage();
    if (wc?.isLoading()) wc.stop();
    this.pushChromeState();
    return { ok: true, message: "stopped" };
  }

  toggleHistory(): void {
    if (this.overlay === "history") this.closeHistory();
    else this.openHistory();
  }

  openHistory(): void {
    this.overlay = "history";
    this.layout();
    try {
      this.window.webContents.focus();
      this.window.webContents.send("spark:history", {
        items: loadHistory(this.configDir()),
      });
    } catch {
      /* ignore */
    }
  }

  closeHistory(): void {
    this.overlay = "none";
    this.layout();
    try {
      this.window.webContents.send("spark:history", { items: null });
    } catch {
      /* ignore */
    }
    this.focusActivePage();
  }

  clearVisitHistory(): ToolResult {
    clearHistory(this.configDir());
    try {
      this.window.webContents.send("spark:history", { items: [] });
    } catch {
      /* ignore */
    }
    return { ok: true, message: tx(this.settings.locale, "history.cleared") };
  }

  reopenLastTab(): ToolResult {
    const last = this.lastClosed;
    if (!last) return { ok: false, message: "nothing to reopen" };
    this.lastClosed = null;
    if (last.envId) {
      const id = this.createEnvTab(last.envId, last.url);
      return { ok: true, message: `Reopened ${id}`, data: this.listTabs() };
    }
    return this.newTab(last.url);
  }

  reorderTabs(fromId: string, toId: string): ToolResult {
    const from = String(fromId || "");
    const to = String(toId || "");
    if (!from || !to || from === to) return { ok: true, data: this.listTabs() };
    const ids = [...this.tabs.keys()];
    const fromIndex = ids.indexOf(from);
    const toIndex = ids.indexOf(to);
    if (fromIndex < 0 || toIndex < 0) return { ok: false, message: "tab not found" };
    ids.splice(fromIndex, 1);
    ids.splice(toIndex, 0, from);
    const next = new Map<string, TabInfo>();
    for (const id of ids) {
      const tab = this.tabs.get(id);
      if (tab) next.set(id, tab);
    }
    this.tabs = next;
    this.pushChromeState();
    return { ok: true, data: this.listTabs() };
  }

  showLastDownload(): void {
    if (this.lastDownloadPath) {
      shell.showItemInFolder(this.lastDownloadPath);
      return;
    }
    void shell.openPath(app.getPath("downloads"));
  }

  showInFolder(filePath: string): void {
    const p = String(filePath || "");
    if (p) shell.showItemInFolder(p);
  }

  setPageHoleBounds(raw: { x?: number; y?: number; width?: number; height?: number }): void {
    const x = Math.round(Number(raw?.x) || 0);
    const y = Math.round(Number(raw?.y) || 0);
    const width = Math.round(Number(raw?.width) || 0);
    const height = Math.round(Number(raw?.height) || 0);
    if (width < 80 || height < 80) return;
    const prev = this.holeBounds;
    if (
      prev &&
      prev.x === x &&
      prev.y === y &&
      prev.width === width &&
      prev.height === height
    ) {
      return;
    }
    this.holeBounds = { x, y, width, height };
    this.applyViewBounds();
  }

  private pageBounds(): { x: number; y: number; width: number; height: number } {
    if (
      this.holeBounds &&
      this.holeBounds.width >= 80 &&
      this.holeBounds.height >= 80
    ) {
      return this.holeBounds;
    }
    const [width, height] = this.window.getContentSize();
    return {
      x: 0,
      y: CHROME_H,
      width: Math.max(100, width - SIDEBAR_W),
      height: Math.max(100, height - CHROME_H),
    };
  }

  private applyViewBounds(): void {
    if (this.window.isDestroyed()) return;
    const bounds = this.pageBounds();
    const hidePage = this.overlay !== "none";
    for (const [id, tab] of this.tabs) {
      if (!tab.view) continue;
      const active = id === this.activeTabId && !hidePage;
      try {
        if (active) {
          tab.view.setBounds(bounds);
          tab.view.setVisible(true);
          tab.view.setBounds(bounds);
        } else {
          tab.view.setVisible(false);
          tab.view.setBounds({
            x: -20000,
            y: 0,
            width: Math.max(bounds.width, 100),
            height: Math.max(bounds.height, 100),
          });
        }
      } catch {
        /* 视图已销毁 */
      }
    }
  }

  private layout(): void {
    this.applyViewBounds();
  }

  private focusActivePage(): void {
    try {
      const tab = this.getActiveTab();
      if (!tab || !tab.view || tab.view.webContents.isDestroyed()) return;
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
    ipcMain.removeAllListeners("spark:page-hole");
    ipcMain.on("spark:page-hole", (_e, raw) => this.setPageHoleBounds(raw || {}));
    handle("spark:navigate", async (_e, url: string) =>
      this.navigate(String(url || ""), { asHuman: true }),
    );
    handle("spark:go-back", async () => this.goBack({ asHuman: true }));
    handle("spark:go-forward", async () => this.goForward({ asHuman: true }));
    handle("spark:reload", async () => this.reload({ asHuman: true }));
    handle("spark:toggle-maximize", async () => this.toggleMaximize());
    handle("spark:new-tab", async (_e, url?: string) => this.newTab(url));
    handle("spark:close-tab", async (_e, id: string) => this.closeTab(String(id)));
    handle("spark:switch-tab", async (_e, id: string) => this.switchTab(String(id)));
    handle("spark:list-tabs", async () => this.listTabs());
    handle("spark:discard-inactive-tabs", async () => this.discardInactiveTabs());
    handle("spark:clear-chat", async () => this.clearChat());
    handle("spark:reorder-tabs", async (_e, fromId: string, toId: string) =>
      this.reorderTabs(String(fromId || ""), String(toId || "")),
    );
    handle("spark:stop", async () => this.stopLoading());
    handle("spark:print", async () => {
      this.printPage();
      return { ok: true };
    });
    handle("spark:find", async (_e, query: string, opts?: { forward?: boolean; findNext?: boolean }) => {
      this.findInPage(String(query || ""), opts);
      return { ok: true };
    });
    handle("spark:stop-find", async () => {
      this.stopFind();
      return { ok: true };
    });
    handle("spark:open-history", async () => {
      this.openHistory();
      return { ok: true, items: loadHistory(this.configDir()) };
    });
    handle("spark:close-history", async () => {
      this.closeHistory();
      return { ok: true };
    });
    handle("spark:clear-history", async () => this.clearVisitHistory());
    handle("spark:show-in-folder", async (_e, filePath: string) => {
      this.showInFolder(String(filePath || ""));
      return { ok: true };
    });
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
    handle("spark:open-report", async (_e, filePath: string) =>
      this.openReport(String(filePath || "")),
    );
    handle("spark:cs-scan", async (_e, opts?: { fromHuman?: boolean }) =>
      this.csScan(opts),
    );
    handle("spark:cs-draft", async (
      _e,
      opts?: { draft?: string; fill?: boolean; preferLlm?: boolean; fromHuman?: boolean },
    ) => this.csDraftReply(opts || {}));
    handle("spark:cs-one-click", async () =>
      this.csOneClickReply(),
    );
    handle("spark:get-settings", async () => ({
      ok: true,
      settings: this.settingsPublic(),
      cloud: this.cloudPublic(),
    }));
    handle("spark:get-profile", async () => {
      const p = loadProfile(this.configDir());
      return {
        ok: true,
        identity: p.identity,
        accounts: p.learned.accounts,
        brief: profileBriefFor(this.configDir()),
      };
    });
    handle("spark:save-identity", async (_e, patch) => {
      const next = saveIdentity(this.configDir(), patch || {});
      return {
        ok: true,
        identity: next.identity,
        accounts: next.learned.accounts,
        brief: profileBriefFor(this.configDir()),
      };
    });
    handle("spark:clear-profile", async () => {
      clearProfile(this.configDir());
      return { ok: true, brief: "" };
    });

    // ---- Multi-account environments (decoupled from profile) ----
    handle("spark:list-envs", async () => ({
      ok: true,
      envs: listEnvs(this.configDir()).map((e) => ({
        id: e.id,
        name: e.account.name,
        type: e.account.type,
        note: e.account.note,
        enabled: e.enabled,
        proxyAvailable: isProxyAvailable(),
        proxyRunning: false, // runner state not exposed yet at P0
        homeUrl: e.account.homeUrl,
      })),
    }));
    handle("spark:create-env", async (_e, init) => {
      const env = createEnv(this.configDir(), init || {});
      return { ok: true, id: env.id, env: { id: env.id, name: env.account.name, type: env.account.type } };
    });
    handle("spark:save-env", async (_e, patch) => {
      const current = getEnv(this.configDir(), String(patch?.id || ""));
      if (!current) return { ok: false, message: "环境不存在" };
      const next = saveEnv(this.configDir(), { ...current, ...patch, id: current.id });
      return { ok: true, env: { id: next.id, name: next.account.name } };
    });
    handle("spark:clone-env", async (_e, envId) => {
      const c = cloneEnv(this.configDir(), String(envId || ""));
      return c ? { ok: true, id: c.id } : { ok: false, message: "源环境不存在" };
    });
    handle("spark:delete-env", async (_e, envId) => {
      stopEnvProxy(String(envId || ""));
      return { ok: deleteEnvConfig(this.configDir(), String(envId || "")) };
    });
    handle("spark:open-env", async (_e, envId) => {
      try {
        const id = this.createEnvTab(String(envId));
        return { ok: true, tabId: id };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });
    handle("spark:save-settings", async (_e, patch: Partial<SparkSettings>) => {
      this.settings = saveSettings(this.configDir(), patch || {});
      this.rebuildDeepSeek();
      this.pushSidebarState();
      const hasKey = Boolean((this.settings.apiKey || this.settings.deepseekApiKey || "").trim());
      const toastKey =
        this.settings.llmMode === "cloud"
          ? hasCloudSession(this.configDir())
            ? "toast.cloudMode"
            : "toast.cloudNeedLogin"
          : hasKey
            ? "toast.apiOk"
            : "toast.savedNoKey";
      return {
        ok: true,
        message: tx(this.settings.locale, toastKey),
        settings: this.settingsPublic(),
        cloud: this.cloudPublic(),
      };
    });
    handle("spark:cloud-send-code", async (_e, email: string) => {
      try {
        const message = await sendLoginCode(String(email || ""));
        return { ok: true, message };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    });
    handle("spark:cloud-verify", async (_e, email: string, code: string) => {
      try {
        this.cloudQuota = await verifyLogin(
          this.configDir(),
          String(email || ""),
          String(code || ""),
        );
        if (this.settings.llmMode !== "cloud") {
          this.settings = saveSettings(this.configDir(), { llmMode: "cloud" });
        }
        this.rebuildDeepSeek();
        this.pushSidebarState();
        return { ok: true, message: tx(this.settings.locale, "toast.cloudIn"), cloud: this.cloudPublic() };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    });
    handle("spark:cloud-logout", async () => {
      clearTokens(this.configDir());
      this.cloudQuota = null;
      this.rebuildDeepSeek();
      this.pushSidebarState();
      return { ok: true, message: tx(this.settings.locale, "toast.cloudOut"), cloud: this.cloudPublic() };
    });
    handle("spark:cloud-open-account", async () => {
      await shell.openExternal(accountUrl());
      return { ok: true };
    });
    handle("spark:cloud-refresh", async () => {
      await this.refreshCloudQuota();
      this.pushSidebarState();
      return { ok: true, cloud: this.cloudPublic() };
    });
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
      return { ok: true, message: tx(this.settings.locale, "bookmark.cleared") };
    });
    handle("spark:copy-agent-connect", async () => this.copyAgentConnect());
    handle("spark:connect-agent", async (_e, target: string) => {
      const t = target === "claude" ? "claude" : "cursor";
      return connectAgent(t as AgentTarget, this.settings.locale);
    });
    handle("spark:agent-connect-status", async () => ({
      ok: true,
      ...connectedStatus(),
    }));
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

    const loc = this.settings.locale;
    const template: MenuItemConstructorOptions[] = [
      {
        label: tx(loc, state.currentBookmarked ? "bookmark.unpage" : "bookmark.page"),
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
        label: tx(loc, "bookmark.importChrome"),
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
        label: tx(loc, "bookmark.importEdge"),
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
        template.push({
          label: tx(loc, "bookmark.hidden", { n: bookmarkItems.length }),
          enabled: false,
        });
        template.push(...bookmarkItems);
      } else {
        // Split into chunks of 30 as submenus so Windows menu height stays usable.
        const chunk = 30;
        for (let i = 0; i < bookmarkItems.length; i += chunk) {
          const part = bookmarkItems.slice(i, i + chunk);
          template.push({
            label: tx(loc, "bookmark.range", { from: i + 1, to: i + part.length }),
            submenu: part,
          });
        }
      }
    }

    template.push(
      { type: "separator" },
      {
        label: tx(loc, "bookmark.clear"),
        enabled: state.total > 0,
        click: () => {
          this.bookmarks = [];
          saveBookmarks(this.configDir(), this.bookmarks);
          this.pushChromeState();
          this.window.webContents
            .executeJavaScript(
              `window.__sparkToast && window.__sparkToast(${JSON.stringify(tx(loc, "bookmark.cleared"))})`,
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
      saveChatMemory(this.configDir(), this.chatLog);
    } catch (error) {
      console.error("[shell] pushSidebarState failed:", error);
    }
  }

  clearChat(): ToolResult {
    this.chatLog = [];
    this.lastCs = null;
    clearChatMemory(this.configDir());
    this.pushSidebarState();
    return { ok: true, message: tx(this.settings.locale, "chat.cleared") };
  }

  /**
   * Record a navigation into the learned profile. Only full navigations land here
   * (not in-page), and we dedupe by host so a reload or anchor jump does not spam.
   */
  private _lastNavHost = "";
  private noteNavigation(url: string): void {
    let host = "";
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return;
    }
    if (!host) return;
    const tab = this.getActiveTab();
    try {
      recordHistoryVisit(this.configDir(), url, tab?.title || host);
    } catch {
      /* best-effort */
    }
    if (host === this._lastNavHost) return;
    this._lastNavHost = host;
    try {
      recordVisit(this.configDir(), host);
      void this.detectAccountOnSite(host, url);
    } catch {
      /* best-effort */
    }
  }

  /** Best-effort: if the user is logged into a known site, capture their handle. */
  private async detectAccountOnSite(host: string, url: string): Promise<void> {
    const site = accountSiteForHost(host);
    if (!site) return;
    const selector = ACCOUNT_USERNAME_SELECTOR[site];
    if (!selector) return;
    const wc = this.pageView.webContents;
    try {
      const username = (await wc.executeJavaScript(
        `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? (el.textContent || el.value || "").trim() : ""; })()`,
        true,
      )) as string;
      if (username && username.length >= 2 && username.length <= 40) {
        upsertDetectedAccount(this.configDir(), site, username);
      }
    } catch {
      /* page not ready or selector stale */
    }
  }

  /** Compact profile view for the sidebar — nickname + accounts, nothing raw. */
  private profilePublic(): { nickname: string; accounts: { site: string; username: string }[] } {
    try {
      const p = loadProfile(this.configDir());
      const accounts = p.identity.accounts
        .concat(p.learned.accounts)
        .map((a) => ({ site: a.site, username: a.username }));
      return { nickname: p.identity.nickname, accounts };
    } catch {
      return { nickname: "", accounts: [] };
    }
  }

  private getSidebarPayload() {
    pruneStaleApprovals(this.approvals);
    return {
      paused: this.paused,
      agentConnect: connectedStatus(),
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
      deepseek: this.settingsPublic(),
      cloud: this.cloudPublic(),
      profile: this.profilePublic(),
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
        pause: tx(this.settings.locale, "status.paused"),
        approval: tx(this.settings.locale, "approvals.label"),
        wait: "",
        skill: "",
        cs: tx(this.settings.locale, "cs.idleHint"),
        workflow: "",
      },
      locale: this.settings.locale,
    };
  }

  copyAgentConnect(): { ok: boolean; message: string } {
    const r = copyForAgent(this.settings.locale);
    if (r.ok) clipboard.writeText(r.text);
    return { ok: r.ok, message: r.message };
  }

  async importBookmarks(source: "chrome" | "edge"): Promise<ToolResult> {
    const label = source === "chrome" ? "Chrome" : "Edge";
    const loc = this.settings.locale;
    try {
      const sources = chromiumBookmarkPaths();
      const found = sources.find((s) => s.id === source);
      if (!found?.exists) {
        return { ok: false, message: tx(loc, "dialog.noBookmarksFile", { label }) };
      }

      const prompt = await dialog.showMessageBox(this.window, {
        type: "question",
        buttons: [tx(loc, "confirm.cancel"), tx(loc, "dialog.import")],
        defaultId: 1,
        cancelId: 0,
        title: tx(loc, "dialog.importTitle"),
        message: tx(loc, "dialog.importMsg", { label }),
        detail: tx(loc, "dialog.importDetail"),
      });
      if (prompt.response !== 1) {
        return { ok: false, message: tx(loc, "dialog.importCancel") };
      }

      const result = readChromiumBookmarks(source);
      if (!result.ok) {
        return { ok: false, message: result.message };
      }
      if (!result.items.length) {
        return { ok: false, message: tx(loc, "dialog.noItems", { label }) };
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
        message: tx(loc, "bookmark.imported", {
          label,
          n: result.items.length,
          bar: onBar,
        }),
        data: this.chromeBookmarkState(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[bookmarks] import failed:", error);
      return { ok: false, message: tx(loc, "bookmark.importFail", { message }) };
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
  async csScan(opts?: { fromHuman?: boolean }): Promise<ToolResult & { data?: CsScanData }> {
    const res = await runCsScan({
      pageView: this.pageView,
      assertNotPaused: () => this.assertNotPaused(),
      fill: (t, v) => this.fill(t, v),
      getSettings: () => this.settings,
    }, opts);
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
    fromHuman?: boolean;
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

  /** Address-bar / sidebar 一键回复：扫当前页 → 模型起草 → 填入。不点发送。 */
  async csOneClickReply(): Promise<ToolResult & { data?: CsDraftData }> {
    const hasKey = this.modelReady();
    const res = await this.csDraftReply({
      fill: true,
      preferLlm: true,
      fromHuman: true,
    });
    if (!res.ok) return res;
    const src = res.data?.source;
    const via = src === "llm" ? "模型" : src === "template" ? (hasKey ? "模型不可用，已用模板" : "未配 Key，已用模板") : "草稿";
    return {
      ...res,
      message: res.data?.filled
        ? `一键回复已填入（${res.data.intent?.label || "回复"} · ${via}）。请在页面上确认后点发送——Sparo 不会自动发出。`
        : res.message,
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

  private hasByokKey(): boolean {
    return Boolean((this.settings.apiKey || this.settings.deepseekApiKey || "").trim());
  }

  private modelReady(): boolean {
    if (this.hasByokKey()) return true;
    return this.settings.llmMode === "cloud" && Boolean(this.cloudQuota?.canStart);
  }

  private settingsPublic() {
    const view = settingsPublicView(this.settings);
    return {
      ...view,
      configured: this.modelReady(),
    };
  }

  private cloudPublic() {
    const tokens = loadTokens(this.configDir());
    const q = this.cloudQuota;
    return {
      loggedIn: Boolean(tokens?.access),
      email: q?.email || tokens?.email || "",
      canStart: Boolean(q?.canStart),
      points: q?.points ?? 0,
      approxTasks: q?.approxTasks ?? 0,
      trial: q?.trial || { used: 0, left: 0, cap: 3 },
      subscription: q?.subscription || { active: false, plan: null },
      llmMode: this.settings.llmMode,
      runtime: this.llmRuntime,
      hidePayCopy: isMsftChannel(),
      accountUrl: accountUrl(),
    };
  }

  private async refreshCloudQuota(): Promise<void> {
    if (!hasCloudSession(this.configDir())) {
      this.cloudQuota = null;
      return;
    }
    try {
      this.cloudQuota = await fetchMe(this.configDir());
    } catch {
      /* 断网时沿用缓存，本地 Key 仍可用 */
    }
  }

  private actionNeedsLlm(action: ChatAction, text: string): boolean {
    if (shouldAskPlanner(action, text)) return true;
    switch (action.type) {
      case "llm":
      case "act":
      case "summarize":
      case "fill_form":
      case "one_click_reply":
      case "travel_search":
      case "trip_plan":
      case "mission":
      case "feishu":
        return true;
      default:
        return false;
    }
  }

  private async beginCloudTaskIfNeeded(
    action: ChatAction,
    text: string,
  ): Promise<"ok" | "skip" | "refused"> {
    if (this.llmRuntime !== "cloud") return "skip";
    if (!this.actionNeedsLlm(action, text)) return "skip";
    try {
      const t = await assertAndStartTask(this.configDir());
      this.cloudTaskId = t.taskId;
      this.deepseek?.setTaskId(t.taskId);
      this.cloudQuota = {
        ...t.snap,
        email: this.cloudQuota?.email || loadTokens(this.configDir())?.email,
      };
      this.lastCloudRefuse = "";
      return "ok";
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (this.hasByokKey()) {
        this.rebuildDeepSeek("byok");
        return "skip";
      }
      this.lastCloudRefuse = msg;
      return "refused";
    }
  }

  private async finishCloudTask(): Promise<{
    approxTasksUsed: number;
    approxTasks: number;
  } | null> {
    const id = this.cloudTaskId;
    this.cloudTaskId = undefined;
    this.deepseek?.setTaskId(undefined);
    if (!id) return null;
    try {
      const s = await settleCloudTask(this.configDir(), id);
      await this.refreshCloudQuota();
      return { approxTasksUsed: s.approxTasksUsed, approxTasks: s.approxTasks };
    } catch {
      return null;
    }
  }

  private applyDeepSeekCfg(cfg: ConstructorParameters<typeof DeepSeekAgentProvider>[0]): void {
    if (this.deepseek) {
      this.deepseek.updateConfig(cfg);
    } else {
      this.deepseek = new DeepSeekAgentProvider(cfg, (name, args) =>
        this.runAgentTool(name, args),
      );
    }
  }

  private rebuildDeepSeek(force?: "byok" | "cloud"): void {
    const byokKey = (this.settings.apiKey || this.settings.deepseekApiKey || "").trim();
    const byokBase =
      (this.settings.baseUrl || this.settings.deepseekBaseUrl || "").trim().replace(/\/$/, "") ||
      "https://api.deepseek.com";
    const byokModel =
      (this.settings.model || this.settings.deepseekModel || "").trim() || "deepseek-v4-flash";
    const wantCloud =
      force !== "byok" &&
      (force === "cloud" || this.settings.llmMode === "cloud") &&
      hasCloudSession(this.configDir());

    if (wantCloud) {
      this.llmRuntime = "cloud";
      this.applyDeepSeekCfg({
        apiKey: "cloud",
        baseUrl: cloudApiBase(),
        model: byokModel,
        mode: "cloud",
        fetchImpl: (url, init) => this.cloudOrByokFetch(String(url), init ?? {}, byokKey, byokBase),
      });
      return;
    }

    this.llmRuntime = "byok";
    if (!byokKey) {
      this.deepseek = null;
      return;
    }
    this.applyDeepSeekCfg({
      apiKey: byokKey,
      baseUrl: byokBase,
      model: byokModel,
      mode: "byok",
    });
  }

  private async cloudOrByokFetch(
    url: string,
    init: RequestInit,
    byokKey: string,
    byokBase: string,
  ): Promise<Response> {
    try {
      const res = await cloudFetch(this.configDir(), this.cloudTaskId || "", url, init);
      if (res.ok || res.status === 402 || res.status === 400 || res.status === 409) {
        return res;
      }
      if (res.status >= 500 && byokKey) {
        return this.byokFetch(byokKey, byokBase, init);
      }
      return res;
    } catch {
      if (byokKey) return this.byokFetch(byokKey, byokBase, init);
      throw new Error(tx(this.settings.locale, "cloud.proxyDown"));
    }
  }

  private byokFetch(apiKey: string, baseUrl: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${apiKey}`);
    headers.set("api-key", apiKey);
    headers.delete("X-Sparo-Task");
    return fetch(chatCompletionsUrl(baseUrl), { ...init, headers });
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
      case "page_text": {
        const page = await this.pageText();
        const raw = page.data?.text || "";
        const clipped = raw.slice(0, 8000);
        return {
          ok: page.ok,
          message: page.message,
          data: { text: clipped, length: raw.length, truncated: raw.length > 8000 },
        };
      }
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
      case "fill_suggest":
        return this.fillSuggest(String(args.value ?? args.query ?? ""), {
          selector: args.selector ? String(args.selector) : undefined,
          ref: args.ref ? String(args.ref) : undefined,
        });
      case "press":
        return this.pressKey(String(args.key || "Enter"));
      case "pick_calendar":
        return this.pickCalendar({
          triggerRef: args.triggerRef ? String(args.triggerRef) : undefined,
          triggerLabel: args.triggerLabel ? String(args.triggerLabel) : undefined,
          triggerText: args.triggerText ? String(args.triggerText) : undefined,
          value: args.value,
          date: args.date ? String(args.date) : undefined,
          hours: args.hours as string | number | undefined,
          minutes: args.minutes as string | number | undefined,
        });
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
      case "list_skills":
        return this.listSkillsTool();
      case "get_skill":
        return this.getSkillTool(String(args.id || args.query || ""));
      case "match_skill":
        return this.matchSkillTool(String(args.query || args.id || ""));
      case "cs_one_click_reply":
        return this.csOneClickReply();
      case "feishu_work":
        return this.feishuWork({
          kind: args.kind != null ? String(args.kind) : undefined,
          to: args.to != null ? String(args.to) : undefined,
          title: args.title != null ? String(args.title) : undefined,
          body: args.body != null ? String(args.body) : undefined,
        });
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
          "Site first: user said 知乎 → zhihu.com, 微博 → weibo.com. Never substitute Xiaohongshu.",
          "No matching skill → operate the page with snapshot/click/fill. Do not ask the human to record a skill first.",
          "Publishing: read docs/PUBLISHING.md — run_skill or xhs_inject_* (never loop fill).",
          "Xiaohongshu ONLY if user named 小红书/xhs/rednote: run_skill({ query:'发小红书', params:{ title, body, summary, topics } }).",
          "Or: xhs_ensure_editor → xhs_inject_compose → xhs_layout_next → xhs_inject_publish → pause.",
          "Unknown forms: run_skill({ query:'通用填表', params:{ payload:{ 标题, 正文, … } } }) OR analyze_page → execute_primitives.",
          "Date pickers (X Ads End time): pick_calendar or payload End time — never fill a date string, never click_text a bare day number, never click the month '<' chevron.",
          "Do NOT loop fill/click on multi-field forms — use execute_primitives.",
          "Customer service (any site, semi-auto): cs_one_click_reply or cs_scan → cs_draft_reply (fills composer; NEVER auto-send).",
          "Feishu web: run_skill({ query:'飞书', params:{ to, body, title, kind } }) or feishu_work. Opens messenger, injects chat/journal draft ONCE. NEVER click 发送.",
          "Detect only: xhs_page_stage / feishu_page_stage. Auth: %APPDATA%/sparo-store/mcp-auth.json · GET /health · /tools",
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
          "pick_calendar",
          "cs_scan",
          "cs_draft_reply",
          "cs_one_click_reply",
          "feishu_page_stage",
          "feishu_ensure_messenger",
          "feishu_inject_chat",
          "feishu_inject_journal",
          "feishu_work",
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
          "pick_calendar",
          "cs_scan",
          "cs_draft_reply",
          "cs_one_click_reply",
          "feishu_work",
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
    if (this.chatRunning) {
      this.chatQueue.push(text);
      this.chatLog.push({
        role: "assistant",
        text: `「${text.slice(0, 28)}」已排队，等当前任务写出手册再做。`,
      });
      this.pushSidebarState();
      return { ok: true, message: "queued" };
    }
    this.chatRunning = true;
    try {
      return await this.handleChatJob(text);
    } finally {
      this.chatRunning = false;
      const next = this.chatQueue.shift();
      if (next) void this.handleChat(next);
    }
  }

  private async handleChatJob(text: string): Promise<ToolResult> {
    this.chatLog.push({ role: "user", text });
    this.pushSidebarState();
    let action = parseLocalIntent(text, this.settings.locale);
    if (
      action.type === "llm" &&
      isContinueHint(text) &&
      this.lastFeishuTask
    ) {
      action = { type: "feishu", task: this.lastFeishuTask };
    }
    const cloudGate = await this.beginCloudTaskIfNeeded(action, text);
    if (cloudGate === "refused") {
      const reply = this.lastCloudRefuse || this.L("cloud.exhausted");
      this.chatLog.push({ role: "assistant", text: reply });
      this.pushSidebarState();
      return { ok: false, message: reply };
    }
    const cloudOpened = cloudGate === "ok";
    try {
    if (this.deepseek && shouldAskPlanner(action, text)) {
      this.chatLog.push({
        role: "assistant",
        text: "先对照能力，弄清你要做什么…",
      });
      this.pushSidebarState();
      try {
        const planned = await planUserGoal(text, (prompt) =>
          this.deepseek!.completePlain(prompt),
        );
        if (planned && planned.type !== "none") {
          action = planned as ChatAction;
        } else if (action.type === "travel_search") {
          action = { type: "llm", text };
        }
      } catch {
        /* 规划失败就沿用正则结果 */
      }
    }
    if (this.paused && action.type !== "pause") {
      this.setPaused(false);
    }
    let reply = "";
    let replyDoc: ChatTurn["doc"];
    if (action.type === "reply") {
      reply = action.text;
    } else if (action.type === "print") {
      try {
        this.pageView.webContents.print();
        reply =
          this.settings.locale.startsWith("zh")
            ? "已打开系统打印。选打印机或另存为 PDF。"
            : "Print dialog opened. Choose a printer or Save as PDF.";
      } catch (error) {
        reply =
          "没法自动打印：" +
          (error instanceof Error ? error.message : String(error)) +
          "。请按 Ctrl+P。";
      }
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
        reply = action.note || nav.message;
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
    } else if (action.type === "list_skills") {
      this.skillsCache = listSkills(this.configDir());
      if (!this.skillsCache.length) {
        reply = "内置能力可直接说「发小红书」「填表」「回复」。这一版不提供录制新操作。";
      } else {
        reply =
          `已有 ${this.skillsCache.length} 个可用操作：\n` +
          this.skillsCache
            .slice(0, 12)
            .map((s, i) => `${i + 1}. ${s.title}（${s.stepCount} 步）`)
            .join("\n") +
          "\n\n直接说「发小红书」或「填表」即可。这一版不提供录制新操作。";
      }
    } else if (action.type === "one_click_reply") {
      this.chatLog.push({
        role: "assistant",
        text: this.L("chat.scanningReply"),
      });
      this.pushSidebarState();
      const r = await this.csOneClickReply();
      reply = r.message;
      this.pushSidebarState();
    } else if (action.type === "summarize") {
      this.chatLog.push({
        role: "assistant",
        text: this.L("chat.readingPage"),
      });
      this.pushSidebarState();
      reply = await this.summarizeActivePage(text);
    } else if (action.type === "trip_plan") {
      this.chatLog.push({
        role: "assistant",
        text: tripPlanProgress(action.plan),
      });
      this.pushSidebarState();
      const tripOut = await this.runTripPlan(action.plan, text);
      reply = tripOut.text;
      try {
        const title = `${action.plan.origin} → ${action.plan.cities.join(" → ")} → ${action.plan.origin}`;
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        replyDoc = writeHtmlReport(
          this.configDir(),
          `trip-${stamp}`,
          tripReportHtml({
            plan: action.plan,
            userAsk: text,
            summary: reply,
            hotels: tripOut.hotels,
            flights: tripOut.flights,
          }),
          { title, kind: "trip" },
        );
        reply = `行程手册已写好：${action.plan.startDate} ${title}，${action.plan.endDate} 返回。点下面卡片，在窗口里打开完整页。`;
      } catch {
        /* 写文档失败就仍用侧栏长文 */
      }
    } else if (action.type === "mission") {
      this.chatLog.push({
        role: "assistant",
        text: missionProgress(action.mission),
      });
      this.pushSidebarState();
      const out = await this.runMission(action.mission, text);
      reply = out;
      try {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        replyDoc = writeHtmlReport(
          this.configDir(),
          `mission-${action.mission.kind}-${stamp}`,
          readingReportHtml({
            title: action.mission.title,
            body: out,
            eyebrow: "SPARO 任务手册",
          }),
          { title: action.mission.title, kind: "read" },
        );
        reply = `手册已写好：${action.mission.title}。点下面卡片在窗口里打开。`;
      } catch {
        /* 仍用侧栏长文 */
      }
    } else if (action.type === "travel_search") {
      this.chatLog.push({
        role: "assistant",
        text: lifeProgress(action),
      });
      this.pushSidebarState();
      reply = await this.runTravelSearch(action);
    } else if (action.type === "feishu") {
      this.lastFeishuTask = action.task;
      this.chatLog.push({
        role: "assistant",
        text: "正在打开飞书网页版…",
      });
      this.pushSidebarState();
      reply = await this.runFeishu(action.task);
    } else if (action.type === "fill_form") {
      this.chatLog.push({
        role: "assistant",
        text: this.L("chat.detectingFields"),
      });
      this.pushSidebarState();
      reply = await this.previewFormFill(text);
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
    } else if (action.type === "act") {
      if (action.url && !sameSite(this.getUrl(), action.url)) {
        const nav = await this.navigate(action.url, { asHuman: true });
        if (!nav.ok) {
          reply = nav.message;
        } else {
          this.chatLog.push({
            role: "assistant",
            text: this.L("chat.openedSite"),
          });
          this.pushSidebarState();
          reply = await this.runLlmGoal(action.text);
        }
      } else {
        this.chatLog.push({
          role: "assistant",
          text: this.L("chat.actingHere"),
        });
        this.pushSidebarState();
        reply = await this.runLlmGoal(action.text);
      }
    } else if (action.type === "llm") {
      reply = await this.runLlmGoal(action.text);
    } else {
      reply = this.L("chat.unknown");
    }
    if (cloudOpened) {
      const settle = await this.finishCloudTask();
      if (settle) {
        reply = `${reply}\n\n${this.L("cloud.usedThis", {
          x: settle.approxTasksUsed,
          n: settle.approxTasks,
        })}`;
      }
    }
    if (!replyDoc && reply.length >= 1600) {
      try {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        replyDoc = writeHtmlReport(
          this.configDir(),
          `read-${stamp}`,
          readingReportHtml({ title: "Sparo 阅读页", body: reply }),
          { title: "阅读页", kind: "read" },
        );
      } catch {
        /* 可选 */
      }
    }
    this.chatLog.push({ role: "assistant", text: reply, doc: replyDoc });
    this.pushSidebarState();
    return { ok: true, message: reply, data: { action, chat: this.chatLog.slice(-20) } };
    } finally {
      if (this.cloudTaskId) void this.finishCloudTask();
    }
  }

  private L(key: string, vars?: Record<string, string | number>): string {
    return tx(this.settings.locale, key, vars);
  }

  private async summarizeActivePage(userAsk?: string): Promise<string> {
    const page = await this.pageText();
    const text = (page.data?.text || "").trim();
    if (!text) {
      return this.L("llm.summarizeEmpty");
    }
    if (!this.deepseek) {
      return this.L("llm.needKeySummarize") + "\n\n" + text.slice(0, 1200);
    }
    try {
      const ask = (userAsk || "").trim();
      const summary = await this.deepseek.completePlain(
        [
          readPageInstruction(ask),
          `${this.L("llm.pageTitle")}${this.getTitle()}`,
          `${this.L("llm.pageUrl")}${this.getUrl()}`,
          this.L("llm.pageBody"),
          text.slice(0, this.llmRuntime === "cloud" ? 3500 : 8000),
        ].join("\n"),
      );
      return summary || this.L("llm.summarizeNone");
    } catch (error) {
      return this.L("llm.summarizeFail") + (error instanceof Error ? error.message : String(error));
    }
  }

  private async previewFormFill(userText: string): Promise<string> {
    const analyzed = await this.analyzePage();
    if (!analyzed.ok || !analyzed.data) {
      return analyzed.message || this.L("llm.formNone");
    }
    const data = analyzed.data;
    const fields = [...(data.required_fields || []), ...(data.optional_fields || [])];
    if (!fields.length) {
      return this.L("llm.formNotAForm");
    }
    const lines = fields.slice(0, 14).map((f) => {
      const star = f.required ? this.L("llm.formRequired") : "";
      return `- ${f.label || f.placeholder || f.ref}${star}`;
    });
    const header =
      this.L("llm.formHeader", { count: data.field_count, type: data.page_type }) +
      "\n" +
      lines.join("\n");
    const extra = userText.replace(/填这(张|个)?表|帮我填|通用填表|自动填表|按资料填/g, "").trim();
    if (extra.length < 8) {
      return header + "\n\n" + this.L("llm.formAskPayload");
    }
    if (!this.deepseek) {
      return header + "\n\n" + this.L("llm.needKeyFill");
    }
    this.chatLog.push({
      role: "assistant",
      text: header + "\n" + this.L("llm.formFilling"),
    });
    this.pushSidebarState();
    return this.runLlmGoal(
      `${userText}\n\n${this.L("llm.knownFields")}\n${lines.join("\n")}\n${this.L("llm.formGoalTail")}`,
    );
  }

  async fillSuggest(
    value: string,
    target: { ref?: string; selector?: string } = {},
  ): Promise<ToolResult> {
    const blocked = this.assertNotPaused();
    if (blocked) return blocked;
    const query = value.trim();
    if (!query) return { ok: false, message: "fill_suggest 需要目的地或关键词" };
    const wc = this.pageView.webContents;
    let ref = target.ref;
    let selector = target.selector;
    if (!ref && !selector) {
      const found = (await wc.executeJavaScript(
        `(${FIND_DEST_INPUT_SCRIPT})()`,
        true,
      )) as { ok?: boolean; ref?: string };
      if (found?.ok && found.ref) ref = found.ref;
    }
    if (!ref && !selector) {
      return { ok: false, message: "找不到目的地输入框" };
    }
    const filled = await this.fill({ ref, selector }, query);
    if (!filled.ok) return filled;
    await sleep(800);
    const sug = (await wc.executeJavaScript(
      `(${PICK_SUGGEST_SCRIPT})(${JSON.stringify(query)})`,
      true,
    )) as { ok?: boolean; ref?: string; text?: string; message?: string };
    if (sug?.ok && sug.ref) {
      const clicked = await this.click({ ref: sug.ref });
      return {
        ok: clicked.ok,
        message: clicked.ok
          ? `已选联想「${sug.text || query}」`
          : clicked.message,
      };
    }
    const enter = await this.pressKey("Enter");
    return {
      ok: enter.ok,
      message: `没有匹配联想，已回车。${sug?.message || ""}`.trim(),
    };
  }

  private async extractHotelLinks(city: string): Promise<HotelLink[]> {
    const pageUrl = this.getUrl();
    if (!/hotel/i.test(pageUrl) || /\/flights?\//i.test(pageUrl)) return [];
    try {
      const raw = (await this.pageView.webContents.executeJavaScript(
        `(${EXTRACT_HOTEL_LINKS_SCRIPT})()`,
        true,
      )) as {
        hotels?: Array<{ name?: string; url?: string; price?: string; score?: string; area?: string }>;
      };
      return (raw.hotels || [])
        .filter((h) => h.name && h.url && /^https?:/i.test(h.url))
        .filter((h) => !/\/hotels\/?(\?|$)|\/hotels\/all-cities|\/hotels\/list/i.test(String(h.url)))
        .filter((h) => /hotelid=|hotels?\/\d|\/hotel\/\d|hotel-detail|\/rooms\/\d/i.test(String(h.url)))
        .map((h) => ({
          city,
          name: String(h.name),
          url: String(h.url),
          price: h.price ? String(h.price) : undefined,
          score: h.score ? String(h.score) : undefined,
          area: h.area ? String(h.area) : undefined,
        }));
    } catch {
      return [];
    }
  }

  private async runMission(mission: Mission, userAsk: string): Promise<string> {
    const findings: Array<{ label: string; url: string; text: string }> = [];
    const heavyHost = /taobao\.com|tmall\.com|jd\.com|dianping\.com|maoyan\.com/;
    for (const step of mission.steps.slice(0, 4)) {
      this.chatLog.push({ role: "assistant", text: `正在查：${step.label}` });
      this.pushSidebarState();
      if (heavyHost.test(step.url)) {
        findings.push({
          label: step.label,
          url: step.url,
          text: "商城和点评页会卡住窗口，只记下链接，不打开正文。",
        });
        continue;
      }
      const nav = await this.withTimeout(
        this.navigate(step.url, { asHuman: true }),
        12000,
        { ok: false, message: "打开超时，先记下链接。" },
      );
      if (!nav.ok) {
        findings.push({ label: step.label, url: step.url, text: nav.message });
        continue;
      }
      const landed = this.getUrl() || step.url;
      if (heavyHost.test(landed)) {
        try {
          this.pageView.webContents.stop();
        } catch {
          /* 停不住也别继续读 */
        }
        findings.push({
          label: step.label,
          url: step.url,
          text: "落到了会卡死的商城页，改回检索链接，不读这一页。",
        });
        continue;
      }
      if (mission.kind !== "compare_shop" && !/baidu\.com\/s/.test(landed)) {
        await sleep(800);
        try {
          await this.scrollTravelList();
        } catch {
          /* 滚动失败仍读当前正文 */
        }
      }
      const page = await this.withTimeout(this.pageText(), 8000, {
        ok: true,
        message: "",
        data: { text: "" },
      });
      const body = String(page.data?.text || "").trim();
      findings.push({
        label: step.label,
        url: landed,
        text: body.slice(0, 8000) || "这一页还没出文字，可能要登录。",
      });
    }
    if (this.deepseek) {
      const summary = await this.withTimeout(
        this.deepseek.completePlain(missionSynthesizePrompt(userAsk, mission, findings)),
        20000,
        "",
      );
      if (String(summary).trim()) return String(summary).trim();
    }
    return findings.map((f) => `【${f.label}】\n${f.url}\n${f.text.slice(0, 800)}`).join("\n\n");
  }

  private async withTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
    let settled = false;
    const timeout = new Promise<T>((resolve) => {
      setTimeout(() => {
        if (settled) return;
        try {
          this.pageView.webContents.stop();
        } catch {
          /* 停加载失败仍返回兜底，避免整窗挂死 */
        }
        resolve(fallback);
      }, ms);
    });
    try {
      const value = await Promise.race([work, timeout]);
      settled = true;
      return value;
    } catch {
      settled = true;
      return fallback;
    }
  }

  private async runTripPlan(
    plan: TripPlan,
    userAsk: string,
  ): Promise<{ text: string; hotels: HotelLink[]; flights: FlightLink[] }> {
    const steps = expandTripPlan(plan);
    if (!steps.length) {
      return {
        text: "没法拆出航班和酒店步骤，请再说清出发地、要去的城市和往返日期。",
        hotels: [],
        flights: [],
      };
    }
    const findings: Array<{ label: string; url: string; text: string }> = [];
    const hotels: HotelLink[] = [];
    const flights: FlightLink[] = [];
    for (const step of steps) {
      this.chatLog.push({ role: "assistant", text: `正在查：${step.label}` });
      this.pushSidebarState();
      let note = await this.runTravelSearch(step.query, { raw: true });
      const pageUrl = this.getUrl();
      if (step.query.kind === "hotel") {
        const city = step.query.city;
        await this.scrollTravelList();
        await sleep(400);
        const links = await this.extractHotelLinks(city);
        hotels.push(...links);
        const extra = formatHotelLinks(links);
        if (extra) note = `${note}\n\n${extra}`;
      } else if (step.query.kind === "flight" && /^https?:/i.test(pageUrl)) {
        const title =
          step.query.from && step.query.to
            ? `${step.query.from} → ${step.query.to} ${step.query.date}`
            : step.label.replace(/^[^ ]+机票\s*/, "");
        const hint = flightHintFromText(note);
        flights.push({ label: title, url: pageUrl, hint });
        note = `${note}\n\n${formatFlightLinks([{ label: title, url: pageUrl, hint }])}`;
      }
      findings.push({
        label: step.label,
        url: pageUrl,
        text: note,
      });
    }
    if (this.deepseek) {
      const summary = await this.deepseek.completePlain(
        tripSynthesizePrompt(userAsk, plan, findings),
      );
      if (summary.trim()) return { text: summary.trim(), hotels, flights };
    }
    return {
      text: findings.map((f) => `【${f.label}】\n${f.url}\n${f.text}`).join("\n\n"),
      hotels,
      flights,
    };
  }

  private async scrollTravelList(): Promise<void> {
    try {
      await this.pageView.webContents.executeJavaScript(
        `(() => {
          const roots = [document.scrollingElement, document.getElementById('app')];
          document.querySelectorAll('[class*="list"],[class*="result"],[class*="scroll"]').forEach((el) => roots.push(el));
          for (const el of roots) {
            if (!el) continue;
            try { el.scrollTop = (el.scrollTop || 0) + 720; } catch (_) {}
          }
          window.scrollBy(0, 900);
          return true;
        })()`,
        true,
      );
    } catch {
      /* 滚动失败就继续读当前正文 */
    }
  }

  private async waitTravelText(q: TravelQuery, ms = 6000): Promise<string> {
    const started = Date.now();
    let last = "";
    while (Date.now() - started < ms) {
      await this.scrollTravelList();
      await sleep(450);
      const page = await this.pageText();
      last = (page.data?.text || "").trim();
      const here = this.getUrl();
      if (q.kind === "hotel" && (!/hotel/i.test(here) || /\/flights?\//i.test(here))) {
        continue;
      }
      if (q.kind === "flight" && !isFlightResultUrl(here)) {
        continue;
      }
      const state = travelListState(q.kind, last);
      if (state === "ready" || state === "empty" || state === "blocked") return last;
    }
    return last;
  }

  private async runTravelSearch(
    q: TravelQuery,
    opts: { raw?: boolean } = {},
  ): Promise<string> {
    try {
      let url = travelResultUrl(q);
      if (q.kind === "hotel" && q.site === "ctrip") {
        const resolved = await resolveCtripHotelCity(q.city);
        if (!resolved) {
          return `找不到「${q.city}」对应的携程城市，请换个地名再试。`;
        }
        url = ctripHotelListUrl(resolved.cityId, q.checkin, q.checkout);
      }
      if (!url) {
        return "还不知道怎么打开这一页，请换个站点名再试。";
      }
      const nav = await this.navigate(url, { asHuman: true });
      if (!nav.ok) return nav.message;
      await sleep(opts.raw ? 800 : 1400);
      let text = await this.waitTravelText(q, opts.raw ? 5000 : 7000);
      let promptQ = q;
      const here = this.getUrl();
      const alreadyList = q.kind === "flight" && isFlightResultUrl(here);
      if (
        q.kind === "flight" &&
        !alreadyList &&
        shouldFallbackFlight(text, q.site, here)
      ) {
        const fbUrl = flightFallbackUrl(q);
        this.chatLog.push({
          role: "assistant",
          text: "携程列表没读全，改去 Trip.com 再查…",
        });
        this.pushSidebarState();
        const nav2 = await this.navigate(fbUrl, { asHuman: true });
        if (nav2.ok) {
          await sleep(1000);
          const alt = await this.waitTravelText(q, 7000);
          const altState = travelListState("flight", alt);
          if (altState === "ready" || alt.length > text.length + 200) {
            text = alt;
            promptQ = { ...q, site: "gflights" };
          }
        }
      }
      if (/验证码|滑块|captcha|人机验证|请登录|sign in to continue/i.test(text) && text.length < 400) {
        return `已打开目标页，但被登录或验证码挡住了。请你在窗口里过后说「继续」。\n${this.getUrl()}`;
      }
      const body = text.slice(0, 12000);
      if (!body) {
        return `已打开 ${this.getUrl()}，页面还没出文字。可能要登录或过一下验证。`;
      }
      let extra = "";
      if (q.kind === "hotel") {
        try {
          await this.scrollTravelList();
          const links = await this.extractHotelLinks(q.city);
          extra = formatHotelLinks(links);
        } catch {
          /* 没有详情链就只用正文 */
        }
      }
      if (opts.raw) {
        return extra ? `${body.slice(0, 2400)}\n\n${extra}` : body.slice(0, 2400);
      }
      if (this.deepseek) {
        const summary = await this.deepseek.completePlain(
          [travelReadPrompt(promptQ), `当前网址：${this.getUrl()}`, extra, body].join("\n"),
        );
        if (summary.trim()) return extra ? `${summary.trim()}\n\n${extra}` : summary.trim();
      }
      return `已打开结果页：${this.getUrl()}\n\n${body.slice(0, 900)}${extra ? `\n\n${extra}` : ""}`;
    } catch (error) {
      return "查询失败：" + (error instanceof Error ? error.message : String(error));
    }
  }

  private async runLlmGoal(text: string): Promise<string> {
    if (!this.deepseek) {
      return this.L("llm.needKey");
    }
    try {
      const url = this.getUrl();
      this.skillsCache = listSkills(this.configDir());
      const catalog = skillCatalog(this.configDir())
        .slice(0, 8)
        .map((s) => `- ${s.id}: ${s.title}`)
        .join("\n");
      const history = this.chatLog
        .filter(
          (turn) =>
            !/^(已打开目标站|开始在当前页操作|Opened the site|Acting on this page)/.test(
              turn.text,
            ),
        )
        .slice(-12);
      if (history.at(-1)?.role === "user" && history.at(-1)?.text === text) {
        history.pop();
      }
      const page = await this.pageText();
      const visible = (page.data?.text || "").trim().slice(0, this.llmRuntime === "cloud" ? 3000 : 6000);
      const reply = await this.deepseek.chat(text, {
        url,
        title: this.getTitle(),
        skills: catalog,
        history,
        profileBrief: profileBriefFor(this.configDir()),
        locale: this.settings.locale,
        pageText: visible,
      });
      this.deepseek.takeMutations();
      return reply;
    } catch (error) {
      return this.L("llm.callFail") + (error instanceof Error ? error.message : String(error));
    }
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

  /**
   * Set a custom calendar + hour:minute popover (X Ads End time, etc.).
   * Clicks Next/Previous month by aria-label, never the "<" glyph.
   * Does not click page Next / Save draft / pay.
   */
  async pickCalendar(input: {
    triggerRef?: string;
    triggerLabel?: string;
    triggerText?: string;
    value?: unknown;
    date?: string;
    hours?: string | number;
    minutes?: string | number;
    dismiss?: "outside" | "escape";
  }): Promise<ToolResult> {
    const blocked = this.assertNotPaused();
    if (blocked) return blocked;
    const dt = parseDatetimeValue(input.value ?? input.date ?? "") || parseDatetimeValue({
      date: input.date,
      hours: input.hours,
      minutes: input.minutes,
    });
    if (!dt) {
      return { ok: false, message: "pick_calendar needs a date (e.g. 2026-09-03 00:59 or Sep 3, 2026)" };
    }
    if (input.hours != null) dt.hours = Number(input.hours);
    if (input.minutes != null) dt.minutes = Number(input.minutes);
    const wc = this.pageView.webContents;
    const inspect = async () =>
      (await wc.executeJavaScript(
        `(${CALENDAR_INSPECT_SCRIPT})(${JSON.stringify({
          year: dt.year,
          month: dt.month,
          day: dt.day,
          triggerRef: input.triggerRef || "",
        })})`,
        true,
      )) as {
        ok?: boolean;
        open?: boolean;
        message?: string;
        header?: string;
        headerYear?: number;
        headerMonth?: number;
        steps?: number;
        next?: { x: number; y: number; label?: string } | null;
        prev?: { x: number; y: number; label?: string } | null;
        day?: { x: number; y: number; name?: string } | null;
        dayCount?: number;
        hours?: { ref?: string; x: number; y: number } | null;
        minutes?: { ref?: string; x: number; y: number } | null;
        outside?: { x: number; y: number };
        triggerText?: string;
      };

    if (input.triggerRef) {
      const clk = await this.click({ ref: input.triggerRef });
      if (!clk.ok) {
        return { ok: false, message: `could not open date picker: ${clk.message}` };
      }
    } else {
      const label = input.triggerText || input.triggerLabel || "Run indefinitely";
      let clk = await this.clickText(label, { exact: false });
      if (!clk.ok && label !== "Run indefinitely") {
        clk = await this.clickText("Run indefinitely", { exact: false });
      }
      if (!clk.ok) {
        return { ok: false, message: `could not open date picker: ${clk.message}` };
      }
    }
    await sleep(250);
    let state = await inspect();
    const deadline = Date.now() + 2500;
    while (!state?.open && Date.now() < deadline) {
      await sleep(150);
      state = await inspect();
    }
    if (!state?.open) {
      return { ok: false, message: state?.message || "calendar popover did not open" };
    }

    let guard = 0;
    while (typeof state.steps === "number" && state.steps !== 0 && guard < 24) {
      const goNext = state.steps > 0;
      const nav = goNext ? state.next : state.prev;
      if (!nav) {
        return {
          ok: false,
          message: `calendar needs ${goNext ? "Next month" : "Previous month"} but no aria-labelled chevron`,
          data: state,
        };
      }
      await this.trustedClickAt(Math.round(nav.x), Math.round(nav.y), { hoverOnly: true });
      await sleep(40);
      await this.trustedClickAt(Math.round(nav.x), Math.round(nav.y));
      await sleep(280);
      state = await inspect();
      guard += 1;
    }
    if (state.steps) {
      return { ok: false, message: `could not reach ${dt.year}-${twoDigit(dt.month)}`, data: state };
    }
    if (!state.day) {
      return {
        ok: false,
        message: `no unique in-month cell for day ${dt.day} (count=${state.dayCount ?? 0}). Do not click_text a bare number.`,
        data: state,
      };
    }
    await this.trustedClickAt(Math.round(state.day.x), Math.round(state.day.y), { hoverOnly: true });
    await sleep(40);
    await this.trustedClickAt(Math.round(state.day.x), Math.round(state.day.y));
    await sleep(200);
    state = await inspect();
    const hourRef = state.hours?.ref;
    const minRef = state.minutes?.ref;
    if (hourRef) {
      await wc.executeJavaScript(
        `(${SET_SPIN_SCRIPT})(${JSON.stringify(hourRef)}, ${JSON.stringify(twoDigit(dt.hours))})`,
        true,
      );
    }
    if (minRef && minRef !== hourRef) {
      await wc.executeJavaScript(
        `(${SET_SPIN_SCRIPT})(${JSON.stringify(minRef)}, ${JSON.stringify(twoDigit(dt.minutes))})`,
        true,
      );
    }
    await sleep(120);
    if (input.dismiss === "escape") {
      wc.sendInputEvent({ type: "keyDown", keyCode: "Escape" } as Electron.KeyboardInputEvent);
      wc.sendInputEvent({ type: "keyUp", keyCode: "Escape" } as Electron.KeyboardInputEvent);
    } else if (state.outside) {
      await this.trustedClickAt(Math.round(state.outside.x), Math.round(state.outside.y));
    }
    await sleep(280);
    let committed = "";
    if (input.triggerRef) {
      const read = (await wc.executeJavaScript(
        `(${FIELD_VALUE_SCRIPT})(${JSON.stringify(input.triggerRef)})`,
        true,
      )) as { value?: string };
      committed = String(read?.value || "");
    } else {
      const again = await inspect();
      committed = String(again?.triggerText || "");
    }
    const ok = datetimeCommitted(committed, dt) || Boolean(committed && !/indefinitely/i.test(committed));
    this.lastSnapshot = null;
    return {
      ok,
      message: ok
        ? `pick_calendar → ${committed || `${dt.year}-${twoDigit(dt.month)}-${twoDigit(dt.day)} ${twoDigit(dt.hours)}:${twoDigit(dt.minutes)}`}`
        : `calendar picked but End time still reads "${committed || "unknown"}"`,
      data: { committed, dt, header: state.header },
    };
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

  async feishuPageStage(): Promise<ToolResult> {
    try {
      const data = await this.pageView.webContents.executeJavaScript(
        FEISHU_STAGE_SCRIPT,
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

  async feishuEnsureMessenger(): Promise<ToolResult> {
    const url = this.getUrl();
    if (alreadyOnFeishuTask(url, { kind: "open" })) {
      const stage = await this.feishuPageStage();
      if ((stage.data as { login?: boolean } | undefined)?.login || isFeishuLoginUrl(url)) {
        this.setPaused(true);
        return {
          ok: false,
          message: "已打开飞书登录页。请你扫码或登录，登好后说「继续」。",
          data: stage.data,
        };
      }
      return { ok: true, message: "飞书消息页已打开", data: { url } };
    }
    const nav = await this.navigate(FEISHU_MESSENGER_URL, { asHuman: true });
    if (!nav.ok) return nav;
    await sleep(1200);
    const stage = await this.feishuPageStage();
    if ((stage.data as { login?: boolean } | undefined)?.login || isFeishuLoginUrl(this.getUrl())) {
      this.setPaused(true);
      return {
        ok: false,
        message: "已打开飞书登录页。请你扫码或登录，登好后说「继续」。",
        data: stage.data,
      };
    }
    return { ok: true, message: "已打开飞书网页消息", data: { url: this.getUrl() } };
  }

  async feishuOpenChat(input: { to?: string }): Promise<ToolResult> {
    const to = String(input.to || "").trim();
    if (!to) return { ok: false, message: "缺少联系人" };
    try {
      const data = (await Promise.race([
        this.pageView.webContents.executeJavaScript(
          `(${FEISHU_OPEN_CHAT_SCRIPT})(${JSON.stringify({ to })})`,
          true,
        ),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("feishu_open_chat timeout 12s")), 12000),
        ),
      ])) as { ok?: boolean; message?: string };
      return {
        ok: Boolean(data?.ok),
        message: data?.message || (data?.ok ? `已点开 ${to}` : "没找到联系人"),
        data,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async feishuInjectChat(input: { body?: string }): Promise<ToolResult> {
    return this.feishuInjectText({ body: input.body || "" });
  }

  async feishuInjectJournal(input: {
    title?: string;
    body?: string;
  }): Promise<ToolResult> {
    return this.feishuInjectText({
      title: input.title || "",
      body: input.body || "",
    });
  }

  private async feishuInjectText(input: {
    title?: string;
    body?: string;
  }): Promise<ToolResult> {
    const title = String(input.title || "");
    const body = String(input.body || "");
    if (!title && !body) return { ok: false, message: "没有可写入的正文" };
    try {
      const data = (await Promise.race([
        this.pageView.webContents.executeJavaScript(
          `(${FEISHU_INJECT_TEXT_SCRIPT})(${JSON.stringify({ title, body })})`,
          true,
        ),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("feishu_inject timeout 12s")), 12000),
        ),
      ])) as { ok?: boolean; message?: string; bodyLen?: number };
      return {
        ok: Boolean(data?.ok),
        message: data?.message || (data?.ok ? "已写入草稿，未点发送" : "找不到输入框"),
        data,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async feishuWork(input?: {
    kind?: string;
    to?: string;
    title?: string;
    body?: string;
  }): Promise<ToolResult> {
    const kindRaw = String(input?.kind || "").trim();
    const kind: FeishuTask["kind"] =
      kindRaw === "chat" ||
      kindRaw === "journal" ||
      kindRaw === "doc" ||
      kindRaw === "calendar"
        ? kindRaw
        : input?.to || input?.body
          ? "chat"
          : "open";
    const task: FeishuTask = {
      kind,
      to: input?.to ? String(input.to) : undefined,
      title: input?.title ? String(input.title) : undefined,
      body: input?.body ? String(input.body) : undefined,
    };
    this.lastFeishuTask = task;
    const message = await this.runFeishu(task);
    return { ok: !/失败|找不到|登录/.test(message) || /已打开飞书登录/.test(message), message };
  }

  async runFeishu(task: FeishuTask): Promise<string> {
    const target = feishuUrl(task);
    if (!alreadyOnFeishuTask(this.getUrl(), task)) {
      const nav = await this.navigate(target, { asHuman: true });
      if (!nav.ok) return nav.message;
      await sleep(1500);
    }

    const stage = await this.feishuPageStage();
    const login =
      Boolean((stage.data as { login?: boolean } | undefined)?.login) ||
      isFeishuLoginUrl(this.getUrl());
    if (login) {
      this.setPaused(true);
      return "已打开飞书登录页。请你在窗口里扫码或登录，登好后说「继续」。我不会代填密码。";
    }

    if (task.kind === "open") {
      return "已打开飞书网页消息。可以说「给张三发：……」或「写今日日报：……」，发送仍由你点。";
    }
    if (task.kind === "calendar") {
      this.setPaused(true);
      return "已打开飞书日历。请你在窗口里确认或新建日程，需要我写入标题时再说。";
    }

    if (task.kind === "chat") {
      if (task.to) {
        const opened = await this.feishuOpenChat({ to: task.to });
        if (!opened.ok) {
          this.setPaused(true);
          return `${opened.message}。请你在左侧点开会话，点开后说「继续」，我再写入草稿。`;
        }
        await sleep(800);
      }
      if (task.body) {
        const inj = await this.feishuInjectChat({ body: task.body });
        if (!inj.ok) {
          this.setPaused(true);
          return `${inj.message}。请点开输入框后说「继续」。`;
        }
      }
      this.setPaused(true);
      const who = task.to ? `给${task.to}` : "当前会话";
      return task.body
        ? `已在飞书写好${who}的草稿，未点发送。请你看一眼再点发送。`
        : `已打开${who}。把要说的话发给我，我写入草稿，发送由你点。`;
    }

    const draft = [task.title, task.body].filter(Boolean).join("\n\n");
    const inj = await this.feishuInjectJournal({
      title: task.title,
      body: task.body,
    });
    if (inj.ok) {
      this.setPaused(true);
      return task.kind === "doc"
        ? "已打开飞书文档并尝试写入草稿，未提交。请你确认后保存。"
        : "已写入飞书日志草稿，未提交。请你确认后点发送/提交。";
    }

    if (!alreadyOnFeishuTask(this.getUrl(), { kind: "open" })) {
      const nav = await this.navigate(FEISHU_MESSENGER_URL, { asHuman: true });
      if (!nav.ok) return nav.message;
      await sleep(1200);
    }
    if (isFeishuLoginUrl(this.getUrl())) {
      this.setPaused(true);
      return "需要先登录飞书。请扫码，登好后说「继续」。";
    }
    if (draft) {
      const chat = await this.feishuInjectChat({ body: draft });
      this.setPaused(true);
      if (chat.ok) {
        return "汇报页没有可写区域，已把内容写进消息草稿。请你自己点开日志或发给同事，我不会代点发送。";
      }
    }
    this.setPaused(true);
    return "打不开飞书日志输入框。请你点开汇报或会话后说「继续」。";
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

  async reload(opts?: { asHuman?: boolean; ignoreCache?: boolean }): Promise<ToolResult> {
    if (!opts?.asHuman) {
      const blocked = this.assertNotPaused();
      if (blocked) return blocked;
    }
    if (opts?.ignoreCache) this.pageView.webContents.reloadIgnoringCache();
    else this.pageView.webContents.reload();
    this.lastSnapshot = null;
    if (!opts?.asHuman) await sleep(800);
    const probe = await this.probe();
    this.pushStatus();
    this.pushChromeState();
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
    if (!opts?.asHuman) await sleep(800);
    const after = await this.probe();
    this.pushStatus();
    this.pushChromeState();
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
    if (!opts?.asHuman) await sleep(800);
    const after = await this.probe();
    this.pushStatus();
    this.pushChromeState();
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
      if (tab.view && !tab.view.webContents.isDestroyed()) {
        return tab.view.webContents.getURL() || tab.url || "";
      }
      return tab.url || "";
    } catch {
      return tab.url || "";
    }
  }

  getTitle(): string {
    const tab = this.getActiveTab();
    if (!tab) return "";
    try {
      if (tab.view && !tab.view.webContents.isDestroyed()) {
        return tab.view.webContents.getTitle() || tab.title || "";
      }
      return tab.title || "";
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
