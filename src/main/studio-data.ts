/**
 * 工作台首页和数据页的本地快照服务。
 * 读取、刷新、采集都要带 envId。对不上环境的行不进视图，也不回退到默认登录。
 */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { HomePageModel, HomeAttention } from "../renderer/studio/pages/home.js";
import type {
  CompareRow,
  ExceptionRow,
  MetricsPageModel,
  RankRow,
  RevenueRow,
  TrendPoint,
} from "../renderer/studio/pages/metrics.js";
import { resolveStudioEnv } from "./studio-env.js";
import type { AccountState, Completeness, DisplayState, MetricFact, UserTaskStage } from "../renderer/studio/types.js";

export type MetricRow = {
  platform?: string;
  accountId?: string;
  date?: string;
  articleId?: string;
  title?: string;
  impressions?: number | null;
  reads?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  collects?: number | null;
  follows?: number | null;
  revenue?: number | null;
  revenueAd?: number | null;
  revenueActivity?: number | null;
  revenueSubsidy?: number | null;
  capturedAt?: string;
  completeness?: string;
  reason?: string;
  publishedAt?: string;
  state?: string;
  classify?: string;
  envId?: string;
};

export type TaskSnapshot = {
  title: string;
  platform: string;
  stage: UserTaskStage | "";
  updatedAt: string;
  jobId?: string;
};

export type CommentSnapshot = {
  platform: string;
  author: string;
  summary: string;
  createdAt: string;
};

export type AccountSnapshot = {
  platform: string;
  state: AccountState;
  detail?: string;
};

export type CollectProgress = {
  envId: string;
  platform: string;
  index: number;
  total: number;
  phase: "start" | "done" | "skip";
  completeness?: string;
  message?: string;
};

type CollectResult = {
  ok: boolean;
  code: string;
  message: string;
  envId: string;
  written?: Array<Record<string, unknown>>;
};

type MetricsModule = {
  listMetrics: (file?: string) => Promise<MetricRow[]>;
};

export type StudioDataOk = {
  ok: true;
  code: "ok";
  message: string;
  envId: string;
  home: HomePageModel;
  metrics: MetricsPageModel;
  unlinked: number;
  kept: boolean;
  progress: CollectProgress[];
};

export type StudioDataStop = {
  ok: false;
  code: string;
  message: string;
  envId: string;
  home?: HomePageModel;
  metrics?: MetricsPageModel;
  unlinked: number;
  kept: boolean;
  progress: CollectProgress[];
};

export type StudioDataResult = StudioDataOk | StudioDataStop;

const NAMES: Record<string, string> = {
  toutiao: "头条号",
  baijiahao: "百家号",
  dayu: "大鱼号",
  sohu: "搜狐号",
};

const ATTENTION_STAGES = new Set<UserTaskStage>(["发布失败", "需要人工", "结果待核验", "等待确认"]);
const STATE_RANK: Record<string, number> = {
  login_missing: 70,
  error: 60,
  stale: 50,
  missing: 40,
  unknown: 30,
  partial: 20,
  unsupported: 10,
  full: 0,
};

export function accountLinkOf(accountId: string): { linked: boolean; envId: string; platformAccountId: string; label: string } {
  const matched = /^env:([^:\s]+):(.+)$/.exec(String(accountId || ""));
  if (!matched || !matched[2].trim()) return { linked: false, envId: "", platformAccountId: "", label: "未关联" };
  return { linked: true, envId: matched[1], platformAccountId: matched[2], label: "" };
}

export function partitionRows(rows: MetricRow[], envId: string): { owned: MetricRow[]; unlinked: MetricRow[]; foreign: MetricRow[] } {
  const owned: MetricRow[] = [];
  const unlinked: MetricRow[] = [];
  const foreign: MetricRow[] = [];
  for (const row of rows) {
    const link = accountLinkOf(String(row.accountId || ""));
    if (!link.linked) unlinked.push(row);
    else if (link.envId === envId) owned.push(row);
    else foreign.push(row);
  }
  return { owned, unlinked, foreign };
}

function nameOf(platform: string): string {
  return NAMES[platform] || platform || "未知平台";
}

function formatInt(value: number): string {
  const negative = value < 0;
  const digits = String(Math.trunc(Math.abs(value)));
  let out = "";
  for (let index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 === 0) out += ",";
    out += digits[index];
  }
  return (negative ? "-" : "") + out;
}

function yuanText(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  return (negative ? "-" : "") + "¥" + formatInt(Math.floor(abs / 100)) + "." + String(abs % 100).padStart(2, "0");
}

function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return date.getFullYear() + "-" + month + "-" + day;
}

function shift(date: Date, delta: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + delta);
  return next;
}

function asCompleteness(value: string | undefined): Completeness {
  if (value === "full" || value === "partial" || value === "missing" || value === "unsupported") return value;
  return "missing";
}

function numberOf(row: MetricRow, field: "reads" | "follows" | "likes" | "revenue"): number | null {
  if (row.completeness === "missing" || row.completeness === "unsupported") return null;
  const value = row[field];
  if (value == null) return null;
  return Number(value);
}

function latestStamp(rows: MetricRow[]): string {
  let best = "";
  let bestTime = -Infinity;
  for (const row of rows) {
    const text = String(row.capturedAt || "");
    const time = Date.parse(text);
    if (Number.isFinite(time) && time >= bestTime) {
      bestTime = time;
      best = text;
    } else if (!best && text) best = text;
  }
  return best;
}

function isStale(capturedAt: string | undefined, now: Date): boolean {
  const time = Date.parse(String(capturedAt || ""));
  if (!Number.isFinite(time)) return false;
  return now.getTime() - time > 36 * 60 * 60 * 1000;
}

export function classifyState(row: MetricRow, now: Date): DisplayState | Completeness {
  const reason = String(row.reason || "");
  if (reason.includes("登录")) return "login_missing";
  if (/接口|失败|错误|超时/.test(reason)) return "error";
  if (row.state === "stale" || row.state === "unknown" || row.state === "login_missing" || row.state === "error") return row.state;
  if ((row.completeness === "full" || row.completeness === "partial") && isStale(row.capturedAt, now)) return "stale";
  if (row.completeness === "unsupported") return "unsupported";
  if (row.completeness === "missing") return "missing";
  if (row.completeness === "partial") return "partial";
  if (row.completeness === "full") return "full";
  return "unknown";
}

function interactionOf(row: MetricRow): number | null {
  if (row.completeness === "missing" || row.completeness === "unsupported") return null;
  const parts = [row.likes, row.comments, row.shares, row.collects];
  if (parts.some((value) => value == null)) return null;
  let total = 0;
  for (const value of parts) total += Number(value);
  return total;
}

function fact(value: number | null, text: string, unit: string, completeness: Completeness, source: string, capturedAt: string): MetricFact | null {
  if (value == null) return null;
  return { value, text, unit, completeness, source, capturedAt };
}

function aggregate(rows: MetricRow[], field: "reads" | "follows" | "revenue"): { value: number | null; completeness: Completeness } {
  if (!rows.length) return { value: null, completeness: "missing" };
  if (rows.every((row) => row.completeness === "unsupported")) return { value: null, completeness: "unsupported" };
  const values = rows.map((row) => numberOf(row, field));
  const partial = rows.some((row) => row.completeness === "partial") || values.some((value) => value == null);
  let any = false;
  let total = 0;
  for (const value of values) {
    if (value == null) continue;
    any = true;
    total += value;
  }
  if (!any) return { value: null, completeness: rows.some((row) => row.completeness === "partial") ? "partial" : "missing" };
  return { value: total, completeness: partial ? "partial" : "full" };
}

function deltaText(rows: MetricRow[]): string {
  if (rows.some((row) => row.completeness === "partial")) return "";
  const byDate = new Map<string, number | null>();
  for (const row of rows) {
    if (!row.date || row.articleId) continue;
    const value = numberOf(row, "reads");
    if (value == null || (byDate.has(row.date) && byDate.get(row.date) == null)) {
      byDate.set(row.date, null);
      continue;
    }
    byDate.set(row.date, (byDate.get(row.date) ?? 0) + value);
  }
  const dates = [...byDate.keys()].sort();
  if (dates.length < 2) return "";
  const latest = dates[dates.length - 1];
  const previousDay = dayKey(shift(new Date(latest + "T00:00:00"), -1));
  if (!byDate.has(previousDay)) return "";
  const latestSum = byDate.get(latest);
  const previousSum = byDate.get(previousDay);
  if (latestSum == null || previousSum == null || previousSum === 0) return "";
  const pct = Math.round(((latestSum - previousSum) / Math.abs(previousSum)) * 100);
  return (pct > 0 ? "+" : "") + String(pct) + "%";
}

function accountsOf(rows: MetricRow[]): MetricRow[] {
  return rows.filter((row) => !row.articleId);
}

export function buildMetricsView(input: {
  envId: string;
  rows: MetricRow[];
  now?: Date;
  notice?: string;
}): MetricsPageModel & { unlinked: number } {
  const now = input.now || new Date();
  const today = dayKey(now);
  const start = dayKey(shift(now, -6));
  const month = today.slice(0, 7);
  const split = partitionRows(input.rows, input.envId);
  const owned = accountsOf(split.owned);
  const windowRows = owned.filter((row) => row.date && row.date >= start && row.date <= today);
  const monthRows = owned.filter((row) => row.date && row.date.startsWith(month));
  const reads = aggregate(windowRows, "reads");
  const follows = aggregate(windowRows, "follows");
  const revenue = aggregate(monthRows, "revenue");
  const partial = windowRows.some((row) => row.completeness === "partial") || monthRows.some((row) => row.completeness === "partial");
  const source = [...new Set(windowRows.map((row) => nameOf(String(row.platform || ""))))].join("、") || "本地快照";
  const capturedAt = latestStamp(owned) || "";
  const hideDelta = partial;
  const trend: TrendPoint[] = owned.map((row) => ({
    date: String(row.date || ""),
    platform: String(row.platform || ""),
    reads: numberOf(row, "reads"),
    follows: numberOf(row, "follows"),
    likes: numberOf(row, "likes"),
    revenue: numberOf(row, "revenue") == null ? null : (Number(numberOf(row, "revenue")) / 100).toFixed(2),
    revenueCents: numberOf(row, "revenue"),
    completeness: asCompleteness(row.completeness),
    reason: row.reason || "",
    capturedAt: row.capturedAt || "",
    source: nameOf(String(row.platform || "")),
  }));
  const ranking: RankRow[] = split.owned.filter((row) => row.articleId).map((row) => ({
    title: row.title || String(row.articleId || "未命名"),
    platform: String(row.platform || ""),
    reads: numberOf(row, "reads"),
    completeness: asCompleteness(row.completeness),
    interaction: interactionOf(row),
    publishedAt: row.publishedAt || "",
    reason: row.reason || "",
    capturedAt: row.capturedAt || "",
    source: nameOf(String(row.platform || "")),
    date: String(row.date || ""),
    state: classifyState(row, now),
  }));
  const compare: CompareRow[] = windowRows.map((row) => ({
    platform: String(row.platform || ""),
    reads: numberOf(row, "reads"),
    likes: numberOf(row, "likes"),
    follows: numberOf(row, "follows"),
    completeness: asCompleteness(row.completeness),
    reason: row.reason || (row.completeness === "missing" || row.completeness === "unsupported" ? row.reason || "没有这项数据" : ""),
    capturedAt: row.capturedAt || "",
    source: nameOf(String(row.platform || "")),
    date: String(row.date || ""),
  }));
  const revenueSplit: RevenueRow[] = owned.map((row) => ({
    platform: String(row.platform || ""),
    text: row.completeness === "unsupported"
      ? "平台未提供"
      : numberOf(row, "revenue") == null
        ? "—"
        : yuanText(Number(numberOf(row, "revenue"))),
    completeness: asCompleteness(row.completeness),
    cents: numberOf(row, "revenue"),
    ad: row.revenueAd ?? null,
    activity: row.revenueActivity ?? null,
    subsidy: row.revenueSubsidy ?? null,
    reason: row.reason || "",
    capturedAt: row.capturedAt || "",
    source: nameOf(String(row.platform || "")),
    date: String(row.date || ""),
  }));
  const exceptions: ExceptionRow[] = [];
  const seen = new Map<string, ExceptionRow>();
  for (const row of owned) {
    const state = classifyState(row, now);
    if (state === "full") continue;
    const item: ExceptionRow = {
      platform: String(row.platform || ""),
      completeness: asCompleteness(row.completeness),
      reason: row.reason || "",
      state,
      capturedAt: row.capturedAt || "",
      source: nameOf(String(row.platform || "")),
      date: String(row.date || ""),
    };
    const prev = seen.get(item.platform);
    if (!prev || (STATE_RANK[state] || 0) >= (STATE_RANK[prev.state || ""] || 0)) seen.set(item.platform, item);
  }
  exceptions.push(...seen.values());
  const delta = hideDelta ? "" : deltaText(windowRows);
  return {
    envId: input.envId,
    capturedAt,
    overview: {
      reads: fact(reads.value, reads.value == null ? "—" : formatInt(reads.value), "次", reads.completeness, source, capturedAt),
      follows: fact(follows.value, follows.value == null ? "—" : (follows.value > 0 ? "+" + formatInt(follows.value) : formatInt(follows.value)), "人", follows.completeness, source, capturedAt),
      revenue: fact(revenue.value, revenue.value == null ? "—" : yuanText(revenue.value), "元", revenue.completeness, source, capturedAt),
    },
    trend,
    ranking,
    compare,
    revenueSplit,
    exceptions,
    hideDelta,
    deltaText: delta,
    month,
    today,
    notice: input.notice || "",
    metricsKnown: true,
    unlinked: split.unlinked.length,
  };
}

export function buildHomeView(input: {
  envId: string;
  rows?: MetricRow[];
  now?: Date;
  tasks?: TaskSnapshot[];
  comments?: CommentSnapshot[];
  accounts?: AccountSnapshot[];
  tasksKnown?: boolean;
  commentsKnown?: boolean;
  metricsKnown?: boolean;
  notice?: string;
}): HomePageModel & { unlinked: number } {
  const now = input.now || new Date();
  const today = dayKey(now);
  const yesterday = dayKey(shift(now, -1));
  const month = today.slice(0, 7);
  const metrics = buildMetricsView({ envId: input.envId, rows: input.rows || [], now, notice: input.notice });
  const split = partitionRows(input.rows || [], input.envId);
  const yesterdayRows = accountsOf(split.owned).filter((row) => row.date === yesterday);
  const monthRows = accountsOf(split.owned).filter((row) => row.date && row.date.startsWith(month));
  const reads = aggregate(yesterdayRows, "reads");
  const revenue = aggregate(monthRows, "revenue");
  const partial = yesterdayRows.some((row) => row.completeness === "partial") || monthRows.some((row) => row.completeness === "partial");
  const source = [...new Set(yesterdayRows.map((row) => nameOf(String(row.platform || ""))))].join("、") || "本地快照";
  const capturedAt = latestStamp(accountsOf(split.owned)) || "";
  const tasksKnown = input.tasksKnown ?? Array.isArray(input.tasks);
  const commentsKnown = input.commentsKnown ?? Array.isArray(input.comments);
  const metricsKnown = input.metricsKnown ?? Array.isArray(input.rows);
  const tasks = input.tasks || [];
  const attention: HomeAttention[] = [];
  const seenLogin = new Set<string>();
  for (const account of input.accounts || []) {
    if (account.state !== "login_missing" && account.state !== "error") continue;
    seenLogin.add(account.platform);
    attention.push({
      id: "account:" + account.platform,
      title: nameOf(account.platform) + (account.state === "login_missing" ? "登录失效" : "账号异常"),
      detail: account.detail || (account.state === "login_missing" ? "需要在这个环境里重新登录。不会改用别的环境。" : "这个账号状态异常，其他环境不受影响。"),
      state: account.state,
      platform: account.platform,
      action: account.state === "login_missing" ? "login" : "account",
    });
  }
  for (const row of accountsOf(split.owned)) {
    if (classifyState(row, now) !== "login_missing" || seenLogin.has(String(row.platform || ""))) continue;
    seenLogin.add(String(row.platform || ""));
    attention.push({
      id: "login:" + row.platform,
      title: nameOf(String(row.platform || "")) + "登录失效",
      detail: row.reason || "需要在这个环境里重新登录。不会改用别的环境。",
      state: "login_missing",
      platform: String(row.platform || ""),
      action: "login",
    });
  }
  for (const task of tasks) {
    if (!task.stage || !ATTENTION_STAGES.has(task.stage)) continue;
    const verify = task.stage === "结果待核验";
    attention.push({
      id: task.jobId || task.platform + ":" + task.title,
      title: nameOf(task.platform) + "《" + (task.title || "未命名") + "》" + task.stage,
      detail: task.stage === "发布失败"
        ? "发布失败，需要处理这一平台。已经成功的平台不会重做。"
        : verify
          ? "提交后的结果还不能确认，只能核验，不能直接重发。"
          : "这一步需要人看一下。",
      state: task.stage === "发布失败" ? "error" : "unknown",
      platform: task.platform,
      jobId: task.jobId,
      action: verify ? "verify" : "task",
    });
  }
  const recentTasks = [...tasks].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 8).map((task) => ({
    title: task.title,
    platform: task.platform,
    stage: task.stage,
    updatedAt: task.updatedAt,
  }));
  const recentComments = [...(input.comments || [])].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 4).map((item) => ({
    platform: item.platform,
    author: item.author,
    summary: item.summary.replace(/\s+/g, " ").trim(),
    createdAt: item.createdAt,
  }));
  return {
    envId: input.envId,
    capturedAt,
    attention,
    pendingCount: tasks.filter((task) => task.stage !== "已发布" && task.stage !== "发布失败" && task.stage !== "结果待核验").length,
    failedCount: tasks.filter((task) => task.stage === "发布失败").length,
    reads: fact(reads.value, reads.value == null ? "—" : formatInt(reads.value), "次", reads.completeness, source, capturedAt),
    revenue: fact(revenue.value, revenue.value == null ? "—" : yuanText(revenue.value), "元", revenue.completeness, source, capturedAt),
    recentTasks,
    recentComments,
    hideDelta: partial || metrics.hideDelta,
    deltaText: partial ? "" : metrics.deltaText,
    tasksKnown,
    commentsKnown,
    metricsKnown,
    notice: input.notice || "",
    unlinked: split.unlinked.length,
  };
}

function stop(code: string, message: string, envId: string, extra: Partial<StudioDataStop> = {}): StudioDataStop {
  return { ok: false, code, message, envId, unlinked: 0, kept: false, progress: [], ...extra };
}

function metricsDbUrl(): string {
  return pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "../../strategies/skills/social-media-publish/scripts/metrics-db.mjs")).href;
}

function collectorUrl(): string {
  return pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "../../strategies/skills/social-media-publish/scripts/collector.mjs")).href;
}

async function openMetrics(db?: MetricsModule): Promise<MetricsModule> {
  if (db) return db;
  const imported = await import(metricsDbUrl());
  return { listMetrics: imported.listMetrics as MetricsModule["listMetrics"] };
}

function bundle(envId: string, rows: MetricRow[], input: {
  now?: Date;
  tasks?: TaskSnapshot[];
  comments?: CommentSnapshot[];
  accounts?: AccountSnapshot[];
  tasksKnown?: boolean;
  commentsKnown?: boolean;
  notice?: string;
}, progress: CollectProgress[], kept: boolean, message = ""): StudioDataOk {
  const home = buildHomeView({
    envId,
    rows,
    now: input.now,
    tasks: input.tasks,
    comments: input.comments,
    accounts: input.accounts,
    tasksKnown: input.tasksKnown,
    commentsKnown: input.commentsKnown,
    metricsKnown: true,
    notice: input.notice,
  });
  const metrics = buildMetricsView({ envId, rows, now: input.now, notice: input.notice || message });
  return {
    ok: true,
    code: "ok",
    message,
    envId,
    home,
    metrics,
    unlinked: home.unlinked,
    kept,
    progress,
  };
}

export async function loadStudioData(input: {
  envId: string;
  configDir: string;
  file: string;
  now?: Date;
  tasks?: TaskSnapshot[];
  comments?: CommentSnapshot[];
  accounts?: AccountSnapshot[];
  tasksKnown?: boolean;
  commentsKnown?: boolean;
  db?: MetricsModule;
}): Promise<StudioDataResult> {
  const env = resolveStudioEnv(input.configDir, input.envId);
  if (!env.ok) return stop(env.code, env.message, env.envId);
  if (!input.file) return stop("missing_file", "没有指定指标库，已停止，不会写入真实数据目录。", env.envId);
  const db = await openMetrics(input.db);
  let rows: MetricRow[] = [];
  try {
    rows = await db.listMetrics(input.file);
  } catch {
    return stop("read_error", "指标库这次没有读出来，没有改用别的环境。", env.envId);
  }
  return bundle(env.envId, rows, input, [], false);
}

export async function refreshStudioData(input: {
  envId: string;
  configDir: string;
  file: string;
  now?: Date;
  force?: boolean;
  accounts?: Record<string, string>;
  tasks?: TaskSnapshot[];
  comments?: CommentSnapshot[];
  accountsState?: AccountSnapshot[];
  tasksKnown?: boolean;
  commentsKnown?: boolean;
  db?: MetricsModule;
  collect?: (opts: Record<string, unknown>) => Promise<CollectResult>;
  tabs?: Array<{ id?: string; url?: string; envId?: string }>;
  readJsons?: (sparo: unknown, tab: { id?: string }, urls: string[]) => Promise<Array<{ status: number; json: unknown }>>;
  onProgress?: (event: CollectProgress) => void;
  platforms?: string[];
}): Promise<StudioDataResult> {
  const env = resolveStudioEnv(input.configDir, input.envId);
  if (!env.ok) return stop(env.code, env.message, env.envId);
  if (!input.file) return stop("missing_file", "没有指定指标库，已停止，不会写入真实数据目录。", env.envId);
  const previous = await loadStudioData({ ...input, accounts: input.accountsState });
  const progress: CollectProgress[] = [];
  const collect = input.collect || (async (opts: Record<string, unknown>) => {
    const imported = await import(collectorUrl());
    return imported.collectAll(opts) as Promise<CollectResult>;
  });
  let collected: CollectResult;
  try {
    collected = await collect({
      envId: env.envId,
      file: input.file,
      force: input.force === true,
      accounts: input.accounts || {},
      tabs: input.tabs,
      readJsons: input.readJsons,
      platforms: input.platforms,
      clock: input.now,
      onProgress: (event: CollectProgress) => {
        progress.push(event);
        input.onProgress?.(event);
      },
    });
  } catch {
    return stop("kept_snapshot", "未获取到新数据，仍显示原时间结果", env.envId, {
      home: previous.ok ? previous.home : previous.home,
      metrics: previous.ok ? previous.metrics : previous.metrics,
      kept: true,
      unlinked: previous.unlinked,
      progress,
    });
  }
  if (!collected.ok && (collected.code === "kept_snapshot" || collected.code === "fetch_error")) {
    const again = await loadStudioData({ ...input, accounts: input.accountsState });
    return stop("kept_snapshot", "未获取到新数据，仍显示原时间结果", env.envId, {
      home: again.home,
      metrics: again.metrics,
      kept: true,
      unlinked: again.unlinked,
      progress,
    });
  }
  if (!collected.ok && collected.code !== "ok") {
    const again = await loadStudioData({ ...input, accounts: input.accountsState });
    return stop(collected.code, collected.message, env.envId, {
      home: again.home,
      metrics: again.metrics,
      kept: collected.code === "unlinked" || collected.code === "no_env_tab",
      unlinked: again.unlinked,
      progress,
    });
  }
  const loaded = await loadStudioData({ ...input, accounts: input.accountsState });
  if (!loaded.ok) return loaded;
  return { ...loaded, progress, message: collected.message || "" };
}
