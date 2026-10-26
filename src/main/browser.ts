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
  screen,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";
import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, unlinkSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { pageViewCoversChrome } from "./page-bounds.js";
import { laneForText, type TaskLane } from "./agent/task-class.js";
import { shouldSuspend as poolShouldSuspend, TaskPool, type PoolTask } from "./agent/task-pool.js";
import type {
  ClickConfirm,
  FillConfirm,
  NavigateConfirm,
  PageSnapshot,
  SnapshotElement,
  ToolResult,
} from "../shared/types.js";
import { parseLocalIntent, type ChatAction } from "./agent/stub.js";
import {
  compileHands,
  goalProgress,
  reviewLesson,
  synthesizePrompt,
  type AgentGoal,
  type AgentStep,
  type StepFinding,
} from "./agent/loop.js";
import {
  applyTurn,
  applyTurnAsync,
  closePlan,
  focusPlanOnStep,
  nudgeFromPlan,
  observe,
  reconsiderMission,
  reviseActivePlan,
  gateSiteDelivery,
  loginRedirectNote,
  openSiteIsTheJob,
  userDidNotAskToRead,
  parseSiteLanding,
  siteLandingPrompt,
  thoughtFor,
  thoughtForAsync,
  verifyContracts,
  earlyExitMayCloseDone,
  type ActiveMission,
  type Thought,
} from "./agent/kernel/index.js";
import { parseRewriteVerdict, rewriteVerdictPrompt } from "./agent/kernel/read-rewrite.js";
import { writeExperience } from "./agent/experience.js";
import { canonCity, isCity, plausiblePlace } from "./agent/place.js";
import { distillMission, oneShotJudgePrompt, parseOneShotVerdict } from "./agent/distill.js";
import { distillSkillFromTrace, shouldSkipRemember } from "./agent/remember.js";
import {
  missionProgress,
  missionSynthesizePrompt,
  parseMission,
  shouldSkipHeavyPage,
  type Mission,
  type MissionKind,
} from "./agent/mission.js";
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
import {
  detectSite,
  extractFirstHttpUrl,
  isContinueHint,
  readPageInstruction,
  sameSite,
  wantsFillForm,
  wantsPublish,
  wantsReply,
} from "./agent/intent-router.js";
import { isPauseText, isResumeText } from "./agent/slots.js";
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
  trainFallbackUrl,
  trainStationCode,
  lifeProgress,
  resolveCtripHotelCity,
  isFlightResultUrl,
  shouldFallbackFlight,
  shouldFallbackTrain,
  travelListState,
  travelReadPrompt,
  travelResultUrl,
  addDays,
  detectHotelSite,
  detectFlightSite,
  ymd,
  type TravelQuery,
  type HotelSite,
  type FlightSite,
  type TrainSite,
} from "./agent/travel.js";
import { isLegalSite, searchResultUrl } from "./agent/brain/sites.js";
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
  decideRecovery,
  journalCloseUtterance,
  journalMissionTurn,
  pickInterruptedMission,
  preferredMission,
  recoveryLine,
  replayMissions,
  type RestoredMission,
} from "./agent/mission-journal.js";
import {
  composeQuotedPrompt,
  fillNoteQuote,
  normalizeQuotes,
  QUOTE_PAGE_CONTRACT,
  quotedUserTurn,
  type SparoQuote,
} from "./agent/quotes.js";
import {
  actionKey,
  detectFailure,
  isCaptchaWall,
  isLoginWall,
  pageFinger,
} from "./learning/detector.js";
import { parseAnswer, questionFor } from "./learning/help.js";
import { planFromLessons } from "./learning/apply.js";
import {
  deleteLesson,
  findLessonsForHost,
  lessonPublic,
  loadLessons,
  recordLessonApply,
  upsertLesson,
} from "./learning/store.js";
import { matchTrigger, normalizeUtterance } from "./triggers/gate.js";
import {
  deleteTrigger,
  hasTriggerText,
  loadTriggers,
  recordOutcome,
  toggleTrigger,
  upsertTrigger,
} from "./triggers/store.js";
import type { HelpAsk, ObservedAction } from "./learning/types.js";
import {
  flightHintFromText,
  formatFlightLinks,
  formatHotelLinks,
  isPendingRewrite,
  readingReportHtml,
  readingTitleOf,
  researchReportHtml,
  shouldSealLongRead,
  stripReadingTitle,
  tripReportHtml,
  writeHtmlReport,
  type ChatDoc,
  type ReadingSource,
  type FlightLink,
  type HotelLink,
} from "./agent/report-html.js";
import { cachedReaderResult, extractReadable, openReaderModeTab } from "./agent/reader.js";
import {
  getHighlightsForUrl,
  loadHighlights,
  upsertHighlightsForUrl,
  type Highlight,
} from "./agent/highlight.js";
import {
  deleteNote,
  htmlToMarkdown,
  listNotes,
  readNote,
  replyNoteFields,
  writeNote,
} from "./agent/notes.js";
import { detectFileTask, type FileTaskPlan } from "./agent/files/intent.js";
import { readLocalDoc, type LocalDoc } from "./agent/files/read.js";
import { stemOf } from "./agent/files/path-detect.js";
import { buildPptx, exportsDir, slidesFromMarkdown, stamp, writeExport } from "./agent/files/docgen.js";
import { chartSvg, parseRows, pickSeries, type ChartSpec } from "./agent/files/chart.js";
import {
  filterShopOffers,
  formatShopPicks,
  looksLikeEatPlayAsk,
  looksLikeResearchAsk,
  cleanSearchPageText,
  missionNeedsReport,
  reportChips,
  researchChatBrief,
  researchReportTitle,
  shouldSealShopReport,
  tripChatBrief,
  type ShopOffer,
} from "./agent/research-report.js";
import {
  isUsableCaptureBuffer,
  parseScreenshotInput,
  sanitizeImageDataUrls,
  validClip,
  wantsPageShot,
  type ScreenshotOpts,
} from "./agent/vision.js";
import { withJsonModel } from "./cloud/request-body.js";
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
  getSkill,
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
  skillCatalogLines,
  resolveSkill,
} from "./skills/runner.js";
import { tx } from "../shared/i18n.js";
import { storeConfigDir } from "./paths.js";
import {
  normalizeReader,
  persistLocaleIfMissing,
  saveSettings,
  settingsPublicView,
  type ReaderPrefs,
  type SparkSettings,
} from "./settings/store.js";
import { chatCompletionsUrl } from "./settings/llm-url.js";
import {
  accountUrl,
  chatCompletionsCloudUrl,
  cloudApiBase,
  isMsftChannel,
  isOfficialAccountUrl,
} from "./cloud/config.js";
import {
  clearTokens,
  fetchMe,
  loadTokens,
  refreshIfNeeded,
  describeCloudError,
  sendLoginCode,
  verifyLogin,
  type QuotaSnap,
} from "./cloud/auth.js";
import { assertAndStartTask, createCloudCheckout, fetchCloudPlans, settleCloudTask } from "./cloud/quota.js";
import { isCloudPlanId, type CloudPlanPublic } from "./cloud/pricing.js";
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
  FILL_12306_SCRIPT,
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
  EXTRACT_1688_OFFERS_SCRIPT,
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

const DEFAULT_URL = "https://www.baidu.com";

function noteHang(tag: string, detail: string): void {
  try {
    const dir = join(storeConfigDir(), "diag");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "crash.log"), `${new Date().toISOString()} [${tag}] ${detail}\n`);
  } catch {
    /* 写不进就算了 */
  }
}

const CHROME_H = 76; // tabs 36 + omnibox 40（书签栏已移除）
const SIDEBAR_W = 340;

type TabInfo = {
  id: string;
  view: WebContentsView | null;
  title: string;
  url: string;
  envId?: string;
  discarded?: boolean;
  favIcon?: string;
  /** 任务完成后休眠。标签栏用灰点标「已完成」，点一下再唤醒。 */
  agentStatus?: "done";
  /** 这张标签正卡在 waiting_human。release 时不休眠。 */
  holdHuman?: boolean;
  lastActiveAt: number;
  /** Agent 后台标签：不可见时不节流定时器。用户自己的标签保持节流。 */
  agentOwned?: boolean;
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

/**
 * 模型 navigate 步骤里的 query 解析成真实 URL：
 * - 合法 http(s) URL（host 无中文）原样用；裸 ASCII 域名补 https
 * - 中文站名（百度/哔哩哔哩/12306…）查站点表拿 homeUrl
 * - 都不命中：百度搜索兜底，绝不能把中文直接当域名导航成 punycode
 */
function resolveStepUrl(raw: string): string {
  const q = String(raw || "").trim();
  const m = q.match(/^https?:\/\/([^\s/?#]+)/i);
  if (m && !/[一-鿿]/.test(m[1])) return q;
  if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:[/?#].*)?$/i.test(q) && !/[一-鿿]/.test(q)) {
    return `https://${q}`;
  }
  const hit = detectSite(q);
  if (hit?.homeUrl) return hit.homeUrl;
  return `https://www.baidu.com/s?wd=${encodeURIComponent(q.replace(/^https?:\/\//i, ""))}`;
}

/** 模型偶尔把整段 Markdown 包在 ``` 里，去掉围栏。 */
function stripCodeFence(raw: string): string {
  const text = String(raw || "").trim();
  const m = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n```$/.exec(text);
  return (m ? m[1] : text).trim();
}

function titleOfBody(md: string): string {
  const first = String(md || "").split("\n")[0] || "";
  const m = /^#\s+(.+)$/.exec(first.trim());
  return m ? m[1].trim().slice(0, 80) : "";
}

/** 交付稿里不渲染 mermaid，模型自画的 mermaid 块会变成难看的代码框，去掉。 */
function stripMermaid(md: string): string {
  return String(md || "")
    .replace(/```mermaid[\s\S]*?```/g, "")
    .replace(/```[a-zA-Z]*\s*\n?```/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 侧栏内存按钮标题：N 个标签进程 · 约 X MB。 */
export function formatTabMemoryBoard(
  locale: string | undefined,
  processes: number,
  mb: number,
): string {
  return tx(locale, "mem.board", {
    n: Math.max(0, Math.round(Number(processes) || 0)),
    mb: Math.max(0, Math.round(Number(mb) || 0)),
  });
}

type TaskScope = {
  tabId: string;
  lane: TaskLane;
  mission: ActiveMission | undefined;
  lastMission: ActiveMission | undefined;
  helpAsk: HelpAsk | null;
  cloudTaskId: string | undefined;
};

type BackgroundJob = {
  id: string;
  text: string;
  images?: string[];
  quotes?: SparoQuote[];
  title: string;
  mission?: ActiveMission;
};

function missionStillOpen(mission: { state?: string } | undefined): boolean {
  if (!mission) return false;
  return mission.state !== "done" && mission.state !== "cancelled";
}

/** stub.ts 88–90 的句式。不走 parseLocalIntent，避免被 parseMission 抢走，也不截「发小红书」。 */
function runSkillUtteranceQuery(text: string): string | null {
  const matched =
    text.match(/(?:运行|执行|打|用|按)\s*妙招\s*[「"']?(.+?)[」"']?\s*$/i) ||
    text.match(/run\s*skill\s+(.+)$/i);
  if (!matched) return null;
  const query = matched[1].trim().replace(/^["'「」]+|["'「」]+$/g, "");
  return query || null;
}

/**
 * 窄路只放行精确 id/标题，或别名命中，并带回技能 id。
 * 纯标题子串（「QA门岗演示2」含「QA门岗演示」）不算找到。
 * 执行走 id；matchSkills 只用来挑候选，不替 runSkill 模糊直跑。
 */
function namedSkillId(configDir: string, query: string): string | null {
  const direct = getSkill(configDir, query);
  if (direct) return direct.id;
  const hit = matchSkills(configDir, query, 1)[0];
  const reason = hit?.reason || "";
  if (hit && (reason.includes("exact") || reason.includes("alias:"))) return hit.id;
  return null;
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
  /** 启动时回放出来的未完成单。只问一次，不挡后面的新句子。 */
  private pendingRecovery: RestoredMission | null = null;
  private lastReaderSender: WebContents | null = null;
  /** activeMission / lastMission 按任务放进 AsyncLocalStorage。 */
  /** 前台任务（填表/回复/发帖确认）本轮是否已经拉回过窗口。只允许一次。 */
  private coPresenceRestored = false;
  /** 已对侧栏播报过的 chatLog 长度。-1 表示还没建立基线，避免启动时乱闪。 */
  private lastNotifiedChat = -1;
  private taskbarFlashing = false;
  private chatQueue: Array<{ text: string; images?: string[]; quotes?: SparoQuote[] }> = [];
  private backgroundQueue: BackgroundJob[] = [];
  private waitingMissions = new Map<string, ActiveMission>();
  /** 后台并发上限 3，写死在 TASK_POOL_LIMIT。 */
  private taskPool = new TaskPool();
  private taskScope = new AsyncLocalStorage<TaskScope>();
  private fallbackAgentTabId = "";
  private fallbackMission: ActiveMission | undefined;
  private fallbackLastMission: ActiveMission | undefined;
  private fallbackHelpAsk: HelpAsk | null = null;
  private fallbackCloudTaskId: string | undefined;
  /** 同一句排队话只问一次模型是不是在改计划。 */
  private planEditSeen = new Set<string>();
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
  private cloudQuota: QuotaSnap | null = null;
  private cloudPlans: CloudPlanPublic[] = [];
  private lastCloudRefuse = "";
  private memoryTimer: ReturnType<typeof setInterval> | null = null;
  /** 报告和阅读模式共用的标签。用户关掉后置空。手动新开的研究页不记在这里。 */
  private readerTabId: string | null = null;
  private holeBounds: { x: number; y: number; width: number; height: number } | null = null;
  private sidebarW = SIDEBAR_W;
  // 最近一次正常的窗口客户区尺寸。最小化→恢复瞬间 getContentSize 会短暂返回 0，
  // 不能拿 0 去算页面 bounds（会把视图夹到 100px 并残留）。
  private lastGoodContent = { width: 0, height: 0 };
  private overlay: "none" | "history" = "none";
  private findOpen = false;
  private lastClosed: { url: string; envId?: string } | null = null;
  private lastDownloadPath = "";
  private downloadSessions = new WeakSet<Electron.Session>();
  private recentLearned: ObservedAction[] = [];
  private learnedTold = new Set<string>();

  /**
   * 模型工具回调没有 tab 参数。写在当前异步任务上，没有任务时仍是激活标签。
   * chatRunning 留成计算属性，保活逻辑还在读它。
   */
  private get agentTabId(): string {
    const scope = this.taskStore();
    if (scope) return scope.tabId;
    return this.fallbackAgentTabId || "";
  }

  private set agentTabId(id: string) {
    const scope = this.taskStore();
    if (scope) scope.tabId = id;
    else this.fallbackAgentTabId = id;
  }

  private get activeMission(): ActiveMission | undefined {
    const scope = this.taskStore();
    if (scope) return scope.mission;
    return this.fallbackMission;
  }

  private set activeMission(mission: ActiveMission | undefined) {
    const scope = this.taskStore();
    if (scope) scope.mission = mission;
    else this.fallbackMission = mission;
  }

  private get lastMission(): ActiveMission | undefined {
    const scope = this.taskStore();
    if (scope) return scope.lastMission;
    return this.fallbackLastMission;
  }

  private set lastMission(mission: ActiveMission | undefined) {
    const scope = this.taskStore();
    if (scope) scope.lastMission = mission;
    else this.fallbackLastMission = mission;
  }

  private get helpAsk(): HelpAsk | null {
    const scope = this.taskStore();
    if (scope) return scope.helpAsk;
    return this.fallbackHelpAsk;
  }

  private set helpAsk(ask: HelpAsk | null) {
    const scope = this.taskStore();
    if (scope) scope.helpAsk = ask;
    else this.fallbackHelpAsk = ask;
  }

  private get cloudTaskId(): string | undefined {
    const scope = this.taskStore();
    if (scope) return scope.cloudTaskId;
    return this.fallbackCloudTaskId;
  }

  private set cloudTaskId(id: string | undefined) {
    const scope = this.taskStore();
    if (scope) scope.cloudTaskId = id;
    else this.fallbackCloudTaskId = id;
  }

  private chatRunningFlag = false;

  private get chatRunning(): boolean {
    const pool = this.taskPool;
    if (pool && (pool.foregroundBusy || pool.size > 0)) return true;
    return this.chatRunningFlag;
  }

  private set chatRunning(running: boolean) {
    this.chatRunningFlag = running;
  }

  private taskStore(): TaskScope | undefined {
    const als = this.taskScope;
    if (!als || typeof als.getStore !== "function") return undefined;
    return als.getStore();
  }

  private foregroundMission(): ActiveMission | undefined {
    const scope = this.taskStore();
    if (scope?.lane === "background") return this.fallbackMission;
    return this.activeMission;
  }

  private foregroundLastMission(): ActiveMission | undefined {
    const scope = this.taskStore();
    if (scope?.lane === "background") return this.fallbackLastMission;
    return this.lastMission;
  }

  private sidebarHelpAsk(): HelpAsk | null {
    const scope = this.taskStore();
    if (scope?.lane === "background") return this.fallbackHelpAsk;
    return this.helpAsk;
  }

  private noteTaskStep(step: string): void {
    const scope = this.taskStore();
    const pool = this.taskPool;
    if (!scope || !pool) return;
    const task = pool.tasks.find((item) => item.tabId === scope.tabId && item.state === "running");
    if (!task) return;
    pool.setStep(task.id, step);
  }

  /** Active page view — keeps existing tool code working. */
  private getActiveTab(): TabInfo | null {
    return this.tabs.get(this.activeTabId) ?? null;
  }

  /**
   * 取指定标签的页面视图。已休眠则先唤醒。标签不存在则抛错。
   * 后台任务用自己的 tabId，不再跟用户正看着的那一页。
   */
  viewForTab(tabId: string): WebContentsView {
    const tab = this.tabs.get(tabId);
    if (!tab) throw new Error(`Tab not found: ${tabId}`);
    if (!tab.view || tab.discarded) this.wakeTab(tab.id);
    if (!tab.view) throw new Error(`Tab view missing: ${tabId}`);
    return tab.view;
  }

  /** 开一个不抢焦点的后台标签。activeTabId 保持不变。关闭渲染节流，最小化时定时器照跑。 */
  createAgentTab(url?: string): string {
    const target = url && url.trim() ? url : DEFAULT_URL;
    return this.createTab(target, false, { agentOwned: true });
  }

  /**
   * 任务结束、报告已经落盘：休眠这张标签，释放渲染进程，标签栏留记录。
   * 还在 waiting_human 则不休眠，等人处理。用户正看着的标签也不休眠。
   * 点标签走 switchTab → wakeTab。
   */
  releaseAgentTab(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    if (this.tabAwaitsHuman(tabId)) return;
    if (tabId === this.activeTabId) return;
    const slept = this.discardTab(tabId);
    if (!slept && !tab.discarded) return;
    tab.agentStatus = "done";
    this.layout();
    this.pushChromeState();
  }

  /** 这张标签还在等人（登录 / 验证）。等人时不休眠。 */
  private tabAwaitsHuman(tabId: string): boolean {
    const tab = this.tabs.get(tabId);
    if (tab?.holdHuman) return true;
    if (this.activeMission?.state !== "waiting_human") return false;
    const hand = this.agentTabId || this.activeTabId;
    return hand === tabId;
  }

  /**
   * @deprecated 此后 Agent 路径一律显式传 tabId，不要再调用 this.pageView。
   * getter 本体只把当前激活标签交给 viewForTab。
   */
  private get pageView(): WebContentsView {
    return this.viewForTab(this.activeTabId);
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
      backgroundColor: "#fbfbfd",
      show: false,
      autoHideMenuBar: true,
      titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
      ...(process.platform === "darwin"
        ? {}
        : {
            titleBarOverlay: {
              color: "#fbfbfd",
              symbolColor: "#12141a",
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
    this.window.webContents.on("render-process-gone", (_e, details) => {
      console.error("[shell] render-process-gone", details.reason);
      noteHang("shell-render-gone", details.reason);
      if (details.reason !== "clean-exit" && details.reason !== "killed") {
        try {
          this.window.webContents.reload();
        } catch {
          /* 已销毁 */
        }
      }
    });
    this.window.webContents.on("unresponsive", () => this.onShellUnresponsive());
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
    this.settings = persistLocaleIfMissing(this.configDir(), app.getLocale());
    this.rebuildDeepSeek();
    void this.refreshCloudQuota()
      .then(() => this.refreshCloudPlans())
      .then(() => this.pushSidebarState());
    this.chatLog = loadChatMemory(this.configDir());
    this.offerMissionRecovery();
    this.window.on("resize", () => this.layout());
    this.window.on("maximize", () => this.layout());
    this.window.on("unmaximize", () => this.layout());
    this.window.on("enter-full-screen", () => this.layout());
    this.window.on("leave-full-screen", () => this.layout());
    // Windows 上最小化→恢复不一定补一次有效 resize（事件可能在尺寸还是 0 时触发）。
    // Electron 没有 unminimize；restore 就是从最小化还原。延迟补排，防止页面视图停在 100px 窄条。
    this.window.on("restore", () => {
      this.scheduleLayout(150);
      // 壳层回到前台就恢复节流。Agent 标签是独立 webContents，不受这条影响。
      this.setShellBackgroundThrottling(true);
    });
    this.window.on("minimize", () => this.syncShellKeepalive());
    this.window.on("focus", () => this.clearTaskbarFlash());
    this.window.on("show", () => this.scheduleLayout(150));
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

  private makePageView(envId?: string, opts?: { agentOwned?: boolean }): WebContentsView {
    const prefs = {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Agent 持有的后台标签关掉节流，最小化时定时器照跑。用户标签和 env 标签保持 true。
      backgroundThrottling: opts?.agentOwned === true ? false : true,
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
      wc.setBackgroundThrottling(tab.agentOwned !== true);
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
      onQuote: (payload) => {
        if (this.window.isDestroyed() || this.window.webContents.isDestroyed()) return;
        this.window.webContents.send("spark:quote-from-page", {
          text: payload.text,
          url: payload.url,
          title: payload.title,
          siteName: payload.siteName,
          favicon: tab.favIcon || "",
          kind: "page",
        });
      },
    });
    this.attachChromeShortcuts(wc);
    wc.setUserAgent(chromeUserAgent());
    wc.on("render-process-gone", (_e, details) => {
      console.error("[page] render-process-gone", details.reason, tab.url);
      noteHang("page-render-gone", `${details.reason} ${tab.url}`);
      if (details.reason !== "clean-exit" && details.reason !== "killed") {
        this.recoverHungPage(tab);
      }
    });
    // 渲染进程卡死：不要原址刷新（Google/B站会再卡死），离开该页并保证窗体在屏幕上。
    let lastUnresponsiveRecover = 0;
    wc.on("unresponsive", () => {
      console.error("[page] unresponsive", tab.url);
      const now = Date.now();
      if (now - lastUnresponsiveRecover < 60_000) return;
      lastUnresponsiveRecover = now;
      this.recoverHungPage(tab);
    });
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
    // 安全网：活动页每次加载完成后重排一次。行程任务会连续跳转，
    // 即使某一帧被夹窄，下一次导航也会立刻恢复。
    wc.on("dom-ready", () => {
      if (this.activeTabId === id) this.scheduleLayout(60);
    });
    view.on("bounds-changed", () => this.onPageViewBoundsChanged(view));
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
    wc.on("page-favicon-updated", (_e, icons: string[]) => {
      tab.favIcon = (icons && icons[0]) || "";
      this.pushChromeState();
    });
    wc.on("did-navigate", (_e, navUrl) => {
      tab.favIcon = "";
      sync();
      this.noteNavigation(String(navUrl || ""));
    });
    wc.on("did-navigate-in-page", sync);
    wc.on("did-finish-load", () => {
      sync();
      // 阅读页这类本地文件会在首屏绘制时再被拉成整窗，加载完成后再守一轮。
      if (this.activeTabId === id) this.armChromeGuard();
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
      const view = this.makePageView(tab.envId, { agentOwned: tab.agentOwned === true });
      tab.view = view;
      this.pinViewBeforeMount(view);
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
    const idleMs = (this.settings.memorySaverIdleMinutes || 5) * 60_000;
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

  /** 汇总仍活着的标签渲染进程。Electron 的 workingSetSize 单位是 KB。 */
  private tabProcessUsage(): { processes: number; mb: number } {
    try {
      const metrics = typeof app.getAppMetrics === "function" ? app.getAppMetrics() : [];
      const tabs = metrics.filter((m) => m.type === "Tab");
      if (tabs.length) {
        const kb = tabs.reduce((sum, m) => sum + Number(m.memory?.workingSetSize || 0), 0);
        return { processes: tabs.length, mb: Math.max(0, Math.round(kb / 1024)) };
      }
    } catch {
      /* 指标不可用时退回仍活着的标签数 */
    }
    let processes = 0;
    for (const tab of this.tabs.values()) {
      const wc = tab.view?.webContents;
      if (!tab.discarded && wc && !wc.isDestroyed()) processes += 1;
    }
    return { processes, mb: 0 };
  }

  memoryBoardLine(): string {
    const { processes, mb } = this.tabProcessUsage();
    return formatTabMemoryBoard(this.settings?.locale, processes, mb);
  }

  private createTab(url = DEFAULT_URL, activate = true, opts?: { agentOwned?: boolean }): string {
    const id = randomBytes(4).toString("hex");
    const agentOwned = opts?.agentOwned === true;
    const view = this.makePageView(undefined, { agentOwned });
    const tab: TabInfo = {
      id,
      view,
      title: tx(this.settings.locale, "tab.new"),
      url,
      lastActiveAt: Date.now(),
      agentOwned,
    };
    this.tabs.set(id, tab);
    if (activate) this.activeTabId = id;
    this.pinViewBeforeMount(view);
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
    this.pinViewBeforeMount(view);
    this.window.contentView.addChildView(view);
    this.bindPageWebContents(tab);
    this.layout();
    void view.webContents.loadURL(normalizeUrl(url));
    this.switchTab(id);
    return id;
  }

  listTabs(): {
    tabs: Array<{
      id: string;
      title: string;
      url: string;
      discarded?: boolean;
      favIcon?: string;
      agentStatus?: "done";
    }>;
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
        favIcon: t.favIcon || "",
        agentStatus: t.agentStatus === "done" ? "done" : undefined,
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
    const roots = ["reports", "exports"].map((d) => resolvePath(join(this.configDir(), d)));
    const abs = resolvePath(filePath);
    if (!roots.some((r) => abs.toLowerCase().startsWith(r.toLowerCase()))) {
      return { ok: false, message: "文档路径无效" };
    }
    if (!existsSync(abs)) {
      return { ok: false, message: "文档已经不在了" };
    }
    // 后台任务出报告时才允许切到报告标签（openInReaderTab / newTab 会 switchTab）。这是唯一例外。
    // 其余后台步骤留在 createAgentTab 的标签上，不准切走用户当前页。
    // 浏览器能直接看的（HTML / PDF / 图片）复用阅读器标签；PPT/Office 交给系统默认程序
    if (/\.(html?|pdf|png|jpe?g|svg)$/i.test(abs)) {
      return this.openInReaderTab(pathToFileURL(abs).href);
    }
    void shell.openPath(abs);
    return { ok: true, message: `已交给系统打开：${abs}` };
  }

  newTab(url?: string): ToolResult {
    const id = this.createTab(url || DEFAULT_URL, true);
    return { ok: true, message: `Opened tab ${id}`, data: { id, ...this.listTabs() } };
  }

  /**
   * 报告和阅读模式共用一个标签：已在且未关就 loadURL 并切过去，否则新建并记下 id。
   * 用户自己点「新标签」走 newTab，不进这里。
   * 窗口最小化时只切标签并闪任务栏，不 restore。
   */
  private openInReaderTab(fileUrl: string): ToolResult {
    let result: ToolResult = { ok: false, message: "未能打开报告" };
    this.withoutStealingMinimizedWindow(() => {
      result = this.mountReaderTab(fileUrl);
    });
    return result;
  }

  private mountReaderTab(fileUrl: string): ToolResult {
    const existing = this.readerTabId ? this.tabs.get(this.readerTabId) : undefined;
    if (!existing) {
      this.readerTabId = null;
      const id = this.createTab(fileUrl, true);
      this.readerTabId = id;
      return { ok: true, message: `Opened tab ${id}`, data: { id, reused: false, ...this.listTabs() } };
    }
    existing.url = fileUrl;
    const alreadyAwake = Boolean(existing.view) && !existing.discarded;
    this.switchTab(existing.id);
    if (alreadyAwake) {
      const wc = existing.view?.webContents;
      if (wc && !wc.isDestroyed()) void wc.loadURL(normalizeUrl(fileUrl));
    }
    return {
      ok: true,
      message: `Opened tab ${existing.id}`,
      data: { id: existing.id, reused: true, ...this.listTabs() },
    };
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
    if (this.readerTabId === id) this.readerTabId = null;
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

  /** 最小化时包住会抢焦点的视图操作。做完若窗口被弹回，再最小化，并闪任务栏。 */
  private windowIsMinimized(): boolean {
    try {
      return Boolean(this.window && !this.window.isDestroyed() && this.window.isMinimized());
    } catch {
      return false;
    }
  }

  private withoutStealingMinimizedWindow(work: () => void): void {
    const minimized = this.windowIsMinimized();
    if (!minimized) {
      work();
      return;
    }
    const win = this.window;
    try {
      win.setFocusable(false);
    } catch {
      /* ignore */
    }
    try {
      work();
    } finally {
      try {
        if (!win.isDestroyed()) {
          win.setFocusable(true);
          if (!win.isMinimized()) win.minimize();
        }
      } catch {
        /* ignore */
      }
    }
    this.flashTaskbarIfHidden();
  }

  /** 壳层假死：人正看着窗口才拉回。最小化时只闪任务栏，后台出报告不能靠这条弹窗。 */
  private onShellUnresponsive(): void {
    console.error("[shell] unresponsive");
    noteHang("shell-unresponsive", "sidebar");
    if (this.windowIsMinimized()) {
      this.flashTaskbarIfHidden();
      return;
    }
    this.ensureWindowVisible();
  }

  /** First show only. Later calls must not center() — that fights the user dragging the window. */
  private didPlaceWindow = false;
  presentWindow(): void {
    if (this.window.isDestroyed()) return;
    try {
      const iconPath = resolveAppIconPath();
      if (iconPath) this.window.setIcon(iconPath);
      this.layout();
      // 只有第一次摆上屏幕才拉窗口。之后（含任务入口）不再 restore。
      if (this.didPlaceWindow) return;
      this.ensureWindowVisible(true);
      this.didPlaceWindow = true;
      setTimeout(() => {
        if (this.window.isDestroyed() || this.window.isMinimized()) return;
        this.ensureWindowVisible(false);
      }, 1600);
    } catch (error) {
      console.error("[shell] presentWindow failed:", error);
    }
  }

  /**
   * 最小化 / 甩到屏幕外时拉回工作区。只留给三处：
   * 壳层渲染进程 unresponsive、首次 presentWindow、前台任务的一次人机同窗。
   * 后台任务路径禁止调用。
   */
  private ensureWindowVisible(recenter = false): void {
    if (this.window.isDestroyed()) return;
    try {
      if (this.window.isMinimized()) this.window.restore();
      const wa = screen.getPrimaryDisplay().workArea;
      const b = this.window.getBounds();
      const onScreen =
        b.width >= 400 &&
        b.height >= 300 &&
        b.x + b.width > wa.x + 40 &&
        b.y + b.height > wa.y + 40 &&
        b.x < wa.x + wa.width - 40 &&
        b.y < wa.y + wa.height - 40;
      if (recenter || !onScreen) {
        const width = Math.min(1360, Math.max(800, wa.width - 48));
        const height = Math.min(900, Math.max(560, wa.height - 48));
        this.window.setBounds({
          x: wa.x + Math.round((wa.width - width) / 2),
          y: wa.y + Math.round((wa.height - height) / 2),
          width,
          height,
        });
      }
      this.window.show();
      this.window.focus();
      // restore/setBounds 后客户区尺寸可能下一帧才有效，补一次延迟布局。
      this.scheduleLayout(120);
      this.scheduleLayout(400);
    } catch (error) {
      console.error("[shell] ensureWindowVisible failed:", error);
    }
  }

  /**
   * 填表、回复评论、发帖确认（含支付前核对）是人机同窗：
   * 窗口已经最小化时只拉回一次，方便看着草稿和付款。
   * 后台调研、比价、行程不走这里。
   */
  private restoreForCoPresence(): void {
    if (this.coPresenceRestored) return;
    this.coPresenceRestored = true;
    if (this.window.isDestroyed()) return;
    let minimized = false;
    try {
      minimized = this.window.isMinimized();
    } catch {
      return;
    }
    if (!minimized) return;
    this.ensureWindowVisible(false);
  }

  /** 用已有的前台分类（填表 / 回复 / 发帖），不新写句子正则。 */
  private maybeRestoreForCoPresence(actionType?: string, userAsk?: string): void {
    const ask = String(userAsk || "");
    const kind = this.activeMission?.goal.kind;
    const foreground =
      actionType === "fill_form" ||
      actionType === "one_click_reply" ||
      kind === "form" ||
      kind === "publish" ||
      wantsFillForm(ask) ||
      wantsReply(ask) ||
      wantsPublish(ask);
    if (!foreground) return;
    this.restoreForCoPresence();
  }

  /** T06 的 taskPool 还没合并时，用正在跑的工作单和 chatRunning。 */
  private agentTasksRunning(): boolean {
    const pool = (this as unknown as { taskPool?: unknown }).taskPool;
    if (Array.isArray(pool)) return pool.length > 0;
    if (pool && typeof pool === "object" && "size" in pool && typeof (pool as { size: unknown }).size === "number") {
      return (pool as { size: number }).size > 0;
    }
    if (this.chatRunning) return true;
    const state = this.activeMission?.state;
    return state === "running" || state === "waiting_human";
  }

  private setShellBackgroundThrottling(throttle: boolean): void {
    try {
      if (this.window.isDestroyed() || this.window.webContents.isDestroyed()) return;
      this.window.webContents.setBackgroundThrottling(throttle);
    } catch {
      /* older Electron */
    }
  }

  /** 最小化且还有 Agent 任务时，壳层定时器不节流；任务结束或窗口恢复后回到节流。 */
  private syncShellKeepalive(): void {
    if (this.window.isDestroyed()) return;
    let minimized = false;
    try {
      minimized = this.window.isMinimized();
    } catch {
      return;
    }
    const running = this.agentTasksRunning();
    if (!running) this.coPresenceRestored = false;
    if (!minimized) {
      this.setShellBackgroundThrottling(true);
      return;
    }
    this.setShellBackgroundThrottling(!running);
  }

  /** 侧栏新消息在窗口最小化或未聚焦时只闪任务栏，不把窗口弹回来。 */
  private noteSidebarMessages(): void {
    const n = this.chatLog.length;
    if (this.lastNotifiedChat < 0 || !this.didPlaceWindow) {
      this.lastNotifiedChat = n;
      return;
    }
    if (n <= this.lastNotifiedChat) {
      this.lastNotifiedChat = n;
      return;
    }
    const added = this.chatLog.slice(this.lastNotifiedChat);
    this.lastNotifiedChat = n;
    if (!added.some((m) => m.role === "assistant")) return;
    this.flashTaskbarIfHidden();
  }

  private flashTaskbarIfHidden(): void {
    if (this.window.isDestroyed()) return;
    let minimized = false;
    let focused = true;
    try {
      minimized = this.window.isMinimized();
      focused = this.window.isFocused();
    } catch {
      return;
    }
    if (!minimized && focused) return;
    try {
      this.window.flashFrame(true);
      this.taskbarFlashing = true;
    } catch {
      /* ignore */
    }
  }

  private clearTaskbarFlash(): void {
    if (!this.taskbarFlashing || this.window.isDestroyed()) return;
    this.taskbarFlashing = false;
    try {
      this.window.flashFrame(false);
    } catch {
      /* ignore */
    }
  }

  /**
   * BrowserWindow.focus() / webContents.focus() 在 Windows 上会把最小化窗口 restore。
   * 后台点击和填写不再抢焦点。前台任务已在入口拉回一次，窗口在前台时才补焦点。
   */
  private focusPageForInput(wc: WebContents): void {
    if (this.window.isDestroyed()) return;
    let hidden = true;
    try {
      hidden = this.window.isMinimized() || !this.window.isFocused();
    } catch {
      return;
    }
    if (hidden) return;
    this.window.focus();
    try {
      wc.focus();
    } catch {
      /* ignore */
    }
  }

  private recoverHungPage(tab: TabInfo): void {
    noteHang("page-hung", tab.url || "");
    this.flashTaskbarIfHidden();
    const wc = tab.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    try {
      wc.stop();
    } catch {
      /* ignore */
    }
    const cur = String(tab.url || wc.getURL() || "");
    const next = /baidu\.com/i.test(cur) || cur === DEFAULT_URL ? "about:blank" : DEFAULT_URL;
    try {
      void wc.loadURL(next);
    } catch {
      /* ignore */
    }
    this.sendToast(tx(this.settings.locale, "page.hung"));
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
    const wc = this.viewForTab(this.activeTabId)?.webContents;
    if (!wc || wc.isDestroyed()) return;
    const next = Math.min(3, Math.max(0.3, wc.getZoomFactor() + delta));
    wc.setZoomFactor(next);
  }

  private setZoomFactor(factor: number): void {
    const wc = this.viewForTab(this.activeTabId)?.webContents;
    if (!wc || wc.isDestroyed()) return;
    wc.setZoomFactor(factor);
  }

  private togglePageDevTools(): void {
    const wc = this.viewForTab(this.activeTabId)?.webContents;
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

  private sendToast(text: string, path?: string, duration?: number, undo?: boolean): void {
    if (this.window.isDestroyed() || this.window.webContents.isDestroyed()) return;
    try {
      this.window.webContents.send("spark:toast", {
        text,
        path: path || "",
        duration: duration || 0,
        undo: Boolean(undo),
      });
    } catch {
      /* ignore */
    }
  }

  private livePage(tabId?: string): WebContents | null {
    const tab = tabId ? (this.tabs.get(tabId) ?? null) : this.getActiveTab();
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
    if (!from || !to || from === to) {
      return { ok: true, message: "tabs unchanged", data: this.listTabs() };
    }
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
    return { ok: true, message: "tabs reordered", data: this.listTabs() };
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

  private pageBounds(): { x: number; y: number; width: number; height: number } | null {
    const [rawW, rawH] = this.window.getContentSize();
    let minimized = false;
    try {
      minimized = this.window.isMinimized();
    } catch {
      /* ignore */
    }
    // 恢复/显示瞬间 content size 可能为 0，或窗口处于最小化：沿用上次正常尺寸，
    // 两者都没有就放弃本轮布局。绝不能把视图 setBounds 成窄条——网页按窄视口重排后
    // 不会自己恢复，且 Windows 恢复过渡的 resize 事件可能在尺寸还是 0 时就发完了。
    if (!minimized && rawW >= 400 && rawH >= 300) {
      this.lastGoodContent = { width: rawW, height: rawH };
    }
    const width = !minimized && rawW >= 400 ? rawW : this.lastGoodContent.width;
    const height = !minimized && rawH >= 300 ? rawH : this.lastGoodContent.height;
    if (!width || !height) return null;
    // 洞宽由窗口宽减可调侧栏宽决定。侧栏宽度由 spark:set-sidebar-width 下发并夹取，
    // 不采信 shell 在恢复过渡期可能发来的旧洞宽——那正是视图被夹成 100px 的来源。
    const viewW = Math.max(100, width - this.sidebarW);
    const fallback = {
      x: 0,
      y: CHROME_H,
      width: viewW,
      height: Math.max(100, height - CHROME_H),
    };
    if (
      this.holeBounds &&
      this.holeBounds.width >= 80 &&
      this.holeBounds.height >= 80
    ) {
      const b = { ...this.holeBounds };
      b.x = 0;
      b.width = viewW;
      // y 不能进顶栏（标签 36 + 地址栏 40）。低于顶栏或离谱就回退常量。
      if (b.y < CHROME_H || b.y > 200) b.y = CHROME_H;
      const maxH = Math.max(100, height - b.y);
      if (b.height < 200 || b.height > maxH) b.height = maxH;
      return b;
    }
    return fallback;
  }

  private applyViewBounds(followUp = true): void {
    if (this.window.isDestroyed()) return;
    const bounds = this.pageBounds();
    // 窗口尺寸此刻无效（最小化/恢复/隐藏过渡）：不动任何视图，稍后尺寸回来再排。
    if (!bounds) {
      this.scheduleLayout(250);
      return;
    }
    const hidePage = this.overlay !== "none";
    for (const [id, tab] of this.tabs) {
      if (!tab.view) continue;
      const active = id === this.activeTabId && !hidePage;
      try {
        if (active) this.mountPageView(tab.view, bounds, !followUp);
        else this.parkPageView(tab.view, bounds, !followUp);
      } catch {
        /* 视图已销毁 */
      }
    }
    // addChildView 之后，以及阅读页首屏绘制时，Chromium 会把子视图拉成整窗，
    // 同一次调用里的 setBounds 会被盖掉。顶栏和侧栏就只剩系统按钮，直到用户缩放窗口。
    // 一次 100ms 补排经常发生在这次拉伸之前，所以加载后再守几拍。
    if (followUp) this.armChromeGuard();
  }

  /**
   * 活动页或被拉回屏幕的后台页盖住顶栏/侧栏时，立刻按页面洞重排。
   * 自己这次 setBounds 触发的 bounds-changed 用 boundsGuard 挡掉，避免来回拉。
   */
  private onPageViewBoundsChanged(view: WebContentsView): void {
    if (this.boundsGuard || this.overlay !== "none") return;
    const hole = this.pageBounds();
    if (!hole) return;
    let actual: { x: number; y: number; width: number; height: number };
    try {
      actual = view.getBounds();
    } catch {
      return;
    }
    if (!pageViewCoversChrome(actual, hole)) return;
    const now = Date.now();
    if (now - this.chromeCoverWindow > 3000) {
      this.chromeCoverWindow = now;
      this.chromeCoverFixes = 0;
    }
    this.chromeCoverFixes += 1;
    if (this.chromeCoverFixes > 8) return;
    if (this.chromeCoverFixes === 1) {
      console.warn("[layout] page view covered chrome, restoring page hole");
    }
    this.boundsGuard = true;
    try {
      this.applyViewBounds(false);
    } catch {
      /* 视图已销毁 */
    } finally {
      this.boundsGuard = false;
    }
  }

  /** 父布局之后再排几次。拉伸若落在首屏绘制，单次 100ms 补排会错过。 */
  private armChromeGuard(): void {
    for (const timer of this.chromeGuardTimers) clearTimeout(timer);
    this.chromeGuardTimers = [100, 450, 1200, 2500].map((delay) =>
      setTimeout(() => {
        if (this.window.isDestroyed()) return;
        this.boundsGuard = true;
        try {
          this.applyViewBounds(false);
        } finally {
          this.boundsGuard = false;
        }
      }, delay),
    );
  }

  /** 挂上之前先写成页面洞，避免新视图以整窗大小出现。 */
  private pinViewBeforeMount(view: WebContentsView): void {
    const bounds = this.pageBounds();
    if (!bounds) return;
    try {
      view.setBounds(bounds);
    } catch {
      /* 视图已销毁 */
    }
  }

  private mountPageView(
    view: WebContentsView,
    bounds: { x: number; y: number; width: number; height: number },
    nudge: boolean,
  ): void {
    const parent = this.window.contentView;
    if (!parent.children.includes(view)) {
      view.setBounds(bounds);
      parent.addChildView(view);
      nudge = true;
    }
    view.setVisible(true);
    // 父布局可能已经把视图拉成整窗，而 Electron 会把“和上次相同的 setBounds”当成无操作。
    // 先写一个差 1px 的矩形，再写回目标，强制原生层更新。
    if (nudge) view.setBounds({ ...bounds, width: Math.max(100, bounds.width - 1) });
    view.setBounds(bounds);
  }

  /** 后台标签留在视图树里（后台任务还要跑），但必须移出窗口。 */
  private parkPageView(
    view: WebContentsView,
    bounds: { x: number; y: number; width: number; height: number },
    nudge: boolean,
  ): void {
    view.setVisible(false);
    const parked = {
      x: -20000,
      y: 0,
      width: Math.max(bounds.width, 100),
      height: Math.max(bounds.height, 100),
    };
    if (nudge) view.setBounds({ ...parked, width: parked.width - 1 });
    view.setBounds(parked);
  }

  private layoutTimer: ReturnType<typeof setTimeout> | null = null;
  private chromeGuardTimers: ReturnType<typeof setTimeout>[] = [];
  private boundsGuard = false;
  private chromeCoverFixes = 0;
  private chromeCoverWindow = 0;
  /** 向 shell 要一次最新的 page-hole 测量（恢复过渡的回调可能丢过）。 */
  private requestHoleReport(): void {
    try {
      if (this.window.isDestroyed()) return;
      this.window.webContents.send("spark:request-hole");
    } catch {
      /* ignore */
    }
  }
  /** 延迟补排：窗口恢复过渡尺寸回来后，确保有一次用真实尺寸的布局。 */
  private scheduleLayout(delay = 200): void {
    if (this.layoutTimer) clearTimeout(this.layoutTimer);
    this.layoutTimer = setTimeout(() => {
      this.layoutTimer = null;
      this.requestHoleReport();
      this.layout();
    }, delay);
  }

  private layout(): void {
    this.applyViewBounds();
  }

  private focusShell(): void {
    try {
      if (this.window.isDestroyed()) return;
      this.window.webContents.focus();
    } catch {
      /* ignore */
    }
  }

  private focusActivePage(): void {
    try {
      if (this.window.isMinimized()) return;
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
    ipcMain.removeAllListeners("spark:set-theme");
    ipcMain.on("spark:set-theme", (_e, raw) => {
      const dark = String(raw) === "dark";
      const bg = dark ? "#0d1117" : "#fbfbfd";
      const fg = dark ? "#e8f1f8" : "#12141a";
      try {
        this.window?.setBackgroundColor?.(bg);
        if (process.platform !== "darwin") {
          this.window?.setTitleBarOverlay?.({ color: bg, symbolColor: fg, height: 36 });
        }
      } catch (err) {
        // 老版本 Electron 或非 Windows 下没有这个能力，忽略即可
      }
    });
    ipcMain.removeAllListeners("spark:set-sidebar-width");
    ipcMain.on("spark:set-sidebar-width", (_e, raw) => {
      const w = Math.round(Number(raw));
      if (!Number.isFinite(w)) return;
      // 56 是收起后的工具轨；拖拽宽度仍夹在 300–480。
      const next = w <= 80 ? 56 : Math.min(480, Math.max(300, w));
      if (next === this.sidebarW) return;
      this.sidebarW = next;
      this.layout();
    });
    ipcMain.removeAllListeners("spark:focus-shell");
    ipcMain.on("spark:focus-shell", () => this.focusShell());
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
    handle("spark:learning-answer", async (_e, text: string) => this.answerLearning(String(text || "")));
    handle("spark:learning-skip", async () => this.skipLearning());
    handle("spark:delete-lesson", async (_e, id: string) => {
      const ok = deleteLesson(this.configDir(), String(id || ""));
      this.pushSidebarState();
      return { ok };
    });
    handle("spark:delete-trigger", async (_e, id: string) => {
      const ok = deleteTrigger(this.configDir(), String(id || ""));
      this.pushSidebarState();
      return { ok };
    });
    handle("spark:toggle-trigger", async (_e, id: string, enabled: boolean) => {
      const ok = toggleTrigger(this.configDir(), String(id || ""), Boolean(enabled));
      this.pushSidebarState();
      return { ok };
    });
    handle("spark:remember-trigger", async (_e, payload?: { skillId?: string; text?: string }) => {
      const text = normalizeUtterance(String(payload?.text || ""));
      const skillId = String(payload?.skillId || "").trim();
      if (!text || !skillId) return { ok: false };
      const skill = getSkill(this.configDir(), skillId);
      if (!skill || !this.deepseek) return { ok: false };
      try {
        const verdict = parseOneShotVerdict(
          await this.deepseek.completePlain(
            oneShotJudgePrompt({
              title: skill.title,
              intent: skill.intent,
              stepCount: skill.stepCount,
              steps: skill.steps,
              params: skill.params,
            }),
          ),
        );
        if (verdict !== true) return { ok: false };
      } catch {
        return { ok: false };
      }
      const saved = upsertTrigger(this.configDir(), { skillId, text });
      if (!saved) return { ok: false };
      this.clearPendingTrigger(text);
      this.pushSidebarState();
      return { ok: true };
    });
    handle("spark:get-status", async () => this.getSidebarPayload());
    handle("spark:resolve-approval", async (_e, id: string, approved: boolean) =>
      this.resolveApproval(String(id), Boolean(approved)),
    );
    handle("spark:qa-check", async () => this.qaCheck());
    handle("spark:chat", async (_e, text: string, images?: unknown, quotes?: unknown) =>
      this.handleChat(String(text || ""), sanitizeImageDataUrls(images), quotes),
    );
    handle("spark:open-report", async (_e, filePath: string) =>
      this.openReport(String(filePath || "")),
    );
    handle("reader:open", async () => this.openActiveReader());
    handle("highlight:save", async (e, payload?: { url?: string; highlights?: Highlight[] }) => {
      if (!this.senderIsReaderPage(e.sender)) return { ok: false, message: "只能从阅读页保存高亮" };
      return this.savePageHighlights(payload);
    });
    handle("highlight:load", async (e, payload?: { url?: string }) => {
      if (!this.senderIsReaderPage(e.sender) && !this.senderIsShell(e.sender)) {
        return { ok: false, highlights: [] };
      }
      const url = String(payload?.url || "");
      return { ok: true, highlights: getHighlightsForUrl(loadHighlights(), url) };
    });
    handle("reader:summarizeSelection", async (e, payload?: Record<string, unknown>) => {
      if (!this.senderIsReaderPage(e.sender)) return { ok: false, message: "只能在阅读页总结" };
      return this.summarizeSelection(e.sender, payload || {});
    });
    handle("reader:summarizePage", async (e, payload?: Record<string, unknown>) => {
      if (!this.senderIsReaderPage(e.sender)) return { ok: false, message: "只能在阅读页总结" };
      return this.summarizeReaderPage(e.sender, payload || {});
    });
    handle("notes:saveHighlight", async (e, payload?: Record<string, unknown>) => {
      if (!this.senderIsReaderPage(e.sender)) return { ok: false, message: "只能从阅读页存笔记" };
      return this.saveHighlightNote(payload || {});
    });
    handle("notes:saveFullPage", async (e, payload?: Record<string, unknown>) => {
      if (!this.senderIsReaderPage(e.sender)) return { ok: false, message: "只能从阅读页存笔记" };
      return this.saveFullPageNote(payload || {});
    });
    handle("reader:setCompanion", async (e, payload?: { on?: boolean }) => {
      if (!this.senderIsReaderPage(e.sender) && !this.senderIsShell(e.sender)) {
        return { ok: false, message: "不能从网页改阅读偏好" };
      }
      return this.patchReaderPrefs({ aiCompanionOn: Boolean(payload?.on) });
    });
    handle("reader:prefs", async (e) => {
      if (!this.senderIsReaderPage(e.sender) && !this.senderIsShell(e.sender)) {
        return { ok: false, reader: this.settings.reader };
      }
      return { ok: true, reader: this.settings.reader };
    });
    handle("reader:setPrefs", async (e, patch?: Partial<ReaderPrefs>) => {
      if (!this.senderIsReaderPage(e.sender) && !this.senderIsShell(e.sender)) {
        return { ok: false, message: "不能从网页改阅读偏好" };
      }
      return this.patchReaderPrefs(patch || {});
    });
    handle("reader:toast", async (e, payload?: { text?: string; undo?: boolean }) => {
      if (!this.senderIsReaderPage(e.sender)) return { ok: false };
      this.sendToast(String(payload?.text || ""), undefined, payload?.undo ? 2500 : undefined, Boolean(payload?.undo));
      return { ok: true };
    });
    handle("reader:close", async (e) => {
      if (!this.senderIsReaderPage(e.sender)) return { ok: false, message: "不能关闭这个标签" };
      return this.closeSenderTab(e.sender);
    });
    handle("reader:undo", async () => {
      this.closeReaderDrawer();
      return { ok: true };
    });
    handle("notes:list", async (e, payload?: { limit?: number; tag?: string; search?: string }) => {
      if (!this.senderIsShell(e.sender)) return { ok: false, notes: [] };
      return { ok: true, notes: listNotes(payload?.limit, payload?.tag, payload?.search) };
    });
    handle("notes:delete", async (e, payload?: { id?: string }) => {
      if (!this.senderIsShell(e.sender)) return { ok: false };
      return { ok: deleteNote(String(payload?.id || "")) };
    });
    handle("notes:open", async (e, payload?: { id?: string }) => {
      if (!this.senderIsShell(e.sender)) return { ok: false, message: "只能从侧栏打开笔记" };
      return this.openNoteTab(String(payload?.id || ""));
    });
    handle("spark:notes-search", async (e, payload?: { limit?: number; search?: string }) => {
      if (!this.senderIsShell(e.sender)) return { ok: false, notes: [] };
      const limit = typeof payload?.limit === "number" ? payload.limit : 20;
      return { ok: true, notes: listNotes(limit, undefined, payload?.search) };
    });
    handle("notes:read", async (e, payload?: { id?: string }) => {
      if (!this.senderIsShell(e.sender)) return { ok: false };
      const note = readNote(String(payload?.id || ""));
      if (!note) return { ok: false, message: "找不到这篇笔记" };
      return {
        ok: true,
        note: {
          ...note.meta,
          markdown: note.markdown.slice(0, 4000),
          summary: note.meta.summary || note.markdown.slice(0, 400),
        },
      };
    });
    handle("notes:saveReply", async (e, payload?: { userText?: string; markdown?: string; sourceUrl?: string }) => {
      if (!this.senderIsShell(e.sender)) return { ok: false, message: "只能从侧栏存笔记" };
      const source = String(payload?.sourceUrl || this.getUrl() || "");
      const fields = replyNoteFields(String(payload?.userText || ""), String(payload?.markdown || ""), source);
      const meta = writeNote(fields);
      this.sendToast("已存入笔记库");
      return { ok: true, message: "已存入笔记库", id: meta.id };
    });
    handle("reader:askSparo", async (e, payload?: { text?: string; url?: string; title?: string; siteName?: string }) => {
      if (!this.senderIsReaderPage(e.sender)) return { ok: false, message: "只能从阅读页问" };
      const text = String(payload?.text || "").trim().slice(0, 4000);
      if (!text) return { ok: false, message: "这一页没有正文" };
      if (this.window.isDestroyed() || this.window.webContents.isDestroyed()) return { ok: false };
      this.window.webContents.send("spark:quote-from-page", {
        text,
        url: String(payload?.url || ""),
        title: String(payload?.title || ""),
        siteName: String(payload?.siteName || ""),
        kind: "page",
      });
      this.focusShell();
      return { ok: true };
    });
    handle("notes:panel", async (e, payload?: { search?: string }) => {
      if (!this.senderIsShell(e.sender)) return { ok: false };
      this.openNotesPanel(String(payload?.search || ""));
      return { ok: true };
    });
    handle("spark:pick-file", async () => {
      const picked = await dialog.showOpenDialog(this.window, {
        title: "选择本地文件",
        properties: ["openFile"],
        filters: [
          {
            name: "文档",
            extensions: ["txt", "md", "csv", "json", "html", "docx", "xlsx", "pptx", "pdf"],
          },
          { name: "全部文件", extensions: ["*"] },
        ],
      });
      return picked.canceled ? "" : picked.filePaths[0] || "";
    });
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
      const next = { ...(patch || {}) };
      if (next.locale === undefined) next.locale = this.settings.locale;
      this.settings = saveSettings(this.configDir(), next, app.getLocale());
      this.rebuildDeepSeek();
      this.pushSidebarState();
      const hasKey = this.hasByokKey();
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
        return { ok: false, message: this.cloudErrorText(error) };
      }
    });
    handle("spark:cloud-verify", async (_e, email: string, code: string) => {
      try {
        this.cloudQuota = await verifyLogin(
          this.configDir(),
          String(email || ""),
          String(code || ""),
        );
        this.settings = saveSettings(
          this.configDir(),
          { llmMode: "cloud", onboardingDismissed: true, locale: this.settings.locale },
          app.getLocale(),
        );
        this.rebuildDeepSeek();
        await this.refreshCloudPlans();
        this.pushSidebarState();
        return { ok: true, message: tx(this.settings.locale, "toast.cloudIn"), cloud: this.cloudPublic() };
      } catch (error) {
        return { ok: false, message: this.cloudErrorText(error) };
      }
    });
    handle("spark:cloud-logout", async () => {
      clearTokens(this.configDir());
      this.cloudQuota = null;
      this.rebuildDeepSeek();
      this.pushSidebarState();
      return { ok: true, message: tx(this.settings.locale, "toast.cloudOut"), cloud: this.cloudPublic() };
    });
    handle("spark:cloud-page-session", async (e) => {
      if (!isOfficialAccountUrl(String(e.sender?.getURL?.() || ""))) {
        return { ok: false };
      }
      const access = await this.cloudAccessToken();
      const email = loadTokens(this.configDir())?.email || "";
      if (!access) return { ok: false };
      return { ok: true, access, email };
    });
    handle("spark:cloud-open-account", async (_e, plan?: string) => {
      const id = plan && isCloudPlanId(String(plan)) ? String(plan) : undefined;
      const href = await this.officialAccountHref(id);
      await this.navigate(href, { asHuman: true });
      return { ok: true };
    });
    handle("spark:cloud-checkout", async (e, plan?: string, type?: string) => {
      const fromPage = !this.senderIsShell(e.sender);
      if (fromPage && !isOfficialAccountUrl(String(e.sender?.getURL?.() || ""))) {
        return { ok: false, message: "forbidden" };
      }
      const id = String(plan || "").trim();
      if (!isCloudPlanId(id)) {
        return { ok: false, message: tx(this.settings.locale, "cloud.planUnknown") };
      }
      const payType = String(type || "alipay").trim() || "alipay";
      if (isMsftChannel()) {
        await this.navigate(await this.officialAccountHref(id), { asHuman: true });
        return { ok: true };
      }
      if (!hasCloudSession(this.configDir())) {
        await this.navigate(await this.officialAccountHref(id), { asHuman: true });
        return { ok: true, message: tx(this.settings.locale, "toast.cloudNeedLogin") };
      }
      try {
        const out = await createCloudCheckout(this.configDir(), id, payType);
        const url = out.payUrl || (await this.officialAccountHref(id));
        await this.navigate(url, { asHuman: true });
        return { ok: true };
      } catch {
        await this.navigate(await this.officialAccountHref(id), { asHuman: true });
        return { ok: true };
      }
    });
    handle("spark:cloud-refresh", async () => {
      await this.refreshCloudQuota();
      await this.refreshCloudPlans();
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
    handle("spark:nav-menu", async () => {
      this.openNavMenu();
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

  /** Native popup. A DOM menu under the omnibox sits under the page WebContentsView. */
  openNavMenu(): void {
    const loc = this.settings.locale;
    const toast = (message: string) => {
      this.window.webContents
        .executeJavaScript(
          `window.__sparkToast && window.__sparkToast(${JSON.stringify(message)})`,
        )
        .catch(() => undefined);
    };
    const template: MenuItemConstructorOptions[] = [
      { label: tx(loc, "nav.history"), click: () => this.openHistory() },
      { label: tx(loc, "bookmark.menu"), click: () => this.popupBookmarksMenu() },
      { label: tx(loc, "nav.find"), click: () => this.openFind() },
      { type: "separator" },
      {
        label: `${tx(loc, "mem.optimize")} · ${this.memoryBoardLine()}`,
        click: () => {
          const r = this.discardInactiveTabs();
          if (r.message) toast(r.message);
        },
      },
    ];
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
        memoryBoard: this.memoryBoardLine(),
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
      this.noteSidebarMessages();
      // handleChat 的 finally 才把 chatRunning 清掉。微任务里再看一眼，任务结束就恢复壳层节流。
      queueMicrotask(() => this.syncShellKeepalive());
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
    const wc = this.viewForTab(this.activeTabId).webContents;
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
      help: this.sidebarHelpAsk()
        ? {
            question: this.sidebarHelpAsk()!.question,
            kind: this.sidebarHelpAsk()!.kind,
            options: this.sidebarHelpAsk()!.options || [],
          }
        : null,
      lessons: loadLessons(this.configDir()).slice(0, 40).map(lessonPublic),
      triggers: loadTriggers(this.configDir()).slice(0, 40).map((row) => ({
        id: row.id,
        skillId: row.skillId,
        text: row.text,
        title: getSkill(this.configDir(), row.skillId)?.title || row.skillId,
        runs: row.runs,
        fails: row.fails,
        enabled: row.enabled,
      })),
      plan: this.sidebarPlan(),
      tasks: this.taskPool.visible(),
    };
  }

  /** 进行中的单优先；做完后留下最后一张计划卡。后台任务不盖掉用户眼前这张。 */
  private sidebarPlan() {
    const mission = this.foregroundMission();
    if (mission?.brainPlan?.steps.length) return mission.brainPlan;
    const last = this.foregroundLastMission();
    if (last && last.state !== "cancelled" && last.brainPlan?.steps.length) return last.brainPlan;
    return null;
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
      const ses = this.viewForTab(this.activeTabId).webContents.session;
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
  async analyzePage(tabId?: string): Promise<ToolResult & { data?: AnalyzedPage }> {
    try {
      const data = (await this.viewForTab(tabId || this.activeTabId).webContents.executeJavaScript(
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
  async csScan(opts?: { fromHuman?: boolean; tabId?: string }): Promise<ToolResult & { data?: CsScanData }> {
    const tabId = opts?.tabId;
    const res = await runCsScan({
      pageView: this.viewForTab(tabId || this.activeTabId),
      assertNotPaused: () => this.assertNotPaused(),
      fill: (t, v) => this.fill(t, v, tabId),
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
    tabId?: string;
  }): Promise<ToolResult & { data?: CsDraftData }> {
    const tabId = input?.tabId;
    const res = await runCsDraft(
      {
        pageView: this.viewForTab(tabId || this.activeTabId),
        assertNotPaused: () => this.assertNotPaused(),
        fill: (t, v) => this.fill(t, v, tabId),
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
    // 回复评论是前台任务：窗口最小化时拉回一次，人看着草稿再自己点发送。
    this.restoreForCoPresence();
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
    return this.viewForTab(this.activeTabId).webContents;
  }

  isPaused(): boolean {
    return this.paused;
  }

  setPaused(paused: boolean): void {
    // 后台任务不能把整个窗口暂停，否则前台回复会被锁死。登录墙走 waiting_human。
    if (this.taskStore()?.lane === "background") return;
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

  async watchPageTool(
    name: string,
    args: Record<string, unknown>,
    run: () => Promise<ToolResult>,
    tabId?: string,
  ): Promise<ToolResult> {
    if (this.helpAsk) {
      // 多站任务不能因为上一站登录墙就冻死。记下「先不管」，问题仍留在侧栏给人改。
      this.skipLearning();
    }
    const before = pageFinger(this.getUrl(tabId), this.getTitle(tabId));
    const result = await run();
    try {
      this.observePageAction(name, args, before, tabId);
    } catch (error) {
      console.error("[learn] observe failed", error);
    }
    return result;
  }

  private observePageAction(
    name: string,
    args: Record<string, unknown>,
    before: ReturnType<typeof pageFinger>,
    tabId?: string,
  ): void {
    if (this.helpAsk) return;
    const key = actionKey(name, args);
    if (!key) return;
    const after = pageFinger(this.getUrl(tabId), this.getTitle(tabId));
    this.recentLearned.push({ key, before, after });
    if (this.recentLearned.length > 12) this.recentLearned = this.recentLearned.slice(-12);
    const hit = detectFailure(this.recentLearned);
    if (!hit) return;
    this.openHelpAsk(hit);
  }

  private openHelpAsk(hit: ReturnType<typeof detectFailure>): void {
    if (!hit || this.helpAsk) return;
    const zh = this.settings.locale.startsWith("zh");
    this.helpAsk = questionFor(hit, zh);
    this.chatLog.push({ role: "assistant", text: this.helpAsk.question });
    this.pushSidebarState();
  }

  private async applyHostLessons(tabId?: string): Promise<boolean> {
    tabId = tabId || this.agentTabId || this.activeTabId;
    const lessons = findLessonsForHost(this.configDir(), this.getUrl(tabId));
    if (!lessons.length) return false;
    const plan = planFromLessons(lessons);
    const zh = this.settings.locale.startsWith("zh");
    if (plan.dismiss) {
      await this.dismissOverlays(tabId).catch(() => undefined);
    }
    const here = pageFinger(this.getUrl(tabId), this.getTitle(tabId));
    const wall = isLoginWall(here) || isCaptchaWall(here);
    const host = here.host;
    if (!this.learnedTold.has(host)) {
      const note = plan.notes[0] || (zh ? "用过这站的经验" : "Using a saved tip for this site");
      this.chatLog.push({
        role: "assistant",
        text: zh ? `上次这站：${note}` : `Last time here: ${note}`,
      });
      this.learnedTold.add(host);
    }
    for (const l of lessons) recordLessonApply(this.configDir(), l.id);
    if (plan.pause && wall) {
      this.setPaused(true);
      this.pushSidebarState();
      return true;
    }
    this.pushSidebarState();
    return false;
  }

  answerLearning(raw: string): ToolResult {
    const ask = this.helpAsk;
    if (!ask) return { ok: false, message: tx(this.settings.locale, "learn.none") };
    const parsed = parseAnswer(ask, raw);
    this.helpAsk = null;
    this.recentLearned = [];
    const zh = this.settings.locale.startsWith("zh");
    if (parsed.skip || !parsed.trigger || !parsed.advice) {
      this.setPaused(false);
      const text = zh ? "好，先继续。" : "Okay, continuing.";
      this.chatLog.push({ role: "assistant", text });
      this.pushSidebarState();
      return { ok: true, message: text };
    }
    const lesson = upsertLesson(this.configDir(), {
      host: ask.failure.host || this.getUrl(),
      trigger: parsed.trigger,
      advice: parsed.advice,
      note: parsed.note,
    });
    if (parsed.advice === "dismiss_overlay") {
      void this.dismissOverlays();
    }
    const keepPaused = parsed.advice === "pause" || parsed.advice === "wait_human";
    this.setPaused(keepPaused);
    const text = zh
      ? `记下了：${lesson.host} · ${lesson.note || lesson.trigger}`
      : `Saved: ${lesson.host} · ${lesson.note || lesson.trigger}`;
    this.chatLog.push({ role: "assistant", text });
    this.pushSidebarState();
    return { ok: true, message: text };
  }

  skipLearning(): ToolResult {
    return this.answerLearning("先不管");
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
    tabId?: string;
  }): Promise<ToolResult> {
    const tabId = input.tabId;
    const blocked = this.assertNotPaused();
    if (blocked) return blocked;
    const timeoutMs = input.timeoutMs ?? 15_000;
    const started = Date.now();
    const wc = this.viewForTab(tabId || this.activeTabId).webContents;
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

  async qaCheck(tabId?: string): Promise<ToolResult> {
    try {
      const probe = (await this.viewForTab(tabId || this.activeTabId).webContents.executeJavaScript(
        QA_PROBE_SCRIPT,
        true,
      )) as Record<string, unknown>;
      const report = buildSmtQaReport({
        url: String(probe.url || this.getUrl(tabId)),
        title: String(probe.title || this.getTitle(tabId)),
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
    if ((this.settings.apiKey || this.settings.deepseekApiKey || "").trim()) return true;
    return this.settings.provider === "ollama";
  }

  private modelReady(): boolean {
    if (this.hasByokKey()) return true;
    return this.settings.llmMode === "cloud" && Boolean(this.cloudQuota?.canStart);
  }

  private senderIsReaderPage(sender?: Electron.WebContents | null): boolean {
    try {
      const url = decodeURIComponent(sender?.getURL() || "");
      return url.startsWith("file:") && /[/\\](reader-\d+|note-n[a-z0-9]+)\.html/i.test(url);
    } catch {
      return false;
    }
  }

  private senderIsShell(sender?: Electron.WebContents | null): boolean {
    try {
      return Boolean(
        sender && this.window && !this.window.isDestroyed() && sender === this.window.webContents,
      );
    } catch {
      return false;
    }
  }

  private async cloudAccessToken(): Promise<string | undefined> {
    if (!hasCloudSession(this.configDir())) return undefined;
    try {
      const tokens = (await refreshIfNeeded(this.configDir())) || loadTokens(this.configDir());
      return tokens?.access || undefined;
    } catch {
      return loadTokens(this.configDir())?.access || undefined;
    }
  }

  private async officialAccountHref(plan?: string): Promise<string> {
    return accountUrl(this.settings.locale, plan);
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
    const hidePayCopy = isMsftChannel();
    return {
      loggedIn: Boolean(tokens?.access),
      email: q?.email || tokens?.email || "",
      canStart: Boolean(q?.canStart),
      points: q?.points ?? 0,
      bonus: q?.bonus ?? 0,
      approxTasks: q?.approxTasks ?? 0,
      trial: q?.trial || { used: 0, left: 0, cap: 0 },
      subscription: q?.subscription || { active: false, plan: null },
      llmMode: this.settings.llmMode,
      runtime: this.llmRuntime,
      hidePayCopy,
      showPlans: !hidePayCopy,
      plans: hidePayCopy ? [] : this.cloudPlans,
      accountUrl: accountUrl(this.settings.locale),
    };
  }

  private async refreshCloudPlans(): Promise<void> {
    if (isMsftChannel()) {
      this.cloudPlans = [];
      return;
    }
    this.cloudPlans = await fetchCloudPlans();
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
    void text;
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
      case "notes_action":
        return true;
      default:
        return false;
    }
  }

  private patchReaderPrefs(patch: Partial<ReaderPrefs>): { ok: true; reader: ReaderPrefs } {
    const reader = normalizeReader({ ...this.settings.reader, ...patch });
    this.settings = saveSettings(this.configDir(), { reader });
    return { ok: true, reader: this.settings.reader };
  }

  private async openActiveReader(url?: string): Promise<ToolResult> {
    try {
      if (url) {
        const nav = await this.navigate(url, { asHuman: true });
        if (!nav.ok) return nav;
      }
      const result = await extractReadable(this.window);
      const doc = await openReaderModeTab(this.window, result, {
        configDir: this.configDir(),
        prefs: this.settings.reader,
        openFile: (abs) => {
          this.openReport(abs);
        },
      });
      return { ok: true, message: `已打开阅读模式：${result.title}`, data: { files: [doc.path] } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, message };
    }
  }

  private savePageHighlights(payload?: { url?: string; highlights?: Highlight[] }): { ok: boolean; message?: string } {
    const url = String(payload?.url || "").trim();
    if (!url) return { ok: false, message: "缺少 URL" };
    const highlights = Array.isArray(payload?.highlights) ? payload.highlights : [];
    upsertHighlightsForUrl(url, highlights);
    return { ok: true };
  }

  private async readerComplete(prompt: string): Promise<string> {
    this.rebuildDeepSeek();
    if (!this.deepseek) throw new Error("还没有可用的模型");
    const startedHere = !this.cloudTaskId;
    const gate = await this.beginCloudTaskIfNeeded({ type: "llm", text: "阅读总结" }, prompt);
    if (gate === "refused") throw new Error(this.lastCloudRefuse || "AI 暂时不可用");
    try {
      const text = await this.deepseek.completePlain(prompt);
      if (!text.trim()) throw new Error("模型没有返回内容");
      return text.trim();
    } finally {
      if (startedHere && this.cloudTaskId) await this.finishCloudTask();
    }
  }

  private parsePageSummary(raw: string): { sentences: string[]; points: string[]; recommend: string } {
    const trimmed = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    try {
      const data = JSON.parse(trimmed) as {
        sentences?: unknown;
        points?: unknown;
        recommend?: unknown;
      };
      const asList = (value: unknown) =>
        Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
      return {
        sentences: asList(data.sentences).slice(0, 5),
        points: asList(data.points).slice(0, 3),
        recommend: String(data.recommend || "").trim(),
      };
    } catch {
      return { sentences: [], points: [], recommend: "" };
    }
  }

  private async summarizeSelection(
    sender: WebContents,
    payload: Record<string, unknown>,
  ): Promise<{ ok: boolean; summary?: string; message?: string }> {
    this.lastReaderSender = sender;
    const text = String(payload.text || "").trim();
    if (!text) return { ok: false, message: "没有选中文字" };
    const context = String(payload.context || "").slice(0, 800);
    try {
      const summary = await this.readerComplete(
        `用一句话总结这段文字的核心观点：\n\n${text}${context ? `\n\n上下文：\n${context}` : ""}`,
      );
      this.sendToast("已生成总结，点预览区决定是否存入", undefined, 2500, true);
      return { ok: true, summary };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.sendToast("AI 暂时不可用，但高亮已保存", undefined, 2500);
      return { ok: false, message };
    }
  }

  private async summarizeReaderPage(
    sender: WebContents,
    payload: Record<string, unknown>,
  ): Promise<{
    ok: boolean;
    summary?: string;
    structured?: { sentences: string[]; points: string[]; recommend: string };
    message?: string;
  }> {
    this.lastReaderSender = sender;
    const text = String(payload.text || "").trim().slice(0, 12000);
    if (!text) return { ok: false, message: "这一页没有正文" };
    try {
      const summary = await this.readerComplete(
        `阅读下面这篇文章，只返回 JSON，不要写其它文字。格式：{"sentences":["五句核心摘要"],"points":["三个关键观点"],"recommend":"一句推荐语"}\n\n文章：\n${text}`,
      );
      const structured = this.parsePageSummary(summary);
      const pretty = [
        ...structured.sentences,
        ...structured.points,
        structured.recommend,
      ].filter(Boolean).join("\n") || summary;
      this.sendToast("已生成总结，点预览区决定是否存入", undefined, 2500, true);
      return { ok: true, summary: pretty, structured };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.sendToast("AI 总结失败，但可以手动存全文", undefined, 2500);
      return { ok: false, message };
    }
  }

  private saveHighlightNote(payload: Record<string, unknown>): { ok: boolean; message: string; id?: string } {
    const url = String(payload.url || "");
    const text = String(payload.text || "").trim();
    const title = String(payload.title || "摘录").slice(0, 120);
    const summary = String(payload.summary || "").trim();
    if (!text) return { ok: false, message: "没有可保存的文字" };
    const cached = cachedReaderResult(url);
    const markdown = [
      `# ${title}`,
      "",
      `> 来源：${url}`,
      cached?.siteName || payload.siteName ? `> 站点：${String(payload.siteName || cached?.siteName || "")}` : "",
      "",
      "## 摘录",
      "",
      text,
      "",
      summary ? `## AI 总结\n\n${summary}` : "",
    ].filter((line) => line !== undefined).join("\n");
    const meta = writeNote({
      title,
      source_url: url,
      site_name: String(payload.siteName || cached?.siteName || "") || undefined,
      markdown,
      summary: summary || undefined,
      highlights_refs: payload.chunkId ? [String(payload.chunkId)] : undefined,
      word_count: text.length,
    });
    this.sendToast("已存入笔记库");
    return { ok: true, message: "已存入笔记库", id: meta.id };
  }

  private saveFullPageNote(payload: Record<string, unknown>): { ok: boolean; message: string; id?: string } {
    const url = String(payload.url || "");
    const title = String(payload.title || "全文").slice(0, 180);
    const summary = String(payload.summary || "").trim();
    const text = String(payload.text || "");
    const html = String(payload.html || "");
    const body = html ? htmlToMarkdown(html) : text;
    const wordCount = Number(payload.wordCount || text.length || body.length);
    const markdown = [
      `# ${title}`,
      "",
      `> 来源：${url}`,
      `> 保存于 ${new Date().toISOString()}`,
      "",
      summary ? `## 摘要\n\n${summary}\n` : "",
      "## 正文",
      "",
      body,
    ].join("\n");
    const meta = writeNote({
      title,
      source_url: url,
      site_name: String(payload.siteName || "") || undefined,
      markdown,
      summary: summary || undefined,
      word_count: wordCount,
    });
    this.sendToast("已存入笔记库");
    return { ok: true, message: "已存入笔记库", id: meta.id };
  }

  private closeSenderTab(sender: WebContents): { ok: boolean; message: string } {
    for (const [id, tab] of this.tabs) {
      if (tab.view?.webContents === sender) return this.closeTab(id);
    }
    return { ok: false, message: "找不到这个标签" };
  }

  private closeReaderDrawer(): void {
    const wc = this.lastReaderSender;
    if (!wc || wc.isDestroyed()) return;
    void wc.executeJavaScript("window.__sparoCloseDrawer && window.__sparoCloseDrawer()", true).catch(() => undefined);
  }

  private async runOneShotSave(): Promise<void> {
    const wc = this.livePage();
    if (!wc || wc.isDestroyed()) return;
    if (wc.isLoading()) {
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        wc.once("did-finish-load", done);
        setTimeout(done, 5000);
      });
    }
    await wc
      .executeJavaScript(
        `new Promise((resolve) => {
          const kick = () => {
            if (window.__sparoOneShotSave) { window.__sparoOneShotSave(); resolve(true); return; }
            setTimeout(kick, 40);
          };
          kick();
          setTimeout(() => resolve(false), 2500);
        })`,
        true,
      )
      .catch(() => undefined);
  }

  private openNotesPanel(search?: string): void {
    if (this.window.isDestroyed()) return;
    this.window.webContents.send("spark:notes", { search: search || "" });
  }

  private openNoteTab(id: string): ToolResult {
    const note = readNote(id);
    if (!note) return { ok: false, message: "找不到这篇笔记" };
    const html = readingReportHtml({
      title: note.meta.title,
      body: note.markdown,
      eyebrow: note.meta.site_name || "SPARO 笔记",
    });
    const doc = writeHtmlReport(this.configDir(), `note-${note.meta.id}`, html, {
      title: note.meta.title,
      kind: "read",
    });
    return this.openReport(doc.path);
  }

  private formatNotesList(limit?: number, search?: string): string {
    const rows = listNotes(limit, undefined, search);
    if (!rows.length) return "还没有笔记，去阅读模式里试试吧";
    return rows
      .map((row, index) => {
        let host = row.source_url;
        try {
          host = new URL(row.source_url).hostname.replace(/^www\./, "");
        } catch {
          /* keep raw */
        }
        return `${index + 1}. ${row.title} — ${host} — ${row.saved_at}`;
      })
      .join("\n");
  }

  private async beginCloudTaskIfNeeded(
    action: ChatAction,
    text: string,
  ): Promise<"ok" | "skip" | "refused"> {
    if (this.llmRuntime !== "cloud") return "skip";
    if (this.cloudTaskId) return "ok";
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
    const byokKey =
      (this.settings.apiKey || this.settings.deepseekApiKey || "").trim() ||
      (this.settings.provider === "ollama" ? "ollama" : "");
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
        baseUrl: chatCompletionsCloudUrl(),
        model: "",
        mode: "cloud",
        fetchImpl: (url, init) =>
          this.cloudOrByokFetch(String(url), init ?? {}, byokKey, byokBase, byokModel),
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
    byokModel: string,
  ): Promise<Response> {
    try {
      const res = await cloudFetch(this.configDir(), this.cloudTaskId || "", url, init);
      if (res.ok || res.status === 402 || res.status === 400 || res.status === 409) {
        return res;
      }
      if (res.status >= 500 && byokKey) {
        return this.byokFetch(byokKey, byokBase, byokModel, init);
      }
      return res;
    } catch {
      if (byokKey) return this.byokFetch(byokKey, byokBase, byokModel, init);
      throw new Error(tx(this.settings.locale, "cloud.proxyDown"));
    }
  }

  private byokFetch(
    apiKey: string,
    baseUrl: string,
    model: string,
    init: RequestInit,
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${apiKey}`);
    headers.set("api-key", apiKey);
    if (/anthropic\.com/i.test(baseUrl)) {
      headers.set("anthropic-version", "2023-06-01");
    }
    headers.delete("X-Sparo-Task");
    return fetch(chatCompletionsUrl(baseUrl), {
      ...init,
      headers,
      body: withJsonModel(init.body, model),
    });
  }

  private async runAgentTool(
    name: AgentToolName,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const tabId = this.agentTabId || this.activeTabId;
    switch (name) {
      case "navigate":
        return this.watchPageTool("navigate", { ...args, tabId }, () =>
          this.navigate(String(args.url || ""), { asHuman: true, tabId }),
        tabId);
      case "get_url":
        return { ok: true, message: this.getUrl(tabId), data: { url: this.getUrl(tabId) } };
      case "get_title":
        return {
          ok: true,
          message: this.getTitle(tabId),
          data: { title: this.getTitle(tabId) },
        };
      case "page_text": {
        const page = await this.pageText(tabId);
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
          tabId,
        );
      case "click":
        return this.watchPageTool("click", { ...args, tabId }, () =>
          this.click({
            selector: args.selector ? String(args.selector) : undefined,
            ref: args.ref ? String(args.ref) : undefined,
          }, tabId),
        tabId);
      case "fill":
        return this.watchPageTool("fill", { ...args, tabId }, () =>
          this.fill(
            {
              selector: args.selector ? String(args.selector) : undefined,
              ref: args.ref ? String(args.ref) : undefined,
            },
            String(args.value ?? ""),
            tabId,
          ),
        tabId);
      case "fill_suggest":
        return this.fillSuggest(String(args.value ?? args.query ?? ""), {
          selector: args.selector ? String(args.selector) : undefined,
          ref: args.ref ? String(args.ref) : undefined,
        }, tabId);
      case "press":
        return this.pressKey(String(args.key || "Enter"), tabId);
      case "pick_calendar":
        return this.pickCalendar({
          triggerRef: args.triggerRef ? String(args.triggerRef) : undefined,
          triggerLabel: args.triggerLabel ? String(args.triggerLabel) : undefined,
          triggerText: args.triggerText ? String(args.triggerText) : undefined,
          value: args.value,
          date: args.date ? String(args.date) : undefined,
          hours: args.hours as string | number | undefined,
          minutes: args.minutes as string | number | undefined,
          tabId,
        });
      case "qa_check":
        return this.qaCheck(tabId);
      case "click_text":
        return this.watchPageTool("click_text", { ...args, tabId }, () =>
          this.clickText(String(args.text || ""), {
            withinPortal: Boolean(args.withinPortal),
            caret: Boolean(args.caret),
            tabId,
          }),
        tabId);
      case "menu_click":
        return this.menuClick(String(args.trigger || ""), String(args.item || ""), tabId);
      case "dismiss_overlays":
        return this.dismissOverlays(tabId);
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
        tip: "match_skill(query) 拿候选 id → run_skill({ id, params })。run_skill 只认 id 或用户已记住的原话，自然语言 query 不执行。",
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
    const r = await runSkill(this, this.configDir(), input);
    const readings = (r.data as { readings?: Array<{ label?: string; text?: string; url?: string }> } | undefined)
      ?.readings;
    if (this.deepseek && Array.isArray(readings) && readings.length) {
      const summary = await this.withTimeout(
        this.deepseek.completePlain(
          [
            "用户要一份能执行的结果。只根据下面各步正文，没有的价格、店名、岗位写成未知。",
            "登录墙如实说，仍给出已打开的结果页链接。付钱、投递必须写「请你在窗口里点」。",
            `用户目标：${input.query || input.id || ""}`,
            ...readings.map(
              (x, i) => `### ${i + 1}. ${x.label || "读页"}\n${x.url || ""}\n${String(x.text || "").slice(0, 1600)}`,
            ),
          ].join("\n"),
        ),
        20000,
        "",
      );
      if (String(summary).trim()) {
        return { ...r, message: String(summary).trim() };
      }
    }
    return r;
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
          "Xiaohongshu ONLY if user named 小红书/xhs/rednote: run_skill({ id:'xhs-longform-publish', params:{ title, body, summary, topics } }).",
          "Or: xhs_ensure_editor → xhs_inject_compose → xhs_layout_next → xhs_inject_publish → pause.",
          "Unknown forms: run_skill({ id:'universal-form-fill', params:{ payload:{ 标题, 正文, … } } }) OR analyze_page → execute_primitives.",
          "Date pickers (X Ads End time): pick_calendar or payload End time — never fill a date string, never click_text a bare day number, never click the month '<' chevron.",
          "Do NOT loop fill/click on multi-field forms — use execute_primitives.",
          "Customer service (any site, semi-auto): cs_one_click_reply or cs_scan → cs_draft_reply (fills composer; NEVER auto-send).",
          "Feishu web: run_skill({ id:'feishu-web-work', params:{ to, body, title, kind } }) or feishu_work. Opens messenger, injects chat/journal draft ONCE. NEVER click 发送.",
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

  /** 侧栏原话走工作单。后台任务不在入口抢屏；前台任务最小化时只拉回一次。 */
  async sidebarChatTool(
    text: string,
    opts?: { hands?: boolean },
  ): Promise<ToolResult> {
    this.maybeRestoreForCoPresence(undefined, text);
    const ask = String(text || "").trim();
    const beforeUrl = this.getUrl();
    const homeCity = loadProfile(this.configDir()).identity.homeCity;
    if (opts?.hands === false) {
      const preview = applyTurn(ask, {
        active: this.activeMission,
        last: this.lastMission,
        homeCity: homeCity || undefined,
        now: new Date(),
        paused: this.paused,
      });
      this.chatLog.push({ role: "user", text: ask });
      const line =
        preview.effect === "run"
          ? `工作单准备动手：${preview.mission?.goal.approach || preview.say}`
          : preview.say;
      this.chatLog.push({ role: "assistant", text: line });
      this.pushSidebarState();
      return {
        ok: true,
        message: line,
        data: {
          kind: preview.effect,
          briefKind: preview.mission?.goal.kind,
          hands: false,
          navigated: false,
          beforeUrl,
          url: beforeUrl,
          origin: preview.mission?.goal.known.origin,
          approach: preview.mission?.goal.approach,
          pending: preview.mission?.state === "blocked" || preview.mission?.state === "propose",
        },
      };
    }
    const r = await this.handleChat(ask);
    const last = [...this.chatLog].reverse().find((t) => t.role === "assistant");
    const url = this.getUrl();
    const m = this.activeMission || this.lastMission;
    return {
      ok: r.ok,
      message: r.message,
      data: {
        kind: (r.data as { kind?: string } | undefined)?.kind || last?.cortex?.mode,
        briefKind: (r.data as { briefKind?: string } | undefined)?.briefKind || m?.goal.kind,
        hands: true,
        navigated: url !== beforeUrl,
        beforeUrl,
        url,
        cortex: last?.cortex || null,
        pending: Boolean(this.activeMission && (this.activeMission.state === "blocked" || this.activeMission.state === "propose")),
        origin: m?.goal.known.origin,
        ask: m?.ask,
        approach: m?.goal.approach,
        files: (r.data as { files?: string[] } | undefined)?.files,
      },
    };
  }

  private async executeHand(
    action: ChatAction,
    userAsk: string,
    jobImages: string[],
    kind?: string,
  tabId?: string,
  ): Promise<{ reply: string; replyDoc?: ChatTurn["doc"] }> {
    tabId = tabId || this.agentTabId || this.activeTabId;
    this.maybeRestoreForCoPresence(action.type, userAsk);
    let reply = "";
    let replyDoc: ChatTurn["doc"];
    if (action.type === "reader_mode") {
      const opened = await this.openActiveReader(action.url);
      reply = opened.message;
      const files = (opened.data as { files?: string[] } | undefined)?.files;
      if (files?.[0]) replyDoc = { title: "阅读模式", path: files[0], kind: "read" };
    } else if (action.type === "reader_companion") {
      this.patchReaderPrefs({ aiCompanionOn: true });
      const current = this.getUrl(tabId);
      if (/[/\\]reader-\d+\.html/i.test(current)) {
        const wc = this.livePage(tabId);
        if (wc) {
          await wc.executeJavaScript(
            `(() => { var b = document.getElementById("btnReaderCompanion"); if (b) b.click(); })()`,
            true,
          ).catch(() => undefined);
        }
        reply = "AI伴读已打开。划线后会先给你预览，确认才写入笔记。";
      } else {
        const opened = await this.openActiveReader();
        reply = opened.ok
          ? "AI伴读已打开，并进入阅读模式。划线后先看预览，确认才写入笔记。"
          : `AI伴读已打开。${opened.message}`;
      }
    } else if (action.type === "notes_action") {
      const current = this.getUrl(tabId);
      const alreadyReader = !action.url && /[/\\]reader-\d+\.html/i.test(current);
      if (!alreadyReader) {
        const opened = await this.openActiveReader(action.url);
        if (!opened.ok) {
          reply = opened.message;
        } else {
          await this.runOneShotSave();
          reply = "已打开阅读模式，并开始一键盘存。确认后才会写入笔记。";
        }
      } else {
        await this.runOneShotSave();
        reply = "已开始一键盘存。确认后才会写入笔记。";
      }
    } else if (action.type === "notes_search") {
      reply = this.formatNotesList(action.limit, action.search);
      if (!action.listOnly) this.openNotesPanel(action.search);
    } else if (action.type === "reply") {
      reply = action.text;
    } else if (action.type === "print") {
      try {
        this.viewForTab(tabId || this.activeTabId).webContents.print();
        reply = this.settings.locale.startsWith("zh")
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
      const nav = await this.navigate(action.url, { asHuman: true, tabId });
      if (!nav.ok) reply = nav.message;
      else if (action.after === "dxm_arrived") {
        reply = "已打开店小蜜。若未登录请先登录；然后点开商品编辑页，说「处理好这个商品」。";
      } else if (action.after === "dxm_crawl") {
        reply = "已打开采集箱。点进商品编辑页后说「处理好」或「继续」。";
      } else reply = action.note || nav.message;
    } else if (action.type === "dxm_guide") {
      reply = dxmGuideMessage(this.getUrl(tabId), action.mode);
    } else if (action.type === "set_title") {
      reply = (await this.setDxmProductTitle(action.title)).message;
    } else if (action.type === "translate_title") {
      reply = (await this.translateDxmTitle(action.lang)).message;
    } else if (action.type === "qa") {
      reply = (await this.qaCheck(tabId)).message;
    } else if (action.type === "workflow") {
      const label = action.id === "dxm_autopilot" ? "Autopilot（全自动，完成后暂停等你审）" : action.id;
      this.chatLog.push({ role: "assistant", text: `正在执行「${label}」…` });
      this.pushSidebarState();
      reply = (await runWorkflow(this, action.id)).message;
      this.pushSidebarState();
    } else if (action.type === "list_skills") {
      this.skillsCache = listSkills(this.configDir());
      reply = this.skillsCache.length
        ? `已有 ${this.skillsCache.length} 个可用操作：\n` +
          this.skillsCache
            .slice(0, 12)
            .map((s, i) => `${i + 1}. ${s.title}（${s.stepCount} 步）`)
            .join("\n") +
          "\n\n直接说「发小红书」或「填表」即可。这一版不提供录制新操作。"
        : "内置能力可直接说「发小红书」「填表」「回复」。这一版不提供录制新操作。";
    } else if (action.type === "one_click_reply") {
      this.chatLog.push({ role: "assistant", text: this.L("chat.scanningReply") });
      this.pushSidebarState();
      reply = (await this.csOneClickReply()).message;
      this.pushSidebarState();
    } else if (action.type === "summarize") {
      this.chatLog.push({ role: "assistant", text: this.L("chat.readingPage") });
      this.pushSidebarState();
      reply = await this.summarizeActivePage(userAsk, tabId);
    } else if (action.type === "trip_plan") {
      this.chatLog.push({ role: "assistant", text: tripPlanProgress(action.plan) });
      this.pushSidebarState();
      const tripOut = await this.runTripPlan(action.plan, userAsk, tabId);
      reply = tripOut.text;
      // 只要有非空目的地就出手册；开口行程（「杭州进上海出」、高铁环游）可以没有出发地，
      // expandTripPlan 会自行只排火车/酒店，不能因 origin 空就把整本手册毙掉。
      const placesOk = action.plan.cities.some((c) => c.trim());
      if (!placesOk) {
        reply = "目的地还不是城，先说清再出手册。";
      } else {
        try {
          const o = action.plan.origin.trim();
          const chain = action.plan.cities.join(" → ");
          const title = o ? `${o} → ${chain} → ${o}` : chain;
          const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
          const html = tripReportHtml({
            plan: action.plan,
            userAsk,
            summary: reply,
            hotels: tripOut.hotels,
            flights: tripOut.flights,
          });
          replyDoc = writeHtmlReport(
            this.configDir(),
            `trip-${stamp}`,
            html,
            { title, kind: "trip" },
          );
          reply = tripChatBrief(
            o
              ? `${action.plan.startDate} ${title}，${action.plan.endDate} 返回`
              : `${action.plan.startDate} ${title}，${action.plan.endDate} 返程`,
          );
          this.openReportQuiet(replyDoc.path);
        } catch (e) {
          /* 写文档失败就仍用侧栏长文 */
        }
      }
    } else if (action.type === "mission") {
      this.chatLog.push({ role: "assistant", text: missionProgress(action.mission) });
      this.pushSidebarState();
      const out = await this.runMission(action.mission, userAsk, tabId);
      const eatplay = kind === "eatplay" || /吃喝玩/.test(action.mission.title);
      if (eatplay) {
        const sealed = this.sealResearchReport({
          title: action.mission.title,
          userAsk,
          body: out,
          chips: reportChips(action.mission.slots),
          stem: "eatplay",
        });
        reply = sealed.reply;
        replyDoc = sealed.doc;
      } else if (missionNeedsReport(action.mission.kind) || looksLikeResearchAsk(userAsk)) {
        const sealed = this.sealResearchReport({
          title: action.mission.title,
          userAsk,
          body: out,
          chips: reportChips(action.mission.slots),
          stem: `mission-${action.mission.kind}`,
        });
        reply = sealed.reply;
        replyDoc = sealed.doc;
      } else reply = out;
    } else if (action.type === "travel_search") {
      this.chatLog.push({ role: "assistant", text: lifeProgress(action) });
      this.pushSidebarState();
      reply = await this.runTravelSearch(action, { tabId });
    } else if (action.type === "feishu") {
      this.lastFeishuTask = action.task;
      this.chatLog.push({ role: "assistant", text: "正在打开飞书网页版…" });
      this.pushSidebarState();
      reply = await this.runFeishu(action.task);
    } else if (action.type === "fill_form") {
      this.chatLog.push({ role: "assistant", text: this.L("chat.detectingFields") });
      this.pushSidebarState();
      reply = await this.previewFormFill(userAsk, tabId);
    } else if (action.type === "run_skill") {
      const label = action.query || action.id;
      this.chatLog.push({ role: "assistant", text: `正在按妙招「${label}」执行…` });
      this.pushSidebarState();
      const ran = await this.runSkillTool({ id: action.id, query: action.query });
      reply = ran.message;
      await this.maybeOfferTrigger(userAsk, ran);
      this.pushSidebarState();
    } else if (action.type === "run") {
      const map =
        action.script === "dxm-resize"
          ? "dxm_resize_800"
          : action.script === "dxm-translate"
            ? "dxm_translate_zh_en"
            : "";
      reply = map ? (await runWorkflow(this, map)).message : `未知脚本 ${action.script}`;
    } else if (action.type === "act") {
      if (action.url && !sameSite(this.getUrl(tabId), action.url)) {
        const nav = await this.navigate(action.url, { asHuman: true, tabId });
        if (!nav.ok) reply = nav.message;
        else {
          this.chatLog.push({ role: "assistant", text: this.L("chat.openedSite") });
          this.pushSidebarState();
          reply = await this.runLlmGoal(action.text, jobImages, tabId);
        }
      } else {
        this.chatLog.push({ role: "assistant", text: this.L("chat.actingHere") });
        this.pushSidebarState();
        reply = await this.runLlmGoal(action.text, jobImages, tabId);
      }
    } else if (action.type === "llm") {
      reply = await this.runLlmGoal(action.text, jobImages, tabId);
    } else {
      reply = this.L("chat.unknown");
    }
    return { reply, replyDoc };
  }

  /**
   * 执行过程中用户插了一句。模型判断是改计划才吃掉这条排队消息。
   */
  private async absorbQueuedPlanEdit(current: ActiveMission): Promise<ActiveMission> {
    if (this.taskStore()?.lane === "background") return current;
    const next = this.chatQueue[0];
    if (!next?.text || !current.brainPlan?.steps.length || !this.deepseek) return current;
    const key = `${current.id}:${next.text}`;
    if (this.planEditSeen.has(key)) return current;
    this.planEditSeen.add(key);
    const revised = await this.withTimeout(
      reviseActivePlan(next.text, current, (p) => this.deepseek!.completePlain(p)),
      12000,
      null,
      false,
    );
    if (!revised?.brainPlan) return current;
    this.chatQueue.shift();
    this.planEditSeen.delete(key);
    const hint = next.text.slice(0, 28);
    const last = this.chatLog[this.chatLog.length - 1];
    if (last?.role === "assistant" && last.text.includes("已排队") && last.text.includes(hint)) {
      this.chatLog.pop();
    }
    this.chatLog.push({
      role: "user",
      text: next.text,
      ...(next.images?.length ? { images: next.images } : {}),
    });
    this.chatLog.push({
      role: "assistant",
      text: revised.brainPlan.revisedFrom ? `计划已改：${revised.brainPlan.revisedFrom}` : "计划已按你的话改过。",
    });
    this.activeMission = revised;
    this.pushSidebarState();
    return revised;
  }

  /** 原话只是打开这个站，而且当前页已经在这个站上。登录墙不算打开完成。 */
  private namedSiteIsOpen(goal: AgentGoal, tabId?: string): boolean {
    if (!openSiteIsTheJob(goal) || !goal.site) return false;
    const here = pageFinger(this.getUrl(tabId), this.getTitle(tabId));
    const siteUrl = goal.siteUrl || `https://${goal.site}/`;
    return Boolean(here.url) && sameSite(here.url, siteUrl) && !isLoginWall(here) && !isCaptchaWall(here);
  }

  private async executeMission(mission: ActiveMission, jobImages: string[], tabId?: string): Promise<ToolResult> {
    tabId = tabId || this.agentTabId || this.activeTabId;
    this.activeMission = mission;
    this.pushSidebarState();
    const goal = mission.goal;
    if (goal.kind === "form" || goal.kind === "publish") {
      // 填表 / 发帖确认（含支付前核对）人机同窗：最小化时拉回一次。调研和行程不进这个分支。
      this.restoreForCoPresence();
    }
    const cloudGate = await this.beginCloudTaskIfNeeded({ type: "llm", text: goal.raw }, goal.raw);
    if (cloudGate === "refused") {
      const reply = this.lastCloudRefuse || this.L("cloud.exhausted");
      this.chatLog.push({ role: "assistant", text: reply });
      this.pushSidebarState();
      return { ok: false, message: reply };
    }
    // 执行一开始记一笔。杀进程时这张单算开始过；只被开出来、没进这里的影子单没有这笔。
    journalMissionTurn(mission, this.configDir());
    try {
      if (await this.applyHostLessons(tabId)) {
        mission.state = "waiting_human";
        mission.waitReason = "login_wall";
        this.activeMission = mission;
        const msg = this.settings.locale.startsWith("zh")
          ? "这站要你先处理登录或验证，处理好后说「继续」。"
          : "This site needs you first. Finish login or the check, then say continue.";
        mission.ask = msg;
        this.chatLog.push({ role: "assistant", text: msg });
        this.pushSidebarState();
        return { ok: true, message: msg, data: { loop: "waiting_human", briefKind: goal.kind } };
      }

      this.chatLog.push({
        role: "assistant",
        text: goalProgress(goal),
        cortex: { mode: "loop", need: goal.intent, approach: goal.approach },
      });
      if (mission.brainPlan?.steps.length) {
        this.chatLog.push({
          role: "assistant",
          text: `计划：${mission.brainPlan.steps.map((s) => s.label).join(" → ")}`,
        });
      }
      this.pushSidebarState();

      let current = mission;
      const ran: AgentStep[] = [];
      let stall = 0;
      let missionOkRuns = 0;
      for (let i = 0; i < 8; i++) {
        current = await this.absorbQueuedPlanEdit(current);
        if (this.namedSiteIsOpen(current.goal, tabId)) break;
        const planned = nudgeFromPlan(current.brainPlan, current.plan || []);
        if (planned) {
          const fresh = current.nudge && !current.findings.some((f) => f.step.id === current.nudge!.id);
          const aligned =
            fresh &&
            current.nudge!.cap === planned.cap &&
            current.nudge!.covers.some((c) => planned.covers.includes(c));
          if (!aligned) current = { ...current, nudge: planned };
        }
        if (this.helpAsk) {
          current.state = "waiting_human";
          this.activeMission = current;
          return {
            ok: true,
            message: this.helpAsk.question,
            data: { loop: "waiting_human", briefKind: current.goal.kind },
          };
        }
        let thought = await (async (): Promise<Thought> => {
          // 整合整手（行程手册 / 调研 mission）必须先行：reasoner（模型）不能跳过它
          // 先散查——散手机票酒店出不了逐日手册，散手 search_read 只读百度壳页出不了对照报告。
          const needReport = current.goal.deliverables.some((d) => d.required && d.id === "report");
          const forced =
            (current.plan || []).find((s) => s.cap === "trip_plan" && s.trip) ||
            (needReport
              ? (current.plan || []).find((s) => s.cap === "mission" && s.mission)
              : undefined);
          const forcedRan = forced ? ran.some((s) => s.cap === forced!.cap) : false;
          if (forced && !forcedRan) {
            return {
              intent: current.goal.intent,
              deliverables: current.goal.deliverables.map((d) => d.id),
              next: forced,
              why:
                forced.cap === "trip_plan"
                  ? "行程整合手册先行：一手里含逐日路线、交通和每城住宿。"
                  : "调研整手先行：多路检索 + 深读 + 对照表一次做完。",
            };
          }
          const pageUrl = this.getUrl(tabId);
          const skills = skillCatalogLines(this.configDir());
          if (this.deepseek) {
            return this.withTimeout(
              thoughtForAsync(current, (p) => this.deepseek!.completePlain(p), undefined, pageUrl, skills),
              15000,
              thoughtFor(current, undefined, pageUrl),
              false,
            );
          }
          return thoughtFor(current, undefined, pageUrl);
        })();
        const siteGate = gateSiteDelivery({
          goal: current.goal,
          pageUrl: this.getUrl(tabId),
          findings: current.findings,
        });
        if (siteGate.action === "ask") {
          current.state = "waiting_human";
          current.waitReason = "help";
          current.ask = siteGate.ask;
          this.activeMission = current;
          this.chatLog.push({ role: "assistant", text: siteGate.ask });
          this.pushSidebarState();
          return {
            ok: true,
            message: siteGate.ask,
            data: { loop: "waiting_human", briefKind: current.goal.kind },
          };
        }
        if (siteGate.action === "navigate" && thought.next?.cap !== "navigate") {
          thought = {
            intent: current.goal.intent,
            deliverables: current.goal.deliverables.map((d) => d.id),
            next: siteGate.step,
            why: "目标站点与当前页不符，先打开该站。",
          };
        }
        // 调研报告执行层守卫：report mission 整手已【成功】跑过一次，模型再想扫第二遍
        // mission（实测会连扫 3-5 遍同一目标，每遍 ~100s 直到客户端超时）→ 直接收摊去合成。
        // 成功的 mission 自己就是出报告的整手，至少带一份证据；非 mission 的定点补查
        // （search_read 等）不受限，模型仍可补漏。
        if (
          current.goal.deliverables.some((d) => d.required && d.id === "report") &&
          missionOkRuns >= 1 &&
          thought.next?.cap === "mission"
        ) {
          break;
        }
        if (thought.ask) {
          current.state = "blocked";
          current.ask = thought.ask;
          this.activeMission = current;
          this.chatLog.push({
            role: "assistant",
            text: thought.ask,
            cortex: { mode: "ask", need: current.goal.intent, approach: current.goal.approach },
          });
          this.pushSidebarState();
          return { ok: true, message: thought.ask, data: { loop: "ask", briefKind: current.goal.kind } };
        }
        if (thought.synthesize || !thought.next) {
          const before = current.brainPlan;
          current = await this.absorbQueuedPlanEdit(current);
          const pending = current.brainPlan?.steps.some((s) => s.status === "pending" || s.status === "running");
          if (current.brainPlan !== before && pending && i < 7) continue;
          break;
        }
        if (thought.next && current.brainPlan) {
          current = { ...current, brainPlan: focusPlanOnStep(current.brainPlan, thought.next) };
          this.activeMission = current;
        }
        this.chatLog.push({
          role: "assistant",
          text: `正在做 ${i + 1}/… ${thought.next.label}。${thought.why}`,
        });
        this.noteTaskStep(`正在做 ${thought.next.label}`);
        this.pushSidebarState();
        ran.push(thought.next);
        const ls0 = Date.now();
        const finding = await this.runLoopStep(thought.next, current.goal, tabId);
        if (thought.next.cap === "mission" && finding.ok) missionOkRuns += 1;
        current = observe(current, finding);
        if (this.namedSiteIsOpen(current.goal, tabId)) break;
        // 登录墙 / 人机验证墙：只有人能过。停下问人，不再烧步骤。
        // 但只对「本来就要在墙内操作」的步骤生效（fill_form/act/read_page 等）；
        // search_read / navigate 是要离开墙去别的域的，导航失败按普通失败走自纠，不误报卡墙。
        const wallFinger = pageFinger(this.getUrl(tabId), this.getTitle(tabId));
        const onWall = isLoginWall(wallFinger) || isCaptchaWall(wallFinger);
        const ns = thought.next;
        const stepHost = (() => {
          try {
            return ns.query ? new URL(ns.query).host : "";
          } catch {
            return "";
          }
        })();
        const goalUrl = current.goal.siteUrl || (current.goal.site ? `https://${current.goal.site}/` : "");
        const onGoalSite =
          Boolean(goalUrl) && Boolean(wallFinger.host) && sameSite(`https://${wallFinger.host}/`, goalUrl);
        const wallAppliesToStep =
          !["search_read", "navigate", "video_search"].includes(ns.cap) ||
          (Boolean(stepHost) && Boolean(wallFinger.host) && stepHost === wallFinger.host) ||
          onGoalSite;
        if (onWall && wallAppliesToStep) {
          current.state = "waiting_human";
          current.waitReason = isCaptchaWall(wallFinger) ? "captcha" : "login_wall";
          this.activeMission = current;
          const wallQ = isCaptchaWall(wallFinger)
            ? "页面在等人机验证。请你在网页上完成（验证码不要发给我），完成后说「继续」。"
            : `这一步卡在登录页（${wallFinger.host}）。你在窗口里登录后说「继续」，我接着做。`;
          current.ask = wallQ;
          this.chatLog.push({ role: "assistant", text: wallQ });
          this.pushSidebarState();
          return {
            ok: true,
            message: wallQ,
            data: { loop: "waiting_human", briefKind: current.goal.kind },
          };
        }
        // 连续三步没进展：提前收摊，把已查到的如实汇总，不空烧剩余步骤。
        stall = finding.ok ? 0 : stall + 1;
        if (stall >= 3) {
          const stalled = gateSiteDelivery({
            goal: current.goal,
            pageUrl: this.getUrl(tabId),
            findings: current.findings,
          });
          if (stalled.action === "ask") {
            current.state = "waiting_human";
            current.waitReason = "help";
            current.ask = stalled.ask;
            this.activeMission = current;
            this.chatLog.push({ role: "assistant", text: stalled.ask });
            this.pushSidebarState();
            return {
              ok: true,
              message: stalled.ask,
              data: { loop: "waiting_human", briefKind: current.goal.kind },
            };
          }
          if (stalled.action === "navigate") {
            stall = 0;
            continue;
          }
          this.chatLog.push({
            role: "assistant",
            text: `连着 ${stall} 步都没进展，我先汇总已查到的。`,
          });
          this.pushSidebarState();
          break;
        }
        const revised = this.deepseek
          ? await this.withTimeout(
              reconsiderMission(current, (p) => this.deepseek!.completePlain(p)),
              12000,
              current,
              false,
            )
          : await reconsiderMission(current);
        if (revised.goal.intent !== current.goal.intent || revised.goal.kind !== current.goal.kind) {
          this.chatLog.push({
            role: "assistant",
            text: `看完这一页，题改成：${revised.goal.intent}`,
            cortex: { mode: "loop", need: revised.goal.intent, approach: revised.goal.approach },
          });
        }
        current = revised;
        this.activeMission = current;
        this.pushSidebarState();
      }

      current = await this.absorbQueuedPlanEdit(current);
      if (
        this.namedSiteIsOpen(current.goal, tabId) &&
        earlyExitMayCloseDone(current.goal, current.findings, current.brainPlan)
      ) {
        const reply = `已打开 ${current.goal.site}。`;
        if (current.brainPlan) current.brainPlan = closePlan(current.brainPlan, true);
        current.state = "done";
        this.closeMissionRecord(current, "done", "idle");
        this.lastMission = current;
        this.activeMission = undefined;
        this.chatLog.push({ role: "assistant", text: reply });
        this.pushSidebarState();
        return {
          ok: true,
          message: reply,
          data: { loop: "done", briefKind: current.goal.kind, intent: current.goal.intent },
        };
      }
      const live = current.goal;
      let findings = current.findings;
      const finalGate = gateSiteDelivery({
        goal: live,
        pageUrl: this.getUrl(tabId),
        findings,
      });
      if (finalGate.action === "navigate") {
        const finding = await this.runLoopStep(finalGate.step, live, tabId);
        current = observe(current, finding);
        findings = current.findings;
        const wallFinger = pageFinger(this.getUrl(tabId), this.getTitle(tabId));
        const onWall = isLoginWall(wallFinger) || isCaptchaWall(wallFinger);
        if (onWall) {
          const wallQ = isCaptchaWall(wallFinger)
            ? "页面在等人机验证。请你在网页上完成（验证码不要发给我），完成后说「继续」。"
            : `这一步卡在登录页（${wallFinger.host}）。你在窗口里登录后说「继续」，我接着做。`;
          current.state = "waiting_human";
          current.waitReason = isCaptchaWall(wallFinger) ? "captcha" : "login_wall";
          current.ask = wallQ;
          this.activeMission = current;
          this.chatLog.push({ role: "assistant", text: wallQ });
          this.pushSidebarState();
          return {
            ok: true,
            message: wallQ,
            data: { loop: "waiting_human", briefKind: live.kind },
          };
        }
      }
      const afterGate = gateSiteDelivery({
        goal: live,
        pageUrl: this.getUrl(tabId),
        findings,
      });
      if (afterGate.action === "ask" || afterGate.action === "navigate") {
        const ask = afterGate.action === "ask" ? afterGate.ask : `要我先打开 ${live.site} 吗？`;
        current.state = "waiting_human";
        current.waitReason = "help";
        current.ask = ask;
        this.activeMission = current;
        this.chatLog.push({ role: "assistant", text: ask });
        this.pushSidebarState();
        return {
          ok: true,
          message: ask,
          data: { loop: "waiting_human", briefKind: live.kind },
        };
      }
      if (live.site && this.deepseek) {
        const here = pageFinger(this.getUrl(tabId), this.getTitle(tabId));
        const siteUrl = live.siteUrl || `https://${live.site}/`;
        const onSite = Boolean(here.url) && sameSite(here.url, siteUrl);
        if (onSite && !isLoginWall(here) && !isCaptchaWall(here)) {
          const landingRaw = await this.withTimeout(
            this.deepseek.completePlain(siteLandingPrompt(live, here.url)),
            15000,
            "",
            false,
          );
          const landing = parseSiteLanding(landingRaw, live, here.url);
          if (landing && "navigate" in landing) {
            const step: AgentStep = {
              id: `navigate-site-land-${live.site}`,
              cap: "navigate",
              label: `打开 ${live.site}`,
              covers: ["answer"],
              query: landing.navigate,
            };
            const finding = await this.runLoopStep(step, live, tabId);
            current = observe(current, finding);
            findings = current.findings;
            const landed = pageFinger(this.getUrl(tabId), this.getTitle(tabId));
            if (isLoginWall(landed) || isCaptchaWall(landed)) {
              const wallQ = isCaptchaWall(landed)
                ? "页面在等人机验证。请你在网页上完成（验证码不要发给我），完成后说「继续」。"
                : `这一步卡在登录页（${landed.host}）。你在窗口里登录后说「继续」，我接着做。`;
              current.state = "waiting_human";
              current.waitReason = isCaptchaWall(landed) ? "captcha" : "login_wall";
              current.ask = wallQ;
              this.activeMission = current;
              this.chatLog.push({ role: "assistant", text: wallQ });
              this.pushSidebarState();
              return {
                ok: true,
                message: wallQ,
                data: { loop: "waiting_human", briefKind: live.kind },
              };
            }
          }
          const afterLand = pageFinger(this.getUrl(tabId), this.getTitle(tabId));
          if (!isLoginWall(afterLand) && !isCaptchaWall(afterLand) && !(landing && "done" in landing)) {
            const redirected = loginRedirectNote(live, findings);
            if (redirected) {
              current.findings = findings;
              if (current.brainPlan) current.brainPlan = closePlan(current.brainPlan, true);
              current.state = "done";
              this.closeMissionRecord(current, "done", "idle");
              this.lastMission = current;
              this.activeMission = undefined;
              this.chatLog.push({ role: "assistant", text: redirected });
              this.pushSidebarState();
              return {
                ok: true,
                message: redirected,
                data: { loop: "done", briefKind: live.kind, intent: live.intent },
              };
            }
          }
        }
        const parked = pageFinger(this.getUrl(tabId), this.getTitle(tabId));
        if ((isLoginWall(parked) || isCaptchaWall(parked)) && sameSite(parked.url || siteUrl, siteUrl)) {
          const wallQ = isCaptchaWall(parked)
            ? "页面在等人机验证。请你在网页上完成（验证码不要发给我），完成后说「继续」。"
            : `这一步卡在登录页（${parked.host}）。你在窗口里登录后说「继续」，我接着做。`;
          current.state = "waiting_human";
          current.waitReason = isCaptchaWall(parked) ? "captcha" : "login_wall";
          current.ask = wallQ;
          this.activeMission = current;
          this.chatLog.push({ role: "assistant", text: wallQ });
          this.pushSidebarState();
          return {
            ok: true,
            message: wallQ,
            data: { loop: "waiting_human", briefKind: live.kind },
          };
        }
      }
      const onlyOpened = findings.length > 0 && findings.every((f) => f.step.cap === "navigate");
      if (
        userDidNotAskToRead(live) &&
        (live.site || onlyOpened) &&
        earlyExitMayCloseDone(live, findings, current.brainPlan)
      ) {
        const reply = live.site ? `已打开 ${live.site}。` : "页面已打开。";
        if (current.brainPlan) current.brainPlan = closePlan(current.brainPlan, true);
        current.state = "done";
        this.closeMissionRecord(current, "done", "idle");
        this.lastMission = current;
        this.activeMission = undefined;
        this.chatLog.push({ role: "assistant", text: reply });
        this.pushSidebarState();
        return {
          ok: true,
          message: reply,
          data: { loop: "done", briefKind: live.kind, intent: live.intent },
        };
      }
      this.chatLog.push({ role: "assistant", text: "对照目标汇总…" });
      this.pushSidebarState();
      const readyDoc = [...findings].reverse().find((f) => f.doc)?.doc;
      const evidence = findings.filter(
        (f) => f.ok && String(f.text || "").trim().length > 20,
      );
      let synthesized = evidence.map((f) => String(f.text).trim()).join("\n\n");
      // compare_shop is a Mission kind. AgentGoal.kind is BriefKind and never has it.
      // Only "research" overlaps; other brief kinds are absent from RESEARCH_MISSION_KINDS.
      const goalKind = live.kind;
      const reportKind =
        goalKind === "research" || missionNeedsReport(goalKind as MissionKind);
      // 只有一条证据时不必再让模型改写成「检索清单」，原文就是答案
      if (this.deepseek && evidence.length > 0 && (evidence.length > 1 || reportKind)) {
        const sp = synthesizePrompt(live, findings);
        const f0 = Date.now();
        synthesized =
          (
            await this.withTimeout(
              this.deepseek.completePlain(sp),
              90_000,
              "",
            )
          ).trim() || synthesized;
      }
      // 点名了站点的任务，交付是打开那个站（登录则停在登录墙），不是按常识写一篇说明。
      // 闲聊/写作类任务要的是成文内容，不是「名称/链接/未知」的检索清单：
      // 直接让模型按用户原话作答，查到的素材只当参考。
      if (this.deepseek && live.kind === "chat" && !live.site) {
        const material = findings
          .filter((f) => f.ok && String(f.text || "").trim().length > 20)
          .map((f) => String(f.text).trim())
          .join("\n\n")
          .slice(0, 6000);
        const direct = await this.withTimeout(
          this.deepseek.completePlain(
            [
              "直接完成用户的要求，输出成文的中文 Markdown；第一行是「# 标题」，需要时分成小节。",
              "不要列检索结果、名称链接、步骤说明，也不要写「未知」；素材不足就按常识写，不要编造具体事实与数字。",
              /总结|摘要|提炼|概括|归纳|原文/.test(live.raw)
                ? "这是一次归纳：只使用下面的素材，不要补充素材以外的事实。"
                : "",
              `用户原话：${live.raw}`,
              material ? `可用素材：\n${material}` : "",
            ]
              .filter(Boolean)
              .join("\n\n"),
          ),
          90_000,
          "",
          false,
        );
        if (direct.trim()) synthesized = direct.trim();
      }
      const verify = verifyContracts(live, findings, { synthesized, plan: current.brainPlan });
      try {
        writeExperience(this.configDir(), reviewLesson(live, verify, ran.length ? ran : compileHands(live)));
      } catch {
        /* 复盘写不进就算了 */
      }

      let reply = synthesized;
      let replyDoc = readyDoc;
      const facetCount = live.deliverables.filter((d) =>
        d.required && ["stay", "food", "sights", "itinerary", "report"].includes(d.id),
      ).length;
      const needDoc =
        !replyDoc &&
        synthesized.length > 80 &&
        (facetCount >= 2 ||
          live.kind === "research" ||
          live.kind === "trip" ||
          live.deliverables.some((d) => d.required && d.id === "report"));
      if (needDoc) {
        const title = live.known.cities?.length
          ? `${live.known.cities.join("、")} · ${live.deliverables
              .filter((d) => d.required)
              .map((d) => d.label)
              .join("、")}`
          : live.intent.slice(0, 24);
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        replyDoc = writeHtmlReport(
          this.configDir(),
          `goal-${stamp}`,
          readingReportHtml({
            title,
            body: synthesized,
            eyebrow: verify.complete ? "SPARO 手册" : "未完成",
          }),
          { title, kind: live.kind === "research" ? "research" : "read" },
        );
        reply = verify.complete
          ? `${title} 已写好。窗口里打开完整页。`
          : `${title} 先写了已查到的。${verify.notes}`;
        this.openReportQuiet(replyDoc.path);
      } else if (!verify.complete && !replyDoc) {
        reply = `${synthesized}\n\n${verify.notes}`;
      }

      // 阅读优先：成篇汇总不进侧栏，落阅读页在窗口里打开
      const sealedFinal = this.sealLongRead(
        reply,
        replyDoc,
        live.intent,
        verify.complete ? undefined : { incompleteNote: verify.notes },
      );
      reply = sealedFinal.text;
      replyDoc = sealedFinal.doc;

      if (cloudGate === "ok") {
        const settle = await this.finishCloudTask();
        if (settle) {
          reply = `${reply}\n\n${this.L("cloud.usedThis", {
            x: settle.approxTasksUsed,
            n: settle.approxTasks,
          })}`;
        }
      }
      current.findings = findings;
      if (verify.complete && live.coverage === "new" && this.deepseek) {
        try {
          if (!shouldSkipRemember(live.raw, reply) && !findings.some((f) => f.step.cap === "run_skill" && f.ok)) {
            const skill = await distillMission({
              configDir: this.configDir(),
              goal: live,
              plan: current.brainPlan,
              findings,
              complete: (p) => this.deepseek!.completePlain(p),
            });
            if (skill) {
              this.skillsCache = listSkills(this.configDir());
              reply = `${reply}\n\n${this.L("distill.saved", { title: skill.title })}`;
            }
          }
        } catch {
          /* 沉淀失败不挡关单 */
        }
      }
      if (current.brainPlan) current.brainPlan = closePlan(current.brainPlan, verify.complete);
      current.state = "done";
      this.closeMissionRecord(current, verify.complete ? "done" : "incomplete", "idle");
      this.lastMission = current;
      this.activeMission = undefined;
      this.chatLog.push({ role: "assistant", text: reply, doc: replyDoc });
      this.pushSidebarState();
      return {
        ok: true,
        message: reply,
        data: {
          loop: "done",
          briefKind: live.kind,
          covered: verify.covered,
          missing: verify.missing,
          intent: live.intent,
          files: replyDoc ? [replyDoc.path] : undefined,
        },
      };
    } finally {
      if (this.cloudTaskId) void this.finishCloudTask();
    }
  }

  private async runLoopStep(step: AgentStep, goal: AgentGoal, tabId?: string): Promise<StepFinding> {
    tabId = tabId || this.agentTabId || this.activeTabId;
    const city = step.city || goal.known.cities?.[0] || "";
    const start = step.checkin || goal.known.start || addDays(ymd(new Date()), 1);
    const end = step.checkout || goal.known.end || addDays(start, 2);
    const fail = (text: string): StepFinding => ({
      step,
      text,
      url: this.getUrl(tabId),
      ok: false,
    });
    try {
      if (step.cap === "hotel_search" && city) {
        const text = await this.runTravelSearch(
          {
            kind: "hotel",
            site: (step.site && isLegalSite("hotel", step.site)
              ? step.site
              : detectHotelSite(goal.raw)) as HotelSite,
            city,
            checkin: start,
            checkout: end,
            priceMax: goal.known.hotelPriceMax,
            area: [goal.known.audience, goal.known.cheaper ? "便宜" : ""].filter(Boolean).join(" ") || undefined,
          },
          { raw: true, tabId },
        );
        return { step, text, url: this.getUrl(tabId), ok: text.length > 40 };
      }
      const scatteredLeg = (
        s: AgentStep,
      ): { from: string; to: string; date: string } | null => {
        if (s.from && s.to && s.date) return { from: s.from, to: s.to, date: s.date };
        // 模型散手只给了自由文本（如「搜北京→成都 10月8日机票」）：从原话已知事实补齐
        const origin = goal.known.origin || "";
        const target = s.city || goal.known.cities?.[0] || "";
        let from = origin;
        let to = target;
        const m = String(s.query || "").match(
          /([一-龥A-Za-z·]{2,8})\s*(?:→|->|—|-|飞|到|至)\s*([一-龥A-Za-z·]{2,8})/,
        );
        if (m) {
          const a = canonCity(m[1]) || plausiblePlace(m[1]);
          const b = canonCity(m[2]) || plausiblePlace(m[2]);
          if (a && b) {
            from = a;
            to = b;
          }
        }
        const date = goal.known.start || "";
        return from && to && date ? { from, to, date } : null;
      };
      const flightLeg = step.cap === "flight_search" ? scatteredLeg(step) : null;
      if (step.cap === "flight_search" && flightLeg) {
        const text = await this.runTravelSearch(
          {
            kind: "flight",
            site: (step.site && isLegalSite("flight", step.site)
              ? step.site
              : detectFlightSite(goal.raw, flightLeg.from, flightLeg.to)) as FlightSite,
            from: flightLeg.from,
            to: flightLeg.to,
            date: flightLeg.date,
          },
          { raw: true, tabId },
        );
        return { step, text, url: this.getUrl(tabId), ok: text.length > 40 };
      }
      const trainLeg = step.cap === "train_search" ? scatteredLeg(step) : null;
      if (step.cap === "train_search" && trainLeg) {
        const text = await this.runTravelSearch(
          {
            kind: "train",
            site: (step.site && isLegalSite("train", step.site) ? step.site : "12306") as TrainSite,
            from: trainLeg.from,
            to: trainLeg.to,
            date: trainLeg.date,
          },
          { raw: true, tabId },
        );
        return { step, text, url: this.getUrl(tabId), ok: text.length > 40 };
      }
      if (step.cap === "navigate" && step.query) {
        // query 可能是 URL、英文域名或中文站名；中文站名映射真实域名，不直接当域名导航
        const url = resolveStepUrl(step.query);
        const nav = await this.withTimeout(this.navigate(url, { asHuman: true, tabId }), 12000, {
          ok: false,
          message: "打开超时",
        });
        if (!nav.ok) return fail(nav.message);
        const page = await this.withTimeout(this.pageText(tabId), 8000, {
          ok: true,
          message: "",
          data: { text: "", length: 0 },
        });
        const text = String(page.data?.text || "").trim();
        return { step, text, url: this.getUrl(tabId) || url, ok: text.length > 40 };
      }
      if (step.cap === "search_read" && step.query) {
        const site = step.site && isLegalSite("search", step.site) ? step.site : "baidu";
        const url =
          searchResultUrl(site, step.query) ||
          `https://www.baidu.com/s?wd=${encodeURIComponent(step.query)}`;
        const nav = await this.withTimeout(this.navigate(url, { asHuman: true, tabId }), 12000, {
          ok: false,
          message: "打开超时",
        });
        if (!nav.ok) return fail(nav.message);
        const page = await this.withTimeout(this.pageText(tabId), 8000, {
          ok: true,
          message: "",
          data: { text: "", length: 0 },
        });
        const text = cleanSearchPageText(String(page.data?.text || "").trim());
        return { step, text, url: this.getUrl(tabId) || url, ok: text.length > 40 };
      }
      if (step.cap === "video_search" && step.query) {
        const zh = /[一-鿿]/.test(step.query);
        const url = zh
          ? `https://search.bilibili.com/all?keyword=${encodeURIComponent(step.query)}`
          : `https://www.youtube.com/results?search_query=${encodeURIComponent(step.query)}`;
        const nav = await this.withTimeout(this.navigate(url, { asHuman: true, tabId }), 12000, {
          ok: false,
          message: "打开超时",
        });
        if (!nav.ok) return fail(nav.message);
        const page = await this.withTimeout(this.pageText(tabId), 8000, {
          ok: true,
          message: "",
          data: { text: "", length: 0 },
        });
        const text = String(page.data?.text || "").trim();
        return { step, text, url: this.getUrl(tabId) || url, ok: text.length > 40 };
      }
      if (step.cap === "read_page") {
        const text = await this.summarizeActivePage(goal.raw, tabId);
        return { step, text, url: this.getUrl(tabId), ok: text.length > 20 };
      }
      if (step.cap === "fill_form") {
        const text = await this.previewFormFill(goal.raw, tabId);
        return { step, text, url: this.getUrl(tabId), ok: Boolean(text) };
      }
      if (step.cap === "act" && (step.query || step.action)) {
        const hand = await this.executeHand(
          step.action || { type: "llm", text: step.query || goal.raw },
          goal.raw,
          [],
          goal.kind,
          tabId,
        );
        return { step, text: hand.reply, url: this.getUrl(tabId), ok: hand.reply.length > 8, doc: hand.replyDoc };
      }
      if (step.cap === "trip_plan" && step.trip) {
        const hand = await this.executeHand({ type: "trip_plan", plan: step.trip }, goal.raw, [], goal.kind, tabId);
        return { step, text: hand.reply, url: this.getUrl(tabId), ok: Boolean(hand.reply), doc: hand.replyDoc };
      }
      if (step.cap === "mission") {
        // 模型编 mission 步可能不带 mission 载荷：用本地 parseMission 按原话兜底解析，
        // 拿不到整手就如实失败，不能静默掉成 0ms 失败还占一步。
        const mission = step.mission || parseMission(goal.raw);
        if (!mission) return fail("这一步没有对应的手。");
        const hand = await this.executeHand({ type: "mission", mission }, goal.raw, [], goal.kind, tabId);
        return { step, text: hand.reply, url: this.getUrl(tabId), ok: Boolean(hand.reply), doc: hand.replyDoc };
      }
      if (step.cap === "run_skill" && !step.action && step.query) {
        const hand = await this.executeHand(
          { type: "run_skill", id: step.query, query: step.query },
          goal.raw,
          [],
          goal.kind,
          tabId,
        );
        return { step, text: hand.reply, url: this.getUrl(tabId), ok: Boolean(hand.reply), doc: hand.replyDoc };
      }
      if (step.action) {
        const hand = await this.executeHand(step.action, goal.raw, [], goal.kind, tabId);
        return { step, text: hand.reply, url: this.getUrl(tabId), ok: Boolean(hand.reply), doc: hand.replyDoc };
      }
      return fail("这一步没有对应的手。");
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * 正常收尾关本单，并关掉同一句原话里还没执行过的影子单。
   * 用户当场说「算了」时 scope 用 all，把这一句还开着的单一起关掉。
   * 启动恢复只读，不从这里清扫。
   */
  private closeMissionRecord(mission: ActiveMission, reason: string, scope: "all" | "idle"): void {
    journalCloseUtterance(mission.raw || mission.goal?.raw || "", reason, this.configDir(), {
      alsoId: mission.id,
      onlyIdle: scope === "idle",
      origin: mission,
    });
  }

  private offerMissionRecovery(): void {
    let pending: RestoredMission[] = [];
    try {
      pending = replayMissions(this.configDir());
    } catch (error) {
      console.warn("[mission-journal] replay failed", error instanceof Error ? error.message : error);
      return;
    }
    const item = pickInterruptedMission(pending);
    if (!item) return;
    this.pendingRecovery = item;
    this.chatLog.push({ role: "assistant", text: recoveryLine(item) });
  }

  private async takeRecoveryAnswer(text: string, jobImages: string[]): Promise<ToolResult | null> {
    const item = this.pendingRecovery;
    if (!item) return null;
    const choice = decideRecovery(text);
    this.pendingRecovery = null;
    if (!choice) return null;
    if (choice === "dismiss") {
      this.closeMissionRecord(item.mission, "算了", "all");
      const reply = "这单先放下了。";
      this.chatLog.push({ role: "assistant", text: reply });
      this.pushSidebarState();
      return { ok: true, message: reply };
    }
    const mission = item.mission;
    this.activeMission = mission;
    if (mission.state === "waiting_human" || mission.state === "blocked" || mission.state === "propose") {
      const reply = mission.ask || recoveryLine(item);
      this.chatLog.push({ role: "assistant", text: reply });
      this.pushSidebarState();
      return { ok: true, message: reply, data: { loop: mission.state, briefKind: mission.goal.kind } };
    }
    return this.executeMission(mission, jobImages);
  }

  async handleChat(text: string, images?: string[], quotes?: unknown): Promise<ToolResult> {
    const pics = sanitizeImageDataUrls(images);
    const cleanQuotes = normalizeQuotes(quotes);
    const waiting = this.matchWaitingResume(text);
    if (waiting) return this.resumeWaiting(waiting, text, pics, cleanQuotes);
    this.dismissAbandonedForegroundWaits();
    // 「运行妙招」必须先到门岗窄路。laneForText 会走 parseMission，
    // 把「运行妙招 比价 / 天气穿衣建议」收成后台工作单，窄路就看不见了。
    if (!runSkillUtteranceQuery(text) && laneForText(text) === "background") {
      return this.enqueueBackground(text, pics, cleanQuotes);
    }
    return this.enqueueForeground(text, pics, cleanQuotes);
  }

  /** 下一句对不上「继续」时，收掉被扔下的前台等待。后台登录墙留着。 */
  private dismissAbandonedForegroundWaits(): void {
    const abandoned = this.taskPool.tasks.filter(
      (task) => task.lane === "foreground" && task.state === "waiting_human",
    );
    if (!abandoned.length) return;
    const missionIds = new Set<string>();
    for (const task of [...abandoned]) {
      const mission = this.waitingMissions.get(task.id);
      if (mission) missionIds.add(mission.id);
      this.waitingMissions.delete(task.id);
      this.taskPool.dismiss(task.id);
    }
    const current = this.activeMission;
    if (current && (missionIds.has(current.id) || current.state === "waiting_human")) {
      this.activeMission = undefined;
    }
  }

  /** 后台标签。createAgentTab 不激活；若底层改了当前标签，立刻切回去。 */
  private openBackgroundTab(): string {
    const before = this.activeTabId;
    const tabId = this.createAgentTab();
    if (before && this.activeTabId !== before) this.switchTab(before);
    return tabId;
  }

  private async runScoped<T>(
    lane: TaskLane,
    tabId: string,
    work: () => Promise<T>,
    mission?: ActiveMission,
  ): Promise<T> {
    const scope: TaskScope = {
      tabId,
      lane,
      mission: lane === "foreground" ? (mission ?? this.fallbackMission) : mission,
      lastMission: lane === "foreground" ? this.fallbackLastMission : undefined,
      helpAsk: lane === "foreground" ? this.fallbackHelpAsk : null,
      cloudTaskId: undefined,
    };
    try {
      return await this.taskScope.run(scope, work);
    } finally {
      if (lane === "foreground") {
        this.fallbackMission = scope.mission;
        this.fallbackLastMission = scope.lastMission;
        this.fallbackHelpAsk = scope.helpAsk;
      }
    }
  }

  private shouldSuspend(result: ToolResult): boolean {
    return poolShouldSuspend(result, this.activeMission);
  }

  private matchWaitingResume(text: string): PoolTask | undefined {
    if (!isContinueHint(text)) return undefined;
    const waiting = this.taskPool.tasks.filter((task) => task.state === "waiting_human");
    if (!waiting.length) return undefined;
    const onActive = waiting.find((task) => task.tabId && task.tabId === this.activeTabId);
    if (onActive) return onActive;
    const fgWaiting =
      this.fallbackMission?.state === "waiting_human" || this.fallbackMission?.state === "running";
    if (fgWaiting) return undefined;
    if (waiting.length === 1) return waiting[0];
    return undefined;
  }

  private taskTitle(text: string): string {
    return text.trim().replace(/\s+/g, " ").slice(0, 28) || "任务";
  }

  private enqueueForeground(text: string, images?: string[], quotes?: SparoQuote[]): Promise<ToolResult> {
    if (!this.taskPool.tryStartForeground()) {
      this.chatQueue.push({ text, images, quotes });
      this.chatLog.push({
        role: "assistant",
        text: `「${text.slice(0, 28)}」已排队，等当前任务写出手册再做。`,
      });
      this.pushSidebarState();
      return Promise.resolve({ ok: true, message: "queued" });
    }
    const id = randomBytes(4).toString("hex");
    const title = this.taskTitle(text);
    const card = this.taskPool.start({ id, tabId: this.activeTabId, title, lane: "foreground" });
    this.pushSidebarState();
    return this.runJob(card, { id, text, images, quotes, title });
  }

  private enqueueBackground(text: string, images?: string[], quotes?: SparoQuote[]): Promise<ToolResult> {
    const id = randomBytes(4).toString("hex");
    const title = this.taskTitle(text);
    const job: BackgroundJob = { id, text, images, quotes, title };
    if (!this.taskPool.canStartBackground()) {
      const card = this.taskPool.enqueue({ id, tabId: "", title, lane: "background" });
      this.backgroundQueue.push(job);
      this.chatLog.push({ role: "assistant", text: `「${title}」${card.step}` });
      this.pushSidebarState();
      return Promise.resolve({ ok: true, message: card.step });
    }
    const card = this.taskPool.start({ id, tabId: "", title, lane: "background" });
    return this.launchBackground(card, job);
  }

  private resumeWaiting(
    task: PoolTask,
    text: string,
    images?: string[],
    quotes?: SparoQuote[],
  ): Promise<ToolResult> {
    const mission = this.waitingMissions.get(task.id);
    const job: BackgroundJob = { id: task.id, text, images, quotes, title: task.title, mission };
    if (task.lane === "foreground") {
      if (!this.taskPool.tryStartForeground()) {
        this.chatQueue.unshift({ text, images, quotes });
        this.chatLog.push({
          role: "assistant",
          text: `「${text.slice(0, 28)}」已排队，等当前任务写出手册再做。`,
        });
        this.pushSidebarState();
        return Promise.resolve({ ok: true, message: "queued" });
      }
      this.taskPool.markRunning(task.id);
      if (!task.tabId) task.tabId = this.activeTabId;
      this.pushSidebarState();
      return this.runJob(task, job);
    }
    if (!this.taskPool.canStartBackground()) {
      this.taskPool.requeueFront(task.id);
      this.backgroundQueue.unshift(job);
      const step = this.taskPool.tasks.find((item) => item.id === task.id)?.step || "排队中（第 1 位）";
      this.chatLog.push({ role: "assistant", text: `「${task.title}」${step}` });
      this.pushSidebarState();
      return Promise.resolve({ ok: true, message: step });
    }
    this.taskPool.markRunning(task.id);
    return this.launchBackground(task, job);
  }

  private launchBackground(task: PoolTask, job: BackgroundJob): Promise<ToolResult> {
    if (!task.tabId) task.tabId = this.openBackgroundTab();
    this.pushSidebarState();
    return this.runJob(task, job);
  }

  private async runJob(card: PoolTask, job: BackgroundJob): Promise<ToolResult> {
    let result: ToolResult;
    try {
      result = await this.runScoped(
        card.lane,
        card.tabId,
        async () => {
          const out = await this.handleChatJob(job.text, job.images, job.quotes, card.tabId);
          if (this.shouldSuspend(out)) {
            if (this.activeMission) this.waitingMissions.set(card.id, this.activeMission);
            this.taskPool.suspend(card.id);
          }
          return out;
        },
        job.mission,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.chatLog.push({ role: "assistant", text: message });
      result = { ok: false, message };
    }
    const suspended = this.taskPool.tasks.find((task) => task.id === card.id)?.state === "waiting_human";
    if (!suspended) {
      this.waitingMissions.delete(card.id);
      this.taskPool.finish(card.id, result.ok ? "done" : "failed");
      if (card.lane === "background" && card.tabId) this.releaseAgentTab(card.tabId);
    }
    if (card.lane === "foreground") this.taskPool.releaseForeground();
    this.pushSidebarState();
    if (card.lane === "background") this.pumpBackground();
    else this.pumpForeground();
    return result;
  }

  private pumpForeground(): void {
    const next = this.chatQueue.shift();
    if (next) void this.handleChat(next.text, next.images, next.quotes);
  }

  private pumpBackground(): void {
    while (this.taskPool.canStartBackground()) {
      const next = this.taskPool.promoteNext();
      if (!next) return;
      const idx = this.backgroundQueue.findIndex((job) => job.id === next.id);
      if (idx < 0) {
        this.taskPool.finish(next.id, "failed");
        continue;
      }
      const [job] = this.backgroundQueue.splice(idx, 1);
      void this.launchBackground(next, job);
    }
  }

  /** 笔记引用带 noteId 时换成库里的全文，截到 4000 字。 */
  private materializeNoteQuotes(quotes: SparoQuote[]): SparoQuote[] {
    return quotes.map((quote) => {
      if (quote.kind !== "note" || !quote.noteId) return quote;
      const note = readNote(quote.noteId);
      if (!note) return fillNoteQuote(quote, null);
      return fillNoteQuote(quote, { title: note.meta.title, markdown: note.markdown });
    });
  }

  private async handleChatJob(text: string, images?: string[], quotes?: SparoQuote[], tabId?: string): Promise<ToolResult> {
    const boundTab = tabId || this.activeTabId;
    const prevAgentTab = this.agentTabId;
    this.agentTabId = boundTab;
    try {
      return await this.dispatchChatJob(text, images, quotes, boundTab);
    } finally {
      this.agentTabId = prevAgentTab;
    }
  }

  /** 有未关的单、暂停、引用、附图、后台车道时，门岗和「运行妙招」窄路都让路。 */
  private habitGateBlocked(cleanQuotes: SparoQuote[], jobImages: string[]): boolean {
    if (cleanQuotes.length > 0) return true;
    if (jobImages.length > 0) return true;
    if (this.paused) return true;
    if (this.taskStore()?.lane === "background") return true;
    if (missionStillOpen(this.activeMission)) return true;
    if (missionStillOpen(this.taskStore()?.mission)) return true;
    return false;
  }

  /** 命中才直放。distilled 不进门岗。失败记账后当轮转脑，不把失败结果吃掉。 */
  private async replayHabit(text: string): Promise<ToolResult | "fallthrough" | null> {
    const hit = matchTrigger(loadTriggers(this.configDir()), text);
    if (!hit) return null;
    const skill = getSkill(this.configDir(), hit.skillId);
    if (!skill || skill.distilled) return null;
    const title = skill.title || hit.skillId;
    const line = this.L("trigger.byHabit", { title });
    this.chatLog.push({ role: "assistant", text: line });
    this.pushSidebarState();
    const ran = await runSkill(this, this.configDir(), { id: hit.skillId });
    const next = recordOutcome(this.configDir(), hit.id, ran.ok);
    if (!ran.ok) {
      this.chatLog.push({ role: "assistant", text: ran.message });
      if (next && !next.enabled) this.chatLog.push({ role: "assistant", text: this.L("trigger.dropped") });
      this.pushSidebarState();
      return "fallthrough";
    }
    this.pushSidebarState();
    return { ok: true, message: line };
  }

  /** 登记卡只挂在有 userAsk 的 run_skill 上。一步到位由大脑判定。已有记录（含停用）或已有未点卡片则不再推。 */
  private async maybeOfferTrigger(userAsk: string, result: ToolResult): Promise<void> {
    if (!result.ok) return;
    const data = result.data as { skillId?: string } | undefined;
    const skillId = String(data?.skillId || "").trim();
    const text = normalizeUtterance(userAsk);
    if (!skillId || !text) return;
    const skill = getSkill(this.configDir(), skillId);
    if (!skill || !this.deepseek) return;
    try {
      const verdict = parseOneShotVerdict(
        await this.deepseek.completePlain(
          oneShotJudgePrompt({
            title: skill.title,
            intent: skill.intent,
            stepCount: skill.stepCount,
            steps: skill.steps,
            params: skill.params,
          }),
        ),
      );
      if (verdict !== true) return;
    } catch {
      return;
    }
    if (hasTriggerText(this.configDir(), text)) return;
    if (this.chatLog.some((turn) => turn.pendingTrigger && normalizeUtterance(turn.pendingTrigger.text) === text)) {
      return;
    }
    const shown = text.length > 28 ? `${text.slice(0, 28)}…` : text;
    this.chatLog.push({
      role: "assistant",
      text: this.L("trigger.rememberAsk", { text: shown }),
      pendingTrigger: { skillId, text },
    });
  }

  private clearPendingTrigger(text: string): void {
    const key = normalizeUtterance(text);
    this.chatLog = this.chatLog.map((turn) => {
      if (!turn.pendingTrigger || normalizeUtterance(turn.pendingTrigger.text) !== key) return turn;
      const { pendingTrigger: _drop, ...rest } = turn;
      return rest;
    });
  }

  private async dispatchChatJob(text: string, images?: string[], quotes?: SparoQuote[], tabId?: string): Promise<ToolResult> {
    tabId = tabId || this.agentTabId || this.activeTabId;
    const cleanQuotes = normalizeQuotes(quotes);
    let jobImages = sanitizeImageDataUrls(images);
    this.chatLog.push(quotedUserTurn(text, cleanQuotes, jobImages));
    this.pushSidebarState();
    const recovered =
      this.taskStore()?.lane === "background" ? null : await this.takeRecoveryAnswer(text, jobImages);
    if (recovered) return recovered;
    if (this.helpAsk) {
      const t = text.trim();
      // 只把真正像回答的话当回答（选项/是/否/登录/继续）；普通短句（如「搜今天北京天气」）不当回答，放行到正常分诊
      const looksAnswer =
        isContinueHint(t) ||
        /^(是|对|要|需要|否|不是|不用|没有|有弹窗|弹层|要换入口|换入口|换个入口|先登录|要登录|先不管|跳过|不管|我过完了|yes|no|skip|overlay)/i.test(t) ||
        /登录|登陆|sign\s?in/i.test(t);
      if (looksAnswer) {
        const learned = this.answerLearning(t);
        if (this.activeMission && (this.activeMission.state === "waiting_human" || this.activeMission.state === "running")) {
          return this.executeMission(this.activeMission, jobImages, tabId);
        }
        return learned;
      }
      this.answerLearning("先不管");
    }
    this.recentLearned = [];

    if (!this.habitGateBlocked(cleanQuotes, jobImages)) {
      const replay = await this.replayHabit(text);
      if (replay === "fallthrough") {
        // 失败当轮转脑：跳过窄路，否则「运行妙招」句式会把同一技能再跑一遍。
      } else if (replay) {
        return replay;
      } else {
        const named = runSkillUtteranceQuery(text);
        if (named) {
          const skillId = namedSkillId(this.configDir(), named);
          if (!skillId) {
            const message = `未找到妙招「${named}」`;
            this.chatLog.push({ role: "assistant", text: message });
            this.pushSidebarState();
            return { ok: false, message };
          }
          try {
            const hand = await this.executeHand({ type: "run_skill", id: skillId, query: named }, text, [], "chat", tabId);
            this.chatLog.push({ role: "assistant", text: hand.reply, doc: hand.replyDoc });
            this.pushSidebarState();
            return {
              ok: true,
              message: hand.reply,
              data: { files: hand.replyDoc ? [hand.replyDoc.path] : undefined },
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.chatLog.push({ role: "assistant", text: message });
            this.pushSidebarState();
            return { ok: false, message };
          }
        }
      }
    }

    if (cleanQuotes.length) {
      const prompt = composeQuotedPrompt(text, this.materializeNoteQuotes(cleanQuotes));
      const cloudGate = await this.beginCloudTaskIfNeeded({ type: "llm", text: prompt }, prompt);
      if (cloudGate === "refused") {
        const reply = this.lastCloudRefuse || this.L("cloud.exhausted");
        this.chatLog.push({ role: "assistant", text: reply });
        this.pushSidebarState();
        return { ok: false, message: reply };
      }
      try {
        const hand = await this.executeHand({ type: "llm", text: prompt }, prompt, jobImages, "chat", tabId);
        const quote = cleanQuotes[0];
        const source: ReadingSource | undefined = quote?.url
          ? { title: quote.title, url: quote.url, siteName: quote.siteName }
          : undefined;
        const sealed = this.sealLongRead(hand.reply, hand.replyDoc, quote?.title || text, {
          source,
          force: !hand.replyDoc && hand.reply.trim().length >= 60,
        });
        this.chatLog.push({ role: "assistant", text: sealed.text, doc: sealed.doc });
        this.pushSidebarState();
        return {
          ok: true,
          message: sealed.text,
          data: { files: sealed.doc ? [sealed.doc.path] : undefined },
        };
      } finally {
        if (this.cloudTaskId) void this.finishCloudTask();
      }
    }

    if (jobImages.length && /附图|这张图|看看图|识图/.test(text)) {
      const cloudGate = await this.beginCloudTaskIfNeeded({ type: "llm", text }, text);
      if (cloudGate === "refused") {
        const reply = this.lastCloudRefuse || this.L("cloud.exhausted");
        this.chatLog.push({ role: "assistant", text: reply });
        this.pushSidebarState();
        return { ok: false, message: reply };
      }
      try {
        const hand = await this.executeHand({ type: "llm", text }, text, jobImages, "chat", tabId);
        const sealed = this.sealLongRead(hand.reply, hand.replyDoc, text);
        this.chatLog.push({ role: "assistant", text: sealed.text, doc: sealed.doc });
        this.pushSidebarState();
        return {
          ok: true,
          message: sealed.text,
          data: { files: sealed.doc ? [sealed.doc.path] : undefined },
        };
      } finally {
        if (this.cloudTaskId) void this.finishCloudTask();
      }
    }

    const fileTask = detectFileTask(text);
    if (fileTask) return this.runFileTask(fileTask);

    const directReader = parseLocalIntent(text);
    if (
      directReader.type === "reader_mode" ||
      directReader.type === "reader_companion" ||
      directReader.type === "notes_action" ||
      directReader.type === "notes_search"
    ) {
      try {
        const hand = await this.executeHand(directReader, text, [], "read", tabId);
        this.chatLog.push({ role: "assistant", text: hand.reply, doc: hand.replyDoc });
        this.pushSidebarState();
        return {
          ok: true,
          message: hand.reply,
          data: { files: hand.replyDoc ? [hand.replyDoc.path] : undefined },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.chatLog.push({ role: "assistant", text: message });
        this.pushSidebarState();
        return { ok: false, message };
      }
    }

    const priorRead = this.priorReadPage(cleanQuotes);
    if (priorRead && !isPauseText(text) && !isResumeText(text)) {
      const verdict = await this.judgeReadRewrite(text, priorRead.title || "");
      if (verdict === "rewrite") return this.reviseReadPage(text, priorRead);
    }

    const homeCity = loadProfile(this.configDir()).identity.homeCity;
    const complete = this.deepseek ? (p: string) => this.deepseek!.completePlain(p) : undefined;
    const turnCtx = {
      active: this.activeMission,
      last: this.lastMission,
      homeCity: homeCity || undefined,
      now: new Date(),
      paused: this.paused,
    };
    // 兜底要等模型超时再跑。提前跑会先开一张启发式单，和模型单变成同一句的双胞胎。
    // coverage 判定经常超过 20 秒。到点先不把启发式单开跑，同一句再等一轮；
    // 仍没回来才改走兜底，并告诉晚到的模型单不要再落盘。
    let wantModel = true;
    const pendingModel = complete
      ? applyTurnAsync(
          text,
          {
            ...turnCtx,
            page: { url: this.getUrl(tabId), title: this.getTitle(tabId) },
          },
          complete,
          this.configDir(),
          { stillWanted: () => wantModel },
        )
      : null;
    const raced = pendingModel
      ? await this.withTimeout(pendingModel, 20000, null, false)
      : null;
    const modelTurn =
      raced || (pendingModel ? await this.withTimeout(pendingModel, 40000, null, false) : null);
    if (!modelTurn) wantModel = false;
    const turn = modelTurn || applyTurn(text, turnCtx);
    if (turn.mission) {
      try {
        const pending = replayMissions(this.configDir());
        const preferred = preferredMission(turn.mission, pending);
        if (preferred.id !== turn.mission.id) turn.mission = preferred;
      } catch (error) {
        console.warn("[mission-journal] prefer failed", error instanceof Error ? error.message : error);
      }
    }

    if (turn.effect === "pause") {
      this.setPaused(true);
      this.chatLog.push({ role: "assistant", text: turn.say });
      this.pushSidebarState();
      return { ok: true, message: turn.say, data: { kind: "pause" } };
    }
    if (turn.effect === "resume") {
      this.setPaused(false);
      this.chatLog.push({ role: "assistant", text: turn.say });
      this.pushSidebarState();
      if (this.activeMission && (this.activeMission.state === "waiting_human" || this.activeMission.state === "running")) {
        return this.executeMission(this.activeMission, jobImages, tabId);
      }
      return { ok: true, message: turn.say, data: { kind: "resume" } };
    }
    if (turn.effect === "cancel") {
      this.lastMission = turn.mission || this.activeMission;
      this.activeMission = undefined;
      this.chatLog.push({ role: "assistant", text: turn.say });
      this.pushSidebarState();
      return { ok: true, message: turn.say, data: { kind: "cancel" } };
    }
    if (turn.effect === "ask" || turn.effect === "propose" || turn.effect === "chat") {
      this.activeMission = turn.effect === "chat" ? undefined : turn.mission || undefined;
      if (turn.effect === "chat") this.lastMission = turn.mission || this.lastMission;
      const mode = turn.effect === "chat" ? undefined : turn.effect;
      const sealedSay = turn.effect === "chat" ? this.sealLongRead(turn.say, undefined, text) : { text: turn.say };
      this.chatLog.push({
        role: "assistant",
        text: sealedSay.text,
        doc: sealedSay.doc,
        cortex: mode
          ? { mode, need: turn.mission?.goal.intent, approach: turn.mission?.goal.approach }
          : undefined,
      });
      this.pushSidebarState();
      return {
        ok: true,
        message: sealedSay.text,
        data: {
          kind: turn.effect,
          briefKind: turn.mission?.goal.kind,
          ask: turn.effect === "ask" ? sealedSay.text : undefined,
          approach: turn.mission?.goal.approach,
          files: sealedSay.doc ? [sealedSay.doc.path] : undefined,
        },
      };
    }

    if (turn.side) {
      const parked = turn.mission;
      const sideMission = turn.side;
      const sideOut = await this.executeMission(sideMission, jobImages, tabId);
      // side 跑完如果还卡着（waiting_human/blocked/running），留在前台；只有 side 完成才恢复 parked
      if (sideMission.state === "done" || sideMission.state === "cancelled") {
        this.activeMission = parked || undefined;
      } else {
        this.activeMission = sideMission;
      }
      return sideOut;
    }

    if (turn.mission) {
      this.activeMission = turn.mission;
      return this.executeMission(turn.mission, jobImages, tabId);
    }

    const sealedTail = this.sealLongRead(turn.say || "好。", undefined, text);
    this.chatLog.push({ role: "assistant", text: sealedTail.text, doc: sealedTail.doc });
    this.pushSidebarState();
    return {
      ok: true,
      message: sealedTail.text,
      data: { files: sealedTail.doc ? [sealedTail.doc.path] : undefined },
    };
  }

  private cloudErrorText(error: unknown): string {
    const kind = describeCloudError(error);
    if (kind === "network") return this.L("cloud.proxyDown");
    if (kind === "email") return this.L("cloud.emailInvalid");
    if (kind === "code") return this.L("cloud.codeNeed");
    return error instanceof Error ? error.message : String(error);
  }

  private L(key: string, vars?: Record<string, string | number>): string {
    return tx(this.settings.locale, key, vars);
  }

  private async summarizeActivePage(userAsk?: string, tabId?: string): Promise<string> {
    tabId = tabId || this.agentTabId || this.activeTabId;
    const ask = (userAsk || "").trim();
    const openUrl = extractFirstHttpUrl(ask);
    if (openUrl) {
      const opened = await this.navigate(openUrl, { asHuman: true, tabId });
      if (!opened.ok) return opened.message;
    }
    const page = await this.pageText(tabId);
    const text = (page.data?.text || "").trim();
    if (!text) {
      return this.L("llm.summarizeEmpty");
    }
    if (!this.deepseek) {
      return this.L("llm.needKeySummarize") + "\n\n" + text.slice(0, 1200);
    }
    try {
      const summary = await this.deepseek.completePlain(
        [
          readPageInstruction(ask),
          `${this.L("llm.pageTitle")}${this.getTitle(tabId)}`,
          `${this.L("llm.pageUrl")}${this.getUrl(tabId)}`,
          this.L("llm.pageBody"),
          text.slice(0, this.llmRuntime === "cloud" ? 3500 : 8000),
        ].join("\n"),
      );
      return summary || this.L("llm.summarizeNone");
    } catch (error) {
      return this.L("llm.summarizeFail") + (error instanceof Error ? error.message : String(error));
    }
  }

  private async previewFormFill(userText: string, tabId?: string): Promise<string> {
    // 填表是前台任务：最小化时拉回一次，人看着字段和之后的付款确认。
    this.restoreForCoPresence();
    tabId = tabId || this.agentTabId || this.activeTabId;
    const analyzed = await this.analyzePage(tabId);
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
      undefined,
      tabId,
    );
  }

  async fillSuggest(
    value: string,
    target: { ref?: string; selector?: string } = {},
  tabId?: string,
  ): Promise<ToolResult> {
    tabId = tabId || this.agentTabId || this.activeTabId;
    const blocked = this.assertNotPaused();
    if (blocked) return blocked;
    const query = value.trim();
    if (!query) return { ok: false, message: "fill_suggest 需要目的地或关键词" };
    const wc = this.viewForTab(tabId || this.activeTabId).webContents;
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
    const filled = await this.fill({ ref, selector }, query, tabId);
    if (!filled.ok) return filled;
    await sleep(800);
    const sug = (await wc.executeJavaScript(
      `(${PICK_SUGGEST_SCRIPT})(${JSON.stringify(query)})`,
      true,
    )) as { ok?: boolean; ref?: string; text?: string; message?: string };
    if (sug?.ok && sug.ref) {
      const clicked = await this.click({ ref: sug.ref }, tabId);
      return {
        ok: clicked.ok,
        message: clicked.ok
          ? `已选联想「${sug.text || query}」`
          : clicked.message,
      };
    }
    const enter = await this.pressKey("Enter", tabId);
    return {
      ok: enter.ok,
      message: `没有匹配联想，已回车。${sug?.message || ""}`.trim(),
    };
  }

  private async extractHotelLinks(city: string, tabId?: string): Promise<HotelLink[]> {
    tabId = tabId || this.agentTabId || this.activeTabId;
    const pageUrl = this.getUrl(tabId);
    if (!/hotel/i.test(pageUrl) || /\/flights?\//i.test(pageUrl)) return [];
    try {
      const raw = (await this.viewForTab(tabId || this.activeTabId).webContents.executeJavaScript(
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

  private openReportQuiet(filePath: string): void {
    try {
      this.openReport(filePath);
    } catch {
      /* 打开失败仍留侧栏卡片 */
    }
  }

  private sealResearchReport(opts: {
    title: string;
    userAsk: string;
    body: string;
    chips?: string[];
    stem?: string;
  }): { reply: string; doc?: ChatDoc } {
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const doc = writeHtmlReport(
        this.configDir(),
        `${opts.stem || "research"}-${stamp}`,
        researchReportHtml({
          title: opts.title,
          userAsk: opts.userAsk,
          body: opts.body,
          chips: opts.chips,
        }),
        { title: opts.title, kind: "research" },
      );
      this.openReportQuiet(doc.path);
      return { reply: researchChatBrief(opts.title), doc };
    } catch {
      return { reply: researchChatBrief(opts.title) };
    }
  }

  /**
   * 上一份是阅读页时，问模型这句是改写还是新任务。
   * 没模型、超时、答非所问都开单。不在原话上做改写词清单。
   */
  private async judgeReadRewrite(text: string, priorTitle: string): Promise<"rewrite" | "open"> {
    if (!this.deepseek) return "open";
    const raw = await this.withTimeout(
      this.deepseek.completePlain(rewriteVerdictPrompt(text, priorTitle)),
      12000,
      "",
      false,
    );
    return parseRewriteVerdict(raw);
  }

  /** 上一则助手消息是阅读页，且这一轮没有新引用。 */
  private priorReadPage(quotes?: SparoQuote[]): ChatTurn["doc"] | undefined {
    if (quotes?.length) return undefined;
    let skippedUser = false;
    for (let i = this.chatLog.length - 1; i >= 0; i -= 1) {
      const turn = this.chatLog[i];
      if (!skippedUser) {
        if (turn.role === "user") {
          skippedUser = true;
          continue;
        }
        return undefined;
      }
      if (turn.role === "assistant") return turn.doc?.kind === "read" ? turn.doc : undefined;
    }
    return undefined;
  }

  private readReportBody(filePath: string): string {
    if (!filePath) return "";
    try {
      const html = readFileSync(filePath, "utf8");
      const matched = html.match(/<div class="body"[^>]*>([\s\S]*?)<\/div>/);
      if (!matched) return "";
      return matched[1]
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim();
    } catch {
      return "";
    }
  }

  /** 上一份阅读页按这一句改写，落成新文件换到窗口里。没有新文件就失败。 */
  private async reviseReadPage(text: string, prior: NonNullable<ChatTurn["doc"]>): Promise<ToolResult> {
    const previous = [prior.title, this.readReportBody(prior.path)].filter(Boolean).join("\n\n");
    const prompt = [
      "你在改写上一份阅读页。按用户这句改完，输出完整中文 Markdown。",
      "第一行是「# 标题」。直接给出改写后的全文。",
      "不要写还没做的下一步，不要出现「重新生成一版」。",
      "用户认为没有依据的句子不要留在正文里。",
      previous ? `上一份正文：\n${previous.slice(0, 8000)}` : "",
      `用户这句：\n${text}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const cloudGate = await this.beginCloudTaskIfNeeded({ type: "llm", text: prompt }, text);
    if (cloudGate === "refused") {
      const reply = this.lastCloudRefuse || this.L("cloud.exhausted");
      this.chatLog.push({ role: "assistant", text: reply });
      this.pushSidebarState();
      return { ok: false, message: reply };
    }
    try {
      let reply = "";
      if (this.deepseek) {
        reply = (await this.withTimeout(this.deepseek.completePlain(prompt), 90_000, "", false)).trim();
        if (isPendingRewrite(reply)) {
          reply = (
            await this.withTimeout(
              this.deepseek.completePlain(
                `${prompt}\n\n直接输出改写后的全文。第一行必须是 # 标题。不要描述你将要做什么。`,
              ),
              90_000,
              "",
              false,
            )
          ).trim();
        }
      }
      reply = reply.replace(/\n*重新生成一版[。.]?\s*$/g, "").trim();
      if (!reply || isPendingRewrite(reply)) {
        const message = "上一份阅读页没有改写成新页。";
        this.chatLog.push({ role: "assistant", text: message });
        this.pushSidebarState();
        return { ok: false, message };
      }
      const sealed = this.sealLongRead(reply, undefined, prior.title, { force: true });
      if (!sealed.doc || sealed.doc.path === prior.path) {
        const message = "上一份阅读页没有写成新文件。";
        this.chatLog.push({ role: "assistant", text: message });
        this.pushSidebarState();
        return { ok: false, message };
      }
      this.chatLog.push({ role: "assistant", text: sealed.text, doc: sealed.doc });
      this.pushSidebarState();
      return {
        ok: true,
        message: sealed.text,
        data: { loop: "done", files: [sealed.doc.path] },
      };
    } finally {
      if (this.cloudTaskId) void this.finishCloudTask();
    }
  }

  /**
   * Sparo 的阅读优先：成篇回答不铺在侧栏，落成阅读页在窗口里打开，侧栏只留一句 + 卡片。
   * 已有产物直接放行。纠正上一份阅读页时 force 无视长短，另写新文件。
   */
  private sealLongRead(
    text: string,
    doc?: ChatTurn["doc"],
    fallbackTitle?: string,
    opts?: { force?: boolean; source?: ReadingSource; incompleteNote?: string },
  ): { text: string; doc?: ChatTurn["doc"] } {
    if (opts?.incompleteNote && doc && !opts.force) {
      return { text: `${opts.incompleteNote}\n《${doc.title}》先写了已查到的。`, doc };
    }
    if (doc && !opts?.force) {
      // 已有产物时侧栏只留一句，长文一律进产物页
      if (shouldSealLongRead(text)) {
        return { text: `《${doc.title}》已写好，在窗口里打开了。`, doc };
      }
      return { text, doc };
    }
    if (!opts?.force && !shouldSealLongRead(text)) {
      if (opts?.incompleteNote && !text.includes(opts.incompleteNote)) {
        return { text: `${opts.incompleteNote}\n${text}` };
      }
      return { text };
    }
    try {
      const title = readingTitleOf(text, fallbackTitle || "整理结果");
      const incomplete = Boolean(opts?.incompleteNote);
      const sealed = writeHtmlReport(
        this.configDir(),
        `read-${stamp()}`,
        readingReportHtml({
          title,
          body: stripReadingTitle(text),
          eyebrow: incomplete ? "未完成" : "SPARO 阅读页",
          source: opts?.source,
        }),
        { title, kind: "read" },
      );
      this.openReportQuiet(sealed.path);
      const lead = incomplete ? `${opts?.incompleteNote}\n` : "";
      const verb = incomplete ? "先写成未完成页" : "已写成阅读页";
      return { text: `${lead}《${title}》${verb}，在窗口里打开了。`, doc: sealed };
    } catch {
      return { text };
    }
  }

  /** 本地文件任务：读文件 → 模型提炼/整理 → 落 PDF/PPT/HTML/图表/填表。 */
  private async runFileTask(plan: FileTaskPlan): Promise<ToolResult> {
    const doc = readLocalDoc(plan.path);
    this.chatLog.push({ role: "assistant", text: `正在读《${doc.name}》…` });
    this.pushSidebarState();
    if (!doc.ok) {
      const text = `读不了《${doc.name}》：${doc.message || "没有可提取的文字"}`;
      this.chatLog.push({ role: "assistant", text });
      this.pushSidebarState();
      return { ok: false, message: text };
    }
    const gate = await this.beginCloudTaskIfNeeded({ type: "llm", text: plan.ask }, plan.ask);
    if (gate === "refused") {
      const text = this.lastCloudRefuse || this.L("cloud.exhausted");
      this.chatLog.push({ role: "assistant", text });
      this.pushSidebarState();
      return { ok: false, message: text };
    }
    try {
      return await this.fileTaskBody(plan, doc);
    } catch (error) {
      const text = `文件任务失败：${error instanceof Error ? error.message : String(error)}`;
      this.chatLog.push({ role: "assistant", text });
      this.pushSidebarState();
      return { ok: false, message: text };
    } finally {
      if (this.cloudTaskId) void this.finishCloudTask();
    }
  }

  private async fileTaskBody(plan: FileTaskPlan, doc: LocalDoc): Promise<ToolResult> {
    const wantForm = plan.formats.includes("form");
    const wantChart = plan.formats.includes("chart");
    const wantPpt = plan.formats.includes("pptx");
    const wantHtml = plan.formats.includes("html");
    const wantPdf = plan.formats.includes("pdf");
    const wantsDoc = wantPdf || wantHtml || wantPpt;

    const body = stripMermaid(await this.composeFileBody(plan.ask, doc, wantsDoc));
    const title = titleOfBody(body) || stemOf(doc.path);
    const bodyNoTitle = body.replace(/^#\s+.*\n+/, "").trim();
    const fileStem = `${stemOf(doc.path)}-${stamp()}`;
    const artifacts: Array<{ label: string; path: string }> = [];

    let spec: ChartSpec | null = null;
    if (wantChart) {
      spec = pickSeries(parseRows(doc.text), title) || pickSeries(parseRows(body), title);
      if (spec) {
        if (/折线|趋势|走势/.test(plan.ask)) spec.kind = "line";
        else if (/饼图|占比/.test(plan.ask)) spec.kind = "pie";
      }
    }
    const svg = spec ? chartSvg(spec) : "";
    const pageSvg = svg
      .replace(/width="\d+" height="\d+"/, 'width="100%" height="auto"')
      .replace("<svg ", '<svg style="max-width:100%;height:auto" ');

    const buildHtml = (): string => {
      let html = readingReportHtml({
        title,
        body: bodyNoTitle,
        eyebrow: "SPARO 文档整理",
      });
      if (pageSvg) {
        html = html.replace(
          "</article>",
          `<section class="body"><h2>图表</h2><div style="overflow:auto">${pageSvg}</div></section></article>`,
        );
      }
      return html;
    };

    if (wantHtml) {
      try {
        const path = writeExport(this.configDir(), fileStem, "html", buildHtml());
        artifacts.push({ label: "HTML", path });
      } catch {
        /* 写盘失败不影响其它产物 */
      }
    }
    if (wantPdf) {
      try {
        const path = join(exportsDir(this.configDir()), `${fileStem}.pdf`);
        if (await this.renderHtmlToPdf(buildHtml(), path)) artifacts.push({ label: "PDF", path });
      } catch {
        /* 打印失败就退化为 HTML */
      }
    }
    if (wantPpt) {
      try {
        const deck = slidesFromMarkdown(title, bodyNoTitle);
        const path = writeExport(this.configDir(), fileStem, "pptx", buildPptx(deck));
        artifacts.push({ label: "PPT", path });
      } catch {
        /* 生成失败就只在聊天里给正文 */
      }
    }
    if (wantChart && svg) {
      try {
        const path = join(exportsDir(this.configDir()), `${fileStem}.png`);
        const pngHtml = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#fff">${svg}</body></html>`;
        if (await this.renderHtmlToPng(pngHtml, path, 860, 460)) artifacts.push({ label: "图表", path });
      } catch {
        /* 图表截图失败就只嵌在 HTML/PDF 里 */
      }
    }

    let formReply = "";
    if (wantForm) {
      const material = doc.text.slice(0, 8000);
      formReply = await this.runLlmGoal(
        [
          "把下面这份本地资料填进当前网页表单。只填表单，不要提交、不要点发送；没把握的字段留空。",
          `用户原话：${plan.ask}`,
          `资料来自《${doc.name}》：`,
          material,
        ].join("\n\n"),
      );
    }

    const wantsFile = artifacts.length > 0;
    const lines: string[] = [];
    let sealedRead: ChatTurn["doc"] | undefined;
    if (wantForm && formReply) lines.push(formReply);
    if (wantsFile) {
      lines.push(`已读《${doc.name}》，产出：`);
      for (const a of artifacts) lines.push(`- ${a.label}：${a.path}`);
    } else if (!wantForm) {
      // 阅读优先：提炼/摘要也进阅读页，侧栏只留一句 + 卡片
      const sealed = this.sealLongRead(body, undefined, stemOf(doc.path));
      if (sealed.doc) {
        sealedRead = sealed.doc;
        lines.push(sealed.text);
      } else {
        lines.push(body);
      }
    }
    if (wantChart && !spec) {
      lines.push("");
      lines.push("这份文件里没找到可以画成图的数据列（需要两列以上：名称 + 数字）。");
    }
    const reply = lines.join("\n").trim() || "文件读完了，但没有可整理的内容。";

    const primary =
      artifacts.find((a) => a.label === "PPT") ||
      artifacts.find((a) => a.label === "PDF") ||
      artifacts.find((a) => a.label === "HTML") ||
      artifacts.find((a) => a.label === "图表") ||
      sealedRead;
    this.chatLog.push({
      role: "assistant",
      text: reply,
      doc: primary ? { title, path: primary.path, kind: "file" } : undefined,
    });
    this.pushSidebarState();
    if (primary && primary !== sealedRead) {
      if (/\.(html?|pdf|png)$/i.test(primary.path)) this.openReportQuiet(primary.path);
      else void shell.openPath(primary.path);
    }
    return {
      ok: true,
      message: reply,
      data: {
        kind: "file",
        files: [...artifacts.map((a) => a.path), ...(sealedRead ? [sealedRead.path] : [])],
      },
    };
  }

  private async composeFileBody(ask: string, doc: LocalDoc, long: boolean): Promise<string> {
    const fallback = `# ${stemOf(doc.path)}\n\n${doc.text.trim().slice(0, 6000)}`;
    if (!this.deepseek) return fallback;
    const mode = /提取|转成文字|文字版|原文|全文|逐字/.test(ask)
      ? "完整提取原文结构和内容，不要压缩掉小标题与关键段落。"
      : long
        ? "写成一份可以直接交付的整理稿：600–1500 字，分 3–8 个小节，适当用表格。"
        : "概括成 300–800 字的要点，分 3–6 个小节。";
    const prompt = [
      "你是文档整理助手。用户给了一个本地文件，并提出了要求。",
      `用户原话：${ask}`,
      `文件：${doc.name}（${doc.kind}）`,
      "输出要求：",
      "1. 只输出中文 Markdown，不要寒暄、不要说明你做了什么。",
      "2. 第一行必须是「# 标题」，标题要具体，禁止用「文档整理」这类空话。",
      "3. 需要数据时用 Markdown 表格；不要编造原文没有的数字、日期、人名。",
      "4. 保留关键事实、数字、专有名词；原文没有的结论不要硬加。",
      "5. 不要输出 mermaid、SVG 或任何图表代码，图表由系统按表格数据自动生成。",
      `6. ${mode}`,
      "文件正文：",
      "-----",
      doc.text.slice(0, 60000),
      "-----",
    ].join("\n");
    const got = await this.withTimeout(this.deepseek.completePlain(prompt), 90000, "", false);
    const clean = stripCodeFence(got);
    return clean.length > 20 ? clean : fallback;
  }

  /** 隐藏窗把 HTML 打成 PDF（中文字体由系统 Chromium 渲染，无需嵌字体）。 */
  private async renderHtmlToPdf(html: string, outPath: string): Promise<boolean> {
    const dir = exportsDir(this.configDir());
    const tmp = join(dir, `.print-${stamp()}-${randomBytes(3).toString("hex")}.html`);
    writeFileSync(tmp, html, "utf8");
    const win = new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      webPreferences: { sandbox: true, contextIsolation: true, javascript: false },
    });
    try {
      await win.loadFile(tmp);
      await sleep(180);
      const buf = await win.webContents.printToPDF({
        printBackground: true,
        pageSize: "A4",
        margins: { top: 0.6, bottom: 0.6, left: 0.55, right: 0.55 },
      });
      writeFileSync(outPath, buf);
      return buf.length > 1000;
    } catch {
      return false;
    } finally {
      try {
        win.destroy();
      } catch {
        /* ignore */
      }
      try {
        unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
  }

  private async renderHtmlToPng(
    html: string,
    outPath: string,
    width: number,
    height: number,
  ): Promise<boolean> {
    const win = new BrowserWindow({
      show: false,
      width,
      height,
      useContentSize: true,
      frame: false,
      webPreferences: { sandbox: true, contextIsolation: true, javascript: false },
    });
    try {
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      await sleep(180);
      const image = await win.webContents.capturePage({ x: 0, y: 0, width, height });
      const png = image.toPNG();
      if (!png.length) return false;
      writeFileSync(outPath, png);
      return true;
    } catch {
      return false;
    } finally {
      try {
        win.destroy();
      } catch {
        /* ignore */
      }
    }
  }

  private async polishResearchBody(userAsk: string, raw: string): Promise<string> {
    const text = String(raw || "").trim();
    if (!this.deepseek || !/陷入了重复工具调用|snapshot:|page_text:|navigate:/.test(text)) {
      return text;
    }
    if (looksLikeEatPlayAsk(userAsk) || /吃喝玩/.test(userAsk)) {
      return text;
    }
    const polished = await this.withTimeout(
      this.deepseek.completePlain(
        [
          "把下面操作记录整理成筛选报告。只根据记录里出现的商品和数字。没有的写未知。最多 5 款。有链接就写成 [名称](网址)。不要再要求继续点页面。",
          `用户原话：${userAsk}`,
          text.slice(0, 8000),
        ].join("\n"),
      ),
      15000,
      text,
    );
    return String(polished).trim() || text;
  }

  private async extract1688Offers(tabId?: string): Promise<ShopOffer[]> {
    tabId = tabId || this.agentTabId || this.activeTabId;
    try {
      const raw = (await this.viewForTab(tabId || this.activeTabId).webContents.executeJavaScript(
        `(${EXTRACT_1688_OFFERS_SCRIPT})()`,
        true,
      )) as { offers?: ShopOffer[] };
      return (raw.offers || []).filter((o) => o.name && o.url);
    } catch {
      return [];
    }
  }

  private async runShopPick(mission: Mission, userAsk: string, tabId?: string): Promise<string> {
    tabId = tabId || this.agentTabId || this.activeTabId;
    const want = Number(mission.slots.count) || 10;
    const budget = Number(mission.slots.budget) || 0;
    const collected: ShopOffer[] = [];
    const searchUrls: string[] = [];
    for (const step of mission.steps.slice(0, 4)) {
      this.chatLog.push({ role: "assistant", text: `正在查：${step.label}` });
      this.pushSidebarState();
      searchUrls.push(step.url);
      const nav = await this.withTimeout(
        this.navigate(step.url, { asHuman: true, tabId }),
        15000,
        { ok: false, message: "打开超时" },
      );
      if (!nav.ok) continue;
      await sleep(1800);
      try {
        await this.scrollTravelList(tabId);
      } catch {
        /* 继续抽当前卡片 */
      }
      await sleep(600);
      collected.push(...(await this.extract1688Offers(tabId)));
      const enough = filterShopOffers(collected, { budget, want: want + 4 });
      if (enough.length >= want) break;
    }
    const picked = filterShopOffers(collected, { budget, want });
    return formatShopPicks(picked, {
      userAsk,
      count: want,
      searchUrls,
    });
  }

  private async runMission(mission: Mission, userAsk: string, tabId?: string): Promise<string> {
    tabId = tabId || this.agentTabId || this.activeTabId;
    if (mission.kind === "sourcing" && mission.slots.intent === "buy") {
      return this.runShopPick(mission, userAsk, tabId);
    }
    const findings: Array<{ label: string; url: string; text: string }> = [];
    // 检索页是壳时，有界地打开前两条自然结果读正文（全程最多 8 个正文页，每步最多 2 个，不点进详情循环）
    let deepOpened = 0;
    const DEEP_GLOBAL_CAP = 8;
    const DEEP_PER_STEP = 2;
    for (const step of mission.steps.slice(0, 10)) {
      this.chatLog.push({ role: "assistant", text: `正在查：${step.label}` });
      this.pushSidebarState();
      if (shouldSkipHeavyPage(step.url)) {
        findings.push({
          label: step.label,
          url: step.url,
          text: "这是商城或点评首页，只记下链接，改走检索结果页。",
        });
        continue;
      }
      const nav = await this.withTimeout(
        this.navigate(step.url, { asHuman: true, tabId }),
        12000,
        { ok: false, message: "打开超时，先记下链接。" },
      );
      if (!nav.ok) {
        findings.push({ label: step.label, url: step.url, text: nav.message });
        continue;
      }
      const landed = this.getUrl(tabId) || step.url;
      if (shouldSkipHeavyPage(landed)) {
        findings.push({
          label: step.label,
          url: step.url,
          text: "落到了商城首页，改回检索链接，不读这一页。",
        });
        continue;
      }
      if (/12306\.cn\/otn\/leftTicket/.test(landed) || /12306\.cn\/otn\/leftTicket/.test(step.url)) {
        const pair = step.label.match(/([\u4e00-\u9fff]{2,8})\s*→\s*([\u4e00-\u9fff]{2,8})/);
        const date = step.url.match(/date=(\d{4}-\d{2}-\d{2})/)?.[1] || "";
        if (pair && date) {
          await this.fill12306Form({
            kind: "train",
            site: "12306",
            from: pair[1].replace(/出差/g, ""),
            to: pair[2].replace(/出差/g, ""),
            date,
          }, tabId);
        }
      }
      const isBaiduSerp = /baidu\.com\/s/.test(landed);
      if (isBaiduSerp) {
        // 百度结果页 / AI 回答卡片是流式渲染，必须等正文出来再读，否则只拿到「正在搜索」壳
        await this.waitBaiduReady(7000, tabId);
        // SERP 的广告/热榜/导航不算证据：DOM 只抽自然结果摘要，再点开前 2 篇读正文
        const items = await this.readBaiduSerp(tabId);
        if (items.length) {
          const digest = items
            .map((it) => `${it.title}\n${it.snippet}`)
            .join("\n")
            .slice(0, 6000);
          findings.push({ label: step.label, url: landed, text: digest });
          if (deepOpened < DEEP_GLOBAL_CAP) {
            const extras = await this.readBaiduOrganic(
              step.label,
              Math.min(DEEP_PER_STEP, DEEP_GLOBAL_CAP - deepOpened),
              items.map((it) => it.href),
            );
            for (const ex of extras) {
              findings.push(ex);
              deepOpened += 1;
            }
          }
          continue;
        }
        // 自然结果一条都没抽到（反爬/纯广告）→ 落回 pageText 旧路径
      } else {
        await sleep(800);
        try {
          await this.scrollTravelList(tabId);
        } catch {
          /* 滚动失败仍读当前正文 */
        }
      }
      const page = await this.withTimeout(this.pageText(tabId), 8000, {
        ok: true,
        message: "",
        data: { text: "", length: 0 },
      });
      const body = cleanSearchPageText(String(page.data?.text || "").trim());
      if (/请登录|登录后|验证码|滑块|captcha|sign in to continue/i.test(body) && body.length < 800) {
        findings.push({
          label: step.label,
          url: landed,
          text: `这一页要登录或过验证，记下链接，去下一站。\n${landed}\n${body.slice(0, 400)}`,
        });
        continue;
      }
      findings.push({
        label: step.label,
        url: landed,
        text: body.slice(0, 8000) || "这一页还没出文字，可能要登录。",
      });
      // 旧路径兜底：百度壳页正文太薄（壳页/反爬）→ 有界深读前两条自然结果
      if (isBaiduSerp && body.length < 3000 && deepOpened < DEEP_GLOBAL_CAP) {
        const extras = await this.readBaiduOrganic(
          step.label,
          Math.min(DEEP_PER_STEP, DEEP_GLOBAL_CAP - deepOpened),
        );
        for (const ex of extras) {
          findings.push(ex);
          deepOpened += 1;
        }
      }
    }
    if (this.deepseek) {
      const summary = await this.withTimeout(
        this.deepseek.completePlain(missionSynthesizePrompt(userAsk, mission, findings)),
        90000,
        "",
      );
      if (String(summary).trim()) return String(summary).trim();
    }
    // 合成失败也不堆原文：每源一句 + 链接。
    return findings
      .map((f) => `【${f.label}】\n${f.url}\n${f.text.slice(0, 200)}`)
      .join("\n\n");
  }

  /**
   * 当前页是百度检索结果时，取前 N 条自然结果（丢广告），逐条打开读正文。
   * 有界：只取 N 条，只在 runMission 的全局预算内调用，绝不递归点进二级页。
   */
  /**
   * 百度结果页 / AI 回答卡片流式渲染：轮询 #content_left 正文长度，滚一次触发懒加载。
   * 不等待会只读到「正在搜索」壳，研究报告整页变「未知」。
   */
  private async waitBaiduReady(maxMs = 7000, tabId?: string): Promise<void> {
    tabId = tabId || this.agentTabId || this.activeTabId;
    const deadline = Date.now() + maxMs;
    let len = 0;
    while (Date.now() < deadline) {
      try {
        len = (await this.viewForTab(tabId || this.activeTabId).webContents.executeJavaScript(
          `(() => { const n = document.querySelector('#content_left'); return n ? (n.innerText || '').length : 0; })()`,
        )) as number;
      } catch {
        len = 0;
      }
      if (len >= 1200) break;
      await sleep(500);
    }
    try {
      await this.viewForTab(tabId || this.activeTabId).webContents.executeJavaScript(
        `window.scrollTo(0, document.body.scrollHeight);`,
      );
      await sleep(400);
      await this.viewForTab(tabId || this.activeTabId).webContents.executeJavaScript(`window.scrollTo(0, 0);`);
      await sleep(500);
    } catch {
      /* 懒加载滚动失败不阻塞 */
    }
  }

  /**
   * 百度 SERP 的广告/热榜/导航占了正文大半，pageText 长度再长也不算证据。
   * 直接从 DOM 只抽自然结果：标题 + 摘要 + 跳转链接（丢广告/推广容器）。
   */
  private async readBaiduSerp(tabId?: string): Promise<
    Array<{ title: string; href: string; snippet: string }>
  > {
    tabId = tabId || this.agentTabId || this.activeTabId;
    try {
      const raw = (await this.viewForTab(tabId || this.activeTabId).webContents.executeJavaScript(
        `(() => {
          const nodes = document.querySelectorAll('#content_left .result, #content_left .c-container, #content_left [tpl]');
          const items = [];
          for (const n of nodes) {
            const blob = (n.innerText || '').replace(/\\s+/g, ' ').slice(0, 600);
            if (/广告|推广|品牌专区/.test(blob)) continue;
            const h3 = n.querySelector('h3');
            const a = h3 && h3.querySelector('a') ? h3.querySelector('a')
              : (n.querySelector('a[data-click]') || n.querySelector('a[href*="baidu.com/link"]'));
            if (!a || !a.href) continue;
            const title = (h3 ? (h3.innerText || '') : '').trim();
            if (!title || title.length < 4) continue;
            items.push({ title, href: a.href, snippet: blob.slice(0, 320) });
          }
          return JSON.stringify(items.slice(0, 10));
        })()`,
      )) as string;
      return JSON.parse(raw) as Array<{ title: string; href: string; snippet: string }>;
    } catch {
      return [];
    }
  }

  private async readBaiduOrganic(
    stepLabel: string,
    max: number,
    seedLinks?: string[],
  tabId?: string,
  ): Promise<Array<{ label: string; url: string; text: string }>> {
    tabId = tabId || this.agentTabId || this.activeTabId;
    if (max <= 0) return [];
    let links: string[] = seedLinks ? [...seedLinks] : [];
    if (!links.length) {
      try {
        links = (await this.viewForTab(tabId || this.activeTabId).webContents.executeJavaScript(
          `(() => {
            const out = [];
            const nodes = document.querySelectorAll('#content_left .result, #content_left .c-container, #content_left [tpl]');
            for (const n of nodes) {
              const blob = (n.innerText || '').slice(0, 300);
              if (/广告|推广/.test(blob)) continue;
              const a = n.querySelector('h3 a') || n.querySelector('a[data-click]') || n.querySelector('a[href*="baidu.com/link"]');
              const href = a && a.href;
              if (!href) continue;
              if (/baidu\\.com\\/link\\?url=/.test(href)) {
                out.push(href);
              } else if (/^https?:\\/\\//.test(href)) {
                // 新版结果有的直接出原文直链：收非百度域，丢静态资源/聚合页
                const host = new URL(href).hostname;
                if (!/(^|\\.)baidu\\.com$/.test(host) && !/bdstatic|baidubcs|baidubox|iqiyi\\.com|qq\\.com\\/$/.test(host)) out.push(href);
              }
            }
            return Array.from(new Set(out)).slice(0, ${max});
          })()`,
        )) as string[];
      } catch {
        return [];
      }
    }
    const out: Array<{ label: string; url: string; text: string }> = [];
    for (const link of links.slice(0, max)) {
      const nav = await this.withTimeout(
        this.navigate(link, { asHuman: true, tabId }),
        12000,
        { ok: false, message: "正文打开超时。" },
      );
      if (!nav.ok) continue;
      const url = this.getUrl(tabId) || link;
      if (shouldSkipHeavyPage(url) || /baidu\.com\/s/.test(url)) continue;
      await sleep(700);
      const page = await this.withTimeout(this.pageText(tabId), 8000, {
        ok: true,
        message: "",
        data: { text: "", length: 0 },
      });
      const body = cleanSearchPageText(String(page.data?.text || "").trim());
      if (body.length >= 300 && !/请登录|验证码|滑块/i.test(body.slice(0, 400))) {
        out.push({ label: `${stepLabel} · 正文`, url, text: body.slice(0, 5000) });
      }
    }
    return out;
  }

  private async withTimeout<T>(
    work: Promise<T>,
    ms: number,
    fallback: T,
    abortPage = true,
  ): Promise<T> {
    let settled = false;
    const timeout = new Promise<T>((resolve) => {
      setTimeout(() => {
        if (settled) return;
        if (abortPage) {
          try {
            this.viewForTab(this.agentTabId || this.activeTabId).webContents.stop();
          } catch {
            /* 停加载失败仍返回兜底，避免整窗挂死 */
          }
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
  tabId?: string,
  ): Promise<{ text: string; hotels: HotelLink[]; flights: FlightLink[] }> {
    tabId = tabId || this.agentTabId || this.activeTabId;
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
    // 美食/路线检索遇到百度壳页时有界深读：每步 1 篇正文，全程最多 4 篇
    let deepOpened = 0;
    for (const [si, step] of steps.entries()) {
      const t0 = Date.now();
      this.chatLog.push({ role: "assistant", text: `正在查：${step.label}` });
      this.pushSidebarState();
      let note = await this.runTravelSearch(step.query, { raw: true, tabId });
      const pageUrl = this.getUrl(tabId);
      if (step.query.kind === "hotel") {
        const city = step.query.city;
        await this.scrollTravelList(tabId);
        await sleep(400);
        const links = await this.extractHotelLinks(city, tabId);
        hotels.push(...links);
        const extra = formatHotelLinks(links);
        if (extra) note = `${note}\n\n${extra}`;
      } else if (step.query.kind === "train" && /^https?:/i.test(pageUrl)) {
        // 火车搜索结果：直接读页，note 已有 pageText
      } else if (step.query.kind === "search" && /^https?:/i.test(pageUrl)) {
        // 百度搜索结果：SERP 广告/热榜不是证据，DOM 只抽自然结果摘要补进 note
        if (/baidu\.com\/s/.test(pageUrl)) {
          const items = await this.readBaiduSerp(tabId);
          if (items.length) {
            const digest = items.map((it) => `${it.title}\n${it.snippet}`).join("\n").slice(0, 5000);
            note = `${note}\n\n${digest}`;
            // 有界补 1 篇正文，用已抽到的自然链接，不重新点广告页
            if (deepOpened < 4) {
              const extras = await this.readBaiduOrganic(step.label, 1, items.map((it) => it.href));
              for (const ex of extras) {
                findings.push(ex);
                deepOpened += 1;
              }
            }
          }
        }
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
      // 美食/路线百度壳页：有界补 1 篇正文，让餐厅/路线有真名实据
      if (
        step.query.kind === "search" &&
        /baidu\.com\/s/.test(pageUrl) &&
        note.length < 3000 &&
        deepOpened < 4
      ) {
        const extras = await this.readBaiduOrganic(step.label, 1);
        for (const ex of extras) {
          findings.push(ex);
          deepOpened += 1;
        }
      }
    }
    for (const extra of plan.extras || []) {
      this.chatLog.push({ role: "assistant", text: `正在查：${extra.label}` });
      this.pushSidebarState();
      const nav = await this.withTimeout(
        this.navigate(extra.url, { asHuman: true, tabId }),
        12000,
        { ok: false, message: "打开超时，先记下链接。" },
      );
      let note = nav.ok ? "" : nav.message;
      if (nav.ok) {
        const page = await this.withTimeout(this.pageText(tabId), 8000, {
          ok: true,
          message: "",
          data: { text: "", length: 0 },
        });
        note = String(page.data?.text || "").slice(0, 8000) || "这一页还没出文字。";
      }
      findings.push({ label: extra.label, url: this.getUrl(tabId) || extra.url, text: note });
    }
    if (this.deepseek) {
      const prompt = tripSynthesizePrompt(userAsk, plan, findings);
      const ts0 = Date.now();
      const summary = await this.withTimeout(
        this.deepseek.completePlain(prompt),
        120_000,
        "",
      );
      if (summary.trim()) return { text: summary.trim(), hotels, flights };
    }
    return {
      text: findings.map((f) => `【${f.label}】\n${f.url}\n${f.text}`).join("\n\n"),
      hotels,
      flights,
    };
  }

  private async scrollTravelList(tabId?: string): Promise<void> {
    tabId = tabId || this.agentTabId || this.activeTabId;
    try {
      await this.viewForTab(tabId || this.activeTabId).webContents.executeJavaScript(
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

  private async fill12306Form(q: Extract<TravelQuery, { kind: "train" }>, tabId?: string): Promise<void> {
    tabId = tabId || this.agentTabId || this.activeTabId;
    const fromCode = trainStationCode(q.from);
    const toCode = trainStationCode(q.to);
    if (!fromCode || !toCode) return;
    const fromName = q.from.replace(/出差.*$/, "").slice(0, 8);
    const toName = q.to.replace(/出差.*$/, "").slice(0, 8);
    try {
      await this.viewForTab(tabId || this.activeTabId).webContents.executeJavaScript(
        `(${FILL_12306_SCRIPT})(${JSON.stringify(fromName)},${JSON.stringify(fromCode)},${JSON.stringify(toName)},${JSON.stringify(toCode)},${JSON.stringify(q.date)})`,
        true,
      );
      await sleep(800);
    } catch {
      /* 填不上就读当前页 */
    }
  }

  private async waitTravelText(q: TravelQuery, ms = 6000, tabId?: string): Promise<string> {
    tabId = tabId || this.agentTabId || this.activeTabId;
    const started = Date.now();
    let last = "";
    while (Date.now() - started < ms) {
      await this.scrollTravelList(tabId);
      await sleep(450);
      const page = await this.pageText(tabId);
      last = (page.data?.text || "").trim();
      const here = this.getUrl(tabId);
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
    opts: { raw?: boolean; tabId?: string } = {},
  ): Promise<string> {
    const tabId = opts.tabId || this.agentTabId || this.activeTabId;
    try {
      let url = travelResultUrl(q);
      if (q.kind === "hotel" && q.site === "ctrip") {
        const resolved = await resolveCtripHotelCity(q.city);
        if (!resolved) {
          return `找不到「${q.city}」对应的携程城市，请换个地名再试。`;
        }
        url = ctripHotelListUrl(resolved.cityId, q.checkin, q.checkout, {
          keyword: q.area,
          priceMin: q.priceMin,
          priceMax: q.priceMax,
        });
      }
      if (!url) {
        return q.kind === "flight"
          ? "出发地或到达地还不是城，没法打开机票页。"
          : "还不知道怎么打开这一页，请换个站点名再试。";
      }
      const nav = await this.navigate(url, { asHuman: true, tabId });
      if (!nav.ok) {
        if (q.kind === "hotel") {
          const retry = await this.navigate(url, { asHuman: true, tabId });
          if (!retry.ok) return retry.message;
        } else {
          return nav.message;
        }
      }
      if (q.kind === "train" && q.site === "12306") {
        await this.fill12306Form(q, tabId);
      }
      if (q.kind === "search" && /baidu\.com\/s/.test(this.getUrl(tabId))) {
        await this.waitBaiduReady(7000, tabId);
      }
      await sleep(opts.raw ? 800 : 1400);
      let text = await this.waitTravelText(q, opts.raw ? 5000 : 7000, tabId);
      let promptQ = q;
      const here = this.getUrl(tabId);
      const alreadyList = q.kind === "flight" && isFlightResultUrl(here);
      if (
        q.kind === "flight" &&
        !alreadyList &&
        shouldFallbackFlight(text, q.site, here)
      ) {
        const fbUrl = flightFallbackUrl(q);
        this.chatLog.push({
          role: "assistant",
          text: "机票列表没读全，改去 Kayak 再查…",
        });
        this.pushSidebarState();
        const nav2 = await this.navigate(fbUrl, { asHuman: true, tabId });
        if (nav2.ok) {
          await sleep(1000);
          const alt = await this.waitTravelText(q, 7000, tabId);
          const altState = travelListState("flight", alt);
          if (altState === "ready" || alt.length > text.length + 200) {
            text = alt;
            promptQ = { ...q, site: "kayak" };
          }
        }
      }
      if (
        q.kind === "train" &&
        q.site !== "12306" &&
        shouldFallbackTrain(text, q.site)
      ) {
        const fbUrl = trainFallbackUrl(q);
        this.chatLog.push({
          role: "assistant",
          text: "火车列表没读全，改去 12306 再查…",
        });
        this.pushSidebarState();
        const nav2 = await this.navigate(fbUrl, { asHuman: true, tabId });
        if (nav2.ok) {
          await sleep(1000);
          const alt = await this.waitTravelText(q, 7000, tabId);
          if (travelListState("train", alt) === "ready" || alt.length > text.length + 200) {
            text = alt;
            promptQ = { ...q, site: "12306" };
          }
        }
      }
      if (/验证码|滑块|captcha|人机验证|请登录|sign in to continue/i.test(text) && text.length < 400) {
        return `已打开目标页，但被登录或验证码挡住了。请你在窗口里过后说「继续」。\n${this.getUrl(tabId)}`;
      }
      const body = text.slice(0, 12000);
      if (!body) {
        return `已打开 ${this.getUrl(tabId)}，页面还没出文字。可能要登录或过一下验证。`;
      }
      let extra = "";
      if (q.kind === "hotel") {
        try {
          await this.scrollTravelList(tabId);
          const links = await this.extractHotelLinks(q.city, tabId);
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
          [travelReadPrompt(promptQ), `当前网址：${this.getUrl(tabId)}`, extra, body].join("\n"),
        );
        if (summary.trim()) return extra ? `${summary.trim()}\n\n${extra}` : summary.trim();
      }
      return `已打开结果页：${this.getUrl(tabId)}\n\n${body.slice(0, 900)}${extra ? `\n\n${extra}` : ""}`;
    } catch (error) {
      return "查询失败：" + (error instanceof Error ? error.message : String(error));
    }
  }

  private async runLlmGoal(text: string, images?: string[], tabId?: string): Promise<string> {
    tabId = tabId || this.agentTabId || this.activeTabId;
    if (!this.deepseek) {
      return this.L("llm.needKey");
    }
    try {
      const url = this.getUrl(tabId);
      this.skillsCache = listSkills(this.configDir());
      const catalog = skillCatalogLines(this.configDir());
      const quoteOnly = text.startsWith(QUOTE_PAGE_CONTRACT);
      const history = quoteOnly
        ? []
        : this.chatLog
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
      let visible = "";
      if (!quoteOnly) {
        const page = await this.pageText(tabId);
        visible = (page.data?.text || "").trim().slice(0, this.llmRuntime === "cloud" ? 3000 : 6000);
      }
      const reply = await this.deepseek.chat(text, {
        url,
        title: quoteOnly ? "" : this.getTitle(tabId),
        skills: catalog,
        history,
        profileBrief: profileBriefFor(this.configDir()),
        locale: this.settings.locale,
        pageText: visible,
        images,
      });
      const mutations = this.deepseek.takeMutations();
      // 大脑自由发挥成功了 → 把这次做法沉淀成新技能，下次直接调用。
      const skill = await distillSkillFromTrace({
        configDir: this.configDir(),
        goal: text,
        url: this.getUrl(tabId),
        reply,
        mutations,
        complete: (p) => this.deepseek!.completePlain(p),
      });
      if (skill) {
        this.skillsCache = listSkills(this.configDir());
        this.pushSidebarState();
        return `${reply}\n\n这次的做法已记成「${skill.title}」，下次直接说就照做。`;
      }
      return reply;
    } catch (error) {
      return this.L("llm.callFail") + (error instanceof Error ? error.message : String(error));
    }
  }

  private async probe(tabId?: string): Promise<{ url: string; title: string; bodyLen: number }> {
    const wc = this.viewForTab(tabId || this.activeTabId).webContents;
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
  async pageText(tabId?: string): Promise<ToolResult & { data?: { text: string; length: number } }> {
    try {
      const wc = this.viewForTab(tabId || this.activeTabId).webContents;
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
    opts?: { frame?: number | string; tabId?: string },
  ): Promise<ToolResult & { data?: { result: unknown; error?: string } }> {
    const tabId = opts?.tabId;
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
        const wc = this.viewForTab(tabId || this.activeTabId).webContents;
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
      const data = (await this.viewForTab(tabId || this.activeTabId).webContents.executeJavaScript(
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
  tabId?: string,
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
      const wc = this.viewForTab(tabId || this.activeTabId).webContents;
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
        await this.trustedClickAt(opened.openPoint.x, opened.openPoint.y, { tabId });
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

      await this.trustedClickAt(opt.x, opt.y, { tabId });
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
  tabId?: string,
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

    const wc = this.viewForTab(tabId || this.activeTabId).webContents;
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
    tabId?: string;
    },
  ): Promise<void> {
    const tabId = opts?.tabId;
    const wc = this.viewForTab(tabId || this.activeTabId).webContents;
    this.focusPageForInput(wc);
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
    opts?: { exact?: boolean; withinPortal?: boolean; caret?: boolean; tabId?: string },
  ): Promise<ToolResult> {
    const tabId = opts?.tabId;
    const blocked = this.assertNotPaused();
    if (blocked) return blocked;
    try {
      const wc = this.viewForTab(tabId || this.activeTabId).webContents;
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
      await this.trustedClickAt(x, y, { hoverOnly: true, tabId });
      await sleep(60);
      await this.trustedClickAt(x, y, { tabId });
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
  async menuClick(trigger: string, item: string, tabId?: string): Promise<ToolResult> {
    const blocked = this.assertNotPaused();
    if (blocked) return blocked;
    const open = await this.clickText(trigger, { exact: false, tabId });
    if (!open.ok) {
      return {
        ok: false,
        message: `menu trigger failed: ${open.message}`,
        data: open.data,
      };
    }

    const wc = this.viewForTab(tabId || this.activeTabId).webContents;
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

  async dismissOverlays(tabId?: string): Promise<ToolResult> {
    try {
      const data = await this.viewForTab(tabId || this.activeTabId).webContents.executeJavaScript(
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

  async listPortals(tabId?: string): Promise<ToolResult> {
    try {
      const data = await this.viewForTab(tabId || this.activeTabId).webContents.executeJavaScript(
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
    tabId?: string;
  }): Promise<ToolResult> {
    const tabId = input.tabId;
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
    const wc = this.viewForTab(tabId || this.activeTabId).webContents;
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
      const clk = await this.click({ ref: input.triggerRef }, tabId);
      if (!clk.ok) {
        return { ok: false, message: `could not open date picker: ${clk.message}` };
      }
    } else {
      const label = input.triggerText || input.triggerLabel || "Run indefinitely";
      let clk = await this.clickText(label, { exact: false, tabId });
      if (!clk.ok && label !== "Run indefinitely") {
        clk = await this.clickText("Run indefinitely", { exact: false, tabId });
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
      await this.trustedClickAt(Math.round(nav.x), Math.round(nav.y), { hoverOnly: true, tabId });
      await sleep(40);
      await this.trustedClickAt(Math.round(nav.x), Math.round(nav.y), { tabId });
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
    await this.trustedClickAt(Math.round(state.day.x), Math.round(state.day.y), { hoverOnly: true, tabId });
    await sleep(40);
    await this.trustedClickAt(Math.round(state.day.x), Math.round(state.day.y), { tabId });
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
      await this.trustedClickAt(Math.round(state.outside.x), Math.round(state.outside.y), { tabId });
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
  async xhsScrollBottom(tabId?: string): Promise<ToolResult> {
    try {
      const data = await this.viewForTab(tabId || this.activeTabId).webContents.executeJavaScript(
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
  async xhsAddTopics(topics: string[], tabId?: string): Promise<ToolResult> {
    try {
      const run = this.viewForTab(tabId || this.activeTabId).webContents.executeJavaScript(
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
  async xhsPageStage(tabId?: string): Promise<ToolResult> {
    try {
      const data = await this.viewForTab(tabId || this.activeTabId).webContents.executeJavaScript(
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
  }, tabId?: string): Promise<ToolResult> {
    try {
      let title = input.title || "";
      let body = input.body || "";
      if ((!title || !body) && input) {
        /* keep empty — skill runner fills from params/md */
      }
      const run = this.viewForTab(tabId || this.activeTabId).webContents.executeJavaScript(
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
  }, tabId?: string): Promise<ToolResult> {
    try {
      const run = this.viewForTab(tabId || this.activeTabId).webContents.executeJavaScript(
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
  }, tabId?: string): Promise<ToolResult> {
    try {
      const data = (await this.viewForTab(tabId || this.activeTabId).webContents.executeJavaScript(
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

  async xhsPickCover(tabId?: string): Promise<ToolResult> {
    try {
      const data = (await this.viewForTab(tabId || this.activeTabId).webContents.executeJavaScript(
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
  async xhsClickPublish(tabId?: string): Promise<ToolResult> {
    try {
      const data = (await this.viewForTab(tabId || this.activeTabId).webContents.executeJavaScript(
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
  async xhsEnsureEditor(tabId?: string): Promise<ToolResult> {
    try {
      const data = (await this.viewForTab(tabId || this.activeTabId).webContents.executeJavaScript(
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

  async feishuPageStage(tabId?: string): Promise<ToolResult> {
    try {
      const data = await this.viewForTab(tabId || this.activeTabId).webContents.executeJavaScript(
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

  async feishuOpenChat(input: { to?: string }, tabId?: string): Promise<ToolResult> {
    const to = String(input.to || "").trim();
    if (!to) return { ok: false, message: "缺少联系人" };
    try {
      const data = (await Promise.race([
        this.viewForTab(tabId || this.activeTabId).webContents.executeJavaScript(
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
  }, tabId?: string): Promise<ToolResult> {
    const title = String(input.title || "");
    const body = String(input.body || "");
    if (!title && !body) return { ok: false, message: "没有可写入的正文" };
    try {
      const data = (await Promise.race([
        this.viewForTab(tabId || this.activeTabId).webContents.executeJavaScript(
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

  async screenshot(labelOrOpts?: string | ScreenshotOpts): Promise<ToolResult> {
    try {
      const opts = parseScreenshotInput(labelOrOpts);
      const format = opts.format === "jpeg" ? "jpeg" : "png";
      const quality = Math.min(100, Math.max(30, Number(opts.quality) || 80));
      const wc = this.viewForTab(this.activeTabId).webContents;
      let clip = validClip(opts.clip);
      if (opts.selector && !clip) {
        const rect = (await wc.executeJavaScript(
          `(() => {
            const el = document.querySelector(${JSON.stringify(opts.selector)});
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          })()`,
          true,
        )) as ScreenshotOpts["clip"] | null;
        clip = validClip(rect || undefined);
        if (!clip) return { ok: false, message: `找不到元素：${opts.selector}` };
      }
      let png: Buffer;
      let jpeg: Buffer | undefined;
      if (opts.fullPage) {
        const grabbed = await this.captureFullPage(format, quality);
        if (!grabbed || !isUsableCaptureBuffer(grabbed.png || grabbed.jpeg)) {
          return { ok: false, message: this.L("shot.empty") };
        }
        png = grabbed.png;
        jpeg = grabbed.jpeg;
      } else {
        const img = await this.captureVisiblePage(wc, clip);
        if (!img) return { ok: false, message: this.L("shot.hidden") };
        png = img.toPNG();
        jpeg = format === "jpeg" ? img.toJPEG(quality) : undefined;
      }
      const buf = format === "jpeg" && jpeg ? jpeg : png;
      if (!isUsableCaptureBuffer(buf)) {
        return { ok: false, message: this.L("shot.empty") };
      }
      const dir = join(this.configDir(), "diag");
      mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const safe = String(opts.label || "shot")
        .replace(/[\\/:*?"<>|]/g, "_")
        .slice(0, 40);
      const ext = format === "jpeg" ? "jpg" : "png";
      const file = join(dir, `${safe}-${stamp}.${ext}`);
      writeFileSync(file, buf);
      const data: Record<string, unknown> = {
        file,
        url: this.getUrl(),
        title: this.getTitle(),
        format,
      };
      if (opts.includeBase64) {
        data.base64 = buf.toString("base64");
        data.mime = format === "jpeg" ? "image/jpeg" : "image/png";
      }
      return { ok: true, message: `screenshot saved`, data };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private ensureWindowVisibleForCapture(): void {
    if (this.window.isDestroyed()) return;
    // 任务截图不再 restore / show。最小化时抢焦点会把窗口弹回用户面前。
    if (this.window.isMinimized()) return;
    this.layout();
  }

  private async captureVisiblePage(
    wc: Electron.WebContents,
    clip?: { x: number; y: number; width: number; height: number } | null,
  ): Promise<Electron.NativeImage | null> {
    const grab = () => (clip ? wc.capturePage(clip) : wc.capturePage());
    const usable = (img: Electron.NativeImage) => {
      if (!img || img.isEmpty()) return false;
      const size = img.getSize();
      return size.width > 1 && size.height > 1 && isUsableCaptureBuffer(img.toPNG());
    };
    try {
      let img = await grab();
      if (usable(img)) return img;
      this.ensureWindowVisibleForCapture();
      await new Promise((resolve) => setTimeout(resolve, 80));
      img = await grab();
      return usable(img) ? img : null;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (/display surface|not available for capture/i.test(msg)) {
        this.ensureWindowVisibleForCapture();
        await new Promise((resolve) => setTimeout(resolve, 80));
        try {
          const retry = await grab();
          return usable(retry) ? retry : null;
        } catch {
          return null;
        }
      }
      throw error;
    }
  }

  private async captureFullPage(
    format: "png" | "jpeg",
    quality: number,
  ): Promise<{ png: Buffer; jpeg?: Buffer } | null> {
    const wc = this.viewForTab(this.activeTabId).webContents;
    try {
      const dbg = wc.debugger;
      if (!dbg.isAttached()) await dbg.attach("1.3");
      const raw = (await dbg.sendCommand("Page.captureScreenshot", {
        format: format === "jpeg" ? "jpeg" : "png",
        quality: format === "jpeg" ? quality : undefined,
        captureBeyondViewport: true,
      })) as { data?: string };
      if (!raw?.data) return null;
      const buf = Buffer.from(raw.data, "base64");
      return format === "jpeg" ? { png: buf, jpeg: buf } : { png: buf };
    } catch {
      try {
        const img = await wc.capturePage();
        return { png: img.toPNG(), jpeg: img.toJPEG(quality) };
      } catch {
        return null;
      }
    }
  }

  async describePage(question?: string): Promise<ToolResult> {
    const shot = await this.screenshot({
      includeBase64: true,
      format: "jpeg",
      quality: 70,
      label: "describe",
    });
    const b64 = (shot.data as { base64?: string } | undefined)?.base64;
    if (!shot.ok || !b64) {
      return { ok: false, message: shot.message || this.L("shot.empty") };
    }
    if (!this.deepseek) return { ok: false, message: this.L("llm.needKey") };
    const ask =
      String(question || "").trim() ||
      "请看这张网页截图，用中文描述主要内容、布局和关键信息。看不见的不要编。";
    let openedCloud = false;
    if (this.llmRuntime === "cloud") {
      const gate = await this.beginCloudTaskIfNeeded({ type: "llm", text: ask }, ask);
      if (gate === "refused") {
        return { ok: false, message: this.lastCloudRefuse || this.L("cloud.exhausted") };
      }
      openedCloud = gate === "ok";
    }
    try {
      const text = await this.deepseek.chat(ask, {
        url: this.getUrl(),
        title: this.getTitle(),
        locale: this.settings.locale,
        images: [`data:image/jpeg;base64,${b64}`],
      });
      return { ok: true, message: text };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      if (openedCloud) void this.finishCloudTask();
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
      const data = await this.viewForTab(this.activeTabId).webContents.executeJavaScript(
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
        data = (await this.viewForTab(this.activeTabId).webContents.executeJavaScript(
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
    opts?: { asHuman?: boolean; tabId?: string },
  ): Promise<NavigateConfirm | ToolResult> {
    const tabId = opts?.tabId;
    if (!opts?.asHuman) {
      const blocked = this.assertNotPaused();
      if (blocked) return blocked;
    }

    const target = normalizeUrl(url);
    if (!target || target === DEFAULT_URL && !url.trim()) {
      return { ok: false, message: "navigate requires url" };
    }

    const started = Date.now();
    const wc = this.viewForTab(tabId || this.activeTabId).webContents;

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

      try {
        if (wc.isLoading()) wc.stop();
      } catch {
        /* 停不下也继续 load */
      }
      try {
        await wc.loadURL(target);
      } catch {
        await sleep(250);
        await wc.loadURL(target);
      }

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

      const probe = await this.probe(tabId);
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
      const probe = await this.probe(tabId).catch(() => ({
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

  async snapshot(selector?: string, tabId?: string): Promise<ToolResult & { data?: PageSnapshot }> {
    try {
      const wc = this.viewForTab(tabId || this.activeTabId).webContents;
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
  }, tabId?: string): Promise<ClickConfirm | ToolResult> {
    const blocked = this.assertNotPaused();
    if (blocked) return blocked;
    if (!target.ref && !target.selector) {
      return { ok: false, message: "click requires ref or selector" };
    }

    try {
      const before = await this.probe(tabId);
      const wc = this.viewForTab(tabId || this.activeTabId).webContents;

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
      await this.trustedClickAt(x, y, { hoverOnly: true, tabId });
      await sleep(80);
      await this.trustedClickAt(x, y, { tabId });

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
        after = await this.probe(tabId);
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
      after = await this.probe(tabId);

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
  tabId?: string,
  ): Promise<FillConfirm | ToolResult> {
    const blocked = this.assertNotPaused();
    if (blocked) return blocked;
    if (!target.ref && !target.selector) {
      return { ok: false, message: "fill requires ref or selector" };
    }

    const FIX = "fill-unicode-v2";

    try {
      const wc = this.viewForTab(tabId || this.activeTabId).webContents;

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
              { tabId },
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
        await this.insertTextUnicode(value, tabId);
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
  private async insertTextUnicode(text: string, tabId?: string): Promise<void> {
    const wc = this.viewForTab(tabId || this.activeTabId).webContents;
    this.focusPageForInput(wc);
    await withDebugger(wc, async (send) => {
      await send("Input.insertText", { text });
    });
  }

  /** Send a single key (Enter/Escape/…) via trusted keyboard events. */
  async pressKey(key: string, tabId?: string): Promise<ToolResult> {
    const blocked = this.assertNotPaused();
    if (blocked) return blocked;
    try {
      const wc = this.viewForTab(tabId || this.activeTabId).webContents;
      this.focusPageForInput(wc);
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
  private async typeWithKeyboard(value: string, tabId?: string): Promise<void> {
    // Prefer CDP Input.insertText for Unicode (Chinese). Per-char sendInputEvent
    // has caused Mojibake on some Windows/Electron paths.
    if (/[^\u0000-\u007f]/.test(value)) {
      await this.insertTextUnicode(value, tabId);
      return;
    }
    const wc = this.viewForTab(tabId || this.activeTabId).webContents;
    this.focusPageForInput(wc);

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

  async reload(opts?: { asHuman?: boolean; ignoreCache?: boolean; tabId?: string }): Promise<ToolResult> {
    const tabId = opts?.tabId;
    if (!opts?.asHuman) {
      const blocked = this.assertNotPaused();
      if (blocked) return blocked;
    }
    if (opts?.ignoreCache) this.viewForTab(tabId || this.activeTabId).webContents.reloadIgnoringCache();
    else this.viewForTab(tabId || this.activeTabId).webContents.reload();
    this.lastSnapshot = null;
    if (!opts?.asHuman) await sleep(800);
    const probe = await this.probe(tabId);
    this.pushStatus();
    this.pushChromeState();
    return {
      ok: true,
      message: `Reloaded → ${probe.url}`,
      data: probe,
    };
  }

  async goBack(opts?: { asHuman?: boolean; tabId?: string }): Promise<ToolResult> {
    const tabId = opts?.tabId;
    if (!opts?.asHuman) {
      const blocked = this.assertNotPaused();
      if (blocked) return blocked;
    }
    if (!this.navCanGoBack(this.viewForTab(tabId || this.activeTabId).webContents)) {
      return { ok: false, message: "Cannot go back" };
    }
    const before = await this.probe(tabId);
    this.viewForTab(tabId || this.activeTabId).webContents.goBack();
    this.lastSnapshot = null;
    if (!opts?.asHuman) await sleep(800);
    const after = await this.probe(tabId);
    this.pushStatus();
    this.pushChromeState();
    return {
      ok: after.url !== before.url,
      message: `Back → ${after.url}`,
      data: { before, after },
    };
  }

  async goForward(opts?: { asHuman?: boolean; tabId?: string }): Promise<ToolResult> {
    const tabId = opts?.tabId;
    if (!opts?.asHuman) {
      const blocked = this.assertNotPaused();
      if (blocked) return blocked;
    }
    if (!this.navCanGoForward(this.viewForTab(tabId || this.activeTabId).webContents)) {
      return { ok: false, message: "Cannot go forward" };
    }
    const before = await this.probe(tabId);
    this.viewForTab(tabId || this.activeTabId).webContents.goForward();
    this.lastSnapshot = null;
    if (!opts?.asHuman) await sleep(800);
    const after = await this.probe(tabId);
    this.pushStatus();
    this.pushChromeState();
    return {
      ok: after.url !== before.url,
      message: `Forward → ${after.url}`,
      data: { before, after },
    };
  }

  getUrl(tabId?: string): string {
    const tab = tabId ? (this.tabs.get(tabId) ?? null) : this.getActiveTab();
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

  getTitle(tabId?: string): string {
    const tab = tabId ? (this.tabs.get(tabId) ?? null) : this.getActiveTab();
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
